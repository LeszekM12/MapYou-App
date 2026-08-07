// ─── DATABASE MODULE (IndexedDB via Dexie.js) ────────────────────────────────
// Dexie jest ładowane z CDN w index.html jako globalny Dexie

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Coords, WorkoutType } from '../types/index.js';
import type { ActivityRecord } from './Tracker.js';
import { dlog } from '../utils/log.js';

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
  photoUrl:    string | null;   // data:image/… or Cloudinary URL
  clubIds?:    string[];        // clubs this activity is shared to
  mediaType?:  'image' | 'video' | null; // type of media attached
  coordsEnc?:  string | null;   // Encoded Polyline (compressed, for Atlas backup)
  minimapUrl?: string | null;   // Static map image URL
  photoPublicId?: string | null; // Cloudinary public_id (for deletion)
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  intensity:   number;          // 1–5
  notes:       string;          // private notes
  visibility?: 'everyone' | 'friends' | 'only_me'; // who can see this activity
  muted?:      boolean;         // if true: not published to main/club feeds (still in stats & history)
  coords:      Array<[number, number]>;
  laps?:       Array<{ km: number; durationSec: number; paceMinKm: number }>; // per-km splits (tracked)
  // Health metrics (watch/Health import or future sensors)
  avgHr?:      number | null;
  maxHr?:      number | null;
  hrSeries?:   Array<[number, number]> | null; // [secOffset, bpm] downsampled
  calories?:   number | null;
  elevGain?:   number | null;                  // metres climbed
  elevSeries?: Array<[number, number]> | null; // [distanceM, elevM] downsampled
  // Weather at the time & place of the workout — fetched once from Open-Meteo
  // archive on first open, then cached here so we don't refetch.
  wxTemp?:     number | null;   // °C
  wxCode?:     number | null;   // WMO weather code
  wxWind?:     number | null;   // km/h
  wxHumidity?: number | null;   // %
  wxFetched?:  boolean;         // true once we've tried (even if it failed)
  source?:     'in_app' | 'manual' | 'apple_health' | 'health_connect' | null;
  sourceId?:   string | null;                  // health-store UUID (dedup)
  sourceName?: string | null;                  // recording device/app, e.g. "Garmin Forerunner 255"
}

/** Unified workout — single model for manual + tracked workouts */
export interface UnifiedWorkout {
  id:          string;
  type:        'running' | 'walking' | 'cycling';
  sport?:      string;        // original sport (gym, tennis...) — type is a 3-value fallback
  source:      'manual' | 'tracking' | 'health';   // health = zegarek/Health import
  date:        string;
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  elevGain:    number;
  coords:      Array<[number, number]>;
  /** Liczba punktow trasy. Router wycina tablice `coords` przy zapisie
   *  (oszczednosc ~100KB/trening), wiec to jedyny nosnik informacji
   *  „czy byl realny slad GPS" — uzywany przez bramke anty-cheatowa wyzwan. */
  coordsCount?: number;
  name:        string;
  description: string;
  notes:       string;
  intensity:   number;
  photoUrl:    string | null;
  photoPublicId?: string | null;
}

/** Local user profile (stored in IndexedDB as backup, primary = localStorage) */
export interface ProfileRecord {
  userId:    string;    // primary key
  name:      string;
  bio:       string;
  avatarB64: string | null;
  city:      string;
  region:    string;
  birthDate: string | null;
  gender:    'male' | 'female' | 'other' | null;
  weightKg:  number | null;
}

/** Reel — ephemeral 24h story */
export interface ReelRecord {
  id:           string;
  userId:       string;
  authorName:   string;
  avatarB64:    string | null;
  mediaUrl:     string;
  mediaType:    'image' | 'video';
  publicId:     string;
  caption:      string | null;
  activityId:   string | null;   // deep-link target: tap reel → activity details
  audience:     string;          // everyone | friends
  captionX:     number;
  captionY:     number;
  captionSize:  number;
  captionColor: string;
  captionFont:  string | null;
  captionWeight:string | null;
  captionStyle: string | null;   // none | highlight | neon
  duration:     number;
  views:        string[];
  likes:        string[];
  createdAt:    number;  // timestamp ms
  expiresAt:    number;  // timestamp ms
}

/** Post in the Home feed (text + optional photo) */
export interface PostRecord {
  id:         string;
  type:       'post';
  date:       number;
  title:      string;
  body:       string;
  photoUrl:   string | null;
  photoPublicId?: string | null;
  mediaType?:  'image' | 'video' | null;
  clubIds?:    string[];
  addToHome?:  boolean;
  clubOnly?:   boolean;
  authorName: string;
  avatarB64:  string | null;
  /** Kto zobaczy post. Pole istnialo w modelu `Post` na backendzie i bylo
   *  obslugiwane przez `PATCH /posts/:postId/visibility`, ale zaden ekran go
   *  nie ustawial przy tworzeniu — kazdy post szedl jako `everyone`. */
  visibility?: 'everyone' | 'friends' | 'only_me';
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

// version(7) — reels (ephemeral 24h stories)
db.version(7).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
  postsFeed:          'id, date',
  unifiedWorkouts:    'id, type, source, date, distanceKm',
  reels:              'id, userId, expiresAt',
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
// version(10) — cache kafelkow mapy.
//
// Kafelki to gotowe obrazki PNG sciagane z CARTO/OSM. Bez cache mapa offline
// pokazuje tylko to, co przypadkiem zostalo w cache przegladarki — czyli
// dokladnie ten fragment i to jedno powiekszenie, ktore akurat ogladales.
//
// Klucz to `styl/z/x/y`. `lastUsed` sluzy do kasowania najstarszych, gdy
// cache przekroczy limit — inaczej urosloby to do setek megabajtow
// (sam zoom 17 dla promienia 10 km to ~250 MB).
// version(11) — kolejka zdjec i filmow offline.
//
// Zdjecia NIE moga isc przez `outbox`, bo tamten trzyma cialo zadania jako
// tekst, a pliku sie tak nie zapisze. Do tego wysylka mediow idzie przez
// `XMLHttpRequest` (potrzebny pasek postepu), wiec przechwytywacz `fetch`
// w authFetch w ogole jej nie widzi.
//
// Dlatego osobna tabela: trzyma sam plik jako Blob plus dane potrzebne
// do ponowienia wysylki.
// Wersje MUSZA byc deklarowane rosnaco. Wczesniej bylo 11, 10, 9, 8 —
// Dexie sam je sortuje, wiec dzialalo, ale przy dopisywaniu wersji 12
// latwo bylo wstawic ja w zle miejsce i po cichu zgubic migracje.
db.version(8).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
  postsFeed:          'id, date',
  unifiedWorkouts:    'id, type, source, date, distanceKm',
  reels:              'id, userId, expiresAt',
  activeSession:      'id',
  sessionCoords:      '++seq',
});
db.version(9).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
  postsFeed:          'id, date',
  unifiedWorkouts:    'id, type, source, date, distanceKm',
  reels:              'id, userId, expiresAt',
  activeSession:      'id',
  sessionCoords:      '++seq',
  outbox:             '++id, createdAt',
});
db.version(10).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
  postsFeed:          'id, date',
  unifiedWorkouts:    'id, type, source, date, distanceKm',
  reels:              'id, userId, expiresAt',
  activeSession:      'id',
  sessionCoords:      '++seq',
  outbox:             '++id, createdAt',
  tiles:              'key, lastUsed',
});
db.version(11).stores({
  workouts:           'id, type, date, distance, duration, cadence, pace, elevGain, speed',
  activities:         'id, sport, date, distanceKm, durationSec',
  enrichedActivities: 'id, sport, date, name',
  profile:            'userId',
  postsFeed:          'id, date',
  unifiedWorkouts:    'id, type, source, date, distanceKm',
  reels:              'id, userId, expiresAt',
  activeSession:      'id',
  sessionCoords:      '++seq',
  outbox:             '++id, createdAt',
  tiles:              'key, lastUsed',
  mediaQueue:         '++id, createdAt',
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
    dlog(`[DB] ✅ Zmigrowano ${normalized.length} workoutów.`);
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
    dlog(`[DB] ✅ Aktywność zapisana: ${activity.id}`);
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
    dlog(`[DB] ✅ EnrichedActivity saved: ${activity.id}`);
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

export async function updateEnrichedActivityFields(id: string, changes: Partial<EnrichedActivity>): Promise<void> {
  try { await db.enrichedActivities.update(id, changes as Record<string, unknown>); }
  catch (err) { console.warn('[DB] update enriched error:', err); }
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

// ── CRUD — reels ─────────────────────────────────────────────────────────────

export async function saveReel(reel: ReelRecord): Promise<void> {
  try { await db.reels.put(reel); } catch (err) { console.error('[DB] saveReel error:', err); throw err; }
}

export async function loadReels(): Promise<ReelRecord[]> {
  try {
    const all = await db.reels.toArray();
    const now = Date.now();
    return all.filter((r: ReelRecord) => r.expiresAt > now);
  } catch { return []; }
}

export async function loadReelsByUser(userId: string): Promise<ReelRecord[]> {
  try {
    const now = Date.now();
    return await db.reels.where('userId').equals(userId).filter((r: ReelRecord) => r.expiresAt > now).toArray();
  } catch { return []; }
}

export async function deleteReel(id: string): Promise<void> {
  await db.reels.delete(id);
}

export async function cleanupExpiredReelsLocal(): Promise<void> {
  try {
    const now = Date.now();
    const all = await db.reels.toArray();
    const expired = all.filter((r: ReelRecord) => r.expiresAt <= now);
    for (const r of expired) await db.reels.delete(r.id);
  } catch { /* ignoruj */ }
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

// ── Czyszczenie danych konta (wylogowanie) ───────────────────────────────────

/** Klucze localStorage, ktore NALEZA DO URZADZENIA, nie do konta — zostaja
 *  po wylogowaniu, bo to preferencje, a nie cudze dane. */
const KEEP_ON_LOGOUT = new Set([
  'mapyou_dev',            // tryb deweloperski
  'mapyou_voice_cues',     // komunikaty glosowe
  'mapyou_search_city',    // ostatnio szukane miasto
  'mapyou_custom_sports',  // wlasne dyscypliny
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
export async function clearAccountDataLocally(): Promise<void> {
  // 1) Wszystkie tabele glownej bazy
  try {
    // Dexie jest globalem z CDN — minimalny typ lokalny zamiast namespace.
    const tables = db.tables as unknown as Array<{ name: string; clear(): Promise<void> }>;
    await Promise.all(tables.map(t => t.clear()));
    dlog('[DB] wyczyszczono tabele:', tables.map(t => t.name).join(', '));
  } catch (err) {
    console.warn('[DB] blad czyszczenia bazy:', err);
  }

  // 2) Klucze localStorage nalezace do konta.
  //    Podejscie odwrotne (usun wszystko z prefiksem OPROCZ allowlisty) jest
  //    bezpieczniejsze niz lista do usuniecia — nowy klucz konta dodany
  //    w przyszlosci zostanie wyczyszczony automatycznie.
  try {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      const isAccountKey = key.startsWith('mapyou_') || key.startsWith('mapty_');
      if (isAccountKey && !KEEP_ON_LOGOUT.has(key)) toRemove.push(key);
    }
    toRemove.forEach(k => localStorage.removeItem(k));
    dlog(`[DB] wyczyszczono ${toRemove.length} kluczy konta`);
  } catch (err) {
    console.warn('[DB] blad czyszczenia localStorage:', err);
  }
}
