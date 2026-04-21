// ─── WEATHER COMPONENTS — INIT ────────────────────────────────────────────────
// Feeds weather data into the weather bar (id="weatherTopBar")
// and mounts the full weather modal (bottom sheet).
//
// Usage in main.ts:
//   import { initWeatherComponents } from './modules/initWeatherComponents.js';
//   void initWeatherComponents();

import { getWeather }        from './WeatherService.js';
import { WeatherModal }      from './WeatherModal.js';
import type { WeatherData }  from './WeatherTypes.js';
import type { Coords }       from '../types/index.js';

// ── Singletons ────────────────────────────────────────────────────────────────

let _modal:  WeatherModal | null = null;
let _coords: Coords       | null = null;

// ── Update weather bar elements ───────────────────────────────────────────────

function updateBottomBar(data: WeatherData): void {
  const loc   = document.getElementById('bnwLocation');
  const icon  = document.getElementById('bnwIcon');
  const temp  = document.getElementById('bnwTemp');
  const desc  = document.getElementById('bnwDesc');
  const feels = document.getElementById('bnwFeels');

  if (loc)   loc.textContent   = data.location;
  if (icon)  icon.textContent  = data.current.icon;
  if (temp)  temp.textContent  = `${data.current.temp}°C`;
  if (desc)  desc.textContent  = data.current.description;
  if (feels) feels.textContent = `Feels ${data.current.feelsLike}°`;
}

// ── Wire weather bar click → open modal ──────────────────────────────────────

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
  // 1. Use provided coords, or get from browser GPS
  _coords = coords ?? await _getCoords();
  if (!_coords) {
    console.warn('[Weather] Could not get coordinates — weather disabled');
    return;
  }

  // 2. Fetch weather data
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

  // 4. Update bar + wire click
  updateBottomBar(data);
  bindBottomBar(_modal);

  // 5. Refresh every 30 min
  setInterval(async () => {
    if (!_coords || !_modal) return;
    try {
      data = await getWeather(_coords);
      _modal.update(data);
      updateBottomBar(data);
    } catch { /* keep last known data */ }
  }, 30 * 60 * 1000);
}

/** Open/close modal programmatically */
export function openWeatherModal():  void { _modal?.open();  }
export function closeWeatherModal(): void { _modal?.close(); }

// ── Geolocation helper ────────────────────────────────────────────────────────
// Uses maximumAge=10min so it returns cached position instantly
// if the app already requested GPS (avoids double waiting).

/**
 * Get coordinates with fallback strategy:
 * 1. Try cached position first (instant, up to 30min old)
 * 2. If no cache, try low-accuracy GPS (faster, 10s timeout)
 * 3. If that fails, retry once with high-accuracy (15s timeout)
 * 4. If all fail, use last known coords from localStorage
 */
function _getCoords(): Promise<Coords | null> {
  const LS_KEY = 'mapty_last_coords';

  // Save coords to localStorage whenever we get them
  function saveCoords(coords: Coords): void {
    localStorage.setItem(LS_KEY, JSON.stringify(coords));
  }

  // Load last known coords from localStorage
  function loadLastCoords(): Coords | null {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) as Coords : null;
    } catch { return null; }
  }

  function tryGet(opts: PositionOptions): Promise<Coords | null> {
    return new Promise(resolve => {
      if (!navigator.geolocation) { resolve(null); return; }
      navigator.geolocation.getCurrentPosition(
        pos => {
          const coords: Coords = [pos.coords.latitude, pos.coords.longitude];
          saveCoords(coords);
          resolve(coords);
        },
        () => resolve(null),
        opts,
      );
    });
  }

  return (async () => {
    // 1. Try cached position (maximumAge = 30min, instant response)
    const cached = await tryGet({
      enableHighAccuracy: false,
      timeout:            2000,
      maximumAge:         30 * 60 * 1000,
    });
    if (cached) return cached;

    // 2. Try fresh low-accuracy position (10s)
    const fast = await tryGet({
      enableHighAccuracy: false,
      timeout:            10000,
      maximumAge:         0,
    });
    if (fast) return fast;

    // 3. Retry with high accuracy (15s)
    const precise = await tryGet({
      enableHighAccuracy: true,
      timeout:            15000,
      maximumAge:         0,
    });
    if (precise) return precise;

    // 4. Fallback to last known coords from localStorage
    const lastKnown = loadLastCoords();
    if (lastKnown) {
      console.warn('[Weather] GPS unavailable — using last known location');
      return lastKnown;
    }

    return null;
  })();
}
