import {
  decodePushActionToken,
  type ReminderEntityType,
  type ReminderNotificationAction,
  snoozeMinutesForAction,
} from "@/lib/push-action-token";
import {
  checkAndCompleteOriginalTask,
  checkAndUpdateParentStatus,
  completeAllSubtasks,
} from "@/lib/task-completion";
import { db } from "@/lib/turso";

export type ReminderActionErrorCode = "invalid" | "unauthorized" | "not_found" | "missing_token";

export type ReminderActionSuccess = {
  ok: true;
  action: ReminderNotificationAction;
  entityType: ReminderEntityType;
  taskTitle?: string;
  alreadyCompleted?: boolean;
  minutes?: number;
  message?: string;
};

export type ReminderActionFailure = {
  ok: false;
  error: ReminderActionErrorCode;
};

export type ReminderActionOutcome = ReminderActionSuccess | ReminderActionFailure;

interface TaskRow {
  user_id: string;
  title: string;
  status: string;
  parent_task_id: string | null;
  continued_from_task_id: string | null;
}

async function loadTask(taskId: string): Promise<TaskRow | null> {
  const taskResult = await db.execute({
    sql: `SELECT user_id, title, status, parent_task_id, continued_from_task_id
          FROM tasks WHERE id = ?`,
    args: [taskId],
  });

  if (taskResult.rows.length === 0) {
    return null;
  }

  const row = taskResult.rows[0];
  return {
    user_id: row.user_id as string,
    title: row.title as string,
    status: row.status as string,
    parent_task_id: (row.parent_task_id as string | null) ?? null,
    continued_from_task_id: (row.continued_from_task_id as string | null) ?? null,
  };
}

async function verifySubscription(userId: string, subscriptionId?: string): Promise<boolean> {
  if (!subscriptionId) {
    return true;
  }

  const result = await db.execute({
    sql: "SELECT id FROM push_subscriptions WHERE id = ? AND user_id = ? AND is_active = 1",
    args: [subscriptionId, userId],
  });
  return result.rows.length > 0;
}

async function executeComplete(
  taskId: string,
  userId: string
): Promise<ReminderActionSuccess | ReminderActionFailure> {
  const task = await loadTask(taskId);
  if (!task) {
    return { ok: false, error: "not_found" };
  }

  if (task.user_id !== userId) {
    return { ok: false, error: "unauthorized" };
  }

  if (task.status === "completed") {
    return {
      ok: true,
      action: "complete",
      entityType: "task-critical",
      taskTitle: task.title,
      alreadyCompleted: true,
      message: `"${task.title}" was already marked as done.`,
    };
  }

  await db.execute({
    sql: `UPDATE tasks
          SET status = 'completed',
              critical_reminder_snoozed_until = NULL,
              critical_reminder_last_sent_at = NULL,
              updated_at = datetime('now')
          WHERE id = ?`,
    args: [taskId],
  });

  if (task.parent_task_id) {
    await checkAndUpdateParentStatus(task.parent_task_id, userId);
  } else {
    await completeAllSubtasks(taskId, userId);
  }

  if (task.continued_from_task_id) {
    await checkAndCompleteOriginalTask(taskId, userId);
  }

  return {
    ok: true,
    action: "complete",
    entityType: "task-critical",
    taskTitle: task.title,
    alreadyCompleted: false,
    message: `"${task.title}" has been marked as complete.`,
  };
}

async function executeSnooze(
  taskId: string,
  userId: string
): Promise<ReminderActionSuccess | ReminderActionFailure> {
  const task = await loadTask(taskId);
  if (!task) {
    return { ok: false, error: "not_found" };
  }

  if (task.user_id !== userId) {
    return { ok: false, error: "unauthorized" };
  }

  const minutes = snoozeMinutesForAction("snooze");
  await db.execute({
    sql: `UPDATE tasks SET critical_reminder_snoozed_until = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`,
    args: [`+${minutes} minutes`, taskId],
  });

  return {
    ok: true,
    action: "snooze",
    entityType: "task-critical",
    taskTitle: task.title,
    minutes,
    message: `Critical reminders paused for ${minutes} minutes.`,
  };
}

export async function performReminderActionFromToken(
  token: string | null | undefined
): Promise<ReminderActionOutcome> {
  if (!token) {
    return { ok: false, error: "missing_token" };
  }

  const payload = decodePushActionToken(token);
  if (!payload) {
    return { ok: false, error: "invalid" };
  }

  const subscriptionOk = await verifySubscription(payload.userId, payload.subscriptionId);
  if (!subscriptionOk) {
    return { ok: false, error: "unauthorized" };
  }

  if (payload.entityType === "test") {
    return {
      ok: true,
      action: payload.action,
      entityType: "test",
      message:
        payload.action === "complete" ? "Done reached the server." : "Snooze reached the server.",
    };
  }

  if (payload.action === "complete") {
    return executeComplete(payload.entityId, payload.userId);
  }

  return executeSnooze(payload.entityId, payload.userId);
}

/** @deprecated Use performReminderActionFromToken */
export async function executePushComplete(token: string | null) {
  const outcome = await performReminderActionFromToken(token);
  if (!outcome.ok) {
    const errorMap: Record<ReminderActionErrorCode, string> = {
      missing_token: "missing_token",
      invalid: "invalid_token",
      unauthorized: "forbidden",
      not_found: "task_not_found",
    };
    return { ok: false as const, error: errorMap[outcome.error] as "missing_token" };
  }
  return {
    ok: true as const,
    taskTitle: outcome.taskTitle,
    alreadyCompleted: outcome.alreadyCompleted,
  };
}

/** @deprecated Use performReminderActionFromToken */
export async function executePushSnooze(token: string | null) {
  const outcome = await performReminderActionFromToken(token);
  if (!outcome.ok) {
    return { ok: false as const, error: "invalid_token" as const };
  }
  return {
    ok: true as const,
    minutes: outcome.minutes,
    taskTitle: outcome.taskTitle,
  };
}
