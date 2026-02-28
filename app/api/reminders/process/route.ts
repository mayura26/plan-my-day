import { type NextRequest, NextResponse } from "next/server";
import {
  createDueReminderPayload,
  createLeadReminderPayload,
  createOnTimeReminderPayload,
  type PushSubscription,
  sendPushNotification,
} from "@/lib/push-notification";
import { db } from "@/lib/turso";
import type { ReminderSettings } from "@/lib/types";

// POST /api/reminders/process
// Called every minute by a Coolify-managed cron job.
// Authorization: Bearer <CRON_SECRET>
export async function POST(request: NextRequest) {
  // --- Auth ---
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const nowMs = now.getTime();

  // Window boundaries (ISO strings for SQL comparisons)
  // We query tasks whose scheduled_start/due_date is within the next 2 hours
  // (to cover the maximum lead time), plus 2 minutes in the past to catch
  // tasks that fired slightly before the cron ran.
  const windowStart = new Date(nowMs - 2 * 60 * 1000).toISOString();
  const windowEnd = new Date(nowMs + 120 * 60 * 1000).toISOString();

  const results = {
    scheduled_tasks_checked: 0,
    due_tasks_checked: 0,
    notifications_sent: 0,
    errors: 0,
  };

  try {
    // ------------------------------------------------------------------
    // 1. SCHEDULED TASK REMINDERS (tasks with scheduled_start)
    // ------------------------------------------------------------------
    const scheduledResult = await db.execute(
      `
      SELECT t.*, tg.reminder_settings
      FROM tasks t
      JOIN task_groups tg ON t.group_id = tg.id
      WHERE t.scheduled_start IS NOT NULL
        AND t.scheduled_start >= ?
        AND t.scheduled_start <= ?
        AND t.status IN ('pending', 'in_progress')
        AND (t.notification_sent = 0 OR t.lead_reminder_sent = 0)
        AND t.group_id IS NOT NULL
      `,
      [windowStart, windowEnd]
    );

    results.scheduled_tasks_checked = scheduledResult.rows.length;

    // Track what needs updating: { taskId -> { lead?: true, ontime?: true } }
    const scheduledUpdates = new Map<string, { lead?: true; ontime?: true }>();
    // Collect notifications grouped by userId
    const pendingNotifications = new Map<
      string,
      Array<{ payload: ReturnType<typeof createLeadReminderPayload> }>
    >();

    const addNotification = (
      userId: string,
      payload: ReturnType<typeof createLeadReminderPayload>
    ) => {
      if (!pendingNotifications.has(userId)) {
        pendingNotifications.set(userId, []);
      }
      pendingNotifications.get(userId)?.push({ payload });
    };

    for (const row of scheduledResult.rows) {
      const taskId = row.id as string;
      const userId = row.user_id as string;
      const scheduledStart = row.scheduled_start as string;
      const notificationSent = Boolean(row.notification_sent);
      const leadReminderSent = Boolean(row.lead_reminder_sent);
      const title = row.title as string;
      const priority = row.priority as number;

      // Parse group reminder settings
      let settings: ReminderSettings | null = null;
      if (row.reminder_settings) {
        try {
          settings = JSON.parse(row.reminder_settings as string);
        } catch {
          // ignore bad JSON
        }
      }

      if (!settings?.enabled) continue;
      if (priority > settings.min_priority) continue;

      const scheduledMs = new Date(scheduledStart).getTime();
      const minutesUntil = (scheduledMs - nowMs) / 60_000;

      // Lead-time reminder
      if (settings.lead_time_minutes != null && !leadReminderSent) {
        const diff = minutesUntil - settings.lead_time_minutes;
        if (diff >= -1 && diff <= 1) {
          addNotification(
            userId,
            createLeadReminderPayload(title, taskId, Math.round(minutesUntil))
          );
          const entry = scheduledUpdates.get(taskId) ?? {};
          entry.lead = true;
          scheduledUpdates.set(taskId, entry);
        }
      }

      // On-time reminder
      if (settings.on_time_reminder && !notificationSent) {
        if (minutesUntil >= -1 && minutesUntil <= 1) {
          addNotification(userId, createOnTimeReminderPayload(title, taskId));
          const entry = scheduledUpdates.get(taskId) ?? {};
          entry.ontime = true;
          scheduledUpdates.set(taskId, entry);
        }
      }
    }

    // ------------------------------------------------------------------
    // 2. DUE DATE REMINDERS (unscheduled tasks with due_date)
    // ------------------------------------------------------------------
    const dueResult = await db.execute(
      `
      SELECT t.*, tg.reminder_settings
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
      [windowStart, windowEnd]
    );

    results.due_tasks_checked = dueResult.rows.length;

    const dueUpdates = new Set<string>();

    for (const row of dueResult.rows) {
      const taskId = row.id as string;
      const userId = row.user_id as string;
      const dueDate = row.due_date as string;
      const title = row.title as string;
      const priority = row.priority as number;

      let settings: ReminderSettings | null = null;
      if (row.reminder_settings) {
        try {
          settings = JSON.parse(row.reminder_settings as string);
        } catch {
          // ignore bad JSON
        }
      }

      if (!settings?.enabled) continue;
      if (priority > settings.min_priority) continue;
      if (settings.due_date_lead_minutes == null) continue;

      const dueMs = new Date(dueDate).getTime();
      const minutesUntil = (dueMs - nowMs) / 60_000;
      const diff = minutesUntil - settings.due_date_lead_minutes;

      if (diff >= -1 && diff <= 1) {
        addNotification(userId, createDueReminderPayload(title, taskId, Math.round(minutesUntil)));
        dueUpdates.add(taskId);
      }
    }

    // ------------------------------------------------------------------
    // 3. DELIVER NOTIFICATIONS
    // ------------------------------------------------------------------
    for (const [userId, notifications] of pendingNotifications) {
      // Fetch active push subscriptions for this user
      const subsResult = await db.execute(
        "SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE user_id = ? AND is_active = 1",
        [userId]
      );

      if (subsResult.rows.length === 0) continue;

      for (const notification of notifications) {
        for (const subRow of subsResult.rows) {
          const subscription: PushSubscription = {
            endpoint: subRow.endpoint as string,
            keys: {
              p256dh: subRow.p256dh_key as string,
              auth: subRow.auth_key as string,
            },
          };

          try {
            await sendPushNotification(subscription, notification.payload);
            results.notifications_sent++;
          } catch (err: unknown) {
            results.errors++;
            // Mark subscription inactive on 410 Gone or 404 Not Found
            const status =
              typeof err === "object" && err !== null && "statusCode" in err
                ? (err as { statusCode: number }).statusCode
                : null;
            if (status === 410 || status === 404) {
              await db.execute("UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?", [
                subRow.endpoint as string,
              ]);
            } else {
              console.error("Push notification error:", err);
            }
          }
        }
      }
    }

    // ------------------------------------------------------------------
    // 4. BATCH UPDATE SENT FLAGS
    // ------------------------------------------------------------------
    for (const [taskId, flags] of scheduledUpdates) {
      const setClauses: string[] = [];
      if (flags.lead) setClauses.push("lead_reminder_sent = 1");
      if (flags.ontime) setClauses.push("notification_sent = 1");
      if (setClauses.length > 0) {
        await db.execute(`UPDATE tasks SET ${setClauses.join(", ")} WHERE id = ?`, [taskId]);
      }
    }

    for (const taskId of dueUpdates) {
      await db.execute("UPDATE tasks SET due_reminder_sent = 1 WHERE id = ?", [taskId]);
    }

    return NextResponse.json({ ok: true, ...results });
  } catch (error) {
    console.error("Error processing reminders:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
