// ─── TRACKER MODULE ──────────────────────────────────────────────────────────
// src/modules/Tracker.ts

import type { Coords } from '../types/index.js';
import { bgTracker } from './bgTracker.js';
import { workoutNotification } from './workoutNotification.js';
import { workoutLiveActivity, type LiveStats } from './liveActivity.js';
import { liveTracker } from './LiveTracker.js';
// Etap 1 — trwalosc sesji. Kazdy przyjety punkt i kazda zmiana stanu ida
// natychmiast do IndexedDB, zeby trening przezyl ubicie procesu WebView.
import { beginSession, saveSessionState, appendCoord, clearSession } from './sessionStore.js';

// Native-iOS detection — used to pick the GPS-speed auto-pause path there
// (devicemotion is suspended by iOS whenever the screen locks).
function isIosNative(): boolean {
  const cap = (globalThis as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean; getPlatform?: () => string };
  }).Capacitor;
  return !!cap?.isNativePlatform?.() && cap?.getPlatform?.() === 'ios';
}

export type SportType = string;

export const BUILTIN_SPORTS = ['running', 'walking', 'cycling'] as const;

export const ALL_SPORTS: { key: string; icon: string; label: string; trackable: boolean; category: string }[] = [
  // Foot
  { key: 'running',      icon: '🏃',  label: 'Running',         trackable: true,  category: 'Foot Sports'   },
  { key: 'trail_run',    icon: '⛰️',   label: 'Trail Run',       trackable: true,  category: 'Foot Sports'   },
  { key: 'walking',      icon: '🚶',  label: 'Walking',         trackable: true,  category: 'Foot Sports'   },
  { key: 'hiking',       icon: '🥾',  label: 'Hiking',          trackable: true,  category: 'Foot Sports'   },
  // Cycle
  { key: 'cycling',      icon: '🚴',  label: 'Cycling',         trackable: true,  category: 'Cycle Sports'  },
  { key: 'mtb',          icon: '🚵',  label: 'Mountain Bike',   trackable: true,  category: 'Cycle Sports'  },
  { key: 'gravel',       icon: '🚲',  label: 'Gravel Ride',     trackable: true,  category: 'Cycle Sports'  },
  { key: 'ebike',        icon: '⚡',  label: 'E-Bike Ride',     trackable: true,  category: 'Cycle Sports'  },
  { key: 'emtb',         icon: '⚡',  label: 'E-Mountain Bike', trackable: true,  category: 'Cycle Sports'  },
  { key: 'velomobile',   icon: '🚲',  label: 'Velomobile',      trackable: true,  category: 'Cycle Sports'  },
  { key: 'handcycle',    icon: '🦽',  label: 'Handcycle',       trackable: true,  category: 'Cycle Sports'  },
  // Wheel
  { key: 'skateboard',   icon: '🛹',  label: 'Skateboard',      trackable: true,  category: 'Wheel Sports'  },
  { key: 'inline_skate', icon: '🛼',  label: 'Inline Skate',    trackable: true,  category: 'Wheel Sports'  },
  { key: 'roller_ski',   icon: '🎿',  label: 'Roller Ski',      trackable: true,  category: 'Wheel Sports'  },
  { key: 'wheelchair',   icon: '♿',  label: 'Wheelchair',      trackable: true,  category: 'Wheel Sports'  },
  // Water
  { key: 'rowing',       icon: '🚣',  label: 'Rowing',          trackable: true,  category: 'Water Sports'  },
  { key: 'canoe',        icon: '🛶',  label: 'Canoe',           trackable: true,  category: 'Water Sports'  },
  { key: 'kayak',        icon: '🛶',  label: 'Kayak',           trackable: true,  category: 'Water Sports'  },
  { key: 'sup',          icon: '🏄',  label: 'Stand Up Paddle', trackable: true,  category: 'Water Sports'  },
  { key: 'surf',         icon: '🏄',  label: 'Surfing',         trackable: true,  category: 'Water Sports'  },
  { key: 'kitesurf',     icon: '🪁',  label: 'Kitesurf',        trackable: true,  category: 'Water Sports'  },
  { key: 'windsurf',     icon: '🏄',  label: 'Windsurf',        trackable: true,  category: 'Water Sports'  },
  { key: 'swimming',     icon: '🏊',  label: 'Swimming',        trackable: false, category: 'Water Sports'  },
  // Winter
  { key: 'skiing',       icon: '⛷️',   label: 'Alpine Ski',      trackable: true,  category: 'Winter Sports' },
  { key: 'backcountry_ski', icon: '🎿', label: 'Backcountry Ski', trackable: true, category: 'Winter Sports' },
  { key: 'nordic_ski',   icon: '🎿',  label: 'Nordic Ski',      trackable: true,  category: 'Winter Sports' },
  { key: 'snowboard',    icon: '🏂',  label: 'Snowboard',       trackable: true,  category: 'Winter Sports' },
  { key: 'snowshoe',     icon: '🥾',  label: 'Snowshoe',        trackable: true,  category: 'Winter Sports' },
  { key: 'ice_skate',    icon: '⛸️',   label: 'Ice Skate',       trackable: false, category: 'Winter Sports' },
  // Racket
  { key: 'tennis',       icon: '🎾',  label: 'Tennis',          trackable: false, category: 'Racket Sports' },
  { key: 'badminton',    icon: '🏸',  label: 'Badminton',       trackable: false, category: 'Racket Sports' },
  { key: 'table_tennis', icon: '🏓',  label: 'Table Tennis',    trackable: false, category: 'Racket Sports' },
  { key: 'pickleball',   icon: '🥒',  label: 'Pickleball',      trackable: false, category: 'Racket Sports' },
  { key: 'padel',        icon: '🎾',  label: 'Padel',           trackable: false, category: 'Racket Sports' },
  { key: 'squash',       icon: '🎾',  label: 'Squash',          trackable: false, category: 'Racket Sports' },
  { key: 'racquetball',  icon: '🎾',  label: 'Racquetball',     trackable: false, category: 'Racket Sports' },
  // Ball
  { key: 'football',     icon: '⚽',  label: 'Football',        trackable: false, category: 'Ball Sports'   },
  { key: 'basketball',   icon: '🏀',  label: 'Basketball',      trackable: false, category: 'Ball Sports'   },
  { key: 'volleyball',   icon: '🏐',  label: 'Volleyball',      trackable: false, category: 'Ball Sports'   },
  { key: 'cricket',      icon: '🏏',  label: 'Cricket',         trackable: false, category: 'Ball Sports'   },
  // Gym & Fitness
  { key: 'gym',          icon: '🏋️',   label: 'Weight Training', trackable: false, category: 'Gym & Fitness' },
  { key: 'crossfit',     icon: '💪',  label: 'CrossFit',        trackable: false, category: 'Gym & Fitness' },
  { key: 'hiit',         icon: '🔥',  label: 'HIIT',            trackable: false, category: 'Gym & Fitness' },
  { key: 'elliptical',   icon: '🌀',  label: 'Elliptical',      trackable: false, category: 'Gym & Fitness' },
  { key: 'stair_stepper',icon: '🪜',  label: 'Stair Stepper',   trackable: false, category: 'Gym & Fitness' },
  { key: 'yoga',         icon: '🧘',  label: 'Yoga',            trackable: false, category: 'Gym & Fitness' },
  { key: 'pilates',      icon: '🤸',  label: 'Pilates',         trackable: false, category: 'Gym & Fitness' },
  { key: 'boxing',       icon: '🥊',  label: 'Boxing',          trackable: false, category: 'Gym & Fitness' },
  { key: 'martial_arts', icon: '🥋',  label: 'Martial Arts',    trackable: false, category: 'Gym & Fitness' },
  { key: 'climbing',     icon: '🧗',  label: 'Rock Climb',      trackable: false, category: 'Gym & Fitness' },
  { key: 'dance',        icon: '💃',  label: 'Dance',           trackable: false, category: 'Gym & Fitness' },
  // Other
  { key: 'golf',         icon: '⛳',  label: 'Golf',            trackable: true,  category: 'Other'         },
  { key: 'workout',      icon: '🏅',  label: 'Workout',         trackable: false, category: 'Other'         },
];

// Whether a sport is GPS-trackable (shows map) or timer-only (stopwatch).
// Built-in sports use their flag; custom sports default to timer-only.
export function isTrackable(sport: string): boolean {
  const found = ALL_SPORTS.find(s => s.key === sport);
  return found ? found.trackable : false;
}

export function getSportIcon(sport: string): string {
  const found = ALL_SPORTS.find(s => s.key === sport);
  if (found) return found.icon;
  const l = sport.toLowerCase();
  if (l.includes('run'))   return '🏃';
  if (l.includes('walk'))  return '🚶';
  if (l.includes('cycl') || l.includes('bike')) return '🚴';
  if (l.includes('swim'))  return '🏊';
  if (l.includes('hik'))   return '🥾';
  if (l.includes('ski'))   return '⛷️';
  if (l.includes('tenn') || l.includes('teni')) return '🎾';
  if (l.includes('foot') || l.includes('soccer')) return '⚽';
  if (l.includes('basket')) return '🏀';
  if (l.includes('yoga'))  return '🧘';
  if (l.includes('gym') || l.includes('weight')) return '🏋️';
  if (l.includes('box'))   return '🥊';
  if (l.includes('row'))   return '🚣';
  if (l.includes('climb')) return '🧗';
  if (l.includes('dance')) return '💃';
  if (l.includes('cross')) return '💪';
  if (l.includes('pilat')) return '🤸';
  return '🏅';
}

export function getCustomSports(): { key: string; icon: string; label: string }[] {
  try { return JSON.parse(localStorage.getItem('mapyou_custom_sports') ?? '[]'); }
  catch { return []; }
}

export function saveCustomSport(label: string): { key: string; icon: string; label: string } {
  // Key uses index-based ID to avoid encoding issues with non-ASCII chars
  const existing = getCustomSports();
  const key  = 'custom_' + (existing.length + 1);
  const icon = getSportIcon(label);
  const sport = { key, icon, label };
  if (!existing.find(s => s.label.toLowerCase() === label.toLowerCase())) {
    existing.push(sport);
    localStorage.setItem('mapyou_custom_sports', JSON.stringify(existing));
  }
  return sport;
}

export function deleteCustomSport(key: string): void {
  const updated = getCustomSports().filter(s => s.key !== key);
  localStorage.setItem('mapyou_custom_sports', JSON.stringify(updated));
}

export function getSportLabel(key: string): string {
  const found = getAllSports().find(s => s.key === key);
  if (found) return found.label;
  // Check custom sports by label match (handles old keys like 'si_ownia')
  const customs = getCustomSports();
  const byLabel = customs.find(s => s.label.toLowerCase().replace(/[^a-z0-9]/g, '_') === key);
  if (byLabel) return byLabel.label;
  // Fallback — capitalize and replace underscores
  const polishNames: Record<string, string> = {
    'silownia': 'Gym', 'si_ownia': 'Gym',
    'bieganie': 'Bieganie', 'spacer': 'Spacer',
    'rower': 'Rower', 'plywanie': 'Swimming',
    'pilka_nozna': 'Football', 'koszykowka': 'Basketball',
    'siatkowka': 'Volleyball', 'boks': 'Boks',
    'taniec': 'Taniec', 'joga': 'Joga',
  };
  if (polishNames[key.toLowerCase()]) return polishNames[key.toLowerCase()];
  return key.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export function getAllSports(): { key: string; icon: string; label: string }[] {
  return [...ALL_SPORTS, ...getCustomSports()];
}

export interface Lap {
  km:          number;
  durationSec: number;
  paceMinKm:   number;
}

export interface TrackerStats {
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  coords:      Coords[];
  autoPaused?: boolean;
  laps?:       Lap[];
}

export interface ActivityRecord {
  id:          string;
  sport:       SportType;
  date:        string;
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  coords:      Coords[];
  description: string;
  laps?:       Lap[];
}

type OnUpdate = (stats: TrackerStats) => void;

export const SPORT_ICONS: Record<string, string> = {
  running: '🏃',
  walking: '🚶',
  cycling: '🚴',
};

export function getIcon(sport: string): string {
  if (SPORT_ICONS[sport]) return SPORT_ICONS[sport];
  const found = ALL_SPORTS.find(s => s.key === sport);
  if (found) return found.icon;
  return getSportIcon(sport);
}

export const SPORT_COLORS: Record<string, string> = {
  running: '#00c46a',
  walking: '#5badea',
  cycling: '#ffb545',
};

// 3 base sports keep their brand colors. Everything else uses one distinct
// turquoise so non-base sports stand out without a rainbow of colors.
// Returns a concrete color (not a CSS var) so it also works inside <canvas>.
export const SPORT_OTHER_COLOR = '#14c4b0';
export function getColor(sport: string): string {
  if (SPORT_COLORS[sport]) return SPORT_COLORS[sport];
  return SPORT_OTHER_COLOR;
}

export class Tracker {
  private map:           L.Map;
  private sport:         string = 'running';
  private coords:        Coords[]  = [];
  private polyline:      L.Polyline | null = null;
  private dotMarker:     L.CircleMarker | null = null;
  private watchId:       number | null = null;
  private _bgActive:     boolean = false;   // background foreground-service GPS in use
  private startTime:     number = 0;
  private pausedTime:    number = 0;   // ms spędzone na pauzie
  private pauseStart:    number = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private distanceM:     number = 0;
  private onUpdate:      OnUpdate;
  private _active:       boolean = false;
  private _paused:       boolean = false;
  // Auto-pause: freeze time/distance when (nearly) stationary, keep GPS running
  private _autoPauseOn:  boolean = false;   // feature enabled (setting)
  private _autoPaused:   boolean = false;   // currently auto-paused
  private _visHooked = false;
  private _lastStateSave = 0;               // throttling zapisu stanu sesji
  private _pendingDraw: Coords[] = [];      // punkty do dorysowania po powrocie
  private _autoPauseStart = 0;              // ms when current auto-pause began
  private _belowSince: number | null = null;// ms since speed dropped below threshold (GPS path)
  private _apAnchor: [number, number] | null = null; // anchor for stationary detection (null-speed iOS path)
  // Per-km splits (laps)
  private _laps: Lap[] = [];
  private _lastLapSec = 0;
  // Motion (accelerometer) path — used for foot sports (run/walk/hike)
  private _useMotionAP:  boolean = false;
  private _motionMag:    number[] = [];
  private _motionRestSince: number | null = null;
  private _motionHandler: ((e: DeviceMotionEvent) => void) | null = null;
  private static readonly MOTION_SPORTS = ['running', 'walking', 'hiking', 'trail_run', 'snowshoe'];

  constructor(map: L.Map, onUpdate: OnUpdate) {
    this.map      = map;
    this.onUpdate = onUpdate;
  }

  get isActive(): boolean  { return this._active; }
  get isPaused(): boolean  { return this._paused; }
  get currentSport(): SportType { return this.sport; }

  setSport(sport: string): void { this.sport = sport; }

  setAutoPause(on: boolean): void {
    this._autoPauseOn = on;
    // Foot sports → accelerometer (like Strava running); others → GPS speed (like Strava cycling)
    // EXCEPT native iOS: the web devicemotion API is suspended the moment the
    // screen locks, which killed auto-pause in the background. Native GPS fixes
    // (with coords.speed) keep flowing while locked, so iOS uses the GPS path
    // for every sport.
    this._useMotionAP = on && Tracker.MOTION_SPORTS.includes(this.sport) && !isIosNative();
    if (this._active && this._useMotionAP) this._startMotion();
    else this._stopMotion();
    if (!on && this._autoPaused) this._exitAutoPause();
  }

  // ── Start ───────────────────────────────────────────────────────────────────

  start(): void {
    if (this._active) return;
    this._active   = true;
    this._paused   = false;
    this.coords    = [];
    this.distanceM = 0;
    this.pausedTime = 0;
    this.startTime = Date.now();
    this._autoPaused = false;
    this._belowSince = null;
    this._apAnchor = null;
    this._laps = [];
    this._lastLapSec = 0;

    void beginSession({
      sport:      this.sport,
      startTime:  this.startTime,
      pausedTime: 0,
      pauseStart: 0,
      distanceM:  0,
      paused:     false,
      autoPaused: false,
      laps:       [],
      lastLapSec: 0,
    });

    const color = getColor(this.sport);
    this.polyline = L.polyline([], {
      color, weight: 5, opacity: 0.95,
    }).addTo(this.map);

    this._startGPS();
    if (this._autoPauseOn && this._useMotionAP) this._startMotion();
    void workoutLiveActivity.start(this.sport, getSportLabel(this.sport));

    this.timerInterval = setInterval(() => {
      if (!this._paused) {
        const stats = this._buildStats();
        this.onUpdate(stats);
        this._updateNotification(stats);
      }
    }, 1000);
  }

  /** Dorysuj punkty zebrane, gdy ekran byl wygaszony.
   *
   *  Jedno wywolanie zamiast setek — Leaflet przelicza sciezke raz. */
  private _flushPendingDraw(): void {
    if (!this._pendingDraw.length || !this.polyline) { this._pendingDraw = []; return; }
    const pts = this._pendingDraw;
    this._pendingDraw = [];
    this.polyline.setLatLngs(this.coords.map(c => L.latLng(c[0], c[1])));
    const last = pts[pts.length - 1];
    if (last) this.dotMarker?.setLatLng(L.latLng(last[0], last[1]));
  }

  // ── Odtworzenie po ubiciu procesu (Etap 1) ──────────────────────────────────

  /** Wznow trening z migawki zapisanej w IndexedDB.
   *
   *  Wolane przy starcie apki, gdy `sessionStore` znajdzie niezakonczona sesje.
   *  Odtwarza WSZYSTKO: kotwice czasu, dystans, okrazenia, trase i marker —
   *  a potem uruchamia GPS tak samo jak zwykly `start()`. Z punktu widzenia
   *  uzytkownika nic sie nie stalo: licznik idzie dalej od wlasciwej wartosci,
   *  mapa ma cala przebyta trase.
   *
   *  Czas liczy sie od `startTime`, wiec minuty spedzone przy ubitej apce
   *  wliczaja sie normalnie — dokladnie tak, jak gdyby apka dzialala. */
  restore(state: {
    sport: string; startTime: number; pausedTime: number; pauseStart: number;
    distanceM: number; paused: boolean; autoPaused: boolean;
    laps: Lap[]; lastLapSec: number;
  }, coords: Coords[]): void {
    if (this._active) return;

    this.sport      = state.sport;
    this._active    = true;
    this._paused    = state.paused;
    this.startTime  = state.startTime;
    this.pausedTime = state.pausedTime;
    this.pauseStart = state.pauseStart;
    // Dystans PRZELICZAMY z punktow, zamiast ufac zapisanemu stanowi.
    //
    // Stan sesji zapisujemy co 10 sekund (oszczednosc baterii), wiec przy
    // ubiciu procesu miedzy zapisami zapamietany dystans moze byc do 10 s
    // starszy niz trasa. Punkty leca do bazy natychmiast i sa kompletne —
    // wiec suma odleglosci miedzy nimi jest ZAWSZE dokladniejsza.
    //
    // Uzywamy tej samej metody i tych samych progow co przy zbieraniu
    // (MIN_STEP_M i sufit 50 m), zeby wynik byl co do metra taki sam,
    // jakby apka nie zostala ubita.
    this.distanceM  = recomputeDistance(coords, state.distanceM);
    this._autoPaused = state.autoPaused;
    this._laps      = [...state.laps];
    this._lastLapSec = state.lastLapSec;
    this.coords     = [...coords];
    this._belowSince = null;
    this._apAnchor   = null;

    const color = getColor(this.sport);
    this.polyline = L.polyline(coords.map(c => L.latLng(c[0], c[1])), {
      color, weight: 5, opacity: 0.95,
    }).addTo(this.map);

    const last = coords[coords.length - 1];
    if (last) {
      this.dotMarker = L.circleMarker([last[0], last[1]], {
        radius: 9, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2.5,
      }).addTo(this.map);
      this.map.setView([last[0], last[1]], this.map.getZoom() || 16);
    }

    // GPS wznawiamy tylko gdy trening NIE jest na pauzie — inaczej punkty
    // z pauzy doliczylyby sie do dystansu.
    if (!this._paused) {
      this._startGPS();
      if (this._autoPauseOn && this._useMotionAP) this._startMotion();
    }
    void workoutLiveActivity.start(this.sport, getSportLabel(this.sport));

    this.timerInterval = setInterval(() => {
      if (!this._paused) {
        const stats = this._buildStats();
        this.onUpdate(stats);
        this._updateNotification(stats);
      }
    }, 1000);

    this.onUpdate(this._buildStats());
    // Po wznowieniu z migawki wyspa musi znac stan pauzy — inaczej startuje
    // w trybie „biegnie" mimo wstrzymanego treningu.
    void workoutLiveActivity.update(this._liveStats(this._buildStats()), true);
  }

  // ── Pause ───────────────────────────────────────────────────────────────────

  pause(): void {
    if (!this._active || this._paused) return;
    this._paused    = true;
    this.pauseStart = Date.now();
    this._stopGPS();
    this._stopMotion();
    // Clear any in-progress auto-pause (manual pause takes over)
    this._autoPaused = false;
    this._belowSince = null;
    this._apAnchor = null;
    // Ticks freeze while paused — push the "Paused" state to the island now.
    // Zmiana stanu — Live Activity budowana od nowa, z ukladem
    // BEZ tykajacego licznika.
    void workoutLiveActivity.setPaused(true, this._liveStats(this._buildStats()));
    void saveSessionState({ paused: true, pauseStart: this.pauseStart, autoPaused: false });
  }

  // ── Resume ──────────────────────────────────────────────────────────────────

  resume(): void {
    if (!this._active || !this._paused) return;
    this._paused     = false;
    this.pausedTime += Date.now() - this.pauseStart;
    this._startGPS();
    if (this._autoPauseOn && this._useMotionAP) this._startMotion();
    this.onUpdate(this._buildStats());
    // Zmiana stanu — Live Activity budowana od nowa, z ukladem
    // z tykajacym licznikiem.
    void workoutLiveActivity.setPaused(false, this._liveStats(this._buildStats()));
    void saveSessionState({ paused: false, pausedTime: this.pausedTime, pauseStart: 0 });
  }

  // ── Stop ────────────────────────────────────────────────────────────────────

  stop(): ActivityRecord | null {
    if (!this._active) return null;
    this._active = false;
    this._paused = false;

    this._stopGPS();
    this._stopMotion();
    void workoutNotification.clear();
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.dotMarker)     { this.map.removeLayer(this.dotMarker); this.dotMarker = null; }

    const stats  = this._buildStats();
    void workoutLiveActivity.end(this._liveStats(stats));
    // Migawke kasujemy TU, przed zbudowaniem wyniku. Wczesniej stalo to na
    // koncu metody — czyli PO `return` — wiec nigdy sie nie wykonywalo.
    // Skutek: apka odtwarzala zakonczony trening przy kazdym uruchomieniu
    // i wpadala w petle z Live Activity.
    void clearSession();
    const now    = new Date().toISOString();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const d = new Date(now);

    return {
      id:          String(Date.now()),
      sport:       this.sport,
      date:        now,
      distanceKm:  stats.distanceKm,
      durationSec: stats.durationSec,
      paceMinKm:   stats.paceMinKm,
      speedKmH:    stats.speedKmH,
      coords:      [...this.coords],
      description: `${getIcon(this.sport)} ${getSportLabel(this.sport)} on ${months[d.getMonth()]} ${d.getDate()}`,
      laps:        [...this._laps],
    };
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  reset(): void {
    this._stopGPS();
    this._stopMotion();
    void workoutNotification.clear();
    void workoutLiveActivity.end();
    // Odrzucenie treningu tez konczy sesje — bez tego odrzucony trening
    // wracalby przy nastepnym uruchomieniu apki.
    void clearSession();
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.polyline)  { this.map.removeLayer(this.polyline);  this.polyline  = null; }
    if (this.dotMarker) { this.map.removeLayer(this.dotMarker); this.dotMarker = null; }
    this.coords     = [];
    this.distanceM  = 0;
    this._active    = false;
    this._paused    = false;
    this._autoPaused = false;
    this._belowSince = null;
    this._apAnchor = null;
    this._laps = [];
    this._lastLapSec = 0;
  }

  // ── Draw saved activity ─────────────────────────────────────────────────────

  drawActivity(activity: ActivityRecord): L.Polyline | null {
    if (!activity.coords.length) return null;
    const color = getColor(activity.sport);
    const line  = L.polyline(
      activity.coords.map(c => L.latLng(c[0], c[1])),
      { color, weight: 5, opacity: 0.95 },
    ).addTo(this.map);
    this.map.fitBounds(line.getBounds(), { padding: [60, 60] });
    return line;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Podepnij dorysowanie po powrocie do apki. Raz na instancje. */
  private _installVisibilityRedraw(): void {
    if (this._visHooked) return;
    this._visHooked = true;
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this._flushPendingDraw();
    });
  }

  private _startGPS(): void {
    this._installVisibilityRedraw();
    // Native: record via a background foreground-service so the route keeps
    // logging with the screen locked. Web/PWA: foreground watch (Krok A).
    if (bgTracker.isAvailable()) {
      this._bgActive = true;
      const label = getSportLabel(this.sport);
      void bgTracker.start(
        pos => this._onPosition(pos),
        { title: `MapYou · ${label}`, message: 'Nagrywanie trasy…' },
        err => console.warn('[Tracker] bg GPS:', err),
      ).then(ok => { if (!ok) { this._bgActive = false; this._startForegroundGPS(); } });
      return;
    }
    this._startForegroundGPS();
  }

  private _startForegroundGPS(): void {
    this.watchId = navigator.geolocation.watchPosition(
      pos => this._onPosition(pos),
      err => console.warn('[Tracker] GPS:', err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }

  private _stopGPS(): void {
    if (this._bgActive) { this._bgActive = false; void bgTracker.stop(); return; }
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private _onPosition(pos: GeolocationPosition): void {
    if (this._paused) return;
    const { latitude: lat, longitude: lng } = pos.coords;
    const newCoord: Coords = [lat, lng];

    // ── Auto-pause (GPS path): for cycling/other sports, like Strava cycling ──
    if (this._autoPauseOn && !this._useMotionAP) {
      const THRESH_MS = 0.28;    // 1 km/h in m/s — "completely stopped"
      const STILL_RADIUS_M = 8;  // stationary GPS jitter stays inside this circle
      const now = Date.now();
      const spd = pos.coords.speed;
      let stationary: boolean;
      if (spd != null && !Number.isNaN(spd) && spd >= 0) {
        // Valid Doppler speed — reliable while actually moving.
        stationary = spd < THRESH_MS;
      } else {
        // iOS quirk: a stationary device reports speed −1 and the native
        // plugin serialises that as null. Deriving speed from fix-to-fix
        // distance is useless then (1 Hz jitter looks like 0.5–2 m/s of
        // permanent "movement" — auto-pause never fired). Anchor-dwell
        // instead: as long as fixes stay within STILL_RADIUS_M of the
        // anchor point, we are standing still; escaping it means motion.
        if (!this._apAnchor) this._apAnchor = [lat, lng];
        const drift = L.latLng(this._apAnchor[0], this._apAnchor[1])
          .distanceTo(L.latLng(lat, lng));
        stationary = drift <= STILL_RADIUS_M;
        if (!stationary) this._apAnchor = [lat, lng];  // escaped → re-anchor
      }
      if (stationary) {
        if (this._belowSince == null) this._belowSince = now;
        if (!this._autoPaused && now - this._belowSince > 5000) this._enterAutoPause();
      } else {
        this._belowSince = null;
        this._apAnchor = [lat, lng];
        if (this._autoPaused) this._exitAutoPause();
      }
    }

    // While auto-paused: keep marker fresh but don't accumulate distance/route
    if (this._autoPaused) {
      if (this.dotMarker) this.dotMarker.setLatLng([lat, lng]);
      const apStats = this._buildStats();
      this.onUpdate(apStats);
      this._updateNotification(apStats);  // keep the Live Activity fresh ("Auto-paused" + frozen time)
      liveTracker.feedPosition(lat, lng, pos.coords.speed);
      return;
    }

    // Accept a new route point only after real movement (≥ MIN_STEP_M from the
    // last accepted point). GPS now delivers ~1 fix/s (distanceFilter: 0 keeps
    // the Live Activity ticking in the background), so without this gate the
    // stationary jitter would inflate distance and bloat the route.
    let accepted = true;
    if (this.coords.length > 0) {
      const prev = this.coords[this.coords.length - 1];
      const dist = L.latLng(prev[0], prev[1]).distanceTo(L.latLng(lat, lng));
      accepted = dist >= MIN_STEP_M && dist < MAX_STEP_M;
      if (accepted) this.distanceM += dist;
    }

    // Record per-km splits (laps) as each kilometre boundary is crossed
    const kmFloor = Math.floor(this.distanceM / 1000);
    while (this._laps.length < kmFloor) {
      const cumSec = this._elapsedSec();
      const lapSec = Math.max(0, cumSec - this._lastLapSec);
      this._lastLapSec = cumSec;
      this._laps.push({ km: this._laps.length + 1, durationSec: lapSec, paceMinKm: lapSec / 60 });
    }

    if (accepted) {
      this.coords.push(newCoord);

      // Nie rysuj, gdy nikt nie patrzy.
      //
      // `addLatLng` przelicza sciezke SVG przy kazdym punkcie. Przy wygaszonym
      // ekranie albo apce w tle to praca calkowicie zmarnowana — a trwa cala
      // godzine biegu. Punkty odkladamy i dorysowujemy jednym ruchem,
      // gdy uzytkownik wroci.
      if (document.hidden) {
        this._pendingDraw.push(newCoord);
      } else {
        this.polyline?.addLatLng(L.latLng(lat, lng));
      }
      // Punkt na dysk NATYCHMIAST. To jest sedno Etapu 1 — po ubiciu procesu
      // trasa odtwarza sie z tych rekordow, a nie z pamieci obiektu.
      void appendCoord(lat, lng);

      // Stan sesji zapisujemy RZADZIEJ niz punkty.
      //
      // Punkt musi ladowac natychmiast — to on ginie przy ubiciu procesu.
      // Ale `saveSessionState` przepisuje CALY rekord sesji, a robione przy
      // kazdym fixie dawalo ~3600 transakcji IndexedDB na godzine treningu.
      // Dystans i okrazenia da sie odtworzyc z punktow, wiec 10 sekund
      // opoznienia niczego nie kosztuje, a oszczedza baterie.
      const now = Date.now();
      if (now - this._lastStateSave > 10_000) {
        this._lastStateSave = now;
        void saveSessionState({
          distanceM:  this.distanceM,
          laps:       this._laps,
          lastLapSec: this._lastLapSec,
          autoPaused: this._autoPaused,
        });
      }
    }

    if (this.dotMarker) {
      this.dotMarker.setLatLng([lat, lng]);
    } else {
      this.dotMarker = L.circleMarker([lat, lng], {
        radius: 9, color: '#fff', fillColor: getColor(this.sport),
        fillOpacity: 1, weight: 2.5,
      }).addTo(this.map);
    }

    this.map.panTo([lat, lng], { animate: true, duration: 0.8 });
    const _st = this._buildStats();
    this.onUpdate(_st);
    this._updateNotification(_st);   // GPS fixes keep arriving in bg even if the JS timer sleeps
    liveTracker.feedPosition(lat, lng, pos.coords.speed);  // friend's live view — same survival path
  }

  // ── Auto-pause shared logic (freeze time/distance, keep sensors running) ──
  private _enterAutoPause(): void {
    if (this._autoPaused) return;
    this._autoPaused = true;
    this._autoPauseStart = Date.now();
    this.onUpdate(this._buildStats());
    // Zmiana stanu — Live Activity budowana od nowa, z ukladem
    // bez tykajacego licznika.
    void workoutLiveActivity.setPaused(true, this._liveStats(this._buildStats()));
  }

  private _exitAutoPause(): void {
    if (!this._autoPaused) return;
    this.pausedTime += Date.now() - this._autoPauseStart;  // freeze elapsed
    this._autoPaused = false;
    this.onUpdate(this._buildStats());
    // Zmiana stanu — Live Activity budowana od nowa, z ukladem
    // z tykajacym licznikiem.
    void workoutLiveActivity.setPaused(false, this._liveStats(this._buildStats()));
  }

  // ── Accelerometer-based rest detection (foot sports, like Strava running) ──
  private _startMotion(): void {
    if (this._motionHandler) return;
    const REST_MS = 3000;        // sustained stillness before pausing
    const REST_SD = 0.45;        // m/s² stddev of accel magnitude → "at rest"
    this._motionMag = [];
    this._motionRestSince = null;
    this._motionHandler = (e: DeviceMotionEvent) => {
      if (!this._active || this._paused) return;
      const g = e.accelerationIncludingGravity || e.acceleration;
      if (!g || (g.x == null && g.y == null && g.z == null)) return;
      const mag = Math.sqrt((g.x || 0) ** 2 + (g.y || 0) ** 2 + (g.z || 0) ** 2);
      this._motionMag.push(mag);
      if (this._motionMag.length > 50) this._motionMag.shift();
      if (this._motionMag.length < 10) return;   // need a small window first
      const n    = this._motionMag.length;
      const mean = this._motionMag.reduce((s, v) => s + v, 0) / n;
      const sd   = Math.sqrt(this._motionMag.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
      const now  = Date.now();
      if (sd < REST_SD) {
        if (this._motionRestSince == null) this._motionRestSince = now;
        if (!this._autoPaused && now - this._motionRestSince > REST_MS) this._enterAutoPause();
      } else {
        this._motionRestSince = null;
        if (this._autoPaused) this._exitAutoPause();
      }
    };
    window.addEventListener('devicemotion', this._motionHandler);
  }

  private _stopMotion(): void {
    if (this._motionHandler) {
      window.removeEventListener('devicemotion', this._motionHandler);
      this._motionHandler = null;
    }
    this._motionMag = [];
    this._motionRestSince = null;
  }

  private _elapsedSec(): number {
    const autoPauseLive = this._autoPaused ? (Date.now() - this._autoPauseStart) : 0;
    return Math.max(0, (Date.now() - this.startTime - this.pausedTime - autoPauseLive) / 1000);
  }

  // Live lock-screen notification (Strava-style). Throttled inside the module.
  private _updateNotification(stats: TrackerStats): void {
    const label = getSportLabel(this.sport);
    const title = this._autoPaused
      ? `MapYou · ${label} (auto-paused)`
      : `MapYou · ${label}`;
    const la = this._liveStats(stats);
    const body = `${stats.distanceKm.toFixed(2)} km · ${formatDuration(stats.durationSec)} · ${la.third}`;
    void workoutNotification.update(title, body);
    void workoutLiveActivity.update(la);
  }

  // Shared formatter for the iOS Live Activity (lock screen + Dynamic Island).
  private _liveStats(stats: TrackerStats): LiveStats {
    const isSpeedSport = this.sport === 'cycling' || this.sport === 'ebike' ||
                         this.sport === 'skiing' || this.sport === 'snowboard';
    const paused = this._paused || this._autoPaused;
    return {
      time: formatDuration(stats.durationSec),
      dist: `${stats.distanceKm.toFixed(2)} km`,
      third: isSpeedSport
        ? `${stats.speedKmH.toFixed(1)} km/h`
        : `${formatPace(stats.paceMinKm)} /km`,
      thirdLabel: isSpeedSport ? 'SPEED' : 'PACE',
      state: this._autoPaused ? 'Auto-paused' : (this._paused ? 'Paused' : ''),
      // Anchor for the native ticking timer: (now − timerRef) = active elapsed.
      // pausedTime grows on every resume, pushing the anchor forward so pauses
      // are excluded. While paused the timer is hidden (opacity), so the
      // momentarily-stale anchor is never visible.
      // NIE dodawaj tu trwajacej pauzy. Probowalem — i to zepsulo dzialajace
      // zatrzymywanie licznika na Dynamic Island.
      //
      // Powod: natywny `Text(.timer)` pokazuje roznice „teraz minus kotwica",
      // wiec przesuwanie kotwicy nie zatrzymuje go, tylko falszuje wartosc.
      // Licznik zatrzymuje WYLACZNIE ukrycie tego elementu — czyli `runOp`
      // i `pauseOp` w `laData`. Ten mechanizm dziala i nie nalezy go dublowac.
      timerRef: this.startTime + this.pausedTime,
      paused,
    };
  }

  private _buildStats(): TrackerStats {
    const durationSec = Math.floor(this._elapsedSec());
    const distanceKm  = this.distanceM / 1000;
    const durationMin = durationSec / 60;
    const paceMinKm   = distanceKm > 0.01 ? durationMin / distanceKm : 0;
    const speedKmH    = durationMin > 0    ? distanceKm / (durationMin / 60) : 0;
    return { distanceKm, durationSec, paceMinKm, speedKmH, coords: this.coords, autoPaused: this._autoPaused, laps: this._laps };
  }
}

// ── Formattery ────────────────────────────────────────────────────────────────

export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

export function formatPace(paceMinKm: number): string {
  if (!paceMinKm || paceMinKm > 99) return '--:--';
  const m = Math.floor(paceMinKm);
  const s = Math.round((paceMinKm - m) * 60);
  return `${m}:${String(s).padStart(2,'0')}`;
}

/** Progi akceptacji punktu GPS — WSPOLNE dla nagrywania i przeliczania.
 *
 *  Trzymane w jednym miejscu celowo: gdyby kazda sciezka miala wlasna kopie,
 *  zmiana jednej po cichu rozjechalaby dystans liczony na zywo z tym
 *  odtwarzanym po wznowieniu sesji. */
export const MIN_STEP_M = 3;    // ponizej to drgania GPS, nie ruch
export const MAX_STEP_M = 50;   // powyzej to przeskok sygnalu, nie bieg

export function formatDistance(km: number): string { return km.toFixed(2); }

/** Policz dystans trasy z listy punktow.
 *
 *  Progi identyczne jak przy zbieraniu na zywo: odrzucamy drgania GPS ponizej
 *  MIN_STEP_M i skoki powyzej 50 m. Dzieki temu przeliczenie po wznowieniu
 *  daje te sama liczbe, co ciagle nagrywanie.
 *
 *  `fallback` wraca, gdy punktow jest za malo, zeby cokolwiek policzyc. */
export function recomputeDistance(coords: Coords[], fallback = 0): number {
  if (coords.length < 2) return fallback;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i - 1];
    const b = coords[i];
    const d = L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1]));
    if (d >= MIN_STEP_M && d < MAX_STEP_M) total += d;
  }
  return total;
}
