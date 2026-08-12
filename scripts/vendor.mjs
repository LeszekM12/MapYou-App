// ─── BIBLIOTEKI ZEWNETRZNE — KOPIA LOKALNA ───────────────────────────────────
// scripts/vendor.mjs
//
// PO CO TO POWSTALO
// ─────────────────
// `app.html` ladowal PIEC bibliotek z sieci (unpkg, jsDelivr, cdnjs):
// Leaflet, markercluster, Dexie, Chart.js, JSZip, libsodium.
//
// W apce natywnej to bylo grozne, a nie tylko powolne. `src/modules/db.ts`
// robi na poziomie modulu:
//
//     export const db = new Dexie('mapty');
//
// Gdy Dexie nie doleci — a bez zasiegu nie doleci — to jest `ReferenceError`
// przy WCZYTYWANIU modulu. esbuild pakuje wszystko do jednego pliku, wiec
// wywala sie CALA paczka: bialy ekran, zero komunikatu.
//
// I to jest sedno problemu: caly tryb offline (sessionStore, outbox,
// mediaQueue, tileCache) mial sens tylko wtedy, gdy apka w ogole wstanie.
// A nie wstawala. Service worker tego nie ratuje — w natywnym WKWebView
// na iOS service workery nie dzialaja.
//
// CO ROBI TEN SKRYPT
// Kopiuje pliki dystrybucyjne z `node_modules` do `vendor/` w korzeniu repo.
// `assemble-www.mjs` zabiera ten katalog do `www/`, wiec trafia do paczki apki.
// Wersje sa przypiete w `package.json` (`--save-exact`), wiec `vendor/` jest
// odtwarzalny i NIE MUSI byc w repozytorium.
//
// DLACZEGO KOPIA, A NIE IMPORT ESM
// Bo cala apka siega po te biblioteki jako GLOBALE (`L`, `Dexie`, `Chart`,
// `JSZip`) — w ~9 miejscach powstaja warstwy Leaflet, `tileCache.ts` podmienia
// fabryke `L.tileLayer`, a `db.ts` deklaruje `declare const Dexie`. Przejscie
// na importy oznaczaloby przepisanie kilkudziesieciu plikow naraz. Kopia daje
// dokladnie ten sam efekt (start bez sieci) przy zerowym ryzyku regresji.

import { cpSync, mkdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

const OUT = 'vendor';

// Zrodlo -> cel. Nazwy plikow celowo BEZ numeru wersji: wersje trzyma
// `package.json`, a `app.html` ma zostac stabilny przy aktualizacjach.
const FILES = [
  ['node_modules/leaflet/dist/leaflet.js',                           'vendor/leaflet.js'],
  ['node_modules/leaflet/dist/leaflet.css',                          'vendor/leaflet.css'],
  // Leaflet CSS odwoluje sie do `images/marker-icon.png` SCIEZKA WZGLEDNA,
  // wiec katalog musi lezec obok arkusza — inaczej znikaja pinezki na mapie.
  ['node_modules/leaflet/dist/images',                               'vendor/images'],
  ['node_modules/leaflet.markercluster/dist/leaflet.markercluster.js','vendor/leaflet.markercluster.js'],
  ['node_modules/leaflet.markercluster/dist/MarkerCluster.css',       'vendor/MarkerCluster.css'],
  ['node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css','vendor/MarkerCluster.Default.css'],
  ['node_modules/dexie/dist/dexie.min.js',                           'vendor/dexie.min.js'],
  ['node_modules/chart.js/dist/chart.umd.js',                        'vendor/chart.umd.js'],
  ['node_modules/jszip/dist/jszip.min.js',                           'vendor/jszip.min.js'],

  // ── libsodium — kopiowany, ale NIE ladowany w app.html ────────────────────
  // Uzywa go wylacznie `src/modules/tlm/`, ktory nie jest nigdzie podpiety
  // (sprawdzone: zero importow spoza tego katalogu). To 744 kB blokujace
  // start apki na rzecz kodu, ktory sie nie wykonuje.
  //
  // Gdy bedziesz wpinac TLM, odkomentuj DWA tagi w `app.html` — kolejnosc
  // ma znaczenie, bo wrapper robi `root.sodium = a(..., root.libsodium)`,
  // wiec `libsodium.js` MUSI byc pierwszy.
  ['node_modules/libsodium/dist/modules/libsodium.js',               'vendor/libsodium.js'],
  ['node_modules/libsodium-wrappers/dist/modules/libsodium-wrappers.js', 'vendor/libsodium-wrappers.js'],
];

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let missing = 0;
for (const [src, dst] of FILES) {
  if (!existsSync(src)) {
    console.error(`  BRAK: ${src}`);
    missing++;
    continue;
  }
  mkdirSync(dirname(dst), { recursive: true });
  cpSync(src, dst, { recursive: statSync(src).isDirectory() });
}

if (missing) {
  console.error(`\n[vendor] ${missing} plikow nie znaleziono. Uruchom najpierw: npm install`);
  process.exit(1);
}

console.log(`[vendor] skopiowano ${FILES.length} pozycji -> ${OUT}/`);
