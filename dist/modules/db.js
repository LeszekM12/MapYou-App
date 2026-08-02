// ─── DATABASE MODULE (IndexedDB via Dexie.js) ────────────────────────────────
// Dexie jest ładowane z CDN w index.html jako globalny Dexie
import { dlog } from '../utils/log.js';
export const db = new Dexie('mapty');
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
// version(5) — postsFeed (Home posts)
db.version(5).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
    enrichedActivities: 'id, sport, date, name',
    profile: 'userId',
    postsFeed: 'id, date',
});
// version(6) — unifiedWorkouts (Stats — single source of truth)
db.version(6).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
    enrichedActivities: 'id, sport, date, name',
    profile: 'userId',
    postsFeed: 'id, date',
    unifiedWorkouts: 'id, type, source, date, distanceKm',
});
// version(7) — reels (ephemeral 24h stories)
db.version(7).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
    enrichedActivities: 'id, sport, date, name',
    profile: 'userId',
    postsFeed: 'id, date',
    unifiedWorkouts: 'id, type, source, date, distanceKm',
    reels: 'id, userId, expiresAt',
});
// version(8) — ETAP 1: trening przezywa ubicie procesu.
//
// Do tej pory caly stan aktywnego treningu (trasa, dystans, czas, okrazenia)
// zyl WYLACZNIE w polach obiektu `Tracker`. Gdy Android ubil WebView — bo
// uzytkownik zmiotl apke z paska albo system potrzebowal pamieci — obiekt
// znikal razem z trasa. Natywna wtyczka GPS dzialala dalej (stad zywe
// powiadomienie na ekranie blokady), ale nie miala dokad wysylac pozycji.
// Powrot do apki dawal pusty ekran Track i utrate calego biegu.
//
//   activeSession — JEDEN rekord (id='current') ze stanem sesji.
//   sessionCoords — punkty trasy dopisywane PRZYROSTOWO.
//
// Punkty sa osobna tabela celowo. Przepisywanie calej tablicy przy kazdym
// fixie oznaczaloby przy godzinnym biegu tysiace zapisow rosnacej tablicy —
// przy 3 godzinach to setki megabajtow zapisu i zajechany dysk telefonu.
// Dopisanie jednego rekordu jest stalym kosztem niezaleznie od dlugosci trasy.
// version(9) — ETAP 2: kolejka zapisow offline ("outbox").
//
// Zapis, ktory nie doszedl do serwera, ladunku w tej tabeli i czeka na siec.
// Nie ginie po ubiciu apki ani po restarcie telefonu. Kazdy rekord niesie
// wlasny `idemKey`, dzieki ktoremu ponowienie NIE tworzy duplikatu
// (patrz middleware/idempotency.ts po stronie backendu).
db.version(9).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
    enrichedActivities: 'id, sport, date, name',
    profile: 'userId',
    postsFeed: 'id, date',
    unifiedWorkouts: 'id, type, source, date, distanceKm',
    reels: 'id, userId, expiresAt',
    activeSession: 'id',
    sessionCoords: '++seq',
    outbox: '++id, createdAt',
});
db.version(8).stores({
    workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
    activities: 'id, sport, date, distanceKm, durationSec',
    enrichedActivities: 'id, sport, date, name',
    profile: 'userId',
    postsFeed: 'id, date',
    unifiedWorkouts: 'id, type, source, date, distanceKm',
    reels: 'id, userId, expiresAt',
    activeSession: 'id',
    sessionCoords: '++seq',
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
        dlog(`[DB] ✅ Zmigrowano ${normalized.length} workoutów.`);
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
        dlog(`[DB] ✅ Aktywność zapisana: ${activity.id}`);
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
        dlog(`[DB] ✅ EnrichedActivity saved: ${activity.id}`);
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
export async function updateEnrichedActivityFields(id, changes) {
    try {
        await db.enrichedActivities.update(id, changes);
    }
    catch (err) {
        console.warn('[DB] update enriched error:', err);
    }
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
// ── CRUD — postsFeed ──────────────────────────────────────────────────────────
export async function savePost(post) {
    try {
        await db.postsFeed.put(post);
    }
    catch (err) {
        console.error('[DB] savePost error:', err);
        throw err;
    }
}
export async function loadPosts() {
    try {
        return await db.postsFeed.orderBy('date').reverse().toArray();
    }
    catch {
        return [];
    }
}
export async function deletePost(id) {
    await db.postsFeed.delete(id);
}
// ── CRUD — reels ─────────────────────────────────────────────────────────────
export async function saveReel(reel) {
    try {
        await db.reels.put(reel);
    }
    catch (err) {
        console.error('[DB] saveReel error:', err);
        throw err;
    }
}
export async function loadReels() {
    try {
        const all = await db.reels.toArray();
        const now = Date.now();
        return all.filter((r) => r.expiresAt > now);
    }
    catch {
        return [];
    }
}
export async function loadReelsByUser(userId) {
    try {
        const now = Date.now();
        return await db.reels.where('userId').equals(userId).filter((r) => r.expiresAt > now).toArray();
    }
    catch {
        return [];
    }
}
export async function deleteReel(id) {
    await db.reels.delete(id);
}
export async function cleanupExpiredReelsLocal() {
    try {
        const now = Date.now();
        const all = await db.reels.toArray();
        const expired = all.filter((r) => r.expiresAt <= now);
        for (const r of expired)
            await db.reels.delete(r.id);
    }
    catch { /* ignoruj */ }
}
// ── CRUD — unifiedWorkouts ────────────────────────────────────────────────────
export async function saveUnifiedWorkout(workout) {
    try {
        await db.unifiedWorkouts.put(workout);
    }
    catch (err) {
        console.error('[DB] saveUnifiedWorkout error:', err);
        throw err;
    }
}
export async function loadUnifiedWorkouts() {
    try {
        return await db.unifiedWorkouts.orderBy('date').reverse().toArray();
    }
    catch (err) {
        console.error('[DB] loadUnifiedWorkouts error:', err);
        return [];
    }
}
export async function deleteUnifiedWorkout(id) {
    await db.unifiedWorkouts.delete(id);
}
// ── Czyszczenie danych konta (wylogowanie) ───────────────────────────────────
/** Klucze localStorage, ktore NALEZA DO URZADZENIA, nie do konta — zostaja
 *  po wylogowaniu, bo to preferencje, a nie cudze dane. */
const KEEP_ON_LOGOUT = new Set([
    'mapyou_dev', // tryb deweloperski
    'mapyou_voice_cues', // komunikaty glosowe
    'mapyou_search_city', // ostatnio szukane miasto
    'mapyou_custom_sports', // wlasne dyscypliny
]);
/**
 * Usun z urzadzenia WSZYSTKIE dane zwiazane z kontem.
 *
 * Wolane przy wylogowaniu. Bez tego treningi, profil i znajomi poprzedniego
 * uzytkownika zostawali w Dexie — a gdy na tym samym telefonie zalogowal sie
 * ktos inny, jego widoki mieszaly sie z cudzymi danymi.
 *
 * Dane NIE gina: wszystko jest w Atlasie i wraca przy ponownym zalogowaniu
 * (hydratacja), dokladnie tak jak przy przenoszeniu konta na nowy telefon.
 *
 * Ustawienia urzadzenia (motyw, styl mapy, filtry) zostaja nietkniete.
 */
export async function clearAccountDataLocally() {
    // 1) Wszystkie tabele glownej bazy
    try {
        // Dexie jest globalem z CDN — minimalny typ lokalny zamiast namespace.
        const tables = db.tables;
        await Promise.all(tables.map(t => t.clear()));
        dlog('[DB] wyczyszczono tabele:', tables.map(t => t.name).join(', '));
    }
    catch (err) {
        console.warn('[DB] blad czyszczenia bazy:', err);
    }
    // 2) Klucze localStorage nalezace do konta.
    //    Podejscie odwrotne (usun wszystko z prefiksem OPROCZ allowlisty) jest
    //    bezpieczniejsze niz lista do usuniecia — nowy klucz konta dodany
    //    w przyszlosci zostanie wyczyszczony automatycznie.
    try {
        const toRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key)
                continue;
            const isAccountKey = key.startsWith('mapyou_') || key.startsWith('mapty_');
            if (isAccountKey && !KEEP_ON_LOGOUT.has(key))
                toRemove.push(key);
        }
        toRemove.forEach(k => localStorage.removeItem(k));
        dlog(`[DB] wyczyszczono ${toRemove.length} kluczy konta`);
    }
    catch (err) {
        console.warn('[DB] blad czyszczenia localStorage:', err);
    }
}
//# sourceMappingURL=db.js.map