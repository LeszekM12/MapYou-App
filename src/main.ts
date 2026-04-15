/**
 * main.ts — Mapty TypeScript
 * Exact 1:1 translation of script.js.
 * Only types added — zero logic changes.
 */



import { Workout, Running, Cycling, Walking } from './models/Workout.js';
import { WorkoutType } from './types/index.js';
import type { Coords } from './types/index.js';
import {
  NetState, showSkeleton, startMapTimeout,
  initOnlineDetector, initRetryBtn,
} from './modules/OfflineDetector.js';
import { initWeatherWidget } from './modules/WeatherWidget.js';
import {
  loadWorkoutsFromDB, saveWorkoutToDB, deleteWorkoutFromDB,
  clearAllWorkoutsFromDB, migrateLocalStorageToIndexedDB,
} from './modules/db.js';
import { initPushNotifications, testPushNotification } from './modules/PushNotifications.js';

// ─── Leaflet plugin types ─────────────────────────────────────────────────────

interface MarkerClusterGroup extends L.FeatureGroup {
  addLayer(l: L.Layer): this;
  removeLayer(l: L.Layer): this;
}
interface LeafletWithCluster {
  markerClusterGroup(opts?: object): MarkerClusterGroup;
}

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}

// ─── DOM refs (module-level, identical to script.js) ─────────────────────────

const form             = document.querySelector<HTMLFormElement>('.form')!;
const containerWorkouts= document.querySelector<HTMLElement>('.workouts')!;
const inputType        = document.querySelector<HTMLSelectElement>('.form__input--type')!;
const inputDistance    = document.querySelector<HTMLInputElement>('.form__input--distance')!;
const inputDuration    = document.querySelector<HTMLInputElement>('.form__input--duration')!;
const inputCadence     = document.querySelector<HTMLInputElement>('.form__input--cadence')!;
const inputElevation   = document.querySelector<HTMLInputElement>('.form__input--elevation')!;
const btnRoute         = document.getElementById('btnRoute')!;
const routeInfo        = document.getElementById('routeInfo')!;
const btnCancelRoute   = document.getElementById('btnCancelRoute')!;
const stepAText        = document.getElementById('stepAText')!;
const stepBText        = document.getElementById('stepBText')!;
const routeResult      = document.getElementById('routeResult')!;
const routeDist        = document.getElementById('routeDist')!;
const routeTime        = document.getElementById('routeTime')!;
const routeLoading     = document.getElementById('routeLoading')!;
const btnTrack         = document.getElementById('btnTrack')!;

const TILES = {
  day:   'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
  night: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const TILE_ATTR = {
  day:   '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  night: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
};

// ─── App class ────────────────────────────────────────────────────────────────

class App {
  #map!: L.Map;
  #tileLayer: L.TileLayer | null = null;
  #mapZoomLevel = 13;
  #mapEvent!: L.LeafletMouseEvent;
  #workouts: Workout[] = [];

  #routeMode = false;
  #routeStep = 0;
  #routePointA: Coords | null = null;
  #routePointB: Coords | null = null;
  #routingControl: L.Control | null = null;
  #routeMarkerA: L.Marker | null = null;
  #routeMarkerB: L.Marker | null = null;
  #routeActivityMode = 'running';

  #routeCoords: Coords[] = [];
  #routeTotalDist = 0;
  #progressLine: L.Polyline | null = null;
  #progressWatchId: number | null = null;
  #coveredUpToIndex = 0;
  #arrivedShown = false;
  #nearDestCount = 0;
  static readonly #ARRIVAL_CONSEC = 3;
  static readonly #ARRIVAL_DIST   = 20;

  #voiceEnabled    = false;
  #voiceKmAnnounced= 0;
  #voiceStartTime: number | null = null;
  #voiceDistCovered= 0;

  #trackingActive        = false;
  #watchId: number | null= null;
  #trackingMarker: L.Marker | null = null;
  #trackingCoords: Coords | null   = null;
  #prevTrackingCoords: Coords | null = null;

  #userTouchingMap = false;
  #recenterTimer: ReturnType<typeof setTimeout> | null = null;

  #nightMode = false;
  #wakeLock: WakeLockSentinel | null = null;
  #deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

  #markers      = new Map<string, L.Marker>();
  #clusterGroup: MarkerClusterGroup | null = null;
  #clusterEnabled = localStorage.getItem('clusterEnabled') === 'true';
  #poiMarkers:  L.Marker[] = [];
  #userCoords:  Coords | null = null;
  #autocompleteTimer: ReturnType<typeof setTimeout> | null = null;
  #filterDrag = { active: false, startX: 0, scrollLeft: 0 };

  #activitySpeeds: Record<string, number> = { running: 10, cycling: 20, walking: 5 };

  #activeWorkoutId: string | null = null;
  #workoutRouteLayer: L.Polyline | null = null;

  #customFilters: Array<{ name: string; emoji: string; coords: Coords; address: string }> =
    JSON.parse(localStorage.getItem('customFilters') ?? '[]');
  #pinnedCoord: Coords | null = null;

  #goalKm    = +(localStorage.getItem('goalKm')    ?? 35);
  #goalTime  = +(localStorage.getItem('goalTime')  ?? 300);
  #goalCount = +(localStorage.getItem('goalCount') ?? 7);
  #statsExpanded        = false;
  #statsWeekOffset      = 0;
  #statsSelectedDay:    number | null = null;
  #statsPrevGoalReached = false;

  constructor() {
    this._getPosition();
    void this._getLocalStorage();

    form.addEventListener('submit', this._newWorkout.bind(this));
    inputType.addEventListener('change', this._toggleElevationField);
    containerWorkouts.addEventListener('click', this._moveToPopup.bind(this));
    btnRoute.addEventListener('click', this._startRouteMode.bind(this));
    btnCancelRoute.addEventListener('click', this._cancelRoute.bind(this));
    btnTrack.addEventListener('click', this._toggleTracking.bind(this));

    document.querySelectorAll<HTMLElement>('.route-mode-btn').forEach(btn =>
      btn.addEventListener('click', this._setActivityMode.bind(this))
    );

    this._initPOISearch();
    this._initSettings();
    this._initFilterScroll();
    this._initPWAInstall();
    this._initStats();
    this._initIOSBanner();
    this._initCustomFilters();

    if (localStorage.getItem('nightMode') === 'true') {
      this.#nightMode = true;
      document.body.classList.add('night-mode');
      document.getElementById('nightToggle')?.classList.add('active');
    }
    if (localStorage.getItem('voiceStats') === 'true') {
      this.#voiceEnabled = true;
      document.getElementById('voiceToggle')?.classList.add('active');
    }
  }

  // ── GEOLOCATION ───────────────────────────────────────────────────────────

  _getPosition(): void {
    if (navigator.geolocation)
      navigator.geolocation.getCurrentPosition(
        this._loadMap.bind(this),
        () => alert('Could not get your position'),
      );
  }

  _loadMap(position: GeolocationPosition): void {
    const { latitude, longitude } = position.coords;
    const coords: Coords = [latitude, longitude];
    this.#userCoords = coords;

    this.#map = L.map('map').setView(coords, this.#mapZoomLevel);

    this.#map.createPane('progressPane');
    const pane = this.#map.getPane('progressPane');
    if (pane) pane.style.zIndex = '650';

    const tileKey = this.#nightMode ? 'night' : 'day';
    this.#tileLayer = L.tileLayer(TILES[tileKey], { attribution: TILE_ATTR[tileKey] }).addTo(this.#map);

    this.#map.on('click', this._handleMapClick.bind(this));

    this.#tileLayer.once('load', () => {
      NetState.mapReady   = true;
      NetState.retryCount = 0;
      if (NetState.timeoutId) clearTimeout(NetState.timeoutId);
      document.getElementById('mapSkeleton')?.classList.add('hidden');
      document.getElementById('skeletonMsg')?.classList.add('hidden');
    });

    if (this.#clusterEnabled) {
      this.#clusterGroup = (L as unknown as LeafletWithCluster).markerClusterGroup({
        maxClusterRadius: 60,
        iconCreateFunction: (cluster: { getChildCount: () => number }) => {
          const count = cluster.getChildCount();
          return L.divIcon({
            html: `<div class="workout-cluster"><span>${count}</span></div>`,
            className: '', iconSize: [40, 40], iconAnchor: [20, 20],
          });
        },
      });
      this.#map.addLayer(this.#clusterGroup);
    }
    this.#workouts.forEach(w => this._renderWorkoutMarker(w));

    this.#map.on('mousedown touchstart', () => {
      this.#userTouchingMap = true;
      if (this.#recenterTimer) clearTimeout(this.#recenterTimer);
    });
    this.#map.on('mouseup touchend', () => {
      this.#recenterTimer = setTimeout(() => { this.#userTouchingMap = false; }, 5000);
    });
    void initPushNotifications();
  }

  // ── SETTINGS ──────────────────────────────────────────────────────────────

  _initSettings(): void {
    const btnGear     = document.getElementById('btnSettings')!;
    const panel       = document.getElementById('settingsPanel')!;
    const btnBack     = document.getElementById('btnSettingsBack')!;
    const itemShare   = document.getElementById('settingShare')!;
    const itemNight   = document.getElementById('settingNight')!;
    const nightToggle = document.getElementById('nightToggle');
    const itemVoice   = document.getElementById('settingVoice')!;
    const voiceToggle = document.getElementById('voiceToggle');
    const itemClear   = document.getElementById('settingClear')!;
    const itemInstall = document.getElementById('settingInstall');

    btnGear.addEventListener('click', e => { e.stopPropagation(); panel.classList.toggle('hidden'); });
    btnBack.addEventListener('click', () => panel.classList.add('hidden'));

    document.addEventListener('click', (e: MouseEvent) => {
      if (!panel.classList.contains('hidden') &&
        !panel.contains(e.target as Node) &&
        e.target !== btnGear)
        panel.classList.add('hidden');
    });

    itemShare.addEventListener('click', () => void this._shareLocation());
    itemNight.addEventListener('click', () => this._toggleNightMode());
    nightToggle?.addEventListener('click', e => { e.stopPropagation(); this._toggleNightMode(); });
    itemVoice.addEventListener('click', () => this._toggleVoice());
    voiceToggle?.addEventListener('click', e => { e.stopPropagation(); this._toggleVoice(); });

    itemClear.addEventListener('click', () => {
      if (confirm('Delete all workouts?')) { void clearAllWorkoutsFromDB().then(() => location.reload()); }
    });

    itemInstall?.addEventListener('click', () => {
      if (this.#deferredInstallPrompt) {
        void this.#deferredInstallPrompt.prompt();
        void this.#deferredInstallPrompt.userChoice.then(() => {
          this.#deferredInstallPrompt = null;
          if (itemInstall) itemInstall.style.display = 'none';
        });
      }
    });

    const clusterToggle = document.getElementById('clusterToggle');
    if (this.#clusterEnabled) clusterToggle?.classList.add('active');
    const doToggleCluster = (): void => {
      this.#clusterEnabled = !this.#clusterEnabled;
      localStorage.setItem('clusterEnabled', String(this.#clusterEnabled));
      clusterToggle?.classList.toggle('active', this.#clusterEnabled);
      location.reload();
    };
    document.getElementById('settingCluster')?.addEventListener('click', doToggleCluster);
    clusterToggle?.addEventListener('click', e => { e.stopPropagation(); doToggleCluster(); });
  }

  _initPWAInstall(): void {
    window.addEventListener('beforeinstallprompt', (e: Event) => {
      e.preventDefault();
      this.#deferredInstallPrompt = e as BeforeInstallPromptEvent;
      const item = document.getElementById('settingInstall');
      if (item) item.style.display = 'flex';
    });
  }

  _toggleNightMode(): void {
    this.#nightMode = !this.#nightMode;
    document.body.classList.toggle('night-mode', this.#nightMode);
    document.getElementById('nightToggle')?.classList.toggle('active', this.#nightMode);
    localStorage.setItem('nightMode', String(this.#nightMode));
    if (this.#map && this.#tileLayer) {
      this.#map.removeLayer(this.#tileLayer);
      const key = this.#nightMode ? 'night' : 'day';
      this.#tileLayer = L.tileLayer(TILES[key], { attribution: TILE_ATTR[key] }).addTo(this.#map);
    }
  }

  // ── VOICE ─────────────────────────────────────────────────────────────────

  _toggleVoice(): void {
    this.#voiceEnabled = !this.#voiceEnabled;
    document.getElementById('voiceToggle')?.classList.toggle('active', this.#voiceEnabled);
    localStorage.setItem('voiceStats', String(this.#voiceEnabled));
    if (this.#voiceEnabled) this._speak('Voice stats enabled.');
  }

  _speak(text: string): void {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'pl-PL'; utt.rate = 1.0; utt.pitch = 1.0;
    window.speechSynthesis.speak(utt);
  }

  _updateVoiceStats(lat: number, lng: number): void {
    if (!this.#voiceEnabled || !this.#trackingActive) return;
    if (!this.#voiceStartTime) {
      this.#voiceStartTime = Date.now();
      this.#voiceDistCovered = 0; this.#voiceKmAnnounced = 0;
      this.#prevTrackingCoords = [lat, lng]; return;
    }
    if (this.#prevTrackingCoords) {
      const seg = this._haversine(this.#prevTrackingCoords, [lat, lng]);
      if (seg < 100) this.#voiceDistCovered += seg;
    }
    this.#prevTrackingCoords = [lat, lng];
    const km = this.#voiceDistCovered / 1000;
    const next = this.#voiceKmAnnounced + 1;
    if (km >= next) {
      this.#voiceKmAnnounced = next;
      const elapsed = (Date.now() - this.#voiceStartTime!) / 60000;
      const pace = elapsed / km;
      const pm = Math.floor(pace), ps = Math.round((pace - pm) * 60);
      this._speak(
        `Pokonałeś ${next} ${next === 1 ? 'kilometr' : next < 5 ? 'kilometry' : 'kilometrów'}. ` +
        `Średnie tempo: ${pm} minut ${ps < 10 ? '0' + ps : ps} sekund na kilometr.`,
      );
    }
  }

  _resetVoiceStats(): void {
    this.#voiceKmAnnounced = 0; this.#voiceDistCovered = 0;
    this.#voiceStartTime = null; this.#prevTrackingCoords = null;
  }

  // ── SHARE ─────────────────────────────────────────────────────────────────

  async _shareLocation(): Promise<void> {
    const coords = this.#trackingCoords ?? this.#userCoords;
    if (!coords) { alert('Location not available yet. Start tracking first.'); return; }
    const [lat, lng] = coords;
    const url = `https://www.google.com/maps?q=${lat},${lng}`;
    if (navigator.share) {
      try { await navigator.share({ title: 'My location — Mapty', text: 'Here is my current location:', url }); return; }
      catch { /* cancelled */ }
    }
    try { await navigator.clipboard.writeText(url); this._showToast('📋 Link copied to clipboard!'); }
    catch { prompt('Copy this link:', url); }
  }

  _showToast(message: string): void {
    document.querySelector('.arrival-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'arrival-toast';
    toast.style.borderLeftColor = '#ffb545';
    toast.innerHTML = `<span class="arrival-toast__icon">📤</span><div><strong>${message}</strong></div><button class="arrival-toast__close">✕</button>`;
    document.body.appendChild(toast);
    toast.querySelector<HTMLButtonElement>('.arrival-toast__close')!.addEventListener('click', () => toast.remove());
    setTimeout(() => toast?.remove(), 4000);
  }

  // ── FILTER DRAG ───────────────────────────────────────────────────────────

  _initFilterScroll(): void {
    const el = document.getElementById('poiFilters'); if (!el) return;
    el.addEventListener('mousedown', (e: MouseEvent) => {
      this.#filterDrag = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    });
    el.addEventListener('mouseleave', () => { this.#filterDrag.active = false; });
    el.addEventListener('mouseup',    () => { this.#filterDrag.active = false; });
    el.addEventListener('mousemove', (e: MouseEvent) => {
      if (!this.#filterDrag.active) return;
      e.preventDefault();
      el.scrollLeft = this.#filterDrag.scrollLeft - (e.pageX - el.offsetLeft - this.#filterDrag.startX);
    });
  }

  // ── WAKE LOCK ─────────────────────────────────────────────────────────────

  async _requestWakeLock(): Promise<void> {
    if (!('wakeLock' in navigator)) return;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
      this._updateWakeLockBadge(true);
    } catch { /* not available */ }
  }

  async _releaseWakeLock(): Promise<void> {
    if (!this.#wakeLock) return;
    try { await this.#wakeLock.release(); } catch { /* ignore */ }
    this.#wakeLock = null;
    document.removeEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
    this._updateWakeLockBadge(false);
  }

  async _handleVisibilityChange(): Promise<void> {
    if (this.#wakeLock !== null && document.visibilityState === 'visible' && this.#trackingActive)
      await this._requestWakeLock();
  }

  _updateWakeLockBadge(active: boolean): void {
    let badge = btnTrack.querySelector<HTMLElement>('.wake-lock-badge');
    if (active) {
      if (!badge) { badge = document.createElement('span'); badge.className = 'wake-lock-badge'; badge.textContent = 'SCREEN ON'; btnTrack.appendChild(badge); }
    } else { badge?.remove(); }
  }

  // ── TRACKING ──────────────────────────────────────────────────────────────

  _toggleTracking(): void {
    if (this.#trackingActive) this._stopTracking(); else this._startTracking();
  }

  _startTracking(): void {
    if (!navigator.geolocation) return;
    this.#trackingActive = true;
    btnTrack.textContent = '⏹ Stop tracking';
    btnTrack.classList.add('tracking--active');
    void this._requestWakeLock();
    this._resetVoiceStats();

    const dotIcon = L.divIcon({
      className: '',
      html: `<div class="tracking-dot"><div class="tracking-dot__pulse"></div><div class="tracking-dot__core"></div></div>`,
      iconSize: [18, 18], iconAnchor: [9, 9],
    });

    this.#watchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude: lat, longitude: lng } = position.coords;
        const latlng: Coords = [lat, lng];
        this.#trackingCoords = latlng;
        if (!this.#trackingMarker) {
          this.#trackingMarker = L.marker(latlng, { icon: dotIcon, zIndexOffset: 1000 }).addTo(this.#map);
          this.#map.setView(latlng, this.#mapZoomLevel, { animate: true });
        } else {
          this.#trackingMarker.setLatLng(latlng);
          if (!this.#userTouchingMap) {
            const mp = this.#map.latLngToContainerPoint(L.latLng(latlng));
            const cp = this.#map.getSize().divideBy(2);
            if (mp.distanceTo(cp) > 120)
              this.#map.setView(latlng, this.#map.getZoom(), { animate: true, duration: 0.6 });
          }
        }
        if (this.#routeCoords.length > 0 && this.#progressLine) this._updateRouteProgress(lat, lng);
        this._updateVoiceStats(lat, lng);
      },
      () => { alert('Could not get your position for tracking.'); this._stopTracking(); },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );
  }

  _stopTracking(): void {
    this.#trackingActive = false; this.#trackingCoords = null;
    btnTrack.textContent = '📍 Start tracking';
    btnTrack.classList.remove('tracking--active');
    void this._releaseWakeLock();
    this._resetVoiceStats();
    if (this.#watchId !== null) { navigator.geolocation.clearWatch(this.#watchId); this.#watchId = null; }
    if (this.#trackingMarker) { this.#map.removeLayer(this.#trackingMarker); this.#trackingMarker = null; }
  }

  // ── ROUTE PROGRESS ────────────────────────────────────────────────────────

  _setupRouteProgress(routeCoords: Coords[], totalDistM: number): void {
    this.#routeCoords = routeCoords; this.#routeTotalDist = totalDistM;
    this.#coveredUpToIndex = 0; this.#arrivedShown = false; this.#nearDestCount = 0;
    if (this.#progressLine) { this.#map.removeLayer(this.#progressLine); this.#progressLine = null; }
    this.#progressLine = L.polyline([], {
      color: '#a0a0a0', weight: 7, opacity: 1,
      lineJoin: 'round', lineCap: 'round', pane: 'progressPane',
    } as L.PolylineOptions).addTo(this.#map);
    if (!this.#trackingActive) this._startProgressOnlyWatch();
  }

  _startProgressOnlyWatch(): void {
    this.#progressWatchId = navigator.geolocation.watchPosition(
      pos => {
        if (!this.#routeCoords.length) { if (this.#progressWatchId !== null) navigator.geolocation.clearWatch(this.#progressWatchId); return; }
        this._updateRouteProgress(pos.coords.latitude, pos.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }

  _updateRouteProgress(lat: number, lng: number): void {
    const userPt = L.latLng(lat, lng);
    let closestIdx = this.#coveredUpToIndex, minDist = Infinity;
    for (let i = this.#coveredUpToIndex; i < this.#routeCoords.length; i++) {
      const d = userPt.distanceTo(L.latLng(this.#routeCoords[i]));
      if (d < minDist) { minDist = d; closestIdx = i; }
      if (d > minDist + 200 && i > this.#coveredUpToIndex + 15) break;
    }
    if (closestIdx > this.#coveredUpToIndex && minDist < 40) {
      this.#coveredUpToIndex = closestIdx;
      this.#progressLine!.setLatLngs(this.#routeCoords.slice(0, this.#coveredUpToIndex + 1));
      this._updateRemainingStats();
    }
    const lastPt = L.latLng(this.#routeCoords[this.#routeCoords.length - 1]);
    if (userPt.distanceTo(lastPt) < App.#ARRIVAL_DIST) this.#nearDestCount++;
    else this.#nearDestCount = 0;
    if (this.#nearDestCount >= App.#ARRIVAL_CONSEC && !this.#arrivedShown) {
      this.#arrivedShown = true; this._showArrivalToast();
      if (this.#voiceEnabled) this._speak('Dotarłeś na miejsce. Cel osiągnięty!');
    }
  }

  _updateRemainingStats(): void {
    if (!this.#routeCoords.length) return;
    let remainM = 0;
    for (let i = this.#coveredUpToIndex; i < this.#routeCoords.length - 1; i++)
      remainM += L.latLng(this.#routeCoords[i]).distanceTo(L.latLng(this.#routeCoords[i + 1]));
    const rKm = remainM / 1000;
    routeDist.textContent = rKm.toFixed(2);
    routeTime.textContent = String(Math.max(0, Math.round((rKm / this.#activitySpeeds[this.#routeActivityMode]) * 60)));
  }

  _showArrivalToast(): void {
    document.querySelector('.arrival-toast')?.remove();
    const t = document.createElement('div'); t.className = 'arrival-toast';
    t.innerHTML = `<span class="arrival-toast__icon">🎯</span><div><strong>You've arrived!</strong><p>Destination reached.</p></div><button class="arrival-toast__close">✕</button>`;
    document.body.appendChild(t);
    t.querySelector<HTMLButtonElement>('.arrival-toast__close')!.addEventListener('click', () => t.remove());
    setTimeout(() => t?.remove(), 8000);
  }

  _stopRouteProgress(): void {
    if (this.#progressWatchId !== null) { navigator.geolocation.clearWatch(this.#progressWatchId); this.#progressWatchId = null; }
    if (this.#progressLine) { this.#map.removeLayer(this.#progressLine); this.#progressLine = null; }
    this.#routeCoords = []; this.#coveredUpToIndex = 0; this.#arrivedShown = false; this.#nearDestCount = 0;
    document.querySelector('.arrival-toast')?.remove();
  }

  // ── MAP CLICK ─────────────────────────────────────────────────────────────

  _handleMapClick(mapE: L.LeafletMouseEvent): void {
    this.#pinnedCoord = [mapE.latlng.lat, mapE.latlng.lng];
    if (this.#routeMode && this.#routeStep < 3) this._handleRouteClick(mapE);
    else this._showForm(mapE);
  }

  _showForm(mapE: L.LeafletMouseEvent): void {
    this.#mapEvent = mapE;
    if (window.innerWidth <= 768) this._showFormModal();
    else { form.classList.remove('hidden'); inputDistance.focus(); }
  }

  _showFormModal(): void {
    document.getElementById('workoutModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'workoutModal'; modal.className = 'workout-modal';
    modal.innerHTML = `
      <div class="workout-modal__box">
        <div class="workout-modal__title">Add Workout</div>
        <form class="workout-modal__form" id="workoutModalForm">
          <div class="workout-modal__row">
            <label class="workout-modal__label">Type</label>
            <select class="workout-modal__input workout-modal__select" id="wm-type">
              <option value="running">Running</option>
              <option value="cycling">Cycling</option>
              <option value="walking">Walking</option>
            </select>
          </div>
          <div class="workout-modal__row">
            <label class="workout-modal__label">Distance</label>
            <input class="workout-modal__input" id="wm-distance" type="number" placeholder="km" min="0" step="0.1"/>
          </div>
          <div class="workout-modal__row">
            <label class="workout-modal__label">Duration</label>
            <input class="workout-modal__input" id="wm-duration" type="number" placeholder="min" min="0" step="0.1"/>
          </div>
          <div class="workout-modal__row" id="wm-cadence-row">
            <label class="workout-modal__label">Cadence</label>
            <input class="workout-modal__input" id="wm-cadence" type="number" placeholder="step/min" min="0"/>
          </div>
          <div class="workout-modal__row hidden" id="wm-elev-row">
            <label class="workout-modal__label">Elev Gain</label>
            <input class="workout-modal__input" id="wm-elevation" type="number" placeholder="meters"/>
          </div>
          <div class="workout-modal__actions">
            <button type="button" class="workout-modal__btn workout-modal__btn--cancel" id="wmCancel">Cancel</button>
            <button type="submit" class="workout-modal__btn workout-modal__btn--save">✓ Add Workout</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(modal);

    const wmType    = document.getElementById('wm-type')     as HTMLSelectElement;
    const wmDist    = document.getElementById('wm-distance') as HTMLInputElement;
    const wmDur     = document.getElementById('wm-duration') as HTMLInputElement;
    const wmCad     = document.getElementById('wm-cadence')  as HTMLInputElement;
    const wmElev    = document.getElementById('wm-elevation')as HTMLInputElement;
    const wmCadRow  = document.getElementById('wm-cadence-row')!;
    const wmElevRow = document.getElementById('wm-elev-row')!;

    wmType.addEventListener('change', () => {
      if (wmType.value === 'cycling') { wmCadRow.classList.add('hidden'); wmElevRow.classList.remove('hidden'); }
      else { wmCadRow.classList.remove('hidden'); wmElevRow.classList.add('hidden'); }
    });
    document.getElementById('wmCancel')!.addEventListener('click', () => modal.remove());

    document.getElementById('workoutModalForm')!.addEventListener('submit', e => {
      e.preventDefault();
      const type = wmType.value as WorkoutType;
      const distance = +wmDist.value, duration = +wmDur.value;
      const { lat, lng } = this.#mapEvent.latlng;
      const validInputs = (...v: number[]) => v.every(n => Number.isFinite(n));
      const allPositive = (...v: number[]) => v.every(n => n > 0);
      let workout: Workout;
      if (type === WorkoutType.Running) {
        const cadence = +wmCad.value;
        if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence)) return void alert('Inputs have to be positive numbers!');
        workout = new Running([lat, lng], distance, duration, cadence);
      } else if (type === WorkoutType.Cycling) {
        const elevation = +wmElev.value;
        if (!validInputs(distance, duration, elevation) || !allPositive(distance, duration)) return void alert('Inputs have to be positive numbers!');
        workout = new Cycling([lat, lng], distance, duration, elevation);
      } else {
        const cadence = +wmCad.value;
        if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence)) return void alert('Inputs have to be positive numbers!');
        workout = new Walking([lat, lng], distance, duration, cadence);
      }
      modal.remove();
      this.#workouts.push(workout);
      if (this.#routeCoords?.length > 1) workout.routeCoords = [...this.#routeCoords];
      this.#activeWorkoutId = '__pending__';
      this._renderWorkoutMarker(workout);
      this._renderWorkout(workout);
      this._setLocalStorage();
      this._renderStats(true);
      this._renderStreak();
    });
    setTimeout(() => wmDist.focus(), 100);
  }

  _hideForm(): void {
    inputDistance.value = inputDuration.value = inputCadence.value = inputElevation.value = '';
    form.style.display = 'none'; form.classList.add('hidden');
    setTimeout(() => (form.style.display = 'grid'), 1000);
    document.querySelector<HTMLElement>('.tab-scroll')?.scrollTo({ top: 0 });
  }

  _toggleElevationField(): void {
    inputElevation.closest('.form__row')!.classList.toggle('form__row--hidden');
    inputCadence.closest('.form__row')!.classList.toggle('form__row--hidden');
  }

  // ── WORKOUT ───────────────────────────────────────────────────────────────

  _newWorkout(e: Event): void {
    const validInputs = (...v: number[]) => v.every(n => Number.isFinite(n));
    const allPositive = (...v: number[]) => v.every(n => n > 0);
    e.preventDefault();
    const type = inputType.value as WorkoutType;
    const distance = +inputDistance.value, duration = +inputDuration.value;
    const { lat, lng } = this.#mapEvent.latlng;
    let workout: Workout;

    if (type === WorkoutType.Running) {
      const cadence = +inputCadence.value;
      if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence)) return void alert('Inputs have to be positive numbers!');
      workout = new Running([lat, lng], distance, duration, cadence);
    } else if (type === WorkoutType.Cycling) {
      const elevation = +inputElevation.value;
      if (!validInputs(distance, duration, elevation) || !allPositive(distance, duration)) return void alert('Inputs have to be positive numbers!');
      workout = new Cycling([lat, lng], distance, duration, elevation);
    } else {
      const cadence = +inputCadence.value;
      if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence)) return void alert('Inputs have to be positive numbers!');
      workout = new Walking([lat, lng], distance, duration, cadence);
    }

    this.#workouts.push(workout);
    if (this.#routeCoords?.length > 1) workout.routeCoords = [...this.#routeCoords];
    this.#activeWorkoutId = '__pending__';
    this._renderWorkoutMarker(workout);
    this._renderWorkout(workout);
    this._hideForm();
    this._setLocalStorage();
    this._renderStats(true);
    this._renderStreak();
  }

  // ── MARKERS ───────────────────────────────────────────────────────────────

  _showMarker(marker: L.Marker): void {
    marker.setOpacity(1);
    const m = marker as unknown as { _icon?: HTMLElement; _shadow?: HTMLElement };
    if (m._icon)   m._icon.style.pointerEvents   = '';
    if (m._shadow) m._shadow.style.pointerEvents = '';
    setTimeout(() => {
      if (m._icon)   m._icon.style.pointerEvents   = '';
      if (m._shadow) m._shadow.style.pointerEvents = '';
    }, 0);
  }

  _hideMarker(marker: L.Marker): void {
    marker.setOpacity(0);
    marker.closePopup();
    setTimeout(() => {
      const m = marker as unknown as { _icon?: HTMLElement; _shadow?: HTMLElement };
      if (m._icon)   m._icon.style.pointerEvents   = 'none';
      if (m._shadow) m._shadow.style.pointerEvents = 'none';
    }, 0);
  }

  _renderWorkoutMarker(workout: Workout): void {
    const icon = workout.type === WorkoutType.Running ? '🏃‍♂️' : workout.type === WorkoutType.Cycling ? '🚴‍♀️' : '🚶';
    const popupClass = `${workout.type}-popup`;
    const target: L.Map | MarkerClusterGroup = this.#clusterGroup ?? this.#map;
    const marker = L.marker(workout.coords)
      .bindPopup(L.popup({ maxWidth: 250, minWidth: 100, autoClose: false, closeOnClick: false, className: popupClass }))
      .setPopupContent(`${icon} ${workout.description}`);
    target.addLayer(marker);
    this.#markers.set(workout.id, marker);

    if (this.#clusterEnabled) {
      this._showMarker(marker);
      if (this.#activeWorkoutId === '__pending__') { this.#activeWorkoutId = workout.id; marker.openPopup(); }
    } else {
      if (this.#activeWorkoutId === '__pending__') {
        this.#markers.forEach((m, id) => { if (id !== workout.id) this._hideMarker(m); });
        this._showMarker(marker); marker.openPopup(); this.#activeWorkoutId = workout.id;
      } else { this._hideMarker(marker); }
    }
  }

  // ── WORKOUT CARD ──────────────────────────────────────────────────────────

  _buildRouteThumbnail(routeCoords: Coords[] | null | undefined): string {
    if (!routeCoords || routeCoords.length < 2) return '';
    const lats = routeCoords.map(c => c[0]), lngs = routeCoords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
    const span = Math.max(maxLat - minLat || 0.002, maxLng - minLng || 0.002);
    let zoom = 15;
    if (span > 0.05) zoom = 13; else if (span > 0.02) zoom = 14; else if (span > 0.008) zoom = 15; else zoom = 16;
    const tileUrl = `https://tile.openstreetmap.org/${zoom}/${this._lngToTileX(cLng, zoom)}/${this._latToTileY(cLat, zoom)}.png`;
    const W = 80, H = 80, PAD = 4;
    const ranLat = maxLat - minLat || 0.001, ranLng = maxLng - minLng || 0.001;
    const toX = (lng: number) => PAD + ((lng - minLng) / ranLng) * (W - 2 * PAD);
    const toY = (lat: number) => (H - PAD) - ((lat - minLat) / ranLat) * (H - 2 * PAD);
    const step = Math.max(1, Math.floor(routeCoords.length / 60));
    const pts = routeCoords.filter((_, i) => i % step === 0)
      .map(c => `${toX(c[1]).toFixed(1)},${toY(c[0]).toFixed(1)}`).join(' ');
    return `<div class="workout__thumb-wrap">
      <img class="workout__thumb-map" src="${tileUrl}" crossorigin="anonymous" onerror="this.style.display='none'" alt=""/>
      <svg class="workout__thumb-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <polyline points="${pts}" fill="none" stroke="#00c46a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
      </svg>
    </div>`;
  }

  _lngToTileX(lng: number, zoom: number): number { return Math.floor((lng + 180) / 360 * Math.pow(2, zoom)); }
  _latToTileY(lat: number, zoom: number): number {
    const r = Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * Math.pow(2, zoom));
  }

  _renderWorkout(workout: Workout): void {
    const icon = workout.type === WorkoutType.Running ? '🏃‍♂️' : workout.type === WorkoutType.Cycling ? '🚴‍♀️' : '🚶';
    const thumb = this._buildRouteThumbnail(workout.routeCoords);
    let html = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <h2 class="workout__title">${workout.description}</h2>
        ${thumb ? `<div class="workout__thumb-container">${thumb}</div>` : ''}
        <div class="workout__details"><span class="workout__icon">${icon}</span><span class="workout__value">${workout.distance}</span><span class="workout__unit">km</span></div>
        <div class="workout__details"><span class="workout__icon">⏱</span><span class="workout__value">${workout.duration}</span><span class="workout__unit">min</span></div>`;

    if (workout instanceof Running || workout instanceof Walking)
      html += `
        <div class="workout__details"><span class="workout__icon">⚡️</span><span class="workout__value">${workout.pace.toFixed(1)}</span><span class="workout__unit">min/km</span></div>
        <div class="workout__details"><span class="workout__icon">🦶🏼</span><span class="workout__value">${workout.cadence}</span><span class="workout__unit">spm</span></div>
      </li>`;
    else if (workout instanceof Cycling)
      html += `
        <div class="workout__details"><span class="workout__icon">⚡️</span><span class="workout__value">${workout.speed.toFixed(1)}</span><span class="workout__unit">km/h</span></div>
        <div class="workout__details"><span class="workout__icon">⛰</span><span class="workout__value">${workout.elevationGain}</span><span class="workout__unit">m</span></div>
      </li>`;

    html = html.replace('</li>', `<button class="workout__delete" data-id="${workout.id}" title="Delete workout">✕</button></li>`);
    form.insertAdjacentHTML('afterend', html);
  }

  _moveToPopup(e: Event): void {
    if (!this.#map) return;
    const target = e.target as HTMLElement;
    const deleteBtn = target.closest<HTMLElement>('.workout__delete');
    if (deleteBtn) { e.stopPropagation(); this._deleteWorkout(deleteBtn.dataset.id!); return; }
    const workoutEl = target.closest<HTMLElement>('.workout');
    if (!workoutEl) return;
    const workout = this.#workouts.find(w => w.id === workoutEl.dataset.id);
    if (!workout) return;
    document.querySelectorAll('.workout').forEach(el => el.classList.remove('workout--active'));
    this._clearWorkoutRoute();
    const isSame = this.#activeWorkoutId === workout.id;
    if (!this.#clusterEnabled) this.#markers.forEach(m => this._hideMarker(m));
    if (isSame) {
      this.#activeWorkoutId = null;
    } else {
      this.#activeWorkoutId = workout.id;
      workoutEl.classList.add('workout--active');
      const marker = this.#markers.get(workout.id);
      if (marker) { this._showMarker(marker); marker.openPopup(); }
      this.#map.setView(workout.coords, this.#mapZoomLevel, { animate: true, duration: 1 });
      if (workout.routeCoords && workout.routeCoords.length > 1) this._showWorkoutRoute(workout.routeCoords);
    }
  }

  _showWorkoutRoute(coords: Coords[]): void {
    this._clearWorkoutRoute();
    this.#workoutRouteLayer = L.polyline(coords, { color: '#00c46a', weight: 4, opacity: 0.75, dashArray: '8 6' }).addTo(this.#map);
  }

  _clearWorkoutRoute(): void {
    if (this.#workoutRouteLayer) { this.#map.removeLayer(this.#workoutRouteLayer); this.#workoutRouteLayer = null; }
  }

  _deleteWorkout(id: string): void {
    const marker = this.#markers.get(id);
    if (marker) {
      if (this.#clusterGroup) this.#clusterGroup.removeLayer(marker);
      else this.#map.removeLayer(marker);
      this.#markers.delete(id);
    }
    if (this.#activeWorkoutId === id) { this.#activeWorkoutId = null; this._clearWorkoutRoute(); }
    this.#workouts = this.#workouts.filter(w => w.id !== id);
    const el = document.querySelector<HTMLElement>(`.workout[data-id="${id}"]`);
    if (el) {
      el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      el.style.transform = 'translateX(-110%)'; el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }
    this._setLocalStorage(); this._renderStats(); this._renderStreak();
  }

  _setLocalStorage(): void {
    // Zapisuje ostatnio dodany workout do IndexedDB
    // (wywoływane po każdym push do #workouts)
    const last = this.#workouts[this.#workouts.length - 1];
    if (last) void saveWorkoutToDB(last.toJSON() as unknown as Record<string, unknown>);
  }

  async _getLocalStorage(): Promise<void> {
    // Migruj dane z localStorage do IndexedDB (tylko raz, przy pierwszym uruchomieniu)
    await migrateLocalStorageToIndexedDB();
    // Wczytaj z IndexedDB
    const data = await loadWorkoutsFromDB();
    if (!data.length) return;
    this.#workouts = data.map((d: any) => Workout.fromData(d));
    this.#workouts.forEach(w => this._renderWorkout(w));
    this._renderStats(); this._renderStreak();
  }

  reset(): void { void clearAllWorkoutsFromDB().then(() => location.reload()); }

  /** Called by bottom nav when switching to Map tab */
  invalidateMapSize(): void {
    try { this.#map?.invalidateSize(); } catch { /* ignore */ }
  }

  // ── iOS BANNER ────────────────────────────────────────────────────────────

  _initIOSBanner(): void {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = ('standalone' in navigator && (navigator as { standalone?: boolean }).standalone)
      || window.matchMedia('(display-mode: standalone)').matches;
    if (!isIOS || standalone || localStorage.getItem('iosBannerDismissed')) return;
    const banner = document.getElementById('iosInstallBanner');
    const close  = document.getElementById('iosInstallClose');
    if (!banner) return;
    setTimeout(() => banner.classList.remove('hidden'), 2500);
    close?.addEventListener('click', () => { banner.classList.add('hidden'); localStorage.setItem('iosBannerDismissed', '1'); });
  }

  // ── STREAK ────────────────────────────────────────────────────────────────

  _renderStreak(): void {
    const countEl = document.getElementById('streakCount');
    const dotsEl  = document.getElementById('streakDots');
    if (!countEl || !dotsEl) return;
    const workoutDates = new Set(this.#workouts.map(w => new Date(w.date).toDateString()));
    let streak = 0;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      if (workoutDates.has(d.toDateString())) streak++; else break;
    }
    countEl.textContent = String(streak);
    dotsEl.innerHTML = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      const dot = document.createElement('div');
      dot.className = 'streak-bar__dot' + (workoutDates.has(d.toDateString()) ? ' active' : '');
      dotsEl.appendChild(dot);
    }
  }

  // ── STATS ─────────────────────────────────────────────────────────────────

  _getWeekBounds(off = 0): { mon: Date; sun: Date } {
    const now = new Date(), dow = now.getDay();
    const mon = new Date(now); mon.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow) + off * 7); mon.setHours(0,0,0,0);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
    return { mon, sun };
  }

  _getWeekWorkouts(off = 0): Workout[] {
    const { mon, sun } = this._getWeekBounds(off);
    return this.#workouts.filter(w => { const d = new Date(w.date); return d >= mon && d <= sun; });
  }

  _initStats(): void {
    const panel = document.getElementById('statsPanel'); if (!panel) return;
    const detail = document.getElementById('statsDetail');
    const editor = document.getElementById('statsGoalEditor');
    const inKm   = document.getElementById('goalKmInput')    as HTMLInputElement | null;
    const inTime = document.getElementById('goalTimeInput')  as HTMLInputElement | null;
    const inCnt  = document.getElementById('goalCountInput') as HTMLInputElement | null;
    const prevBtn= document.getElementById('statsWeekPrev') as HTMLButtonElement | null;
    const nextBtn= document.getElementById('statsWeekNext') as HTMLButtonElement | null;
    if (inKm)   inKm.value   = String(this.#goalKm);
    if (inTime) inTime.value = String(this.#goalTime);
    if (inCnt)  inCnt.value  = String(this.#goalCount);
    panel.addEventListener('click', () => {
      this.#statsExpanded = !this.#statsExpanded;
      detail?.classList.toggle('hidden', !this.#statsExpanded);
      editor?.classList.toggle('hidden', !this.#statsExpanded);
      const scroll = document.querySelector<HTMLElement>('#tabStats .tab-scroll');
      if (scroll) scroll.style.overflowY = this.#statsExpanded ? 'auto' : '';
    });
    detail?.addEventListener('click', e => e.stopPropagation());
    editor?.addEventListener('click', e => e.stopPropagation());
    prevBtn?.addEventListener('click', e => {
      e.stopPropagation(); this.#statsWeekOffset--; this.#statsSelectedDay = null;
      if (nextBtn) nextBtn.disabled = false; this._renderStats();
    });
    nextBtn?.addEventListener('click', e => {
      e.stopPropagation(); if (this.#statsWeekOffset >= 0) return;
      this.#statsWeekOffset++; this.#statsSelectedDay = null;
      if (this.#statsWeekOffset === 0 && nextBtn) nextBtn.disabled = true; this._renderStats();
    });
    const goal = (field: string, key: string, el: HTMLInputElement | null, fb: number) =>
      el?.addEventListener('change', () => {
        (this as unknown as Record<string, number>)[field] = Math.max(1, +el.value || fb);
        el.value = String((this as unknown as Record<string, number>)[field]);
        localStorage.setItem(key, String((this as unknown as Record<string, number>)[field]));
        this._renderStats();
      });
    goal('#goalKm', 'goalKm', inKm, 35); goal('#goalTime', 'goalTime', inTime, 300); goal('#goalCount', 'goalCount', inCnt, 7);
  }

  _renderStats(animate = false): void {
    const off = this.#statsWeekOffset, weekW = this._getWeekWorkouts(off), { mon } = this._getWeekBounds(off);
    const wKm = weekW.reduce((s, w) => s + (w.distance || 0), 0);
    const wMin= weekW.reduce((s, w) => s + (w.duration  || 0), 0);
    const wCnt= weekW.length;
    let sub = weekW;
    if (this.#statsSelectedDay !== null)
      sub = weekW.filter(w => Math.floor((new Date(w.date).getTime() - mon.getTime()) / 86400000) === this.#statsSelectedDay);
    const sKm = sub.reduce((s, w) => s + (w.distance || 0), 0);
    const sMin= sub.reduce((s, w) => s + (w.duration  || 0), 0);
    const sCnt= sub.length;
    const CIRC = 226.2;
    const ring = (id: string, pct: number) => {
      const el = document.getElementById(id); if (!el) return;
      const t = Math.max(0, CIRC - Math.min(pct, 1) * CIRC);
      if (animate) { el.style.transition = 'none'; el.setAttribute('stroke-dashoffset', String(CIRC)); void el.getBoundingClientRect(); el.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)'; }
      requestAnimationFrame(() => el.setAttribute('stroke-dashoffset', t.toFixed(1)));
    };
    ring('statsRingKm', wKm / this.#goalKm); ring('statsRingTime', wMin / this.#goalTime); ring('statsRingWorkouts', wCnt / this.#goalCount);
    const fmtT = (m: number) => m >= 60 ? `${Math.floor(m/60)}h ${Math.round(m%60)}m` : `${Math.round(m)}m`;
    const set  = (id: string, v: string | number) => { const el = document.getElementById(id); if (el) el.textContent = String(v); };
    set('statsValKm', wKm.toFixed(1)); set('statsValTime', fmtT(wMin)); set('statsValWorkouts', wCnt);
    const pct = Math.min(Math.round((wKm / this.#goalKm) * 100), 100);
    set('statsGoalPct', pct + '%');
    const fill = document.getElementById('statsGoalFill'); if (fill) fill.style.width = pct + '%';
    if (pct >= 100 && !this.#statsPrevGoalReached && animate) { this.#statsPrevGoalReached = true; this._showGoalCelebration(); }
    else if (pct < 100) { this.#statsPrevGoalReached = false; }
    const nxt = document.getElementById('statsWeekNext') as HTMLButtonElement | null;
    if (off === 0) { set('statsWeekLabel', 'This week'); if (nxt) nxt.disabled = true; }
    else { const su = new Date(mon); su.setDate(mon.getDate()+6); const fmt = (d: Date) => d.toLocaleDateString('en',{month:'short',day:'numeric'}); set('statsWeekLabel', `${fmt(mon)}–${fmt(su)}`); if (nxt) nxt.disabled = false; }
    set('statsDetailKm', sKm.toFixed(1)); set('statsDetailTime', fmtT(sMin)); set('statsDetailCount', sCnt);
    set('statsDetailDate', this.#statsSelectedDay !== null ? (() => { const d = new Date(mon); d.setDate(mon.getDate() + this.#statsSelectedDay!); return d.getDate(); })() : '—');
    this._renderDayBars(weekW, mon); this._filterWorkoutsList(weekW);
  }

  _filterWorkoutsList(weekWorkouts: Workout[]): void {
    const ids = new Set(weekWorkouts.map(w => w.id));
    document.querySelectorAll<HTMLElement>('.workout').forEach(el => { el.style.display = ids.has(el.dataset.id ?? '') ? '' : 'none'; });
  }

  _renderDayBars(ww: Workout[], mon: Date): void {
    const el = document.getElementById('statsDetailBars'); if (!el) return;
    const N = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const km = Array<number>(7).fill(0), tp = Array<string>(7).fill('none'), dt = Array<number>(7);
    for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate()+i); dt[i] = d.getDate(); }
    ww.forEach(w => { const i = Math.floor((new Date(w.date).getTime()-mon.getTime())/86400000); if (i>=0&&i<7){km[i]+=(w.distance||0);tp[i]=w.type;} });
    const max = Math.max(...km, 0.1);
    el.innerHTML = N.map((name, i) => {
      const h=Math.round((km[i]/max)*48), c=tp[i]==='running'?'#00c46a':tp[i]==='cycling'?'#ffb545':tp[i]==='walking'?'#5badea':'#3a4147', a=this.#statsSelectedDay===i?' active':'';
      return `<div class="stats-detail__day-col${a}" data-day="${i}"><div class="stats-detail__bar" style="height:${Math.max(h,km[i]>0?4:2)}px;background:${c}"></div><div class="stats-detail__day-name">${name}</div><div class="stats-detail__day-date">${dt[i]}</div></div>`;
    }).join('');
    el.querySelectorAll<HTMLElement>('.stats-detail__day-col').forEach(col => col.addEventListener('click', e => {
      e.stopPropagation(); const day = +col.dataset.day!;
      this.#statsSelectedDay = this.#statsSelectedDay === day ? null : day; this._renderStats();
    }));
  }

  _showGoalCelebration(): void {
    const p = document.getElementById('statsPanel'); p?.classList.add('goal-reached'); setTimeout(()=>p?.classList.remove('goal-reached'),800);
    document.querySelector('.stats-goal-toast')?.remove();
    const t = document.createElement('div'); t.className = 'stats-goal-toast';
    t.innerHTML = `<span class="stats-goal-toast__emoji">🏆</span><span class="stats-goal-toast__title">Weekly goal reached!</span><span class="stats-goal-toast__sub">Amazing — you crushed it 🎉</span>`;
    document.body.appendChild(t);
    setTimeout(()=>{ t.style.transition='opacity 0.5s'; t.style.opacity='0'; setTimeout(()=>t.remove(),500); },3500);
  }

  // ── CUSTOM FILTERS ────────────────────────────────────────────────────────

  _initCustomFilters(): void {
    this._renderCustomFilterBtns();
  }

  _renderCustomFilterBtns(): void {
    const filters = document.getElementById('poiFilters'); if (!filters) return;
    filters.querySelectorAll('.poi-filter-btn--custom').forEach(el => el.remove());
    let addBtn = filters.querySelector<HTMLButtonElement>('.poi-filter-add');
    if (!addBtn) {
      addBtn = document.createElement('button');
      addBtn.className = 'poi-filter-btn poi-filter-add';
      addBtn.title = 'Add custom place'; addBtn.innerHTML = '＋';
      addBtn.addEventListener('click', e => { e.stopPropagation(); this._openCustomFilterModal(); });
      filters.prepend(addBtn);
    }
    this.#customFilters.forEach((cf, idx) => {
      const btn = document.createElement('button');
      btn.className = 'poi-filter-btn poi-filter-btn--custom';
      btn.innerHTML = `${cf.emoji} ${cf.name}`; btn.title = cf.name;
      let pressTimer: ReturnType<typeof setTimeout>;
      btn.addEventListener('touchstart',  () => { pressTimer = setTimeout(() => this._deleteCustomFilter(idx), 600); }, { passive: true });
      btn.addEventListener('touchend',    () => clearTimeout(pressTimer), { passive: true });
      btn.addEventListener('touchcancel', () => clearTimeout(pressTimer), { passive: true });
      btn.addEventListener('contextmenu', e => { e.preventDefault(); this._deleteCustomFilter(idx); });
      btn.addEventListener('click', () => {
        document.querySelectorAll('.poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
        btn.classList.add('poi-filter-btn--active');
        const input = document.getElementById('poiInput') as HTMLInputElement | null;
        if (input) input.value = (cf.address?.trim()) ? cf.address : cf.name;
        void this._searchPOIAtCoords(cf.coords, cf.emoji, cf.name, cf.address ?? '');
      });
      addBtn!.insertAdjacentElement('afterend', btn);
    });
  }

  _openCustomFilterModal(): void {
    document.getElementById('customFilterModal')?.remove();
    const pinnedCoord = this.#pinnedCoord;
    const modal = document.createElement('div');
    modal.id = 'customFilterModal'; modal.className = 'custom-filter-modal';
    modal.innerHTML = `
      <div class="custom-filter-modal__box">
        <div class="custom-filter-modal__title">Add custom place</div>
        <div class="custom-filter-modal__hint">👆 To set the location, <strong>click the start point "A" on the map</strong> (not via search).</div>
        <div class="custom-filter-modal__coord ${pinnedCoord ? '' : 'no-coord'}" id="cfCoordLabel">
          ${pinnedCoord ? `📍 Point selected: ${pinnedCoord[0].toFixed(5)}, ${pinnedCoord[1].toFixed(5)}` : '⚠️ No point selected — tap a spot on the map first'}
        </div>
        <div class="custom-filter-modal__field">
          <label class="custom-filter-modal__label">Name</label>
          <input class="custom-filter-modal__input" id="cfName" type="text" placeholder="e.g. Home, Office…" maxlength="30"/>
        </div>
        <div class="custom-filter-modal__field">
          <label class="custom-filter-modal__label">Emoji</label>
          <div class="custom-filter-modal__emoji-grid" id="cfEmojiGrid">
            ${['🏠','🏢','🏫','🏋️','🛒','☕','🍕','🍺','🌳','⛪','🏥','💊','🚉','🅿️','🐶','🎯','🎸','📚','🏊','🚲'].map(em => `<button class="cf-emoji-btn" data-emoji="${em}">${em}</button>`).join('')}
          </div>
          <div class="custom-filter-modal__emoji-custom">
            <input class="custom-filter-modal__input" id="cfEmojiInput" type="text" placeholder="Or type emoji…" maxlength="4"/>
          </div>
        </div>
        <div class="custom-filter-modal__actions">
          <button class="custom-filter-modal__btn custom-filter-modal__btn--cancel" id="cfCancel">Cancel</button>
          <button class="custom-filter-modal__btn custom-filter-modal__btn--save" id="cfSave">Save</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    let selectedEmoji = '';
    modal.querySelectorAll<HTMLButtonElement>('.cf-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.cf-emoji-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active'); selectedEmoji = btn.dataset.emoji ?? '';
        (document.getElementById('cfEmojiInput') as HTMLInputElement).value = '';
      });
    });
    (document.getElementById('cfEmojiInput') as HTMLInputElement).addEventListener('input', e => {
      selectedEmoji = (e.target as HTMLInputElement).value.trim();
      modal.querySelectorAll('.cf-emoji-btn').forEach(b => b.classList.remove('active'));
    });
    document.getElementById('cfCancel')!.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    document.getElementById('cfSave')!.addEventListener('click', async () => {
      const name  = (document.getElementById('cfName') as HTMLInputElement).value.trim();
      const emoji = selectedEmoji || (document.getElementById('cfEmojiInput') as HTMLInputElement).value.trim();
      if (!pinnedCoord) { alert('Please tap a spot on the map first.'); return; }
      if (!name)        { alert('Please enter a name.'); (document.getElementById('cfName') as HTMLInputElement).focus(); return; }
      if (!emoji)       { alert('Please choose or type an emoji.'); return; }
      let address = '';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pinnedCoord[0]}&lon=${pinnedCoord[1]}&format=json`, { headers: { 'Accept-Language': 'en' } });
        const d = await r.json() as { address?: { road?: string; house_number?: string }; display_name?: string };
        const a = d.address ?? {};
        address = [a.road, a.house_number].filter(Boolean).join(' ') || d.display_name?.split(',')[0] || '';
      } catch { /* ignore */ }
      this.#customFilters.unshift({ name, emoji, coords: pinnedCoord, address });
      localStorage.setItem('customFilters', JSON.stringify(this.#customFilters));
      this._renderCustomFilterBtns(); modal.remove();
    });
  }

  _deleteCustomFilter(idx: number): void {
    if (!confirm(`Remove "${this.#customFilters[idx].name}"?`)) return;
    this._clearPOIMarkers();
    const rl = document.getElementById('poiResults');
    if (rl) { rl.classList.add('hidden'); rl.innerHTML = ''; }
    const input = document.getElementById('poiInput') as HTMLInputElement | null;
    if (input) input.value = '';
    this.#customFilters.splice(idx, 1);
    localStorage.setItem('customFilters', JSON.stringify(this.#customFilters));
    this._renderCustomFilterBtns();
  }

  async _searchPOIAtCoords(coords: Coords, emoji: string, label: string, address: string): Promise<void> {
    const rl = document.getElementById('poiResults'); if (!rl) return;
    rl.classList.remove('hidden'); this._clearPOIMarkers();
    if (!this.#map) return;
    const distM = this.#userCoords ? this._haversine(this.#userCoords, coords) : null;
    const distTxt = distM != null ? (distM < 1000 ? `${Math.round(distM)} m away` : `${(distM/1000).toFixed(1)} km away`) : '';

    // Register _poiSetA so the popup button works for custom filters too
    (window as Window & { _poiSetA?: (lat: number, lon: number) => void })._poiSetA = (lat, lon) => {
      if (this.#trackingActive && this.#trackingCoords) { this._autoRouteFromTracking([lat, lon]); }
      else {
        if (!this.#routeMode) this._startRouteModeFromPOI();
        this.#routePointA = [lat, lon]; this.#routeStep = 2;
        if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
        this.#routeMarkerA = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize:[28,28], iconAnchor:[14,14] }) }).addTo(this.#map);
        stepAText.textContent = 'Start point set ✓';
        stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
        stepBText.textContent = 'Click the end point on the map';
        document.getElementById('map')!.style.cursor = 'crosshair';
        this.#map.closePopup(); this.#map.setView([lat, lon], 15);
      }
    };

    const marker = L.marker(coords, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#2d3439;border:2px solid #00c46a;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`,
        iconSize: [36,36], iconAnchor: [18,18],
      }),
    }).addTo(this.#map)
      .bindPopup(`<b>${emoji} ${label}</b>${address ? `<br>${address}` : ''}${distTxt ? `<br><small>${distTxt}</small>` : ''}<br><button onclick="window._poiSetA(${coords[0]},${coords[1]})" style="margin-top:6px;padding:4px 10px;background:#00c46a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">Set as route A →</button>`)
      .openPopup();
    this.#poiMarkers.push(marker);
    this.#map.setView(coords, 16, { animate: true });
    const li = document.createElement('li'); li.className = 'poi-result-item';
    li.innerHTML = `<span class="poi-result-item__name">${emoji} ${label}</span>${address ? `<span class="poi-result-item__addr">${address}</span>` : ''}${distTxt ? `<span class="poi-result-item__dist">📍 ${distTxt}</span>` : ''}`;
    li.addEventListener('click', () => { this.#map.setView(coords,16,{animate:true}); marker.openPopup(); });
    rl.innerHTML = ''; rl.appendChild(li);
  }

  // ── POI SEARCH ────────────────────────────────────────────────────────────

  _initPOISearch(): void {
    const input = document.getElementById('poiInput') as HTMLInputElement | null;
    const btn   = document.getElementById('poiSearchBtn');
    const filters = document.getElementById('poiFilters');
    const rl    = document.getElementById('poiResults');
    if (!input || !btn || !filters || !rl) return;

    btn.addEventListener('click', () => void this._searchPOI(input.value.trim()));
    input.addEventListener('keydown', (e: KeyboardEvent) => { if (e.key === 'Enter') void this._searchPOI(input.value.trim()); });

    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (val === '') { rl.classList.add('hidden'); rl.innerHTML = ''; this._clearPOIMarkers(); const dl = document.getElementById('poiSuggestions'); if (dl) dl.innerHTML = ''; return; }
      if (this.#autocompleteTimer) clearTimeout(this.#autocompleteTimer);
      if (val.length >= 2) this.#autocompleteTimer = setTimeout(() => void this._fetchAutocompleteSuggestions(val), 350);
    });

    filters.addEventListener('click', (e: MouseEvent) => {
      const filterBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('.poi-filter-btn');
      if (!filterBtn) return;
      document.querySelectorAll('.poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
      filterBtn.classList.add('poi-filter-btn--active');
      if (filterBtn.dataset.query) { if (input) input.value = filterBtn.dataset.query; void this._searchPOI(filterBtn.dataset.query); }
    });
  }

  async _fetchAutocompleteSuggestions(query: string): Promise<void> {
    const dl = document.getElementById('poiSuggestions'); if (!dl) return;
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=0`;
    if (this.#map) { const b = this.#map.getBounds(); url += `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=1`; }
    try {
      const data = await fetch(url, { headers: { 'Accept-Language': 'en' } }).then(r => r.json()) as Array<{ name?: string; display_name: string }>;
      dl.innerHTML = '';
      const seen = new Set<string>();
      data.forEach(p => { const n = p.name ?? p.display_name.split(',')[0]; if (n && !seen.has(n)) { seen.add(n); const o = document.createElement('option'); o.value = n; dl.appendChild(o); } });
    } catch { /* ignore */ }
  }

  async _searchPOI(query: string): Promise<void> {
    if (!query) return;
    const rl = document.getElementById('poiResults'); if (!rl) return;
    rl.classList.remove('hidden');
    rl.innerHTML = `<li class="poi-loading"><div class="route-loading__spinner"><div class="route-loading__dot"></div><div class="route-loading__dot"></div><div class="route-loading__dot"></div></div>Searching…</li>`;
    this._clearPOIMarkers();
    let url: string;
    if (this.#map) { const b = this.#map.getBounds(); url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=1`; }
    else { url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1`; if (this.#userCoords) url += `&lat=${this.#userCoords[0]}&lon=${this.#userCoords[1]}`; }
    try {
      const data = await fetch(url, { headers: { 'Accept-Language': 'en' } }).then(r => r.json()) as Array<{
        lat: string; lon: string; name?: string; display_name: string;
        address?: { road?: string; house_number?: string };
      }>;
      if (!data.length) { rl.innerHTML = `<li class="poi-empty">No results for "<b>${query}</b>" in this area.<br><small>Try zooming out or panning the map.</small></li>`; return; }
      const withDist = data.map(p => ({ ...p, distM: this.#userCoords ? this._haversine(this.#userCoords, [+p.lat, +p.lon]) : null }));
      withDist.sort((a, b) => (a.distM ?? Infinity) - (b.distM ?? Infinity));
      rl.innerHTML = '';
      withDist.forEach(place => {
        const name = place.name ?? place.display_name.split(',')[0];
        const addr = place.address ? [place.address.road, place.address.house_number].filter(Boolean).join(' ') : place.display_name.split(',').slice(1,3).join(',').trim();
        const distTxt = place.distM != null ? (place.distM < 1000 ? `${Math.round(place.distM)} m away` : `${(place.distM/1000).toFixed(1)} km away`) : '';
        const li = document.createElement('li'); li.className = 'poi-result-item';
        li.innerHTML = `<span class="poi-result-item__name">${name}</span>${addr ? `<span class="poi-result-item__addr">${addr}</span>` : ''}${distTxt ? `<span class="poi-result-item__dist">📍 ${distTxt}</span>` : ''}`;
        li.addEventListener('click', () => this._selectPOI(place as { lat: string; lon: string }, name));
        rl.appendChild(li);
        const emoji = this._poiEmoji(query);
        const marker = L.marker([+place.lat, +place.lon], {
          icon: L.divIcon({ className: '', html: `<div style="background:#2d3439;border:2px solid #00c46a;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`, iconSize:[32,32], iconAnchor:[16,16] }),
        }).addTo(this.#map)
          .bindPopup(`<b>${name}</b>${addr ? `<br>${addr}` : ''}<br>${distTxt ? `<small>${distTxt}</small><br>` : ''}<button onclick="window._poiSetA(${place.lat},${place.lon})" style="margin-top:6px;padding:4px 10px;background:#00c46a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">Set as point A →</button>`);
        this.#poiMarkers.push(marker);
      });
      (window as Window & { _poiSetA?: (lat: number, lon: number) => void })._poiSetA = (lat, lon) => {
        if (this.#trackingActive && this.#trackingCoords) { this._autoRouteFromTracking([lat, lon]); }
        else {
          if (!this.#routeMode) this._startRouteModeFromPOI();
          this.#routePointA = [lat, lon]; this.#routeStep = 2;
          if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
          this.#routeMarkerA = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize:[28,28], iconAnchor:[14,14] }) }).addTo(this.#map);
          stepAText.textContent = 'Start point set ✓';
          stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
          stepBText.textContent = 'Click the end point on the map';
          document.getElementById('map')!.style.cursor = 'crosshair';
          this.#map.closePopup(); this.#map.setView([lat, lon], 15);
        }
      };
    } catch { rl.innerHTML = `<li class="poi-empty">Connection error. Please try again.</li>`; }
  }

  _autoRouteFromTracking(destCoords: Coords): void {
    if (!this.#trackingCoords) return;
    this.#map.closePopup();
    this.#routeMode = true; this.#routeStep = 3;
    this.#routePointA = [...this.#trackingCoords]; this.#routePointB = destCoords;
    btnRoute.classList.add('hidden'); routeInfo.classList.remove('hidden'); routeResult.classList.add('hidden');
    if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
    this.#routeMarkerA = L.marker(this.#routePointA, { icon: L.divIcon({ className:'', html:'<div class="route-marker route-marker--a">A</div>', iconSize:[28,28], iconAnchor:[14,14] }) }).addTo(this.#map);
    if (this.#routeMarkerB) this.#map.removeLayer(this.#routeMarkerB);
    this.#routeMarkerB = L.marker(destCoords,           { icon: L.divIcon({ className:'', html:'<div class="route-marker route-marker--b">B</div>', iconSize:[28,28], iconAnchor:[14,14] }) }).addTo(this.#map);
    stepAText.textContent = 'Your position ✓'; stepBText.textContent = 'Destination set ✓';
    stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
    stepBText.closest('.route-info__step')?.classList.add('route-info__step--done');
    document.getElementById('map')!.style.cursor = ''; this._drawRoute();
  }

  _selectPOI(place: { lat: string; lon: string }, _name: string): void {
    this.#map.setView([+place.lat, +place.lon], 16, { animate: true });
    this.#poiMarkers.forEach(m => {
      const pos = m.getLatLng();
      if (Math.abs(pos.lat - +place.lat) < 0.0001 && Math.abs(pos.lng - +place.lon) < 0.0001) m.openPopup();
    });
  }

  _clearPOIMarkers(): void { this.#poiMarkers.forEach(m => this.#map?.removeLayer(m)); this.#poiMarkers = []; }

  _poiEmoji(query: string): string {
    if (/grocery|store|shop|market|sklep|żabka|biedronk|lidl/i.test(query)) return '🛒';
    if (/water|fountain|woda|fontanna/i.test(query)) return '💧';
    if (/toilet|wc|restroom|toaleta/i.test(query)) return '🚻';
    if (/pharmacy|chemist|apteka/i.test(query)) return '💊';
    if (/park|forest|las|garden/i.test(query)) return '🌳';
    if (/cafe|coffee|kawiarnia/i.test(query)) return '☕';
    if (/hospital|clinic|doctor|szpital/i.test(query)) return '🏥';
    if (/restaurant|restauracja|bar|pub/i.test(query)) return '🍴';
    if (/paczkomat|inpost|parcel/i.test(query)) return '📦';
    if (/atm|bankomat/i.test(query)) return '🏧';
    if (/hotel|hostel/i.test(query)) return '🏨';
    if (/church|kościół|chapel/i.test(query)) return '⛪';
    return '📍';
  }

  _haversine([lat1, lon1]: Coords, [lat2, lon2]: Coords): number {
    const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLon = (lon2-lon1)*Math.PI/180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
    return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  }

  // ── ROUTE PLANNER ─────────────────────────────────────────────────────────

  _setActivityMode(e: Event): void {
    const btn  = e.currentTarget as HTMLElement;
    const mode = btn.dataset.mode ?? 'running';
    this.#routeActivityMode = mode;
    document.querySelectorAll('.route-mode-btn').forEach(b => b.classList.remove('route-mode-btn--active'));
    btn.classList.add('route-mode-btn--active');
    if (this.#routeStep === 3 && !routeResult.classList.contains('hidden')) {
      const distKm = parseFloat(routeDist.textContent ?? '');
      if (!isNaN(distKm)) routeTime.textContent = String(Math.round((distKm / this.#activitySpeeds[mode]) * 60));
    }
  }

  /** Called only from POI "Set as route A" — starts route mode without triggering BottomNav hideSearch patch. */
  _startRouteModeFromPOI(): void {
    this._startRouteModeCore();
  }

  _startRouteMode(): void {
    this._startRouteModeCore();
  }

  _startRouteModeCore(): void {
    if (!form.classList.contains('hidden')) this._hideForm();
    this.#routeMode = true; this.#routeStep = 1;
    this.#routePointA = null; this.#routePointB = null;
    btnRoute.classList.add('hidden'); routeInfo.classList.remove('hidden'); routeResult.classList.add('hidden');
    stepAText.textContent = 'Click the start point on the map';
    stepBText.textContent = 'Click the end point on the map';
    stepAText.closest('.route-info__step')?.classList.remove('route-info__step--done');
    stepBText.closest('.route-info__step')?.classList.remove('route-info__step--done');
    document.getElementById('map')!.style.cursor = 'crosshair';
    if (this.#trackingActive && this.#trackingCoords) {
      const [lat, lng] = this.#trackingCoords;
      this.#routePointA = [lat, lng]; this.#routeStep = 2;
      if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
      this.#routeMarkerA = L.marker([lat, lng], { icon: L.divIcon({ className:'', html:'<div class="route-marker route-marker--a">A</div>', iconSize:[28,28], iconAnchor:[14,14] }) }).addTo(this.#map);
      stepAText.textContent = 'Your position ✓';
      stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
      stepBText.textContent = 'Click the destination on the map';
    }
  }

  _handleRouteClick(mapE: L.LeafletMouseEvent): void {
    const { lat, lng } = mapE.latlng;
    if (this.#routeStep === 1) {
      this.#routePointA = [lat, lng]; this.#routeStep = 2;
      if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
      this.#routeMarkerA = L.marker([lat,lng], { icon: L.divIcon({ className:'', html:'<div class="route-marker route-marker--a">A</div>', iconSize:[28,28], iconAnchor:[14,14] }) }).addTo(this.#map);
      stepAText.textContent = 'Start point set ✓';
      stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
      stepBText.textContent = 'Click the end point on the map';
    } else if (this.#routeStep === 2) {
      this.#routePointB = [lat, lng]; this.#routeStep = 3;
      if (this.#routeMarkerB) this.#map.removeLayer(this.#routeMarkerB);
      this.#routeMarkerB = L.marker([lat,lng], { icon: L.divIcon({ className:'', html:'<div class="route-marker route-marker--b">B</div>', iconSize:[28,28], iconAnchor:[14,14] }) }).addTo(this.#map);
      stepBText.textContent = 'End point set ✓';
      stepBText.closest('.route-info__step')?.classList.add('route-info__step--done');
      document.getElementById('map')!.style.cursor = '';
      this._drawRoute();
    }
  }

  _drawRoute(): void {
    routeLoading.classList.remove('hidden'); routeResult.classList.add('hidden');
    if (this.#routingControl) { this.#map.removeControl(this.#routingControl); this.#routingControl = null; }
    this._stopRouteProgress();

    type RCtrl = L.Control & { on(ev: string, fn:(e:unknown)=>void): RCtrl };
    this.#routingControl = (L.Routing as unknown as { control(o:object): RCtrl }).control({
      waypoints: [L.latLng(this.#routePointA![0], this.#routePointA![1]), L.latLng(this.#routePointB![0], this.#routePointB![1])],
      routeWhileDragging: false, addWaypoints: false, draggableWaypoints: false,
      fitSelectedRoutes: true, show: false,
      lineOptions: { styles: [{ color: '#00c46a', weight: 6, opacity: 0.85 }] },
      createMarker: () => null,
    }).on('routesfound', (e: unknown) => {
      routeLoading.classList.add('hidden');
      const ev = e as { routes: Array<{ summary: { totalDistance: number }; coordinates: Array<{ lat: number; lng: number }> }> };
      const route = ev.routes[0];
      const totalDistM = route.summary.totalDistance;
      const distKm = (totalDistM / 1000).toFixed(2);
      routeDist.textContent = distKm;
      routeTime.textContent = String(Math.round(parseFloat(distKm) / this.#activitySpeeds[this.#routeActivityMode] * 60));
      routeResult.classList.remove('hidden');
      this._setupRouteProgress(route.coordinates.map(c => [c.lat, c.lng] as Coords), totalDistM);
    }).on('routingerror', () => {
      routeLoading.classList.add('hidden');
      routeDist.textContent = 'Error'; routeTime.textContent = '—';
      routeResult.classList.remove('hidden');
    }).addTo(this.#map);
  }

  _cancelRoute(): void {
    this.#routeMode = false; this.#routeStep = 0;
    this.#routePointA = null; this.#routePointB = null;
    if (this.#routeMarkerA) { this.#map.removeLayer(this.#routeMarkerA); this.#routeMarkerA = null; }
    if (this.#routeMarkerB) { this.#map.removeLayer(this.#routeMarkerB); this.#routeMarkerB = null; }
    if (this.#routingControl) { this.#map.removeControl(this.#routingControl); this.#routingControl = null; }
    this._stopRouteProgress();
    routeLoading.classList.add('hidden');
    btnRoute.classList.remove('hidden'); routeInfo.classList.add('hidden'); routeResult.classList.add('hidden');
    document.getElementById('map')!.style.cursor = '';
  }
}

// ─── BOOTSTRAP ────────────────────────────────────────────────────────────────

// Expose app globally so bottom nav IIFE can patch it (same as script.js)
declare global {
  interface Window {
    app: App;
    _poiSetA?: (lat: number, lon: number) => void;
  }
}

window.app = new App();

// ─── BOTTOM NAV (exact copy of script.js initBottomNav IIFE) ─────────────────
(function initBottomNav() {
  const SEARCH_BAR = document.getElementById('mapSearchBar');
  let activeTab = 'tabWorkouts';
  let routeActive = false;

  const MOBILE_SEARCH_BAR = document.getElementById('mapSearchBarMobile');

  function showSearch() {
    if (!SEARCH_BAR) return;
    SEARCH_BAR.classList.remove('msb--hidden-tab', 'msb--hidden-route');
    SEARCH_BAR.classList.add('msb--visible');
  }
  function showMobileSearch() {
    const bar = MOBILE_SEARCH_BAR ?? SEARCH_BAR;
    if (!bar) return;
    bar.classList.remove('msb--hidden-tab', 'msb--hidden-route');
    bar.classList.add('msb--visible');
  }
  function hideSearchRoute() {
    if (!SEARCH_BAR) return;
    SEARCH_BAR.classList.add('msb--hidden-route');
    SEARCH_BAR.classList.remove('msb--visible');
    MOBILE_SEARCH_BAR?.classList.add('msb--hidden-route');
    MOBILE_SEARCH_BAR?.classList.remove('msb--visible');
  }
  function hideSearchTab() {
    if (!SEARCH_BAR) return;
    SEARCH_BAR.classList.add('msb--hidden-tab');
    SEARCH_BAR.classList.remove('msb--visible', 'msb--hidden-route');
  }
  function hideMobileSearchTab() {
    const bar = MOBILE_SEARCH_BAR ?? SEARCH_BAR;
    if (!bar) return;
    bar.classList.add('msb--hidden-tab');
    bar.classList.remove('msb--visible', 'msb--hidden-route');
  }

  const isDesktop = () => window.innerWidth >= 900;

  function switchTab(tabId: string) {
    // ── Desktop ──────────────────────────────────────────────────
    if (isDesktop()) {
      document.querySelectorAll<HTMLElement>('.bottom-nav__item')
        .forEach(b => b.classList.remove('bottom-nav__item--active'));
      document.querySelector<HTMLElement>(`.bottom-nav__item[data-tab="${tabId}"]`)
        ?.classList.add('bottom-nav__item--active');
      activeTab = tabId;
      if (tabId === 'tabStats') {
        document.getElementById('tabStats')?.classList.add('tab-panel--active');
        mirrorWorkoutList();
      } else {
        document.getElementById('tabStats')?.classList.remove('tab-panel--active');
      }
      if (tabId === 'tabMap') setTimeout(() => window.app.invalidateMapSize(), 80);
      return;
    }
    // ── Mobile ───────────────────────────────────────────────────
    if (tabId === activeTab) {
      const scroll = document.querySelector<HTMLElement>(`#${tabId} .tab-scroll`);
      if (scroll) scroll.classList.toggle('tab-scroll--collapsed', !scroll.classList.contains('tab-scroll--collapsed'));
      return;
    }
    document.getElementById(activeTab)?.classList.remove('tab-panel--active');
    document.querySelector<HTMLElement>(`.bottom-nav__item[data-tab="${activeTab}"]`)?.classList.remove('bottom-nav__item--active');
    activeTab = tabId;
    document.getElementById(activeTab)?.classList.add('tab-panel--active');
    document.querySelector<HTMLElement>(`.bottom-nav__item[data-tab="${activeTab}"]`)?.classList.add('bottom-nav__item--active');
    document.querySelector<HTMLElement>(`#${activeTab} .tab-scroll`)?.classList.remove('tab-scroll--collapsed');
    if (activeTab === 'tabMap') {
      if (!routeActive) showMobileSearch();
      setTimeout(() => window.app.invalidateMapSize(), 80);
    } else {
      hideMobileSearchTab();
    }
    if (activeTab === 'tabStats') mirrorWorkoutList();
  }

  function mirrorWorkoutList() {
    const src  = document.querySelector<HTMLElement>('#tabWorkouts .workouts');
    const dest = document.getElementById('workoutListStats');
    if (!src || !dest) return;
    dest.innerHTML = '';
    src.querySelectorAll<HTMLElement>('.workout').forEach(el => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.addEventListener('click', () => {
        switchTab('tabMap');
        document.querySelector<HTMLElement>(`#tabWorkouts .workout[data-id="${el.dataset.id}"]`)?.click();
      });
      dest.appendChild(clone);
    });
  }

  document.querySelectorAll<HTMLElement>('.bottom-nav__item').forEach(btn =>
    btn.addEventListener('click', () => switchTab(btn.dataset.tab!))
  );

  function patchApp() {
    if (!window.app?._startRouteMode) { setTimeout(patchApp, 150); return; }
    const origStart  = window.app._startRouteMode.bind(window.app);
    const origCancel = window.app._cancelRoute.bind(window.app);
    window.app._startRouteMode = function (...a: unknown[]) {
      (origStart as (...args: unknown[]) => void)(...a);
      routeActive = true; hideSearchRoute();
      if (activeTab !== 'tabMap') switchTab('tabMap');
    };
    window.app._cancelRoute = function (...a: unknown[]) {
      (origCancel as (...args: unknown[]) => void)(...a);
      routeActive = false;
      if (activeTab === 'tabMap') showSearch();
    };
  }
  patchApp();
  hideSearchTab();

  // Start skeleton + offline detection (replaces script.js startApp())
  initOnlineDetector(() => window.app._getPosition());
  initRetryBtn(pos => window.app._loadMap(pos));
  if (!navigator.onLine) return;
  showSkeleton();
  startMapTimeout();

  // ── Wire desktop sidebar search ──────────────────────────────
  function initSidebarSearch() {
    if (!window.app?._searchPOI) { setTimeout(initSidebarSearch, 200); return; }
    const app = window.app as unknown as {
      _searchPOI(q: string): void;
      _renderCustomFilterBtns?(): void;
    };
    const inp = document.getElementById('poiInputDesktop') as HTMLInputElement | null;
    const resultsEl = document.getElementById('poiResultsDesktop');

    document.getElementById('poiSearchBtnDesktop')?.addEventListener('click', () => {
      if (inp?.value.trim()) app._searchPOI(inp.value.trim());
    });
    inp?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && inp.value.trim()) app._searchPOI(inp.value.trim());
    });
    document.getElementById('btnSettingsDesktop')?.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      document.getElementById('settingsPanel')?.classList.toggle('hidden');
    });
    document.getElementById('poiFiltersDesktop')?.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.poi-filter-btn');
      if (!btn?.dataset.query) return;
      document.querySelectorAll('#poiFiltersDesktop .poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
      btn.classList.add('poi-filter-btn--active');
      if (inp) inp.value = btn.dataset.query;
      app._searchPOI(btn.dataset.query);
    });
    // Mirror results from mobile to desktop
    const mobileRes = document.getElementById('poiResults');
    if (mobileRes && resultsEl) {
      new MutationObserver(() => {
        resultsEl.innerHTML = mobileRes.innerHTML;
        resultsEl.className = mobileRes.className;
      }).observe(mobileRes, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }
  isDesktop() && initSidebarSearch();

  // ── Wire mobile search bar ────────────────────────────────────
  function initMobileSearch() {
    if (!window.app?._searchPOI) { setTimeout(initMobileSearch, 200); return; }
    const app = window.app as unknown as { _searchPOI(q: string): void };
    const inp = document.getElementById('poiInputMobile') as HTMLInputElement | null;
    const mobileResults = document.getElementById('poiResultsMobile');

    document.getElementById('poiSearchBtnMobile')?.addEventListener('click', () => {
      if (inp?.value.trim()) app._searchPOI(inp.value.trim());
    });
    inp?.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && inp.value.trim()) app._searchPOI(inp.value.trim());
    });
    document.getElementById('btnSettingsMobile')?.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      document.getElementById('settingsPanel')?.classList.toggle('hidden');
    });
    document.getElementById('poiFiltersMobile')?.addEventListener('click', (e: MouseEvent) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>('.poi-filter-btn');
      if (!btn?.dataset.query) return;
      document.querySelectorAll('#poiFiltersMobile .poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
      btn.classList.add('poi-filter-btn--active');
      if (inp) inp.value = btn.dataset.query;
      app._searchPOI(btn.dataset.query);
    });
    // Mirror results from main to mobile
    const mainRes = document.getElementById('poiResults');
    if (mainRes && mobileResults) {
      new MutationObserver(() => {
        mobileResults.innerHTML = mainRes.innerHTML;
        mobileResults.className = mainRes.className;
      }).observe(mainRes, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }
  !isDesktop() && initMobileSearch();
})();

// ─── ROUTE MINI PILL (exact copy of script.js) ────────────────────────────────
(function initRouteMiniPill() {
  const pill   = document.getElementById('routeMiniPill');
  const distEl = document.getElementById('routeMiniDist');
  const timeEl = document.getElementById('routeMiniTime');
  if (!pill) return;
  function sync() {
    const d = document.getElementById('routeDist')?.textContent;
    const t = document.getElementById('routeTime')?.textContent;
    if (distEl) distEl.textContent = d ?? '—';
    if (timeEl) timeEl.textContent = t ?? '—';
    const hasRoute  = !document.getElementById('routeResult')?.classList.contains('hidden');
    const collapsed = !!document.querySelector('#tabWorkouts .tab-scroll.tab-scroll--collapsed');
    pill?.classList.toggle('hidden', !(hasRoute && collapsed));
  }
  const obs = new MutationObserver(sync);
  const rr = document.getElementById('routeResult');
  if (rr) obs.observe(rr, { attributes: true });
  const sc = document.querySelector('#tabWorkouts .tab-scroll');
  if (sc) obs.observe(sc, { attributes: true });
})();

// ─── WEATHER (delegated to WeatherWidget module) ──────────────────────────────
initWeatherWidget();
