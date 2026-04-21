// ─── PUSH SERVICE WORKER ─────────────────────────────────────────────────────

const BACKEND_URL = 'https://mapty-backend-lexb.onrender.com';

self.addEventListener('push', event => {
  let data = {
    title: 'MapYou',
    body:  'New notification',
    icon:  './public/icon-192.png',
    url:   self.registration.scope,
  };
  if (event.data) {
    try   { data = { ...data, ...event.data.json() }; }
    catch { data.body = event.data.text(); }
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body:    data.body,
      icon:    data.icon  ?? './public/icon-192.png',
      badge:   data.badge ?? './public/icon-192.png',
      data:    { url: data.url ?? '/' },
      vibrate: [200, 100, 200],
      requireInteraction: false,
    })
  );
});

// Otwiera apkę i PRZEKAZUJE token przez postMessage → FriendsView odbiera
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async list => {
      let appClient = null;
      for (const client of list) {
        if (client.url.includes(self.location.origin)) {
          appClient = client;
          break;
        }
      }

      if (appClient) {
        await appClient.focus();
        appClient.postMessage({ type: 'OPEN_LIVE', url: targetUrl });
      } else {
        const fullUrl = targetUrl.startsWith('http')
          ? targetUrl
          : self.registration.scope.replace(/\/$/, '') + '/' + targetUrl.replace(/^\//, '');
        const newClient = await clients.openWindow(fullUrl);
        if (newClient) {
          setTimeout(() => newClient.postMessage({ type: 'OPEN_LIVE', url: targetUrl }), 2500);
        }
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    }).then(newSub => {
      return fetch(`${BACKEND_URL}/push/subscribe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId: 'unknown', deviceId: 'unknown', ...newSub.toJSON() }),
      });
    })
  );
});
