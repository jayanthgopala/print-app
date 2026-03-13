self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  event.waitUntil(clients.claim());
});

self.addEventListener('fetch', (event) => {
  // Pass requests through without surfacing unhandled promise rejections in the SW.
  event.respondWith(
    fetch(event.request).catch(() => Response.error())
  );
});
