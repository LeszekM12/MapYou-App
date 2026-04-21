// ─── LIVE MAP ─────────────────────────────────────────────────────────────────
// src/modules/LiveMap.ts
//
// Renderuje trasę znajomego w czasie rzeczywistym na mapie Leaflet.
// Polluje backend co POLL_INTERVAL_MS i aktualizuje mapę.

import { BACKEND_URL } from '../config.js';

// ── Typy ─────────────────────────────────────────────────────────────────────

export type SessionStatus = 'running' | 'paused' | 'finished' | 'not_found';

export interface LiveData {
  token:     string;
  userName:  string;
  session:   SessionStatus;
  startedAt: number;
  updatedAt: number;
  current:   { lat: number; lng: number; speed: number; timestamp: number } | null;
  history:   Array<{ lat: number; lng: number; speed: number; timestamp: number }>;
}

// ── Stałe ─────────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 5_000;   // odświeżaj co 5 sekund
const ROUTE_COLOR      = '#00c46a';

// ── LiveMap class ─────────────────────────────────────────────────────────────

export class LiveMap {
  private _map:        L.Map | null        = null;
  private _polyline:   L.Polyline | null   = null;
  private _marker:     L.CircleMarker | null = null;
  private _token:      string | null       = null;
  private _pollTimer:  ReturnType<typeof setInterval> | null = null;
  private _onStatus:   ((data: LiveData) => void) | null = null;
  private _container:  HTMLElement | null  = null;

  /** Inicjalizuje mapę w podanym kontenerze */
  init(container: HTMLElement, onStatus: (data: LiveData) => void): void {
    this._container = container;
    this._onStatus  = onStatus;

    // Inicjalizuj mapę Leaflet
    this._map = L.map(container, {
      zoomControl:       true,
      attributionControl: false,
    }).setView([52, 19], 13);

    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap',
    }).addTo(this._map);

    // Polyline dla trasy
    this._polyline = L.polyline([], {
      color:   ROUTE_COLOR,
      weight:  5,
      opacity: 0.9,
    }).addTo(this._map);
  }

  /** Zacznij oglądać trasę danego tokenu */
  watch(token: string): void {
    this._token = token;
    this._stopPolling();
    void this._poll();  // natychmiastowe pobranie
    this._pollTimer = setInterval(() => void this._poll(), POLL_INTERVAL_MS);
  }

  /** Zatrzymaj polling */
  stop(): void {
    this._stopPolling();
    this._token = null;
  }

  /** Zniszcz mapę */
  destroy(): void {
    this._stopPolling();
    if (this._map) { this._map.remove(); this._map = null; }
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _stopPolling(): void {
    if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
  }

  private async _poll(): Promise<void> {
    if (!this._token || !this._map) return;
    try {
      const res  = await fetch(`${BACKEND_URL}/live/${this._token}`);
      if (!res.ok) {
        this._onStatus?.({ token: this._token, userName: '?', session: 'not_found', startedAt: 0, updatedAt: 0, current: null, history: [] });
        return;
      }
      const data = await res.json() as LiveData;
      this._onStatus?.(data);
      this._updateMap(data);

      // Zatrzymaj polling jeśli sesja zakończona
      if (data.session === 'finished') this._stopPolling();

    } catch (err) {
      console.warn('[LiveMap] poll error:', err);
    }
  }

  private _updateMap(data: LiveData): void {
    if (!this._map || !this._polyline) return;

    // Aktualizuj trasę
    const latLngs = data.history.map(p => L.latLng(p.lat, p.lng));
    this._polyline.setLatLngs(latLngs);

    // Aktualizuj marker aktualnej pozycji
    if (data.current) {
      const pos = L.latLng(data.current.lat, data.current.lng);

      if (!this._marker) {
        // Utwórz marker przy pierwszej pozycji
        this._marker = L.circleMarker(pos, {
          radius:      10,
          color:       '#fff',
          fillColor:   ROUTE_COLOR,
          fillOpacity: 1,
          weight:      3,
        }).addTo(this._map);
      } else {
        this._marker.setLatLng(pos);
      }

      // Centruj mapę na aktualnej pozycji (tylko jeśli sesja aktywna)
      if (data.session === 'running') {
        this._map.panTo(pos, { animate: true, duration: 0.8 });
      }
    }

    // Dopasuj widok do trasy jeśli jest historia
    if (latLngs.length > 1 && !this._marker) {
      this._map.fitBounds(this._polyline.getBounds(), { padding: [40, 40] });
    }
  }

  /** Odśwież rozmiar mapy (po pokazaniu kontenera) */
  invalidateSize(): void {
    this._map?.invalidateSize();
  }
}
