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
  'index.html',
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

console.log('Assembled ->', OUT);
