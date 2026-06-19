// Get version and cache name dynamically
async function getCacheName() {
  try {
    const response = await fetch("/version.json");
    if (response.ok) {
      const data = await response.json();
      const version = data.version || "1";
      return `planmyday-v${version}`;
    }
  } catch (error) {
    console.log("Service Worker: Failed to fetch version, using default", error);
  }
  // Fallback to default if version fetch fails
  return "planmyday-v1";
}

const STATIC_CACHE_URLS = [
  "/",
  "/tasks",
  "/calendar",
  "/settings",
  "/auth/signin",
  "/manifest.json",
  "/web-app-manifest-192x192.png",
];

// Install event - cache static assets
self.addEventListener("install", (event) => {
  console.log("Service Worker: Installing...");
  event.waitUntil(
    getCacheName()
      .then((CACHE_NAME) => {
        console.log("Service Worker: Using cache name", CACHE_NAME);
        return caches
          .open(CACHE_NAME)
          .then((cache) => {
            console.log("Service Worker: Caching static assets");
            return cache.addAll(STATIC_CACHE_URLS);
          })
          .then(() => {
            console.log("Service Worker: Installation complete");
            return self.skipWaiting();
          });
      })
      .catch((error) => {
        console.error("Service Worker: Installation failed", error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener("activate", (event) => {
  console.log("Service Worker: Activating...");
  event.waitUntil(
    getCacheName()
      .then((CACHE_NAME) => {
        return caches
          .keys()
          .then((cacheNames) => {
            return Promise.all(
              cacheNames.map((cacheName) => {
                // Delete all caches that don't match the current version
                if (cacheName !== CACHE_NAME && cacheName.startsWith("planmyday-v")) {
                  console.log("Service Worker: Deleting old cache", cacheName);
                  return caches.delete(cacheName);
                }
              })
            );
          })
          .then(() => {
            console.log("Service Worker: Activation complete");
            return self.clients.claim();
          });
      })
      .catch((error) => {
        console.error("Service Worker: Activation failed", error);
        return self.clients.claim();
      })
  );
});

// Fetch event - serve from cache when offline
self.addEventListener("fetch", (event) => {
  // Skip non-GET requests
  if (event.request.method !== "GET") {
    return;
  }

  // Skip API requests
  if (event.request.url.includes("/api/")) {
    return;
  }

  // Skip unsupported URL schemes
  if (
    event.request.url.startsWith("chrome-extension://") ||
    event.request.url.startsWith("moz-extension://") ||
    event.request.url.startsWith("safari-extension://") ||
    event.request.url.startsWith("ms-browser-extension://")
  ) {
    return;
  }

  // Skip data URLs and blob URLs
  if (event.request.url.startsWith("data:") || event.request.url.startsWith("blob:")) {
    return;
  }

  event.respondWith(
    getCacheName()
      .then((CACHE_NAME) => {
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            console.log("Service Worker: Serving from cache", event.request.url);
            return cachedResponse;
          }

          // If not in cache, fetch from network
          return fetch(event.request)
            .then((response) => {
              // Don't cache non-successful responses
              if (!response || response.status !== 200 || response.type !== "basic") {
                return response;
              }

              // Skip caching for unsupported schemes
              if (
                event.request.url.startsWith("chrome-extension://") ||
                event.request.url.startsWith("moz-extension://") ||
                event.request.url.startsWith("safari-extension://") ||
                event.request.url.startsWith("ms-browser-extension://") ||
                event.request.url.startsWith("data:") ||
                event.request.url.startsWith("blob:")
              ) {
                return response;
              }

              // Clone the response
              const responseToCache = response.clone();

              // Cache the response for future use
              caches
                .open(CACHE_NAME)
                .then((cache) => {
                  // Double-check URL before caching
                  if (
                    event.request.url.startsWith("chrome-extension://") ||
                    event.request.url.startsWith("moz-extension://") ||
                    event.request.url.startsWith("safari-extension://") ||
                    event.request.url.startsWith("ms-browser-extension://") ||
                    event.request.url.startsWith("data:") ||
                    event.request.url.startsWith("blob:")
                  ) {
                    console.log(
                      "Service Worker: Skipping cache for unsupported URL:",
                      event.request.url
                    );
                    return;
                  }

                  cache.put(event.request, responseToCache).catch((error) => {
                    console.log("Service Worker: Failed to cache specific response:", error);
                  });
                })
                .catch((error) => {
                  console.log("Service Worker: Failed to open cache:", error);
                });

              return response;
            })
            .catch((error) => {
              console.log("Service Worker: Network request failed", error);

              // Return offline page for navigation requests
              if (event.request.destination === "document") {
                return caches.match("/");
              }

              throw error;
            });
        });
      })
      .catch((error) => {
        console.error("Service Worker: Failed to get cache name", error);
        // Fallback to network request if cache name fetch fails
        return fetch(event.request);
      })
  );
});

// Push notification handling (v5 — URL-as-action pattern, track-my-habits style)
const SW_VERSION = "5";

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

// Push notification event
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

// Handle messages from the client (e.g., skip waiting)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
