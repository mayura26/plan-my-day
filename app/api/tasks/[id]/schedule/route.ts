import { type NextRequest, NextResponse } from "next/server";
import { validateAPIKey } from "@/lib/api-auth";
import { mapRowToTask, requireApiUser } from "@/lib/external-api";
import { alignDueDateOnReschedule, scheduleTaskUnified } from "@/lib/scheduler-utils";
import { withSubtaskScheduleOrder } from "@/lib/task-scheduling-route";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import { SCHEDULING_MODES, type SchedulingMode, type Task, type TaskGroup } from "@/lib/types";

function mapRowToGroup(row: Record<string, unknown>): TaskGroup {
  let autoScheduleHours = null;
  if (row.auto_schedule_hours) {
    try {
      autoScheduleHours = JSON.parse(row.auto_schedule_hours as string);
    } catch (e) {
      console.error("Error parsing auto_schedule_hours JSON:", e);
    }
  }
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    name: row.name as string,
    color: row.color as string,
    collapsed: Boolean(row.collapsed),
    parent_group_id: (row.parent_group_id as string) || null,
    is_parent_group: Boolean(row.is_parent_group),
    auto_schedule_enabled: Boolean(row.auto_schedule_enabled ?? false),
    auto_schedule_hours: autoScheduleHours,
    priority: row.priority ? (row.priority as number) : undefined,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

function isSchedulingMode(value: unknown): value is SchedulingMode {
  return typeof value === "string" && (SCHEDULING_MODES as readonly string[]).includes(value);
}

async function loadSchedulingContext(userId: string, task: Task) {
  const userResult = await db.execute("SELECT timezone, awake_hours FROM users WHERE id = ?", [
    userId,
  ]);
  const userTimezone =
    userResult.rows.length > 0
      ? getUserTimezone(userResult.rows[0].timezone as string | null)
      : "UTC";

  let awakeHours = null;
  if (userResult.rows.length > 0 && userResult.rows[0].awake_hours) {
    try {
      awakeHours = JSON.parse(userResult.rows[0].awake_hours as string);
    } catch (e) {
      console.error("Error parsing awake_hours JSON:", e);
      awakeHours = null;
    }
  }

  let taskGroup: TaskGroup | null = null;
  if (task.group_id) {
    const groupResult = await db.execute(
      "SELECT * FROM task_groups WHERE id = ? AND user_id = ?",
      [task.group_id, userId]
    );
    if (groupResult.rows.length > 0) {
      taskGroup = mapRowToGroup(groupResult.rows[0] as Record<string, unknown>);
    }
  }

  const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [userId]);
  const allTasks = allTasksResult.rows.map((row) =>
    mapRowToTask(row as Record<string, unknown>)
  );

  const allGroupsResult = await db.execute(
    "SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC",
    [userId]
  );
  const allGroups = allGroupsResult.rows.map((row) =>
    mapRowToGroup(row as Record<string, unknown>)
  );

  const dependencyMap = new Map<string, string[]>();
  const depsResult = await db.execute(
    "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE user_id = ?)",
    [userId]
  );
  for (const row of depsResult.rows) {
    const taskId = row.task_id as string;
    const dependsOnId = row.depends_on_task_id as string;
    if (!dependencyMap.has(taskId)) {
      dependencyMap.set(taskId, []);
    }
    dependencyMap.get(taskId)?.push(dependsOnId);
  }

  return { userTimezone, awakeHours, taskGroup, allTasks, allGroups, dependencyMap };
}

/**
 * POST /api/tasks/[id]/schedule
 * Body: { "mode": SchedulingMode }
 * Reschedule a task using the same modes as the in-app scheduler (API key auth).
 */
async function handlePOST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireApiUser(request);
    if (authResult.error) return authResult.error;
    const { userId } = authResult;

    const { id } = await params;

    let body: { mode?: unknown };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    if (!isSchedulingMode(body.mode)) {
      return NextResponse.json(
        {
          error: "Invalid or missing mode",
          allowed: SCHEDULING_MODES,
        },
        { status: 400 }
      );
    }
    const mode = body.mode;

    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      userId,
    ]);
    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = mapRowToTask(taskResult.rows[0] as Record<string, unknown>);

    const subtasksResult = await db.execute(
      `SELECT * FROM tasks WHERE parent_task_id = ? AND user_id = ? ORDER BY step_order ASC, created_at ASC`,
      [id, userId]
    );
    const subtasks = subtasksResult.rows.map((row) =>
      mapRowToTask(row as Record<string, unknown>)
    );

    // Parents with subtasks: schedule subtasks in order, unschedule parent
    if (subtasks.length > 0) {
      const feedback: string[] = [];
      const scheduledSubtasks: Task[] = [];
      const shuffledTaskUpdates: Array<{ taskId: string; newSlot: { start: Date; end: Date } }> =
        [];

      const ctx = await loadSchedulingContext(userId, task);
      let allTasks = ctx.allTasks;
      let lastScheduledEnd: Date | null = null;

      for (const subtask of subtasks) {
        if (subtask.status === "completed") {
          feedback.push(`Skipped "${subtask.title}" (already completed)`);
          continue;
        }
        if (!subtask.duration || subtask.duration <= 0) {
          feedback.push(`Skipped "${subtask.title}" (no duration set)`);
          continue;
        }

        const scheduleResult = scheduleTaskUnified({
          mode,
          task: subtask,
          allTasks,
          taskGroup: ctx.taskGroup,
          allGroups: ctx.allGroups,
          awakeHours: ctx.awakeHours,
          timezone: ctx.userTimezone,
          startFrom: lastScheduledEnd || undefined,
          dependencyMap: ctx.dependencyMap,
        });

        if (scheduleResult.slot) {
          const updatedAt = new Date().toISOString();
          await db.execute(
            `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, due_date = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [
              scheduleResult.slot.start.toISOString(),
              scheduleResult.slot.end.toISOString(),
              alignDueDateOnReschedule(subtask.due_date, scheduleResult.slot.end),
              updatedAt,
              subtask.id,
              userId,
            ]
          );

          const updatedSubtaskResult = await db.execute(
            "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
            [subtask.id, userId]
          );
          const updatedSubtask = mapRowToTask(
            updatedSubtaskResult.rows[0] as Record<string, unknown>
          );
          scheduledSubtasks.push(updatedSubtask);
          allTasks = allTasks.map((t) => (t.id === subtask.id ? updatedSubtask : t));
          lastScheduledEnd = scheduleResult.slot.end;
          feedback.push(...(scheduleResult.feedback || []));
          if (scheduleResult.shuffledTasks) {
            shuffledTaskUpdates.push(...scheduleResult.shuffledTasks);
          }
        } else {
          feedback.push(
            `Failed to schedule "${subtask.title}": ${scheduleResult.error || "No available time slot"}`
          );
        }
      }

      if (shuffledTaskUpdates.length > 0) {
        const updatedAt = new Date().toISOString();
        for (const shuffled of shuffledTaskUpdates) {
          await db.execute(
            `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [
              shuffled.newSlot.start.toISOString(),
              shuffled.newSlot.end.toISOString(),
              updatedAt,
              shuffled.taskId,
              userId,
            ]
          );
        }
      }

      const updatedAt = new Date().toISOString();
      const parentDueDate = lastScheduledEnd
        ? alignDueDateOnReschedule(task.due_date, lastScheduledEnd)
        : (task.due_date ?? null);
      await db.execute(
        `UPDATE tasks SET scheduled_start = NULL, scheduled_end = NULL, due_date = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
        [parentDueDate, updatedAt, id, userId]
      );

      const updatedParentResult = await db.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
        [id, userId]
      );
      const updatedParent = mapRowToTask(updatedParentResult.rows[0] as Record<string, unknown>);

      return NextResponse.json({
        success: true,
        mode,
        task: updatedParent,
        message: `Scheduled ${scheduledSubtasks.length} of ${subtasks.length} subtasks`,
        feedback,
      });
    }

    if (!task.duration || task.duration <= 0) {
      return NextResponse.json(
        { error: "Task must have a duration to be scheduled" },
        { status: 400 }
      );
    }

    if ((mode === "smart" || mode === "due-date") && !task.due_date) {
      return NextResponse.json(
        { error: `Mode '${mode}' requires the task to have a due_date` },
        { status: 400 }
      );
    }

    const ctx = await loadSchedulingContext(userId, task);
    const result = scheduleTaskUnified({
      mode,
      task,
      allTasks: ctx.allTasks,
      taskGroup: ctx.taskGroup,
      allGroups: ctx.allGroups,
      awakeHours: ctx.awakeHours,
      timezone: ctx.userTimezone,
      dependencyMap: ctx.dependencyMap,
    });

    if (!result.slot) {
      return NextResponse.json(
        {
          error: result.error || "Unable to schedule task with the requested mode",
          feedback: result.feedback,
        },
        { status: 422 }
      );
    }

    const updatedAt = new Date().toISOString();
    await db.execute(
      `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, due_date = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [
        result.slot.start.toISOString(),
        result.slot.end.toISOString(),
        alignDueDateOnReschedule(task.due_date, result.slot.end),
        updatedAt,
        id,
        userId,
      ]
    );

    if (result.shuffledTasks?.length) {
      for (const shuffled of result.shuffledTasks) {
        await db.execute(
          `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [
            shuffled.newSlot.start.toISOString(),
            shuffled.newSlot.end.toISOString(),
            updatedAt,
            shuffled.taskId,
            userId,
          ]
        );
      }
    }

    const updatedResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      userId,
    ]);
    const updatedTask = mapRowToTask(updatedResult.rows[0] as Record<string, unknown>);

    return NextResponse.json({
      success: true,
      mode,
      task: updatedTask,
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error scheduling task via API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export const POST = withSubtaskScheduleOrder(handlePOST, async (request) =>
  validateAPIKey(request)
);
