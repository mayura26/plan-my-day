import { type NextRequest, NextResponse } from "next/server";
import { mapRowToTask, requireApiUser } from "@/lib/external-api";
import {
  checkAndCompleteOriginalTask,
  checkAndUpdateParentStatus,
  completeAllSubtasks,
} from "@/lib/task-completion";
import { db } from "@/lib/turso";

/**
 * POST /api/tasks/[id]/complete
 * Mark a task completed (API key auth). Idempotent if already completed.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const authResult = await requireApiUser(_request);
    if (authResult.error) return authResult.error;
    const { userId } = authResult;

    const { id } = await params;

    const taskResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      userId,
    ]);

    if (taskResult.rows.length === 0) {
      return NextResponse.json({ error: "Task not found" }, { status: 404 });
    }

    const existing = mapRowToTask(taskResult.rows[0] as Record<string, unknown>);

    if (existing.status === "completed") {
      return NextResponse.json({ success: true, task: existing });
    }

    const now = new Date().toISOString();
    await db.execute(`UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`, [
      now,
      id,
      userId,
    ]);

    if (existing.parent_task_id) {
      await checkAndUpdateParentStatus(existing.parent_task_id, userId);
    } else {
      await completeAllSubtasks(id, userId);
    }

    if (existing.continued_from_task_id) {
      await checkAndCompleteOriginalTask(id, userId);
    }

    const updatedResult = await db.execute("SELECT * FROM tasks WHERE id = ? AND user_id = ?", [
      id,
      userId,
    ]);

    const task = mapRowToTask(updatedResult.rows[0] as Record<string, unknown>);
    return NextResponse.json({ success: true, task });
  } catch (error) {
    console.error("Error completing task via API:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
