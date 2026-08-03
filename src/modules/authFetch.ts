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
import { dlog, dwarn } from '../utils/log.js';
import { getAppCheckToken } from './appCheck.js';

type TokenProvider = () => Promise<string | null>;

let _getToken: TokenProvider = async () => null;
let _installed = false;
let _onUnauthorized: (() => void) | null = null;

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

/** Czy sesja MapYou jest gotowa — moduly synchronizacji sprawdzaja to,
 *  zeby nie mielic setek rekordow, ktore i tak zostana odciete. */
export function isSessionReady(): boolean { return _sessionReady; }

// Subskrybenci czekajacy na gotowa sesje (Faza 4).
// Bramka `isSessionReady()` wystarcza modulom, ktore i tak sa wolane
// wielokrotnie (sync, hydratacja). Rejestracja tokena FCM zdarza sie
// DOKLADNIE RAZ przy starcie — jesli trafi przed sesje, odbija sie od 401
// i nikt nie ponawia, wiec urzadzenie zostaje bez powiadomien do nastepnego
// uruchomienia. Taki modul musi miec jak poczekac.
const _readyWaiters: Array<() => void> = [];

/** Wykonaj `fn`, gdy sesja bedzie gotowa (albo od razu, jesli juz jest). */
export function onSessionReady(fn: () => void): void {
  if (_sessionReady) { fn(); return; }
  _readyWaiters.push(fn);
}

/** Ustaw po udanej wymianie /auth/session (i wyzeruj przy wylogowaniu). */
export function setSessionReady(ready: boolean): void {
  _sessionReady = ready;
  dlog(`[authFetch] sesja MapYou ${ready ? 'gotowa' : 'niegotowa'}`);
  if (ready && _readyWaiters.length) {
    const waiting = _readyWaiters.splice(0);
    waiting.forEach(fn => { try { fn(); } catch (e) { console.warn('[authFetch] subskrybent sesji rzucil blad:', e); } });
  }
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

    // Token dolaczamy dopiero, gdy sesja MapYou jest gotowa. Wczesniej
    // zachowujemy sie jak gosc — inaczej chronione endpointy odrzucaja
    // zadania z bledem „Account not linked".
    const token = _sessionReady ? await _getToken() : null;

    // ── Tryb gościa ──────────────────────────────────────────────────────────
    if (!token) {
      if (isGuestAllowed(url)) {
        // Nawet zadania goscia (logowanie, planowanie trasy) niosa App Check —
        // to wlasnie one sa celem masowego naduzycia z przepisanym kluczem.
        const ac = await getAppCheckToken();
        if (!ac) return original(input, init);
        const gh = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        gh.set('X-Firebase-AppCheck', ac);
        return original(input, { ...init, headers: gh });
      }
      dwarn(
        `[authFetch] ODCIETE (${_sessionReady ? 'sesja gotowa, ale BRAK TOKENA' : 'brak sesji'}): ` +
        url.slice(BACKEND_URL.length),
      );
      return guestBlocked();
    }

    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token}`);

    // App Check — dowod, ze zadanie idzie z prawdziwej apki, nie ze skryptu.
    // Naglowek dokladamy WYLACZNIE tutaj, czyli tylko dla `BACKEND_URL`
    // (sprawdzone wyzej). Gdyby poszedl szerzej, token wyciekalby do
    // Cloudinary, Mapboxa i CARTO — a on identyfikuje Twoja instalacje.
    const appCheck = await getAppCheckToken();
    if (appCheck) headers.set('X-Firebase-AppCheck', appCheck);

    // ── Zapisy: kolejka offline (Etap 2) ────────────────────────────────────
    //
    // Wszystkie zadania do backendu przechodza przez ten jeden punkt, wiec
    // kolejke wpinamy TUTAJ — zamiast przerabiac 92 wywolania w 19 plikach.
    //
    // Lapiemy WYLACZNIE bledy sieci (wyjatek z `fetch`). Odpowiedz 4xx/5xx
    // to nie brak polaczenia — serwer odpowiedzial i wolajacy ma prawo
    // zobaczyc jego odpowiedz.
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

    let res: Response;
    try {
      res = await original(input, { ...init, headers });
    } catch (netErr) {
      // Jesli to zadanie POCHODZI z kolejki, nie wolno go zakolejkowac ponownie —
      // inaczej kazda nieudana proba mnozylaby wpisy i kolejka rosla w
      // nieskonczonosc zamiast sie oprozniac.
      const isReplay = headers.get('X-Outbox-Replay') === '1'
        || (init?.headers as Record<string, string> | undefined)?.['X-Outbox-Replay'] === '1';
      if (isReplay) throw netErr;

      const { isQueueable, enqueue } = await import('./outbox.js');
      if (!isQueueable(url, method)) throw netErr;

      const plain: Record<string, string> = {};
      headers.forEach((v, k) => { plain[k] = v; });
      const body = typeof init?.body === 'string' ? init.body : null;

      // Cialo nietekstowe (FormData, Blob) sie nie serializuje — nie da sie
      // go odlozyc bez utraty zawartosci, wiec przepuszczamy blad dalej.
      if (init?.body && body === null) throw netErr;

      await enqueue(url, method, plain, body);

      // ── Polubienia: odpowiedz MUSI wygladac jak prawdziwa ──────────────
      //
      // Wolajacy odczytuje z niej `{ liked, count }` i wpisuje wprost do DOM.
      // Odpowiedz „queued" tych pol nie ma, wiec pod sercem ladowal napis
      // `undefined` albo zero.
      //
      // Latanie tego w widokach okazalo sie bledem — kazde polubienie ma
      // wlasna sciezke (karta posta, karta aktywnosci, szczegoly, reels)
      // i przy kazdej poprawce znajdowala sie kolejna, nieuwzgledniona.
      // Dlatego liczymy nowy stan TUTAJ, w jedynym miejscu, przez ktore
      // przechodza wszystkie bez wyjatku, i oddajemy dokladnie ten ksztalt,
      // ktorego kod juz oczekuje.
      if (url.includes('/feed/like') && body) {
        try {
          const req = JSON.parse(body) as { itemId?: string };
          if (req.itemId) {
            const { toggleLike } = await import('./socialStore.js');
            const { liked, count } = toggleLike(req.itemId);
            return new Response(JSON.stringify({ status: 'ok', liked, count }),
              { status: 200, headers: { 'Content-Type': 'application/json' } });
          }
        } catch { /* nieparsowalne cialo — lecimy dalej */ }
      }

      // Odpowiedz zastepcza. 202 = „przyjeto do realizacji" — wolajacy widzi
      // sukces, a zapis wyjdzie, gdy siec wroci.
      return new Response(
        JSON.stringify({ status: 'queued', message: 'Saved locally — will sync when back online.' }),
        { status: 202, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Polubienie poszlo na serwer — zapisz odpowiedz w magazynie, zeby
    // wszystkie widoki (takze te niewidoczne w tej chwili) mialy aktualny stan.
    if (res.ok && url.includes('/feed/like')) {
      void (async () => {
        try {
          const sent = typeof init?.body === 'string' ? init.body : null;
          if (!sent) return;
          const req = JSON.parse(sent) as { itemId?: string };
          const d   = await res.clone().json() as { liked?: boolean; count?: number };
          if (req.itemId && typeof d.count === 'number') {
            const { set } = await import('./socialStore.js');
            set(req.itemId, { liked: !!d.liked, likes: d.count, fromServer: true });
          }
        } catch { /* nie blokujemy odpowiedzi */ }
      })();
    }

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
