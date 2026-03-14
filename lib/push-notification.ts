import webpush from "web-push";

// Initialize web-push with VAPID keys
// Following reference implementation: simple mailto: or https:// subject
export function initializePushNotifications(): void {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:your-email@example.com";

  if (!publicKey || !privateKey) {
    console.warn("VAPID keys not configured. Push notifications will not work.");
    return;
  }

  webpush.setVapidDetails(subject, publicKey, privateKey);
}

export interface PushSubscription {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface NotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  tag?: string;
  data?: unknown;
  actions?: Array<{
    action: string;
    title: string;
    icon?: string;
  }>;
  requireInteraction?: boolean;
  vibrate?: number[];
  renotify?: boolean;
  priority?: number;
}

export function getNotificationUrgency(priority: number) {
  if (priority === 1)
    return {
      titlePrefix: "🔴 URGENT: ",
      vibrate: [100, 50, 100, 50, 100, 50, 100],
      requireInteraction: true,
      renotify: true,
      webpushUrgency: "high" as const,
      ttl: 0,
    };
  if (priority === 2)
    return {
      titlePrefix: "⚠️ ",
      vibrate: [200, 100, 200, 100, 200],
      requireInteraction: true,
      renotify: false,
      webpushUrgency: "high" as const,
      ttl: 300,
    };
  if (priority >= 4)
    return {
      titlePrefix: "",
      vibrate: [100],
      requireInteraction: false,
      renotify: false,
      webpushUrgency: "normal" as const,
      ttl: 3600,
    };
  // priority 3 — default
  return {
    titlePrefix: "",
    vibrate: [200, 100, 200],
    requireInteraction: false,
    renotify: false,
    webpushUrgency: "normal" as const,
    ttl: 3600,
  };
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: NotificationPayload
): Promise<void> {
  try {
    initializePushNotifications();
    const urgency = payload.priority != null ? getNotificationUrgency(payload.priority) : null;
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || "/web-app-manifest-192x192.png",
        badge: payload.badge || "/badge-icon.svg",
        tag: payload.tag,
        data: payload.data,
        actions: payload.actions,
        requireInteraction: payload.requireInteraction,
        vibrate: payload.vibrate,
        renotify: payload.renotify,
      }),
      {
        TTL: urgency?.ttl ?? 3600,
        urgency: urgency?.webpushUrgency ?? "normal",
      }
    );
  } catch (error) {
    console.error("Error sending push notification:", error);
    throw error;
  }
}

export function createTaskReminderPayload(
  taskTitle: string,
  taskId: string,
  minutesUntil: number,
  priority?: number
): NotificationPayload {
  const urgency = priority != null ? getNotificationUrgency(priority) : null;
  return {
    title: `${urgency?.titlePrefix ?? ""}Task Reminder: ${taskTitle}`,
    body: `Your task starts in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}`,
    tag: `task-${taskId}`,
    icon: "/web-app-manifest-192x192.png",
    data: {
      type: "task-reminder",
      taskId,
      url: `/tasks?task=${taskId}`,
    },
    actions: [
      {
        action: "view",
        title: "View Task",
      },
      {
        action: "snooze",
        title: "Snooze 5 min",
      },
    ],
    ...(urgency && {
      requireInteraction: urgency.requireInteraction,
      renotify: urgency.renotify,
      vibrate: urgency.vibrate,
    }),
    priority,
  };
}

export function createLeadReminderPayload(
  taskTitle: string,
  taskId: string,
  minutesUntil: number,
  priority?: number
): NotificationPayload {
  const urgency = priority != null ? getNotificationUrgency(priority) : null;
  return {
    title: `${urgency?.titlePrefix ?? ""}Starting soon: ${taskTitle}`,
    body: `Starts in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}`,
    tag: `task-${taskId}-lead`,
    icon: "/web-app-manifest-192x192.png",
    data: {
      type: "task-lead-reminder",
      taskId,
      url: `/tasks?task=${taskId}`,
    },
    actions: [
      { action: "view", title: "View Task" },
      { action: "snooze", title: "Snooze 5 min" },
    ],
    ...(urgency && {
      requireInteraction: urgency.requireInteraction,
      renotify: urgency.renotify,
      vibrate: urgency.vibrate,
    }),
    priority,
  };
}

export function createOnTimeReminderPayload(
  taskTitle: string,
  taskId: string,
  priority?: number
): NotificationPayload {
  const urgency = priority != null ? getNotificationUrgency(priority) : null;
  return {
    title: `${urgency?.titlePrefix ?? ""}Starting now: ${taskTitle}`,
    body: "Your task is starting now",
    tag: `task-${taskId}-ontime`,
    icon: "/web-app-manifest-192x192.png",
    data: {
      type: "task-ontime-reminder",
      taskId,
      url: `/tasks?task=${taskId}`,
    },
    actions: [
      { action: "view", title: "View Task" },
      { action: "snooze", title: "Snooze 5 min" },
    ],
    ...(urgency && {
      requireInteraction: urgency.requireInteraction,
      renotify: urgency.renotify,
      vibrate: urgency.vibrate,
    }),
    priority,
  };
}

export function createDueReminderPayload(
  taskTitle: string,
  taskId: string,
  minutesUntil: number,
  priority?: number
): NotificationPayload {
  const urgency = priority != null ? getNotificationUrgency(priority) : null;
  return {
    title: `${urgency?.titlePrefix ?? ""}Due soon: ${taskTitle}`,
    body: `Due in ${minutesUntil} minute${minutesUntil !== 1 ? "s" : ""}`,
    tag: `task-${taskId}-due`,
    icon: "/web-app-manifest-192x192.png",
    data: {
      type: "task-due-reminder",
      taskId,
      url: `/tasks?task=${taskId}`,
    },
    actions: [
      { action: "view", title: "View Task" },
      { action: "snooze", title: "Snooze 5 min" },
    ],
    ...(urgency && {
      requireInteraction: urgency.requireInteraction,
      renotify: urgency.renotify,
      vibrate: urgency.vibrate,
    }),
    priority,
  };
}

export function createUpdateAvailablePayload(url?: string): NotificationPayload {
  return {
    title: "Update Available",
    body: "A new version of Plan My Day is available. Click to update.",
    tag: "app-update",
    icon: "/web-app-manifest-192x192.png",
    data: {
      type: "app-update",
      url: url || "/",
    },
    requireInteraction: true,
  };
}
