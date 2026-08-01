// ─── TRWALOSC AKTYWNEGO TRENINGU (Etap 1) ────────────────────────────────────
// src/modules/sessionStore.ts
//
// PROBLEM, KTORY TO ROZWIAZUJE
// ────────────────────────────
// Caly stan treningu zyl w polach obiektu `Tracker` — w pamieci procesu.
// Android ubija WebView, gdy uzytkownik zmiecie apke z paska ostatnich albo
// gdy systemowi zabraknie pamieci. Wtedy obiekt przestaje istniec razem
// z trasa, dystansem i czasem. Natywna wtyczka GPS dzialala dalej, wiec na
// ekranie blokady widac bylo zywy trening — a po wejsciu do apki pusty Track
// i brak czegokolwiek do zapisania.
//
// Teraz kazdy przyjety punkt i kazda zmiana stanu ladują natychmiast
// w IndexedDB. Po restarcie procesu `Tracker` odbudowuje sie z tych danych.
//
// ZAPIS JEST CELOWO ROZDZIELONY NA DWIE TABELE
//   activeSession — jeden rekord ze stanem (sport, czasy, dystans, okrazenia)
//   sessionCoords — punkty trasy, dopisywane po jednym
//
// Gdyby trasa siedziala w rekordzie sesji, kazdy fix wymagalby przepisania
// CALEJ rosnacej tablicy. Przy 3-godzinnej aktywnosci (~10 tys. punktow)
// to setki megabajtow zapisu na dysk telefonu. Dopisanie jednego rekordu
// kosztuje tyle samo niezaleznie od tego, czy trasa ma 10 czy 10 000 punktow.
//
// WSZYSTKIE OPERACJE SA CICHE. Blad zapisu nie moze przerwac trwajacego
// treningu — lepiej stracic jeden punkt niz wywalic sesje uzytkownika.

import { db } from './db.js';
import type { Coords } from '../types/index.js';
import type { Lap } from './Tracker.js';
import { dlog } from '../utils/log.js';

/** Stan sesji — wszystko, czego `Tracker` potrzebuje, zeby wstac od zera. */
export interface SessionState {
  id:            'current';   // zawsze jeden rekord
  sport:         string;
  startTime:     number;      // ms epoch — kotwica licznika czasu
  pausedTime:    number;      // laczny czas pauz w ms
  pauseStart:    number;      // 0 gdy nie na pauzie
  distanceM:     number;
  paused:        boolean;
  autoPaused:    boolean;
  laps:          Lap[];
  lastLapSec:    number;
  updatedAt:     number;      // do wykrycia osieroconej sesji
}

interface CoordRow { seq?: number; lat: number; lng: number; t: number }

/* eslint-disable @typescript-eslint/no-explicit-any */
const t = (name: string): any => (db as any)[name];

// ── Zapis ────────────────────────────────────────────────────────────────────

/** Rozpocznij nowa sesje. Czysci slady po poprzedniej. */
export async function beginSession(state: Omit<SessionState, 'id' | 'updatedAt'>): Promise<void> {
  try {
    await Promise.all([t('sessionCoords').clear(), t('activeSession').clear()]);
    await t('activeSession').put({ ...state, id: 'current', updatedAt: Date.now() });
    dlog('[Session] rozpoczeta i zapisana');
  } catch (e) {
    console.warn('[Session] nie udalo sie zapisac startu:', e instanceof Error ? e.message : e);
  }
}

/** Nadpisz stan sesji. Wolane przy kazdej zmianie dystansu, pauzy, okrazen. */
export async function saveSessionState(
  patch: Partial<Omit<SessionState, 'id'>>,
): Promise<void> {
  try {
    const cur = await t('activeSession').get('current');
    if (!cur) return;   // sesja zakonczona w miedzyczasie — nie wskrzeszamy
    await t('activeSession').put({ ...cur, ...patch, id: 'current', updatedAt: Date.now() });
  } catch { /* cisza — zapis stanu nie moze przerwac treningu */ }
}

/** Dopisz JEDEN przyjety punkt trasy. */
export async function appendCoord(lat: number, lng: number): Promise<void> {
  try {
    await t('sessionCoords').add({ lat, lng, t: Date.now() } as CoordRow);
  } catch { /* cisza — lepiej stracic punkt niz sesje */ }
}

/** Zakoncz sesje i posprzataj. Wolane po zapisaniu ORAZ po odrzuceniu. */
export async function clearSession(): Promise<void> {
  try {
    await Promise.all([t('activeSession').clear(), t('sessionCoords').clear()]);
    dlog('[Session] wyczyszczona');
  } catch (e) {
    console.warn('[Session] nie udalo sie wyczyscic:', e instanceof Error ? e.message : e);
  }
}

// ── Odczyt ───────────────────────────────────────────────────────────────────

/** Czy jest niezakonczona sesja do odtworzenia. */
export async function loadSession(): Promise<SessionState | null> {
  try {
    return (await t('activeSession').get('current')) ?? null;
  } catch {
    return null;
  }
}

/** Trasa zapisanej sesji, w kolejnosci zapisu. */
export async function loadSessionCoords(): Promise<Coords[]> {
  try {
    const rows = await t('sessionCoords').orderBy('seq').toArray() as CoordRow[];
    return rows.map(r => [r.lat, r.lng] as Coords);
  } catch {
    return [];
  }
}

/** Ile punktow ma zapisana sesja — bez wczytywania ich wszystkich. */
export async function sessionCoordCount(): Promise<number> {
  try { return await t('sessionCoords').count(); } catch { return 0; }
}

// ── Higiena ──────────────────────────────────────────────────────────────────

/** Maksymalny czas trwania sesji. Po tym uznajemy ja za porzucona.
 *
 *  24 godziny to nie jest limit dla uzytkownika — to zabezpieczenie przed
 *  sesja, ktora zostala po awarii i nigdy nie zostala zamknieta. Realny
 *  trening nigdy tyle nie trwa, a bez tego limitu osierocona sesja
 *  odtwarzalaby sie w nieskonczonosc przy kazdym uruchomieniu apki. */
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Czy zapisana sesja jest na tyle stara, ze to porzucony smiec. */
export function isStale(s: SessionState): boolean {
  return Date.now() - s.startTime > SESSION_MAX_AGE_MS;
}
