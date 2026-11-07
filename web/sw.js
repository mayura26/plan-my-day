const CACHE = "planmyday-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith("planmyday-") && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/auth/")) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === "navigate") {
          const shell = await caches.match("/index.html");
          if (shell) return shell;
        }
        return new Response("Offline", { status: 503 });
      }),
  );
});

self.addEventListener("push", (event) => {
  let payload = { title: "Plan My Day", body: "You have a reminder" };
  if (event.data) {
    try {
      payload = event.data.json();
    } catch {
      payload.body = event.data.text();
    }
  }
  const actionUrls = payload.actionUrls || {};
  const actions = [];
  if (actionUrls.complete) actions.push({ action: actionUrls.complete, title: "Done" });
  if (actionUrls.snooze) actions.push({ action: actionUrls.snooze, title: "Snooze" });
  event.waitUntil(
    self.registration.showNotification(payload.title || "Plan My Day", {
      body: payload.body || "",
      data: { url: payload.url || "/calendar", actionUrls },
      actions,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = event.action || event.notification.data?.url || "/calendar";
  event.waitUntil(clients.openWindow(new URL(target, self.location.origin).href));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});
