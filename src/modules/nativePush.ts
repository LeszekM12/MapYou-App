// ─── NATIVE PUSH (FCM: Android + iOS) ────────────────────────────────────────
// Replaces web push inside the Capacitor shells. Web/PWA keeps the existing
// service-worker path (PushNotifications.ts) — main.ts picks one at startup,
// never both, so a device can't receive duplicates.
//
// Plugin: @capacitor-firebase/messaging, read from the global
// Capacitor.Plugins registry (no npm import — no bundler; same pattern as
// health.ts / workoutNotification.ts / liveActivity.ts). On the web the
// plugin is absent, so every call is a safe no-op.
//
// Token flow: getToken() → POST /push/subscribe-fcm {userId, deviceId,
// fcmToken}; the backend keys the record by userId:deviceId, so re-posting a
// refreshed token simply updates the row. The backend send path (firebase-
// admin) already exists — this module is its client counterpart.
//
// Deep links: the backend puts a URL into every push (data.url, e.g.
// '/?reels=abc' or '/#club_open=xyz'). The app already interprets those at
// startup (main.ts reels param, FriendsView/HomeView hash handlers), so a tap
// simply navigates the WebView there — the existing handlers do the rest.
// This covers cold starts too: the tap launches the app, the plugin replays
// the event once our listener is attached, and we navigate.

import { BACKEND_URL } from '../config.js';
import { getUserId, getDeviceId } from './PushNotifications.js';

// ── Plugin access ─────────────────────────────────────────────────────────────

interface FMPlugin {
  requestPermissions(): Promise<{ receive: string }>;
  getToken(): Promise<{ token: string }>;
  createChannel(options: Record<string, unknown>): Promise<void>;
  addListener(eventName: string, listenerFunc: (event: unknown) => void): Promise<unknown>;
}

function capGlobal(): { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean; getPlatform?: () => string } | undefined {
  return (globalThis as unknown as { Capacitor?: ReturnType<typeof capGlobal> }).Capacitor;
}

function fmPlugin(): FMPlugin | null {
  const cap = capGlobal();
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.['FirebaseMessaging'] as FMPlugin | undefined) ?? null;
}

/** True when the native FCM path should be used instead of web push. */
export function nativePushAvailable(): boolean {
  return fmPlugin() !== null;
}

// ── Token registration ────────────────────────────────────────────────────────

const LS_FCM_TOKEN = 'mapyou_fcm_token';

async function registerToken(token: string): Promise<void> {
  if (!token) return;
  if (localStorage.getItem(LS_FCM_TOKEN) === token) return; // already registered
  try {
    const res = await fetch(`${BACKEND_URL}/push/subscribe-fcm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: getUserId(), deviceId: getDeviceId(), fcmToken: token }),
    });
    if (res.ok) {
      localStorage.setItem(LS_FCM_TOKEN, token);
      console.log('[NativePush] FCM token registered.');
    } else {
      console.warn('[NativePush] subscribe-fcm failed:', res.status);
    }
  } catch (e) {
    console.warn('[NativePush] subscribe-fcm error:', e);
  }
}

// ── Deep-link routing ────────────────────────────────────────────────────────

/** Navigate the WebView to the push's target URL. Keeps the current pathname
 *  (GitHub Pages serves the app under /MapYou-App/, so a naive '/…' redirect
 *  would land on the domain root and 404) and applies only query + hash. The
 *  app's existing startup handlers (reels=, #club_open, activity hash) take
 *  over after the reload. */
function routeFromUrl(url: string): void {
  try {
    const u = new URL(url, location.origin);
    if (!u.search && !u.hash) return;             // plain '/' → just foreground
    location.href = location.pathname + u.search + u.hash;
  } catch { /* malformed url — ignore */ }
}

// ── Init ─────────────────────────────────────────────────────────────────────

export async function initNativePush(): Promise<void> {
  const p = fmPlugin();
  if (!p) return;

  try {
    const perm = await p.requestPermissions();
    if (perm.receive !== 'granted') {
      console.log('[NativePush] permission not granted:', perm.receive);
      return;
    }
  } catch (e) {
    console.warn('[NativePush] requestPermissions failed:', e);
    return;
  }

  // Android: channel used by the backend for silent pushes
  // (channelId: 'silent' in the FCM payload). Importance LOW = no sound/heads-up.
  if (capGlobal()?.getPlatform?.() === 'android') {
    try {
      await p.createChannel({ id: 'silent', name: 'Ciche powiadomienia', importance: 2 });
    } catch { /* exists or unsupported — fine */ }
  }

  // Token refresh (FCM rotates tokens occasionally)
  void p.addListener('tokenReceived', (event) => {
    const token = (event as { token?: string } | undefined)?.token;
    if (token) void registerToken(token);
  });

  // Tap on a notification (foreground, background AND cold start — the plugin
  // replays the launching tap once the listener is attached).
  void p.addListener('notificationActionPerformed', (event) => {
    const data = (event as { notification?: { data?: Record<string, unknown> } } | undefined)
      ?.notification?.data;
    const url = typeof data?.url === 'string' ? data.url : null;
    if (url) routeFromUrl(url);
  });

  try {
    const { token } = await p.getToken();
    await registerToken(token);
  } catch (e) {
    console.warn('[NativePush] getToken failed:', e);
  }
}
