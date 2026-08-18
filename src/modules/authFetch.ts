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
import { getAppCheckTokenNow } from './appCheck.js';

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

/** Odczyty aktualnie w locie — patrz „SCALANIE IDENTYCZNYCH ODCZYTOW". */
const _inflightGet = new Map<string, Promise<Response>>();

/** Wyslij i zarejestruj, zeby rownolegle takie same odczyty mogly sie dolaczyc. */
function wyslijRaz(
  url: string, metoda: string,
  wyslij: () => Promise<Response>,
): Promise<Response> {
  if (metoda !== 'GET') return wyslij();
  const p = wyslij().finally(() => { _inflightGet.delete(url); });
  _inflightGet.set(url, p);
  return p.then(r => r.clone());
}

/** authService rejestruje tu funkcję zwracającą świeży Firebase ID token. */
export function setTokenProvider(fn: TokenProvider): void {
  _getToken = fn;
}

/** Token dla żądań, które NIE przechodzą przez `authFetch`.
 *
 *  Istnieje z powodu `uploadMediaFile`, które używa `XMLHttpRequest` — bo tylko
 *  XHR raportuje postęp wysyłki, a przy zdjęciach i filmach pasek postępu ma
 *  znaczenie. Skutkiem ubocznym było jednak to, że wysyłka omijała `authFetch`
 *  i leciała BEZ TOKENA, a `POST /upload/media` ma `requireAuth`.
 *
 *  Objaw: wybrane zdjęcie nie pojawiało się w galerii i nie zapisywało —
 *  serwer odrzucał je z 401, a klient dostawał `null` i po cichu je pomijał.
 *
 *  Każdy inny kod powinien używać zwykłego `fetch`, który dokłada token sam. */
export async function pobierzTokenDlaXhr(): Promise<string | null> {
  try { return await _getToken(); } catch { return null; }
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

    // ── SCALANIE IDENTYCZNYCH ODCZYTOW ──────────────────────────────────────
    //
    // Pomiar przy starcie: 47 zadan, z czego 28 to DUPLIKATY.
    //   /feed/likes/batch  — 11 razy    /feed        — 7 razy
    //   /reels/feed        —  7 razy    /live/active — 3 razy (kazdy)
    // Lacznie ~4,8 s zmarnowanego czasu sieci na pobieranie tego samego.
    //
    // Dlaczego to bylo odczuwalne, skoro glowny watek byl wolny (profiler
    // pokazywal zero zastojow): przegladarka utrzymuje ~6 jednoczesnych
    // polaczen z jednym hostem. Przy 47 zadaniach reszta stoi w KOLEJCE.
    // Zadanie wywolane Twoim dotknieciem ladowalo na jej koncu i czekalo
    // sekunde albo dwie. Przycisk reagowal od razu, akcja — nie.
    //
    // Rozwiazanie: gdy identyczny ODCZYT jest juz w locie, drugi go nie
    // powtarza, tylko czeka na ten sam wynik. Kazdy dostaje wlasna kopie
    // odpowiedzi (`clone`), bo tresci odpowiedzi nie da sie odczytac dwa razy.
    //
    // Scalamy WYLACZNIE metode GET i tylko na czas lotu — nic nie jest
    // pamietane dluzej, wiec swiezosc danych sie nie zmienia.
    const metoda = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (metoda === 'GET') {
      const wLocie = _inflightGet.get(url);
      if (wLocie) return wLocie.then(r => r.clone());
    }

    // Token dolaczamy dopiero, gdy sesja MapYou jest gotowa. Wczesniej
    // zachowujemy sie jak gosc — inaczej chronione endpointy odrzucaja
    // zadania z bledem „Account not linked".
    const token = _sessionReady ? await _getToken() : null;

    // ── Tryb gościa ──────────────────────────────────────────────────────────
    if (!token) {
      if (isGuestAllowed(url)) {
        // Nawet zadania goscia (logowanie, planowanie trasy) niosa App Check —
        // to wlasnie one sa celem masowego naduzycia z przepisanym kluczem.
        // Bez czekania. Ta sciezka obsluguje m.in. `/auth/session`, czyli
        // pierwsze zadanie po starcie — i to ona czekala NAJDLUZEJ, bo nie
        // miala nawet limitu czasu. W pomiarze: 716 ms na jedno zadanie.
        const ac = getAppCheckTokenNow();
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
    // App Check NIE MOZE opozniac zadania.
    //
    // `getToken()` schodzi do natywnego App Attest, a ten przy limicie prób
    // potrafi wisiec sekundami. Kazde zadanie do backendu czekalo wiec na
    // cos, co jest CALKOWICIE opcjonalne — i cala apka zwalniala.
    // Dwie sekundy albo lecimy bez naglowka; backend jest w trybie audytu
    // i tak go nie wymaga.
    // Zero czekania — token albo jest w pamieci, albo lecimy bez niego.
    // Poprzednie `Promise.race` z limitem 2 s wygladalo na zabezpieczenie,
    // ale w praktyce oznaczalo, ze KAZDE wczesne zadanie moglo stracic
    // do dwoch sekund. Backend jest w trybie audytu i naglowka nie wymaga.
    const appCheck = getAppCheckTokenNow();
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
      // Przez `wyslijRaz`, zeby rownolegle identyczne odczyty scalily sie
      // w jedno zadanie zamiast zapychac limit polaczen.
      res = await wyslijRaz(url, metoda, () => original(input, { ...init, headers }));
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
            const { confirmFromServer } = await import('./socialStore.js');
            confirmFromServer(req.itemId, d.count, !!d.liked);
          }
        } catch { /* nie blokujemy odpowiedzi */ }
      })();
    }

    // Token wygasł/nieprawidłowy → jedna próba z odświeżonym tokenem
    if (res.status === 401) {
      // 401 znaczy, ze token jest nieaktualny — cache trzeba wyrzucic,
      // inaczej dostalibysmy z powrotem ten sam, odrzucony token.
      try {
        const { invalidateIdToken } = await import('./authService.js');
        invalidateIdToken();
      } catch { /* modul niedostepny — probujemy dalej */ }
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
