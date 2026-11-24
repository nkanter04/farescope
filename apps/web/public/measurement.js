// Live-site measurement (added by the build to the homepage, guides and app; see guides/build.tsx).
// - Cloudflare Web Analytics, when a token is configured.
// - Tripica's own first-party analytics for the static pages (the app sends its own from
//   src/analytics.ts): page views with referrer and campaign tags, visible time, booking clicks.
//   No cookies; a random per-tab session ID and the anonymous browser ID, hashed by the server.
const token = document.currentScript?.dataset.token;
if (token && !location.hash.startsWith("#share=")) {
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.appendChild(script);
}

const inApp = location.pathname.includes("/app/");

document.addEventListener("click", event => {
  const link = event.target instanceof Element && event.target.closest("a[data-booking-kind]");
  if (!link) return;
  const source = location.pathname.startsWith("/guides/") ? "guide" : "app";
  navigator.sendBeacon?.("/api/booking-click/" + source + "/" + link.dataset.bookingKind);
  if (!inApp) queue.push({ name: "booking_click", path: location.pathname, label: [link.dataset.bookingKind, link.dataset.partner].filter(Boolean).join(":") });
});

function storedId(store, key) {
  const make = () => (crypto.randomUUID ? crypto.randomUUID() : "x-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10));
  try {
    let id = store.getItem(key);
    if (!id) store.setItem(key, (id = make()));
    return id;
  } catch {
    return make();
  }
}

const queue = [];
if (!inApp) {
  const q = new URLSearchParams(location.search);
  const ref = document.referrer && !document.referrer.startsWith(location.origin) ? document.referrer : undefined;
  queue.push({
    name: "page_view", path: location.pathname, ref,
    utmSource: q.get("utm_source") || q.get("ref") || undefined,
    utmMedium: q.get("utm_medium") || undefined,
    utmCampaign: q.get("utm_campaign") || undefined,
  });
  let visibleSince = document.visibilityState === "visible" ? performance.now() : 0;
  let engaged = 0;
  const flush = final => {
    if (visibleSince) {
      const now = performance.now();
      engaged += now - visibleSince;
      visibleSince = document.visibilityState === "visible" ? now : 0;
    }
    if (engaged >= 1000) queue.push({ name: "engaged", path: location.pathname, ms: Math.round(engaged) });
    engaged = 0;
    if (!queue.length) return;
    const body = JSON.stringify({
      visitor: storedId(localStorage, "farescope.clientId"),
      session: storedId(sessionStorage, "tripica.session"),
      events: queue.splice(0, 25),
    });
    fetch("/api/events", { method: "POST", keepalive: final, headers: { "content-type": "application/json" }, body }).catch(() => undefined);
  };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
    else visibleSince = performance.now();
  });
  window.addEventListener("pagehide", () => flush(true));
  setTimeout(() => flush(false), 3000);
  setInterval(() => flush(false), 15000);
}
