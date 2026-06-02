// ─── TRACKER MODULE ──────────────────────────────────────────────────────────
// src/modules/Tracker.ts

import type { Coords } from '../types/index.js';

export type SportType = string;

export const BUILTIN_SPORTS = ['running', 'walking', 'cycling'] as const;

export const ALL_SPORTS: { key: string; icon: string; label: string }[] = [
  { key: 'running',      icon: '🏃',  label: 'Running'      },
  { key: 'walking',      icon: '🚶',  label: 'Walking'      },
  { key: 'cycling',      icon: '🚴',  label: 'Cycling'      },
  { key: 'swimming',     icon: '🏊',  label: 'Swimming'     },
  { key: 'hiking',       icon: '🥾',  label: 'Hiking'       },
  { key: 'skiing',       icon: '⛷️',   label: 'Skiing'       },
  { key: 'tennis',       icon: '🎾',  label: 'Tennis'       },
  { key: 'football',     icon: '⚽',  label: 'Football'     },
  { key: 'basketball',   icon: '🏀',  label: 'Basketball'   },
  { key: 'volleyball',   icon: '🏐',  label: 'Volleyball'   },
  { key: 'yoga',         icon: '🧘',  label: 'Yoga'         },
  { key: 'gym',          icon: '🏋️',   label: 'Gym'          },
  { key: 'boxing',       icon: '🥊',  label: 'Boxing'       },
  { key: 'rowing',       icon: '🚣',  label: 'Rowing'       },
  { key: 'climbing',     icon: '🧗',  label: 'Climbing'     },
  { key: 'skateboard',   icon: '🛹',  label: 'Skateboard'   },
  { key: 'martial_arts', icon: '🥋',  label: 'Martial Arts' },
  { key: 'dance',        icon: '💃',  label: 'Dance'        },
  { key: 'crossfit',     icon: '💪',  label: 'CrossFit'     },
  { key: 'pilates',      icon: '🤸',  label: 'Pilates'      },
];

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
  // Fallback — capitalize and replace underscores
  return key.replace(/_/g, ' ').replace(/\w/g, c => c.toUpperCase());
}

export function getAllSports(): { key: string; icon: string; label: string }[] {
  return [...ALL_SPORTS, ...getCustomSports()];
}

export interface TrackerStats {
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  coords:      Coords[];
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
}

type OnUpdate = (stats: TrackerStats) => void;

export const SPORT_ICONS: Record<string, string> = {
  running: '🏃',
  walking: '🚶',
  cycling: '🚴',
};

export function getIcon(sport: string): string {
  return SPORT_ICONS[sport] ?? getSportIcon(sport);
}

export const SPORT_COLORS: Record<string, string> = {
  running: '#00c46a',
  walking: '#5badea',
  cycling: '#ffb545',
};

export function getColor(sport: string): string {
  return SPORT_COLORS[sport] ?? '#ffffff';
}

export class Tracker {
  private map:           L.Map;
  private sport:         string = 'running';
  private coords:        Coords[]  = [];
  private polyline:      L.Polyline | null = null;
  private dotMarker:     L.CircleMarker | null = null;
  private watchId:       number | null = null;
  private startTime:     number = 0;
  private pausedTime:    number = 0;   // ms spędzone na pauzie
  private pauseStart:    number = 0;
  private timerInterval: ReturnType<typeof setInterval> | null = null;
  private distanceM:     number = 0;
  private onUpdate:      OnUpdate;
  private _active:       boolean = false;
  private _paused:       boolean = false;

  constructor(map: L.Map, onUpdate: OnUpdate) {
    this.map      = map;
    this.onUpdate = onUpdate;
  }

  get isActive(): boolean  { return this._active; }
  get isPaused(): boolean  { return this._paused; }
  get currentSport(): SportType { return this.sport; }

  setSport(sport: string): void { this.sport = sport; }

  // ── Start ───────────────────────────────────────────────────────────────────

  start(): void {
    if (this._active) return;
    this._active   = true;
    this._paused   = false;
    this.coords    = [];
    this.distanceM = 0;
    this.pausedTime = 0;
    this.startTime = Date.now();

    const color = SPORT_COLORS[this.sport];
    this.polyline = L.polyline([], {
      color, weight: 5, opacity: 0.95,
    }).addTo(this.map);

    this._startGPS();

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
  }

  // ── Resume ──────────────────────────────────────────────────────────────────

  resume(): void {
    if (!this._active || !this._paused) return;
    this._paused     = false;
    this.pausedTime += Date.now() - this.pauseStart;
    this._startGPS();
    this.onUpdate(this._buildStats());
  }

  // ── Stop ────────────────────────────────────────────────────────────────────

  stop(): ActivityRecord | null {
    if (!this._active) return null;
    this._active = false;
    this._paused = false;

    this._stopGPS();
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
      description: `${SPORT_ICONS[this.sport]} ${this.sport.charAt(0).toUpperCase() + this.sport.slice(1)} on ${months[d.getMonth()]} ${d.getDate()}`,
    };
  }

  // ── Reset ───────────────────────────────────────────────────────────────────

  reset(): void {
    this._stopGPS();
    if (this.timerInterval) { clearInterval(this.timerInterval); this.timerInterval = null; }
    if (this.polyline)  { this.map.removeLayer(this.polyline);  this.polyline  = null; }
    if (this.dotMarker) { this.map.removeLayer(this.dotMarker); this.dotMarker = null; }
    this.coords     = [];
    this.distanceM  = 0;
    this._active    = false;
    this._paused    = false;
  }

  // ── Draw saved activity ─────────────────────────────────────────────────────

  drawActivity(activity: ActivityRecord): L.Polyline | null {
    if (!activity.coords.length) return null;
    const color = SPORT_COLORS[activity.sport];
    const line  = L.polyline(
      activity.coords.map(c => L.latLng(c[0], c[1])),
      { color, weight: 5, opacity: 0.95 },
    ).addTo(this.map);
    this.map.fitBounds(line.getBounds(), { padding: [60, 60] });
    return line;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _startGPS(): void {
    this.watchId = navigator.geolocation.watchPosition(
      pos => this._onPosition(pos),
      err => console.warn('[Tracker] GPS:', err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );
  }

  private _stopGPS(): void {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
  }

  private _onPosition(pos: GeolocationPosition): void {
    if (this._paused) return;
    const { latitude: lat, longitude: lng } = pos.coords;
    const newCoord: Coords = [lat, lng];

    if (this.coords.length > 0) {
      const prev = this.coords[this.coords.length - 1];
      const dist = L.latLng(prev[0], prev[1]).distanceTo(L.latLng(lat, lng));
      // Filtruj skoki GPS > 50m/s (błędy GPS)
      if (dist < 50) this.distanceM += dist;
    }

    this.coords.push(newCoord);
    this.polyline?.addLatLng(L.latLng(lat, lng));

    if (this.dotMarker) {
      this.dotMarker.setLatLng([lat, lng]);
    } else {
      this.dotMarker = L.circleMarker([lat, lng], {
        radius: 9, color: '#fff', fillColor: SPORT_COLORS[this.sport],
        fillOpacity: 1, weight: 2.5,
      }).addTo(this.map);
    }

    this.map.panTo([lat, lng], { animate: true, duration: 0.8 });
    this.onUpdate(this._buildStats());
  }

  private _buildStats(): TrackerStats {
    const elapsed    = (Date.now() - this.startTime - this.pausedTime);
    const durationSec = Math.floor(elapsed / 1000);
    const distanceKm  = this.distanceM / 1000;
    const durationMin = durationSec / 60;
    const paceMinKm   = distanceKm > 0.01 ? durationMin / distanceKm : 0;
    const speedKmH    = durationMin > 0    ? distanceKm / (durationMin / 60) : 0;
    return { distanceKm, durationSec, paceMinKm, speedKmH, coords: this.coords };
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
