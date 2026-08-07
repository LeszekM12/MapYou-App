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
const T0 = performance.now();
const stalls = [];
const reqs = [];
const marks = [];
let bridgeCalls = 0;
const bridgeByPlugin = new Map();
const since = () => Math.round(performance.now() - T0);
/** Znacznik fazy startu. Wolany z `main.ts` w kilku miejscach. */
export function bootMark(name) {
    marks.push({ name, at: since() });
}
// ── 1. Wykrywanie zastojow glownego watku ────────────────────────────────────
//
// Timer ma wrocic za 50 ms. Jesli wrocil za 900 ms, to znaczy, ze przez 850 ms
// watek byl zajety i NIC nie moglo sie wydarzyc — w tym obsluga dotkniecia.
const KROK = 50;
const PROG = 120; // ponizej to zwykly szum planisty
let ostatni = performance.now();
function tyknij() {
    const teraz = performance.now();
    const opoznienie = teraz - ostatni - KROK;
    if (opoznienie > PROG) {
        stalls.push({ at: Math.round(teraz - T0 - opoznienie), ms: Math.round(opoznienie) });
    }
    ostatni = teraz;
    if (teraz - T0 < 20000)
        setTimeout(tyknij, KROK);
}
setTimeout(tyknij, KROK);
// ── 2. Pomiar zadan sieciowych ───────────────────────────────────────────────
//
// Owijamy `fetch` NA WIERZCHU tego, co juz jest (authFetch tez go podmienia),
// wiec mierzymy pelny czas razem z pobraniem tokenu i App Check.
// WAZNE: owijamy DOPIERO po wykonaniu wszystkich modulow (`setTimeout 0`).
// `authFetch.ts` tez podmienia `window.fetch` — gdybysmy zrobili to od razu,
// wladowalibysmy sie POD niego i mierzyli sam ruch sieciowy, bez czasu
// czekania na token Firebase i App Check. A to wlasnie tam moze siedziec
// problem, wiec musimy byc na zewnatrz.
setTimeout(() => {
    const _fetch = window.fetch.bind(window);
    window.fetch = async function (...args) {
        const start = performance.now();
        const url = typeof args[0] === 'string' ? args[0]
            : args[0]?.url ?? String(args[0]);
        try {
            const r = await _fetch(...args);
            reqs.push({ url, at: Math.round(start - T0), ms: Math.round(performance.now() - start), status: r.status });
            return r;
        }
        catch (e) {
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
    const cap = window.Capacitor;
    if (cap && typeof cap.toNative === 'function') {
        const orig = cap.toNative.bind(cap);
        cap.toNative = function (plugin, method, ...rest) {
            bridgeCalls++;
            const k = `${plugin}.${method}`;
            bridgeByPlugin.set(k, (bridgeByPlugin.get(k) ?? 0) + 1);
            return orig(plugin, method, ...rest);
        };
    }
}
catch { /* przegladarka bez Capacitora */ }
// ── 4. Znaczniki z przegladarki ──────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => bootMark('DOMContentLoaded'));
window.addEventListener('load', () => bootMark('window.load'));
bootMark('profiler start');
// ── Raport ───────────────────────────────────────────────────────────────────
function raport() {
    const sumaZastojow = stalls.reduce((s, x) => s + x.ms, 0);
    const najgorsze = [...stalls].sort((a, b) => b.ms - a.ms).slice(0, 8);
    // Zadania pogrupowane po sciezce — interesuje nas, czy cos leci wielokrotnie.
    const wgSciezki = new Map();
    for (const r of reqs) {
        const p = r.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0]
            .replace(/\/[0-9a-f]{8,}|\/\d{6,}/gi, '/:id');
        const a = wgSciezki.get(p) ?? { n: 0, suma: 0, max: 0 };
        a.n++;
        a.suma += r.ms;
        a.max = Math.max(a.max, r.ms);
        wgSciezki.set(p, a);
    }
    const topSciezki = [...wgSciezki.entries()]
        .sort((a, b) => b[1].suma - a[1].suma).slice(0, 12)
        .map(([p, v]) => ({ sciezka: p, ile: v.n, lacznie_ms: Math.round(v.suma), najdluzsze_ms: v.max }));
    const nav = (performance.getEntriesByType('navigation')[0] ?? {});
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
        '7_PRZEGLADARKA': {
            parsowanie_html_ms: Math.round((nav.domContentLoadedEventStart ?? 0) - (nav.responseEnd ?? 0)),
            do_zaladowania_ms: Math.round(nav.loadEventStart ?? 0),
            wezlow_DOM: document.getElementsByTagName('*').length,
        },
    };
}
window.mapyouBoot = () => {
    const r = raport();
    // Wypis tekstowy — latwiej skopiowac z konsoli Safari niz rozwijac obiekty.
    console.log('%c=== MAPYOU BOOT PROFILE ===', 'font-weight:bold');
    console.log(JSON.stringify(r, null, 2));
    return r;
};
// Automatyczny wypis, gdyby ktos zapomnial wpisac polecenie.
setTimeout(() => {
    const suma = stalls.reduce((s, x) => s + x.ms, 0);
    console.warn(`[Boot] zastoje glownego watku: ${Math.round(suma)} ms w ${stalls.length} kawalkach, ` +
        `zadan: ${reqs.length}, mostek: ${bridgeCalls}. Szczegoly: mapyouBoot()`);
}, 15000);
//# sourceMappingURL=bootProfiler.js.map