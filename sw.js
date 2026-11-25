/* 別肌動 service worker — app shell, cache-first.
   每次部署有改到任何檔案，都要遞增 VERSION，否則使用者會一直拿到舊的快取。 */
const VERSION = 'v12';
const CACHE = `kuku-${VERSION}`;
/* Resolve every shell URL against this worker's own URL once, so the precache keys
   and the navigation lookup below can never disagree about the relative base. */
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'vendor/chart.umd.min.js',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
].map(u => new URL(u, self.location).href);
const INDEX = new URL('index.html', self.location).href;

self.addEventListener('install', e => {
  /* cache:'reload' skips the HTTP cache so a new version never precaches stale files */
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('kuku-') && k !== CACHE).map(k => caches.delete(k)))));
});

/* the page asks the waiting worker to take over once the user agrees to reload */
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match(INDEX).then(r => r || fetch(req)));
    return;
  }
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
