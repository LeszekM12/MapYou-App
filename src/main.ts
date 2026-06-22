/**
 * main.ts — MapYou TypeScript
 * Exact 1:1 translation of script.js.
 * Only types added — zero logic changes.
 */



import { BACKEND_URL } from './config.js';
import { Workout, Running, Cycling, Walking } from './models/Workout.js';
import { WorkoutType } from './types/index.js';
import type { Coords } from './types/index.js';
import {
  NetState, showSkeleton, startMapTimeout,
  initOnlineDetector, initRetryBtn,
} from './modules/OfflineDetector.js';
import { initWeatherComponents, switchToGPSWeather } from './modules/initWeatherComponents.js';
import { getIPLocation, requestGPSPermission, subscribeToPermissionChanges, hasGPSPermission } from './modules/LocationService.js';
import {
  loadWorkoutsFromDB, saveWorkoutToDB, deleteWorkoutFromDB, saveEnrichedActivity,
  clearAllWorkoutsFromDB, migrateLocalStorageToIndexedDB,
} from './modules/db.js';
import {
  initPushNotifications,
  resubscribeIfNeeded,
  testPushNotification,
  sendWorkoutAddedPush,
  sendWorkoutDeletedPush,
  sendWelcomeBackPush,
  sendLongBreakPush,
  sendArrivedAtDestinationPush,
  sendWeatherPush,
  syncLocationToBackend,
} from './modules/PushNotifications.js';
import { Tracker, type SportType, type ActivityRecord, formatDuration, formatPace, formatDistance, SPORT_COLORS, isTrackable, getAllSports, getCustomSports, saveCustomSport, deleteCustomSport, getColor, getSportLabel, getIcon } from './modules/Tracker.js';
import { getSavedRoutes, unsaveRoute, type SavedRoute } from './modules/SavedRoutes.js';
import { showGoodJobSplash, showActivitySummary, ActivityHistoryPanel } from './modules/ActivityView.js';
import { saveActivity } from './modules/db.js';
import { homeView } from './modules/HomeView.js';
import { statsView } from './modules/StatsView.js';
import { notifyActivityAdded } from './modules/NotificationsService.js';
import { migrateToUnified, saveUnifiedWorkout } from './modules/UnifiedWorkout.js';
import { openSportPicker } from './modules/SportPicker.js';
import { openSaveActivityModal } from './modules/SaveActivityModal.js';
import { liveTracker }          from './modules/LiveTracker.js';
import { FriendsView }          from './modules/FriendsView.js';
import { showNameModalIfNeeded, openChangeNameModal, ensureRecoveryCode, showRecoveryCodeModal } from './modules/UserName.js';
import { initUserProfile, loadProfileFromLocal } from './modules/UserProfile.js';
import { syncToMongoIfNeeded } from './modules/syncToMongo.js';
import { CS, encodePolyline, decodePolyline } from './modules/cloudSync.js';

// ─── Synchronizacja userId — jeden klucz dla całej apki ──────────────────────
// mapty_userId (PushNotifications) i mapyou_userId_profile (UserProfile)
// muszą być takie same — używamy mapyou_userId_profile jako źródła prawdy
(function syncUserIds() {
  const profileId = localStorage.getItem('mapyou_userId_profile');
  const pushId    = localStorage.getItem('mapty_userId');
  if (profileId && pushId && profileId !== pushId) {
    // Nadpisz push userId profileId
    localStorage.setItem('mapty_userId', profileId);
  } else if (profileId && !pushId) {
    localStorage.setItem('mapty_userId', profileId);
  } else if (pushId && !profileId) {
    localStorage.setItem('mapyou_userId_profile', pushId);
  }
})();

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

interface CommunityRoute {
  routeId:        string;
  ownerUserId:    string;
  ownerName:      string;
  ownerAvatarB64: string | null;
  sport:          string;
  name:           string;
  distanceKm:     number;
  durationSec:    number;
  coordsEnc:      string;
  startLat:       number;
  startLng:       number;
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

// ── Map styles ───────────────────────────────────────────────────────────────
const MAP_STYLES: Record<string, { url: string; attr: string; label: string; thumb: string; dark?: boolean }> = {
  standard:  { url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',       attr: '&copy; OpenStreetMap &copy; CARTO',  label: 'Standard',  thumb: '🗺️' },
  satellite: { url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attr: '&copy; Esri', label: 'Satellite', thumb: '🛰️' },
  terrain:   { url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',                               attr: '&copy; OpenStreetMap &copy; OpenTopoMap', label: 'Terrain', thumb: '⛰️' },
  dark:      { url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',                  attr: '&copy; OpenStreetMap &copy; CARTO',  label: 'Dark',      thumb: '🌑', dark: true },
  light:     { url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',                 attr: '&copy; OpenStreetMap &copy; CARTO',  label: 'Light',     thumb: '☀️' },
  streets:   { url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',                             attr: '&copy; OpenStreetMap',               label: 'Streets',   thumb: '🏙️' },
};
const DEFAULT_DAY_STYLE   = 'standard';
const DEFAULT_NIGHT_STYLE = 'dark';

function _getActiveMapStyle(isDark: boolean): string {
  const saved = localStorage.getItem('mapStyle');
  if (saved && MAP_STYLES[saved]) return saved;
  return isDark ? DEFAULT_NIGHT_STYLE : DEFAULT_DAY_STYLE;
}

// Legacy aliases used by _applyTheme tile switching
const TILES = {
  day:   MAP_STYLES.standard.url,
  night: MAP_STYLES.dark.url,
};
const TILE_ATTR = {
  day:   MAP_STYLES.standard.attr,
  night: MAP_STYLES.dark.attr,
};

// ─── App class ────────────────────────────────────────────────────────────────

class App {
  #map!: L.Map;
  #ghostRoute: L.Polyline | null = null;
  #tileLayer: L.TileLayer | null = null;
  #mapZoomLevel = 13;
  #mapEvent!: L.LeafletMouseEvent;
  #workouts: Workout[] = [];

  #routeMode = false;
  #routeStep = 0;
  #routePointA: Coords | null = null;
  #routePointB: Coords | null = null;
  #routeLine: L.Polyline | null = null;
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

  #tracker:      Tracker | null = null;
  #trackSport    = 'running';
  #timerActive   = false;
  #timerPaused   = false;
  #timerStartMs  = 0;
  #timerAccumSec = 0;
  #timerInterval: ReturnType<typeof setInterval> | null = null;
  #lastAnnouncedKm = 0;
  #wasAutoPaused   = false;
  #lastLapCount    = 0;
  #clockInterval: ReturnType<typeof setInterval> | null = null;
  #historyPanel: ActivityHistoryPanel | null = null;

  #nightMode = false;
  #wakeLock: WakeLockSentinel | null = null;
  #deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

  #markers      = new Map<string, L.Marker>();
  #clusterGroup: MarkerClusterGroup | null = null;
  #clusterEnabled = localStorage.getItem('clusterEnabled') === 'true';
  #activeRoute: L.Polyline | null = null;
  #unifiedMarkers: L.Marker[] = [];
  #refreshing = false;
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
    void this._loadMapFromIP();
    void this._getLocalStorage();

    form.addEventListener('submit', this._newWorkout.bind(this));
    inputType.addEventListener('change', this._toggleElevationField);
    containerWorkouts.addEventListener('click', this._moveToPopup.bind(this));
    this._initContainerSwipe();
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

    // ── Theme init — manual override OR system preference ──────────────────
    const _manualTheme = localStorage.getItem('nightMode');
    const _systemDark  = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (_manualTheme === 'true') {
      this.#nightMode = true;   // user forced dark
    } else {
      // null or 'false' — follow system
      this.#nightMode = _systemDark;
      if (_manualTheme === 'false') localStorage.removeItem('nightMode');
    }
    this._applyTheme();

    // Update toggle button to reflect current state
    document.getElementById('nightToggle')?.classList.toggle('active', this.#nightMode);

    // Listen for system theme changes (live — no restart needed)
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', e => {
      // Only follow system if user hasn't set ANY manual override (null = no override)
      const manual = localStorage.getItem('nightMode');
      if (manual === null) {
        this.#nightMode = e.matches;
        this._applyTheme();
      }
    });
    // Migrate legacy 'voiceStats' → unified 'mapyou_voice_cues', then sync UI
    if (localStorage.getItem('mapyou_voice_cues') == null && localStorage.getItem('voiceStats') === 'true') {
      localStorage.setItem('mapyou_voice_cues', 'true');
    }
    if (this._isVoiceCuesOn()) {
      document.getElementById('voiceToggle')?.classList.add('active');
    }
  }

  // ── GEOLOCATION ───────────────────────────────────────────────────────────

  /** Load map using IP location — no GPS permission needed */
  async _loadMapFromIP(): Promise<void> {
    const DEFAULT_COORDS: Coords = [52.237, 21.017]; // Warsaw fallback

    // If GPS was granted before, use the LAST SAVED coords (no GPS call → no prompt).
    // Safari iOS re-prompts on every getCurrentPosition even when already granted,
    // so we must NOT call GPS on startup. GPS is only triggered by Start tracking.
    if (await hasGPSPermission()) {
      const saved = localStorage.getItem('mapty_last_coords');
      if (saved) {
        try {
          const coords = JSON.parse(saved) as Coords;
          this._loadMap(coords, this.#mapZoomLevel);
          console.info('[Map] Loaded with last saved GPS coords (no prompt)');
          subscribeToPermissionChanges((c) => this._recenterMapToGPS(c));
          return;
        } catch { /* fall through to IP */ }
      }
    }

    // No GPS permission yet → use IP location
    let coords: Coords = DEFAULT_COORDS;
    const ipLoc = await getIPLocation();
    if (ipLoc) {
      coords = ipLoc.coords;
      console.info(`[Map] IP location: ${ipLoc.city}, ${ipLoc.country}`);
    } else {
      console.warn('[Map] IP location failed — using default coords');
    }

    this._loadMap(coords, 11); // zoom 11 for IP — "your area" without half of Poland

    // Subscribe to future GPS grants → auto re-center when user allows in Track tab
    subscribeToPermissionChanges((gpsCoords) => {
      this._recenterMapToGPS(gpsCoords);
    });
  }

  /** Center map on GPS coords (called after permission granted) */
  _recenterMapToGPS(coords: Coords): void {
    this.#userCoords = coords;
    if (this.#map) {
      this.#map.setView(coords, this.#mapZoomLevel, { animate: true });
    }
  }

  /** @deprecated Use _loadMapFromIP instead — kept for initRetryBtn compatibility */
  _getPosition(): void {
    void this._loadMapFromIP();
  }

  _loadMap(coords: Coords, zoom?: number): void {
    this.#userCoords = coords;

    this.#map = L.map('map').setView(coords, zoom ?? this.#mapZoomLevel);

    this.#map.createPane('progressPane');
    const pane = this.#map.getPane('progressPane');
    if (pane) pane.style.zIndex = '650';

    const _initStyleKey = _getActiveMapStyle(this.#nightMode);
    const _initStyle    = MAP_STYLES[_initStyleKey];
    this.#tileLayer = L.tileLayer(_initStyle.url, { attribution: _initStyle.attr }).addTo(this.#map);

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
      setTimeout(() => void this._refreshClusterMarkers(), 800);
      this.#map.on('moveend zoomend', () => {
        clearTimeout((this as unknown as Record<string,unknown>)._refreshTimer as number);
        (this as unknown as Record<string,unknown>)._refreshTimer = setTimeout(
          () => void this._refreshClusterMarkers(), 400
        );
      });
    }
    this.#workouts.forEach(w => this._renderWorkoutMarker(w));

    this.#map.on('mousedown touchstart', () => {
      this.#userTouchingMap = true;
      if (this.#recenterTimer) clearTimeout(this.#recenterTimer);
    });
    this.#map.on('mouseup touchend', () => {
      this.#recenterTimer = setTimeout(() => { this.#userTouchingMap = false; }, 5000);
    });
    // Przy każdym starcie wyślij subskrypcję do backendu (naprawia reset MemoryDB)
    void resubscribeIfNeeded();
    void initPushNotifications().then(async () => {
      // Persist location for server-side scheduled weather pushes
      void syncLocationToBackend();
      // longBreak ma priorytet — jeśli wysłany, pomijamy welcomeBack
      const longBreakSent = await sendLongBreakPush();
      if (!longBreakSent) void sendWelcomeBackPush();
      // Push pogodowy jeśli warunki sprzyjają
      void sendWeatherPush();
    });
    this._initTracker();
    this._setTrackSport(this.#trackSport);
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
    if (this.#nightMode) {
      // User turned ON — force dark
      localStorage.setItem('nightMode', 'true');
    } else {
      // User turned OFF — remove override so system can decide again
      localStorage.removeItem('nightMode');
      // Re-read system to apply correct state
      this.#nightMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    this._applyTheme();
  }

  _applyTheme(): void {
    const isDark = this.#nightMode;
    document.body.classList.toggle('night-mode', isDark);
    document.body.classList.toggle('light-mode', !isDark);
    document.getElementById('nightToggle')?.classList.toggle('active', isDark);
    // Update theme-color meta tags (status bar color on iOS/Android)
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach(m => {
      m.content = isDark ? '#141417' : '#ffffff';
    });
    // Update map tiles
    if (this.#map && this.#tileLayer) {
      this.#map.removeLayer(this.#tileLayer);
      const styleKey = _getActiveMapStyle(isDark);
      const style    = MAP_STYLES[styleKey];
      this.#tileLayer = L.tileLayer(style.url, { attribution: style.attr }).addTo(this.#map);
    }
  }

  // ── VOICE ─────────────────────────────────────────────────────────────────

  _toggleVoice(): void {
    const next = !this._isVoiceCuesOn();
    localStorage.setItem('mapyou_voice_cues', next ? 'true' : 'false');
    document.getElementById('voiceToggle')?.classList.toggle('active', next);
    if (next) this._speak('Komunikaty głosowe włączone.');
  }

  _speak(text: string): void {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'pl-PL'; utt.rate = 1.0; utt.pitch = 1.0;
    window.speechSynthesis.speak(utt);
  }

  _updateVoiceStats(lat: number, lng: number): void {
    if (!this._isVoiceCuesOn() || !this.#trackingActive) return;
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
      const elapsedSec = (Date.now() - this.#voiceStartTime!) / 1000;
      const pace = (elapsedSec / 60) / km;  // min/km
      this._announceKm(next, pace, elapsedSec);
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
    if (!this._isScreenLockOn()) return;   // respect Screen lock setting
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
    void this._startTrackingWithPermission();
  }

  async _startTrackingWithPermission(): Promise<void> {
    const already = await hasGPSPermission();
    if (!already) {
      const coords = await requestGPSPermission();
      if (!coords) return; // user denied
    }
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
      if (this._isVoiceCuesOn()) this._speak('Dotarłeś na miejsce. Cel osiągnięty!');
      void sendArrivedAtDestinationPush();
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
    // Never open workout form when Home tab or Friends tab is active —
    // clicks there should not fall through to the map handler.
    const activeTab = document.querySelector('.tab-panel--active');
    if (activeTab && (activeTab.id === 'tabHome' || activeTab.id === 'tabFriends')) return;

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
      void sendWorkoutAddedPush();

      // Save to enrichedActivities + unifiedWorkouts + refresh views
      const _wm = workout.toJSON() as Record<string, unknown>;
      const _wmDistKm = Number(_wm.distance) || 0;
      const _wmDurSec = Math.round((Number(_wm.duration) || 0) * 60);
      const _wmPace   = _wmDurSec > 0 && _wmDistKm > 0 ? (_wmDurSec / 60) / _wmDistKm : 0;
      const _wmSpeed  = _wmDurSec > 0 && _wmDistKm > 0 ? _wmDistKm / (_wmDurSec / 3600) : 0;
      const _wmType   = (workout.type ?? 'running') as import('./modules/UnifiedWorkout.js').WorkoutType;
      const _wmDate   = workout.date ? new Date(workout.date).toISOString() : new Date().toISOString();
      const _wmEnriched = {
        id:          String(workout.id),
        sport:       _wmType,
        date:        new Date(_wmDate).getTime(),
        name:        workout.description ?? '',
        description: workout.description ?? '',
        photoUrl:    null as null,
        distanceKm:  _wmDistKm,
        durationSec: _wmDurSec,
        paceMinKm:   _wmPace,
        speedKmH:    _wmSpeed,
        intensity:   0,
        notes:       '',
        // Use routeCoords (planned route) if available, else fall back to workout point coords
        coords:      Array.isArray(_wm.routeCoords) && (_wm.routeCoords as unknown[]).length > 0
          ? (_wm.routeCoords as import('./types/index.js').Coords[])
          : (Array.isArray(_wm.coords) && (_wm.coords as unknown[]).length === 2
              ? [_wm.coords as import('./types/index.js').Coords]  // single point [lat,lng] → wrap in array
              : []),
      };
      void CS.saveEnrichedActivity(_wmEnriched);
      void CS.saveUnifiedWorkout({
        ..._wmEnriched,
        type:     _wmType,
        source:   'manual' as const,
        elevGain: Number(_wm.elevGain ?? 0) || 0,
      } as unknown as import('./modules/UnifiedWorkout.js').UnifiedWorkout);
      notifyActivityAdded(workout.description ?? workout.type, _wmDistKm, workout.type);
      void homeView.render();
      void statsView.render();
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
    void sendWorkoutAddedPush();
    // Save to enrichedActivities (for Home feed) + unifiedWorkouts (for Stats)
    const _w = workout.toJSON() as Record<string, unknown>;
    const _distKm  = Number(_w.distance)  || 0;
    const _durMin  = Number(_w.duration)  || 0;
    const _durSec  = Math.round(_durMin * 60);
    const _pace    = _durMin > 0 && _distKm > 0 ? _durMin / _distKm : 0;
    const _speed   = _durSec > 0 && _distKm > 0 ? _distKm / (_durSec / 3600) : 0;
    const _wType   = (workout.type ?? 'running') as import('./modules/UnifiedWorkout.js').WorkoutType;
    const _wDate   = workout.date ? new Date(workout.date).toISOString() : new Date().toISOString();
    const _enriched = {
      id:          String(workout.id),
      sport:       _wType,
      date:        new Date(_wDate).getTime(),
      name:        workout.description ?? '',
      description: workout.description ?? '',
      photoUrl:    null,
      distanceKm:  _distKm,
      durationSec: _durSec,
      paceMinKm:   _pace,
      speedKmH:    _speed,
      intensity:   0,
      notes:       '',
      coords:      Array.isArray(_w.routeCoords) && (_w.routeCoords as unknown[]).length > 0
        ? (_w.routeCoords as import('./types/index.js').Coords[])
        : (Array.isArray(_w.coords) && (_w.coords as unknown[]).length === 2
            ? [_w.coords as import('./types/index.js').Coords]
            : []),
    };
    void CS.saveEnrichedActivity(_enriched);
    void CS.saveUnifiedWorkout({
      ..._enriched,
      type:     _wType,
      source:   'manual' as const,
      elevGain: Number(_w.elevGain ?? 0) || 0,
    } as unknown as import('./modules/UnifiedWorkout.js').UnifiedWorkout);
    // Notify + refresh views
    notifyActivityAdded(workout.description ?? workout.type, _distKm, workout.type);
    void homeView.render();
    void statsView.render();
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

  async _refreshClusterMarkers(): Promise<void> {
    if (!this.#clusterEnabled || !this.#clusterGroup) return;
    if (this.#refreshing) return;
    this.#refreshing = true;
    try {
      this.#unifiedMarkers.forEach(m => this.#clusterGroup!.removeLayer(m));
      this.#unifiedMarkers = [];
      if (this.#activeRoute) { this.#map.removeLayer(this.#activeRoute); this.#activeRoute = null; }

      const { loadUnifiedWorkouts } = await import('./modules/db.js');
      const workouts = await loadUnifiedWorkouts();
      if (!workouts.length) return;

      const bounds = this.#map.getBounds().pad(0.5);
      const seen = new Set<string>();
      const visible = workouts
        .filter(w => {
          if (seen.has(w.id)) return false;
          seen.add(w.id);
          return w.coords?.length > 0;
        })
        .filter(w => {
          const [lat, lng] = w.coords[Math.floor(w.coords.length / 2)];
          return bounds.contains([lat, lng] as L.LatLngExpression);
        })
        .slice(0, 50);

      visible.forEach(w => {
        const mid   = w.coords[Math.floor(w.coords.length / 2)];
        const sport = w.type;
        const icon  = sport === 'running' ? '🏃' : sport === 'cycling' ? '🚴' : sport === 'walking' ? '🚶' : '🏋️';
        const dist  = w.distanceKm > 0 ? `${w.distanceKm.toFixed(2)} km` : '';
        const dur   = w.durationSec > 0
          ? w.durationSec >= 3600
            ? `${Math.floor(w.durationSec/3600)}h ${Math.floor((w.durationSec%3600)/60)}m`
            : `${Math.floor(w.durationSec/60)}m`
          : '';
        const pace  = w.paceMinKm > 0
          ? `${Math.floor(w.paceMinKm)}:${String(Math.round((w.paceMinKm%1)*60)).padStart(2,'0')} /km`
          : '';
        const date  = new Date(w.date).toLocaleDateString('en', { day:'numeric', month:'short', year:'numeric' });

        const popupHtml = `
          <div class="wu-popup">
            <div class="wu-popup__header">${icon} <strong>${w.name || w.type}</strong></div>
            <div class="wu-popup__date">${date}</div>
            ${dist ? `<div class="wu-popup__stat">📏 ${dist}</div>` : ''}
            ${dur  ? `<div class="wu-popup__stat">⏱ ${dur}</div>`  : ''}
            ${pace ? `<div class="wu-popup__stat">⚡ ${pace}</div>` : ''}
          </div>`;

        const marker = L.marker(mid as L.LatLngExpression, {
          icon: L.divIcon({
            className: '',
            html: `<div class="wu-marker wu-marker--${sport}">${icon}</div>`,
            iconSize: [36, 36], iconAnchor: [18, 18],
          }),
        }).bindPopup(popupHtml, {
          maxWidth: 220,
          autoPan: false,
          offset: L.point(0, -20),
        });

        marker.on('click', () => {
          if (this.#activeRoute) { this.#map.removeLayer(this.#activeRoute); this.#activeRoute = null; }
          if (w.coords.length > 1) {
            const zoom  = this.#map.getZoom();
            const step  = zoom >= 15 ? 1 : zoom >= 12 ? 3 : zoom >= 10 ? 8 : 15;
            const pts   = w.coords.filter((_, i) => i === 0 || i === w.coords.length-1 || i % step === 0);
            const color = sport === 'running' ? '#00c46a' : sport === 'cycling' ? '#f97316' : sport === 'walking' ? '#3b82f6' : '#8b5cf6';
            this.#activeRoute = L.polyline(pts as L.LatLngExpression[], {
              color, weight: 4, opacity: 0.85, lineJoin: 'round', lineCap: 'round',
            }).addTo(this.#map);
          }
        });
        marker.on('popupclose', () => {
          if (this.#activeRoute) { this.#map.removeLayer(this.#activeRoute); this.#activeRoute = null; }
        });

        this.#clusterGroup!.addLayer(marker);
        this.#unifiedMarkers.push(marker);
      });
    } finally {
      this.#refreshing = false;
    }
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
    const deleteId = workout.id;
    let liHtml = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <h2 class="workout__title">${workout.description}</h2>
        ${thumb ? `<div class="workout__thumb-container">${thumb}</div>` : ''}
        <div class="workout__details"><span class="workout__icon">${icon}</span><span class="workout__value">${workout.distance}</span><span class="workout__unit">km</span></div>
        <div class="workout__details"><span class="workout__icon">⏱</span><span class="workout__value">${workout.duration}</span><span class="workout__unit">min</span></div>`;

    if (workout instanceof Running || workout instanceof Walking)
      liHtml += `
        <div class="workout__details"><span class="workout__icon">⚡️</span><span class="workout__value">${workout.pace.toFixed(1)}</span><span class="workout__unit">min/km</span></div>
        <div class="workout__details"><span class="workout__icon">🦶🏼</span><span class="workout__value">${workout.cadence}</span><span class="workout__unit">spm</span></div>
      </li>`;
    else if (workout instanceof Cycling)
      liHtml += `
        <div class="workout__details"><span class="workout__icon">⚡️</span><span class="workout__value">${workout.speed.toFixed(1)}</span><span class="workout__unit">km/h</span></div>
        <div class="workout__details"><span class="workout__icon">⛰</span><span class="workout__value">${workout.elevationGain}</span><span class="workout__unit">m</span></div>
      </li>`;

    form.insertAdjacentHTML('afterend', liHtml);
  }

  _initContainerSwipe(): void {
    let startX = 0, startY = 0, currentX = 0;
    let swipeEl: HTMLElement | null = null;
    let isSwiping = false, locked = false;
    const THRESHOLD = 80;

    document.addEventListener('touchstart', (e: TouchEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('.workout');
      if (!el) return;
      swipeEl = el;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      currentX = 0; isSwiping = false; locked = false;
      swipeEl.style.transition = 'none';
    }, { passive: true });

    document.addEventListener('touchmove', (e: TouchEvent) => {
      if (!swipeEl || locked) return;
      const dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!isSwiping && Math.abs(dy) > Math.abs(dx) + 10) { locked = true; return; }
      if (Math.abs(dx) > 10) isSwiping = true;
      if (!isSwiping) return;
      if (e.cancelable) e.preventDefault();
      currentX = dx;
      const clamped = Math.max(-150, Math.min(150, dx));
      swipeEl.style.transform = `translateX(${clamped}px)`;
      const ratio = Math.min(Math.abs(clamped) / THRESHOLD, 1);
      swipeEl.style.boxShadow = `inset 0 0 0 2px rgba(255,80,80,${ratio * 0.9})`;
    }, { passive: false });

    document.addEventListener('touchend', () => {
      if (!swipeEl || !isSwiping) { swipeEl = null; return; }
      const el = swipeEl; swipeEl = null;
      el.style.transition = 'transform 0.28s ease, opacity 0.28s ease, box-shadow 0.28s ease';
      if (Math.abs(currentX) >= THRESHOLD) {
        const dir = currentX > 0 ? 1 : -1;
        el.style.transform = `translateX(${dir * 120}%)`;
        el.style.opacity = '0';
        setTimeout(() => {
          el.style.transition = '';
          el.style.transform = '';
          el.style.opacity = '';
          el.style.boxShadow = '';
          const id = el.dataset.id;
          if (id && confirm('Delete this workout?')) this._deleteWorkout(id);
        }, 280);
      } else {
        el.style.transform = '';
        el.style.boxShadow = '';
      }
    }, { passive: true });

    document.addEventListener('touchcancel', () => {
      if (!swipeEl) return;
      swipeEl.style.transition = '';
      swipeEl.style.transform = '';
      swipeEl.style.boxShadow = '';
      swipeEl = null;
    }, { passive: true });
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
    void CS.deleteWorkout(id);
    this._renderStats(); this._renderStreak();
    void sendWorkoutDeletedPush();
  }

  _setLocalStorage(): void {
    // Zapisuje ostatnio dodany workout do IndexedDB
    // (wywoływane po każdym push do #workouts)
    const last = this.#workouts[this.#workouts.length - 1];
    if (last) void CS.saveWorkout(last.toJSON() as unknown as Record<string, unknown>);
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

  // ── TRACKER ───────────────────────────────────────────────────────────────

  _initTracker(): void {
    const map = this.#map;

    // Init tracker
    this.#tracker = new Tracker(map, stats => {
      const sport = this.#tracker?.currentSport ?? 'running';
      const d = document.getElementById('trkDist');
      const t = document.getElementById('trkTime');
      const p = document.getElementById('trkPace');
      const l = document.getElementById('trkPaceLbl');
      if (d) d.textContent = formatDistance(stats.distanceKm);
      if (t) t.textContent = formatDuration(stats.durationSec);
      if (sport === 'cycling') {
        if (p) p.textContent = stats.speedKmH.toFixed(1);
        if (l) l.textContent = 'km/h';
      } else {
        if (p) p.textContent = formatPace(stats.paceMinKm);
        if (l) l.textContent = 'min/km';
      }

      // Voice cue every completed kilometer
      if (this._isVoiceCuesOn()) {
        const km = Math.floor(stats.distanceKm);
        if (km >= 1 && km > this.#lastAnnouncedKm) {
          this.#lastAnnouncedKm = km;
          this._announceKm(km, stats.paceMinKm, stats.durationSec);
        }
      }

      // Mirror to fullscreen expanded view
      const isCycling = sport === 'cycling';
      const exTime = document.getElementById('trkExpTime');
      const exDist = document.getElementById('trkExpDist');
      const exPace = document.getElementById('trkExpPace');
      const exPaceLbl = document.getElementById('trkExpPaceLbl');
      if (exTime) exTime.textContent = formatDuration(stats.durationSec);
      if (exDist) exDist.textContent = formatDistance(stats.distanceKm);
      if (exPace) exPace.textContent = isCycling ? stats.speedKmH.toFixed(1) : formatPace(stats.paceMinKm);
      if (exPaceLbl) exPaceLbl.textContent = isCycling ? 'Avg speed (km/h)' : 'Avg pace (/km)';

      // Laps / splits — render when a new km completes
      const laps = stats.laps ?? [];
      if (laps.length !== this.#lastLapCount) {
        this.#lastLapCount = laps.length;
        const lapsWrap = document.getElementById('trkExpLaps');
        const lapsList = document.getElementById('trkExpLapsList');
        if (lapsWrap && lapsList) {
          if (laps.length === 0) {
            lapsWrap.setAttribute('hidden', '');
          } else {
            lapsWrap.removeAttribute('hidden');
            const fastest = Math.min(...laps.map(l => l.paceMinKm).filter(p => p > 0));
            lapsList.innerHTML = [...laps].reverse().map(l => {
              const pct = l.paceMinKm > 0 && fastest > 0 ? Math.max(8, (fastest / l.paceMinKm) * 100) : 100;
              return `<div class="trk-lap">
                <span class="trk-lap__num">${l.km}</span>
                <span class="trk-lap__bar-wrap"><span class="trk-lap__bar" style="width:${pct}%"></span></span>
                <span class="trk-lap__val">${formatPace(l.paceMinKm)}</span>
              </div>`;
            }).join('');
          }
        }
      }

      // Auto-pause status indicator (overlay label + yellow bar + expanded header)
      if (stats.autoPaused !== this.#wasAutoPaused) {
        this.#wasAutoPaused = !!stats.autoPaused;
        const st = document.getElementById('trkStatus');
        if (st) st.textContent = stats.autoPaused ? 'AUTO-PAUSED' : 'RECORDING...';
        const bar = document.getElementById('trkPausedBar');
        if (bar) { bar.textContent = 'Auto-pause'; bar.classList.toggle('hidden', !stats.autoPaused); }
        const exHdr = document.getElementById('trkExpHeader');
        const exSt  = document.getElementById('trkExpStatus');
        exHdr?.classList.toggle('trk-expanded__header--paused', !!stats.autoPaused);
        if (exSt) exSt.textContent = stats.autoPaused ? 'Auto-paused' : 'Recording';
        if (stats.autoPaused && this._isVoiceCuesOn()) this._speak('Automatyczna pauza.');
      }
    });

    // Historia
    const histEl = document.getElementById('activityHistoryList');
    if (histEl) {
      this.#historyPanel = new ActivityHistoryPanel(histEl, map);
      void this.#historyPanel.render();
    }

    // History toggle
    // ── Map style picker ───────────────────────────────────────────────────────
    const _initMapPicker = () => {
      const panel   = document.getElementById('mapStylePanel')!;
      const grid    = document.getElementById('mapStyleGrid')!;

      // Build grid
      grid.innerHTML = Object.entries(MAP_STYLES).map(([key, style]) => `
        <div class="map-style-card ${_getActiveMapStyle(this.#nightMode) === key ? 'map-style-card--active' : ''}"
             data-style="${key}">
          <div class="map-style-card__thumb">${style.thumb}</div>
          <div class="map-style-card__label">${style.label}</div>
        </div>`).join('');

      const openPanel = () => {
        // Refresh active state
        grid.querySelectorAll<HTMLElement>('.map-style-card').forEach(c => {
          c.classList.toggle('map-style-card--active', c.dataset.style === _getActiveMapStyle(this.#nightMode));
        });
        panel.classList.remove('hidden');
        requestAnimationFrame(() => panel.classList.add('visible'));
      };

      const closePanel = () => {
        panel.classList.remove('visible');
        setTimeout(() => panel.classList.add('hidden'), 300);
      };

      document.getElementById('trkMapStyleBtn')?.addEventListener('click', openPanel);
      document.getElementById('mapTabStyleBtn')?.addEventListener('click', openPanel);

      // Close on backdrop click
      panel.addEventListener('click', e => { if (e.target === panel) closePanel(); });

      // Style selection
      grid.addEventListener('click', e => {
        const card = (e.target as HTMLElement).closest<HTMLElement>('.map-style-card');
        if (!card?.dataset.style) return;
        const key = card.dataset.style;
        localStorage.setItem('mapStyle', key);
        grid.querySelectorAll('.map-style-card').forEach(c => c.classList.remove('map-style-card--active'));
        card.classList.add('map-style-card--active');
        // Apply new tile layer
        if (this.#map && this.#tileLayer) {
          this.#map.removeLayer(this.#tileLayer);
          const style = MAP_STYLES[key];
          this.#tileLayer = L.tileLayer(style.url, { attribution: style.attr }).addTo(this.#map);
        }
        setTimeout(closePanel, 400);
      });
    };
    _initMapPicker();

    document.getElementById('trkHistoryToggle')?.addEventListener('click', () => {
      document.getElementById('trkHistoryPanel')?.classList.toggle('hidden');
    });
    document.getElementById('trkHistoryClose')?.addEventListener('click', () => {
      document.getElementById('trkHistoryPanel')?.classList.add('hidden');
    });

    // ── Permission ────────────────────────────────────────────────────────
    const permEl  = document.getElementById('trkPermission');
    const allowBtn = document.getElementById('trkPermAllow');
    const skipBtn  = document.getElementById('trkPermSkip');

    const _showMain = () => permEl?.classList.add('hidden');
    const _showPerm = () => permEl?.classList.remove('hidden');

    // Check current permission state — show/hide panel accordingly
    const _checkPerm = async () => {
      const granted = await hasGPSPermission();
      if (granted) _showMain(); else _showPerm();
    };
    void _checkPerm();

    // "Allow location" button — requests GPS, then upgrades map + weather
    allowBtn?.addEventListener('click', async () => {
      if (allowBtn) { (allowBtn as HTMLButtonElement).disabled = true; allowBtn.textContent = 'Requesting…'; }
      const coords = await requestGPSPermission();
      if (allowBtn) { (allowBtn as HTMLButtonElement).disabled = false; allowBtn.textContent = 'Allow location'; }
      if (coords) {
        _showMain();
        // Upgrade map center to GPS
        this._recenterMapToGPS(coords);
        // Upgrade weather to GPS
        void switchToGPSWeather();
        // Dispatch event so other modules know
        window.dispatchEvent(new CustomEvent('mapyou:gps-granted', { detail: { coords } }));
      } else {
        // Permission denied — show friendly message inside the panel
        const msg = permEl?.querySelector('.trk-perm__denied');
        if (msg) { (msg as HTMLElement).style.display = 'block'; }
        else {
          const p = document.createElement('p');
          p.className = 'trk-perm__denied';
          p.textContent = 'Location access denied. Enable it in browser settings to use tracking.';
          permEl?.querySelector('.trk-perm__card')?.appendChild(p);
        }
      }
    });

    // "Not now" — dismiss panel, app works with IP location
    skipBtn?.addEventListener('click', _showMain);

    // ── Sport selector button → opens categorized picker ──────────────────
    document.getElementById('trkSportBtn')?.addEventListener('click', () => {
      if (this.#tracker?.isActive || this.#timerActive) return;
      this._openTrackSportPicker(sport => this._setTrackSport(sport));
    });

    // ── Expandable panel (drag/tap the handle) ─────────────────────────────
    const trkBottom = document.getElementById('trkBottom');
    const handle    = document.getElementById('trkBottomHandle');
    handle?.addEventListener('click', () => trkBottom?.classList.toggle('trk-bottom--expanded'));
    // Basic swipe: up = expand, down = collapse
    let touchStartY = 0;
    handle?.addEventListener('touchstart', e => { touchStartY = e.touches[0].clientY; }, { passive: true });
    handle?.addEventListener('touchend', e => {
      const dy = e.changedTouches[0].clientY - touchStartY;
      if (dy < -20) trkBottom?.classList.add('trk-bottom--expanded');
      else if (dy > 20) trkBottom?.classList.remove('trk-bottom--expanded');
    }, { passive: true });

    // ── Share-location toggle (persisted, default ON) ──────────────────────
    const shareToggle = document.getElementById('trkShareLocToggle');
    const shareSub    = document.getElementById('trkShareLocSub');
    const applyShareUI = () => {
      const on = this._isLiveShareEnabled();
      shareToggle?.setAttribute('aria-checked', on ? 'true' : 'false');
      if (shareSub) shareSub.textContent = on ? 'Friends can watch you live' : "Friends won't see your location";
    };
    applyShareUI();
    shareToggle?.addEventListener('click', () => {
      const next = !this._isLiveShareEnabled();
      localStorage.setItem('mapyou_share_live_location', next ? 'true' : 'false');
      applyShareUI();
    });

    // ── Routes + Settings (placeholders for now) ───────────────────────────
    document.getElementById('trkRoutesBtn')?.addEventListener('click', () => void this._openRoutesScreen());
    document.getElementById('trkSettingsBtn')?.addEventListener('click', () => this._openTrackSettings());
    document.getElementById('trkGhostPillClear')?.addEventListener('click', () => this._clearGhostRoute());

    // ── START ─────────────────────────────────────────────────────────────
    document.getElementById('trkBtnStart')?.addEventListener('click', () => {
      const sport = this.#trackSport;
      if (isTrackable(sport)) {
        // GPS-tracked sports → map + live tracking (unchanged flow)
        if (!this.#tracker) return;
        this.#lastAnnouncedKm = 0;
        this.#wasAutoPaused = false;
        this.#lastLapCount = 0;
        if (this._isAutoPauseOn()) void this._requestMotionPermission();
        this.#tracker.setAutoPause(this._isAutoPauseOn());
        this.#tracker.start();
        // Only share live with friends if the user allows it
        if (this._isLiveShareEnabled()) void liveTracker.start();
        void this._requestWakeLock();
        this._enterTrackingView();
      } else {
        // Timer-only sports → stopwatch with Pause/Finish/Discard bar
        this._startTimerOnly();
      }
    });

    // ── PAUSE / RESUME ────────────────────────────────────────────────────
    document.getElementById('trkBtnPause')?.addEventListener('click', () => {
      if (this.#timerActive) {
        if (this.#timerPaused) this._resumeTimerOnly();
        else this._pauseTimerOnly();
        return;
      }
      if (!this.#tracker?.isActive) return;
      if (this.#tracker.isPaused) {
        this.#tracker.resume();
        void liveTracker.resume();   // ← wznów live tracking
        this._setTrackingState('active');
      } else {
        this.#tracker.pause();
        void liveTracker.pause();    // ← pauza live trackingu
        this._setTrackingState('paused');
      }
    });

    // ── STOP ──────────────────────────────────────────────────────────────
    document.getElementById('trkBtnStop')?.addEventListener('click', () => {
      if (this.#timerActive) { this._finishTimerOnly(); return; }
      if (!this.#tracker) return;
      const activity = this.#tracker.stop();
      void liveTracker.finish();   // ← zakończ live tracking
      void this._releaseWakeLock();
      this._exitTrackingView();
      if (!activity) return;

      this._finishWithActivity(activity);
    });

    // ── DISCARD ───────────────────────────────────────────────────────────
    document.getElementById('trkBtnDiscard')?.addEventListener('click', () => {
      if (this.#timerActive) { this._discardTimerOnly(); return; }
      if (!confirm('Discard activity?')) return;
      void liveTracker.finish();   // ← zakończ live tracking (jak przy Stop)
      this.#tracker?.reset();
      void this._releaseWakeLock();
      this._exitTrackingView();
    });

    // ── Expanded fullscreen stats (tap the stats card) ─────────────────────
    document.getElementById('trkStatsCard')?.addEventListener('click', () => {
      document.getElementById('trkExpanded')?.classList.remove('hidden');
    });
    document.getElementById('trkExpCollapse')?.addEventListener('click', () => {
      document.getElementById('trkExpanded')?.classList.add('hidden');
    });
    // Expanded controls forward to the real overlay buttons
    document.getElementById('trkExpPause')?.addEventListener('click', () => {
      document.getElementById('trkBtnPause')?.dispatchEvent(new Event('click'));
    });
    document.getElementById('trkExpStop')?.addEventListener('click', () => {
      document.getElementById('trkExpanded')?.classList.add('hidden');
      document.getElementById('trkBtnStop')?.dispatchEvent(new Event('click'));
    });
  }

  // Whether to share live location with friends (default ON, persisted)
  _isLiveShareEnabled(): boolean {
    return localStorage.getItem('mapyou_share_live_location') !== 'false';
  }

  // ── Track settings (persisted) ─────────────────────────────────────────────
  _isScreenLockOn(): boolean { return localStorage.getItem('mapyou_screen_lock') !== 'false'; } // default ON
  _isVoiceCuesOn():  boolean { return localStorage.getItem('mapyou_voice_cues')  === 'true'; }  // default OFF
  _isAutoPauseOn():  boolean { return localStorage.getItem('mapyou_auto_pause')  === 'true'; }  // default OFF

  // Request accelerometer permission (iOS Safari needs a gesture; Capacitor native is automatic)
  async _requestMotionPermission(): Promise<void> {
    try {
      const DME = (window as unknown as { DeviceMotionEvent?: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
      if (DME && typeof DME.requestPermission === 'function') await DME.requestPermission();
    } catch { /* denied or unsupported */ }
  }

  // Polish pluralization: 1 → one, 2-4 (not 12-14) → few, else → many
  _plural(n: number, one: string, few: string, many: string): string {
    const m10 = n % 10, m100 = n % 100;
    if (n === 1) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  _announceKm(km: number, paceMinKm: number, durationSec: number): void {
    const pm = Math.floor(paceMinKm);
    const ps = Math.round((paceMinKm - pm) * 60);
    const dm = Math.round(durationSec / 60);
    const kmWord  = this._plural(km, 'kilometr', 'kilometry', 'kilometrów');
    const minWord = this._plural(dm, 'minuta', 'minuty', 'minut');
    const paceTxt = paceMinKm > 0 && paceMinKm < 99
      ? `Średnie tempo ${pm} minut ${ps < 10 ? '0' + ps : ps} sekund na kilometr. ` : '';
    this._speak(`Pokonałeś ${km} ${kmWord}. ${paceTxt}Czas ${dm} ${minWord}.`);
  }

  _openTrackSettings(): void {
    document.getElementById('trkSettingsOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'trkSettingsOverlay';
    overlay.className = 'trk-picker-overlay';

    const tile = (id: string, icon: string, label: string, sub: string, on: boolean) => `
      <button class="trk-set-tile${on ? ' trk-set-tile--on' : ''}" data-set="${id}">
        <span class="trk-set-tile__icon">${icon}</span>
        <span class="trk-set-tile__label">${label}</span>
        <span class="trk-set-tile__sub">${sub}</span>
      </button>`;

    const render = () => {
      overlay.innerHTML = `<div class="trk-picker">
        <div class="trk-picker__head">
          <span class="trk-picker__title" id="trkSetTitle">Settings</span>
          <button class="trk-picker__close" id="trkSetClose">✕</button>
        </div>
        <div class="trk-set-grid">
          ${tile('screen_lock', '🔒', 'Screen lock', this._isScreenLockOn() ? 'Keep screen on' : 'Normal', this._isScreenLockOn())}
          ${tile('voice', '🔊', 'Voice cues', this._isVoiceCuesOn() ? 'On · every km' : 'Off', this._isVoiceCuesOn())}
          ${tile('auto_pause', '⏸️', 'Auto-pause', this._isAutoPauseOn() ? 'On' : 'Off', this._isAutoPauseOn())}
          ${this._isDevMode() ? tile('simulate', '🧪', 'Simulate run', 'dev', false) : ''}
        </div>
      </div>`;

      overlay.querySelector('#trkSetClose')?.addEventListener('click', () => overlay.remove());
      overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

      // Hidden: tap the title 5× to toggle developer mode
      let taps = 0;
      overlay.querySelector('#trkSetTitle')?.addEventListener('click', () => {
        if (++taps >= 5) {
          taps = 0;
          localStorage.setItem('mapyou_dev', this._isDevMode() ? 'false' : 'true');
          render();
        }
      });

      overlay.querySelectorAll<HTMLElement>('[data-set]').forEach(btn => {
        btn.addEventListener('click', () => {
          const id  = btn.dataset.set!;
          if (id === 'simulate') { overlay.remove(); this._openSimDialog(); return; }
          const key = id === 'screen_lock' ? 'mapyou_screen_lock'
                    : id === 'voice'       ? 'mapyou_voice_cues'
                    :                        'mapyou_auto_pause';
          const cur = id === 'screen_lock' ? this._isScreenLockOn()
                    : id === 'voice'       ? this._isVoiceCuesOn()
                    :                        this._isAutoPauseOn();
          localStorage.setItem(key, !cur ? 'true' : 'false');
          if (id === 'auto_pause' && this.#tracker) this.#tracker.setAutoPause(!cur);
          if (id === 'voice') {
            document.getElementById('voiceToggle')?.classList.toggle('active', !cur);
            if (!cur) this._speak('Komunikaty głosowe włączone.');
          }
          render();
        });
      });
    };
    render();
    document.body.appendChild(overlay);
  }

  // ── Routes screen (Saved routes + ghost overlay) ───────────────────────────
  async _openRoutesScreen(): Promise<void> {
    document.getElementById('trkRoutesOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'trkRoutesOverlay';
    overlay.className = 'trk-picker-overlay';
    overlay.innerHTML = `<div class="trk-picker">
      <div class="trk-picker__head">
        <span class="trk-picker__title">Routes</span>
        <button class="trk-picker__close" id="trkRoutesClose">✕</button>
      </div>
      <div class="trk-routes-tabs">
        <button class="trk-routes-tab trk-routes-tab--active" data-tab="saved">Saved</button>
        <button class="trk-routes-tab" data-tab="community">Community</button>
        <button class="trk-routes-tab" disabled title="Coming soon">Create</button>
      </div>
      <input class="trk-routes-search" id="trkRoutesSearch" placeholder="Search saved routes" />
      <div class="trk-routes-list" id="trkRoutesList"></div>
    </div>`;
    overlay.querySelector('#trkRoutesClose')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);

    const listEl   = overlay.querySelector('#trkRoutesList') as HTMLElement;
    const searchEl = overlay.querySelector('#trkRoutesSearch') as HTMLInputElement;
    let tab: 'saved' | 'community' = 'saved';
    let community: CommunityRoute[] = [];
    let communityLoaded = false;

    // ── Saved tab ──
    const renderSaved = (filter = '') => {
      const routes = getSavedRoutes();
      const q = filter.trim().toLowerCase();
      const shown = routes.filter(r => !q
        || getSportLabel(r.sport).toLowerCase().includes(q)
        || (r.name ?? '').toLowerCase().includes(q)
        || (r.date ?? '').toLowerCase().includes(q));
      if (shown.length === 0) {
        listEl.innerHTML = `<div class="trk-routes-empty">${routes.length === 0
          ? 'No saved routes yet. Finish a GPS activity, open it, and tap the ☆ to save it as a route.'
          : 'No routes match your search.'}</div>`;
        return;
      }
      listEl.innerHTML = shown.map(r => {
        const d = new Date(r.date);
        const dateTxt = isNaN(d.getTime()) ? '' : d.toLocaleDateString();
        return `<div class="trk-route-card" data-id="${r.id}">
          <span class="trk-route-card__icon">${getIcon(r.sport)}</span>
          <span class="trk-route-card__main">
            <span class="trk-route-card__title">${getSportLabel(r.sport)}</span>
            <span class="trk-route-card__meta">${dateTxt} · ${formatDuration(r.durationSec)} · ${formatDistance(r.distanceKm)} km</span>
          </span>
          <button class="trk-route-card__share" data-share="${r.id}" aria-label="Share to community" title="Share to community">⇪</button>
          <button class="trk-route-card__del" data-del="${r.id}" aria-label="Remove">✕</button>
        </div>`;
      }).join('');
      listEl.querySelectorAll<HTMLElement>('.trk-route-card').forEach(card => {
        card.addEventListener('click', () => {
          const r = getSavedRoutes().find(x => x.id === card.dataset.id);
          if (!r) return;
          this._loadGhostRoute(r.coords, r.name || getSportLabel(r.sport));
          overlay.remove();
        });
      });
      listEl.querySelectorAll<HTMLElement>('[data-share]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          const r = getSavedRoutes().find(x => x.id === btn.dataset.share);
          if (r) this._openPublishDialog(r);
        });
      });
      listEl.querySelectorAll<HTMLElement>('[data-del]').forEach(btn => {
        btn.addEventListener('click', e => {
          e.stopPropagation();
          unsaveRoute(btn.dataset.del!);
          renderSaved(searchEl.value);
        });
      });
    };

    // ── Community tab ──
    const renderCommunity = (filter = '') => {
      const q = filter.trim().toLowerCase();
      const shown = community.filter(r => !q
        || getSportLabel(r.sport).toLowerCase().includes(q)
        || (r.name ?? '').toLowerCase().includes(q)
        || (r.ownerName ?? '').toLowerCase().includes(q));
      if (shown.length === 0) {
        listEl.innerHTML = `<div class="trk-routes-empty">${community.length === 0
          ? 'No community routes near you yet. Be the first — share one from your Saved routes!'
          : 'No routes match your search.'}</div>`;
        return;
      }
      listEl.innerHTML = shown.map(r => {
        const avatar = r.ownerAvatarB64
          ? `<img class="trk-route-card__avatar" src="${r.ownerAvatarB64}" alt="" />`
          : `<span class="trk-route-card__avatar trk-route-card__avatar--ph">${(r.ownerName || '?').charAt(0).toUpperCase()}</span>`;
        return `<div class="trk-route-card" data-rid="${r.routeId}">
          ${avatar}
          <span class="trk-route-card__main">
            <span class="trk-route-card__title">${getIcon(r.sport)} ${r.name || getSportLabel(r.sport)}</span>
            <span class="trk-route-card__meta">${r.ownerName || 'MapYou User'} · ${formatDistance(r.distanceKm)} km</span>
          </span>
        </div>`;
      }).join('');
      listEl.querySelectorAll<HTMLElement>('.trk-route-card').forEach(card => {
        card.addEventListener('click', () => {
          const r = community.find(x => x.routeId === card.dataset.rid);
          if (!r) return;
          const coords = decodePolyline(r.coordsEnc) as Array<[number, number]>;
          this._loadGhostRoute(coords, r.name || getSportLabel(r.sport));
          overlay.remove();
        });
      });
    };

    const loadCommunity = async () => {
      listEl.innerHTML = '<div class="trk-routes-empty">Loading…</div>';
      try {
        const qs = new URLSearchParams();
        const c = this.#map?.getCenter?.();
        if (c) { qs.set('lat', String(c.lat)); qs.set('lng', String(c.lng)); qs.set('radiusKm', '25'); }
        const res  = await fetch(`${BACKEND_URL}/routes?${qs.toString()}`);
        const json = await res.json();
        community = (json.data ?? []) as CommunityRoute[];
      } catch { community = []; }
      communityLoaded = true;
      renderCommunity(searchEl.value);
    };

    const switchTab = (t: 'saved' | 'community') => {
      tab = t;
      overlay.querySelectorAll<HTMLElement>('.trk-routes-tab').forEach(b =>
        b.classList.toggle('trk-routes-tab--active', b.dataset.tab === t));
      searchEl.placeholder = t === 'saved' ? 'Search saved routes' : 'Search community routes';
      if (t === 'saved') renderSaved(searchEl.value);
      else if (communityLoaded) renderCommunity(searchEl.value);
      else void loadCommunity();
    };

    overlay.querySelectorAll<HTMLButtonElement>('.trk-routes-tab').forEach(b =>
      b.addEventListener('click', () => { if (!b.disabled) switchTab(b.dataset.tab as 'saved' | 'community'); }));
    searchEl.addEventListener('input', () => (tab === 'saved' ? renderSaved(searchEl.value) : renderCommunity(searchEl.value)));

    switchTab('saved');
  }

  // Shared finish pipeline (used by real Stop AND the dev simulator)
  _finishWithActivity(activity: ActivityRecord): void {
    showGoodJobSplash(() => {
      openSaveActivityModal(activity,
        async (enriched) => {
          await CS.saveActivity(activity);
          await CS.saveUnifiedWorkout({
            id:          enriched.id,
            type:        (enriched.sport === 'walking' || enriched.sport === 'cycling') ? enriched.sport : 'running',
            sport:       enriched.sport,
            source:      'tracking',
            date:        new Date(enriched.date).toISOString(),
            distanceKm:  enriched.distanceKm,
            durationSec: enriched.durationSec,
            paceMinKm:   enriched.paceMinKm,
            speedKmH:    enriched.speedKmH,
            elevGain:    0,
            coords:      enriched.coords,
            name:        enriched.name,
            description: enriched.description,
            notes:       enriched.notes,
            intensity:   enriched.intensity,
            photoUrl:    enriched.photoUrl,
          } as import('./modules/UnifiedWorkout.js').UnifiedWorkout);
          notifyActivityAdded(enriched.name || enriched.description, enriched.distanceKm, enriched.sport);
          this.#tracker?.reset();
          await this.#historyPanel?.render();
          await statsView.render();
          await homeView.render();
          homeView.switchToHome();
        },
        () => { this.#tracker?.reset(); },
      );
    });
  }

  // ── DEV: simulate a finished run (test without leaving home) ───────────────
  _isDevMode(): boolean { return localStorage.getItem('mapyou_dev') === 'true'; }

  _buildSyntheticLoop(center: [number, number], km: number): Array<[number, number]> {
    const circumM = Math.max(200, km * 1000);
    const radiusM = circumM / (2 * Math.PI);
    const dLat = radiusM / 111320;                                   // m → deg lat
    const dLng = radiusM / (111320 * Math.cos(center[0] * Math.PI / 180));
    const pts = Math.min(600, Math.max(20, Math.round(circumM / 10)));
    const out: Array<[number, number]> = [];
    for (let i = 0; i <= pts; i++) {
      const t = (i / pts) * 2 * Math.PI;
      out.push([center[0] + dLat * Math.sin(t), center[1] + dLng * Math.cos(t)]);
    }
    return out;
  }

  _makeFakeActivity(sport: string, coords: Array<[number, number]>, distanceKm: number, durationSec: number): ActivityRecord {
    const d = new Date();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const durMin = durationSec / 60;
    return {
      id:          'sim_' + Date.now().toString(36),
      sport:       sport as SportType,
      date:        d.toISOString(),
      distanceKm,
      durationSec,
      paceMinKm:   distanceKm > 0 ? durMin / distanceKm : 0,
      speedKmH:    durMin > 0 ? distanceKm / (durMin / 60) : 0,
      coords,
      description: `${getIcon(sport)} ${getSportLabel(sport)} on ${months[d.getMonth()]} ${d.getDate()}`,
    };
  }

  _openSimDialog(): void {
    document.getElementById('trkSimOverlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'trkSimOverlay';
    ov.className = 'trk-picker-overlay';
    const hasGhost = !!this.#ghostRoute;
    ov.innerHTML = `<div class="trk-picker trk-publish">
      <div class="trk-picker__head">
        <span class="trk-picker__title">🧪 Simulate run (dev)</span>
        <button class="trk-picker__close" id="trkSimClose">✕</button>
      </div>
      <div class="trk-publish__body">
        <label class="trk-publish__label">Source</label>
        <select class="trk-routes-search" id="trkSimSource">
          ${hasGhost ? '<option value="ghost">Loaded route (ghost)</option>' : ''}
          <option value="loop">Synthetic loop</option>
        </select>
        <label class="trk-publish__label">Distance (km) — used for synthetic loop</label>
        <input class="trk-routes-search" id="trkSimDist" type="number" min="0.5" step="0.1" value="5" />
        <label class="trk-publish__label">Duration (minutes)</label>
        <input class="trk-routes-search" id="trkSimDur" type="number" min="1" step="1" value="28" />
        <p class="trk-publish__note">Creates a finished activity (sport: ${getSportLabel(this.#trackSport)}) and opens the Finish modal — exactly as if you'd just run it.</p>
        <button class="trk-publish__btn" id="trkSimGo">Generate activity</button>
      </div>
    </div>`;
    ov.querySelector('#trkSimClose')?.addEventListener('click', () => ov.remove());
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.querySelector('#trkSimGo')?.addEventListener('click', () => {
      const source = (ov.querySelector('#trkSimSource') as HTMLSelectElement).value;
      const durMin = Math.max(1, Number((ov.querySelector('#trkSimDur') as HTMLInputElement).value) || 28);
      let coords: Array<[number, number]>;
      let km: number;
      if (source === 'ghost' && this.#ghostRoute) {
        coords = (this.#ghostRoute.getLatLngs() as L.LatLng[]).map(p => [p.lat, p.lng] as [number, number]);
        km = this._coordsDistanceKm(coords);
      } else {
        km = Math.max(0.5, Number((ov.querySelector('#trkSimDist') as HTMLInputElement).value) || 5);
        const c = this.#map?.getCenter?.();
        coords = this._buildSyntheticLoop(c ? [c.lat, c.lng] : [52.2297, 21.0122], km);
      }
      ov.remove();
      const activity = this._makeFakeActivity(this.#trackSport, coords, km, Math.round(durMin * 60));
      this._finishWithActivity(activity);
    });
    document.body.appendChild(ov);
  }

  _coordsDistanceKm(coords: Array<[number, number]>): number {
    let m = 0;
    for (let i = 1; i < coords.length; i++) {
      m += L.latLng(coords[i - 1][0], coords[i - 1][1]).distanceTo(L.latLng(coords[i][0], coords[i][1]));
    }
    return m / 1000;
  }

  _getUserId(): string { return localStorage.getItem('mapyou_userId_profile') ?? ''; }

  // Trim points within `meters` of the first/last point (privacy near home)
  _trimRouteEnds(coords: Array<[number, number]>, meters = 200): Array<[number, number]> {
    if (coords.length < 4) return coords;
    const near = (a: [number, number], b: [number, number]) =>
      L.latLng(a[0], a[1]).distanceTo(L.latLng(b[0], b[1])) < meters;
    let s = 0, e = coords.length - 1;
    while (s < e && near(coords[0], coords[s])) s++;
    while (e > s && near(coords[coords.length - 1], coords[e])) e--;
    const out = coords.slice(s, e + 1);
    return out.length >= 2 ? out : coords;
  }

  _openPublishDialog(route: SavedRoute): void {
    document.getElementById('trkPublishOverlay')?.remove();
    const ov = document.createElement('div');
    ov.id = 'trkPublishOverlay';
    ov.className = 'trk-picker-overlay';
    ov.innerHTML = `<div class="trk-picker trk-publish">
      <div class="trk-picker__head">
        <span class="trk-picker__title">Share to community</span>
        <button class="trk-picker__close" id="trkPubClose">✕</button>
      </div>
      <div class="trk-publish__body">
        <label class="trk-publish__label">Route name</label>
        <input class="trk-routes-search" id="trkPubName" value="${(route.name || getSportLabel(route.sport)).replace(/"/g, '&quot;')}" />
        <div class="trk-panel-row" style="border-top:none;padding-left:0;padding-right:0">
          <div class="trk-panel-row__text">
            <span class="trk-panel-row__label">Hide start &amp; end (~200 m)</span>
            <span class="trk-panel-row__sub">Protects your home location</span>
          </div>
          <button class="trk-toggle" id="trkPubTrim" role="switch" aria-checked="true"><span class="trk-toggle__knob"></span></button>
        </div>
        <p class="trk-publish__note">Your name and this route (start location) will be public to other users.</p>
        <button class="trk-publish__btn" id="trkPubGo">Publish</button>
      </div>
    </div>`;
    ov.querySelector('#trkPubClose')?.addEventListener('click', () => ov.remove());
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    const trimBtn = ov.querySelector('#trkPubTrim') as HTMLButtonElement;
    trimBtn.addEventListener('click', () =>
      trimBtn.setAttribute('aria-checked', trimBtn.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
    const goBtn = ov.querySelector('#trkPubGo') as HTMLButtonElement;
    goBtn.addEventListener('click', async () => {
      goBtn.disabled = true; goBtn.textContent = 'Publishing…';
      const name = (ov.querySelector('#trkPubName') as HTMLInputElement).value.trim();
      const trim = trimBtn.getAttribute('aria-checked') === 'true';
      const ok = await this._publishRoute(route, trim, name);
      goBtn.textContent = ok ? 'Published ✓' : 'Failed — retry';
      goBtn.disabled = false;
      if (ok) setTimeout(() => ov.remove(), 700);
    });
    document.body.appendChild(ov);
  }

  async _publishRoute(route: SavedRoute, trim: boolean, name: string): Promise<boolean> {
    let coords = route.coords;
    if (trim) coords = this._trimRouteEnds(coords);
    if (coords.length < 2) return false;
    const profile = loadProfileFromLocal();
    const body = {
      routeId:     route.id,
      ownerUserId: this._getUserId(),
      ownerName:   profile.name,
      sport:       route.sport,
      name:        name || getSportLabel(route.sport),
      distanceKm:  route.distanceKm,
      durationSec: route.durationSec,
      coordsEnc:   encodePolyline(coords),
      startLat:    coords[0][0],
      startLng:    coords[0][1],
      trimmed:     trim,
      source:      'recorded',
    };
    try {
      const res  = await fetch(`${BACKEND_URL}/routes`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      return json.status === 'ok';
    } catch { return false; }
  }

  _loadGhostRoute(coords: Array<[number, number]>, label: string): void {
    this._clearGhostRoute();
    if (!this.#map || !Array.isArray(coords) || coords.length < 2) return;
    // Faint dashed grey line — clearly distinct from the bright live route
    this.#ghostRoute = L.polyline(coords, {
      color: '#9aa0a6', weight: 5, opacity: 0.55,
      dashArray: '1 12', lineCap: 'round', lineJoin: 'round',
    }).addTo(this.#map);
    try { this.#map.fitBounds(this.#ghostRoute.getBounds(), { padding: [50, 50] }); } catch { /* ignore */ }

    const pill = document.getElementById('trkGhostPill');
    const txt  = document.getElementById('trkGhostPillTxt');
    if (txt)  txt.textContent = `Following: ${label}`;
    pill?.classList.remove('hidden');
  }

  _clearGhostRoute(): void {
    if (this.#ghostRoute) { try { this.#map?.removeLayer(this.#ghostRoute); } catch { /* ignore */ } this.#ghostRoute = null; }
    document.getElementById('trkGhostPill')?.classList.add('hidden');
  }

  // ── Track sport selection + timer-only mode ───────────────────────────────
  _setTrackSport(sport: string): void {
    this.#trackSport = sport;
    const emojiEl = document.getElementById('trkSportBtnEmoji');
    const labelEl = document.getElementById('trkSportBtnLabel');
    if (emojiEl) emojiEl.textContent = getIcon(sport);
    if (labelEl) labelEl.textContent = getSportLabel(sport);

    const trackable = isTrackable(sport);
    if (this.#tracker && trackable) this.#tracker.setSport(sport);
    liveTracker.setSport(sport);

    // Toggle map vs timer screen
    const timerScreen = document.getElementById('trkTimerScreen');
    const styleBtn    = document.getElementById('trkMapStyleBtn');
    if (trackable) {
      timerScreen?.classList.add('hidden');
      styleBtn?.classList.remove('hidden');
    } else {
      timerScreen?.classList.remove('hidden');
      styleBtn?.classList.add('hidden');
      this._startClock();
    }

    // Start button color + round sport button color (route color)
    const color = getColor(sport);
    const sb = document.getElementById('trkBtnStart') as HTMLElement | null;
    if (sb) { sb.style.background = color; sb.style.boxShadow = `0 6px 28px ${color}80`; }
    const spBtn = document.getElementById('trkSportBtn') as HTMLElement | null;
    if (spBtn) spBtn.style.setProperty('--trk-sport-color', color);
  }

  _startClock(): void {
    const clockEl = document.getElementById('trkTimerClock');
    const labelEl = document.getElementById('trkTimerScreen')?.querySelector('.trk-timer-screen__label');
    const tick = () => {
      if (this.#timerActive) return; // elapsed handled by timer loop
      const now = new Date();
      if (clockEl) clockEl.textContent = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
      if (labelEl) labelEl.textContent = 'Time of day';
    };
    tick();
    if (this.#clockInterval) clearInterval(this.#clockInterval);
    this.#clockInterval = setInterval(tick, 1000);
  }

  _timerElapsedSec(): number {
    const running = this.#timerActive && !this.#timerPaused
      ? (Date.now() - this.#timerStartMs) / 1000 : 0;
    return Math.floor(this.#timerAccumSec + running);
  }

  _renderTimerElapsed(): void {
    const sec = this._timerElapsedSec();
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const big = h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    const clockEl = document.getElementById('trkTimerClock');
    if (clockEl) clockEl.textContent = big;
    const timeEl = document.getElementById('trkTime');
    if (timeEl) timeEl.textContent = big;
  }

  _startTimerOnly(): void {
    this.#timerActive  = true;
    this.#timerPaused  = false;
    this.#timerStartMs = Date.now();
    this.#timerAccumSec = 0;
    void this._requestWakeLock();

    // Reuse the GPS control bar (Pause / Finish / Discard) over the timer screen
    const nav = document.querySelector<HTMLElement>('.bottom-nav');
    if (nav) nav.style.display = 'none';
    document.getElementById('trkBottom')?.style.setProperty('display', 'none');
    document.getElementById('trkHistoryToggle')?.style.setProperty('display', 'none');
    document.getElementById('trackerOverlay')?.classList.remove('hidden');
    // Hide GPS-only stats (distance + pace) — keep just the elapsed time
    document.getElementById('trkPace')?.closest('.tracker-overlay__stat')?.classList.add('hidden');
    document.getElementById('trkDist')?.closest('.tracker-overlay__stat')?.classList.add('hidden');
    const lbl = document.getElementById('trkTimerScreen')?.querySelector('.trk-timer-screen__label');
    if (lbl) lbl.textContent = 'Elapsed';

    this._setTrackingState('active');
    this._renderTimerElapsed();
    if (this.#timerInterval) clearInterval(this.#timerInterval);
    this.#timerInterval = setInterval(() => this._renderTimerElapsed(), 1000);
  }

  _pauseTimerOnly(): void {
    if (!this.#timerActive || this.#timerPaused) return;
    this.#timerAccumSec += (Date.now() - this.#timerStartMs) / 1000;
    this.#timerPaused = true;
    this._setTrackingState('paused');
  }

  _resumeTimerOnly(): void {
    if (!this.#timerActive || !this.#timerPaused) return;
    this.#timerStartMs = Date.now();
    this.#timerPaused = false;
    this._setTrackingState('active');
  }

  _exitTimerView(): void {
    this.#timerActive = false;
    this.#timerPaused = false;
    if (this.#timerInterval) { clearInterval(this.#timerInterval); this.#timerInterval = null; }
    void this._releaseWakeLock();
    document.getElementById('trackerOverlay')?.classList.add('hidden');
    document.getElementById('trkPace')?.closest('.tracker-overlay__stat')?.classList.remove('hidden');
    document.getElementById('trkDist')?.closest('.tracker-overlay__stat')?.classList.remove('hidden');
    const nav = document.querySelector<HTMLElement>('.bottom-nav');
    if (nav) nav.style.display = '';
    document.getElementById('trkBottom')?.style.setProperty('display', '');
    document.getElementById('trkHistoryToggle')?.style.setProperty('display', '');
    this._startClock();
  }

  _discardTimerOnly(): void {
    if (!confirm('Discard activity?')) return;
    this._exitTimerView();
  }

  _finishTimerOnly(): void {
    if (!this.#timerActive) return;
    const durationSec = this._timerElapsedSec();
    this._exitTimerView();

    const activity: import('./modules/Tracker.js').ActivityRecord = {
      id:          `act_${Date.now()}`,
      sport:       this.#trackSport as SportType,
      date:        new Date().toISOString(),
      distanceKm:  0,
      durationSec,
      paceMinKm:   0,
      speedKmH:    0,
      coords:      [],
      description: '',
    };

    showGoodJobSplash(() => {
      openSaveActivityModal(activity,
        async (enriched) => {
          await CS.saveActivity(activity);
          await CS.saveUnifiedWorkout({
            id:          enriched.id,
            type:        (enriched.sport === 'walking' || enriched.sport === 'cycling') ? enriched.sport : 'running',
            sport:       enriched.sport,
            source:      'tracking',
            date:        new Date(enriched.date).toISOString(),
            distanceKm:  0,
            durationSec: enriched.durationSec,
            paceMinKm:   0,
            speedKmH:    0,
            elevGain:    0,
            coords:      [],
            name:        enriched.name,
            description: enriched.description,
            notes:       enriched.notes,
            intensity:   enriched.intensity,
            photoUrl:    enriched.photoUrl,
          } as import('./modules/UnifiedWorkout.js').UnifiedWorkout);
          notifyActivityAdded(enriched.name || enriched.description, 0, enriched.sport);
          await this.#historyPanel?.render();
          await statsView.render();
          await homeView.render();
          homeView.switchToHome();
        },
        () => { /* onDiscard */ },
      );
    });
  }

  _openTrackSportPicker(onSelect: (sport: string) => void): void {
    openSportPicker(onSelect);
  }

  _enterTrackingView(): void {
    const nav = document.querySelector<HTMLElement>('.bottom-nav');
    if (nav) nav.style.display = 'none';
    document.getElementById('mapSearchBarMobile')?.classList.add('msb--hidden-tab');
    // Ukryj bottom bar (sport selector + start btn)
    const bottom = document.getElementById('trkBottom');
    if (bottom) bottom.style.display = 'none';
    const histBtn = document.getElementById('trkHistoryToggle');
    if (histBtn) histBtn.style.display = 'none';
    document.getElementById('tabMap')?.classList.add('tab-panel--active');
    document.getElementById('trackerOverlay')?.classList.remove('hidden');
    document.getElementById('routeMiniPill')?.classList.add('pill--above-tracker');
    this._setTrackingState('active');
    setTimeout(() => window.app.invalidateMapSize(), 150);
  }

  _exitTrackingView(): void {
    document.getElementById('trackerOverlay')?.classList.add('hidden');
    document.getElementById('trkExpanded')?.classList.add('hidden');
    document.getElementById('trkPausedBar')?.classList.add('hidden');
    document.getElementById('trkExpHeader')?.classList.remove('trk-expanded__header--paused');
    document.getElementById('trkExpLaps')?.setAttribute('hidden', '');
    this.#lastLapCount = 0;
    document.getElementById('routeMiniPill')?.classList.remove('pill--above-tracker');
    document.getElementById('tabMap')?.classList.remove('tab-panel--active');
    const nav = document.querySelector<HTMLElement>('.bottom-nav');
    if (nav) nav.style.display = '';
    // Przywróć bottom bar
    const bottom = document.getElementById('trkBottom');
    if (bottom) bottom.style.display = '';
    const histBtn = document.getElementById('trkHistoryToggle');
    if (histBtn) histBtn.style.display = '';
    this._setTrackingState('idle');
  }

  _setTrackingState(state: 'idle' | 'active' | 'paused'): void {
    const sport = this.#timerActive ? this.#trackSport : (this.#tracker?.currentSport ?? 'running');
    const color = getColor(sport);
    const pauseBtn   = document.getElementById('trkBtnPause') as HTMLElement | null;
    const stopBtn    = document.getElementById('trkBtnStop');
    const discardBtn = document.getElementById('trkBtnDiscard');

    if (state === 'active') {
      if (pauseBtn)  { pauseBtn.textContent = '⏸ Pause'; pauseBtn.style.background = color; }
      // Finish zawsze widoczny podczas nagrywania
      stopBtn?.classList.remove('hidden');
      discardBtn?.classList.add('hidden');
    } else if (state === 'paused') {
      if (pauseBtn)  { pauseBtn.textContent = '▶ Resume'; pauseBtn.style.background = '#555'; }
      stopBtn?.classList.remove('hidden');
      discardBtn?.classList.remove('hidden');
    }

    // Reflect manual pause in the yellow bar + fullscreen expanded view
    if (state !== 'idle') {
      const paused = state === 'paused';
      const bar = document.getElementById('trkPausedBar');
      if (bar) { bar.textContent = 'Paused'; bar.classList.toggle('hidden', !paused); }
      document.getElementById('trkExpHeader')?.classList.toggle('trk-expanded__header--paused', paused);
      const exSt = document.getElementById('trkExpStatus');
      if (exSt) exSt.textContent = paused ? 'Paused' : 'Recording';
      const exPause = document.getElementById('trkExpPause');
      if (exPause) exPause.textContent = paused ? '▶ Resume' : '⏸ Pause';
    }
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
    if (this.#routeLine) { this.#map.removeLayer(this.#routeLine); this.#routeLine = null; }
    this._stopRouteProgress();

    const [aLat, aLng] = this.#routePointA!;
    const [bLat, bLng] = this.#routePointB!;
    const profile =
      this.#routeActivityMode === 'cycling' ? 'cycling' :
      this.#routeActivityMode === 'walking' ? 'walking' : 'walking';

    const url = `${BACKEND_URL}/directions/${profile}/${aLng},${aLat};${bLng},${bLat}`;

    fetch(url)
      .then(r => r.json())
      .then((data: { routes?: Array<{ distance: number; duration: number; geometry: { coordinates: number[][] } }> }) => {
        if (!data.routes?.length) throw new Error('No route found');
        const route      = data.routes[0];
        const coords     = route.geometry.coordinates.map(c => [c[1], c[0]] as Coords);
        const totalDistM = route.distance;
        const distKm     = (totalDistM / 1000).toFixed(2);

        routeLoading.classList.add('hidden');
        routeDist.textContent = distKm;
        routeTime.textContent = String(Math.round(parseFloat(distKm) / this.#activitySpeeds[this.#routeActivityMode] * 60));
        routeResult.classList.remove('hidden');

        // Rysuj trasę
        const latLngs = coords.map(c => L.latLng(c[0], c[1]));
        this.#routeLine = L.polyline(latLngs, { color: '#00c46a', weight: 6, opacity: 0.85 }).addTo(this.#map);
        this.#map.fitBounds(this.#routeLine.getBounds(), { padding: [40, 40] });

        this._setupRouteProgress(coords, totalDistM);
      })
      .catch(() => {
        routeLoading.classList.add('hidden');
        routeDist.textContent = 'Error'; routeTime.textContent = '—';
        routeResult.classList.remove('hidden');
      });
  }

  _cancelRoute(): void {
    this.#routeMode = false; this.#routeStep = 0;
    this.#routePointA = null; this.#routePointB = null;
    if (this.#routeMarkerA) { this.#map.removeLayer(this.#routeMarkerA); this.#routeMarkerA = null; }
    if (this.#routeMarkerB) { this.#map.removeLayer(this.#routeMarkerB); this.#routeMarkerB = null; }
    if (this.#routeLine) { this.#map.removeLayer(this.#routeLine); this.#routeLine = null; }
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
  let activeTab = 'tabMap';
  let routeActive = false;

  const MOBILE_SEARCH_BAR = document.getElementById('mapSearchBarMobile');

  // Show search bar immediately if starting on Map tab
  // (without this, it stays hidden until user switches away and back)
  if (activeTab === 'tabMap') {
    setTimeout(() => {
      if (!routeActive) {
        SEARCH_BAR?.classList.remove('msb--hidden-tab', 'msb--hidden-route');
        SEARCH_BAR?.classList.add('msb--visible');
        MOBILE_SEARCH_BAR?.classList.remove('msb--hidden-tab', 'msb--hidden-route');
        MOBILE_SEARCH_BAR?.classList.add('msb--visible');
      }
    }, 100);
  }

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
        void _migrationReady.then(() => statsView.init());
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
    document.querySelector<HTMLElement>(`#${activeTab} .tab-scroll`)?.classList.add('tab-scroll--collapsed'); // collapse leaving tab before hiding
    document.getElementById(activeTab)?.classList.remove('tab-panel--active');
    document.querySelector<HTMLElement>(`.bottom-nav__item[data-tab="${activeTab}"]`)?.classList.remove('bottom-nav__item--active');
    activeTab = tabId;
    document.getElementById(activeTab)?.classList.add('tab-panel--active');
    document.querySelector<HTMLElement>(`.bottom-nav__item[data-tab="${activeTab}"]`)?.classList.add('bottom-nav__item--active');
    document.querySelector<HTMLElement>(`#${activeTab} .tab-scroll`)?.classList.remove('tab-scroll--collapsed');
    if (activeTab === 'tabMap') {
      if (!routeActive) showMobileSearch();
      setTimeout(() => window.app.invalidateMapSize(), 80);
    } else if (activeTab === 'tabTracker') {
      hideMobileSearchTab();
      // Show permission panel if GPS not yet granted
      void hasGPSPermission().then(granted => {
        const perm = document.getElementById('trkPermission');
        if (!perm) return;
        if (granted) perm.classList.add('hidden');
        else perm.classList.remove('hidden');
      });
    } else if (activeTab === 'tabHome') {
      hideMobileSearchTab();
      if (!homeViewInited) {
        homeViewInited = true;
        homeView.init();
      } else {
        // Always re-render when switching to Home so new workouts appear immediately
        void homeView.render();
      }
    } else if (activeTab === 'tabFriends') {
      hideMobileSearchTab();
      // Inicjalizuj FriendsView przy pierwszym wejściu
      if (!friendsViewInited) {
        friendsViewInited = true;
        friendsView.init();
      }
      // Pre-generuj link zaproszenia w tle żeby share był synchroniczny
      void friendsView._precacheInviteLink();
    } else {
      hideMobileSearchTab();
    }
    if (activeTab === 'tabStats') void _migrationReady.then(() => statsView.init());
  }

  // mirrorWorkoutList replaced by StatsView

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
  // Map loads from IP — show skeleton while tiles load
  showSkeleton();
  startMapTimeout();
  initOnlineDetector(() => void window.app._loadMapFromIP());
  initRetryBtn(pos => {
    const coords: Coords = [pos.coords.latitude, pos.coords.longitude];
    window.app._loadMap(coords);
  });

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
    const hasRoute = !document.getElementById('routeResult')?.classList.contains('hidden');
    // Widoczny gdy: aktywna zakładka ma zwinięty pasek LUB tracker jest aktywny
    const activePanel = document.querySelector('.tab-panel--active');
    const collapsed = !!activePanel?.querySelector('.tab-scroll.tab-scroll--collapsed');
    const trackerActive = !document.getElementById('trackerOverlay')?.classList.contains('hidden');
    pill?.classList.toggle('hidden', !(hasRoute && (collapsed || trackerActive)));
  }
  const obs = new MutationObserver(sync);
  const rr = document.getElementById('routeResult');
  if (rr) obs.observe(rr, { attributes: true });
  document.querySelectorAll('.tab-scroll').forEach(sc => obs.observe(sc, { attributes: true }));
  document.querySelectorAll('.tab-panel').forEach(p => obs.observe(p, { attributes: true }));
  const trackerOv = document.getElementById('trackerOverlay');
  if (trackerOv) obs.observe(trackerOv, { attributes: true });
})();

// ─── WEATHER COMPONENTS (top bar + modal) ────────────────────────────────────
void initWeatherComponents();

// ─── FRIENDS & LIVE TRACKING ─────────────────────────────────────────────────
const friendsView     = new FriendsView();
let   friendsViewInited = false;
let   homeViewInited    = false;

// Inicjalizuj FriendsView od razu — polling statusu znajomych musi działać
// niezależnie od tego czy użytkownik wszedł w zakładkę Friends
friendsView.init();
friendsViewInited = true;

// Inicjalizuj profil użytkownika (userId + avatar w UI)
initUserProfile();
// Migracja danych do unified workouts model
// Remove old migration flag so re-migration runs on every start (safe — uses upsert)
localStorage.removeItem('mapyou_unified_migrated');
const _migrationReady = migrateToUnified();

// Pokaż modal imienia przy pierwszym uruchomieniu
void showNameModalIfNeeded();

// Przycisk „Change name" w Settings
document.getElementById('btnChangeName')?.addEventListener('click', () => {
  openChangeNameModal();
});

// ─── Kod odzyskiwania (Settings) ─────────────────────────────────────────────
document.getElementById('settingRecovery')?.addEventListener('click', () => {
  const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
  if (userId) void showRecoveryCodeModal(userId);
});

// ─── Sync to cloud button (Settings) ─────────────────────────────────────────
document.getElementById('settingSync')?.addEventListener('click', async () => {
  localStorage.removeItem('mapyou_mongo_synced');
  localStorage.removeItem('mapyou_mongo_sync_failed_at');
  const sub = document.querySelector('#settingSync .settings-item__sub') as HTMLElement | null;

  const logs: string[] = [];
  const origLog  = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origErr  = console.error.bind(console);
  console.log   = (...a: unknown[]) => { logs.push(a.join(' ')); origLog(...a); };
  console.warn  = (...a: unknown[]) => { logs.push('WARN: ' + a.join(' ')); origWarn(...a); };
  console.error = (...a: unknown[]) => { logs.push('ERR: ' + a.join(' ')); origErr(...a); };

  if (sub) sub.textContent = 'Syncing...';

  try {
    await syncToMongoIfNeeded();
  } catch (e) {
    logs.push('CATCH: ' + String(e));
  }

  console.log   = origLog;
  console.warn  = origWarn;
  console.error = origErr;

  const panel = document.getElementById('settingsPanel');
  if (panel) {
    const logDiv = document.createElement('div');
    logDiv.style.cssText = 'background:#111;color:#0f0;font-size:11px;padding:12px;margin:8px;border-radius:8px;white-space:pre-wrap;word-break:break-all;max-height:300px;overflow:auto;';
    logDiv.textContent = logs.join('\n') || 'No logs captured';
    const existing = panel.querySelector('.sync-debug-log');
    if (existing) existing.remove();
    logDiv.classList.add('sync-debug-log');
    panel.appendChild(logDiv);
  }

  if (sub) sub.textContent = logs.some(l => l.includes('complete')) ? 'Sync complete!' : 'Sync failed — try again';
});

// ─── Sync do MongoDB Atlas (jednorazowa migracja z IndexedDB) ───────────────
void syncToMongoIfNeeded();

// ─── Generuj kod odzyskiwania dyskretnie w tle ────────────────────────────────
setTimeout(() => {
  const userId = localStorage.getItem('mapyou_userId_profile');
  if (userId) void ensureRecoveryCode(userId);
}, 3000);

// ─── Hydratacja — pobierz dane z Atlas do IndexedDB jeśli puste ──────────────
void CS.hydrate();
