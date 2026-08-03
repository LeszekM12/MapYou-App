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
const tbl = (): any => (db as any).mediaQueue;

/** Prefiks adresu zastepczego. Rozpoznawalny, niemozliwy do pomylenia
 *  z prawdziwym adresem i bezpieczny w JSON. */
export const PENDING_PREFIX = 'mapyou-pending://';

/** Ile razy probowac jeden plik. Wiecej niz przy zwyklych zapisach, bo
 *  zdjecia bywaja duze i padaja na slabym zasiegu, a ich utrata boli
 *  bardziej niz utrata polubienia. */
const MAX_ATTEMPTS = 12;

export interface MediaJob {
  id?:        number;
  /** Zawartosc pliku jako ArrayBuffer, NIE Blob.
   *
   *  Blob zapisany wprost w IndexedDB zawodzi na iOS (WKWebView) — wraca
   *  pusty albo odlaczony. Objaw jest podstepny: `FormData` sklada sie bez
   *  bledu, wysylka rusza, a serwer dostaje multipart bez zawartosci
   *  i odpowiada `500 Unexpected end of form` w kilkanascie milisekund.
   *
   *  ArrayBuffer klonuje sie niezawodnie na kazdej platformie. Blob
   *  odtwarzamy dopiero przy wysylce. */
  data:       ArrayBuffer;
  mimeType:   string;
  size:       number;
  filename:   string;
  userId:     string;
  folder:     'activities' | 'posts' | 'avatars';
  publicId?:  string | null;
  placeholder: string;      // mapyou-pending://<id>
  createdAt:  number;
  attempts:   number;
  lastError:  string | null;
}

// ── Kolejkowanie ─────────────────────────────────────────────────────────────

/** Odloz plik na pozniej. Zwraca adres zastepczy do zapisania w rekordzie. */
export async function enqueueMedia(
  blob: Blob, filename: string, userId: string,
  folder: 'activities' | 'posts' | 'avatars', publicId?: string | null,
): Promise<string> {
  // Rozpakowujemy Blob do ArrayBuffera JUZ TERAZ — dopoki jest zywy.
  const data = await blob.arrayBuffer();
  if (!data.byteLength) throw new Error('pusty plik — nie kolejkuje');

  const id = await tbl().add({
    data, mimeType: blob.type || 'application/octet-stream', size: data.byteLength,
    filename, userId, folder, publicId: publicId ?? null,
    placeholder: '', createdAt: Date.now(), attempts: 0, lastError: null,
  } as MediaJob);
  const placeholder = `${PENDING_PREFIX}${id}`;
  await tbl().update(id, { placeholder });
  dlog(`[Media] odlozono plik (${Math.round(data.byteLength / 1024)} kB) -> ${placeholder}`);
  return placeholder;
}

/** Ile plikow CZEKA NA WYSLANIE.
 *
 *  Celowo NIE liczymy zadan, ktore wyczerpaly limit prob. Wczesniej liczylem
 *  wszystkie — i wystarczylo jedno trwale niepowodzenie, zeby pasek utknal
 *  na „Syncing… (1)" na zawsze, bo licznik nigdy nie schodzil do zera.
 *  Takie zadania nadal siedza w bazie (nie kasujemy danych uzytkownika),
 *  ale nie udaja, ze cos sie dzieje. */
export async function pendingMediaCount(): Promise<number> {
  try {
    const all = await tbl().toArray() as MediaJob[];
    return all.filter(j => j.attempts < MAX_ATTEMPTS).length;
  } catch { return 0; }
}

/** Zadania, ktore trwale padly — do pokazania uzytkownikowi. */
export async function failedMediaCount(): Promise<number> {
  try {
    const all = await tbl().toArray() as MediaJob[];
    return all.filter(j => j.attempts >= MAX_ATTEMPTS).length;
  } catch { return 0; }
}

// ── Wysyłka ──────────────────────────────────────────────────────────────────

let flushing = false;

/** Wyslij zalegle media i popraw rekordy, ktore na nie wskazuja. */
export async function flushMedia(): Promise<void> {
  if (flushing || !navigator.onLine) return;

  // Bez gotowej sesji `/upload/media` odpowie 401, a `authFetch` ponowi
  // zadanie z TYM SAMYM `FormData`. Cialo multipart bylo juz raz wyslane,
  // wiec powtorka dochodzi obcieta — serwer zglasza „Unexpected end of form".
  // Prosciej nie zaczynac, dopoki nie ma czym sie uwierzytelnic.
  try {
    const { isSessionReady } = await import('./authFetch.js');
    if (!isSessionReady()) { dlog('[Media] sesja niegotowa — czekam'); return; }
  } catch { /* brak funkcji — probujemy mimo to */ }

  flushing = true;

  try {
    const jobs = await tbl().orderBy('createdAt').toArray() as MediaJob[];
    if (!jobs.length) return;
    dlog(`[Media] wysylam ${jobs.length} zaleglych plikow`);

    for (const job of jobs) {
      if (job.attempts >= MAX_ATTEMPTS) continue;
      try {
        // Odtwarzamy Blob z bajtow i SPRAWDZAMY, czy cos w nim jest.
        // Pusty plik nie ma po co lecieć — serwer i tak odpowie bledem,
        // a zadanie krecilo by sie w kolko az do wyczerpania prob.
        if (!job.data || !job.data.byteLength) {
          console.error(`[Media] zadanie ${job.id} ma pusta zawartosc — usuwam`);
          await tbl().delete(job.id);
          continue;
        }
        const blob = new Blob([job.data], { type: job.mimeType });
        const form = new FormData();
        form.append('file',   blob, job.filename);
        form.append('userId', job.userId);
        form.append('folder', job.folder);
        if (job.publicId) form.append('publicId', job.publicId);

        const res = await fetch(`${BACKEND_URL}/upload/media`, { method: 'POST', body: form });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json() as { status?: string; url?: string };
        if (data.status !== 'ok' || !data.url) throw new Error('odpowiedz bez adresu');

        // Kasujemy zadanie ZANIM poprawimy rekordy.
        //
        // Wczesniej bylo odwrotnie i gdy `replacePlaceholder` rzucilo bledem,
        // zadanie zostawalo w kolejce mimo UDANEJ wysylki. Efekt: plik szedl
        // na serwer w kolko, a licznik nigdy nie spadal.
        // Plik jest juz w chmurze — to jest moment, w ktorym zadanie
        // przestaje byc potrzebne.
        await tbl().delete(job.id);
        await replacePlaceholder(job.placeholder, data.url);
        dlog(`[Media] wyslano ${job.placeholder} -> ${data.url}`);
      } catch (e) {
        await tbl().update(job.id, {
          attempts: job.attempts + 1,
          lastError: e instanceof Error ? e.message : String(e),
        });
        // Siec padla — reszta i tak nie przejdzie w tym cyklu.
        if (!navigator.onLine) break;
      }
    }
  } finally {
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
async function replacePlaceholder(placeholder: string, realUrl: string): Promise<void> {
  const touched: { table: string; rec: Record<string, unknown> }[] = [];

  for (const name of SCAN_TABLES) {
    try {
      const t = (db as any)[name];
      if (!t) continue;
      const rows = await t.toArray() as Record<string, unknown>[];
      for (const row of rows) {
        const asText = JSON.stringify(row);
        if (!asText.includes(placeholder)) continue;
        const fixed = JSON.parse(asText.split(placeholder).join(realUrl)) as Record<string, unknown>;
        await t.put(fixed);
        touched.push({ table: name, rec: fixed });
      }
    } catch { /* pojedyncza tabela nie moze przerwac calosci */ }
  }

  if (!touched.length) { dlog('[Media] brak rekordow do poprawienia'); return; }
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
        if (table === 'activities')          await CS.saveActivity(rec as never);
        else if (table === 'enrichedActivities') await CS.saveEnrichedActivity(rec as never);
        else if (table === 'postsFeed')      await CS.savePost(rec as never);
        // `unifiedWorkouts` i `profile` maja wlasne sciezki zapisu — trafia
        // do chmury przy najblizszej normalnej synchronizacji.
      } catch (e) {
        console.warn(`[Media] nie odeslano rekordu z ${table}:`, e instanceof Error ? e.message : e);
      }
    }
  } catch (e) {
    console.warn('[Media] cloudSync niedostepny:', e instanceof Error ? e.message : e);
  }
}

// ── Automatyczna wysyłka ─────────────────────────────────────────────────────

let started = false;

export function startMediaQueue(): void {
  if (started) return;
  started = true;
  window.addEventListener('online', () => { void flushMedia(); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushMedia();
  });
  setInterval(() => { void flushMedia(); }, 90_000);
  void flushMedia();
  dlog('[Media] nasluch uruchomiony');
}

/** Podglad z konsoli:  mapyouMedia() */
(window as unknown as Record<string, unknown>).mapyouMedia =
  async (purge = false): Promise<unknown> => {
    if (purge) {
      const n = await pendingMediaCount();
      await tbl().clear();
      return `Wyczyszczono ${n} plikow — BEZPOWROTNIE.`;
    }
    const jobs = await tbl().toArray() as MediaJob[];
    if (!jobs.length) return 'Brak zaleglych mediow.';
    return jobs.map(j => ({
      id: j.id,
      plik: j.filename,
      kB: Math.round((j.size ?? 0) / 1024),
      folder: j.folder,
      prob: j.attempts,
      blad: j.lastError ?? '—',
    }));
  };
