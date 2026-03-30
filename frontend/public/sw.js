self.addEventListener('install', (event) => {
  console.log('Service Worker installed');
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  console.log('Service Worker activated');
  event.waitUntil(clients.claim());
});

const SHARED_FILES_DB = 'printshop-share-target';
const SHARED_FILES_STORE = 'pending-files';

self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  if (event.request.method === 'POST' && requestUrl.pathname === '/share') {
    event.respondWith(handleShareTarget(event));
    return;
  }

  // Pass requests through without surfacing unhandled promise rejections in the SW.
  event.respondWith(
    fetch(event.request).catch(() => Response.error())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'PING_SHARE_TARGET') {
    event.source?.postMessage({ type: 'SHARED_FILES_READY' });
  }
});

async function handleShareTarget(event) {
  const formData = await event.request.formData();
  const files = formData.getAll('files').filter((item) => item instanceof File && item.size > 0);
  const title = formData.get('title') || '';
  const text = formData.get('text') || '';
  const url = formData.get('url') || '';

  await saveSharedFiles(files);

  const clientList = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const client of clientList) {
    client.postMessage({ type: 'SHARED_FILES_READY' });
  }

  const redirectUrl = new URL('/?shared=true', self.location.origin);
  if (title) redirectUrl.searchParams.set('title', String(title));
  if (text) redirectUrl.searchParams.set('text', String(text));
  if (url) redirectUrl.searchParams.set('url', String(url));

  if (clientList.length === 0) {
    await clients.openWindow(redirectUrl.toString());
  }

  return Response.redirect(redirectUrl.toString(), 303);
}

async function saveSharedFiles(files) {
  const database = await openSharedFilesDb();

  await new Promise((resolve, reject) => {
    const transaction = database.transaction(SHARED_FILES_STORE, 'readwrite');
    const store = transaction.objectStore(SHARED_FILES_STORE);
    const request = store.put({ files, savedAt: Date.now() }, 'latest');

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

function openSharedFilesDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(SHARED_FILES_DB, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(SHARED_FILES_STORE)) {
        database.createObjectStore(SHARED_FILES_STORE);
      }
    };

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}
