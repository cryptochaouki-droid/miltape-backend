// ==========================================================
// SERVICE WORKER – Version 2 (cache busting)
// ==========================================================

const CACHE_NAME = "miltape-v2";  // ← INCÉMENTE LA VERSION

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./manifest.json",
    "./conditions.html",
    "./icon-192~2.jpg",   // vérifie le nom exact de ton icône
    "./tap-art.jpg",
    "./tape.png"
    // Si tu as d’autres fichiers, ajoute-les ici
];

self.addEventListener("install", event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(FILES_TO_CACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(
                keys.filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", event => {
    event.respondWith(
        fetch(event.request)
            .catch(() => caches.match(event.request))
    );
});
