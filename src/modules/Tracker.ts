// ─── TRACKER MODULE ──────────────────────────────────────────────────────────
// src/modules/Tracker.ts

import type { Coords } from '../types/index.js';
import { bgTracker } from './bgTracker.js';

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
    'silownia': 'Siłownia', 'si_ownia': 'Siłownia',
    'bieganie': 'Bieganie', 'spacer': 'Spacer',
    'rower': 'Rower', 'plywanie': 'Pływanie',
    'pilka_nozna': 'Piłka nożna', 'koszykowka': 'Koszykówka',
    'siatkowka': 'Siatkówka', 'boks': 'Boks',
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
  private _autoPauseStart = 0;              // ms when current auto-pause began
  private _belowSince: number | null = null;// ms since speed dropped below threshold (GPS path)
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
    this._useMotionAP = on && Tracker.MOTION_SPORTS.includes(this.sport);
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
    this._laps = [];
    this._lastLapSec = 0;

    const color = getColor(this.sport);
    this.polyline = L.polyline([], {
      color, weight: 5, opacity: 0.95,
    }).addTo(this.map);

    this._startGPS();
    if (this._autoPauseOn && this._useMotionAP) this._startMotion();

    this.timerInterval = setInterval(() => {
      if (!this._paused) this.onUpdate(this._buildStats());
    }, 1000);
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
  }

  // ── Resume ──────────────────────────────────────────────────────────────────

  resume(): void {
    if (!this._active || !this._paused) return;
    this._paused     = false;
    this.pausedTime += Date.now() - this.pauseStart;
    this._startGPS();
    if (this._autoPauseOn && this._useMotionAP) this._startMotion();
    this.onUpdate(this._buildStats());
  }

  // ── Stop ────────────────────────────────────────────────────────────────────

  stop(): ActivityRecord | null {
    if (!this._active) return null;
    this._active = false;
    this._paused = false;

    this._stopGPS();
    this._stopMotion();
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.dotMarker)     { this.map.removeLayer(this.dotMarker); this.dotMarker = null; }

    const stats  = this._buildStats();
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
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.polyline)  { this.map.removeLayer(this.polyline);  this.polyline  = null; }
    if (this.dotMarker) { this.map.removeLayer(this.dotMarker); this.dotMarker = null; }
    this.coords     = [];
    this.distanceM  = 0;
    this._active    = false;
    this._paused    = false;
    this._autoPaused = false;
    this._belowSince = null;
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

  private _startGPS(): void {
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
      const THRESH_MS = 0.28; // 1 km/h in m/s — "completely stopped"
      let spd = pos.coords.speed != null && !Number.isNaN(pos.coords.speed)
        ? pos.coords.speed : NaN;
      if (Number.isNaN(spd) && this.coords.length > 0) {
        const prev = this.coords[this.coords.length - 1];
        spd = L.latLng(prev[0], prev[1]).distanceTo(L.latLng(lat, lng)) / 2; // ~per 2s
      }
      const now = Date.now();
      if (spd < THRESH_MS) {
        if (this._belowSince == null) this._belowSince = now;
        if (!this._autoPaused && now - this._belowSince > 5000) this._enterAutoPause();
      } else {
        this._belowSince = null;
        if (this._autoPaused) this._exitAutoPause();
      }
    }

    // While auto-paused: keep marker fresh but don't accumulate distance/route
    if (this._autoPaused) {
      if (this.dotMarker) this.dotMarker.setLatLng([lat, lng]);
      this.onUpdate(this._buildStats());
      return;
    }

    if (this.coords.length > 0) {
      const prev = this.coords[this.coords.length - 1];
      const dist = L.latLng(prev[0], prev[1]).distanceTo(L.latLng(lat, lng));
      // Filtruj skoki GPS > 50m/s (błędy GPS)
      if (dist < 50) this.distanceM += dist;
    }

    // Record per-km splits (laps) as each kilometre boundary is crossed
    const kmFloor = Math.floor(this.distanceM / 1000);
    while (this._laps.length < kmFloor) {
      const cumSec = this._elapsedSec();
      const lapSec = Math.max(0, cumSec - this._lastLapSec);
      this._lastLapSec = cumSec;
      this._laps.push({ km: this._laps.length + 1, durationSec: lapSec, paceMinKm: lapSec / 60 });
    }

    this.coords.push(newCoord);
    this.polyline?.addLatLng(L.latLng(lat, lng));

    if (this.dotMarker) {
      this.dotMarker.setLatLng([lat, lng]);
    } else {
      this.dotMarker = L.circleMarker([lat, lng], {
        radius: 9, color: '#fff', fillColor: getColor(this.sport),
        fillOpacity: 1, weight: 2.5,
      }).addTo(this.map);
    }

    this.map.panTo([lat, lng], { animate: true, duration: 0.8 });
    this.onUpdate(this._buildStats());
  }

  // ── Auto-pause shared logic (freeze time/distance, keep sensors running) ──
  private _enterAutoPause(): void {
    if (this._autoPaused) return;
    this._autoPaused = true;
    this._autoPauseStart = Date.now();
    this.onUpdate(this._buildStats());
  }

  private _exitAutoPause(): void {
    if (!this._autoPaused) return;
    this.pausedTime += Date.now() - this._autoPauseStart;  // freeze elapsed
    this._autoPaused = false;
    this.onUpdate(this._buildStats());
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

export function formatDistance(km: number): string { return km.toFixed(2); }
