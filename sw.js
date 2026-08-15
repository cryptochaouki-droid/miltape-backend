const CACHE_NAME = "miltape-v1";

const FILES_TO_CACHE = [
    "./",
    "./index.html",
    "./style.css",
    "./manifest.json",
    "./conditions.html",
    "./icon-192.png",
    "./tap-art.jpg"
];

self.addEventListener("install", event => {

    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => {
                return cache.addAll(FILES_TO_CACHE);
            })
    );

    self.skipWaiting();
});

self.addEventListener("activate", event => {

    event.waitUntil(
        caches.keys().then(keys => {

            return Promise.all(
                keys
                    .filter(key => key !== CACHE_NAME)
                    .map(key => caches.delete(key))
            );

        })
    );

    self.clients.claim();
});

self.addEventListener("fetch", event => {

    event.respondWith(

        fetch(event.request)
            .catch(() => {
                return caches.match(event.request);
            })

    );

});
