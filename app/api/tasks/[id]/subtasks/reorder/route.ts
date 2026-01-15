import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
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
    step_order:
      row.step_order !== null && row.step_order !== undefined ? Number(row.step_order) : null,
    ignored: Boolean(row.ignored ?? false),
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// PUT /api/tasks/[id]/subtasks/reorder - Reorder subtasks
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: parentId } = await params;
    const body = await request.json();
    const { subtaskIds } = body as { subtaskIds: string[] };

    if (!Array.isArray(subtaskIds)) {
      return NextResponse.json({ error: "subtaskIds must be an array" }, { status: 400 });
    }

    // Verify parent task exists and belongs to user
    const parentResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      parentId,
      session.user.id,
    ]);

    if (parentResult.rows.length === 0) {
      return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
    }

    // Verify all subtask IDs belong to this parent and user
    if (subtaskIds.length > 0) {
      const placeholders = subtaskIds.map(() => "?").join(",");
      const subtasksResult = await db.execute(
        `SELECT id FROM tasks WHERE id IN (${placeholders}) AND parent_task_id = ? AND user_id = ?`,
        [...subtaskIds, parentId, session.user.id]
      );

      if (subtasksResult.rows.length !== subtaskIds.length) {
        return NextResponse.json(
          { error: "One or more subtasks not found or do not belong to this parent task" },
          { status: 400 }
        );
      }
    }

    // Update step_order for each subtask based on array index
    const now = new Date().toISOString();
    for (let i = 0; i < subtaskIds.length; i++) {
      await db.execute(
        `UPDATE tasks SET step_order = ?, updated_at = ? WHERE id = ? AND parent_task_id = ? AND user_id = ?`,
        [i + 1, now, subtaskIds[i], parentId, session.user.id]
      );
    }

    // Fetch updated subtasks in new order
    const result = await db.execute(
      `SELECT * FROM tasks WHERE parent_task_id = ? ORDER BY step_order ASC, created_at ASC`,
      [parentId]
    );

    const subtasks = result.rows.map(mapRowToTask);

    return NextResponse.json({ subtasks }, { status: 200 });
  } catch (error) {
    console.error("Error reordering subtasks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
