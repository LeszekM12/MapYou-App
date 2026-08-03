// Assembles a clean web bundle for Capacitor into ./www
// (this project builds with plain `tsc` → dist/, no bundler, so we gather the
//  static assets the same way index.html references them).
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';

const OUT = 'www';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const copy = (p) => { if (existsSync(p)) cpSync(p, `${OUT}/${p}`, { recursive: true }); };

// Everything index.html references (relative paths keep working from www/ root)
[
  // 'index.html' NIE jest kopiowane — w korzeniu repo stoi teraz LANDING
  // (strona informacyjna dla Google i sklepow). Wlasciwa apka mieszka
  // w `app.html` i trafia do `www/index.html` osobnym krokiem nizej.
  // Faza 4 / D4: dokumenty prawne MUSZA jechac z apka. Wczesniej istnialy
  // tylko na GitHub Pages, wiec grupa C (wygaszenie PWA) zabilaby linki
  // „Polityka prywatnosci" i „Regulamin" — a bez nich sklepy nie wpuszcza
  // aktualizacji. Lokalna kopia dziala tez bez zasiegu.
  'privacy.html',
  'terms.html',
  'dist',
  'public',
  'push-sw.js',
  'style.css',
  'home_styles.css',
  'weather.css',
  'light_theme.css',
  'friends.css',
  'profile_styles.css',
  'search_styles.css',
  'stats_styles.css',
].forEach(copy);

// Apka: `app.html` -> `www/index.html`.
// Capacitor zawsze laduje `index.html` z katalogu `www`, wiec podmieniamy
// nazwe przy kopiowaniu. Dzieki temu w korzeniu repo moze stac landing,
// a apka natywna dostaje pelna aplikacje — jedno nie koliduje z drugim.
if (existsSync('app.html')) {
  cpSync('app.html', `${OUT}/index.html`);
}

console.log('Assembled ->', OUT);
