'use strict';

/* ============================================================
   MAPTY — DATABASE MODULE (IndexedDB via Dexie.js)
   
   Zastępuje localStorage dla danych workoutów.
   Pozostałe dane (ustawienia, flagi UI) nadal w localStorage.
   
   Użycie w script.js:
     await loadWorkoutsFromDB()      → tablica workoutów
     await saveWorkoutToDB(workout)  → zapisuje/nadpisuje jeden workout
     await deleteWorkoutFromDB(id)   → usuwa jeden workout
     await clearAllWorkoutsFromDB()  → czyści całą tabelę
     migrateLocalStorageToIndexedDB()→ wywoływana raz przy starcie
   ============================================================ */


/* ============================================================
   1. INICJALIZACJA DEXIE
   ============================================================ */

// Importujemy Dexie z CDN (w index.html musi być:
//   <script src="https://unpkg.com/dexie@3/dist/dexie.min.js"></script>
//   przed script.js i db.js)

const db = new Dexie('mapty');

// Wersja 1 schematu bazy danych.
// Kolumny wymienione w stores() są indeksowane (szybkie wyszukiwanie).
// Pozostałe pola (nieindeksowane) są przechowywane automatycznie
// dzięki temu że Dexie przechowuje cały obiekt JS.
db.version(1).stores({
  workouts: [
    'id',           // PRIMARY KEY — unikalny string timestamp
    'type',         // 'running' | 'cycling' | 'walking'  (indeks)
    'date',         // ISO string daty  (indeks — do sortowania)
    'distance',
    'duration',
    'cadence',
    'pace',
    'elevGain',
    'speed',
    // coords, description, routeCoords — przechowywane ale nieindeksowane
  ].join(', '),
});


/* ============================================================
   2. NORMALIZACJA WORKOUTU
   
   Zapewnia że każdy obiekt zapisany do DB ma kompletne pola,
   niezależnie od tego skąd pochodzi (localStorage, nowy formularz).
   ============================================================ */

/**
 * Normalizuje dowolny obiekt workout do kanonicznej postaci.
 * Uzupełnia brakujące pola wartościami domyślnymi.
 * @param {Object} raw - surowy obiekt workout
 * @returns {Object} znormalizowany workout gotowy do zapisu w DB
 */
function normalizeWorkout(raw) {
  // Wymagane: id musi być stringiem
  const id = String(raw.id ?? Date.now());

  // Data: akceptujemy zarówno string ISO jak i obiekt Date
  const date = raw.date
    ? new Date(raw.date).toISOString()
    : new Date().toISOString();

  // Typ: tylko dozwolone wartości, fallback → 'running'
  const type = ['running', 'cycling', 'walking'].includes(raw.type)
    ? raw.type
    : 'running';

  // Współrzędne: tablica [lat, lng]
  const coords = Array.isArray(raw.coords) && raw.coords.length === 2
    ? raw.coords
    : [0, 0];

  // Opis: generujemy jeśli brak
  const description = raw.description || _generateDescription(type, date);

  // Wspólne pola numeryczne
  const distance = Number(raw.distance) || 0;
  const duration = Number(raw.duration) || 0;

  // Pola specyficzne dla typu
  let cadence   = null;
  let pace      = null;
  let elevGain  = null;
  let speed     = null;

  if (type === 'running' || type === 'walking') {
    cadence  = Number(raw.cadence)  || null;
    pace     = Number(raw.pace)     || (duration > 0 && distance > 0 ? duration / distance : null);
  }

  if (type === 'cycling') {
    elevGain = Number(raw.elevGain ?? raw.elevationGain) || 0;
    speed    = Number(raw.speed)    || (duration > 0 && distance > 0 ? distance / (duration / 60) : 0);
  }

  // Opcjonalne: zapisana trasa A→B
  const routeCoords = Array.isArray(raw.routeCoords) ? raw.routeCoords : null;

  return {
    id,
    type,
    date,
    coords,
    description,
    distance,
    duration,
    cadence,
    pace,
    elevGain,
    elevationGain: elevGain,  // alias dla klasy Cycling i _renderWorkout
    speed,
    routeCoords,
  };
}

/**
 * Pomocnicza — generuje opis w stylu "Running on April 6"
 */
function _generateDescription(type, isoDate) {
  const months = [
    'January','February','March','April','May','June',
    'July','August','September','October','November','December',
  ];
  const d = new Date(isoDate);
  const label = type.charAt(0).toUpperCase() + type.slice(1);
  return `${label} on ${months[d.getMonth()]} ${d.getDate()}`;
}


/* ============================================================
   3. MIGRACJA z localStorage → IndexedDB
   
   Wywoływana JEDEN RAZ przy starcie.
   Po udanej migracji usuwa dane z localStorage,
   żeby przy kolejnym uruchomieniu nie migrować ponownie.
   ============================================================ */

/**
 * Migruje workouty z localStorage do IndexedDB (Dexie).
 * Bezpieczna: jeśli w DB już są dane lub localStorage jest pusty — nie robi nic.
 * @returns {Promise<number>} liczba zmigrowanych workoutów
 */
async function migrateLocalStorageToIndexedDB() {
  // 1. Sprawdź czy localStorage w ogóle ma workouty
  const raw = localStorage.getItem('workouts');
  if (!raw) {
    console.info('[DB] Brak danych w localStorage — migracja pominięta.');
    return 0;
  }

  // 2. Parsuj dane
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error('[DB] Błąd parsowania localStorage.workouts:', err);
    return 0;
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.info('[DB] localStorage.workouts jest puste — migracja pominięta.');
    localStorage.removeItem('workouts'); // posprzątaj puste dane
    return 0;
  }

  // 3. Sprawdź czy IndexedDB już ma dane (zabezpieczenie przed podwójną migracją)
  const existingCount = await db.workouts.count();
  if (existingCount > 0) {
    console.info(`[DB] IndexedDB już zawiera ${existingCount} workoutów — migracja pominięta.`);
    // Usuń localStorage żeby już nie próbować
    localStorage.removeItem('workouts');
    return 0;
  }

  // 4. Normalizuj każdy workout
  const normalized = parsed.map(normalizeWorkout);

  // 5. Zapisz wszystkie na raz (bulkAdd jest atomowe — albo wszystkie albo żadne)
  try {
    await db.workouts.bulkAdd(normalized);
    console.info(`[DB] ✅ Zmigrowano ${normalized.length} workoutów z localStorage do IndexedDB.`);
  } catch (err) {
    console.error('[DB] ❌ Błąd podczas bulkAdd:', err);
    // NIE usuwamy localStorage — dane są bezpieczne
    return 0;
  }

  // 6. Po sukcesie usuń dane z localStorage
  localStorage.removeItem('workouts');
  console.info('[DB] localStorage.workouts usunięte po udanej migracji.');

  return normalized.length;
}


/* ============================================================
   4. CRUD — funkcje dostępu do danych
   ============================================================ */

/**
 * Wczytuje wszystkie workouty z IndexedDB, posortowane od najnowszego.
 * @returns {Promise<Object[]>} tablica workoutów
 */
async function loadWorkoutsFromDB() {
  try {
    // Sortowanie po date malejąco (najnowsze pierwsze)
    const workouts = await db.workouts.orderBy('date').reverse().toArray();
    console.info(`[DB] Wczytano ${workouts.length} workoutów z IndexedDB.`);
    return workouts;
  } catch (err) {
    console.error('[DB] Błąd wczytywania workoutów:', err);
    return [];
  }
}

/**
 * Zapisuje lub aktualizuje jeden workout w IndexedDB.
 * Używa put() — nadpisuje jeśli id już istnieje, dodaje jeśli nie.
 * @param {Object} workout - obiekt workout (zostanie znormalizowany)
 * @returns {Promise<string>} id zapisanego workoutu
 */
async function saveWorkoutToDB(workout) {
  try {
    const normalized = normalizeWorkout(workout);
    await db.workouts.put(normalized);
    console.info(`[DB] Zapisano workout: ${normalized.id} (${normalized.type})`);
    return normalized.id;
  } catch (err) {
    console.error('[DB] Błąd zapisu workoutu:', err);
    throw err;
  }
}

/**
 * Usuwa jeden workout z IndexedDB po id.
 * @param {string} id - id workoutu
 * @returns {Promise<void>}
 */
async function deleteWorkoutFromDB(id) {
  try {
    await db.workouts.delete(String(id));
    console.info(`[DB] Usunięto workout: ${id}`);
  } catch (err) {
    console.error('[DB] Błąd usuwania workoutu:', err);
    throw err;
  }
}

/**
 * Usuwa WSZYSTKIE workouty z IndexedDB.
 * Odpowiednik "Clear all workouts" w ustawieniach.
 * @returns {Promise<void>}
 */
async function clearAllWorkoutsFromDB() {
  try {
    await db.workouts.clear();
    console.info('[DB] Wyczyszczono wszystkie workouty z IndexedDB.');
  } catch (err) {
    console.error('[DB] Błąd czyszczenia bazy:', err);
    throw err;
  }
}

/**
 * Wczytuje workouty z danego tygodnia (pomocnicze dla statystyk).
 * @param {Date} monday - poniedziałek tygodnia (początek)
 * @param {Date} sunday - niedziela tygodnia (koniec)
 * @returns {Promise<Object[]>}
 */
async function loadWorkoutsForWeek(monday, sunday) {
  try {
    const from = monday.toISOString();
    const to   = sunday.toISOString();
    // Dexie obsługuje zapytania zakresowe na indeksowanym polu 'date'
    const workouts = await db.workouts
      .where('date')
      .between(from, to, true, true) // true = włącznie z granicami
      .toArray();
    return workouts;
  } catch (err) {
    console.error('[DB] Błąd wczytywania workoutów tygodnia:', err);
    return [];
  }
}
