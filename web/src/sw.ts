/// <reference lib="webworker" />
/**
 * Service Worker — Montréal Compagnon.
 *
 * Trois politiques distinctes, dictées par la contrainte de migration GCP :
 *
 *  1. `/config.json` : NetworkOnly avec repli mémoire. Ce fichier porte le
 *     projet Firebase courant. S'il était mis en cache, une PWA installée
 *     continuerait de parler à l'ancien projet après migration — précisément
 *     ce qu'on veut éviter. On accepte donc de le rejouer depuis un dernier
 *     bon état connu seulement quand le réseau est absent.
 *
 *  2. App shell : precache classique (Workbox), navigation servie depuis
 *     l'index précaché -> l'app démarre hors-ligne, dans le métro comme dans
 *     l'avion.
 *
 *  3. Photos Cloud Storage : CacheFirst plafonné (200 entrées / 30 jours).
 *     La galerie reste consultable hors-ligne sans faire enfler indéfiniment
 *     le stockage du téléphone.
 *
 * Firestore n'est délibérément PAS intercepté : son propre cache IndexedDB
 * (persistentLocalCache) gère le hors-ligne bien mieux qu'un SW.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { clientsClaim } from 'workbox-core';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

const CONFIG_CACHE = 'mtl-config-v1';
const CONFIG_URL = '/config.json';

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// ---------------------------------------------------------------------------
// 1. Configuration runtime : réseau d'abord, toujours.
// ---------------------------------------------------------------------------
registerRoute(
  ({ url }) => url.pathname === CONFIG_URL,
  async ({ request }) => {
    const cache = await caches.open(CONFIG_CACHE);
    try {
      const response = await fetch(request, { cache: 'no-store' });
      if (response.ok) {
        // On garde une copie uniquement comme filet hors-ligne, jamais comme
        // source normale.
        await cache.put(CONFIG_URL, response.clone());
      }
      return response;
    } catch {
      const fallback = await cache.match(CONFIG_URL);
      if (fallback) return fallback;
      return new Response(JSON.stringify({ offline: true }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  },
);

// ---------------------------------------------------------------------------
// 2. Navigation : app shell précaché (SPA).
// ---------------------------------------------------------------------------
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/__\//, /^\/config\.json$/],
  }),
);

// ---------------------------------------------------------------------------
// 3. API Cloud Run : réseau d'abord, cache de secours court.
//    Le scale-to-zero provoque des démarrages à froid de 1 à 3 s : un timeout
//    généreux évite de basculer en cache pour rien.
// ---------------------------------------------------------------------------
registerRoute(
  ({ url }) => url.pathname.startsWith('/api/'),
  new NetworkFirst({
    cacheName: 'mtl-api-v1',
    networkTimeoutSeconds: 8,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      new ExpirationPlugin({ maxEntries: 60, maxAgeSeconds: 60 * 60 * 6 }),
    ],
  }),
);

// ---------------------------------------------------------------------------
// 4. Photos Cloud Storage.
// ---------------------------------------------------------------------------
registerRoute(
  ({ url }) =>
    url.hostname === 'firebasestorage.googleapis.com' ||
    url.hostname === 'storage.googleapis.com',
  new CacheFirst({
    cacheName: 'mtl-photos-v1',
    plugins: [
      new CacheableResponsePlugin({ statuses: [0, 200] }),
      new ExpirationPlugin({
        maxEntries: 200,
        maxAgeSeconds: 60 * 60 * 24 * 30,
        purgeOnQuotaError: true, // le navigateur peut reprendre la place
      }),
    ],
  }),
);

// ---------------------------------------------------------------------------
// 5. Icônes météo tierces.
// ---------------------------------------------------------------------------
registerRoute(
  ({ url }) => url.hostname === 'openweathermap.org',
  new StaleWhileRevalidate({
    cacheName: 'mtl-weather-icons-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 60 })],
  }),
);

// ---------------------------------------------------------------------------
// Cycle de vie : mise à jour uniquement sur demande explicite du client
// (registerType 'prompt'). Un skipWaiting automatique pourrait recharger la
// page pendant un upload de photo.
// ---------------------------------------------------------------------------
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  if (event.data?.type === 'SKIP_WAITING') {
    void self.skipWaiting();
  }
  if (event.data?.type === 'CLEAR_CONFIG_CACHE') {
    // Appelé après une migration détectée côté client.
    event.waitUntil(caches.delete(CONFIG_CACHE));
  }
});

clientsClaim();
