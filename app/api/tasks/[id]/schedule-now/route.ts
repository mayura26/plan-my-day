import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { scheduleTask } from "@/lib/scheduler-utils";
import { getUserTimezone } from "@/lib/timezone-utils";
import { db } from "@/lib/turso";
import type { Task, TaskStatus, TaskType } from "@/lib/types";

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
    ignored: Boolean(row.ignored ?? false),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// POST /api/tasks/[id]/schedule-now - Auto-schedule a task to the nearest available slot
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

    // Task must have a duration to be scheduled
    if (!task.duration || task.duration <= 0) {
      return NextResponse.json(
        { error: "Task must have a duration to be scheduled" },
        { status: 400 }
      );
    }

    // Get user's timezone and working hours
    const userResult = await db.execute("SELECT timezone, working_hours FROM users WHERE id = ?", [
      session.user.id,
    ]);
    const userTimezone =
      userResult.rows.length > 0
        ? getUserTimezone(userResult.rows[0].timezone as string | null)
        : "UTC";

    let workingHours = null;
    if (userResult.rows.length > 0 && userResult.rows[0].working_hours) {
      try {
        workingHours = JSON.parse(userResult.rows[0].working_hours as string);
      } catch (e) {
        console.error("Error parsing working_hours JSON:", e);
        workingHours = null;
      }
    }

    // Get all tasks for the user to check for conflicts
    const allTasksResult = await db.execute("SELECT * FROM tasks WHERE user_id = ?", [
      session.user.id,
    ]);
    const allTasks = allTasksResult.rows.map(mapRowToTask);

    // "Schedule Now" uses ASAP strategy (ignores due date)
    const slot = scheduleTask(task, allTasks, workingHours, userTimezone, {
      strategy: "asap",
    });

    if (!slot) {
      // Provide more helpful error message
      const scheduledTasksCount = allTasks.filter(
        (t) =>
          t.scheduled_start &&
          t.scheduled_end &&
          t.status !== "completed" &&
          t.status !== "cancelled"
      ).length;

      // Check if working hours are configured
      const hasWorkingHours =
        workingHours &&
        Object.keys(workingHours).length > 0 &&
        Object.values(workingHours).some((hours) => hours !== null);

      let errorMessage =
        "Unable to schedule task. No available time slot found within the next 7 days.";
      if (!hasWorkingHours) {
        errorMessage += " Please configure your working hours in settings to enable scheduling.";
      } else if (scheduledTasksCount > 0) {
        errorMessage +=
          " Your calendar may be too full. Try unscheduling some tasks or use 'Schedule ASAP' to shuffle existing tasks.";
      }

      return NextResponse.json({ error: errorMessage }, { status: 422 });
    }

    // Update task with the scheduled times
    const updatedAt = new Date().toISOString();
    await db.execute(
      `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [slot.start.toISOString(), slot.end.toISOString(), updatedAt, id, session.user.id]
    );

    // Fetch updated task
    const updatedResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    const updatedTask = mapRowToTask(updatedResult.rows[0]);

    return NextResponse.json({
      task: updatedTask,
      message: "Task scheduled successfully",
    });
  } catch (error) {
    console.error("Error scheduling task:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
