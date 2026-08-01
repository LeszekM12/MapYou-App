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
import { dlog } from '../utils/log.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
const t = (name) => db[name];
// ── Diagnostyka ──────────────────────────────────────────────────────────────
// Pierwsza wersja tego modulu polykala KAZDY blad po cichu. Zalozenie bylo
// dobre (zapis nie moze przerwac treningu), ale skutek fatalny: gdy tabele
// nie powstaly — bo Dexie nie przeszedl na wersje 8 — trening po prostu nie
// zapisywal sie i NIC o tym nie mowilo. Teraz kazdy rodzaj bledu krzyczy
// dokladnie RAZ, wiec da sie go zobaczyc, nie zalewajac logu.
const _shouted = new Set();
function shout(where, e) {
    if (_shouted.has(where))
        return;
    _shouted.add(where);
    console.error(`[Session] ${where} NIE DZIALA:`, e instanceof Error ? e.message : e);
}
/** Czy tabele sesji w ogole istnieja. Bez tego zapis jest bezcelowy. */
export function isSessionStoreReady() {
    return !!t('activeSession') && !!t('sessionCoords');
}
// ── Zapis ────────────────────────────────────────────────────────────────────
/** Rozpocznij nowa sesje. Czysci slady po poprzedniej. */
export async function beginSession(state) {
    try {
        await Promise.all([t('sessionCoords').clear(), t('activeSession').clear()]);
        await t('activeSession').put({ ...state, id: 'current', updatedAt: Date.now() });
        // Weryfikacja odczytem — zapis moze "przejsc" bez wyjatku, a mimo to nie
        // zostawic rekordu (np. gdy schemat nie ma tej tabeli).
        const check = await t('activeSession').get('current');
        if (!check) {
            console.error('[Session] KRYTYCZNE: zapis sesji nie zostawil rekordu. ' +
                'Trening NIE przezyje ubicia apki. Sprawdz, czy baza Dexie przeszla na wersje 8.');
            return;
        }
        dlog('[Session] rozpoczeta i zapisana');
    }
    catch (e) {
        console.warn('[Session] nie udalo sie zapisac startu:', e instanceof Error ? e.message : e);
    }
}
/** Nadpisz stan sesji. Wolane przy kazdej zmianie dystansu, pauzy, okrazen. */
export async function saveSessionState(patch) {
    try {
        const cur = await t('activeSession').get('current');
        if (!cur)
            return; // sesja zakonczona w miedzyczasie — nie wskrzeszamy
        await t('activeSession').put({ ...cur, ...patch, id: 'current', updatedAt: Date.now() });
    }
    catch (e) {
        shout('zapis stanu', e);
    }
}
/** Dopisz JEDEN przyjety punkt trasy. */
export async function appendCoord(lat, lng) {
    try {
        await t('sessionCoords').add({ lat, lng, t: Date.now() });
    }
    catch (e) {
        shout('zapis punktu trasy', e);
    }
}
/** Zakoncz sesje i posprzataj. Wolane po zapisaniu ORAZ po odrzuceniu. */
export async function clearSession() {
    try {
        await Promise.all([t('activeSession').clear(), t('sessionCoords').clear()]);
        dlog('[Session] wyczyszczona');
    }
    catch (e) {
        console.warn('[Session] nie udalo sie wyczyscic:', e instanceof Error ? e.message : e);
    }
}
// ── Odczyt ───────────────────────────────────────────────────────────────────
/** Czy jest niezakonczona sesja do odtworzenia. */
export async function loadSession() {
    try {
        return (await t('activeSession').get('current')) ?? null;
    }
    catch {
        return null;
    }
}
/** Trasa zapisanej sesji, w kolejnosci zapisu. */
export async function loadSessionCoords() {
    try {
        const rows = await t('sessionCoords').orderBy('seq').toArray();
        return rows.map(r => [r.lat, r.lng]);
    }
    catch {
        return [];
    }
}
/** Ile punktow ma zapisana sesja — bez wczytywania ich wszystkich. */
export async function sessionCoordCount() {
    try {
        return await t('sessionCoords').count();
    }
    catch {
        return 0;
    }
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
export function isStale(s) {
    return Date.now() - s.startTime > SESSION_MAX_AGE_MS;
}
//# sourceMappingURL=sessionStore.js.map