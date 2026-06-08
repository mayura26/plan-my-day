import { db } from "@/lib/turso";

export async function checkAndUpdateParentStatus(
  parentTaskId: string,
  userId: string
): Promise<void> {
  const subtasksResult = await db.execute(
    `SELECT status FROM tasks WHERE parent_task_id = ? AND user_id = ?`,
    [parentTaskId, userId]
  );

  if (subtasksResult.rows.length === 0) return;

  const allCompleted = subtasksResult.rows.every((row) => row.status === "completed");

  if (allCompleted) {
    const now = new Date().toISOString();
    await db.execute(
      `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`,
      [now, parentTaskId, userId]
    );
  }
}

export async function completeAllSubtasks(parentTaskId: string, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await db.execute(
    `UPDATE tasks SET status = 'completed', updated_at = ? WHERE parent_task_id = ? AND user_id = ? AND status != 'completed'`,
    [now, parentTaskId, userId]
  );
}

export async function checkAndCompleteOriginalTask(
  carryoverTaskId: string,
  userId: string
): Promise<void> {
  const carryoverResult = await db.execute(
    `SELECT continued_from_task_id FROM tasks WHERE id = ? AND user_id = ?`,
    [carryoverTaskId, userId]
  );

  if (carryoverResult.rows.length === 0) return;
  const originalTaskId = carryoverResult.rows[0].continued_from_task_id as string | null;

  if (!originalTaskId) return;

  const now = new Date().toISOString();
  await db.execute(
    `UPDATE tasks SET status = 'completed', updated_at = ? WHERE id = ? AND user_id = ?`,
    [now, originalTaskId, userId]
  );
}
