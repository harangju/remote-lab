// Service worker — network-first for API/WS, cache-first for static assets
const CACHE_NAME = "rl-v5";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Never intercept API calls, websocket handshakes, or navigation-like app routes.
  // The app uses client-side routing, and returning undefined here can cause
  // "Failed to convert value to 'Response'" / network-error behavior for paths
  // that should be handled by the browser or server directly.
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/ws/") ||
    e.request.mode === "navigate"
  ) {
    return;
  }

  // Images and fonts — cache-first (these rarely change)
  if (/\.(png|jpg|svg|woff2?)$/.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) =>
        cached || fetch(e.request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
          return res;
        })
      )
    );
    return;
  }

  // JS, CSS, HTML — network-first (so app updates are picked up)
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
