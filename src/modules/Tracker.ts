// ─── TRACKER MODULE ──────────────────────────────────────────────────────────
// src/modules/Tracker.ts

import type { Coords } from '../types/index.js';

export type SportType = 'running' | 'walking' | 'cycling';

export interface TrackerStats {
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;   // min/km (running/walking)
  speedKmH:    number;   // km/h   (cycling)
  coords:      Coords[];
}

export interface ActivityRecord {
  id:          string;
  sport:       SportType;
  date:        string;        // ISO
  distanceKm:  number;
  durationSec: number;
  paceMinKm:   number;
  speedKmH:    number;
  coords:      Coords[];
  description: string;
}

type OnUpdate = (stats: TrackerStats) => void;

const SPORT_ICONS: Record<SportType, string> = {
  running: '🏃',
  walking: '🚶',
  cycling: '🚴',
};

export class Tracker {
  private map:          L.Map;
  private sport:        SportType = 'running';
  private coords:       Coords[]  = [];
  private polyline:     L.Polyline | null = null;
  private dotMarker:    L.CircleMarker | null = null;
  private watchId:      number | null = null;
  private startTime:    number  = 0;
  private timerInterval:ReturnType<typeof setInterval> | null = null;
  private distanceM:    number  = 0;
  private onUpdate:     OnUpdate;
  private active:       boolean = false;

  constructor(map: L.Map, onUpdate: OnUpdate) {
    this.map      = map;
    this.onUpdate = onUpdate;
  }

  get isActive(): boolean { return this.active; }
  get currentSport(): SportType { return this.sport; }

  setSport(sport: SportType): void {
    this.sport = sport;
  }

  // ── Start ───────────────────────────────────────────────────────────────────

  start(): void {
    if (this.active) return;
    this.active    = true;
    this.coords    = [];
    this.distanceM = 0;
    this.startTime = Date.now();

    // Rysuj pustą linię
    this.polyline = L.polyline([], {
      color:   '#00c46a',
      weight:  5,
      opacity: 0.9,
    }).addTo(this.map);

    // GPS watch
    this.watchId = navigator.geolocation.watchPosition(
      pos => this._onPosition(pos),
      err => console.warn('[Tracker] GPS error:', err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 },
    );

    // Timer co 1s
    this.timerInterval = setInterval(() => {
      this.onUpdate(this._buildStats());
    }, 1000);
  }

  // ── Stop — zwraca ActivityRecord gotowy do zapisu ───────────────────────────

  stop(): ActivityRecord | null {
    if (!this.active) return null;
    this.active = false;

    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.dotMarker) {
      this.map.removeLayer(this.dotMarker);
      this.dotMarker = null;
    }

    const stats = this._buildStats();
    const now   = new Date().toISOString();
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
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    if (this.polyline) {
      this.map.removeLayer(this.polyline);
      this.polyline = null;
    }
    if (this.dotMarker) {
      this.map.removeLayer(this.dotMarker);
      this.dotMarker = null;
    }
    this.coords    = [];
    this.distanceM = 0;
    this.active    = false;
  }

  // ── Rysuj zapisaną aktywność na mapie ───────────────────────────────────────

  drawActivity(activity: ActivityRecord): L.Polyline | null {
    if (!activity.coords.length) return null;
    const line = L.polyline(
      activity.coords.map(c => L.latLng(c[0], c[1])),
      { color: '#00c46a', weight: 5, opacity: 0.9 },
    ).addTo(this.map);
    this.map.fitBounds(line.getBounds(), { padding: [40, 40] });
    return line;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _onPosition(pos: GeolocationPosition): void {
    const { latitude: lat, longitude: lng } = pos.coords;
    const newCoord: Coords = [lat, lng];

    if (this.coords.length > 0) {
      const prev = this.coords[this.coords.length - 1];
      this.distanceM += L.latLng(prev[0], prev[1]).distanceTo(L.latLng(lat, lng));
    }

    this.coords.push(newCoord);
    this.polyline?.addLatLng(L.latLng(lat, lng));

    // Przesuń kropkę aktualnej pozycji
    if (this.dotMarker) {
      this.dotMarker.setLatLng([lat, lng]);
    } else {
      this.dotMarker = L.circleMarker([lat, lng], {
        radius:      8,
        color:       '#fff',
        fillColor:   '#00c46a',
        fillOpacity: 1,
        weight:      2,
      }).addTo(this.map);
    }

    this.map.panTo([lat, lng], { animate: true, duration: 0.5 });
    this.onUpdate(this._buildStats());
  }

  private _buildStats(): TrackerStats {
    const durationSec = Math.floor((Date.now() - this.startTime) / 1000);
    const distanceKm  = this.distanceM / 1000;
    const durationMin = durationSec / 60;

    const paceMinKm = distanceKm > 0.01 ? durationMin / distanceKm : 0;
    const speedKmH  = durationMin > 0    ? distanceKm / (durationMin / 60) : 0;

    return { distanceKm, durationSec, paceMinKm, speedKmH, coords: this.coords };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

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

export function formatDistance(km: number): string {
  return km.toFixed(2);
}
