// ─── DATABASE MODULE (IndexedDB via Dexie.js) ────────────────────────────────
// Dexie jest ładowane z CDN w index.html jako globalny Dexie
const db = new Dexie('mapty');
// version(1) — workouty (istniejące dane)
db.version(1).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
});
// version(2) — dodajemy activities (NIGDY nie zmieniaj version 1!)
db.version(2).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
});
// version(3) — enrichedActivities (feed Home)
db.version(3).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
    enrichedActivities: 'id, sport, date, name',
});
// version(4) — profile (local user profile)
db.version(4).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
    enrichedActivities: 'id, sport, date, name',
    profile: 'userId',
});
// ── Normalizacja workoutu ─────────────────────────────────────────────────────
function _generateDescription(type, isoDate) {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December',
    ];
    const d = new Date(isoDate);
    return `${type.charAt(0).toUpperCase() + type.slice(1)} on ${months[d.getMonth()]} ${d.getDate()}`;
}
function normalizeWorkout(raw) {
    const id = String(raw.id ?? Date.now());
    const date = raw.date ? new Date(raw.date).toISOString() : new Date().toISOString();
    const type = ['running', 'cycling', 'walking'].includes(raw.type)
        ? raw.type
        : 'running';
    const coords = Array.isArray(raw.coords) && raw.coords.length === 2
        ? raw.coords
        : [0, 0];
    const description = raw.description || _generateDescription(type, date);
    const distance = Number(raw.distance) || 0;
    const duration = Number(raw.duration) || 0;
    let cadence = null;
    let pace = null;
    let elevGain = null;
    let speed = null;
    if (type === 'running' || type === 'walking') {
        cadence = Number(raw.cadence) || null;
        pace = Number(raw.pace) || (duration > 0 && distance > 0 ? duration / distance : null);
    }
    if (type === 'cycling') {
        elevGain = Number(raw.elevGain ?? raw.elevationGain) || 0;
        speed = Number(raw.speed) || (duration > 0 && distance > 0 ? distance / (duration / 60) : 0);
    }
    const routeCoords = Array.isArray(raw.routeCoords) ? raw.routeCoords : null;
    return {
        id, type, date, coords, description, distance, duration,
        cadence, pace, elevGain, elevationGain: elevGain, speed, routeCoords,
    };
}
// ── Migracja localStorage → IndexedDB ────────────────────────────────────────
export async function migrateLocalStorageToIndexedDB() {
    const raw = localStorage.getItem('workouts');
    if (!raw)
        return 0;
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        return 0;
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
        localStorage.removeItem('workouts');
        return 0;
    }
    const existingCount = await db.workouts.count();
    if (existingCount > 0) {
        localStorage.removeItem('workouts');
        return 0;
    }
    const normalized = parsed.map(w => normalizeWorkout(w));
    try {
        await db.workouts.bulkAdd(normalized);
        console.info(`[DB] ✅ Zmigrowano ${normalized.length} workoutów.`);
    }
    catch (err) {
        console.error('[DB] ❌ Błąd migracji:', err);
        return 0;
    }
    localStorage.removeItem('workouts');
    return normalized.length;
}
// ── CRUD — workouty ───────────────────────────────────────────────────────────
export async function loadWorkoutsFromDB() {
    try {
        return await db.workouts.orderBy('date').reverse().toArray();
    }
    catch (err) {
        console.error('[DB] Błąd wczytywania:', err);
        return [];
    }
}
export async function saveWorkoutToDB(workout) {
    const normalized = normalizeWorkout(workout);
    await db.workouts.put(normalized);
    return normalized.id;
}
export async function deleteWorkoutFromDB(id) {
    await db.workouts.delete(String(id));
}
export async function clearAllWorkoutsFromDB() {
    await db.workouts.clear();
}
// ── CRUD — activities (Tracker) ───────────────────────────────────────────────
export async function saveActivity(activity) {
    try {
        await db.activities.put(activity);
        console.info(`[DB] ✅ Aktywność zapisana: ${activity.id}`);
        return activity.id;
    }
    catch (err) {
        console.error('[DB] Błąd zapisu aktywności:', err);
        throw err;
    }
}
export async function loadActivities() {
    try {
        return await db.activities.orderBy('date').reverse().toArray();
    }
    catch (err) {
        console.error('[DB] Błąd wczytywania aktywności:', err);
        return [];
    }
}
export async function loadActivityById(id) {
    try {
        return await db.activities.get(id);
    }
    catch (err) {
        console.error('[DB] Błąd wczytywania aktywności:', err);
        return undefined;
    }
}
export async function deleteActivity(id) {
    await db.activities.delete(id);
}
// ── CRUD — enrichedActivities (HomeView feed) ─────────────────────────────────
export async function saveEnrichedActivity(activity) {
    try {
        await db.enrichedActivities.put(activity);
        console.info(`[DB] ✅ EnrichedActivity saved: ${activity.id}`);
        return activity.id;
    }
    catch (err) {
        console.error('[DB] Błąd zapisu enrichedActivity:', err);
        throw err;
    }
}
export async function loadEnrichedActivities() {
    try {
        return await db.enrichedActivities.orderBy('date').reverse().toArray();
    }
    catch (err) {
        console.error('[DB] Błąd wczytywania enrichedActivities:', err);
        return [];
    }
}
export async function deleteEnrichedActivity(id) {
    await db.enrichedActivities.delete(id);
}
// ── CRUD — profile ────────────────────────────────────────────────────────────
export async function saveProfileToDB(profile) {
    try {
        await db.profile.put(profile);
    }
    catch (err) {
        console.warn('[DB] Profile save error:', err);
    }
}
export async function loadProfileFromDB() {
    try {
        const all = await db.profile.toArray();
        return all[0] ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=db.js.map