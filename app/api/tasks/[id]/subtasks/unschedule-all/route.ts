import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/turso";

// POST /api/tasks/[id]/subtasks/unschedule-all - Unschedule all incomplete subtasks
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: parentTaskId } = await params;

    // Verify parent task exists and belongs to user
    const parentResult = await db.execute("SELECT id FROM tasks WHERE id = ? AND user_id = ?", [
      parentTaskId,
      session.user.id,
    ]);

    if (parentResult.rows.length === 0) {
      return NextResponse.json({ error: "Parent task not found" }, { status: 404 });
    }

    // Fetch incomplete subtasks that have scheduled times
    const subtasksResult = await db.execute(
      `SELECT id FROM tasks 
       WHERE parent_task_id = ? AND user_id = ? 
       AND status != 'completed' 
       AND (scheduled_start IS NOT NULL OR scheduled_end IS NOT NULL)`,
      [parentTaskId, session.user.id]
    );

    const unscheduledIds: string[] = [];
    const now = new Date().toISOString();

    for (const row of subtasksResult.rows) {
      const subtaskId = row.id as string;
      await db.execute(
        `UPDATE tasks SET scheduled_start = NULL, scheduled_end = NULL, updated_at = ? 
         WHERE id = ? AND user_id = ?`,
        [now, subtaskId, session.user.id]
      );
      unscheduledIds.push(subtaskId);
    }

    return NextResponse.json({
      unscheduledCount: unscheduledIds.length,
      unscheduledIds,
    });
  } catch (error) {
    console.error("Error unscheduling subtasks:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
