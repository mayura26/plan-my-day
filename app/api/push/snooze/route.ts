import { type NextRequest, NextResponse } from "next/server";
import {
  decodePushActionToken,
  type PushActionType,
  snoozeMinutesForAction,
} from "@/lib/push-action-token";
import { db } from "@/lib/turso";

function sqliteSnoozeModifier(action: PushActionType): string {
  const m = snoozeMinutesForAction(action);
  return `+${m} minutes`;
}

/**
 * One-click snooze from push notification (signed token, no session).
 * Redirects to the task after updating the DB.
 */
export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return NextResponse.redirect(new URL("/settings", request.url));
  }

  const payload = decodePushActionToken(token);
  if (!payload) {
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

  const modifier = sqliteSnoozeModifier(payload.action);
  await db.execute({
    sql: `UPDATE tasks SET critical_reminder_snoozed_until = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`,
    args: [modifier, payload.taskId],
  });

  const dest = new URL(`/tasks`, request.url);
  dest.searchParams.set("task", payload.taskId);
  dest.searchParams.set("snoozed", "1");
  return NextResponse.redirect(dest);
}
