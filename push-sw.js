// ─── PUSH SERVICE WORKER ─────────────────────────────────────────────────────
// Plik: push-sw.js  (w root projektu, obok index.html)
//
// Ten SW obsługuje TYLKO odbiór i wyświetlanie push notifications.
// Nie musi wiedzieć nic o userId — backend już zadbał o to, żeby
// powiadomienie dotarło tylko do właściwego endpointu (urządzenia).

const BACKEND_URL = 'https://mapty-backend-lexb.onrender.com';

// ── Push event — wyświetlanie powiadomienia ───────────────────────────────────

self.addEventListener('push', event => {
  let data = {
    title: 'Mapty',
    body:  'Nowe powiadomienie',
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
    }),
  );
});

// ── notificationclick — fokus lub otwarcie okna ───────────────────────────────

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url ?? self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const client of list) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow ? clients.openWindow(targetUrl) : undefined;
    }),
  );
});

// ── pushsubscriptionchange — automatyczne odnowienie ─────────────────────────
//
// Wywoływane gdy przeglądarka sama zmieni endpoint (rzadkie, ale możliwe).
// Nowa subskrypcja jest wysyłana do backendu — bez userId, bo SW nie ma
// dostępu do localStorage. Backend zidentyfikuje urządzenie po endpointcie.

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    }).then(newSub => {
      // Wyślij nową subskrypcję do backendu
      // Uwaga: bez userId — frontend wykryje zmianę przy następnym uruchomieniu
      // i wywoła resubscribeIfNeeded() który dośle userId poprawnie.
      return fetch(`${BACKEND_URL}/push/subscribe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          // userId i deviceId nie są dostępne w SW — wyślij samo to co mamy
          // Frontend przy starcie uzupełni przez resubscribeIfNeeded()
          userId:   'unknown',
          deviceId: 'unknown',
          ...newSub.toJSON(),
        }),
      });
    }),
  );
});
