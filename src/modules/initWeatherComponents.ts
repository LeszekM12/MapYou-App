// ─── WEATHER COMPONENTS — INIT ────────────────────────────────────────────────
// Feeds weather data into the bottom nav weather bar (id="weatherTopBar")
// and mounts the full weather modal (bottom sheet).
//
// Usage in main.ts:
//   import { initWeatherComponents } from './modules/initWeatherComponents.js';
//   void initWeatherComponents();

import { getWeather }   from './WeatherService.js';
import { WeatherModal } from './WeatherModal.js';
import type { WeatherData } from './WeatherTypes.js';
import type { Coords }      from '../types/index.js';

// ── Singletons ────────────────────────────────────────────────────────────────

let _modal:  WeatherModal | null = null;
let _coords: Coords       | null = null;

// ── Update the bottom nav weather bar ────────────────────────────────────────

function updateBottomBar(data: WeatherData): void {
  const loc  = document.getElementById('bnwLocation');
  const icon = document.getElementById('bnwIcon');
  const temp = document.getElementById('bnwTemp');
  const desc = document.getElementById('bnwDesc');

  if (loc)  loc.textContent  = data.location;
  if (icon) icon.textContent = data.current.icon;
  if (temp) temp.textContent = `${data.current.temp}°C`;
  if (desc) desc.textContent = `${data.current.description} · Feels ${data.current.feelsLike}°`;
}

// ── Wire bottom bar click → open modal ───────────────────────────────────────

function bindBottomBar(modal: WeatherModal): void {
  const bar = document.getElementById('weatherTopBar');
  if (!bar) return;

  const open = () => modal.isOpen ? modal.close() : modal.open();
  bar.addEventListener('click', open);
  bar.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
  });
}

// ── Main init ─────────────────────────────────────────────────────────────────

export async function initWeatherComponents(coords?: Coords): Promise<void> {
  // 1. Resolve coordinates
  _coords = coords ?? await _getCoords();
  if (!_coords) {
    console.warn('[Weather] Could not get coordinates — weather disabled');
    return;
  }

  // 2. Fetch data
  let data: WeatherData;
  try {
    data = await getWeather(_coords);
  } catch (err) {
    console.warn('[Weather] Fetch failed:', err);
    return;
  }

  // 3. Mount modal
  _modal = new WeatherModal();
  _modal.mount(data);

  // 4. Update bottom bar + wire click
  updateBottomBar(data);
  bindBottomBar(_modal);

  // 5. Refresh every 30 min
  setInterval(async () => {
    if (!_coords || !_modal) return;
    try {
      data = await getWeather(_coords);
      _modal.update(data);
      updateBottomBar(data);
    } catch { /* keep showing last known data */ }
  }, 30 * 60 * 1000);
}

/** Open modal programmatically */
export function openWeatherModal():  void { _modal?.open();  }
export function closeWeatherModal(): void { _modal?.close(); }

// ── Geolocation helper ────────────────────────────────────────────────────────

function _getCoords(): Promise<Coords | null> {
  return new Promise(resolve => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve([pos.coords.latitude, pos.coords.longitude]),
      ()  => resolve(null),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}
