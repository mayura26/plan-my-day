import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";
import type { Task, TaskStatus, TaskType, UpdateTaskRequest } from "@/lib/types";

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

// Helper to check and update parent task status when subtask changes
async function checkAndUpdateParentStatus(parentTaskId: string, userId: string): Promise<void> {
  // Get all subtasks of this parent
  const subtasksResult = await db.execute(
    `SELECT status FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
    [parentTaskId, userId]
  );

  if (subtasksResult.rows.length === 0) return;

  // Check if all subtasks are completed
  const allCompleted = subtasksResult.rows.every((row) => row.status === "completed");

  if (allCompleted) {
    // Auto-complete the parent task
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`,
      [now, parentTaskId, userId]
    );
  }
}

// Helper to complete all subtasks when parent is completed
async function completeAllSubtasks(parentTaskId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE tasks SET status = 'completed', updated_at = ? WHERE parent_task_id = ? AND user_id = ? AND status != 'completed'`,
    [now, parentTaskId, userId]
  );
}

// Helper to check and complete original task when carryover is completed
async function checkAndCompleteOriginalTask(
  carryoverTaskId: string,
  userId: string
): Promise<void> {
  // Get the carryover task to find the original
  const carryoverResult = await db.execute(
    `SELECT continued_from_task_id FROM tasks WHERE id = ? AND user_id = ?`,
    [carryoverTaskId, userId]
  );

  if (carryoverResult.rows.length === 0) return;
  const originalTaskId = carryoverResult.rows[0].continued_from_task_id as string | null;

  if (!originalTaskId) return;

  // Mark the original task as completed
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`,
    [now, originalTaskId, userId]
  );
}

// GET /api/tasks/[id] - Get a specific task
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const includeSubtasks = searchParams.get("include_subtasks") === "true";

    const result = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const task = mapRowToTask(result.rows[0]);

    // Optionally include subtasks
    if (includeSubtasks) {
      const subtasksResult = await db.execute(
        `SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY priority ASC, created_at ASC`,
        [task.id]
      );
      return NextResponse.json({
        task: {
          ...task,
          subtasks: subtasksResult.rows.map(mapRowToTask),
          subtask_count: subtasksResult.rows.length,
          completed_subtask_count: subtasksResult.rows.filter((r) => r.status === "completed")
            .length,
        },
      });
    }

    return NextResponse.json({ task });
  } catch (error) {
    console.error("Error fetching task:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/tasks/[id] - Update a specific task
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body: UpdateTaskRequest = await request.json();

    // Validate task data (only validate provided fields for partial updates)
    const errors: string[] = [];

    // Only validate title if it's being updated
    if (body.title !== undefined) {
      if (!body.title || body.title.trim().length === 0) {
        errors.push("Title is required");
      }
    }

    if (body.priority !== undefined && (body.priority < 1 || body.priority > 5)) {
      errors.push("Priority must be between 1 and 5");
    }

    if (
      body.energy_level_required !== undefined &&
      (body.energy_level_required < 1 || body.energy_level_required > 5)
    ) {
      errors.push("Energy level must be between 1 and 5");
    }

    if (body.duration !== undefined && body.duration < 0) {
      errors.push("Duration must be positive");
    }

    if (body.scheduled_start && body.scheduled_end) {
      const start = new Date(body.scheduled_start);
      const end = new Date(body.scheduled_end);
      if (start >= end) {
        errors.push("End time must be after start time");
      }
    }

    if (errors.length > 0) {
      return NextResponse.json({ error: "Validation failed", details: errors }, { status: 400 });
    }

    // Check if task exists and belongs to user
    const existingTaskResult = await db.execute(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
      [id, session.user.id]
    );

    if (existingTaskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const existingTask = mapRowToTask(existingTaskResult.rows[0]);
    const now = new Date().toISOString();

    // Check if trying to schedule a parent task that has subtasks
    if (
      (body.scheduled_start !== undefined || body.scheduled_end !== undefined) &&
      !existingTask.parent_task_id
    ) {
      // Check if this parent task has subtasks
      const subtaskCountResult = await db.execute(
        `SELECT COUNT(*) as count FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
        [id, session.user.id]
      );
      const subtaskCount = Number(subtaskCountResult.rows[0]?.count || 0);

      if (subtaskCount > 0) {
        // Parent tasks with subtasks cannot be scheduled - only subtasks should be scheduled
        // Automatically unschedule the parent task
        body.scheduled_start = undefined;
        body.scheduled_end = undefined;
      }
    }

    // Build dynamic update query
    const updateFields: string[] = [];
    const values: any[] = [];

    if (body.title !== undefined) {
      updateFields.push("title = ?");
      values.push(body.title);
    }
    if (body.description !== undefined) {
      updateFields.push("description = ?");
      values.push(body.description);
    }
    if (body.priority !== undefined) {
      updateFields.push("priority = ?");
      values.push(body.priority);
    }
    if (body.status !== undefined) {
      updateFields.push("status = ?");
      values.push(body.status);
    }
    if (body.duration !== undefined) {
      updateFields.push("duration = ?");
      values.push(body.duration);
    }
    if (body.scheduled_start !== undefined) {
      updateFields.push("scheduled_start = ?");
      values.push(body.scheduled_start);
    }
    if (body.scheduled_end !== undefined) {
      updateFields.push("scheduled_end = ?");
      values.push(body.scheduled_end);
    }
    if (body.locked !== undefined) {
      updateFields.push("locked = ?");
      values.push(body.locked);
    }
    if (body.group_id !== undefined) {
      updateFields.push("group_id = ?");
      values.push(body.group_id);
    }
    if (body.template_id !== undefined) {
      updateFields.push("template_id = ?");
      values.push(body.template_id);
    }
    if (body.energy_level_required !== undefined) {
      updateFields.push("energy_level_required = ?");
      values.push(body.energy_level_required);
    }
    if (body.task_type !== undefined) {
      updateFields.push("task_type = ?");
      values.push(body.task_type);
    }
    if (body.depends_on_task_id !== undefined) {
      updateFields.push("depends_on_task_id = ?");
      values.push(body.depends_on_task_id);
    }
    if (body.due_date !== undefined) {
      updateFields.push("due_date = ?");
      values.push(body.due_date);
    }
    if (body.ignored !== undefined) {
      updateFields.push("ignored = ?");
      values.push(body.ignored);
    }

    updateFields.push("updated_at = ?");
    values.push(now);

    values.push(id, session.user.id);

    await db.execute(
      `UPDATE tasks SET ${updateFields.join(", ")} WHERE id = ? AND user_id = ?`,
      values
    );

    // Propagate changes from parent task to subtasks
    // Only propagate if this is a parent task (not a subtask itself)
    if (!existingTask.parent_task_id) {
      const subtaskUpdateFields: string[] = [];
      const subtaskUpdateValues: any[] = [];

      // Priority should propagate to subtasks
      if (body.priority !== undefined) {
        subtaskUpdateFields.push("priority = ?");
        subtaskUpdateValues.push(body.priority);
      }

      // Energy level should propagate to subtasks
      if (body.energy_level_required !== undefined) {
        subtaskUpdateFields.push("energy_level_required = ?");
        subtaskUpdateValues.push(body.energy_level_required);
      }

      // Due date should propagate to subtasks (they should respect parent's deadline)
      if (body.due_date !== undefined) {
        subtaskUpdateFields.push("due_date = ?");
        subtaskUpdateValues.push(body.due_date);
      }

      // Group should propagate to subtasks (they inherit parent's group)
      if (body.group_id !== undefined) {
        subtaskUpdateFields.push("group_id = ?");
        subtaskUpdateValues.push(body.group_id);
      }

      // Update subtasks if any fields need propagation
      if (subtaskUpdateFields.length > 0) {
        subtaskUpdateFields.push("updated_at = ?");
        subtaskUpdateValues.push(now, id, session.user.id);

        await db.execute(
          `UPDATE tasks SET ${subtaskUpdateFields.join(", ")} WHERE parent_task_id = ? AND user_id = ?`,
          subtaskUpdateValues
        );
      }
    }

    // Handle parent-subtask completion logic
    if (body.status !== undefined) {
      // If this is a subtask being completed, check if parent should auto-complete
      if (body.status === "completed" && existingTask.parent_task_id) {
        await checkAndUpdateParentStatus(existingTask.parent_task_id, session.user.id);
      }

      // If this is a parent task being completed, complete all subtasks
      if (body.status === "completed" && !existingTask.parent_task_id) {
        await completeAllSubtasks(id, session.user.id);
      }

      // If this is a carryover task being completed, mark the original task as completed
      if (body.status === "completed" && existingTask.continued_from_task_id) {
        await checkAndCompleteOriginalTask(id, session.user.id);
      }
    }

    // Fetch updated task
    const result = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      session.user.id,
    ]);

    const task = mapRowToTask(result.rows[0]);

    return NextResponse.json({ task });
  } catch (error) {
    console.error("Error updating task:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/tasks/[id] - Delete a specific task
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    // Check if task exists and belongs to user
    const existingTaskResult = await db.execute(
      "SELECT * FROM tasks WHERE id = ? AND user_id = ?",
      [id, session.user.id]
    );

    if (existingTaskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const existingTask = mapRowToTask(existingTaskResult.rows[0]);

    // Get all subtask IDs before deletion (for UI refresh)
    const deletedTaskIds: string[] = [id];
    if (!existingTask.parent_task_id) {
      // This is a parent task - get all subtask IDs
      const subtasksResult = await db.execute(
        "SELECT id FROM tasks WHERE parent_task_id = ? AND user_id = ?",
        [id, session.user.id]
      );
      deletedTaskIds.push(...subtasksResult.rows.map((row) => row.id as string));
    }

    // Delete task (cascade will handle related records including subtasks)
    await db.execute("DELETE FROM tasks WHERE id = ? AND user_id = ?", [id, session.user.id]);

    return NextResponse.json({
      message: "Task deleted successfully",
      deleted_task_ids: deletedTaskIds,
    });
  } catch (error) {
    console.error("Error deleting task:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
