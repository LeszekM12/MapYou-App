// ─── ROUTE PLANNER ───────────────────────────────────────────────────────────
/// <reference types="leaflet" />
import L from 'leaflet';
import { BACKEND_URL } from '../config.js';
import { Coords, ActivityMode, RouteResult } from '../types/index.js';
import { qidSafe, show, hide } from '../utils/dom.js';

const ACTIVITY_SPEEDS: Record<ActivityMode, number> = {
  [ActivityMode.Running]: 10,
  [ActivityMode.Cycling]: 20,
  [ActivityMode.Walking]: 5,
};

type OnRouteReady = (result: RouteResult) => void;

export class RoutePlanner {
  private map:           L.Map;
  private mode:          ActivityMode = ActivityMode.Running;
  private active:        boolean = false;
  private step:          0 | 1 | 2 | 3 = 0;
  private pointA:        Coords | null = null;
  private pointB:        Coords | null = null;
  private markerA:       L.Marker | null = null;
  private markerB:       L.Marker | null = null;
  private routeLine:     L.Polyline | null = null;
  private onRouteReady?: OnRouteReady;

  lastRouteCoords: Coords[] = [];
  lastRouteDist:   number   = 0;

  constructor(map: L.Map, onRouteReady?: OnRouteReady) {
    this.map          = map;
    this.onRouteReady = onRouteReady;
  }

  get isActive(): boolean     { return this.active; }
  get currentStep(): number   { return this.step; }
  get activityMode(): ActivityMode { return this.mode; }

  start(): void {
    this.active = true;
    this.step   = 1;
    this.pointA = null;
    this.pointB = null;

    hide(qidSafe('btnRoute'));
    show(qidSafe('routeInfo'));
    hide(qidSafe('routeResult'));

    const stepA = qidSafe('stepAText');
    const stepB = qidSafe('stepBText');
    if (stepA) stepA.textContent = 'Click the start point on the map';
    if (stepB) stepB.textContent = 'Click the end point on the map';

    this.map.getContainer().style.cursor = 'crosshair';
  }

  cancel(): void {
    this.active = false;
    this.step   = 0;
    this.pointA = null;
    this.pointB = null;

    if (this.markerA) { this.map.removeLayer(this.markerA); this.markerA = null; }
    if (this.markerB) { this.map.removeLayer(this.markerB); this.markerB = null; }
    if (this.routeLine) { this.map.removeLayer(this.routeLine); this.routeLine = null; }

    this.lastRouteCoords = [];
    this.lastRouteDist   = 0;

    show(qidSafe('btnRoute'));
    hide(qidSafe('routeInfo'));
    hide(qidSafe('routeResult'));
    hide(qidSafe('routeLoading'));

    this.map.getContainer().style.cursor = '';
  }

  handleClick(latlng: L.LatLng): void {
    if (!this.active) return;

    if (this.step === 1) {
      this.pointA = [latlng.lat, latlng.lng];
      this.step   = 2;

      if (this.markerA) this.map.removeLayer(this.markerA);
      this.markerA = L.marker(latlng, {
        icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28,28], iconAnchor: [14,14] }),
      }).addTo(this.map);

      const t = qidSafe('stepAText');
      if (t) { t.textContent = 'Start point set ✓'; t.closest('.route-info__step')?.classList.add('route-info__step--done'); }

    } else if (this.step === 2) {
      this.pointB = [latlng.lat, latlng.lng];
      this.step   = 3;

      if (this.markerB) this.map.removeLayer(this.markerB);
      this.markerB = L.marker(latlng, {
        icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--b">B</div>', iconSize: [28,28], iconAnchor: [14,14] }),
      }).addTo(this.map);

      const t = qidSafe('stepBText');
      if (t) { t.textContent = 'End point set ✓'; t.closest('.route-info__step')?.classList.add('route-info__step--done'); }

      void this.draw();
    }
  }

  setPointA(coords: Coords): void {
    if (!this.active) this.start();
    this.pointA = coords;
    this.step   = 2;
    if (this.markerA) this.map.removeLayer(this.markerA);
    this.markerA = L.marker(L.latLng(coords[0], coords[1]), {
      icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize:[28,28], iconAnchor:[14,14] }),
    }).addTo(this.map);
    const t = qidSafe('stepAText');
    if (t) t.textContent = 'Start point set ✓';
    this.map.setView(coords, 15);
  }

  setMode(mode: ActivityMode): void {
    this.mode = mode;
  }

  private async draw(): Promise<void> {
    if (!this.pointA || !this.pointB) return;

    show(qidSafe('routeLoading'));
    hide(qidSafe('routeResult'));
    if (this.routeLine) { this.map.removeLayer(this.routeLine); this.routeLine = null; }

    const [aLat, aLng] = this.pointA;
    const [bLat, bLng] = this.pointB;

    const profile =
      this.mode === ActivityMode.Cycling ? 'cycling' :
      this.mode === ActivityMode.Walking ? 'walking' : 'walking';

    // Use backend proxy — token never exposed to frontend
    const url = `${BACKEND_URL}/directions/${profile}/${aLng},${aLat};${bLng},${bLat}`;

    try {
      const res  = await fetch(url);
      const data = await res.json() as {
        routes?: Array<{ distance: number; duration: number; geometry: { coordinates: number[][] } }>;
      };

      if (!data.routes?.length) throw new Error('No route found');
      const route = data.routes[0];

      this.lastRouteDist   = route.distance;
      this.lastRouteCoords = route.geometry.coordinates.map(c => [c[1], c[0]] as Coords);

      const distKm = (route.distance / 1000).toFixed(2);
      const mins   = Math.round((parseFloat(distKm) / ACTIVITY_SPEEDS[this.mode]) * 60);

      const rDist = qidSafe('routeDist');
      const rTime = qidSafe('routeTime');
      if (rDist) rDist.textContent = distKm;
      if (rTime) rTime.textContent = String(mins);

      hide(qidSafe('routeLoading'));
      show(qidSafe('routeResult'));

      const latLngs = this.lastRouteCoords.map(coord => L.latLng(coord[0], coord[1]));
      this.routeLine = L.polyline(latLngs, {
        color:   '#00c46a',
        weight:  6,
        opacity: 0.85,
      }).addTo(this.map);
      this.map.fitBounds(this.routeLine.getBounds(), { padding: [40, 40] });

      this.onRouteReady?.({ distKm: parseFloat(distKm), timeMin: mins, coords: this.lastRouteCoords });

    } catch {
      hide(qidSafe('routeLoading'));
      const rDist = qidSafe('routeDist');
      const rTime = qidSafe('routeTime');
      if (rDist) rDist.textContent = 'Error';
      if (rTime) rTime.textContent = '—';
      show(qidSafe('routeResult'));
    }
  }

  initControls(onStart?: () => void, onCancel?: () => void): void {
    qidSafe('btnRoute')?.addEventListener('click', () => {
      this.start();
      onStart?.();
    });
    qidSafe('btnCancelRoute')?.addEventListener('click', () => {
      this.cancel();
      onCancel?.();
    });

    document.querySelectorAll<HTMLElement>('.route-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.route-mode-btn').forEach(b => b.classList.remove('route-mode-btn--active'));
        btn.classList.add('route-mode-btn--active');
        this.setMode(btn.dataset.mode as ActivityMode);
      });
    });
  }
}
