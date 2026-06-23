// Service Worker for PWA push notifications (v6 — no fetch interception)
// Reminder actions use stable /reminder/action?... URLs; network-only navigation avoids SW breakage.

const SW_VERSION = "6";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name.startsWith("planmyday-v"))
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

function sameOriginUrl(path) {
  const url = new URL(path, self.location.origin);
  if (url.origin !== self.location.origin) {
    return new URL("/", self.location.origin).toString();
  }
  return url.toString();
}

function buildReminderActions(actionUrls, singleAction) {
  if (!actionUrls?.complete) return undefined;

  const completeUrl = sameOriginUrl(actionUrls.complete);

  if (singleAction) {
    return [{ action: completeUrl, title: "Done", navigate: completeUrl }];
  }

  if (!actionUrls?.snooze) return undefined;

  const snoozeUrl = sameOriginUrl(actionUrls.snooze);

  return [
    { action: completeUrl, title: "Done", navigate: completeUrl },
    { action: snoozeUrl, title: "Snooze", navigate: snoozeUrl },
  ];
}

async function openAppUrl(url) {
  const resolved = sameOriginUrl(url);
  const windowClients = await clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });

  for (const client of windowClients) {
    if (client.url.startsWith(self.location.origin) && "focus" in client) {
      if ("navigate" in client) {
        await client.navigate(resolved);
      }
      return client.focus();
    }
  }

  if (clients.openWindow) {
    return clients.openWindow(resolved);
  }
}

function resolveNotificationActionTarget(action, data) {
  if (typeof action !== "string" || !action) return null;

  if (action.startsWith("http://") || action.startsWith("https://")) {
    return action;
  }

  if (action.startsWith("/reminder/") || action.startsWith("/push/")) {
    return sameOriginUrl(action);
  }

  if (action === "complete" && data.completeUrl) {
    return sameOriginUrl(data.completeUrl);
  }

  if (action === "snooze15" && data.snoozeUrl15) {
    return sameOriginUrl(data.snoozeUrl15);
  }

  if (!data.singleAction && action === "snooze" && data.snoozeUrl) {
    return sameOriginUrl(data.snoozeUrl);
  }

  if (action === "view" && data.url) {
    return sameOriginUrl(data.url);
  }

  return null;
}

self.addEventListener("push", (event) => {
  console.log("Service Worker: Push notification received", SW_VERSION);

  let payload = {};

  if (event.data) {
    try {
      payload = event.data.json();
    } catch (_e) {
      try {
        payload = JSON.parse(event.data.text());
      } catch (_e2) {
        payload = {
          title: "Plan My Day",
          body: event.data.text() || "You have a new notification",
        };
      }
    }
  }

  const toAbsoluteUrl = (path) => new URL(path, self.location.origin).href;
  const iconPath = payload.icon || "/web-app-manifest-192x192.png";
  const badgePath = payload.badge || "/badge-icon.svg";
  const actionUrls = payload.actionUrls;
  const singleAction = Boolean(payload.singleAction);

  const options = {
    body: payload.body || "You have a new notification",
    icon: toAbsoluteUrl(iconPath),
    badge: toAbsoluteUrl(badgePath),
    tag: payload.tag || "default",
    data: {
      ...(payload.data || {}),
      url: payload.url || "/tasks",
      entityType: payload.entityType,
      entityId: payload.entityId,
      actionUrls,
      completeUrl: actionUrls?.complete,
      snoozeUrl: actionUrls?.snooze,
      singleAction,
      swVersion: SW_VERSION,
    },
    requireInteraction: payload.requireInteraction || false,
    renotify: payload.renotify || false,
    vibrate: payload.vibrate || [200, 100, 200],
  };

  const actions = buildReminderActions(actionUrls, singleAction);
  if (actions) {
    options.actions = actions;
  }

  event.waitUntil(self.registration.showNotification(payload.title || "Plan My Day", options));
});

self.addEventListener("notificationclick", (event) => {
  console.log("Service Worker: Notification clicked", event.action);

  event.notification.close();

  const data = event.notification.data || {};
  const fallbackUrl = data.url || data.completeUrl || "/tasks";
  const actionTarget = resolveNotificationActionTarget(event.action, data);

  if (actionTarget) {
    event.waitUntil(openAppUrl(actionTarget));
    return;
  }

  event.waitUntil(openAppUrl(fallbackUrl));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
