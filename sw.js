/* ============================================================
   MILTAPE - SERVICE WORKER OFFICIEL
   Ce fichier gère la mise en cache pour accélérer le chargement.
   ============================================================ */

const CACHE_NAME = 'miltape-cache-v2';
const urlsToCache = [
  '/',
  '/index.html',
  '/style.css',
  '/tap-art.jpg',
  '/tape.png',
  '/manifest.json'
];

// Installation : on met en cache les fichiers de base
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(urlsToCache);
      })
  );
});

// Activation : on supprime les anciens caches inutiles
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Stratégie : Cache d'abord, puis réseau (pour les images et fichiers statiques)
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Si le fichier est en cache, on le renvoie
        if (response) {
          return response;
        }
        // Sinon, on va le chercher sur le réseau
        return fetch(event.request).then(
          networkResponse => {
            // On copie la réponse pour la mettre en cache la prochaine fois
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });
            return networkResponse;
          }
        );
      })
  );
});
