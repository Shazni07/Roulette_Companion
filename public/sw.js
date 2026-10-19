/* PRO Calculator service worker: lets the app open and work with no internet.
 *
 * - Page (navigation): network first, falls back to the saved copy when offline.
 * - /_next/static files (never change for a given name): saved, then served from the saved copy.
 * - Icons, manifest and other small files: served from the saved copy and refreshed in the background.
 * - Other websites (such as the Supabase database) are never touched or saved here.
 *
 * Bump VERSION when this file's behaviour changes. A new version waits until the user taps
 * "Update" (the page then sends SKIP_WAITING), so a round is never interrupted by an update.
 */
const VERSION = "v1";
const CACHE = "roulette-companion-" + VERSION;
const SHELL = ["/", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      // one missing file must not stop the install
      Promise.all(SHELL.map((url) => cache.add(url).catch(() => undefined))),
    ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("roulette-companion-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data) return;
  if (data.type === "SKIP_WAITING") self.skipWaiting();
  // the page lists the files it already loaded, so the first visit also works offline afterwards
  if (data.type === "CACHE_URLS" && Array.isArray(data.urls)) {
    event.waitUntil(
      caches.open(CACHE).then((cache) =>
        Promise.all(
          data.urls
            .filter((u) => typeof u === "string" && u.startsWith(self.location.origin))
            .map((u) => cache.add(u).catch(() => undefined)),
        ),
      ),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // other sites (Supabase, etc.) go straight to the network

  // the page itself
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit || Response.error())),
    );
    return;
  }

  // hashed build files never change, so the saved copy is always right
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // everything else on this site: saved copy now, refreshed in the background
  event.respondWith(
    caches.match(req).then((hit) => {
      const fresh = fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit || Response.error());
      return hit || fresh;
    }),
  );
});
