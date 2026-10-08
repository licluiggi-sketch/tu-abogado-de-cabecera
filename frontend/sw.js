
/*
  ABOGAIA - SERVICE WORKER
  Version 2

  Cache exclusiva para archivos publicos.
  No almacena consultas, historiales,
  usuarios, sesiones ni informacion de pagos.
*/

const CACHE_NAME = "abogaia-static-v2";

const STATIC_FILES = [
  "/style.css",
  "/icon-192.png",
  "/icon-512.png"
];

/* INSTALACION */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_FILES);
    })
  );

  self.skipWaiting();
});

/* ACTIVACION Y LIMPIEZA DE CACHES ANTIGUAS */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    })
  );

  self.clients.claim();
});

/* INTERCEPTAR SOLAMENTE ARCHIVOS PUBLICOS */
self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // No intervenir en dominios externos
  if (url.origin !== self.location.origin) return;

  // No intervenir en consultas, API, sesiones o pagos
  if (!STATIC_FILES.includes(url.pathname)) return;

  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      return cachedResponse || fetch(request);
    })
  );
});
