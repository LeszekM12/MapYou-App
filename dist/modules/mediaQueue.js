// ─── KOLEJKA ZDJĘĆ I FILMÓW OFFLINE ──────────────────────────────────────────
// src/modules/mediaQueue.ts
//
// DLACZEGO OSOBNA KOLEJKA
// ───────────────────────
// `outbox.ts` nie moze obsluzyc mediow z dwoch powodow:
//
//   1. Trzyma cialo zadania jako TEKST. Pliku sie tak nie zapisze — Blob
//      przy serializacji do stringa traci zawartosc.
//   2. Wysylka mediow idzie przez `XMLHttpRequest` (potrzebny pasek postepu
//      przy filmach), a przechwytywacz w `authFetch` podmienia tylko `fetch`.
//      Zadanie XHR nigdy tamtedy nie przechodzi.
//
// Dlatego media maja wlasna tabele, wlasne ponawianie i wlasny sposob
// odtworzenia zadania.
//
// PROBLEM Z ADRESEM, KTORY JESZCZE NIE ISTNIEJE
// ─────────────────────────────────────────────
// Trening albo post zapisany offline musi gdzies wskazywac na zdjecie —
// ale prawdziwy adres powstanie dopiero po wyslaniu na Cloudinary.
//
// Rozwiazanie: od razu wydajemy ADRES ZASTEPCZY w postaci
//     mapyou-pending://<id>
// Rekord zapisuje sie z nim normalnie i dziala offline. Gdy zdjecie
// wreszcie poleci, przechodzimy po lokalnej bazie, podmieniamy zastepnik
// na prawdziwy adres i wypychamy poprawione rekordy do chmury.
//
// Dzieki temu uzytkownik NIGDY nie traci zdjecia, nawet gdy zrobil je
// w lesie bez zasiegu i zamknal apke.
import { db } from './db.js';
import { BACKEND_URL } from '../config.js';
import { dlog } from '../utils/log.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
const tbl = () => db.mediaQueue;
/** Prefiks adresu zastepczego. Rozpoznawalny, niemozliwy do pomylenia
 *  z prawdziwym adresem i bezpieczny w JSON. */
export const PENDING_PREFIX = 'mapyou-pending://';
// ── Kolejkowanie ─────────────────────────────────────────────────────────────
/** Odloz plik na pozniej. Zwraca adres zastepczy do zapisania w rekordzie. */
export async function enqueueMedia(blob, filename, userId, folder, publicId) {
    const id = await tbl().add({
        blob, filename, userId, folder, publicId: publicId ?? null,
        placeholder: '', createdAt: Date.now(), attempts: 0, lastError: null,
    });
    const placeholder = `${PENDING_PREFIX}${id}`;
    await tbl().update(id, { placeholder });
    dlog(`[Media] odlozono plik (${Math.round(blob.size / 1024)} kB) -> ${placeholder}`);
    return placeholder;
}
export async function pendingMediaCount() {
    try {
        return await tbl().count();
    }
    catch {
        return 0;
    }
}
// ── Wysyłka ──────────────────────────────────────────────────────────────────
/** Ile razy probowac jeden plik. Wiecej niz przy zwyklych zapisach, bo
 *  zdjecia bywaja duze i padaja na slabym zasiegu, a ich utrata boli
 *  bardziej niz utrata polubienia. */
const MAX_ATTEMPTS = 12;
let flushing = false;
/** Wyslij zalegle media i popraw rekordy, ktore na nie wskazuja. */
export async function flushMedia() {
    if (flushing || !navigator.onLine)
        return;
    flushing = true;
    try {
        const jobs = await tbl().orderBy('createdAt').toArray();
        if (!jobs.length)
            return;
        dlog(`[Media] wysylam ${jobs.length} zaleglych plikow`);
        for (const job of jobs) {
            if (job.attempts >= MAX_ATTEMPTS)
                continue;
            try {
                const form = new FormData();
                form.append('file', job.blob, job.filename);
                form.append('userId', job.userId);
                form.append('folder', job.folder);
                if (job.publicId)
                    form.append('publicId', job.publicId);
                const res = await fetch(`${BACKEND_URL}/upload/media`, { method: 'POST', body: form });
                if (!res.ok)
                    throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                if (data.status !== 'ok' || !data.url)
                    throw new Error('odpowiedz bez adresu');
                await replacePlaceholder(job.placeholder, data.url);
                await tbl().delete(job.id);
                dlog(`[Media] wyslano ${job.placeholder} -> ${data.url}`);
            }
            catch (e) {
                await tbl().update(job.id, {
                    attempts: job.attempts + 1,
                    lastError: e instanceof Error ? e.message : String(e),
                });
                // Siec padla — reszta i tak nie przejdzie w tym cyklu.
                if (!navigator.onLine)
                    break;
            }
        }
    }
    finally {
        flushing = false;
    }
}
// ── Podmiana adresu zastępczego ──────────────────────────────────────────────
/** Tabele, w ktorych moze siedziec adres zdjecia. */
const SCAN_TABLES = ['activities', 'enrichedActivities', 'unifiedWorkouts', 'postsFeed', 'profile'];
/** Zamien adres zastepczy na prawdziwy — lokalnie i w chmurze.
 *
 *  Przechodzimy po tabelach i porownujemy CALY rekord w postaci tekstu.
 *  To celowo prymitywne, ale odporne: nie musimy wiedziec, w ktorym polu
 *  siedzi adres (a bywa w `photoUrl`, `mediaUrl`, `avatarB64`, w tablicach
 *  zdjec posta). Rekordow z zastepnikiem jest zawsze garstka. */
async function replacePlaceholder(placeholder, realUrl) {
    const touched = [];
    for (const name of SCAN_TABLES) {
        try {
            const t = db[name];
            if (!t)
                continue;
            const rows = await t.toArray();
            for (const row of rows) {
                const asText = JSON.stringify(row);
                if (!asText.includes(placeholder))
                    continue;
                const fixed = JSON.parse(asText.split(placeholder).join(realUrl));
                await t.put(fixed);
                touched.push({ table: name, rec: fixed });
            }
        }
        catch { /* pojedyncza tabela nie moze przerwac calosci */ }
    }
    if (!touched.length) {
        dlog('[Media] brak rekordow do poprawienia');
        return;
    }
    dlog(`[Media] poprawiono ${touched.length} rekordow`);
    // Chmura tez ma stary zastepnik — odsylamy TYLKO poprawione rekordy.
    //
    // Celowo per rekord, a nie pelnym `pushNow`: ten porownuje cala baze
    // z Atlasem i przy okazji moglby wywolac skutki uboczne, ktorych tu
    // nie chcemy. Zmienil sie jeden adres w kilku rekordach — tyle odsylamy.
    try {
        const { CS } = await import('./cloudSync.js');
        for (const { table, rec } of touched) {
            try {
                if (table === 'activities')
                    await CS.saveActivity(rec);
                else if (table === 'enrichedActivities')
                    await CS.saveEnrichedActivity(rec);
                else if (table === 'postsFeed')
                    await CS.savePost(rec);
                // `unifiedWorkouts` i `profile` maja wlasne sciezki zapisu — trafia
                // do chmury przy najblizszej normalnej synchronizacji.
            }
            catch (e) {
                console.warn(`[Media] nie odeslano rekordu z ${table}:`, e instanceof Error ? e.message : e);
            }
        }
    }
    catch (e) {
        console.warn('[Media] cloudSync niedostepny:', e instanceof Error ? e.message : e);
    }
}
// ── Automatyczna wysyłka ─────────────────────────────────────────────────────
let started = false;
export function startMediaQueue() {
    if (started)
        return;
    started = true;
    window.addEventListener('online', () => { void flushMedia(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible')
            void flushMedia();
    });
    setInterval(() => { void flushMedia(); }, 90000);
    void flushMedia();
    dlog('[Media] nasluch uruchomiony');
}
/** Podglad z konsoli:  mapyouMedia() */
window.mapyouMedia =
    async (purge = false) => {
        if (purge) {
            const n = await pendingMediaCount();
            await tbl().clear();
            return `Wyczyszczono ${n} plikow — BEZPOWROTNIE.`;
        }
        const jobs = await tbl().toArray();
        if (!jobs.length)
            return 'Brak zaleglych mediow.';
        return jobs.map(j => ({
            id: j.id,
            plik: j.filename,
            kB: Math.round(j.blob.size / 1024),
            folder: j.folder,
            prob: j.attempts,
            blad: j.lastError ?? '—',
        }));
    };
//# sourceMappingURL=mediaQueue.js.map