const CACHE_NAME = "preventivi-pwa-v3";

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./css/base.css",
  "./css/sidebar.css",
  "./css/layout.css",
  "./css/components.css",
  "./css/quote-page.css",
  "./js/app.js",
  "./js/db.js",
  "./js/firebase.js",
  "./js/pdf.js",
  "./js/preview.js",
  "./js/quote-page.js",
  "./js/sidebar.js",
  "./js/utils.js"
];

// In sviluppo (localhost) non usiamo la cache — serve sempre la rete
const IS_DEV = self.location.hostname === "localhost" || self.location.hostname === "127.0.0.1";

self.addEventListener("install", (event) => {
  if (!IS_DEV) {
    event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  }
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  // In sviluppo: always network, no cache
  if (IS_DEV) {
    event.respondWith(fetch(event.request).catch(() => caches.match("./index.html")));
    return;
  }

  // Produzione: cache-first
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          return response;
        })
        .catch(() => caches.match("./index.html"));
    })
  );
});
