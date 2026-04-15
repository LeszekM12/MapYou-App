// ─── PUSH SERVICE WORKER ─────────────────────────────────────────────────────
// Plik: push-sw.js (w root projektu, obok index.html)
// Ten SW obsługuje TYLKO push notifications.
// Twój główny sw.js (cache/offline) działa niezależnie.

const BACKEND_URL = 'https://mapty-backend-lexb.onrender.com';

// ── Push event — odbieranie powiadomienia ─────────────────────────────────────

self.addEventListener('push', event => {
  console.log('[Push SW] Push event received');

  let data = { title: 'Mapty', body: 'Nowe powiadomienie', icon: './icon-192.png', url: self.registration.scope };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body:    data.body,
    icon:    data.icon  ?? './icon-192.png',
    badge:   data.badge ?? './icon-192.png',
    data:    { url: data.url ?? '/' },
    vibrate: [200, 100, 200],
    requireInteraction: false,
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── notificationclick — obsługa kliknięcia ────────────────────────────────────

self.addEventListener('notificationclick', event => {
  console.log('[Push SW] Notification clicked');
  event.notification.close();

  const targetUrl = event.notification.data?.url ?? self.registration.scope;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      // Jeśli aplikacja jest już otwarta — fokus na niej
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      // Jeśli nie — otwórz nowe okno
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── pushsubscriptionchange — odnowienie wygasłej subskrypcji ──────────────────

self.addEventListener('pushsubscriptionchange', event => {
  console.log('[Push SW] Subscription changed — resubscribing');

  event.waitUntil(
    self.registration.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
    }).then(newSubscription => {
      return fetch(`${BACKEND_URL}/push/subscribe`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(newSubscription),
      });
    })
  );
});
