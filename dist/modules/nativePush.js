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
function capGlobal() {
    return globalThis.Capacitor;
}
function fmPlugin() {
    const cap = capGlobal();
    if (!cap?.isNativePlatform?.())
        return null;
    return cap.Plugins?.['FirebaseMessaging'] ?? null;
}
/** True when the native FCM path should be used instead of web push. */
export function nativePushAvailable() {
    return fmPlugin() !== null;
}
// ── Token registration ────────────────────────────────────────────────────────
/** The identity the backend routes notifications by. MapYou has two id keys:
 *  the social/profile id (mapyou_userId_profile — used by friends, feed and
 *  every pushToUser call) and the legacy per-device push uuid (mapty_userId).
 *  Tokens MUST be registered under the social id, otherwise notifications
 *  addressed to it never find this device. Fallback covers first-run before
 *  the profile id exists. */
function pushUserId() {
    return localStorage.getItem('mapyou_userId_profile') ?? getUserId();
}
/** Register (or refresh) this device's FCM token on the backend.
 *  Deliberately NOT cached in localStorage: the POST is tiny, runs once per
 *  app start, and makes the client self-healing — if a token rotates or a
 *  server-side record is lost/rebuilt, the next launch silently repairs it.
 *  (A cache here previously masked a server bug for days: registration looked
 *  successful client-side while the token was never actually stored.) */
async function registerToken(token) {
    if (!token)
        return;
    const userId = pushUserId();
    const cap = capGlobal();
    try {
        const res = await fetch(`${BACKEND_URL}/push/subscribe-fcm`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                deviceId: getDeviceId(),
                fcmToken: token,
                platform: cap?.getPlatform?.() ?? 'native',
            }),
        });
        if (res.ok) {
            console.log(`[NativePush] FCM token registered for ${userId}.`);
        }
        else {
            console.warn('[NativePush] subscribe-fcm failed:', res.status);
        }
    }
    catch (e) {
        console.warn('[NativePush] subscribe-fcm error:', e);
    }
}
// ── Deep-link routing ────────────────────────────────────────────────────────
/** Navigate the WebView to the push's target URL. Keeps the current pathname
 *  (GitHub Pages serves the app under /MapYou-App/, so a naive '/…' redirect
 *  would land on the domain root and 404) and applies only query + hash. The
 *  app's existing startup handlers (reels=, #club_open, activity hash) take
 *  over after the reload. */
function routeFromUrl(url) {
    try {
        const u = new URL(url, location.origin);
        if (!u.search && !u.hash)
            return; // plain '/' → just foreground
        location.href = location.pathname + u.search + u.hash;
    }
    catch { /* malformed url — ignore */ }
}
// ── Init ─────────────────────────────────────────────────────────────────────
export async function initNativePush() {
    const p = fmPlugin();
    if (!p)
        return;
    try {
        const perm = await p.requestPermissions();
        if (perm.receive !== 'granted') {
            console.log('[NativePush] permission not granted:', perm.receive);
            return;
        }
    }
    catch (e) {
        console.warn('[NativePush] requestPermissions failed:', e);
        return;
    }
    // Android: notification channels. Importance is FROZEN by the system when a
    // channel is first created — it can never be raised in code afterwards, only
    // by the user in system settings. That's why loud pushes use a dedicated
    // channel id (not the FCM default, which a silent message may already have
    // "christened" as quiet): sound + heads-up are guaranteed from the start.
    if (capGlobal()?.getPlatform?.() === 'android') {
        try {
            // Android FREEZES a channel's settings at creation — code can never make
            // an existing channel louder. Early builds created 'mapyou_alerts' with a
            // broken `sound` value (nonexistent res/raw file → permanently silent
            // channel). The only fix that reaches every affected install: delete the
            // frozen channel and recreate under a NEW id. Backend sends to the v2 id.
            try {
                await p.deleteChannel({ id: 'mapyou_alerts' });
            }
            catch { /* absent — fine */ }
            await p.createChannel({
                id: 'mapyou_alerts_v2', name: 'Powiadomienia MapYou',
                description: 'Polubienia, obserwacje, komentarze i aktywność znajomych',
                importance: 5, // MAX — heads-up banner + system default sound.
                // NOTE: no `sound` field on purpose — it expects a
                // file name in res/raw; pointing it at a missing
                // resource silently yields a SILENT channel.
                visibility: 1, vibration: true, lights: true,
            });
            await p.createChannel({
                id: 'silent', name: 'Ciche powiadomienia',
                description: 'Pogoda i przypomnienia — bez dźwięku',
                importance: 2, // LOW — status bar only, no sound
                visibility: 1, vibration: false,
            });
        }
        catch { /* exists or unsupported — fine */ }
    }
    // Token refresh (FCM rotates tokens occasionally)
    void p.addListener('tokenReceived', (event) => {
        const token = event?.token;
        if (token)
            void registerToken(token);
    });
    // Tap on a notification (foreground, background AND cold start — the plugin
    // replays the launching tap once the listener is attached).
    void p.addListener('notificationActionPerformed', (event) => {
        const data = event
            ?.notification?.data;
        const url = typeof data?.url === 'string' ? data.url : null;
        if (url)
            routeFromUrl(url);
    });
    try {
        const { token } = await p.getToken();
        await registerToken(token);
    }
    catch (e) {
        console.warn('[NativePush] getToken failed:', e);
    }
}
//# sourceMappingURL=nativePush.js.map