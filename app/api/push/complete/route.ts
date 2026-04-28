import { type NextRequest, NextResponse } from "next/server";
import { decodePushActionToken } from "@/lib/push-action-token";
import { db } from "@/lib/turso";

/**
 * One-click complete from push notification (signed token, no session).
 * Redirects to the task list after updating the DB.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/settings", request.url));
  }

  const payload = decodePushActionToken(token);
  if (!payload || payload.action !== "complete") {
    return NextResponse.redirect(new URL("/settings", request.url));
  }

  const taskResult = await db.execute({
    sql: "SELECT user_id FROM tasks WHERE id = ?",
    args: [payload.taskId],
  });

  if (taskResult.rows.length === 0) {
    return NextResponse.redirect(new URL("/tasks", request.url));
  }

  const ownerId = taskResult.rows[0].user_id as string;
  if (ownerId !== payload.userId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 403 });
  }

  await db.execute({
    sql: `UPDATE tasks
          SET status = 'completed',
              completed_at = datetime('now'),
              critical_reminder_snoozed_until = NULL,
              critical_reminder_last_sent_at = NULL,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [payload.taskId],
  });

  const dest = new URL("/tasks", request.url);
  dest.searchParams.set("task", payload.taskId);
  dest.searchParams.set("completed", "1");
  return NextResponse.redirect(dest);
}
