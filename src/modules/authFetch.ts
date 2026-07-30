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

type TokenProvider = () => Promise<string | null>;

let _getToken: TokenProvider = async () => null;
let _installed = false;
let _onUnauthorized: (() => void) | null = null;

/** Ścieżki działające bez konta (tryb gościa). Wszystko inne jest blokowane
 *  lokalnie, dopóki użytkownik się nie zaloguje. */
const GUEST_ALLOWED = [
  '/auth/',        // samo logowanie / wymiana sesji
  '/directions',   // planowanie trasy A→B
  '/loop',         // trasy pętlowe
  '/health',       // health check
  '/recover',      // kod odzyskiwania (migracja starego konta)
];

function isGuestAllowed(url: string): boolean {
  const path = url.slice(BACKEND_URL.length);
  return GUEST_ALLOWED.some(p => path.startsWith(p));
}

/** authService rejestruje tu funkcję zwracającą świeży Firebase ID token. */
export function setTokenProvider(fn: TokenProvider): void {
  _getToken = fn;
}

/** Opcjonalny hook: co zrobić, gdy backend odpowie 401 mimo tokena. */
export function setOnUnauthorized(fn: () => void): void {
  _onUnauthorized = fn;
}

/** Syntetyczna odpowiedź dla trybu gościa — bez ruchu sieciowego. */
function guestBlocked(): Response {
  return new Response(
    JSON.stringify({ status: 'error', message: 'guest', code: 'NOT_SIGNED_IN' }),
    { status: 401, headers: { 'Content-Type': 'application/json' } },
  );
}

export function installAuthFetch(): void {
  if (_installed) return;
  _installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input
      : input instanceof URL ? input.href
      : input.url;

    // Tylko nasze API — reszta świata bez zmian (kafelki OSM, pogoda itd.)
    if (!url.startsWith(BACKEND_URL)) return original(input, init);

    const token = await _getToken();

    // ── Tryb gościa ──────────────────────────────────────────────────────────
    if (!token) {
      if (isGuestAllowed(url)) return original(input, init);
      return guestBlocked();   // cicho, bez sieci, bez spamu w logu
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    const res = await original(input, { ...init, headers });

    // Token wygasł/nieprawidłowy → jedna próba z odświeżonym tokenem
    if (res.status === 401) {
      const fresh = await _getToken();
      if (fresh && fresh !== token) {
        headers.set('Authorization', `Bearer ${fresh}`);
        const retry = await original(input, { ...init, headers });
        if (retry.status !== 401) return retry;
      }
      _onUnauthorized?.();
    }

    return res;
  };
}
