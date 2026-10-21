/* =====================================================================
   Service worker — makes the tree installable and usable offline.

   Two rules matter here:
     * ONLY same-origin GET requests for the app's own files are cached. Every
       request to Supabase (authentication and the family data) and to the CDNs
       passes straight through and is never stored, so no session token and no
       family record ever ends up in the cache.
     * Same-origin files use network-first, so a deploy is picked up on the next
       load and the cache is only a fallback when the network is gone.

   Bump CACHE when the file list changes.
   ===================================================================== */
'use strict';

const CACHE = 'family-tree-shell-v6';
const SHELL = [
  './',
  'index.html',
  'css/style.css',
  'js/config.js',
  'js/supabase.js',
  'js/auth.js',
  'js/i18n.js',
  'js/photos.js',
  'js/personform.js',
  'js/admin.js',
  'js/extras.js',
  'js/app.js',
  'js/branch.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(err => console.warn('Shell precache failed:', err))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  // Supabase, the CDNs and anything else cross-origin: never touched.
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then(res => {
        // Keep a copy of a good response for offline use.
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(req).then(hit => hit || caches.match('index.html')))
  );
});
