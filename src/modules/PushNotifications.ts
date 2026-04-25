// ─── PUSH NOTIFICATIONS — FRONTEND ───────────────────────────────────────────
// src/modules/PushNotifications.ts
//
// KLUCZOWA ZMIANA:
//   • Każda przeglądarka generuje UUID userId i UUID deviceId przy pierwszym
//     uruchomieniu i trzyma je w localStorage na stałe.
//   • Subskrypcja jest wysyłana do backendu razem z userId + deviceId.
//   • Powiadomienia są wysyłane TYLKO do tego userId (jego urządzeń).
//   • Brak broadcastu — inne urządzenia/użytkownicy NIC nie dostają.
//
// Architektura identyfikatorów:
//   userId   — reprezentuje "tę osobę" na wszystkich jej urządzeniach
//   deviceId — reprezentuje "tę konkretną przeglądarkę/urządzenie"
//   Klucz subskrypcji w DB = userId:deviceId (unikalny per urządzenie)

import { BACKEND_URL } from '../config.js';
import { getIPLocation, hasGPSPermission, getGPSLocation } from './LocationService.js';

// ── Stałe ─────────────────────────────────────────────────────────────────────

const LS_USER_ID   = 'mapty_userId';
const LS_DEVICE_ID = 'mapty_deviceId';

// ── UUID generator (crypto API — dostępna w każdej nowoczesnej przeglądarce) ──

function generateUUID(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback dla starszych przeglądarek
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ── Pobierz lub utwórz identyfikatory ─────────────────────────────────────────

/**
 * Zwraca stały UUID użytkownika.
 * Tworzony raz przy pierwszym uruchomieniu, potem zawsze ten sam.
 */
export function getUserId(): string {
  let id = localStorage.getItem(LS_USER_ID);
  if (!id) {
    id = generateUUID();
    localStorage.setItem(LS_USER_ID, id);
    console.log(`[Push] New userId created: ${id}`);
  }
  return id;
}

/**
 * Zwraca stały UUID urządzenia (tej konkretnej przeglądarki).
 * Tworzony raz przy pierwszym uruchomieniu, potem zawsze ten sam.
 */
export function getDeviceId(): string {
  let id = localStorage.getItem(LS_DEVICE_ID);
  if (!id) {
    id = generateUUID();
    localStorage.setItem(LS_DEVICE_ID, id);
    console.log(`[Push] New deviceId created: ${id}`);
  }
  return id;
}

// ── Helper: base64 → Uint8Array ───────────────────────────────────────────────

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Rejestracja Service Workera ───────────────────────────────────────────────

async function registerPushSW(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const swPath = new URL('push-sw.js', window.location.href).pathname;
    return await navigator.serviceWorker.register(swPath, {
      scope: new URL('./', window.location.href).pathname,
    });
  } catch (err) {
    console.error('[Push] SW registration failed:', err);
    return null;
  }
}

// ── Pobierz klucz VAPID ───────────────────────────────────────────────────────

async function fetchVapidPublicKey(): Promise<string | null> {
  try {
    const res  = await fetch(`${BACKEND_URL}/push/vapid-public-key`);
    const data = await res.json() as { publicKey: string };
    return data.publicKey;
  } catch {
    return null;
  }
}

// ── Wyślij subskrypcję do backendu (z userId + deviceId) ─────────────────────

async function sendSubscriptionToBackend(
  subscription: PushSubscription,
  userId:       string,
  deviceId:     string,
): Promise<boolean> {
  try {
    const res = await fetch(`${BACKEND_URL}/push/subscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // WAŻNE: wysyłamy userId i deviceId razem z subskrypcją
      body: JSON.stringify({
        userId,
        deviceId,
        ...subscription.toJSON(),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── Główna inicjalizacja ──────────────────────────────────────────────────────
//
// Wywołaj tę funkcję dopiero gdy użytkownik kliknie "Enable notifications"
// (nie automatycznie przy starcie — przeglądarki blokują automatyczne prośby).

export async function initPushNotifications(): Promise<void> {
  if (!('Notification' in window) || !('PushManager' in window)) return;
  if (Notification.permission === 'denied') return;

  const reg = await registerPushSW();
  if (!reg) return;

  const vapidKey = await fetchVapidPublicKey();
  if (!vapidKey) return;

  if (Notification.permission !== 'granted') {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return;
  }

  // Sprawdź czy istnieje już subskrypcja
  let subscription = await reg.pushManager.getSubscription();

  if (!subscription) {
    subscription = await reg.pushManager.subscribe({
      userVisibleOnly:      true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey).buffer as ArrayBuffer,
    });
  }

  const userId   = getUserId();
  const deviceId = getDeviceId();

  await sendSubscriptionToBackend(subscription, userId, deviceId);
  console.log(`[Push] Subscribed: userId=${userId} deviceId=${deviceId}`);
}

// ── Wyrejestrowanie ───────────────────────────────────────────────────────────

export async function unsubscribeFromPush(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  const swPath = new URL('push-sw.js', window.location.href).pathname;
  const reg    = await navigator.serviceWorker.getRegistration(swPath);
  if (!reg) return;

  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;

  // Usuń z backendu
  try {
    await fetch(`${BACKEND_URL}/push/unsubscribe`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        userId:   getUserId(),
        deviceId: getDeviceId(),
      }),
    });
  } catch { /* ignoruj błąd sieciowy */ }

  await sub.unsubscribe();
  console.log('[Push] Unsubscribed');
}

// ── Re-subskrypcja po restarcie backendu ──────────────────────────────────────

export async function resubscribeIfNeeded(): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const swPath = new URL('push-sw.js', window.location.href).pathname;
    const reg    = await navigator.serviceWorker.getRegistration(swPath);
    if (!reg) return;

    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;

    // Odśwież rejestrację w backendzie (po restarcie Render traci dane w pamięci)
    await sendSubscriptionToBackend(sub, getUserId(), getDeviceId());
    console.log('[Push] Re-subscribed after backend restart');
  } catch { /* ignoruj */ }
}

// ── Wysyłanie powiadomień — TYLKO do bieżącego użytkownika ───────────────────
//
// Każda funkcja wysyła powiadomienie TYLKO na urządzenia userId z localStorage.
// Backend dostaje userId i wysyła TYLKO do jego subskrypcji.

async function sendPushToSelf(title: string, body: string, url = '/'): Promise<void> {
  const userId = getUserId();
  try {
    await fetch(`${BACKEND_URL}/push/notify/${encodeURIComponent(userId)}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, body, url }),
    });
  } catch (err) {
    console.warn('[Push] sendPushToSelf failed:', err);
  }
}

// ── Publiczne triggery ────────────────────────────────────────────────────────

export async function sendWorkoutAddedPush(): Promise<void> {
  await sendPushToSelf('Nowy trening zapisany! 💪', 'Świetna robota! Tak trzymaj!');
}

export async function sendWorkoutDeletedPush(): Promise<void> {
  await sendPushToSelf('Trening usunięty.', 'Chcesz go przywrócić? Wróć do aplikacji.');
}

export async function sendActivityFinishedPush(
  sport:       string,
  distanceKm:  number,
  durationSec: number,
): Promise<void> {
  const icons: Record<string, string> = { running: '🏃', walking: '🚶', cycling: '🚴' };
  const emoji   = icons[sport] ?? '🏅';
  const h       = Math.floor(durationSec / 3600);
  const m       = Math.floor((durationSec % 3600) / 60);
  const timeStr = h > 0 ? `${h}h ${m}min` : `${m}min`;

  await sendPushToSelf(
    `${emoji} Aktywność zakończona!`,
    `${distanceKm.toFixed(2)} km · ${timeStr} — nieźle! Zapisano w historii.`,
  );
}

export async function sendWelcomeBackPush(): Promise<void> {
  await sendPushToSelf('Witaj ponownie! 👋', 'Gotowy na kolejny trening?');
}

export async function sendLongBreakPush(): Promise<boolean> {
  const KEY = 'mapty_last_open';
  const now  = Date.now();
  const last = Number(localStorage.getItem(KEY) ?? 0);
  localStorage.setItem(KEY, String(now));

  if (last > 0 && (now - last) / (1000 * 60 * 60) > 24) {
    await sendPushToSelf('Miło Cię widzieć ponownie! 🏃', 'Co dziś robimy? Czas na trening!');
    return true;
  }
  return false;
}

export async function sendArrivedAtDestinationPush(): Promise<void> {
  await sendPushToSelf('Dotarłeś na miejsce! 🎯', 'Chcesz zapisać trasę? Wróć do aplikacji.');
}

export async function sendWeatherPush(): Promise<void> {
  const KEY = 'mapty_last_weather_push';
  const now  = Date.now();
  if ((now - Number(localStorage.getItem(KEY) ?? 0)) / (1000 * 60 * 60) < 6) return;

  try {
    // Use GPS only if already granted, otherwise fall back to IP — never prompt
    let lat: number, lon: number;
    if (await hasGPSPermission()) {
      try {
        const gps = await getGPSLocation();
        [lat, lon] = gps;
      } catch {
        const ip = await getIPLocation();
        if (!ip) return;
        [lat, lon] = ip.coords;
      }
    } else {
      const ip = await getIPLocation();
      if (!ip) return;
      [lat, lon] = ip.coords;
    }
    const url  = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weathercode,windspeed_10m&timezone=auto&forecast_days=1`;
    const data = await (await fetch(url)).json() as {
      current: { temperature_2m: number; weathercode: number; windspeed_10m: number };
    };
    const { temperature_2m: temp, weathercode: code, windspeed_10m: wind } = data.current;
    if (code > 3 || temp < 8 || temp > 30 || wind >= 30) return;

    await sendPushToSelf(
      'Idealna pogoda na trening! 🌤️',
      `${code === 0 ? '☀️' : '🌤️'} ${Math.round(temp)}°C — wychodź!`,
    );
    localStorage.setItem(KEY, String(now));
  } catch { /* ignoruj */ }
}

// ── Eksponuj do testów z konsoli ──────────────────────────────────────────────
// Użycie: window.testPush('Test', 'Treść')

export async function testPushNotification(
  title = 'Mapty Test',
  body  = 'Push notifications działają! 🎉',
): Promise<void> {
  await sendPushToSelf(title, body);
}

(window as unknown as Record<string, unknown>).testPush = testPushNotification;
(window as unknown as Record<string, unknown>).getMyUserId = getUserId;
