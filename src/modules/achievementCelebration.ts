// ─── CELEBRACJA ZDOBYTEJ ODZNAKI ─────────────────────────────────────────────
// src/modules/achievementCelebration.ts
//
// PO CO
// Do tej pory po zakonczeniu treningu nie dzialo sie z odznakami NIC. Odznaka
// przyznawala sie po cichu dopiero wtedy, gdy uzytkownik sam wszedl w zakladke
// Trophy — czyli moment zdobycia 800 km mijal niezauwazony.
//
// JAK TO DZIALA
// `/achievements/recompute` zwraca `newOnes` — odznaki przyznane WLASNIE TERAZ,
// a nie wszystkie posiadane. Backend oddawal to pole od dawna, tylko nikt go
// nie czytal. To wystarcza: nie trzeba niczego zapamietywac po stronie klienta.
//
// DLACZEGO NIE MA RYZYKA PODWOJNEJ ANIMACJI
// `recompute` jest idempotentne, a `newOnes` zawiera wylacznie SWIEZO przyznane
// odznaki. Drugie wywolanie (np. przy wejsciu w Trophy) zwroci juz pusta liste.
//
// BRAK ZASIEGU
// Bez sieci `recompute` nie ma jak sie wykonac, wiec animacji nie bedzie od razu.
// Dlatego wolamy to samo przy starcie aplikacji: odznaka zdobyta w lesie bez
// zasiegu doczeka sie swojej animacji przy najblizszym uruchomieniu z siecia.

import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
import { esc } from '../utils/dom.js';

interface FreshAch {
  achId: string; label: string; desc: string;
  icon: string; color: string; group: string; value: number | null;
}

const STYLE_ID = 'mapyouAchStyle';
const HOLD_MS  = 1900;   // ile odznaka stoi na ekranie, zanim odleci
const FLY_MS   = 700;

let busy = false;

/** Klatki kluczowe wstrzykujemy raz, w kodzie — dzieki temu modul nie wymaga
 *  zadnego arkusza CSS i wdraza sie samym plikiem `.ts`. */
function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
@keyframes mapyouAchIn {
  0%   { transform: scale(0.2) rotate(-25deg); opacity: 0; }
  55%  { transform: scale(1.12) rotate(4deg);  opacity: 1; }
  100% { transform: scale(1)    rotate(0deg);  opacity: 1; }
}
@keyframes mapyouAchGlow {
  0%,100% { opacity: .35; transform: scale(1); }
  50%     { opacity: .65; transform: scale(1.15); }
}
@keyframes mapyouAchText {
  0%   { transform: translateY(14px); opacity: 0; }
  100% { transform: translateY(0);    opacity: 1; }
}
.mapyou-ach__backdrop {
  position: fixed; inset: 0; z-index: 99999;
  background: rgba(6,10,16,0.86);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 18px; padding: 24px; text-align: center;
  transition: opacity .35s ease;
}
.mapyou-ach__gem   { animation: mapyouAchIn .62s cubic-bezier(.2,.9,.3,1.2) both; }
.mapyou-ach__glow  { animation: mapyouAchGlow 1.6s ease-in-out infinite; }
.mapyou-ach__txt   { animation: mapyouAchText .45s ease .28s both; }
.mapyou-ach__flying{ position: fixed; z-index: 100000; pointer-events: none;
                     transition: transform ${FLY_MS}ms cubic-bezier(.55,0,.85,.35),
                                 opacity   ${FLY_MS}ms ease-in; }
@media (prefers-reduced-motion: reduce) {
  .mapyou-ach__gem, .mapyou-ach__glow, .mapyou-ach__txt { animation: none; }
  .mapyou-ach__flying { transition: opacity .2s ease; }
}`;
  document.head.appendChild(st);
}

/** Sześciobok — ten sam ksztalt co w gablocie profilu. */
function hexSVG(a: FreshAch, size = 132): string {
  const h = Math.round(size * 1.125);
  return `
  <svg viewBox="0 0 80 90" width="${size}" height="${h}" aria-hidden="true">
    <polygon points="40,2 78,22 78,68 40,88 2,68 2,22"
      fill="${a.color}" stroke="${a.color}" stroke-width="2"/>
    <polygon points="40,12 68,28 68,62 40,78 12,62 12,28" fill="${a.color}cc"/>
    ${a.value !== null ? `<text x="40" y="48" text-anchor="middle" font-size="21"
      font-weight="900" font-family="Manrope,sans-serif" fill="#fff">${esc(a.value)}</text>` : ''}
    <text x="40" y="${a.value !== null ? 67 : 55}" text-anchor="middle" font-size="15"
      fill="rgba(255,255,255,0.9)">${esc(a.icon)}</text>
  </svg>`;
}

/** Dokad odznaka odlatuje. Celem jest zakladka, w ktorej znajdzie ja pozniej —
 *  gdyby jej nie bylo, po prostu leci w dolny prawy rog. */
function target(): { x: number; y: number } {
  const el = document.querySelector<HTMLElement>('[data-tab="tabStats"]');
  if (el) {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  return { x: window.innerWidth - 40, y: window.innerHeight - 40 };
}

const wait = (ms: number): Promise<void> => new Promise(r => setTimeout(r, ms));

/** Pokaz JEDNA odznake: wjazd, chwila na przeczytanie, odlot do profilu. */
async function showOne(a: FreshAch): Promise<void> {
  ensureStyle();

  const back = document.createElement('div');
  back.className = 'mapyou-ach__backdrop';
  back.innerHTML = `
    <div style="position:relative;display:grid;place-items:center">
      <div class="mapyou-ach__glow" style="position:absolute;width:170px;height:170px;
           border-radius:50%;background:${a.color};filter:blur(34px);opacity:.4"></div>
      <div class="mapyou-ach__gem" id="mapyouAchGem" style="position:relative">${hexSVG(a)}</div>
    </div>
    <div class="mapyou-ach__txt">
      <div style="font:800 0.85rem/1 Manrope,sans-serif;letter-spacing:.16em;
           text-transform:uppercase;color:${a.color};margin-bottom:10px">Achievement unlocked</div>
      <div style="font:800 1.6rem/1.2 Manrope,sans-serif;color:#fff">${esc(a.label)}</div>
      <div style="font:400 0.95rem/1.45 Manrope,sans-serif;color:rgba(255,255,255,0.62);
           margin-top:8px;max-width:300px">${esc(a.desc)}</div>
    </div>`;
  document.body.appendChild(back);

  // Dotkniecie ekranu skraca oczekiwanie — nikt nie lubi czekac na animacje,
  // ktora juz przeczytal.
  let skip = false;
  back.addEventListener('click', () => { skip = true; }, { once: true });
  for (let i = 0; i < HOLD_MS / 100 && !skip; i++) await wait(100);

  // Odlot: sześciobok zostaje na ekranie jako osobny element, tlo gasnie.
  const gem = back.querySelector<HTMLElement>('#mapyouAchGem');
  if (gem) {
    const r = gem.getBoundingClientRect();
    const fly = document.createElement('div');
    fly.className = 'mapyou-ach__flying';
    fly.style.left = `${r.left}px`;
    fly.style.top  = `${r.top}px`;
    fly.style.width  = `${r.width}px`;
    fly.style.height = `${r.height}px`;
    fly.innerHTML = hexSVG(a, r.width);
    document.body.appendChild(fly);

    back.style.opacity = '0';
    const t = target();
    // Wymuszamy przeliczenie ukladu, inaczej przegladarka scali oba stany
    // w jeden i przejscie w ogole sie nie odegra.
    void fly.offsetWidth;
    fly.style.transform = `translate(${t.x - r.left - r.width / 2}px, `
                        + `${t.y - r.top - r.height / 2}px) scale(0.12)`;
    fly.style.opacity = '0.15';
    await wait(FLY_MS);
    fly.remove();
  }
  back.remove();
}

/** Przelicz osiagniecia i pokaz te, ktore wlasnie przybyly.
 *
 *  Bezpieczne do wolania czesto — bez nowych odznak nie robi nic widocznego. */
export async function celebrateNewAchievements(): Promise<void> {
  if (busy) return;
  const userId = getUserId();
  if (!userId) return;
  busy = true;
  try {
    const r = await fetch(`${BACKEND_URL}/achievements/recompute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    if (!r.ok) return;
    const d = await r.json() as { newOnes?: FreshAch[] };
    const fresh = d.newOnes ?? [];
    // Trzy odznaki naraz to juz nie nagroda, tylko kolejka — przy imporcie
    // historii potrafi ich byc kilkadziesiat.
    for (const a of fresh.slice(0, 3)) await showOne(a);
  } catch {
    // Brak sieci — nadrobi sie przy nastepnym uruchomieniu aplikacji.
  } finally {
    busy = false;
  }
}
