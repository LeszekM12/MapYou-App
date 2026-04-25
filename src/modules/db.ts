// ─── DATABASE MODULE (IndexedDB via Dexie.js) ────────────────────────────────
// Dexie jest ładowane z CDN w index.html jako globalny Dexie

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Coords, WorkoutType } from '../types/index.js';
import type { ActivityRecord } from './Tracker.js';

// ── Typy ──────────────────────────────────────────────────────────────────────

export interface WorkoutRecord {
  id:           string;
  type:         WorkoutType;
  date:         string;
  coords:       Coords;
  description:  string;
  distance:     number;
  duration:     number;
  cadence:      number | null;
  pace:         number | null;
  elevGain:     number | null;
  elevationGain:number | null;
  speed:        number | null;
  routeCoords:  Coords[] | null;
}

/** Rich activity saved after finishing a tracked workout (HomeView feed) */
export interface EnrichedActivity {
  id:          string;
  sport:       string;          // 'running' | 'walking' | 'cycling'
  date:        number;          // timestamp ms
  name:        string;
  description: string;
  photoUrl:    string | null;   // data:image/… base64 string
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  intensity:   number;          // 1–5
  notes:       string;          // private notes
  coords:      Array<[number, number]>;
}

/** Unified workout — single model for manual + tracked workouts */
export interface UnifiedWorkout {
  id:          string;
  type:        'running' | 'walking' | 'cycling';
  source:      'manual' | 'tracking';
  date:        string;
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  elevGain:    number;
  coords:      Array<[number, number]>;
  name:        string;
  description: string;
  notes:       string;
  intensity:   number;
  photoUrl:    string | null;
}

/** Local user profile (stored in IndexedDB as backup, primary = localStorage) */
export interface ProfileRecord {
  userId:    string;    // primary key
  name:      string;
  bio:       string;
  avatarB64: string | null;
}

/** Post in the Home feed (text + optional photo) */
export interface PostRecord {
  id:         string;
  type:       'post';
  date:       number;
  title:      string;
  body:       string;
  photoUrl:   string | null;
  authorName: string;
  avatarB64:  string | null;
}

// ── Inicjalizacja Dexie ───────────────────────────────────────────────────────

declare const Dexie: any;

export const db = new Dexie('mapty');

// version(1) — workouty (istniejące dane)
db.version(1).stores({
  workouts: 'id, type, date, distance, duration, cadence, pace, elevGain, speed',
});

// version(2) — dodajemy activities (NIGDY nie zmieniaj version 1!)
db.version(2).stores({
  workouts:   'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities: 'id, sport, date, distanceKm, durationSec',
});

// version(3) — enrichedActivities (feed Home)
db.version(3).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
});

// version(4) — profile (local user profile)
db.version(4).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
});

// version(5) — postsFeed (Home posts)
db.version(5).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
  postsFeed:          'id, date',
});

// version(6) — unifiedWorkouts (Stats — single source of truth)
db.version(6).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
  postsFeed:          'id, date',
  unifiedWorkouts:    'id, type, source, date, distanceKm',
});

// ── Normalizacja workoutu ─────────────────────────────────────────────────────

function _generateDescription(type: string, isoDate: string): string {
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  const d = new Date(isoDate);
  return `${type.charAt(0).toUpperCase() + type.slice(1)} on ${months[d.getMonth()]} ${d.getDate()}`;
}

function normalizeWorkout(raw: Record<string, unknown>): WorkoutRecord {
  const id   = String(raw.id ?? Date.now());
  const date = raw.date ? new Date(raw.date as string).toISOString() : new Date().toISOString();
  const type = (['running', 'cycling', 'walking'] as string[]).includes(raw.type as string)
    ? raw.type as WorkoutType
    : 'running' as WorkoutType;
  const coords: Coords = Array.isArray(raw.coords) && (raw.coords as unknown[]).length === 2
    ? raw.coords as Coords
    : [0, 0];
  const description = (raw.description as string) || _generateDescription(type, date);
  const distance = Number(raw.distance) || 0;
  const duration = Number(raw.duration) || 0;

  let cadence:    number | null = null;
  let pace:       number | null = null;
  let elevGain:   number | null = null;
  let speed:      number | null = null;

  if (type === 'running' || type === 'walking') {
    cadence = Number(raw.cadence)  || null;
    pace    = Number(raw.pace)     || (duration > 0 && distance > 0 ? duration / distance : null);
  }
  if (type === 'cycling') {
    elevGain = Number((raw.elevGain as number) ?? (raw.elevationGain as number)) || 0;
    speed    = Number(raw.speed)   || (duration > 0 && distance > 0 ? distance / (duration / 60) : 0);
  }

  const routeCoords = Array.isArray(raw.routeCoords) ? raw.routeCoords as Coords[] : null;

  return {
    id, type, date, coords, description, distance, duration,
    cadence, pace, elevGain, elevationGain: elevGain, speed, routeCoords,
  };
}

// ── Migracja localStorage → IndexedDB ────────────────────────────────────────

export async function migrateLocalStorageToIndexedDB(): Promise<number> {
  const raw = localStorage.getItem('workouts');
  if (!raw) return 0;

  let parsed: unknown[];
  try { parsed = JSON.parse(raw); } catch { return 0; }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    localStorage.removeItem('workouts');
    return 0;
  }

  const existingCount = await db.workouts.count();
  if (existingCount > 0) {
    localStorage.removeItem('workouts');
    return 0;
  }

  const normalized = parsed.map(w => normalizeWorkout(w as Record<string, unknown>));
  try {
    await db.workouts.bulkAdd(normalized);
    console.info(`[DB] ✅ Zmigrowano ${normalized.length} workoutów.`);
  } catch (err) {
    console.error('[DB] ❌ Błąd migracji:', err);
    return 0;
  }

  localStorage.removeItem('workouts');
  return normalized.length;
}

// ── CRUD — workouty ───────────────────────────────────────────────────────────

export async function loadWorkoutsFromDB(): Promise<WorkoutRecord[]> {
  try {
    return await db.workouts.orderBy('date').reverse().toArray();
  } catch (err) {
    console.error('[DB] Błąd wczytywania:', err);
    return [];
  }
}

export async function saveWorkoutToDB(workout: Record<string, unknown>): Promise<string> {
  const normalized = normalizeWorkout(workout);
  await db.workouts.put(normalized);
  return normalized.id;
}

export async function deleteWorkoutFromDB(id: string): Promise<void> {
  await db.workouts.delete(String(id));
}

export async function clearAllWorkoutsFromDB(): Promise<void> {
  await db.workouts.clear();
}

// ── CRUD — activities (Tracker) ───────────────────────────────────────────────

export async function saveActivity(activity: ActivityRecord): Promise<string> {
  try {
    await db.activities.put(activity);
    console.info(`[DB] ✅ Aktywność zapisana: ${activity.id}`);
    return activity.id;
  } catch (err) {
    console.error('[DB] Błąd zapisu aktywności:', err);
    throw err;
  }
}

export async function loadActivities(): Promise<ActivityRecord[]> {
  try {
    return await db.activities.orderBy('date').reverse().toArray();
  } catch (err) {
    console.error('[DB] Błąd wczytywania aktywności:', err);
    return [];
  }
}

export async function loadActivityById(id: string): Promise<ActivityRecord | undefined> {
  try {
    return await db.activities.get(id);
  } catch (err) {
    console.error('[DB] Błąd wczytywania aktywności:', err);
    return undefined;
  }
}

export async function deleteActivity(id: string): Promise<void> {
  await db.activities.delete(id);
}

// ── CRUD — enrichedActivities (HomeView feed) ─────────────────────────────────

export async function saveEnrichedActivity(activity: EnrichedActivity): Promise<string> {
  try {
    await db.enrichedActivities.put(activity);
    console.info(`[DB] ✅ EnrichedActivity saved: ${activity.id}`);
    return activity.id;
  } catch (err) {
    console.error('[DB] Błąd zapisu enrichedActivity:', err);
    throw err;
  }
}

export async function loadEnrichedActivities(): Promise<EnrichedActivity[]> {
  try {
    return await db.enrichedActivities.orderBy('date').reverse().toArray();
  } catch (err) {
    console.error('[DB] Błąd wczytywania enrichedActivities:', err);
    return [];
  }
}

export async function deleteEnrichedActivity(id: string): Promise<void> {
  await db.enrichedActivities.delete(id);
}
// ── CRUD — profile ────────────────────────────────────────────────────────────

export async function saveProfileToDB(profile: ProfileRecord): Promise<void> {
  try {
    await db.profile.put(profile);
  } catch (err) {
    console.warn('[DB] Profile save error:', err);
  }
}

export async function loadProfileFromDB(): Promise<ProfileRecord | null> {
  try {
    const all = await db.profile.toArray();
    return all[0] ?? null;
  } catch {
    return null;
  }
}

// ── CRUD — postsFeed ──────────────────────────────────────────────────────────

export async function savePost(post: PostRecord): Promise<void> {
  try {
    await db.postsFeed.put(post);
  } catch (err) {
    console.error('[DB] savePost error:', err);
    throw err;
  }
}

export async function loadPosts(): Promise<PostRecord[]> {
  try {
    return await db.postsFeed.orderBy('date').reverse().toArray();
  } catch {
    return [];
  }
}

export async function deletePost(id: string): Promise<void> {
  await db.postsFeed.delete(id);
}

// ── CRUD — unifiedWorkouts ────────────────────────────────────────────────────

export async function saveUnifiedWorkout(workout: UnifiedWorkout): Promise<void> {
  try {
    await db.unifiedWorkouts.put(workout);
  } catch (err) {
    console.error('[DB] saveUnifiedWorkout error:', err);
    throw err;
  }
}

export async function loadUnifiedWorkouts(): Promise<UnifiedWorkout[]> {
  try {
    return await db.unifiedWorkouts.orderBy('date').reverse().toArray();
  } catch (err) {
    console.error('[DB] loadUnifiedWorkouts error:', err);
    return [];
  }
}

export async function deleteUnifiedWorkout(id: string): Promise<void> {
  await db.unifiedWorkouts.delete(id);
}
