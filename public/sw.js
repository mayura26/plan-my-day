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

// Push notification event
// Following Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
self.addEventListener("push", (event) => {
  console.log("Service Worker: Push notification received");

  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch (_e) {
      // If data is not JSON, try text
      try {
        data = JSON.parse(event.data.text());
      } catch (_e2) {
        // If still not parseable, use default
        data = {
          title: "Plan My Day",
          body: event.data.text() || "You have a new notification",
        };
      }
    }
  }

  // Resolve icon and badge to absolute URLs so Android (and others) load them correctly
  const toAbsoluteUrl = (path) => new URL(path, self.location.origin).href;
  const iconPath = data.icon || "/web-app-manifest-192x192.png";
  const badgePath = data.badge || "/badge-icon.svg";

  const options = {
    body: data.body || "You have a new notification",
    icon: toAbsoluteUrl(iconPath),
    badge: toAbsoluteUrl(badgePath),
    tag: data.tag || "default",
    data: data.data || {},
    actions: data.actions || [],
    requireInteraction: data.requireInteraction || false,
    vibrate: data.vibrate || [200, 100, 200],
  };

  event.waitUntil(self.registration.showNotification(data.title || "Plan My Day", options));
});

// Notification click event
// Following Next.js PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
self.addEventListener("notificationclick", (event) => {
  console.log("Service Worker: Notification clicked", event.action);

  event.notification.close();

  // Handle action clicks (view, snooze, etc.)
  if (event.action) {
    const action = event.action;
    const notificationData = event.notification.data || {};

    if (action === "view" && notificationData.url) {
      event.waitUntil(clients.openWindow(notificationData.url));
      return;
    } else if (action === "snooze" && notificationData.taskId) {
      // You could send a message to the client to handle snooze
      // For now, just close the notification
      return;
    }
  }

  // Default: open the URL from notification data, or home page
  const urlToOpen = event.notification.data?.url || "/";

  event.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then((clientList) => {
        // Check if there's already a window/tab open with the target URL
        for (let i = 0; i < clientList.length; i++) {
          const client = clientList[i];
          if (client.url === urlToOpen && "focus" in client) {
            return client.focus();
          }
        }
        // If not, open a new window/tab
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Handle messages from the client (e.g., skip waiting)
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
