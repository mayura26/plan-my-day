import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { rescheduleTaskWithShuffling } from "@/lib/scheduler-utils";
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

// POST /api/tasks/[id]/schedule-asap - Schedule a task ASAP with shuffling
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

    // Use rescheduleTaskWithShuffling to place task at next working hour slot and shuffle conflicts
    // This should always succeed since it shuffles tasks to make room, but handle errors gracefully
    let result;
    try {
      result = rescheduleTaskWithShuffling(task, allTasks, workingHours, userTimezone);
    } catch (error) {
      // If shuffling fails (e.g., all tasks are locked), provide helpful error
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unable to schedule task. Could not find an available slot or resolve conflicts.";
      return NextResponse.json({ error: errorMessage }, { status: 422 });
    }

    // Update the scheduled task
    const updatedAt = new Date().toISOString();
    await db.execute(
      `UPDATE tasks SET scheduled_start = ?, scheduled_end = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
      [
        result.taskSlot.start.toISOString(),
        result.taskSlot.end.toISOString(),
        updatedAt,
        id,
        session.user.id,
      ]
    );

    // Update all shuffled tasks
    const shuffledTasks: Task[] = [];
    for (const shuffled of result.shuffledTasks) {
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

      // Fetch updated shuffled task
      const shuffledResult = await db.execute(
        "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
        [shuffled.taskId, session.user.id]
      );
      if (shuffledResult.rows.length > 0) {
        shuffledTasks.push(mapRowToTask(shuffledResult.rows[0]));
      }
    }

    // Fetch updated task
    const updatedResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    const updatedTask = mapRowToTask(updatedResult.rows[0]);

    return NextResponse.json({
      task: updatedTask,
      shuffledTasks,
      message:
        shuffledTasks.length > 0
          ? `Task scheduled with ${shuffledTasks.length} task(s) shuffled forward.`
          : "Task scheduled successfully.",
    });
  } catch (error) {
    console.error("Error scheduling task ASAP:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}

