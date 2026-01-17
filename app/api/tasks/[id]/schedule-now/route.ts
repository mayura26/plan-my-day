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

// POST /api/tasks/[id]/schedule-now - Auto-schedule a task to the nearest available slot
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const startTime = Date.now();
  try {
    console.log("[Schedule Now API] Starting schedule-now request");
    
    const session = await auth();
    if (!session?.user?.id) {
      console.error("[Schedule Now API] Unauthorized - no session or user ID");
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    console.log("[Schedule Now API] Processing task", { taskId: id, userId: session.user.id });

    // Verify task exists and belongs to user
    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (taskResult.rows.length === 0) {
      console.error("[Schedule Now API] Task not found", { taskId: id, userId: session.user.id });
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = mapRowToTask(taskResult.rows[0]);
    console.log("[Schedule Now API] Task found", {
      taskId: task.id,
      title: task.title,
      duration: task.duration,
      status: task.status,
      groupId: task.group_id,
      hasScheduledStart: !!task.scheduled_start,
      hasScheduledEnd: !!task.scheduled_end,
      dueDate: task.due_date,
      parentTaskId: task.parent_task_id,
    });

    // Check if task has subtasks
    const subtasksResult = await db.execute(
      `SELECT * FROM tasks WHERE parent_task_id = ? AND user_id = ? ORDER BY step_order ASC, created_at ASC`,
      [id, session.user.id]
    );
    const subtasks = subtasksResult.rows.map(mapRowToTask);

    console.log("[Schedule Now API] Subtasks check", {
      subtaskCount: subtasks.length,
      subtasks: subtasks.map((st) => ({
        id: st.id,
        title: st.title,
        duration: st.duration,
        status: st.status,
      })),
    });

    // If task has subtasks, schedule each subtask in order
    if (subtasks.length > 0) {
      console.log("[Schedule Now API] Processing parent task with subtasks");
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
          console.error("[Schedule Now API] Error parsing awake_hours JSON:", e);
          awakeHours = null;
        }
      }

      console.log("[Schedule Now API] User settings", {
        userTimezone,
        awakeHours,
        rawTimezone: userResult.rows[0]?.timezone,
        rawAwakeHours: userResult.rows[0]?.awake_hours,
      });

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
              console.error("[Schedule Now API] Error parsing auto_schedule_hours JSON:", e);
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
          console.log("[Schedule Now API] Task group found", {
            groupId: taskGroup.id,
            groupName: taskGroup.name,
            autoScheduleEnabled: taskGroup.auto_schedule_enabled,
            autoScheduleHours: taskGroup.auto_schedule_hours,
            priority: taskGroup.priority,
          });
        } else {
          console.warn("[Schedule Now API] Task group ID provided but group not found", {
            groupId: task.group_id,
          });
        }
      } else {
        console.log("[Schedule Now API] Task has no group");
      }

      // Get all tasks for conflict checking
      const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
        session.user.id,
      ]);
      let allTasks = allTasksResult.rows.map(mapRowToTask);
      console.log("[Schedule Now API] All tasks loaded", {
        totalTasks: allTasks.length,
        scheduledTasks: allTasks.filter((t) => t.scheduled_start).length,
      });

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
        console.log("[Schedule Now API] Scheduling subtask", {
          subtaskId: subtask.id,
          subtaskTitle: subtask.title,
          subtaskDuration: subtask.duration,
          startFrom: lastScheduledEnd?.toISOString(),
        });

        const scheduleResult = scheduleTaskUnified({
          mode: "now",
          task: subtask,
          allTasks,
          taskGroup,
          awakeHours,
          timezone: userTimezone,
          startFrom: lastScheduledEnd || undefined,
          dependencyMap,
        });

        console.log("[Schedule Now API] Subtask schedule result", {
          subtaskId: subtask.id,
          hasSlot: !!scheduleResult.slot,
          slotStart: scheduleResult.slot?.start.toISOString(),
          slotEnd: scheduleResult.slot?.end.toISOString(),
          error: scheduleResult.error,
          feedback: scheduleResult.feedback,
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
            // shuffledTasks contains { taskId, newSlot } objects, not Task objects
            // We'll handle them separately when updating the database
            for (const shuffled of scheduleResult.shuffledTasks) {
              shuffledTasks.push(shuffled);
            }
          }
        } else {
          const errorMsg = scheduleResult.error || "No available time slot";
          console.error("[Schedule Now API] Failed to schedule subtask", {
            subtaskId: subtask.id,
            subtaskTitle: subtask.title,
            error: errorMsg,
            feedback: scheduleResult.feedback,
          });
          feedback.push(`Failed to schedule "${subtask.title}": ${errorMsg}`);
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

      return NextResponse.json({
        task: updatedParent,
        scheduledSubtasks,
        shuffledTasks,
        feedback,
        message: `Scheduled ${scheduledSubtasks.length} of ${subtasks.length} subtasks`,
      });
    }

    // Task must have a duration to be scheduled
    if (!task.duration || task.duration <= 0) {
      console.error("[Schedule Now API] Task has no duration", {
        taskId: task.id,
        duration: task.duration,
      });
      return NextResponse.json(
        { error: "Task must have a duration to be scheduled" },
        { status: 400 }
      );
    }

    console.log("[Schedule Now API] Processing single task (no subtasks)");

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
        console.error("[Schedule Now API] Error parsing awake_hours JSON:", e);
        awakeHours = null;
      }
    }

    console.log("[Schedule Now API] User settings", {
      userTimezone,
      awakeHours,
      rawTimezone: userResult.rows[0]?.timezone,
      rawAwakeHours: userResult.rows[0]?.awake_hours,
    });

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
            console.error("[Schedule Now API] Error parsing auto_schedule_hours JSON:", e);
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
        console.log("[Schedule Now API] Task group found", {
          groupId: taskGroup.id,
          groupName: taskGroup.name,
          autoScheduleEnabled: taskGroup.auto_schedule_enabled,
          autoScheduleHours: taskGroup.auto_schedule_hours,
          priority: taskGroup.priority,
        });
      } else {
        console.warn("[Schedule Now API] Task group ID provided but group not found", {
          groupId: task.group_id,
        });
      }
    } else {
      console.log("[Schedule Now API] Task has no group");
    }

    // Get all tasks for the user to check for conflicts
    const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
      session.user.id,
    ]);
    const allTasks = allTasksResult.rows.map(mapRowToTask);
    console.log("[Schedule Now API] All tasks loaded", {
      totalTasks: allTasks.length,
      scheduledTasks: allTasks.filter((t) => t.scheduled_start).length,
    });

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

    // Use unified scheduler with "now" mode
    console.log("[Schedule Now API] Calling scheduleTaskUnified", {
      mode: "now",
      taskId: task.id,
      taskDuration: task.duration,
      taskGroupId: task.group_id,
      userTimezone,
      hasAwakeHours: !!awakeHours,
      hasTaskGroup: !!taskGroup,
      allTasksCount: allTasks.length,
      dependencyCount: dependencyMap.size,
    });

    const result = scheduleTaskUnified({
      mode: "now",
      task,
      allTasks,
      taskGroup,
      awakeHours,
      timezone: userTimezone,
      dependencyMap,
    });

    console.log("[Schedule Now API] scheduleTaskUnified result", {
      hasSlot: !!result.slot,
      slotStart: result.slot?.start.toISOString(),
      slotEnd: result.slot?.end.toISOString(),
      error: result.error,
      feedback: result.feedback,
      shuffledTasksCount: result.shuffledTasks?.length || 0,
    });

    if (!result.slot) {
      console.error("[Schedule Now API] No slot found", {
        error: result.error,
        feedback: result.feedback,
        taskId: task.id,
      });
      return NextResponse.json(
        {
          error: result.error || "Unable to schedule task. No available time slot found.",
          feedback: result.feedback,
        },
        { status: 422 }
      );
    }

    // Update task with the scheduled times
    const updatedAt = new Date().toISOString();
    console.log("[Schedule Now API] Updating task with scheduled times", {
      taskId: id,
      scheduledStart: result.slot.start.toISOString(),
      scheduledEnd: result.slot.end.toISOString(),
    });

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

    const duration = Date.now() - startTime;
    console.log("[Schedule Now API] Task scheduled successfully", {
      taskId: updatedTask.id,
      scheduledStart: updatedTask.scheduled_start,
      scheduledEnd: updatedTask.scheduled_end,
      durationMs: duration,
    });

    return NextResponse.json({
      task: updatedTask,
      message: "Task scheduled successfully",
      feedback: result.feedback,
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error("[Schedule Now API] Error scheduling task:", error);
    console.error("[Schedule Now API] Error details", {
      errorType: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
      errorStack: error instanceof Error ? error.stack : undefined,
      durationMs: duration,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
