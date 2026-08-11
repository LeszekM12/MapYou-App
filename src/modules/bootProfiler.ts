// ─── PROFILER STARTU ─────────────────────────────────────────────────────────
// src/modules/bootProfiler.ts
//
// PO CO
// Przyciski nie reaguja przez pierwsze 2-3 sekundy. To znaczy, ze GLOWNY WATEK
// jest czyms zajety — przegladarka nie ma kiedy obsluzyc dotkniecia. Zgadywanie
// przyczyny juz raz spudlowalo (cache tokenu pomogl, ale nie rozwiazal), wiec
// tym razem mierzymy.
//
// CO MIERZY
//   1. ZASTOJE — timer co 50 ms. Jesli wrocil pozniej, roznica to czas, przez
//      ktory watek byl zablokowany. To DOKLADNIE to, co czujesz jako „nie
//      reaguje": dotkniecie czeka w kolejce, az watek sie zwolni.
//   2. ZADANIA SIECIOWE — ile, dokad, jak dlugo, czy rownolegle.
//   3. MOSTEK NATYWNY — ile przeskokow do kodu natywnego (Capacitor).
//      Kazdy z nich idzie przez glowny watek.
//   4. ZNACZNIKI FAZ — zeby wiedziec, KTORY etap startu zjada czas.
//
// UZYCIE
//   Uruchamia sie sam. Po ~15 s wpisz w konsoli:  mapyouBoot()
//
// Modul jest celowo lekki: 400 tykniec timera przez 20 s to nic, a mierzy
// tylko przez pierwsze 20 sekund i potem sam sie wylacza.

// ─── WYLACZONY DOMYSLNIE ─────────────────────────────────────────────────────
//
// Ten modul PODMIENIA GLOBALNY `fetch` i rysuje czerwone kropki przy kazdym
// dotknieciu. Swietne przy diagnozowaniu, niedopuszczalne w wersji dla sklepu:
// nadpisywanie wbudowanych funkcji przegladarki w produkcji to dokladnie ten
// rodzaj rzeczy, ktory potrafi wywolac trudny do znalezienia blad u kogos,
// kto nigdy nie prosil o diagnostyke.
//
// Zamiast usuwac narzedzie, ktore trzy razy uratowalo nam tydzien szukania —
// chowamy je za ta sama flaga co `dlog`:
//
//     mapyouDebug(true)   → potem RESTART aplikacji
//     mapyouDebug(false)  → cisza
//
// Przy wylaczonej fladze modul nie robi NIC: nie podmienia `fetch`, nie
// uruchamia timerow, nie podpina nasluchow, `bootMark` jest pusta funkcja.
// Koszt w wersji produkcyjnej: zero.
//
// `mapyouBoot()` nadal istnieje i przy wylaczonej fladze mowi wprost,
// jak ja wlaczyc — zeby nie wygladalo na awarie narzedzia.

const WLACZONY = (() => {
  try { return localStorage.getItem('mapyou_debug') === '1'; } catch { return false; }
})();

const T0 = performance.now();

interface Stall { at: number; ms: number }
interface Req   { url: string; at: number; ms: number; status: number | string }
interface Mark  { name: string; at: number }

const stalls: Stall[] = [];
const reqs:   Req[]   = [];
const marks:  Mark[]  = [];
let bridgeCalls = 0;
const bridgeByPlugin = new Map<string, number>();

const since = (): number => Math.round(performance.now() - T0);

/** Znacznik fazy startu. Wolany z `main.ts` w kilku miejscach. */
export function bootMark(name: string): void {
  if (!WLACZONY) return;
  marks.push({ name, at: since() });
}

// ── 1. Wykrywanie zastojow glownego watku ────────────────────────────────────
//
// Timer ma wrocic za 50 ms. Jesli wrocil za 900 ms, to znaczy, ze przez 850 ms
// watek byl zajety i NIC nie moglo sie wydarzyc — w tym obsluga dotkniecia.
const KROK = 50;
const PROG = 120;          // ponizej to zwykly szum planisty
let ostatni = performance.now();

function tyknij(): void {
  const teraz = performance.now();
  const opoznienie = teraz - ostatni - KROK;
  if (opoznienie > PROG) {
    stalls.push({ at: Math.round(teraz - T0 - opoznienie), ms: Math.round(opoznienie) });
  }
  ostatni = teraz;
  if (teraz - T0 < 20_000) setTimeout(tyknij, KROK);
}
if (WLACZONY) setTimeout(tyknij, KROK);

// ── 2. Pomiar zadan sieciowych ───────────────────────────────────────────────
//
// Owijamy `fetch` NA WIERZCHU tego, co juz jest (authFetch tez go podmienia),
// wiec mierzymy pelny czas razem z pobraniem tokenu i App Check.
// WAZNE: owijamy DOPIERO po wykonaniu wszystkich modulow (`setTimeout 0`).
// `authFetch.ts` tez podmienia `window.fetch` — gdybysmy zrobili to od razu,
// wladowalibysmy sie POD niego i mierzyli sam ruch sieciowy, bez czasu
// czekania na token Firebase i App Check. A to wlasnie tam moze siedziec
// problem, wiec musimy byc na zewnatrz.
if (WLACZONY) setTimeout(() => {
const _fetch = window.fetch.bind(window);
window.fetch = async function (...args: Parameters<typeof fetch>) {
  const start = performance.now();
  const url = typeof args[0] === 'string' ? args[0]
            : (args[0] as Request)?.url ?? String(args[0]);
  try {
    const r = await _fetch(...args);
    reqs.push({ url, at: Math.round(start - T0), ms: Math.round(performance.now() - start), status: r.status });
    return r;
  } catch (e) {
    reqs.push({ url, at: Math.round(start - T0), ms: Math.round(performance.now() - start), status: 'ERR' });
    throw e;
  }
};
}, 0);

// ── 3. Zliczanie przeskokow przez mostek Capacitora ──────────────────────────
//
// Kazde wywolanie wtyczki natywnej to komunikat przez most, obslugiwany na
// glownym watku. Kilkanascie pod rzad potrafi zablokowac interfejs.
try {
  if (!WLACZONY) throw new Error('profiler wylaczony');
  const cap = (window as unknown as Record<string, any>).Capacitor;
  if (cap && typeof cap.toNative === 'function') {
    const orig = cap.toNative.bind(cap);
    cap.toNative = function (plugin: string, method: string, ...rest: unknown[]) {
      bridgeCalls++;
      const k = `${plugin}.${method}`;
      bridgeByPlugin.set(k, (bridgeByPlugin.get(k) ?? 0) + 1);
      return orig(plugin, method, ...rest);
    };
  }
} catch { /* przegladarka bez Capacitora */ }

// ── 4. Znaczniki z przegladarki ──────────────────────────────────────────────
if (WLACZONY) {
  document.addEventListener('DOMContentLoaded', () => bootMark('DOMContentLoaded'));
  window.addEventListener('load', () => bootMark('window.load'));
  bootMark('profiler start');
}

// ── 5. Sledzenie DOTKNIEC ────────────────────────────────────────────────────
//
// Pierwszy pomiar pokazal ZERO zastojow glownego watku, a caly start konczy sie
// w 92 ms. Skoro watek jest wolny, a przyciski nie reaguja, to znaczy, ze
// dotkniecia NIE DOCIERAJA do kodu. Zostaja trzy mozliwosci:
//
//   a) cos je przechwytuje — niewidoczna nakladka nad interfejsem,
//   b) uchwyty jeszcze nie sa podpiete do elementow,
//   c) WebView w ogole nie dostaje zdarzen (warstwa natywna, splash).
//
// `elementFromPoint` rozstrzyga (a): mowi, JAKI element naprawde lezy pod
// palcem. Jesli to nie jest przycisk, w ktory celowales — mamy nakladke
// i znamy jej nazwe.
//
// Brak wpisow przy dotknieciu rozstrzyga (c): zdarzenie nie doszlo nawet
// do przechwytujacego nasluchu na `document`, czyli problem jest ponizej JS.

interface Tap {
  at: number;
  typ: string;
  cel: string;
  naWierzchu: string;
  domyslnieZablokowane?: boolean;
}
const tapy: Tap[] = [];

function opisz(el: Element | null): string {
  if (!el) return '(brak)';
  const id  = el.id ? `#${el.id}` : '';
  const cls = typeof el.className === 'string' && el.className
    ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`.slice(0, 90);
}

// ── ZNACZNIK DOTKNIECIA NA EKRANIE ───────────────────────────────────────────
//
// Nagranie ekranu na iOS NIE POKAZUJE dotkniec. Widac wiec reakcje interfejsu,
// ale nie widac, kiedy palec dotknal — czyli nie da sie zmierzyc opoznienia.
//
// Rozwiazanie: rysujemy czerwona kropke DOKLADNIE w chwili, gdy JavaScript
// dostaje zdarzenie. Na nagraniu widac wtedy jedno i drugie, a odstep miedzy
// kropka a reakcja to szukane opoznienie — mierzalne wprost z wideo, bez
// zgadywania i bez korelowania z logami.
//
// Kropka pojawia sie w fazie PRZECHWYTYWANIA, czyli zanim jakikolwiek inny
// kod zobaczy zdarzenie. Jesli kropka nie zapali sie wcale — dotkniecie
// nie doszlo do WebView i problem jest w warstwie natywnej.
function znacznik(x: number, y: number): void {
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:${x - 16}px;top:${y - 16}px;width:32px;height:32px;`
    + 'border-radius:50%;background:rgba(255,0,0,0.55);border:2px solid #fff;'
    + 'z-index:2147483647;pointer-events:none;';
  document.body.appendChild(d);
  setTimeout(() => d.remove(), 400);
}

for (const typ of (WLACZONY ? ['pointerdown', 'touchstart', 'click'] as const : [])) {
  document.addEventListener(typ, (e: Event) => {
    if (tapy.length > 60) return;
    const pe = e as PointerEvent & { clientX?: number; clientY?: number };
    const x = pe.clientX ?? 0, y = pe.clientY ?? 0;
    tapy.push({
      at: since(),
      typ,
      cel: opisz(e.target as Element),
      // KLUCZOWE: co system uwaza za element pod palcem. Gdy rozni sie od celu,
      // znaczy, ze cos lezy na wierzchu i zjada dotkniecie.
      naWierzchu: opisz(document.elementFromPoint(x, y)),
      domyslnieZablokowane: e.defaultPrevented || undefined,
    });
    if (typ === 'pointerdown') znacznik(x, y);
  }, true);   // faza przechwytywania — lapiemy PRZED wszystkimi innymi
}

// Widocznosc strony: gdyby WebView budzil sie z opoznieniem, zobaczymy to tutaj.
if (WLACZONY) {
  document.addEventListener('visibilitychange', () =>
    bootMark(`visibility: ${document.visibilityState}`));
}

// ── Raport ───────────────────────────────────────────────────────────────────

function raport(): Record<string, unknown> {
  const sumaZastojow = stalls.reduce((s, x) => s + x.ms, 0);
  const najgorsze = [...stalls].sort((a, b) => b.ms - a.ms).slice(0, 8);

  // Zadania pogrupowane po sciezce — interesuje nas, czy cos leci wielokrotnie.
  const wgSciezki = new Map<string, { n: number; suma: number; max: number }>();
  for (const r of reqs) {
    const p = r.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
                   .replace(/\/[0-9a-f]{8,}|\/\d{6,}/gi, '/:id');
    const a = wgSciezki.get(p) ?? { n: 0, suma: 0, max: 0 };
    a.n++; a.suma += r.ms; a.max = Math.max(a.max, r.ms);
    wgSciezki.set(p, a);
  }
  const topSciezki = [...wgSciezki.entries()]
    .sort((a, b) => b[1].suma - a[1].suma).slice(0, 12)
    .map(([p, v]) => ({ sciezka: p, ile: v.n, lacznie_ms: Math.round(v.suma), najdluzsze_ms: v.max }));

  const nav = (performance.getEntriesByType('navigation')[0] ?? {}) as PerformanceNavigationTiming;

  return {
    '1_PODSUMOWANIE': {
      zastoje_lacznie_ms: Math.round(sumaZastojow),
      zastojow: stalls.length,
      najdluzszy_ms: najgorsze[0]?.ms ?? 0,
      zadan_sieciowych: reqs.length,
      przeskokow_przez_mostek: bridgeCalls,
      pierwsze_20s: true,
    },
    '2_ZASTOJE_glowny_watek': najgorsze.map(s => ({ od_startu_ms: s.at, trwal_ms: s.ms })),
    '3_ZNACZNIKI_faz': marks,
    '4_SIEC_wg_sciezki': topSciezki,
    '5_SIEC_pierwsze_15': reqs.slice(0, 15).map(r => ({
      od_startu_ms: r.at, trwalo_ms: r.ms, status: r.status,
      url: r.url.replace(/^https?:\/\/[^/]+/, '').slice(0, 70),
    })),
    '6_MOSTEK_wg_wtyczki': [...bridgeByPlugin.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([k, n]) => ({ wywolanie: k, ile: n })),
    '7_DOTKNIECIA': tapy.length
      ? tapy
      : 'BRAK — zadne dotkniecie nie doszlo nawet do nasluchu na document. '
        + 'To znaczy, ze problem jest PONIZEJ JavaScriptu (warstwa natywna).',
    '8_PRZEGLADARKA': {
      parsowanie_html_ms: Math.round((nav.domContentLoadedEventStart ?? 0) - (nav.responseEnd ?? 0)),
      do_zaladowania_ms:  Math.round(nav.loadEventStart ?? 0),
      wezlow_DOM: document.getElementsByTagName('*').length,
      // Kiedy przegladarka zaczela wczytywac strone, liczac od epoki.
      // Porownaj z momentem dotkniecia ikony — roznica to czas, ktory zjada
      // warstwa natywna ZANIM JavaScript w ogole ruszy.
      start_nawigacji_iso: new Date(performance.timeOrigin).toISOString(),
    },
  };
}

(window as unknown as Record<string, unknown>).mapyouBoot = (): Record<string, unknown> => {
  // Bez tego komunikatu pusty raport wygladalby na awarie narzedzia,
  // a nie na jego swiadome wylaczenie.
  if (!WLACZONY) {
    console.warn('[Boot] Profiler jest WYLACZONY (tak ma byc w wersji dla sklepu).\n'
      + 'Zeby wlaczyc:  mapyouDebug(true)  → potem zrestartuj aplikacje.');
    return { profiler: 'wylaczony', jak_wlaczyc: 'mapyouDebug(true) + restart' };
  }
  const r = raport();
  // Wypis tekstowy — latwiej skopiowac z konsoli Safari niz rozwijac obiekty.
  console.log('%c=== MAPYOU BOOT PROFILE ===', 'font-weight:bold');
  console.log(JSON.stringify(r, null, 2));
  return r;
};

// Automatyczny wypis, gdyby ktos zapomnial wpisac polecenie.
if (WLACZONY) setTimeout(() => {
  const suma = stalls.reduce((s, x) => s + x.ms, 0);
  console.warn(`[Boot] zastoje glownego watku: ${Math.round(suma)} ms w ${stalls.length} kawalkach, ` +
    `zadan: ${reqs.length}, mostek: ${bridgeCalls}. Szczegoly: mapyouBoot()`);
}, 15_000);
