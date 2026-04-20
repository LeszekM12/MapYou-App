// ─── WEATHER COMPONENTS — INIT ────────────────────────────────────────────────
// Feeds weather data into the weather bar (id="weatherTopBar")
// and mounts the full weather modal (bottom sheet).
//
// Usage in main.ts:
//   import { initWeatherComponents } from './modules/initWeatherComponents.js';
//   void initWeatherComponents();
import { getWeather } from './WeatherService.js';
import { WeatherModal } from './WeatherModal.js';
// ── Singletons ────────────────────────────────────────────────────────────────
let _modal = null;
let _coords = null;
// ── Update weather bar elements ───────────────────────────────────────────────
function updateBottomBar(data) {
    const loc = document.getElementById('bnwLocation');
    const icon = document.getElementById('bnwIcon');
    const temp = document.getElementById('bnwTemp');
    const desc = document.getElementById('bnwDesc');
    const feels = document.getElementById('bnwFeels');
    if (loc)
        loc.textContent = data.location;
    if (icon)
        icon.textContent = data.current.icon;
    if (temp)
        temp.textContent = `${data.current.temp}°C`;
    if (desc)
        desc.textContent = data.current.description;
    if (feels)
        feels.textContent = `Feels ${data.current.feelsLike}°`;
}
// ── Wire weather bar click → open modal ──────────────────────────────────────
function bindBottomBar(modal) {
    const bar = document.getElementById('weatherTopBar');
    if (!bar)
        return;
    const open = () => modal.isOpen ? modal.close() : modal.open();
    bar.addEventListener('click', open);
    bar.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
        }
    });
}
// ── Main init ─────────────────────────────────────────────────────────────────
export async function initWeatherComponents(coords) {
    // 1. Use provided coords, or get from browser GPS
    _coords = coords ?? await _getCoords();
    if (!_coords) {
        console.warn('[Weather] Could not get coordinates — weather disabled');
        return;
    }
    // 2. Fetch weather data
    let data;
    try {
        data = await getWeather(_coords);
    }
    catch (err) {
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
        if (!_coords || !_modal)
            return;
        try {
            data = await getWeather(_coords);
            _modal.update(data);
            updateBottomBar(data);
        }
        catch { /* keep last known data */ }
    }, 30 * 60 * 1000);
}
/** Open/close modal programmatically */
export function openWeatherModal() { _modal?.open(); }
export function closeWeatherModal() { _modal?.close(); }
// ── Geolocation helper ────────────────────────────────────────────────────────
// Uses maximumAge=10min so it returns cached position instantly
// if the app already requested GPS (avoids double waiting).
function _getCoords() {
    return new Promise(resolve => {
        if (!navigator.geolocation) {
            resolve(null);
            return;
        }
        navigator.geolocation.getCurrentPosition(pos => resolve([pos.coords.latitude, pos.coords.longitude]), _err => resolve(null), {
            enableHighAccuracy: false, // faster — no GPS precision needed
            timeout: 5000, // 5s max
            maximumAge: 10 * 60 * 1000, // accept 10min old cached position
        });
    });
}
//# sourceMappingURL=initWeatherComponents.js.map