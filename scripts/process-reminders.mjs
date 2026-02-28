import { createClient } from "@libsql/client";
import dotenv from "dotenv";
import webpush from "web-push";

dotenv.config({ path: ".env.local" });

const db = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

// --- VAPID setup ---
const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
const vapidSubject = process.env.VAPID_SUBJECT || "mailto:your-email@example.com";

if (!vapidPublic || !vapidPrivate) {
  console.error("❌ VAPID keys not configured. Exiting.");
  process.exit(1);
}

webpush.setVapidDetails(vapidSubject, vapidPublic, vapidPrivate);

// --- Notification payload builders ---
function leadPayload(title, taskId, minutesUntil) {
  return {
    title: `Starting soon: ${title}`,
    body: `Starts in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}`,
    tag: `task-${taskId}-lead`,
    icon: "/web-app-manifest-192x192.png",
    data: { type: "task-lead-reminder", taskId, url: `/tasks?task=${taskId}` },
    actions: [
      { action: "view", title: "View Task" },
      { action: "snooze", title: "Snooze 5 min" },
    ],
  };
}

function onTimePayload(title, taskId) {
  return {
    title: `Starting now: ${title}`,
    body: "Your task is starting now",
    tag: `task-${taskId}-ontime`,
    icon: "/web-app-manifest-192x192.png",
    data: { type: "task-ontime-reminder", taskId, url: `/tasks?task=${taskId}` },
    actions: [
      { action: "view", title: "View Task" },
      { action: "snooze", title: "Snooze 5 min" },
    ],
  };
}

function duePayload(title, taskId, minutesUntil) {
  return {
    title: `Due soon: ${title}`,
    body: `Due in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}`,
    tag: `task-${taskId}-due`,
    icon: "/web-app-manifest-192x192.png",
    data: { type: "task-due-reminder", taskId, url: `/tasks?task=${taskId}` },
    actions: [
      { action: "view", title: "View Task" },
      { action: "snooze", title: "Snooze 5 min" },
    ],
  };
}

async function sendNotification(subscription, payload) {
  await webpush.sendNotification(subscription, JSON.stringify(payload));
}

// --- Main ---
async function processReminders() {
  const nowMs = Date.now();
  const windowStart = new Date(nowMs - 2 * 60 * 1000).toISOString();
  const windowEnd = new Date(nowMs + 120 * 60 * 1000).toISOString();

  const results = { scheduled_checked: 0, due_checked: 0, sent: 0, errors: 0 };

  // Notifications queued per user: userId -> [payload, ...]
  const pending = new Map();
  const addNotification = (userId, payload) => {
    if (!pending.has(userId)) pending.set(userId, []);
    pending.get(userId).push(payload);
  };

  // Flags to batch-write back to the DB
  const scheduledUpdates = new Map(); // taskId -> { lead?, ontime? }
  const dueUpdates = new Set(); // taskId

  // ------------------------------------------------------------------
  // 1. SCHEDULED TASK REMINDERS
  // ------------------------------------------------------------------
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
    const taskId = row.id;
    const userId = row.user_id;
    const notificationSent = Boolean(row.notification_sent);
    const leadReminderSent = Boolean(row.lead_reminder_sent);
    const title = row.title;
    const priority = row.priority;

    let settings = null;
    try {
      if (row.reminder_settings) settings = JSON.parse(row.reminder_settings);
    } catch {
      /* ignore */
    }

    if (!settings?.enabled) continue;
    if (priority > settings.min_priority) continue;

    const minutesUntil = (new Date(row.scheduled_start).getTime() - nowMs) / 60_000;

    // Lead-time reminder
    if (settings.lead_time_minutes != null && !leadReminderSent) {
      const diff = minutesUntil - settings.lead_time_minutes;
      if (diff >= -1 && diff <= 1) {
        addNotification(userId, leadPayload(title, taskId, Math.round(minutesUntil)));
        const entry = scheduledUpdates.get(taskId) ?? {};
        entry.lead = true;
        scheduledUpdates.set(taskId, entry);
      }
    }

    // On-time reminder
    if (settings.on_time_reminder && !notificationSent) {
      if (minutesUntil >= -1 && minutesUntil <= 1) {
        addNotification(userId, onTimePayload(title, taskId));
        const entry = scheduledUpdates.get(taskId) ?? {};
        entry.ontime = true;
        scheduledUpdates.set(taskId, entry);
      }
    }
  }

  // ------------------------------------------------------------------
  // 2. DUE DATE REMINDERS (unscheduled tasks)
  // ------------------------------------------------------------------
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
    const taskId = row.id;
    const userId = row.user_id;
    const title = row.title;
    const priority = row.priority;

    let settings = null;
    try {
      if (row.reminder_settings) settings = JSON.parse(row.reminder_settings);
    } catch {
      /* ignore */
    }

    if (!settings?.enabled) continue;
    if (priority > settings.min_priority) continue;
    if (settings.due_date_lead_minutes == null) continue;

    const minutesUntil = (new Date(row.due_date).getTime() - nowMs) / 60_000;
    const diff = minutesUntil - settings.due_date_lead_minutes;

    if (diff >= -1 && diff <= 1) {
      addNotification(userId, duePayload(title, taskId, Math.round(minutesUntil)));
      dueUpdates.add(taskId);
    }
  }

  // ------------------------------------------------------------------
  // 3. DELIVER NOTIFICATIONS
  // ------------------------------------------------------------------
  for (const [userId, payloads] of pending) {
    const subsResult = await db.execute({
      sql: "SELECT endpoint, p256dh_key, auth_key FROM push_subscriptions WHERE user_id = ? AND is_active = 1",
      args: [userId],
    });

    if (subsResult.rows.length === 0) continue;

    for (const payload of payloads) {
      for (const sub of subsResult.rows) {
        const subscription = {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh_key, auth: sub.auth_key },
        };
        try {
          await sendNotification(subscription, payload);
          results.sent++;
        } catch (err) {
          results.errors++;
          const status = err?.statusCode ?? null;
          if (status === 410 || status === 404) {
            await db.execute({
              sql: "UPDATE push_subscriptions SET is_active = 0 WHERE endpoint = ?",
              args: [sub.endpoint],
            });
          } else {
            console.error("Push error:", err?.message ?? err);
          }
        }
      }
    }
  }

  // ------------------------------------------------------------------
  // 4. WRITE BACK SENT FLAGS
  // ------------------------------------------------------------------
  for (const [taskId, flags] of scheduledUpdates) {
    const setClauses = [];
    if (flags.lead) setClauses.push("lead_reminder_sent = 1");
    if (flags.ontime) setClauses.push("notification_sent = 1");
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

  console.log(
    `[reminders] scheduled=${results.scheduled_checked} due=${results.due_checked} sent=${results.sent} errors=${results.errors}`
  );
}

processReminders().catch((err) => {
  console.error("❌ process-reminders failed:", err);
  process.exit(1);
});
