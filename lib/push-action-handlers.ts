import {
  decodePushActionToken,
  type PushActionType,
  snoozeMinutesForAction,
} from "@/lib/push-action-token";
import {
  checkAndCompleteOriginalTask,
  checkAndUpdateParentStatus,
  completeAllSubtasks,
} from "@/lib/task-completion";
import { db } from "@/lib/turso";

export type PushActionError = "missing_token" | "invalid_token" | "task_not_found" | "forbidden";

export interface PushCompleteResult {
  ok: boolean;
  taskTitle?: string;
  alreadyCompleted?: boolean;
  error?: PushActionError;
}

export interface PushSnoozeResult {
  ok: boolean;
  minutes?: number;
  taskTitle?: string;
  error?: PushActionError;
}

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

function sqliteSnoozeModifier(action: PushActionType): string {
  const m = snoozeMinutesForAction(action);
  return `+${m} minutes`;
}

export async function executePushComplete(token: string | null): Promise<PushCompleteResult> {
  if (!token) {
    return { ok: false, error: "missing_token" };
  }

  const payload = decodePushActionToken(token);
  if (!payload || payload.action !== "complete") {
    return { ok: false, error: "invalid_token" };
  }

  const task = await loadTask(payload.taskId);
  if (!task) {
    return { ok: false, error: "task_not_found" };
  }

  if (task.user_id !== payload.userId) {
    return { ok: false, error: "forbidden" };
  }

  if (task.status === "completed") {
    return { ok: true, taskTitle: task.title, alreadyCompleted: true };
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

  if (task.parent_task_id) {
    await checkAndUpdateParentStatus(task.parent_task_id, payload.userId);
  } else {
    await completeAllSubtasks(payload.taskId, payload.userId);
  }

  if (task.continued_from_task_id) {
    await checkAndCompleteOriginalTask(payload.taskId, payload.userId);
  }

  return { ok: true, taskTitle: task.title, alreadyCompleted: false };
}

export async function executePushSnooze(token: string | null): Promise<PushSnoozeResult> {
  if (!token) {
    return { ok: false, error: "missing_token" };
  }

  const payload = decodePushActionToken(token);
  if (!payload || (payload.action !== "snooze15" && payload.action !== "snooze60")) {
    return { ok: false, error: "invalid_token" };
  }

  const task = await loadTask(payload.taskId);
  if (!task) {
    return { ok: false, error: "task_not_found" };
  }

  if (task.user_id !== payload.userId) {
    return { ok: false, error: "forbidden" };
  }

  const modifier = sqliteSnoozeModifier(payload.action);
  await db.execute({
    sql: `UPDATE tasks SET critical_reminder_snoozed_until = datetime('now', ?), updated_at = datetime('now') WHERE id = ?`,
    args: [modifier, payload.taskId],
  });

  return {
    ok: true,
    minutes: snoozeMinutesForAction(payload.action),
    taskTitle: task.title,
  };
}
