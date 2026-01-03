import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateTaskId, validateTaskData } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { CreateTaskRequest, Task, TaskStatus, TaskType } from "@/lib/types";

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

// GET /api/tasks/[id]/subtasks - Get all subtasks for a task
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Verify parent task exists and belongs to user
    const parentResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (parentResult.rows.length === 0) {
      return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
    }

    // Get all subtasks
    const result = await db.execute(
      `SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY priority ASC, created_at ASC`,
      [id]
    );

    const subtasks = result.rows.map(mapRowToTask);
    const completedCount = subtasks.filter((st) => st.status === "completed").length;

    return NextResponse.json({
      subtasks,
      total: subtasks.length,
      completed: completedCount,
      percentage: subtasks.length > 0 ? Math.round((completedCount / subtasks.length) * 100) : 0,
    });
  } catch (error) {
    console.error("Error fetching subtasks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/tasks/[id]/subtasks - Create a new subtask
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: parentId } = await params;
    const body: Partial<CreateTaskRequest> = await request.json();

    // Verify parent task exists and belongs to user
    const parentResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      parentId,
      session.user.id,
    ]);

    if (parentResult.rows.length === 0) {
      return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
    }

    const parentTask = mapRowToTask(parentResult.rows[0]);

    // Ensure parent is not itself a subtask (only one level deep)
    if (parentTask.parent_task_id) {
      return NextResponse.json(
        { error: "Cannot create subtasks of subtasks (only one level allowed)" },
        { status: 400 }
      );
    }

    // Validate subtask data
    const errors = validateTaskData({ ...body, title: body.title || "" });
    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    // Validate subtask duration doesn't exceed parent duration
    const subtaskDuration = body.duration !== undefined ? body.duration : 30; // Default to 30 minutes
    if (parentTask.duration !== null && parentTask.duration !== undefined) {
      // Get total duration of existing subtasks
      const existingSubtasksResult = await db.execute(
        `SELECT duration FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
        [parentId, session.user.id]
      );
      const totalExistingDuration = existingSubtasksResult.rows.reduce(
        (sum, row) => sum + (Number(row.duration) || 0),
        0
      );
      const totalDurationWithNew = totalExistingDuration + subtaskDuration;

      if (totalDurationWithNew > parentTask.duration) {
        // Check if extend_parent_duration flag is set
        const extendParentDuration = (body as any).extend_parent_duration === true;

        if (extendParentDuration) {
          // Update parent task duration
          const newParentDuration = totalDurationWithNew;
          const now = new Date().toISOString();
          await db.execute(
            `UPDATE tasks SET duration = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
            [newParentDuration, now, parentId, session.user.id]
          );
        } else {
          return NextResponse.json(
            {
              error: "Subtask duration exceeds parent task duration",
              details: [
                `Total subtask duration (${totalDurationWithNew} min) exceeds parent task duration (${parentTask.duration} min) by ${totalDurationWithNew - parentTask.duration} min`,
              ],
              current_total: totalExistingDuration,
              new_subtask_duration: subtaskDuration,
              total_with_new: totalDurationWithNew,
              parent_duration: parentTask.duration,
              required_extension: totalDurationWithNew - parentTask.duration,
            },
            { status: 400 }
          );
        }
      }
    }

    const taskId = generateTaskId();
    const now = new Date().toISOString();

    const subtask: Task = {
      id: taskId,
      user_id: session.user.id,
      title: body.title || "",
      description: body.description || null,
      priority: body.priority || parentTask.priority || 3,
      status: "pending",
      duration: body.duration !== undefined ? body.duration : 30, // Default to 30 minutes
      scheduled_start: body.scheduled_start || null,
      scheduled_end: body.scheduled_end || null,
      due_date: body.due_date || parentTask.due_date || null,
      locked: false,
      group_id: parentTask.group_id, // Subtasks inherit parent's group
      template_id: null,
      task_type: "subtask",
      google_calendar_event_id: null,
      notification_sent: false,
      depends_on_task_id: null,
      energy_level_required: body.energy_level_required || parentTask.energy_level_required || 3,
      parent_task_id: parentId,
      continued_from_task_id: null,
      ignored: false,
      created_at: now,
      updated_at: now,
    };

    await db.execute(
      `
      INSERT INTO tasks (
        id, user_id, title, description, priority, status, duration,
        scheduled_start, scheduled_end, due_date, locked, group_id, template_id,
        task_type, google_calendar_event_id, notification_sent,
        depends_on_task_id, energy_level_required, parent_task_id, continued_from_task_id,
        ignored, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        subtask.id,
        subtask.user_id,
        subtask.title,
        subtask.description ?? null,
        subtask.priority,
        subtask.status,
        subtask.duration ?? null,
        subtask.scheduled_start ?? null,
        subtask.scheduled_end ?? null,
        subtask.due_date ?? null,
        subtask.locked,
        subtask.group_id ?? null,
        subtask.template_id ?? null,
        subtask.task_type,
        subtask.google_calendar_event_id ?? null,
        subtask.notification_sent,
        subtask.depends_on_task_id ?? null,
        subtask.energy_level_required,
        subtask.parent_task_id ?? null,
        subtask.continued_from_task_id ?? null,
        subtask.ignored,
        subtask.created_at,
        subtask.updated_at,
      ]
    );

    // If parent task was completed, set it back to in_progress since we added a new subtask
    // Also unschedule the parent task since it now has subtasks (only subtasks should be scheduled)
    const parentUpdates: string[] = [];
    const parentUpdateValues: any[] = [];

    if (parentTask.status === "completed") {
      parentUpdates.push("status = ?");
      parentUpdateValues.push("in_progress");
    }

    // Always unschedule parent task when subtasks exist (only subtasks should be scheduled)
    parentUpdates.push("scheduled_start = ?");
    parentUpdates.push("scheduled_end = ?");
    parentUpdateValues.push(null, null);

    if (parentUpdates.length > 0) {
      parentUpdates.push("updated_at = ?");
      parentUpdateValues.push(now);
      parentUpdateValues.push(parentId);

      await db.execute(
        `UPDATE tasks SET ${parentUpdates.join(", ")} WHERE id = ?`,
        parentUpdateValues
      );
    }

    return NextResponse.json({ subtask }, { status: 201 });
  } catch (error) {
    console.error("Error creating subtask:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
