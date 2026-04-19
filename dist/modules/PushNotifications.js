// ─── PUSH NOTIFICATIONS MODULE ───────────────────────────────────────────────
// Plik: src/modules/PushNotifications.ts
// Importuj i wywołaj initPushNotifications() po załadowaniu mapy.
const BACKEND_URL = 'https://mapty-backend-lexb.onrender.com';
// ── Helper: konwersja base64 → Uint8Array (wymagane przez pushManager) ────────
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}
// ── Krok 1: Rejestracja push-sw.js ───────────────────────────────────────────
async function registerPushSW() {
    if (!('serviceWorker' in navigator)) {
        console.warn('[Push] Service Worker not supported');
        return null;
    }
    try {
        // Rejestruj push-sw.js obok głównego sw.js
        // Ścieżka relative do lokalizacji aplikacji (działa zarówno na GitHub Pages jak i lokalnie)
        const swPath = new URL('push-sw.js', window.location.href).pathname;
        const reg = await navigator.serviceWorker.register(swPath, {
            scope: new URL('./', window.location.href).pathname,
        });
        console.log('[Push] push-sw.js registered, scope:', reg.scope);
        return reg;
    }
    catch (err) {
        console.error('[Push] SW registration failed:', err);
        return null;
    }
}
// ── Krok 2: Pobierz klucz VAPID z backendu ────────────────────────────────────
async function fetchVapidPublicKey() {
    try {
        const res = await fetch(`${BACKEND_URL}/push/vapid-public-key`);
        const data = await res.json();
        console.log('[Push] VAPID public key fetched');
        return data.publicKey;
    }
    catch (err) {
        console.error('[Push] Failed to fetch VAPID key:', err);
        return null;
    }
}
// ── Krok 3: Poproś o zgodę na powiadomienia ───────────────────────────────────
async function requestPermission() {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
        console.warn('[Push] Notification permission denied:', permission);
        return false;
    }
    console.log('[Push] Notification permission granted');
    return true;
}
// ── Krok 4: Utwórz subskrypcję push ──────────────────────────────────────────
async function subscribeToPush(reg, vapidPublicKey) {
    try {
        // Sprawdź czy już jest aktywna subskrypcja
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
            console.log('[Push] Already subscribed');
            return existing;
        }
        const subscription = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey).buffer,
        });
        console.log('[Push] New subscription created');
        return subscription;
    }
    catch (err) {
        console.error('[Push] Subscribe failed:', err);
        return null;
    }
}
// ── Krok 5: Wyślij subskrypcję do backendu ────────────────────────────────────
async function sendSubscriptionToBackend(subscription) {
    try {
        const res = await fetch(`${BACKEND_URL}/push/subscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(subscription),
        });
        const data = await res.json();
        if (!res.ok) {
            console.error('[Push] Backend rejected subscription:', data.message);
            return false;
        }
        console.log('[Push] Subscription sent to backend:', data.message, data.id);
        return true;
    }
    catch (err) {
        console.error('[Push] Failed to send subscription:', err);
        return false;
    }
}
// ── Krok 6: Wyrejestruj subskrypcję ──────────────────────────────────────────
export async function unsubscribeFromPush() {
    if (!('serviceWorker' in navigator))
        return;
    const reg = await navigator.serviceWorker.getRegistration(new URL('push-sw.js', window.location.href).pathname);
    if (!reg)
        return;
    const sub = await reg.pushManager.getSubscription();
    if (!sub)
        return;
    // Usuń z backendu
    try {
        await fetch(`${BACKEND_URL}/push/unsubscribe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint }),
        });
    }
    catch { /* ignoruj błąd sieciowy */ }
    // Usuń lokalnie
    await sub.unsubscribe();
    console.log('[Push] Unsubscribed');
}
// ── Główna funkcja — wywołaj ją po załadowaniu aplikacji ─────────────────────
export async function initPushNotifications() {
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
    if (!reg)
        return;
    // Krok 2
    const vapidKey = await fetchVapidPublicKey();
    if (!vapidKey)
        return;
    // Krok 3 — poproś o zgodę tylko jeśli jeszcze nie udzielona
    if (Notification.permission !== 'granted') {
        const granted = await requestPermission();
        if (!granted)
            return;
    }
    // Krok 4
    const subscription = await subscribeToPush(reg, vapidKey);
    if (!subscription)
        return;
    // Krok 5
    await sendSubscriptionToBackend(subscription);
}
// ── Testowa funkcja — wywołaj z konsoli przeglądarki ─────────────────────────
// window.testPush('Trening ukończony!', 'Świetna robota! +5km 🏃')
export async function testPushNotification(title = 'Mapty Test', body = 'Push notifications działają! 🎉') {
    try {
        const res = await fetch(`${BACKEND_URL}/push/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body, url: '/' }),
        });
        const data = await res.json();
        console.log('[Push] Test sent:', data);
    }
    catch (err) {
        console.error('[Push] Test failed:', err);
    }
}
// ── Re-subskrypcja przy każdym starcie ────────────────────────────────────────
export async function resubscribeIfNeeded() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window))
        return;
    if (Notification.permission !== 'granted')
        return;
    try {
        const reg = await navigator.serviceWorker.getRegistration(new URL('push-sw.js', window.location.href).pathname);
        if (!reg)
            return;
        const sub = await reg.pushManager.getSubscription();
        if (!sub)
            return;
        await sendSubscriptionToBackend(sub);
        console.log('[Push] Re-subscribed after potential backend restart');
    }
    catch (err) {
        console.warn('[Push] resubscribeIfNeeded failed:', err);
    }
}
// ── Push triggers ─────────────────────────────────────────────────────────────
async function sendPush(title, body) {
    try {
        await fetch(`${BACKEND_URL}/push/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, body }),
        });
    }
    catch (err) {
        console.warn('[Push] sendPush failed:', err);
    }
}
export async function sendWorkoutAddedPush() {
    await sendPush('Nowy trening zapisany! 💪', 'Świetna robota! Tak trzymaj!');
}
export async function sendActivityFinishedPush(sport, distanceKm, durationSec) {
    const sportEmoji = {
        running: '🏃',
        walking: '🚶',
        cycling: '🚴',
    };
    const emoji = sportEmoji[sport] ?? '🏅';
    const h = Math.floor(durationSec / 3600);
    const m = Math.floor((durationSec % 3600) / 60);
    const timeStr = h > 0 ? `${h}h ${m}min` : `${m}min`;
    const dist = distanceKm.toFixed(2);
    await sendPush(`${emoji} Aktywność zakończona!`, `${dist} km · ${timeStr} — nieźle! Zapisano w historii.`);
}
export async function sendWorkoutDeletedPush() {
    await sendPush('Trening usunięty.', 'Chcesz go przywrócić? Wróć do aplikacji.');
}
export async function sendWelcomeBackPush() {
    await sendPush('Witaj ponownie! 👋', 'Gotowy na kolejny trening?');
}
export async function sendLongBreakPush() {
    const KEY = 'mapty_last_open';
    const now = Date.now();
    const last = Number(localStorage.getItem(KEY) ?? 0);
    localStorage.setItem(KEY, String(now));
    if (last > 0 && (now - last) / (1000 * 60 * 60) > 24) {
        await sendPush('Miło Cię widzieć ponownie! 🏃', 'Co dziś robimy? Czas na trening!');
        return true;
    }
    return false;
}
export async function sendArrivedAtDestinationPush() {
    await sendPush('Dotarłeś na miejsce! 🎯', 'Chcesz zapisać trasę? Wróć do aplikacji.');
}
export async function sendWeatherPush() {
    const KEY = 'mapty_last_weather_push';
    const now = Date.now();
    if ((now - Number(localStorage.getItem(KEY) ?? 0)) / (1000 * 60 * 60) < 6)
        return;
    try {
        const coords = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(p => res(p.coords), rej, { timeout: 5000 }));
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.latitude}&longitude=${coords.longitude}&current=temperature_2m,weathercode,windspeed_10m&timezone=auto&forecast_days=1`;
        const data = await (await fetch(url)).json();
        const { temperature_2m: temp, weathercode: code, windspeed_10m: wind } = data.current;
        if (code > 3 || temp < 8 || temp > 30 || wind >= 30)
            return;
        await sendPush('Idealna pogoda na trening! 🏃', `${code === 0 ? '☀️' : '🌤️'} ${Math.round(temp)}°C — wychodź!`);
        localStorage.setItem(KEY, String(now));
    }
    catch { /* ignore */ }
}
// Eksponuj na window do testów z konsoli
window.testPush = testPushNotification;
//# sourceMappingURL=PushNotifications.js.map