const token = document.currentScript?.dataset.token;
if (token && !location.hash.startsWith("#share=")) {
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://static.cloudflareinsights.com/beacon.min.js";
  script.dataset.cfBeacon = JSON.stringify({ token });
  document.head.appendChild(script);
}
document.addEventListener("click", event => {
  const link = event.target instanceof Element && event.target.closest("a[data-booking-kind]");
  if (!link) return;
  const source = location.pathname.startsWith("/guides/") ? "guide" : "app";
  navigator.sendBeacon?.("/api/booking-click/" + source + "/" + link.dataset.bookingKind);
});
