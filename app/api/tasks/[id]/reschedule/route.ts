import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scheduleTaskUnified } from "@/lib/scheduler-utils";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { RescheduleTaskRequest, Task, TaskGroup, TaskStatus, TaskType } from "@/lib/types";

// Helper to map database row to Task object
function mapRowToTask(row: any): Task {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    title: row.title as string,
    description: row.description as string | null,
    priority: row.priority as number,
    status: row.status as TaskStatus,
    duration: row.duration as number | null,
    scheduled_start: row.scheduled_start as string | null,
    scheduled_end: row.scheduled_end as string | null,
    due_date: row.due_date as string | null,
    locked: Boolean(row.locked),
    group_id: row.group_id as string | null,
    template_id: row.template_id as string | null,
    task_type: row.task_type as TaskType,
    google_calendar_event_id: row.google_calendar_event_id as string | null,
    notification_sent: Boolean(row.notification_sent),
    depends_on_task_id: row.depends_on_task_id as string | null,
    energy_level_required: row.energy_level_required as number,
    parent_task_id: row.parent_task_id as string | null,
    continued_from_task_id: row.continued_from_task_id as string | null,
    step_order:
      row.step_order !== null && row.step_order !== undefined ? Number(row.step_order) : null,
    ignored: Boolean(row.ignored ?? false),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// POST /api/tasks/[id]/reschedule - Reschedule a task
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: RescheduleTaskRequest = await request.json();

    // Validate request
    if (!body.mode || (body.mode !== "next-available" && body.mode !== "asap-shuffle")) {
      return NextResponse.json(
        { error: "mode must be 'next-available' or 'asap-shuffle'" },
        { status: 400 }
      );
    }

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = mapRowToTask(taskResult.rows[0]);

    // Task must not be completed to be rescheduled
    if (task.status === "completed") {
      return NextResponse.json({ error: "Cannot reschedule a completed task" }, { status: 400 });
    }

    // Task must have a duration to be scheduled
    if (!task.duration || task.duration <= 0) {
      return NextResponse.json(
        { error: "Task must have a duration to be rescheduled" },
        { status: 400 }
      );
    }

    // Get user's timezone and awake hours
    const userResult = await db.execute("SELECT timezone, awake_hours FROM users WHERE id = ?", [
      session.user.id,
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

    // Get task's group if it has one
    let taskGroup: TaskGroup | null = null;
    if (task.group_id) {
      const groupResult = await db.execute(
        "SELECT * FROM task_groups WHERE id = ? AND user_id = ?",
        [task.group_id, session.user.id]
      );
      if (groupResult.rows.length > 0) {
        const row = groupResult.rows[0];
        let autoScheduleHours = null;
        if (row.auto_schedule_hours) {
          try {
            autoScheduleHours = JSON.parse(row.auto_schedule_hours as string);
          } catch (e) {
            console.error("Error parsing auto_schedule_hours JSON:", e);
          }
        }
        taskGroup = {
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
    }

    // Get all tasks for the user
    const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
      session.user.id,
    ]);
    const allTasks = allTasksResult.rows.map(mapRowToTask);

    // Build dependency map from task_dependencies table
    const dependencyMap = new Map<string, string[]>();
    const depsResult = await db.execute(
      "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id IN (SELECT id FROM tasks WHERE user_id = ?)",
      [session.user.id]
    );
    for (const row of depsResult.rows) {
      const taskId = row.task_id as string;
      const dependsOnId = row.depends_on_task_id as string;
      if (!dependencyMap.has(taskId)) {
        dependencyMap.set(taskId, []);
      }
      const deps = dependencyMap.get(taskId);
      if (deps) {
        deps.push(dependsOnId);
      }
    }

    const now = new Date().toISOString();
    let updatedTask: Task;
    const shuffledTasks: Array<{ taskId: string; task: Task }> = [];

    // Use unified scheduler with appropriate mode
    // "next-available" maps to "now" mode (finds next available slot respecting rules)
    // "asap-shuffle" maps to "asap" mode (shuffles other tasks if needed)
    const schedulingMode = body.mode === "next-available" ? "now" : "asap";

    const result = scheduleTaskUnified({
      mode: schedulingMode,
      task,
      allTasks,
      taskGroup,
      awakeHours,
      timezone: userTimezone,
      dependencyMap,
    });

    if (!result.slot) {
      return NextResponse.json(
        {
          error: result.error || "No available time slot found within the search window",
          feedback: result.feedback,
        },
        { status: 404 }
      );
    }

    // Update task with the scheduled times
    await db.execute(
      `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [result.slot.start.toISOString(), result.slot.end.toISOString(), now, id, session.user.id]
    );

    // Update all shuffled tasks if any (for asap mode)
    if (result.shuffledTasks && result.shuffledTasks.length > 0) {
      for (const shuffled of result.shuffledTasks) {
        await db.execute(
          `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
          [
            shuffled.newSlot.start.toISOString(),
            shuffled.newSlot.end.toISOString(),
            now,
            shuffled.taskId,
            session.user.id,
          ]
        );

        // Fetch updated shuffled task
        const shuffledResult = await db.execute(
          "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
          [shuffled.taskId, session.user.id]
        );
        if (shuffledResult.rows.length > 0) {
          shuffledTasks.push({
            taskId: shuffled.taskId,
            task: mapRowToTask(shuffledResult.rows[0]),
          });
        }
      }
    }

    // Fetch updated task
    const updatedResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);
    updatedTask = mapRowToTask(updatedResult.rows[0]);

    // Note: We don't mark the task as "rescheduled" - that status is only for tasks that have been
    // carried over. A rescheduled task remains in its current status (typically "pending") since
    // it's still the same task, just moved to a new time slot.

    return NextResponse.json({
      task: updatedTask,
      shuffledTasks: shuffledTasks.map((st) => st.task),
      feedback: result.feedback,
      message:
        body.mode === "asap-shuffle"
          ? `Task rescheduled with ${shuffledTasks.length} task(s) shuffled.`
          : "Task rescheduled successfully.",
    });
  } catch (error) {
    console.error("Error rescheduling task:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
