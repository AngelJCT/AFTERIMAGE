// AFTERIMAGE: caches the heavy files (models, audio, built scripts) so a return visit loads from
// disk. Stale-while-revalidate: served from the cache at once, refreshed behind it. Pages, data
// and the films (streamed with range requests) always come from the network.
const CACHE = 'afterimage-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (req.headers.has('range') || url.pathname.includes('/video/')) return;
  if (!/\/(models|audio|assets)\//.test(url.pathname)) return;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(req);
    const net = fetch(req).then((res) => {
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    }).catch(() => hit);
    return hit ?? net;
  }));
});
