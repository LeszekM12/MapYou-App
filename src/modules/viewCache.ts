// ─── TRWALY CACHE WIDOKOW ────────────────────────────────────────────────────
// src/modules/viewCache.ts
//
// PROBLEM, KTORY TO ROZWIAZUJE
// ────────────────────────────
// Po ubiciu apki i ponownym wejsciu feed byl pusty, Explore pokazywal „nic tu
// nie ma", a znajomi znikali — dopoki nie doszla odpowiedz z serwera.
//
// Przyczyny byly dwie i obie architektoniczne:
//
//   1. Cache feedu siedzial w `sessionStorage`. Na iOS WKWebView ta pamiec
//      GINIE razem z procesem apki. Wiec dzialal tylko dopoki nie zamknales
//      aplikacji — czyli dokladnie wtedy, gdy nie byl potrzebny.
//
//   2. Explore nie mial cache W OGOLE. Kazde wejscie to czekanie na siec,
//      a przy jej braku ekran bledu.
//
// JAK ROBIA TO APLIKACJE, KTORE DZIALAJA DOBRZE
// Zasada nazywa sie „stale-while-revalidate" i jest ta sama w X, Instagramie
// i Facebooku: POKAZ NATYCHMIAST TO, CO MASZ, a swiezych danych poszukaj
// w tle. Uzytkownik nigdy nie oglada pustego ekranu, jesli cokolwiek widzial
// wczesniej. Ekran ladowania nalezy sie WYLACZNIE komus, kto nie widzial
// jeszcze nic.
//
// DLACZEGO INDEXEDDB, A NIE localStorage
//   • `localStorage` ma ~5 MB i jest SYNCHRONICZNY — kazdy odczyt blokuje
//     glowny watek, a feed z awatarami potrafi wazyc setki kilobajtow.
//   • IndexedDB jest asynchroniczny, miesci setki megabajtow i przezywa
//     ubicie procesu.
//   • `requestPersistentStorage()` (juz wolane w `main.ts`) chroni go przed
//     skasowaniem przez system.
//
// KOSZT: ZERO. Wszystko dzieje sie na urzadzeniu — zadnego ruchu do serwera,
// zadnego miejsca w Atlasie, zadnej oplaty.

import { db } from './db.js';
import { dlog } from '../utils/log.js';

export interface CacheEntry<T> {
  key:   string;
  value: T;
  at:    number;   // kiedy zapisano (ms)
}

/** Ile wpisow trzymamy. Powyzej — kasujemy najstarsze.
 *
 *  Bez limitu cache rosnie w nieskonczonosc: kazdy oglądany profil, kazdy
 *  klub, kazda zakladka zostawia wpis. Sto pozycji to z zapasem wiecej niz
 *  ktokolwiek odwiedzi w jednej sesji, a nadal ulamek dostepnego miejsca. */
const MAX_WPISOW = 100;

/** Po tym czasie dane uznajemy za nieswieze — ale NADAL JE POKAZUJEMY.
 *  Wiek sluzy tylko do decyzji „czy warto odswiezyc w tle", nigdy do
 *  decyzji „czy pokazac". To jest sedno tego podejscia. */
export const SWIEZE_MS = 60_000;

function tabela() {
  return (db as unknown as Record<string, {
    get:    (k: string) => Promise<CacheEntry<unknown> | undefined>;
    put:    (v: CacheEntry<unknown>) => Promise<unknown>;
    delete: (k: string) => Promise<unknown>;
    toArray:() => Promise<Array<CacheEntry<unknown>>>;
    clear:  () => Promise<unknown>;
  }>).viewCache;
}

/** Odczytaj z cache. `null` = nigdy tego nie widzielismy. */
export async function odczytaj<T>(key: string): Promise<{ value: T; wiek: number } | null> {
  try {
    const e = await tabela().get(key);
    if (!e) return null;
    return { value: e.value as T, wiek: Date.now() - e.at };
  } catch { return null; }
}

/** Zapisz do cache. Bledy sa cicho pomijane — cache nigdy nie moze
 *  przewrocic widoku, ktory i tak ma juz dane. */
export async function zapisz<T>(key: string, value: T): Promise<void> {
  try {
    await tabela().put({ key, value, at: Date.now() });
    void sprzataj();
  } catch { /* brak miejsca albo baza zajeta — trudno */ }
}

/** Usun najstarsze wpisy ponad limit. */
async function sprzataj(): Promise<void> {
  try {
    const wszystkie = await tabela().toArray();
    if (wszystkie.length <= MAX_WPISOW) return;
    const doUsuniecia = wszystkie
      .sort((a, b) => a.at - b.at)
      .slice(0, wszystkie.length - MAX_WPISOW);
    for (const e of doUsuniecia) await tabela().delete(e.key);
    dlog(`[viewCache] usunieto ${doUsuniecia.length} starych wpisow`);
  } catch { /* noop */ }
}

/** Wyczysc CALY cache widokow. Wolane przy wylogowaniu i zmianie konta —
 *  inaczej nastepny uzytkownik zobaczylby feed poprzedniego. */
export async function wyczysc(): Promise<void> {
  try { await tabela().clear(); dlog('[viewCache] wyczyszczony'); }
  catch { /* noop */ }
}

// ─── STALE-WHILE-REVALIDATE ──────────────────────────────────────────────────

export interface SwrOpcje<T> {
  /** Klucz cache. Powinien zawierac userId, zeby konta sie nie mieszaly. */
  key: string;
  /** Skad wziac swieze dane. `null` = nie udalo sie (offline, blad, timeout). */
  pobierz: () => Promise<T | null>;
  /** Rysuj. Wolane RAZ z cache (jesli jest) i RAZ ze swiezymi danymi
   *  (jesli przyszly i sie roznia). */
  rysuj: (dane: T, zrodlo: 'cache' | 'siec') => void;
  /** Gdy nie ma ani cache, ani sieci — pokaz stan pusty albo blad. */
  pusto?: () => void;
  /** Gdy nie ma cache, a siec jeszcze trwa — pokaz szkielet.
   *  NIE jest wolane, gdy cache istnieje: wtedy uzytkownik widzi tresc,
   *  a nie animacje ladowania. */
  szkielet?: () => void;
  /** Porownanie, zeby nie przerysowywac przy identycznych danych.
   *  Przerysowanie gubi pozycje przewijania i mruga — robimy je tylko
   *  wtedy, gdy naprawde jest co zmienic. */
  sygnatura?: (dane: T) => string;
  /** Czy widok nadal jest na ekranie. Gdy uzytkownik odszedl, nie rysujemy. */
  aktualny?: () => boolean;
}

/**
 * Pokaz natychmiast to, co masz — a swiezych danych poszukaj w tle.
 *
 * Kolejnosc jest zawsze taka sama i to ona daje wrazenie natychmiastowosci:
 *
 *   1. Jest cache?  → RYSUJ OD RAZU (zero czekania, takze bez sieci)
 *   2. Nie ma?      → pokaz szkielet, zeby bylo widac, ze cos sie dzieje
 *   3. Pobierz w tle
 *   4. Przyszlo i sie rozni? → przerysuj
 *   5. Nie przyszlo, a byl cache? → ZOSTAW cache. Lepiej dane sprzed minuty
 *      niz komunikat o bledzie.
 *   6. Nie przyszlo i nie bylo cache? → dopiero teraz stan pusty
 */
export async function swr<T>(o: SwrOpcje<T>): Promise<void> {
  const nadal = o.aktualny ?? (() => true);

  const zCache = await odczytaj<T>(o.key);
  let pokazanaSygnatura: string | null = null;

  if (zCache) {
    if (!nadal()) return;
    o.rysuj(zCache.value, 'cache');
    pokazanaSygnatura = o.sygnatura ? o.sygnatura(zCache.value) : null;
    // Swieze dane? Nie zawracamy glowy siecia.
    if (zCache.wiek < SWIEZE_MS) {
      dlog(`[viewCache] ${o.key}: swieze (${Math.round(zCache.wiek / 1000)} s)`);
      return;
    }
  } else {
    o.szkielet?.();
  }

  const swieze = await o.pobierz();

  if (!swieze) {
    // Siec zawiodla. Cache zostaje na ekranie — bez migania, bez bledu.
    if (!zCache) o.pusto?.();
    return;
  }

  await zapisz(o.key, swieze);
  if (!nadal()) return;

  const nowaSygnatura = o.sygnatura ? o.sygnatura(swieze) : null;
  if (pokazanaSygnatura !== null && nowaSygnatura === pokazanaSygnatura) {
    dlog(`[viewCache] ${o.key}: bez zmian, nie przerysowuje`);
    return;
  }
  o.rysuj(swieze, 'siec');
}

// ─── NARZEDZIE DIAGNOSTYCZNE ─────────────────────────────────────────────────

(window as unknown as Record<string, unknown>).mapyouCache =
  async (purge = false): Promise<unknown> => {
    if (purge) { await wyczysc(); return 'Cache widokow wyczyszczony.'; }
    try {
      const w = await tabela().toArray();
      if (!w.length) return 'Cache pusty.';
      return w
        .sort((a, b) => b.at - a.at)
        .map(e => ({
          klucz: e.key,
          wiek_s: Math.round((Date.now() - e.at) / 1000),
          rozmiar_kb: Math.round(JSON.stringify(e.value).length / 1024),
        }));
    } catch { return 'Cache niedostepny.'; }
  };
