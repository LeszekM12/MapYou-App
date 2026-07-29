// ─── AUTH FETCH (Faza 3) ─────────────────────────────────────────────────────
// src/modules/authFetch.ts
//
// JEDNO miejsce, w którym cała apka dostaje nagłówek Authorization.
// Zamiast edytować ~174 wywołania fetch w 20 plikach, podmieniamy globalny
// window.fetch: każde żądanie na BACKEND_URL wychodzi z `Bearer <token>`.
// Wywołania na inne domeny (Mapbox, Open-Meteo, kafelki) są nietykane.
//
// Kolejność startu (KRYTYCZNE): installAuthFetch() musi być wywołane na samej
// górze main.ts, zanim jakikolwiek moduł zdąży wykonać żądanie.
//
// Token dostarcza authService przez setTokenProvider() — pośrednio, żeby nie
// było cyklu importów (authService sam używa fetch).
import { BACKEND_URL } from '../config.js';
let _getToken = async () => null;
let _installed = false;
let _onUnauthorized = null;
/** authService rejestruje tu funkcję zwracającą świeży Firebase ID token. */
export function setTokenProvider(fn) {
    _getToken = fn;
}
/** Opcjonalny hook: co zrobić, gdy backend odpowie 401 mimo tokena
 *  (np. pokaż ekran logowania ponownie). */
export function setOnUnauthorized(fn) {
    _onUnauthorized = fn;
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
        // Tylko nasze API — reszta świata bez zmian
        if (!url.startsWith(BACKEND_URL))
            return original(input, init);
        const token = await _getToken();
        if (!token)
            return original(input, init); // przed zalogowaniem (np. /auth/session robi to sam)
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