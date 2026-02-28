import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scheduleTaskUnified } from "@/lib/scheduler-utils";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { Task, TaskGroup, TaskStatus, TaskType } from "@/lib/types";

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
    lead_reminder_sent: Boolean(row.lead_reminder_sent ?? 0),
    due_reminder_sent: Boolean(row.due_reminder_sent ?? 0),
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

function mapRowToGroup(row: any): TaskGroup {
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

// POST /api/tasks/[id]/schedule-tomorrow - Schedule a task for tomorrow
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = mapRowToTask(taskResult.rows[0]);

    // Check if task has subtasks
    const subtasksResult = await db.execute(
      `SELECT * FROM tasks WHERE parent_task_id = ? AND user_id = ? ORDER BY step_order ASC, created_at ASC`,
      [id, session.user.id]
    );
    const subtasks = subtasksResult.rows.map(mapRowToTask);

    // If task has subtasks, schedule each subtask in order
    if (subtasks.length > 0) {
      const feedback: string[] = [];
      const scheduledSubtasks: Task[] = [];
      const shuffledTasks: Array<{ taskId: string; newSlot: { start: Date; end: Date } }> = [];

      // Get user's timezone and awake hours (needed for scheduling)
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

      // Get all tasks for conflict checking
      const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
        session.user.id,
      ]);
      let allTasks = allTasksResult.rows.map(mapRowToTask);

      // Fetch all user groups for displaced task group hour lookups
      const allGroupsResult = await db.execute(
        "SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC",
        [session.user.id]
      );
      const allGroups = allGroupsResult.rows.map(mapRowToGroup);

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

      // Schedule each subtask sequentially
      let lastScheduledEnd: Date | null = null;
      for (const subtask of subtasks) {
        // Skip completed subtasks
        if (subtask.status === "completed") {
          feedback.push(`Skipped "${subtask.title}" (already completed)`);
          continue;
        }

        // Subtask must have a duration to be scheduled
        if (!subtask.duration || subtask.duration <= 0) {
          feedback.push(`Skipped "${subtask.title}" (no duration set)`);
          continue;
        }

        // Use unified scheduler, starting from lastScheduledEnd if available
        // This ensures we respect working hours and group rules while scheduling sequentially
        const scheduleResult = scheduleTaskUnified({
          mode: "tomorrow",
          task: subtask,
          allTasks,
          taskGroup,
          allGroups,
          awakeHours,
          timezone: userTimezone,
          startFrom: lastScheduledEnd || undefined,
          dependencyMap,
        });

        if (scheduleResult.slot) {
          // Update subtask with scheduled times
          const updatedAt = new Date().toISOString();
          await db.execute(
            `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [
              scheduleResult.slot.start.toISOString(),
              scheduleResult.slot.end.toISOString(),
              updatedAt,
              subtask.id,
              session.user.id,
            ]
          );

          // Fetch updated subtask
          const updatedSubtaskResult = await db.execute(
            "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
            [subtask.id, session.user.id]
          );
          const updatedSubtask = mapRowToTask(updatedSubtaskResult.rows[0]);
          scheduledSubtasks.push(updatedSubtask);

          // Update allTasks to include the newly scheduled subtask for conflict checking
          allTasks = allTasks.map((t) => (t.id === subtask.id ? updatedSubtask : t));

          lastScheduledEnd = scheduleResult.slot.end;
          feedback.push(...(scheduleResult.feedback || []));
          if (scheduleResult.shuffledTasks) {
            for (const shuffled of scheduleResult.shuffledTasks) {
              shuffledTasks.push(shuffled);
            }
          }
        } else {
          feedback.push(
            `Failed to schedule "${subtask.title}": ${scheduleResult.error || "No available time slot"}`
          );
        }
      }

      // Update all shuffled tasks if any
      if (shuffledTasks.length > 0) {
        const updatedAt = new Date().toISOString();
        for (const shuffled of shuffledTasks) {
          await db.execute(
            `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [
              shuffled.newSlot.start.toISOString(),
              shuffled.newSlot.end.toISOString(),
              updatedAt,
              shuffled.taskId,
              session.user.id,
            ]
          );
        }
      }

      // Unschedule parent task if it was scheduled (only subtasks should be scheduled)
      const updatedAt = new Date().toISOString();
      await db.execute(
        `UPDATE tasks SET scheduled_start = NULL, scheduled_end = NULL, updated_at = ? WHERE id = ? AND user_id = ?`,
        [updatedAt, id, session.user.id]
      );

      // Fetch updated parent task
      const updatedParentResult = await db.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
        [id, session.user.id]
      );
      const updatedParent = mapRowToTask(updatedParentResult.rows[0]);

      // Fetch updated shuffled tasks for response
      const updatedShuffledTasks: Task[] = [];
      if (shuffledTasks.length > 0) {
        for (const shuffled of shuffledTasks) {
          const shuffledResult = await db.execute(
            "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
            [shuffled.taskId, session.user.id]
          );
          if (shuffledResult.rows.length > 0) {
            updatedShuffledTasks.push(mapRowToTask(shuffledResult.rows[0]));
          }
        }
      }

      return NextResponse.json({
        task: updatedParent,
        scheduledSubtasks,
        shuffledTasks: updatedShuffledTasks,
        feedback,
        message: `Scheduled ${scheduledSubtasks.length} of ${subtasks.length} subtasks for tomorrow`,
      });
    }

    // Task must have a duration to be scheduled
    if (!task.duration || task.duration <= 0) {
      return NextResponse.json(
        { error: "Task must have a duration to be scheduled" },
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

    // Get all tasks for the user to check for conflicts
    const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
      session.user.id,
    ]);
    const allTasks = allTasksResult.rows.map(mapRowToTask);

    // Fetch all user groups for displaced task group hour lookups
    const allGroupsResult = await db.execute(
      "SELECT * FROM task_groups WHERE user_id = ? ORDER BY name ASC",
      [session.user.id]
    );
    const allGroups = allGroupsResult.rows.map(mapRowToGroup);

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

    // Use unified scheduler with "tomorrow" mode
    const result = scheduleTaskUnified({
      mode: "tomorrow",
      task,
      allTasks,
      taskGroup,
      allGroups,
      awakeHours,
      timezone: userTimezone,
      dependencyMap,
    });

    if (!result.slot) {
      return NextResponse.json(
        {
          error: result.error || "Unable to schedule task for tomorrow. Please try another mode.",
          feedback: result.feedback,
        },
        { status: 422 }
      );
    }

    // Update task with the scheduled times
    const updatedAt = new Date().toISOString();
    await db.execute(
      `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [
        result.slot.start.toISOString(),
        result.slot.end.toISOString(),
        updatedAt,
        id,
        session.user.id,
      ]
    );

    // Fetch updated task
    const updatedResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    const updatedTask = mapRowToTask(updatedResult.rows[0]);

    return NextResponse.json({
      task: updatedTask,
      message: "Task scheduled for tomorrow",
      feedback: result.feedback,
    });
  } catch (error) {
    console.error("Error scheduling task for tomorrow:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
