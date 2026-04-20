// ─── WEATHER COMPONENTS — INIT ────────────────────────────────────────────────
// Drop-in entry point.
// Call initWeatherComponents() once after your map / app is ready.
//
// Usage in main.ts:
//   import { initWeatherComponents } from './modules/weather/initWeatherComponents.js';
//   initWeatherComponents();

import { getWeather }    from './WeatherService.js';
import { WeatherModal }  from './WeatherModal.js';
import { WeatherTopBar } from './WeatherTopBar.js';
import type { Coords }   from '../types/index.js';

// ── Module singletons ─────────────────────────────────────────────────────────

let _modal:  WeatherModal  | null = null;
let _topBar: WeatherTopBar | null = null;
let _coords: Coords        | null = null;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Initialize weather top bar + modal.
 *
 * @param topBarContainer  — element the top bar will be prepended into
 *                           (defaults to document.body)
 * @param coords           — [lat, lng] to fetch weather for.
 *                           If omitted, uses the browser Geolocation API.
 */
export async function initWeatherComponents(
  topBarContainer: HTMLElement = document.body,
  coords?:         Coords,
): Promise<void> {

  // 1. Resolve coordinates
  _coords = coords ?? await _getCoords();
  if (!_coords) {
    console.warn('[Weather] Could not get coordinates — weather disabled');
    return;
  }

  // 2. Fetch initial data
  let data = await getWeather(_coords);

  // 3. Create modal first (top bar needs a reference to it)
  _modal = new WeatherModal();
  _modal.mount(data);

  // 4. Create top bar
  _topBar = new WeatherTopBar(_modal);
  _topBar.mount(topBarContainer, data);

  // 5. Refresh every 30 min
  setInterval(async () => {
    if (!_coords) return;
    try {
      data = await getWeather(_coords);
      _modal?.update(data);
      _topBar?.update(data);
    } catch {
      // Fail silently — keep showing last known data
    }
  }, 30 * 60 * 1000);
}

/** Open the modal programmatically */
export function openWeatherModal(): void  { _modal?.open();  }

/** Close the modal programmatically */
export function closeWeatherModal(): void { _modal?.close(); }

// ── Private helpers ───────────────────────────────────────────────────────────

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
