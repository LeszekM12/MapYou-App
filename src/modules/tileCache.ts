// ─── CACHE KAFELKÓW MAPY (offline) ───────────────────────────────────────────
// src/modules/tileCache.ts
//
// PROBLEM
// ───────
// Leaflet sciaga kafelki jako zwykle obrazki. Bez sieci widac tylko to, co
// przypadkiem zostalo w cache przegladarki — dokladnie ten fragment i to jedno
// powiekszenie, ktore uzytkownik akurat ogladal. Przesuniesz mape o ekran
// w bok i jest pustka.
//
// ROZWIAZANIE
// Kazdy pobrany kafelek trafia do IndexedDB. Nastepnym razem — nawet bez
// sieci — mapa bierze go stamtad. Po kilku wyjsciach okolica domu i typowe
// trasy dzialaja offline same z siebie, bez zadnego „pobierz region".
//
// DLACZEGO NIE „POBIERZ CALE MIASTO"
// Kafelki rastrowe sa ciezkie. Dla promienia 10 km:
//     zoom 12-15   ~1 150 kafelkow   ~22 MB
//     zoom 12-17  ~17 168 kafelkow  ~335 MB
// Sam zoom 17 to 250 MB. Google Maps radzi sobie inaczej — trzyma dane
// WEKTOROWE (opisy drog, nie obrazki) i renderuje je na telefonie, dlatego
// wojewodztwo miesci sie w kilkunastu megabajtach. U nas przejscie na wektory
// oznaczaloby wymiane Leaflet na MapLibre i przepisanie kazdej mapy w apce.
//
// JEDEN PUNKT PODMIANY
// Warstwy kafelkow powstaja w 9 miejscach. Zamiast przerabiac kazde,
// podmieniamy fabryke `L.tileLayer` — dokladnie tak, jak `authFetch`
// podmienia `fetch`.

import { db } from './db.js';
import { dlog } from '../utils/log.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const tbl = (): any => (db as any).tiles;

/** Limit cache — 8000 kafelkow, okolo 160 MB.
 *
 *  IndexedDB w apce natywnej ma do dyspozycji zwykle kilkanascie procent
 *  wolnego miejsca na dysku, wiec 160 MB miesci sie z ogromnym zapasem.
 *  Przy tej wielkosci okolica domu dziala offline w peleym zakresie
 *  powiekszen, a nie tylko w tych, ktore akurat ogladales.
 *
 *  Gorna granica nie jest techniczna, tylko zdroworozsadkowa: uzytkownik
 *  nie spodziewa sie, ze apka do biegania zje mu polowe telefonu. Jesli
 *  kiedys dodasz „pobierz mape trasy", ten limit trzeba bedzie podniesc
 *  i pokazac zajete miejsce w ustawieniach. */
const MAX_TILES = 8000;
/** Co ile zapisow sprawdzac rozmiar. Liczenie przy kazdym kafelku byloby
 *  droższe niz samo pobranie. */
const SWEEP_EVERY = 100;

let sinceSweep = 0;
let installed = false;
let installTries = 0;

interface TileRow { key: string; blob: Blob; lastUsed: number }

// ── Odczyt i zapis ───────────────────────────────────────────────────────────

async function readTile(key: string): Promise<Blob | null> {
  try {
    const row = await tbl().get(key) as TileRow | undefined;
    if (!row) return null;
    // Odswiezamy znacznik uzycia — to on decyduje, co przetrwa czyszczenie.
    void tbl().update(key, { lastUsed: Date.now() });
    return row.blob;
  } catch {
    return null;
  }
}

async function writeTile(key: string, blob: Blob): Promise<void> {
  try {
    await tbl().put({ key, blob, lastUsed: Date.now() } as TileRow);
    if (++sinceSweep >= SWEEP_EVERY) { sinceSweep = 0; void sweep(); }
  } catch { /* brak miejsca albo prywatny tryb — cache jest opcjonalny */ }
}

/** Skasuj najstarsze kafelki, gdy cache przekroczy limit. */
async function sweep(): Promise<void> {
  try {
    const count = await tbl().count();
    if (count <= MAX_TILES) return;
    const excess = count - MAX_TILES;
    const oldest = await tbl().orderBy('lastUsed').limit(excess).primaryKeys();
    await tbl().bulkDelete(oldest);
    dlog(`[Tiles] usunieto ${excess} najstarszych kafelkow (bylo ${count})`);
  } catch { /* noop */ }
}

// ── Statystyki i czyszczenie ─────────────────────────────────────────────────

export async function tileCacheStats(): Promise<{ count: number; approxMB: number }> {
  try {
    const count = await tbl().count();
    return { count, approxMB: Math.round(count * 20 / 1024 * 10) / 10 };
  } catch {
    return { count: 0, approxMB: 0 };
  }
}

/** Popros system, zeby NIE kasowal naszych danych przy braku miejsca.
 *
 *  Domyslnie IndexedDB jest „best-effort": gdy telefonowi zabraknie miejsca,
 *  system moze wyczyscic dane apki bez pytania — razem z kolejka offline
 *  i niezapisanym treningiem. `navigator.storage.persist()` zamienia to na
 *  „persistent", czyli dane znikaja dopiero, gdy uzytkownik sam je skasuje.
 *
 *  W apce natywnej zgoda jest zwykle przyznawana bez pytania uzytkownika.
 *  W przegladarce moze zostac odmowiona — wtedy dzialamy jak dotad. */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted?.()) { dlog('[Storage] juz trwaly'); return true; }
    const ok = await navigator.storage.persist();
    dlog(`[Storage] trwalosc ${ok ? 'przyznana' : 'odmowiona'}`);
    return ok;
  } catch {
    return false;
  }
}

/** Ile miejsca apka zajmuje i ile ma do dyspozycji. */
export async function storageEstimate(): Promise<{ usedMB: number; quotaMB: number } | null> {
  try {
    const e = await navigator.storage?.estimate?.();
    if (!e) return null;
    return {
      usedMB:  Math.round((e.usage ?? 0) / 1048576),
      quotaMB: Math.round((e.quota ?? 0) / 1048576),
    };
  } catch {
    return null;
  }
}

export async function clearTileCache(): Promise<void> {
  try { await tbl().clear(); dlog('[Tiles] cache wyczyszczony'); } catch { /* noop */ }
}

// ── Podmiana fabryki Leaflet ─────────────────────────────────────────────────

/** Wlacz cache dla WSZYSTKICH warstw kafelkow w apce.
 *
 *  Wolane raz, przy starcie. Kazde pozniejsze `L.tileLayer(...)` — w main.ts,
 *  LiveMap, HomeView, ActivityView i reszcie — dostaje cache automatycznie. */
export function installTileCache(): void {
  if (installed) return;
  const L = (window as unknown as { L?: any }).L;

  // Leaflet ladowany jest przez `<script defer>`, a ten modul moze wystartowac
  // wczesniej. Bez ponawiania podmiana po prostu by sie nie odbyla — i to
  // po cichu, bo nie byloby zadnego bledu. Probujemy przez ~5 s.
  if (!L?.TileLayer) {
    if (installTries++ < 100) { setTimeout(installTileCache, 50); return; }
    console.warn('[Tiles] Leaflet niedostepny — cache kafelkow wylaczony');
    return;
  }
  installed = true;

  const CachedLayer = L.TileLayer.extend({
    createTile(coords: { x: number; y: number; z: number }, done: (e: unknown, t: HTMLImageElement) => void) {
      const img = document.createElement('img');
      img.setAttribute('role', 'presentation');
      // Bez tego `fetch` na kafelki z innej domeny zwraca odpowiedz nieczytelna.
      img.crossOrigin = 'anonymous';

      const url = (this as any).getTileUrl(coords);
      // Klucz zawiera adres bez subdomeny — serwery a/b/c oddaja ten sam obrazek,
      // wiec traktowanie ich osobno potroiloby cache bez zadnego zysku.
      const key = url.replace(/\/\/[a-d]\./, '//');

      let settled = false;
      const finish = (err: unknown): void => {
        if (settled) return;
        settled = true;
        done(err, img);
      };

      void (async () => {
        // 1. Cache
        const cached = await readTile(key);
        if (cached) {
          img.src = URL.createObjectURL(cached);
          img.onload = () => { URL.revokeObjectURL(img.src); finish(null); };
          img.onerror = () => finish(null);
          return;
        }

        // 2. Sieć — pobieramy przez `fetch`, zeby miec dostep do danych
        //    i moc je zapisac. Zwykly `img.src` tego nie pozwala.
        try {
          const res = await fetch(url, { mode: 'cors' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          img.src = URL.createObjectURL(blob);
          img.onload = () => { URL.revokeObjectURL(img.src); finish(null); };
          img.onerror = () => finish(null);
          void writeTile(key, blob);
        } catch {
          // 3. Awaryjnie zwykly obrazek. Gdy CORS albo proxy nie pozwala na
          //    `fetch`, mapa ma dzialac tak jak przedtem — po prostu bez cache.
          img.crossOrigin = null as unknown as string;
          img.onload = () => finish(null);
          img.onerror = (e) => finish(e);
          img.src = url;
        }
      })();

      return img;
    },
  });

  const originalFactory = L.tileLayer;
  const patched = (url: string, opts?: unknown) => new CachedLayer(url, opts);
  // Zachowujemy podfunkcje (`L.tileLayer.wms` i podobne), zeby nic nie zniknelo.
  Object.assign(patched, originalFactory);
  (L as any).tileLayer = patched;

  dlog('[Tiles] cache kafelkow wlaczony');
}


/** Podglad z konsoli:  mapyouTiles()  — ile kafelkow i ile miejsca zajete. */
(window as unknown as Record<string, unknown>).mapyouTiles =
  async (purge = false): Promise<unknown> => {
    if (purge) { await clearTileCache(); return 'Tile cache cleared.'; }
    const [t, e] = await Promise.all([tileCacheStats(), storageEstimate()]);
    return {
      tiles: t.count,
      tilesApproxMB: t.approxMB,
      limit: MAX_TILES,
      appUsedMB: e?.usedMB ?? '?',
      appQuotaMB: e?.quotaMB ?? '?',
    };
  };
