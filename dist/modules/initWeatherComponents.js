// ─── WEATHER COMPONENTS — INIT ────────────────────────────────────────────────
// Uses IP-based location on startup — zero GPS permission requests.
// Switches to GPS automatically when permission is later granted.
import { getWeather } from './WeatherService.js';
import { WeatherModal } from './WeatherModal.js';
import { getIPLocation, hasGPSPermission, getGPSLocation, subscribeToPermissionChanges, } from './LocationService.js';
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
        icon.innerHTML = data.current.icon;
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
// ── Load weather for given coords ─────────────────────────────────────────────
async function loadWeather(coords) {
    let data;
    try {
        data = await getWeather(coords);
    }
    catch (err) {
        console.warn('[Weather] Fetch failed:', err);
        return;
    }
    _coords = coords;
    if (!_modal) {
        _modal = new WeatherModal();
        _modal.mount(data);
        bindBottomBar(_modal);
    }
    else {
        _modal.update(data);
    }
    updateBottomBar(data);
}
// ── Switch to GPS weather (called after permission granted) ───────────────────
export async function switchToGPSWeather() {
    try {
        const gpsCoords = await getGPSLocation();
        await loadWeather(gpsCoords);
        console.info('[Weather] Switched to GPS location');
    }
    catch {
        console.warn('[Weather] GPS switch failed — keeping IP weather');
    }
}
export async function loadWeatherByIP() {
    const ipLoc = await getIPLocation();
    if (!ipLoc) {
        console.warn('[Weather] IP location unavailable');
        return;
    }
    await loadWeather(ipLoc.coords);
}
export async function loadWeatherByGPS() {
    await switchToGPSWeather();
}
// ── Main init ─────────────────────────────────────────────────────────────────
export async function initWeatherComponents() {
    // 1. If GPS already granted from previous session → use it directly
    if (await hasGPSPermission()) {
        try {
            const gpsCoords = await getGPSLocation();
            await loadWeather(gpsCoords);
        }
        catch {
            // GPS call failed despite permission — fall back to IP
            await loadWeatherByIP();
        }
    }
    else {
        // 2. No GPS → use IP location (zero permission prompt)
        await loadWeatherByIP();
    }
    if (!_coords) {
        console.warn('[Weather] Could not get any location — weather disabled');
        return;
    }
    // 3. Subscribe to permission changes → auto-upgrade to GPS weather
    subscribeToPermissionChanges(async (gpsCoords) => {
        await loadWeather(gpsCoords);
        // Also notify map to re-center
        window.dispatchEvent(new CustomEvent('mapyou:gps-granted', {
            detail: { coords: gpsCoords },
        }));
    });
    // 4. Refresh every 30 min
    setInterval(async () => {
        if (!_coords || !_modal)
            return;
        try {
            const data = await getWeather(_coords);
            _modal.update(data);
            updateBottomBar(data);
        }
        catch { /* keep last known data */ }
    }, 30 * 60 * 1000);
}
export function openWeatherModal() { _modal?.open(); }
export function closeWeatherModal() { _modal?.close(); }
//# sourceMappingURL=initWeatherComponents.js.map