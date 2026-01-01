import webpush from "web-push";

// Initialize web-push with VAPID keys
export function initializePushNotifications(): void {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  let subject = process.env.VAPID_SUBJECT;

  if (!publicKey || !privateKey || !subject) {
    console.warn(
      "VAPID keys not configured. Push notifications will not work."
    );
    return;
  }

  // Validate and fix VAPID_SUBJECT format
  // web-push requires either https:// or mailto: URL
  if (subject.startsWith("http://")) {
    // Convert http:// to https:// for localhost development
    if (subject.includes("localhost") || subject.includes("127.0.0.1")) {
      subject = subject.replace("http://", "https://");
      console.warn(
        `VAPID_SUBJECT was http://, converted to https:// for localhost. ` +
        `Note: For local development with HTTPS, use: next dev --experimental-https`
      );
    } else {
      throw new Error(
        `VAPID_SUBJECT must be an https:// URL or mailto: link. ` +
        `Current value: ${subject}. ` +
        `For production, use: https://your-domain.com. ` +
        `For development, use: mailto:your-email@example.com or https://localhost:3000 (with HTTPS enabled)`
      );
    }
  }

  // Validate final format
  if (!subject.startsWith("https://") && !subject.startsWith("mailto:")) {
    throw new Error(
      `VAPID_SUBJECT must be an https:// URL or mailto: link. ` +
      `Current value: ${subject}. ` +
      `Examples: https://your-domain.com or mailto:your-email@example.com`
    );
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
}

export async function sendPushNotification(
  subscription: PushSubscription,
  payload: NotificationPayload
): Promise<void> {
  try {
    initializePushNotifications();
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        icon: payload.icon || "/web-app-manifest-192x192.png",
        badge: payload.badge || "/web-app-manifest-192x192.png",
        tag: payload.tag,
        data: payload.data,
        actions: payload.actions,
        requireInteraction: payload.requireInteraction,
      })
    );
  } catch (error) {
    console.error("Error sending push notification:", error);
    throw error;
  }
}

export function createTaskReminderPayload(
  taskTitle: string,
  taskId: string,
  minutesUntil: number
): NotificationPayload {
  return {
    title: `Task Reminder: ${taskTitle}`,
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

