import { buildSnoozeApiUrl } from "@/lib/push-action-token";
import {
  createCriticalNagPayload,
  createDueReminderPayload,
  createLeadReminderPayload,
  createOnTimeReminderPayload,
  type NotificationPayload,
  sendPushNotification,
} from "@/lib/push-notification";
import { db } from "@/lib/turso";

/** Match window in minutes — use 3 so a cron running every 1–5 minutes still catches reminders. */
const REMINDER_MATCH_WINDOW_MINUTES = 3;

function getAppBaseUrl(): string {
  const n = process.env.NEXTAUTH_URL?.replace(/\/$/, "");
  if (n) {
    return n;
  }
  const v = process.env.VERCEL_URL;
  if (v) {
    return `https://${v.replace(/^https?:\/\//, "")}`;
  }
  return "http://localhost:3000";
}

interface ReminderSettingsParsed {
  enabled?: boolean;
  min_priority?: number;
  lead_time_minutes?: number | null;
  on_time_reminder?: boolean;
  due_date_lead_minutes?: number | null;
}

export interface ProcessRemindersResult {
  scheduled_checked: number;
  due_checked: number;
  critical_checked: number;
  sent: number;
  errors: number;
}

interface PushSubscriptionRow {
  endpoint: string;
  p256dh_key: string;
  auth_key: string;
}

async function sendToUserSubscriptions(
  userId: string,
  payload: NotificationPayload,
  results: ProcessRemindersResult
): Promise<number> {
  const subsResult = await db.execute({
    sql: "SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE user_id = ? AND is_active = 1",
    args: [userId],
  });

  if (subsResult.rows.length === 0) {
    return 0;
  }

  let successCount = 0;
  for (const sub of subsResult.rows) {
    const row = sub as unknown as PushSubscriptionRow;
    const subscription = {
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh_key, auth: row.auth_key },
    };
    try {
      await sendPushNotification(subscription, payload);
      results.sent++;
      successCount++;
    } catch (err) {
      results.errors++;
      const status = (err as { statusCode?: number })?.statusCode ?? null;
      if (status === 410 || status === 404) {
        await db.execute({
          sql: "UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?",
          args: [row.endpoint],
        });
      } else {
        console.error("Push error:", (err as Error)?.message ?? err);
      }
    }
  }
  return successCount;
}

export async function processReminders(): Promise<ProcessRemindersResult> {
  const nowMs = Date.now();
  const windowStart = new Date(nowMs - 2 * 60 * 1000).toISOString();
  const windowEnd = new Date(nowMs + 120 * 60 * 1000).toISOString();
  const w = REMINDER_MATCH_WINDOW_MINUTES;

  const results: ProcessRemindersResult = {
    scheduled_checked: 0,
    due_checked: 0,
    critical_checked: 0,
    sent: 0,
    errors: 0,
  };

  const pending = new Map<string, NotificationPayload[]>();
  const addNotification = (userId: string, payload: NotificationPayload) => {
    const existing = pending.get(userId);
    if (existing) {
      existing.push(payload);
    } else {
      pending.set(userId, [payload]);
    }
  };

  const scheduledUpdates = new Map<string, { lead?: boolean; ontime?: boolean }>();
  const dueUpdates = new Set<string>();

  const scheduledResult = await db.execute({
    sql: `
      SELECT t.id, t.user_id, t.title, t.priority, t.scheduled_start,
             t.notification_sent, t.lead_reminder_sent, tg.reminder_settings
      FROM tasks t
      JOIN task_groups tg ON t.group_id = tg.id
      WHERE t.scheduled_start IS NOT NULL
        AND t.scheduled_start >= ?
        AND t.scheduled_start <= ?
        AND t.status IN ('pending', 'in_progress')
        AND (t.notification_sent = 0 OR t.lead_reminder_sent = 0)
        AND t.group_id IS NOT NULL
    `,
    args: [windowStart, windowEnd],
  });

  results.scheduled_checked = scheduledResult.rows.length;

  for (const row of scheduledResult.rows) {
    const taskId = row.id as string;
    const userId = row.user_id as string;
    const notificationSent = Boolean(row.notification_sent);
    const leadReminderSent = Boolean(row.lead_reminder_sent);
    const title = row.title as string;
    const priority = row.priority as number;

    let settings: ReminderSettingsParsed | null = null;
    try {
      if (row.reminder_settings) {
        settings = JSON.parse(row.reminder_settings as string);
      }
    } catch {
      /* ignore */
    }

    if (!settings?.enabled) {
      continue;
    }
    if (priority > (settings.min_priority ?? 5)) {
      continue;
    }

    const minutesUntil = (new Date(row.scheduled_start as string).getTime() - nowMs) / 60_000;

    if (settings.lead_time_minutes != null && !leadReminderSent) {
      const diff = minutesUntil - settings.lead_time_minutes;
      if (diff >= -w && diff <= w) {
        addNotification(
          userId,
          createLeadReminderPayload(title, taskId, Math.round(minutesUntil), priority)
        );
        const entry = scheduledUpdates.get(taskId) ?? {};
        entry.lead = true;
        scheduledUpdates.set(taskId, entry);
      }
    }

    if (settings.on_time_reminder && !notificationSent) {
      if (minutesUntil >= -w && minutesUntil <= w) {
        addNotification(userId, createOnTimeReminderPayload(title, taskId, priority));
        const entry = scheduledUpdates.get(taskId) ?? {};
        entry.ontime = true;
        scheduledUpdates.set(taskId, entry);
      }
    }
  }

  const dueResult = await db.execute({
    sql: `
      SELECT t.id, t.user_id, t.title, t.priority, t.due_date, tg.reminder_settings
      FROM tasks t
      JOIN task_groups tg ON t.group_id = tg.id
      WHERE t.scheduled_start IS NULL
        AND t.due_date IS NOT NULL
        AND t.due_date >= ?
        AND t.due_date <= ?
        AND t.status IN ('pending', 'in_progress')
        AND t.due_reminder_sent = 0
        AND t.group_id IS NOT NULL
    `,
    args: [windowStart, windowEnd],
  });

  results.due_checked = dueResult.rows.length;

  for (const row of dueResult.rows) {
    const taskId = row.id as string;
    const userId = row.user_id as string;
    const title = row.title as string;
    const priority = row.priority as number;

    let settings: ReminderSettingsParsed | null = null;
    try {
      if (row.reminder_settings) {
        settings = JSON.parse(row.reminder_settings as string);
      }
    } catch {
      /* ignore */
    }

    if (!settings?.enabled) {
      continue;
    }
    if (priority > (settings.min_priority ?? 5)) {
      continue;
    }
    if (settings.due_date_lead_minutes == null) {
      continue;
    }

    const minutesUntil = (new Date(row.due_date as string).getTime() - nowMs) / 60_000;
    const diff = minutesUntil - settings.due_date_lead_minutes;

    if (diff >= -w && diff <= w) {
      addNotification(
        userId,
        createDueReminderPayload(title, taskId, Math.round(minutesUntil), priority)
      );
      dueUpdates.add(taskId);
    }
  }

  for (const [userId, payloads] of pending) {
    for (const payload of payloads) {
      await sendToUserSubscriptions(userId, payload, results);
    }
  }

  for (const [taskId, flags] of scheduledUpdates) {
    const setClauses: string[] = [];
    if (flags.lead) {
      setClauses.push("lead_reminder_sent = 1");
    }
    if (flags.ontime) {
      setClauses.push("notification_sent = 1");
    }
    if (setClauses.length > 0) {
      await db.execute({
        sql: `UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?`,
        args: [taskId],
      });
    }
  }

  for (const taskId of dueUpdates) {
    await db.execute({
      sql: "UPDATE tasks SET due_reminder_sent = 1 WHERE id = ?",
      args: [taskId],
    });
  }

  const baseUrl = getAppBaseUrl();

  const criticalResult = await db.execute({
    sql: `
      SELECT t.id, t.user_id, t.title, t.priority, t.scheduled_start, t.due_date,
             t.critical_reminder_snoozed_until, t.critical_reminder_last_sent_at,
             tg.reminder_settings,
             COALESCE(u.critical_reminder_enabled, 1) AS critical_reminder_enabled,
             COALESCE(u.critical_reminder_interval_minutes, 15) AS critical_reminder_interval_minutes
      FROM tasks t
      JOIN task_groups tg ON t.group_id = tg.id
      JOIN users u ON t.user_id = u.id
      WHERE t.priority = 1
        AND t.status IN ('pending', 'in_progress')
        AND t.group_id IS NOT NULL
        AND COALESCE(u.critical_reminder_enabled, 1) = 1
    `,
  });

  results.critical_checked = criticalResult.rows.length;

  for (const row of criticalResult.rows) {
    const taskId = row.id as string;
    const userId = row.user_id as string;
    const title = row.title as string;
    const scheduledStart = row.scheduled_start as string | null;
    const dueDate = row.due_date as string | null;
    const snoozedUntil = row.critical_reminder_snoozed_until as string | null;
    const lastSent = row.critical_reminder_last_sent_at as string | null;
    const intervalMinutes = Math.max(
      1,
      Math.min(120, Number(row.critical_reminder_interval_minutes) || 15)
    );

    let settings: ReminderSettingsParsed | null = null;
    try {
      if (row.reminder_settings) {
        settings = JSON.parse(row.reminder_settings as string);
      }
    } catch {
      /* ignore */
    }

    if (!settings?.enabled) {
      continue;
    }
    if (1 > (settings.min_priority ?? 5)) {
      continue;
    }

    if (snoozedUntil) {
      const snoozeEnd = new Date(snoozedUntil).getTime();
      if (nowMs < snoozeEnd) {
        continue;
      }
    }

    let isLate = false;
    if (scheduledStart) {
      isLate = new Date(scheduledStart).getTime() < nowMs;
    } else if (dueDate) {
      isLate = new Date(dueDate).getTime() < nowMs;
    } else {
      continue;
    }

    if (!isLate) {
      continue;
    }

    const intervalMs = intervalMinutes * 60 * 1000;
    if (lastSent) {
      const last = new Date(lastSent).getTime();
      if (nowMs - last < intervalMs) {
        continue;
      }
    }

    const snoozeUrl15 = buildSnoozeApiUrl(baseUrl, taskId, userId, "snooze15");
    const snoozeUrl60 = buildSnoozeApiUrl(baseUrl, taskId, userId, "snooze60");
    const payload = createCriticalNagPayload(title, taskId, snoozeUrl15, snoozeUrl60, 1);
    const n = await sendToUserSubscriptions(userId, payload, results);
    if (n > 0) {
      await db.execute({
        sql: `UPDATE tasks SET critical_reminder_last_sent_at = datetime('now') WHERE id = ?`,
        args: [taskId],
      });
    }
  }

  console.log(
    `[reminders] scheduled=${results.scheduled_checked} due=${results.due_checked} critical=${results.critical_checked} sent=${results.sent} errors=${results.errors}`
  );

  return results;
}
