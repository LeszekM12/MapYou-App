// ─── LOCATION SERVICE ─────────────────────────────────────────────────────────
// src/modules/LocationService.ts
//
// Strategy:
//   1. On app start → IP-based location (no permission needed)
//   2. On tracking start → GPS (request permission then)
//   3. If IP API exhausted → ask for GPS as fallback
//   4. Once GPS granted → switch weather + map to precise coords
const LS_LAST_COORDS = 'mapty_last_coords';
const LS_GPS_GRANTED = 'mapty_gps_granted';
const LS_IP_COORDS = 'mapty_ip_coords';
export async function getIPLocation() {
    // 0. Migrate old cache key from previous app version
    _migrateOldCache();
    // 1. Try ipapi.co
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal });
        clearTimeout(tid);
        if (res.ok) {
            const data = await res.json();
            // ipapi.co returns error:true for localhost/reserved IPs
            if (!data.error && data.latitude && data.longitude) {
                const coords = [data.latitude, data.longitude];
                _saveIPCache(coords, data.city ?? '', data.country_name ?? '');
                return { coords, city: data.city ?? '', country: data.country_name ?? '', source: 'ip' };
            }
        }
    }
    catch { /* network error or abort — fall through */ }
    // 2. Fallback: ipwho.is
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch('https://ipwho.is/', { signal: ctrl.signal });
        clearTimeout(tid);
        if (res.ok) {
            const data = await res.json();
            if (data.success && data.latitude && data.longitude) {
                const coords = [data.latitude, data.longitude];
                _saveIPCache(coords, data.city ?? '', data.country ?? '');
                return { coords, city: data.city ?? '', country: data.country ?? '', source: 'ip' };
            }
        }
    }
    catch { /* both APIs failed */ }
    // 3. Fallback: ip-api.com (different provider)
    try {
        const ctrl = new AbortController();
        const tid = setTimeout(() => ctrl.abort(), 5000);
        const res = await fetch('http://ip-api.com/json/?fields=status,lat,lon,city,country', { signal: ctrl.signal });
        clearTimeout(tid);
        if (res.ok) {
            const data = await res.json();
            if (data.status === 'success' && data.lat && data.lon) {
                const coords = [data.lat, data.lon];
                _saveIPCache(coords, data.city ?? '', data.country ?? '');
                return { coords, city: data.city ?? '', country: data.country ?? '', source: 'ip' };
            }
        }
    }
    catch { /* all APIs failed */ }
    // 4. Use any cached coords from this or previous session
    try {
        const cached = localStorage.getItem(LS_IP_COORDS);
        if (cached) {
            const { coords, city, country } = JSON.parse(cached);
            return { coords, city, country, source: 'cache' };
        }
    }
    catch { }
    // 5. Last resort: last known GPS coords (saved from any previous GPS use)
    try {
        const raw = localStorage.getItem(LS_LAST_COORDS);
        if (raw) {
            const coords = JSON.parse(raw);
            return { coords, city: '', country: '', source: 'cache' };
        }
    }
    catch { }
    return null;
}
function _saveIPCache(coords, city, country) {
    localStorage.setItem(LS_IP_COORDS, JSON.stringify({ coords, city, country }));
}
/** Migrate old cache key 'mapty_last_coords' → 'mapty_ip_coords' (one-time) */
function _migrateOldCache() {
    if (localStorage.getItem(LS_IP_COORDS))
        return; // already migrated
    try {
        const old = localStorage.getItem('mapty_last_coords');
        if (old) {
            const coords = JSON.parse(old);
            localStorage.setItem(LS_IP_COORDS, JSON.stringify({ coords, city: '', country: '' }));
        }
    }
    catch { }
}
// ── GPS Location ──────────────────────────────────────────────────────────────
export async function hasGPSPermission() {
    // Quick localStorage cache to avoid async delay on every call
    if (localStorage.getItem(LS_GPS_GRANTED) === '1')
        return true;
    try {
        const r = await navigator.permissions.query({ name: 'geolocation' });
        const granted = r.state === 'granted';
        if (granted)
            localStorage.setItem(LS_GPS_GRANTED, '1');
        return granted;
    }
    catch {
        return false;
    }
}
export function getGPSLocation() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error('no_geolocation'));
            return;
        }
        navigator.geolocation.getCurrentPosition(pos => {
            const coords = [pos.coords.latitude, pos.coords.longitude];
            localStorage.setItem(LS_LAST_COORDS, JSON.stringify(coords));
            localStorage.setItem(LS_GPS_GRANTED, '1');
            resolve(coords);
        }, err => reject(err), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
    });
}
/**
 * Request GPS permission explicitly.
 * Returns coords on success, null on denial.
 */
export async function requestGPSPermission() {
    try {
        const coords = await getGPSLocation();
        return coords;
    }
    catch {
        localStorage.removeItem(LS_GPS_GRANTED);
        return null;
    }
}
/**
 * Subscribe to geolocation permission changes.
 * Calls callback with new coords when permission is granted.
 */
export function subscribeToPermissionChanges(callback) {
    let permStatus = null;
    const handler = async () => {
        if (permStatus?.state === 'granted') {
            try {
                const coords = await getGPSLocation();
                callback(coords);
            }
            catch { }
        }
    };
    navigator.permissions?.query({ name: 'geolocation' })
        .then(status => {
        permStatus = status;
        status.addEventListener('change', handler);
    })
        .catch(() => { });
    // Return unsubscribe function
    return () => { permStatus?.removeEventListener('change', handler); };
}
/**
 * Get the best available location:
 * GPS if already granted, otherwise IP.
 */
export async function getBestLocation() {
    if (await hasGPSPermission()) {
        try {
            const coords = await getGPSLocation();
            return { coords, city: '', country: '', source: 'gps' };
        }
        catch { }
    }
    return getIPLocation();
}
export function getLastKnownCoords() {
    try {
        const raw = localStorage.getItem(LS_LAST_COORDS);
        return raw ? JSON.parse(raw) : null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=LocationService.js.map