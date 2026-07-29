// Bundles the compiled app into a single self-contained file for the native
// shell (Faza 3).
//
// Dlaczego to istnieje:
//   Projekt kompiluje się czystym `tsc`, który zostawia importy npm
//   ("firebase/app") niezmienione. WebView w natywnej apce — na iOS i na
//   Androidzie — nie potrafi ich rozwiązać. esbuild wkompilowuje je w paczkę,
//   więc Firebase SDK leży na dysku telefonu razem z kodem apki.
//
//   Efekt uboczny (celowy): start apki nie wymaga sieci. Service worker
//   NIE działa w natywnym WKWebView na iOS, więc pobieranie SDK z CDN
//   oznaczałoby, że apka bez zasięgu w ogóle się nie uruchomi.
//
// Wejście:  dist/main.js         (wynik tsc)
// Wyjście:  www/dist/main.js     (nadpisuje kopię z assemble-www.mjs)
//
// Capacitor i jego pluginy NIE są bundlowane — sięgamy po nie przez
// globalThis.Capacitor (tak jak nativeGeo.ts), bo wstrzykuje je natywny most.

import { build } from 'esbuild';

await build({
  entryPoints: ['dist/main.js'],
  outfile:     'www/dist/main.js',
  bundle:      true,
  format:      'esm',
  platform:    'browser',
  target:      ['es2020', 'safari15'],
  sourcemap:   true,
  allowOverwrite: true,
  logLevel:    'info',
  // Biblioteki ładowane w index.html przez <script> (Leaflet, Chart.js,
  // Dexie, sodium) zostają globalami — nie ma ich w importach, więc
  // esbuild ich nie dotyka.
});

console.log('Bundled -> www/dist/main.js');
