// ─── AUTH FETCH (Faza 3) ─────────────────────────────────────────────────────
// src/modules/authFetch.ts
//
// JEDNO miejsce, w którym cała apka dostaje nagłówek Authorization.
// Zamiast edytować ~174 wywołania fetch w 20 plikach, podmieniamy globalny
// window.fetch: każde żądanie na BACKEND_URL wychodzi z `Bearer <token>`.
// Wywołania na inne domeny (kafelki OSM, Mapbox, Open-Meteo) są nietykane.
//
// TRYB GOŚCIA
// Apka działa bez konta (nagrywanie treningów lokalnie w Dexie). Backend po
// Fazie 2 odrzuca wszystko bez tokena, więc zamiast wysyłać żądania na darmo
// i zaśmiecać log setkami 401, odcinamy je lokalnie: zwracamy syntetyczną
// odpowiedź 401 BEZ ruchu sieciowego. Publiczne ścieżki przechodzą normalnie.
//
// Kolejność startu (KRYTYCZNE): installAuthFetch() musi być wywołane na samej
// górze main.ts, zanim jakikolwiek moduł zdąży wykonać żądanie.
import { BACKEND_URL } from '../config.js';
let _getToken = async () => null;
let _installed = false;
let _onUnauthorized = null;
// Czy sesja MapYou jest GOTOWA (po udanym POST /auth/session).
// Samo zalogowanie u Google to za malo: token jest juz wazny, ale konto na
// naszym serwerze nie jest jeszcze powiazane z firebaseUid. Zadania w tle
// (sync, push, hydratacja) ruszaja natychmiast i dostawaly wtedy 403
// „Account not linked". Do czasu ustawienia tej flagi traktujemy ruch jak
// w trybie goscia.
let _sessionReady = false;
/** Ścieżki działające bez konta (tryb gościa). Wszystko inne jest blokowane
 *  lokalnie, dopóki użytkownik się nie zaloguje. */
const GUEST_ALLOWED = [
    '/auth/', // samo logowanie / wymiana sesji
    '/directions', // planowanie trasy A→B
    '/loop', // trasy pętlowe
    '/health', // health check
    '/recover', // kod odzyskiwania (migracja starego konta)
];
function isGuestAllowed(url) {
    const path = url.slice(BACKEND_URL.length);
    return GUEST_ALLOWED.some(p => path.startsWith(p));
}
/** authService rejestruje tu funkcję zwracającą świeży Firebase ID token. */
export function setTokenProvider(fn) {
    _getToken = fn;
}
/** Ustaw po udanej wymianie /auth/session (i wyzeruj przy wylogowaniu). */
export function setSessionReady(ready) {
    _sessionReady = ready;
    console.log(`[authFetch] sesja MapYou ${ready ? 'gotowa' : 'niegotowa'}`);
}
/** Opcjonalny hook: co zrobić, gdy backend odpowie 401 mimo tokena. */
export function setOnUnauthorized(fn) {
    _onUnauthorized = fn;
}
/** Syntetyczna odpowiedź dla trybu gościa — bez ruchu sieciowego. */
function guestBlocked() {
    return new Response(JSON.stringify({ status: 'error', message: 'guest', code: 'NOT_SIGNED_IN' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
}
export function installAuthFetch() {
    if (_installed)
        return;
    _installed = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input
            : input instanceof URL ? input.href
                : input.url;
        // Tylko nasze API — reszta świata bez zmian (kafelki OSM, pogoda itd.)
        if (!url.startsWith(BACKEND_URL))
            return original(input, init);
        // Token dolaczamy dopiero, gdy sesja MapYou jest gotowa. Wczesniej
        // zachowujemy sie jak gosc — inaczej chronione endpointy odrzucaja
        // zadania z bledem „Account not linked".
        const token = _sessionReady ? await _getToken() : null;
        // ── Tryb gościa ──────────────────────────────────────────────────────────
        if (!token) {
            if (isGuestAllowed(url))
                return original(input, init);
            console.warn(`[authFetch] ODCIETE (${_sessionReady ? 'sesja gotowa, ale BRAK TOKENA' : 'brak sesji'}): ` +
                url.slice(BACKEND_URL.length));
            return guestBlocked();
        }
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        if (!headers.has('Authorization'))
            headers.set('Authorization', `Bearer ${token}`);
        const res = await original(input, { ...init, headers });
        // Token wygasł/nieprawidłowy → jedna próba z odświeżonym tokenem
        if (res.status === 401) {
            const fresh = await _getToken();
            if (fresh && fresh !== token) {
                headers.set('Authorization', `Bearer ${fresh}`);
                const retry = await original(input, { ...init, headers });
                if (retry.status !== 401)
                    return retry;
            }
            _onUnauthorized?.();
        }
        return res;
    };
}
//# sourceMappingURL=authFetch.js.map