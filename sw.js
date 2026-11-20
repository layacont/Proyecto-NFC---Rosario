/**
 * Service Worker para Rezo Católico Diario
 * - Cache-First para recursos estáticos locales (compatible con subdirectorios como GitHub Pages).
 * - Network-First / pass-through para peticiones externas (ej. feed.evangelizo.org),
 *   sin almacenar nunca respuestas fallidas o de error de API.
 */

const CACHE_NAME = 'rezo-diario-v1';

const STATIC_ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/**
 * Instalación: precachea todos los recursos estáticos esenciales para uso offline.
 */
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

/**
 * Activación: elimina cachés de versiones anteriores y toma control inmediato.
 */
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

/**
 * Interceptación de red:
 * - Solo maneja peticiones GET.
 * - Peticiones externas (distinto origen, ej. feed.evangelizo.org):
 *   pasan directamente a red (Network-First / pass-through) sin cachear errores ni respuestas API fallidas.
 * - Peticiones del mismo origen:
 *   estrategia Cache-First con actualización en caché solo para respuestas válidas (HTTP 2xx).
 */
self.addEventListener('fetch', (event) => {
  const { request } = event;

  if (request.method !== 'GET') {
    return;
  }

  const requestUrl = new URL(request.url);

  // Peticiones externas (p. ej. API de Evangelizo): solo red, sin cachear fallos
  if (requestUrl.origin !== self.location.origin) {
    event.respondWith(fetch(request));
    return;
  }

  // Recursos estáticos propios: Cache-First
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }

      return fetch(request)
        .then((networkResponse) => {
          if (
            networkResponse &&
            networkResponse.ok &&
            networkResponse.type === 'basic'
          ) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          // Si es una navegación sin conexión, devolver el index.html cacheado
          if (request.mode === 'navigate') {
            return caches.match('./index.html');
          }
          return Response.error();
        });
    })
  );
});
