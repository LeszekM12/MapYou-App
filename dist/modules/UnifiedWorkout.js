// ─── UNIFIED WORKOUT MODEL ────────────────────────────────────────────────────
// src/modules/UnifiedWorkout.ts
//
// Single source of truth for all workouts (manual + tracked).
// Merges WorkoutRecord + EnrichedActivity + ActivityRecord into one model.
// Migration runs once on first load.
import { db } from './db.js';
// ── DB re-exports (single Dexie instance lives in db.ts) ────────────────────
// We re-export from db.ts to keep ONE instance of Dexie('mapty').
export { saveUnifiedWorkout, loadUnifiedWorkouts, deleteUnifiedWorkout, } from './db.js';
// ── Converters ────────────────────────────────────────────────────────────────
// Sanitize stored text: strips literal "undefined"/"null" and stray
// "undefined " prefixes that crept into legacy records.
function _cleanStr(v) {
    let s = (v == null ? '' : String(v)).trim();
    if (s.toLowerCase() === 'undefined' || s.toLowerCase() === 'null')
        return '';
    s = s.replace(/^(undefined|null)\s+/i, '').trim();
    return s;
}
function _typeFromString(s) {
    if (s === 'cycling')
        return 'cycling';
    if (s === 'walking')
        return 'walking';
    return 'running';
}
function _fromManual(w) {
    const distKm = Number(w.distance) || 0;
    const durSec = (Number(w.duration) || 0) * 60; // manual stores minutes
    const type = _typeFromString(w.type ?? 'running');
    const pace = durSec > 0 && distKm > 0 ? (durSec / 60) / distKm : 0;
    const speed = durSec > 0 && distKm > 0 ? distKm / (durSec / 3600) : 0;
    return {
        id: String(w.id),
        type,
        sport: String(w.type ?? w.sport ?? 'running'),
        source: 'manual',
        date: w.date ? new Date(w.date).toISOString() : new Date().toISOString(),
        distanceKm: distKm,
        durationSec: durSec,
        paceMinKm: type === 'cycling' ? 0 : pace,
        speedKmH: speed,
        elevGain: Number(w.elevGain ?? w.elevationGain ?? 0) || 0,
        // routeCoords = planned route (array of [lat,lng])
        // coords       = single click point [lat, lng] (flat, needs wrapping)
        coords: Array.isArray(w.routeCoords) && w.routeCoords.length > 0
            ? w.routeCoords
            : (Array.isArray(w.coords) && w.coords.length === 2 && typeof w.coords[0] === 'number'
                ? [w.coords] // wrap single point [lat,lng] → [[lat,lng]]
                : []),
        name: _cleanStr(w.name) || _cleanStr(w.description),
        description: _cleanStr(w.description),
        notes: '',
        intensity: 0,
        photoUrl: null,
    };
}
function _fromEnriched(e) {
    const type = _typeFromString(e.sport ?? 'running');
    return {
        id: String(e.id),
        type,
        sport: String(e.sport ?? 'running'),
        source: 'tracking',
        date: typeof e.date === 'number' ? new Date(e.date).toISOString() : String(e.date),
        distanceKm: Number(e.distanceKm) || 0,
        durationSec: Number(e.durationSec) || 0,
        paceMinKm: Number(e.paceMinKm) || 0,
        speedKmH: Number(e.speedKmH) || 0,
        elevGain: 0,
        coords: Array.isArray(e.coords) ? e.coords : [],
        name: _cleanStr(e.name) || _cleanStr(e.description),
        description: _cleanStr(e.description),
        notes: String(e.notes || ''),
        intensity: Number(e.intensity) || 0,
        photoUrl: e.photoUrl ?? null,
    };
}
function _fromActivity(a) {
    const type = _typeFromString(a.sport ?? 'running');
    return {
        id: String(a.id),
        type,
        sport: String(a.sport ?? 'running'),
        source: 'tracking',
        date: String(a.date),
        distanceKm: Number(a.distanceKm) || 0,
        durationSec: Number(a.durationSec) || 0,
        paceMinKm: Number(a.paceMinKm) || 0,
        speedKmH: Number(a.speedKmH) || 0,
        elevGain: 0,
        coords: Array.isArray(a.coords) ? a.coords : [],
        name: _cleanStr(a.name) || _cleanStr(a.description),
        description: _cleanStr(a.description),
        notes: '',
        intensity: 0,
        photoUrl: null,
    };
}
// ── Deleted IDs tracking ─────────────────────────────────────────────────────
const LS_DELETED = 'mapyou_deleted_workout_ids';
export function markWorkoutDeleted(id) {
    const ids = _getDeletedIds();
    ids.add(id);
    localStorage.setItem(LS_DELETED, JSON.stringify([...ids]));
}
function _getDeletedIds() {
    try {
        const raw = localStorage.getItem(LS_DELETED);
        return new Set(raw ? JSON.parse(raw) : []);
    }
    catch {
        return new Set();
    }
}
// ── Migration ─────────────────────────────────────────────────────────────────
export async function migrateToUnified() {
    // Always collect from all source tables and bulkPut (put = upsert, safe to re-run)
    const results = [];
    const seenIds = new Set();
    // 1. Manual workouts
    try {
        const manuals = await db.workouts.toArray();
        for (const w of manuals) {
            const u = _fromManual(w);
            if (!seenIds.has(u.id)) {
                seenIds.add(u.id);
                results.push(u);
            }
        }
    }
    catch { }
    // 2. EnrichedActivities (tracked with photo/notes — preferred over raw activities)
    try {
        const enriched = await db.enrichedActivities.toArray();
        for (const e of enriched) {
            const u = _fromEnriched(e);
            if (!seenIds.has(u.id)) {
                seenIds.add(u.id);
                results.push(u);
            }
        }
    }
    catch { }
    // 3. Raw activities (may overlap with enriched — skip dupes)
    try {
        const activities = await db.activities.toArray();
        for (const a of activities) {
            const u = _fromActivity(a);
            if (!seenIds.has(u.id)) {
                seenIds.add(u.id);
                results.push(u);
            }
        }
    }
    catch { }
    // Filter out deleted workouts
    const deletedIds = _getDeletedIds();
    const filtered = results.filter(r => !deletedIds.has(r.id));
    if (filtered.length > 0) {
        await db.unifiedWorkouts.bulkPut(filtered);
        console.info(`[UnifiedDB] ✅ Synced ${filtered.length} workouts to unified table`);
    }
    // Also clean up any that snuck back in
    if (deletedIds.size > 0) {
        await Promise.all([...deletedIds].map(id => db.unifiedWorkouts.delete(id).catch(() => { })));
    }
}
// ── Helpers ───────────────────────────────────────────────────────────────────
export function formatDurSec(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
        return `${h}h ${m}m`;
    if (m > 0)
        return `${m}m ${s}s`;
    return `${s}s`;
}
export function formatPaceSec(paceMinKm) {
    if (!paceMinKm || paceMinKm > 99)
        return '--:--';
    const m = Math.floor(paceMinKm);
    const s = Math.round((paceMinKm - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}
export const SPORT_ICONS_U = {
    running: '🏃', walking: '🚶', cycling: '🚴',
};
export const SPORT_COLORS_U = {
    running: '#00c46a', walking: '#5badea', cycling: '#ffb545',
};
// ─── ACHIEVEMENT ELIGIBILITY (anti-cheat) ────────────────────────────────────
// Single gate for every competitive feature: weekly goals, trophies, streaks,
// club events/challenges — and anything added later.
//
// Rationale: a manually added workout accepts ANY numbers ("800 km in 10 min"),
// so counting it toward rewards makes those rewards meaningless — this is the
// exact loophole Strava has. Imports (Strava archive, Health Connect, Apple
// Health) are treated the same way: the data may be honest, but MapYou cannot
// verify it, and an unverifiable achievement is not an achievement.
//
// Manual/imported workouts still show up everywhere else — history, stats,
// profile, feed. They just don't unlock anything.
//
// NOTE: `source` is set client-side, so this stops casual cheating, not a
// determined attacker editing IndexedDB. The tamper-proof anchor is the
// server-side live-tracking session (/live/start → /live/finish), which a
// tracked workout leaves behind — that check belongs on the backend.
const MIN_ROUTE_POINTS = 10; // musi zgadzać się z backendem (clubEvents.ts)
export function isVerifiedWorkout(w) {
    if (w.source === 'tracking')
        return true;
    // Zegarek (Health Connect / Apple Health) liczy się, ale tylko ze śladem GPS —
    // gołej liczby z Health nie da się odróżnić od wpisanej z palca. Ręczny wpis
    // miewa JEDNĄ współrzędną (pinezka na mapie), nigdy przebiegu trasy.
    if (w.source === 'health')
        return (w.coords?.length ?? 0) >= MIN_ROUTE_POINTS;
    return false;
}
/** Workouts that may count toward goals, trophies and events. */
export function verifiedOnly(list) {
    return list.filter(isVerifiedWorkout);
}
//# sourceMappingURL=UnifiedWorkout.js.map