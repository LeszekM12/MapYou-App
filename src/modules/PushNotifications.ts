// ─── PUSH NOTIFICATIONS MODULE ───────────────────────────────────────────────
// Plik: src/modules/PushNotifications.ts
// Importuj i wywołaj initPushNotifications() po załadowaniu mapy.

const BACKEND_URL = 'https://mapty-backend-lexb.onrender.com';

// ── Helper: konwersja base64 → Uint8Array (wymagane przez pushManager) ────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Krok 1: Rejestracja push-sw.js ───────────────────────────────────────────

async function registerPushSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) {
    console.warn('[Push] Service Worker not supported');
    return null;
  }

  try {
    // Rejestruj push-sw.js obok głównego sw.js
    const reg = await navigator.serviceWorker.register('/push-sw.js', {
      scope: '/',
    });
    console.log('[Push] push-sw.js registered, scope:', reg.scope);
    return reg;
  } catch (err) {
    console.error('[Push] SW registration failed:', err);
    return null;
  }
}

// ── Krok 2: Pobierz klucz VAPID z backendu ────────────────────────────────────

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res  = await fetch(`${BACKEND_URL}/push/vapid-public-key`);
    const data = await res.json() as { publicKey: string };
    console.log('[Push] VAPID public key fetched');
    return data.publicKey;
  } catch (err) {
    console.error('[Push] Failed to fetch VAPID key:', err);
    return null;
  }
}

// ── Krok 3: Poproś o zgodę na powiadomienia ───────────────────────────────────

async function requestPermission(): Promise<boolean> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    console.warn('[Push] Notification permission denied:', permission);
    return false;
  }
  console.log('[Push] Notification permission granted');
  return true;
}

// ── Krok 4: Utwórz subskrypcję push ──────────────────────────────────────────

async function subscribeToPush(
  reg:           ServiceWorkerRegistration,
  vapidPublicKey: string,
): Promise<PushSubscription | null> {
  try {
    // Sprawdź czy już jest aktywna subskrypcja
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      console.log('[Push] Already subscribed');
      return existing;
    }

    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer as ArrayBuffer,
    });

    console.log('[Push] New subscription created');
    return subscription;
  } catch (err) {
    console.error('[Push] Subscribe failed:', err);
    return null;
  }
}

// ── Krok 5: Wyślij subskrypcję do backendu ────────────────────────────────────

async function sendSubscriptionToBackend(subscription: PushSubscription): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/push/subscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(subscription),
    });

    const data = await res.json() as { status: string; message: string; id?: string };

    if (!res.ok) {
      console.error('[Push] Backend rejected subscription:', data.message);
      return false;
    }

    console.log('[Push] Subscription sent to backend:', data.message, data.id);
    return true;
  } catch (err) {
    console.error('[Push] Failed to send subscription:', err);
    return false;
  }
}

// ── Krok 6: Wyrejestruj subskrypcję ──────────────────────────────────────────

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;

  const reg = await navigator.serviceWorker.getRegistration('/push-sw.js');
  if (!reg) return;

  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  // Usuń z backendu
  try {
    await fetch(`${BACKEND_URL}/push/unsubscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ endpoint: sub.endpoint }),
    });
  } catch { /* ignoruj błąd sieciowy */ }

  // Usuń lokalnie
  await sub.unsubscribe();
  console.log('[Push] Unsubscribed');
}

// ── Główna funkcja — wywołaj ją po załadowaniu aplikacji ─────────────────────

export async function initPushNotifications(): Promise<void> {
  // Sprawdź wsparcie przeglądarki
  if (!('Notification' in window)) {
    console.warn('[Push] Notifications not supported');
    return;
  }
  if (!('PushManager' in window)) {
    console.warn('[Push] PushManager not supported');
    return;
  }

  // Jeśli użytkownik już odrzucił — nie pytaj ponownie
  if (Notification.permission === 'denied') {
    console.warn('[Push] Notifications blocked by user');
    return;
  }

  // Krok 1
  const reg = await registerPushSW();
  if (!reg) return;

  // Krok 2
  const vapidKey = await fetchVapidPublicKey();
  if (!vapidKey) return;

  // Krok 3 — poproś o zgodę tylko jeśli jeszcze nie udzielona
  if (Notification.permission !== 'granted') {
    const granted = await requestPermission();
    if (!granted) return;
  }

  // Krok 4
  const subscription = await subscribeToPush(reg, vapidKey);
  if (!subscription) return;

  // Krok 5
  await sendSubscriptionToBackend(subscription);
}

// ── Testowa funkcja — wywołaj z konsoli przeglądarki ─────────────────────────
// window.testPush('Trening ukończony!', 'Świetna robota! +5km 🏃')

export async function testPushNotification(
  title = 'Mapty Test',
  body  = 'Push notifications działają! 🎉',
): Promise<void> {
  try {
    const res = await fetch(`${BACKEND_URL}/push/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, body, url: '/' }),
    });
    const data = await res.json();
    console.log('[Push] Test sent:', data);
  } catch (err) {
    console.error('[Push] Test failed:', err);
  }
}

// Eksponuj na window do testów z konsoli
(window as unknown as Record<string, unknown>).testPush = testPushNotification;
