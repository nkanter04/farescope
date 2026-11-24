/**
 * Tripica's service worker: makes the app installable and quick to reopen. Deliberately small:
 * - Live data (/api/…) and other sites (Drive, airline logos, fonts, sign-in) are never touched.
 * - Pages: network first, so a deploy shows up on the next open; the last copy is used offline.
 * - Hashed build files (assets/…) never change, so they're served from the cache once fetched.
 * - Other app files (icons, globe textures): served from the cache, refreshed in the background.
 * Bump VERSION to drop every cached file on the next visit.
 */
const VERSION = "v1";
const PAGES = `tripica-pages-${VERSION}`;
const FILES = `tripica-files-${VERSION}`;
const scope = new URL(self.registration.scope);
const SHELL = new URL("./", scope).href;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(PAGES).then((c) => c.add(SHELL)).catch(() => undefined));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("tripica-") && !key.endsWith(VERSION)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname) || url.pathname.includes("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) {
          const copy = res.clone();
          caches.open(PAGES).then((c) => c.put(SHELL, copy)).catch(() => undefined);
        }
        return res;
      } catch {
        return (await caches.match(SHELL)) ?? Response.error();
      }
    })());
    return;
  }

  const immutable = url.pathname.startsWith(`${scope.pathname}assets/`);
  event.respondWith((async () => {
    const cache = await caches.open(FILES);
    const hit = await cache.match(req);
    const refresh = fetch(req).then((res) => {
      if (res.ok && res.type === "basic") cache.put(req, res.clone()).catch(() => undefined);
      return res;
    });
    if (hit) {
      if (!immutable) event.waitUntil(refresh.catch(() => undefined));
      return hit;
    }
    return refresh;
  })());
});

// ---- Price-drop alerts (Web Push) ----
// Pushes arrive empty; the alert text is fetched from Tripica with this device's push address.
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    let messages = [];
    try {
      const sub = await self.registration.pushManager.getSubscription();
      if (sub) {
        const res = await fetch(new URL("../api/push/inbox", scope).href, {
          method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        messages = (await res.json()).messages || [];
      }
    } catch { /* show the generic note below */ }
    if (!messages.length) messages = [{ title: "Tripica", body: "A price you're watching changed. Open Tripica to see it.", url: new URL("./?view=trips", scope).href }];
    await Promise.all(messages.map((m, i) => self.registration.showNotification(m.title, {
      body: m.body, icon: new URL("./icons/icon-192.png", scope).href, badge: new URL("./icons/icon-192.png", scope).href,
      tag: `tripica-alert-${Date.now()}-${i}`, data: { url: m.url },
    })));
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || new URL("./?view=trips", scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => w.url.startsWith(scope.href));
    if (open) { await open.focus(); return open.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
