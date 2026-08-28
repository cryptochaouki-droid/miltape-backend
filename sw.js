/* =========================================================
   MILTAPE WORLD CHALLENGE
   SERVICE WORKER — VERSION CORRIGÉE
   ========================================================= */

const CACHE_NAME = 'miltape-cache-v4';

/*
 * Fichiers statiques à mettre en cache.
 * Si certains fichiers n'existent pas, le service worker
 * continue quand même de fonctionner.
 */
const STATIC_FILES = [
  './',
  './index.html',
  './style.css',
  './script.js',
  './manifest.json'
];

/* =========================================================
   INSTALL
   ========================================================= */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        return cache.addAll(STATIC_FILES).catch(() => {
          // Ne bloque pas l'installation si un fichier manque.
          return Promise.resolve();
        });
      })
      .then(() => {
        return self.skipWaiting();
      })
  );
});

/* =========================================================
   ACTIVATE
   ========================================================= */

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            if (cacheName !== CACHE_NAME) {
              return caches.delete(cacheName);
            }
            return Promise.resolve();
          })
        );
      })
      .then(() => self.clients.claim())
  );
});

/* =========================================================
   FETCH
   ========================================================= */

self.addEventListener('fetch', (event) => {

  const request = event.request;

  /*
   * On ne traite que les requêtes GET.
   * Les POST utilisés pour paiement, join, tap, etc.
   * passent directement au serveur.
   */
  if (request.method !== 'GET') {
    return;
  }

  const url = new URL(request.url);

  /* =======================================================
     1. NE JAMAIS CACHER LES CONNEXIONS SOCKET.IO
     ======================================================= */

  if (
    url.pathname.includes('/socket.io/') ||
    url.pathname.includes('/socket.io')
  ) {
    return;
  }

  /* =======================================================
     2. NE JAMAIS CACHER LES API DU BACKEND
     ======================================================= */

  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.includes('/api/')
  ) {
    return;
  }

  /* =======================================================
     3. NE PAS CACHER LES REQUÊTES EXTERNES
        (Railway, MongoDB, Tron, Telegram, etc.)
     ======================================================= */

  if (url.origin !== self.location.origin) {
    return;
  }

  /* =======================================================
     4. FICHIERS STATIQUES
        Réseau d'abord, cache en secours.
     ======================================================= */

  event.respondWith(
    fetch(request)
      .then((response) => {

        /*
         * On ne cache que les réponses valides.
         */
        if (
          response &&
          response.status === 200 &&
          response.type === 'basic'
        ) {
          const responseToCache = response.clone();

          caches.open(CACHE_NAME)
            .then((cache) => {
              cache.put(request, responseToCache);
            })
            .catch(() => {
              // Ignore les erreurs de cache.
            });
        }

        return response;
      })
      .catch(() => {
        /*
         * Si Internet est momentanément indisponible,
         * utiliser la version locale en cache.
         */
        return caches.match(request);
      })
  );
});

/* =========================================================
   MESSAGE
   Permet de forcer une mise à jour du service worker.
   ========================================================= */

self.addEventListener('message', (event) => {

  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }

});
