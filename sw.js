// =========================================================
// MILTAPE — SERVICE WORKER DÉSACTIVÉ (PROVISOIRE)
// =========================================================
// Ce fichier est volontairement vide pour éviter
// que le téléphone garde en cache une vieille version.

self.addEventListener('install', (event) => {
  // On n'installe rien, on ne met rien en cache !
});

self.addEventListener('activate', (event) => {
  // On supprime tout l'ancien cache
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(keys.map((key) => caches.delete(key)));
    })
  );
});

self.addEventListener('fetch', (event) => {
  // On ne bloque aucune requête, tout passe directement au réseau !
  return;
});
