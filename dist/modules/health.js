// ─── HEALTH DATA (Apple Health / Android Health Connect) ─────────────────────
// Platform-agnostic layer. The rest of the app talks ONLY to this module, so
// iOS (HealthKit) and Android (Health Connect) are just interchangeable adapters
// behind the same interface. Milestone 1 covers daily STEPS; workouts, heart
// rate, route etc. slot into the same interface later.
const DAY = 86400000;
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
const startOfDay = (ms) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
// Map Health Connect / HealthKit workout types to MapYou sport keys.
function mapHealthSport(t) {
    const k = t.toLowerCase().replace(/[\s_-]/g, '');
    if (k.includes('run'))
        return 'running';
    if (k.includes('walk'))
        return 'walking';
    if (k.includes('hik'))
        return 'hiking';
    if (k.includes('bik') || k.includes('cycl'))
        return 'cycling';
    if (k.includes('swim'))
        return 'swimming';
    if (k.includes('ski'))
        return 'skiing';
    if (k.includes('snowboard'))
        return 'snowboard';
    if (k.includes('row'))
        return 'rowing';
    if (k.includes('yoga'))
        return 'yoga';
    if (k.includes('strength') || k.includes('weight') || k.includes('gym'))
        return 'strength';
    return 'other';
}
// ─── Mock provider (web / PWA dev — no native bridge) ────────────────────────
// Gives plausible, stable step counts so the whole flow is testable in the
// browser before the native build exists.
class MockHealthProvider {
    async isAvailable() { return true; }
    async requestPermissions() { return true; }
    async getSteps(startMs, endMs) {
        let total = 0;
        for (let t = startOfDay(startMs); t < endMs; t += DAY) {
            const d = new Date(t);
            const seed = (d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate());
            const base = 3000 + ((seed * 2654435761) % 9000); // 3k–12k, stable per date
            const future = t > Date.now();
            total += future ? 0 : Math.round(base);
        }
        return total;
    }
    async getWorkouts(startMs, endMs) {
        // One fake outdoor run yesterday + one indoor session — enough to exercise
        // the whole import UI in the browser.
        const y = startOfDay(Date.now() - DAY) + 8 * 3600000;
        if (y < startMs || y > endMs)
            return [];
        const route = [];
        for (let i = 0; i <= 60; i++) {
            route.push([54.352 + Math.sin(i / 9.5) * 0.0035, 18.646 + (i / 60) * 0.012]);
        }
        const mkHr = (dur, base, amp) => {
            const out = [];
            for (let s = 0; s <= dur; s += Math.max(10, Math.round(dur / 180))) {
                out.push([s, Math.round(base + amp * Math.sin(s / 95) + (s / dur) * 14 + (Math.sin(s / 17) * 4))]);
            }
            return out;
        };
        return [
            {
                sourceId: 'mock_run_1', sourceName: 'Demo Watch', sport: 'running',
                startMs: y, endMs: y + 31 * 60000, durationSec: 31 * 60,
                distanceKm: 5.21, calories: 402, avgHr: 152, maxHr: 176,
                hrSeries: mkHr(31 * 60, 148, 12), laps: [{ km: 1, durationSec: 352, paceMinKm: 352 / 60 }, { km: 2, durationSec: 341, paceMinKm: 341 / 60 }, { km: 3, durationSec: 366, paceMinKm: 366 / 60 }, { km: 4, durationSec: 349, paceMinKm: 349 / 60 }, { km: 5, durationSec: 338, paceMinKm: 338 / 60 }], coords: route,
            },
            {
                sourceId: 'mock_gym_1', sourceName: 'Demo Watch', sport: 'strength',
                startMs: y + 10 * 3600000, endMs: y + 10 * 3600000 + 45 * 60000, durationSec: 45 * 60,
                distanceKm: null, calories: 310, avgHr: 121, maxHr: 149,
                hrSeries: mkHr(45 * 60, 118, 16), laps: [], coords: [],
            },
        ];
    }
}
function getCapacitorPlugin() {
    const cap = globalThis.Capacitor;
    if (!cap?.Plugins)
        return null;
    // capacitor-health registers as "HealthPlugin"; check likely names defensively.
    const p = (cap.Plugins['HealthPlugin'] ?? cap.Plugins['Health'] ?? cap.Plugins['CapacitorHealth']);
    return p ?? null;
}
class NativeHealthProvider {
    plugin() {
        return getCapacitorPlugin();
    }
    async isAvailable() {
        const p = this.plugin();
        if (!p)
            return false;
        try {
            return (await p.isHealthAvailable()).available;
        }
        catch {
            return false;
        }
    }
    async requestPermissions() {
        const p = this.plugin();
        if (!p)
            return false;
        try {
            const r = await p.requestHealthPermissions({ permissions: ['READ_STEPS'] });
            return r ? (r.granted ?? true) : true;
        }
        catch {
            return false;
        }
    }
    async getSteps(startMs, endMs) {
        const p = this.plugin();
        if (!p)
            return 0;
        try {
            const r = await p.queryAggregated({
                startDate: new Date(startMs).toISOString(),
                endDate: new Date(endMs).toISOString(),
                dataType: 'steps',
                bucket: 'day',
            });
            return (r.aggregatedData ?? []).reduce((s, x) => s + (x.value || 0), 0);
        }
        catch {
            return 0;
        }
    }
    async getWorkouts(startMs, endMs) {
        const p = this.plugin();
        if (!p)
            return [];
        try {
            // Workouts need their own read permissions — request lazily on first use.
            await p.requestHealthPermissions({
                permissions: ['READ_WORKOUTS', 'READ_HEART_RATE', 'READ_ROUTE', 'READ_DISTANCE', 'READ_CALORIES'],
            }).catch(() => undefined);
            const r = await p.queryWorkouts({
                startDate: new Date(startMs).toISOString(),
                endDate: new Date(endMs).toISOString(),
                includeHeartRate: true,
                includeRoute: true,
                includeSteps: false,
            });
            return (r.workouts ?? []).map(w => this._normalise(w)).filter((w) => w !== null)
                .sort((a, b) => b.startMs - a.startMs);
        }
        catch {
            return [];
        }
    }
    _normalise(w) {
        const startMs = w.startDate ? Date.parse(w.startDate) : NaN;
        const endMs = w.endDate ? Date.parse(w.endDate) : NaN;
        if (Number.isNaN(startMs) || Number.isNaN(endMs))
            return null;
        const durationSec = w.duration && w.duration > 0 ? Math.round(w.duration) : Math.round((endMs - startMs) / 1000);
        const pts = (w.route ?? [])
            .map(pt => {
            const lat = pt.lat ?? pt.latitude, lng = pt.lng ?? pt.longitude;
            if (typeof lat !== 'number' || typeof lng !== 'number')
                return null;
            const tMs = typeof pt.timestamp === 'number' ? pt.timestamp : pt.time ? Date.parse(pt.time) : NaN;
            return { lat, lng, t: tMs };
        })
            .filter((c) => c !== null);
        const coords = pts.map(p => [p.lat, p.lng]);
        // Per-km splits when route points carry timestamps
        const laps = [];
        if (pts.length > 2 && pts.every(p => !Number.isNaN(p.t))) {
            const R = 6371000, rad = Math.PI / 180;
            let acc = 0, lapStartT = pts[0].t, km = 1;
            for (let i = 1; i < pts.length; i++) {
                const a = pts[i - 1], b = pts[i];
                const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
                const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
                acc += 2 * R * Math.asin(Math.sqrt(h));
                if (acc >= km * 1000) {
                    const durS = Math.max(1, Math.round((b.t - lapStartT) / 1000));
                    laps.push({ km, durationSec: durS, paceMinKm: (durS / 60) });
                    lapStartT = b.t;
                    km++;
                }
            }
        }
        const hrRaw = (w.heartRate ?? [])
            .map(h => {
            const bpm = h.bpm ?? h.value;
            const tMs = typeof h.timestamp === 'number' ? h.timestamp
                : h.time ? Date.parse(h.time)
                    : h.startDate ? Date.parse(h.startDate) : NaN;
            return (typeof bpm === 'number' && bpm > 20) ? { t: tMs, bpm } : null;
        })
            .filter((x) => x !== null);
        const hrs = hrRaw.map(x => x.bpm);
        // Downsample the series to ≤240 points, offsets in seconds from start
        let hrSeries = [];
        const timed = hrRaw.filter(x => !Number.isNaN(x.t)).sort((a, b) => a.t - b.t);
        if (timed.length) {
            const step = Math.max(1, Math.ceil(timed.length / 240));
            for (let i = 0; i < timed.length; i += step) {
                hrSeries.push([Math.max(0, Math.round((timed[i].t - startMs) / 1000)), timed[i].bpm]);
            }
        }
        else if (hrs.length) {
            // No timestamps — spread samples evenly over the workout
            const step = Math.max(1, Math.ceil(hrs.length / 240));
            for (let i = 0; i < hrs.length; i += step) {
                hrSeries.push([Math.round((i / hrs.length) * durationSec), hrs[i]]);
            }
        }
        return {
            sourceId: w.id ?? `${startMs}_${endMs}`,
            sourceName: w.sourceName ?? 'Health',
            sport: mapHealthSport(w.workoutType ?? ''),
            startMs, endMs, durationSec,
            distanceKm: typeof w.distance === 'number' && w.distance > 0 ? w.distance / 1000 : null,
            calories: typeof w.calories === 'number' && w.calories > 0 ? Math.round(w.calories) : null,
            avgHr: hrs.length ? Math.round(hrs.reduce((s, v) => s + v, 0) / hrs.length) : null,
            maxHr: hrs.length ? Math.round(Math.max(...hrs)) : null,
            hrSeries,
            laps,
            coords,
        };
    }
}
// ─── Provider selection ──────────────────────────────────────────────────────
function isNativePlatform() {
    const cap = globalThis.Capacitor;
    return !!cap?.isNativePlatform?.();
}
let _provider = null;
let _providerKind = 'mock';
export async function getHealthProvider() {
    if (_provider)
        return _provider;
    if (isNativePlatform()) {
        const native = new NativeHealthProvider();
        if (await native.isAvailable()) {
            // Ask the OS for read permission before the first real read. The system
            // sheet shows once; afterwards this resolves silently.
            await native.requestPermissions().catch(() => false);
            _provider = native;
            _providerKind = 'native';
            return native;
        }
    }
    _provider = new MockHealthProvider();
    _providerKind = 'mock';
    return _provider;
}
/** 'native' = real Health Connect / HealthKit; 'mock' = demo numbers (web dev). */
export function getHealthProviderKind() { return _providerKind; }
// ─── Permission gate (ask once, remember the answer) ─────────────────────────
const PERM_KEY = 'mapyou_health_perm';
export async function ensureStepPermission() {
    if (localStorage.getItem(PERM_KEY) === 'granted')
        return true;
    const p = await getHealthProvider();
    const ok = await p.requestPermissions();
    if (ok)
        localStorage.setItem(PERM_KEY, 'granted');
    return ok;
}
export function hasAskedHealthPermission() {
    return localStorage.getItem(PERM_KEY) === 'granted';
}
// ─── Daily-steps cache + convenience reads ───────────────────────────────────
const CACHE_KEY = 'mapyou_daily_steps';
function readCache() {
    try {
        return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    }
    catch {
        return {};
    }
}
function writeCache(c) {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    }
    catch { /* ignore */ }
}
/** Steps for a single calendar day. Reads cache instantly, refreshes in bg. */
export async function getDaySteps(dayMs) {
    const p = await getHealthProvider();
    const start = startOfDay(dayMs);
    try {
        const steps = await p.getSteps(start, start + DAY);
        const c = readCache();
        c[dayKey(start)] = steps;
        writeCache(c);
        return steps;
    }
    catch {
        const c = readCache();
        return c[dayKey(start)] ?? null;
    }
}
/** Steps for a 7-day window starting at weekStartMs. */
export async function getWeekSteps(weekStartMs) {
    const p = await getHealthProvider();
    const start = startOfDay(weekStartMs);
    try {
        const total = await p.getSteps(start, start + 7 * DAY);
        return total;
    }
    catch {
        return null;
    }
}
/** Cached value without hitting the provider (for instant first paint). */
export function getCachedDaySteps(dayMs) {
    const c = readCache();
    return c[dayKey(startOfDay(dayMs))] ?? null;
}
// ─── Workout import: dedup + convenience ─────────────────────────────────────
const IMPORTED_KEY = 'mapyou_imported_health_ids';
export function getImportedHealthIds() {
    try {
        return new Set(JSON.parse(localStorage.getItem(IMPORTED_KEY) ?? '[]'));
    }
    catch {
        return new Set();
    }
}
export function markHealthImported(sourceId) {
    const s = getImportedHealthIds();
    s.add(sourceId);
    try {
        localStorage.setItem(IMPORTED_KEY, JSON.stringify([...s].slice(-500)));
    }
    catch { /* ignore */ }
}
/** Workouts from the last `days`, with already-imported ones flagged. */
export async function getImportableWorkouts(days = 14) {
    const p = await getHealthProvider();
    const now = Date.now();
    const list = await p.getWorkouts(now - days * DAY, now);
    const done = getImportedHealthIds();
    return list.map(w => ({ ...w, imported: done.has(w.sourceId) }));
}
/** Open the Health Connect settings screen (native only; no-op on web). */
export async function openHealthConnectSettings() {
    const cap = globalThis.Capacitor;
    if (!cap?.isNativePlatform?.())
        return;
    const p = cap.Plugins?.['HealthPlugin'];
    try {
        if (p?.openHealthConnectSettings) {
            await p.openHealthConnectSettings();
            return;
        }
        if (p?.openHealthSettings) {
            await p.openHealthSettings();
            return;
        }
    }
    catch { /* fall through */ }
    // Fallback: Android intent URI understood by the WebView shell
    try {
        window.open('intent://#Intent;action=android.health.connect.action.HEALTH_HOME_SETTINGS;end', '_system');
    }
    catch { /* ignore */ }
}
//# sourceMappingURL=health.js.map