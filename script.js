'use strict';

// ─── WORKOUT BASE CLASS ──────────────────────────────────────────
class Workout {
  date = new Date();
  id = (Date.now() + '').slice(-10);
  clicks = 0;

  constructor(coords, distance, duration) {
    this.coords = coords;
    this.distance = distance;
    this.duration = duration;
  }

  _setDescription() {
    // prettier-ignore
    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    this.description = `${this.type[0].toUpperCase()}${this.type.slice(1)} on ${months[this.date.getMonth()]} ${this.date.getDate()}`;
  }

  click() { this.clicks++; }
}

class Running extends Workout {
  type = 'running';
  constructor(coords, distance, duration, cadence) {
    super(coords, distance, duration);
    this.cadence = cadence;
    this.calcPace();
    this._setDescription();
  }
  calcPace() { this.pace = this.duration / this.distance; return this.pace; }
}

class Cycling extends Workout {
  type = 'cycling';
  constructor(coords, distance, duration, elevationGain) {
    super(coords, distance, duration);
    this.elevationGain = elevationGain;
    this.calcSpeed();
    this._setDescription();
  }
  calcSpeed() { this.speed = this.distance / (this.duration / 60); return this.speed; }
}

class Walking extends Workout {
  type = 'walking';
  constructor(coords, distance, duration, cadence) {
    super(coords, distance, duration);
    this.cadence = cadence;
    this.calcPace();
    this._setDescription();
  }
  calcPace() { this.pace = this.duration / this.distance; return this.pace; }
}

///////////////////////////////////////
// DOM REFS

const form = document.querySelector('.form');
const containerWorkouts = document.querySelector('.workouts');
const inputType = document.querySelector('.form__input--type');
const inputDistance = document.querySelector('.form__input--distance');
const inputDuration = document.querySelector('.form__input--duration');
const inputCadence = document.querySelector('.form__input--cadence');
const inputElevation = document.querySelector('.form__input--elevation');
const btnRoute = document.getElementById('btnRoute');
const routeInfo = document.getElementById('routeInfo');
const btnCancelRoute = document.getElementById('btnCancelRoute');
const stepAText = document.getElementById('stepAText');
const stepBText = document.getElementById('stepBText');
const routeResult = document.getElementById('routeResult');
const routeDist = document.getElementById('routeDist');
const routeTime = document.getElementById('routeTime');
const routeLoading = document.getElementById('routeLoading');
const btnTrack = document.getElementById('btnTrack');

// Map tile configs
const TILES = {
  day:   'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
  night: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const TILE_ATTR = {
  day:   '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  night: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
};

/* ===========================
   1. GLOBAL STATE
=========================== */
const NetState = {
  isOffline: false,
  mapReady:  false,
  retryCount: 0,
  timeoutId: null,
};

/* ===========================
   2. ONLINE / OFFLINE DETECTOR
=========================== */
function initOnlineDetector() {
  window.addEventListener('offline', () => enterOfflineMode());
  window.addEventListener('online',  () => exitOfflineMode());
  if (!navigator.onLine) enterOfflineMode();
}

/* ===========================
   3. SKELETON LOADER
=========================== */
function showSkeleton() {
  document.getElementById('mapSkeleton')?.classList.remove('hidden');
}
function hideSkeleton() {
  document.getElementById('mapSkeleton')?.classList.add('hidden');
  clearMapTimeout();
}

/* ===========================
   4. MAP READY SIGNAL
=========================== */
function onMapReady() {
  NetState.mapReady = true;
  NetState.retryCount = 0;
  hideSkeleton();
}

/* ===========================
   5. MAP TIMEOUT HANDLER
=========================== */
function startMapTimeout() {
  clearMapTimeout();
  NetState.timeoutId = setTimeout(() => {
    if (NetState.mapReady) return;
    document.getElementById('skeletonMsg')?.classList.remove('hidden');
  }, 10000);
}
function clearMapTimeout() {
  clearTimeout(NetState.timeoutId);
  NetState.timeoutId = null;
  document.getElementById('skeletonMsg')?.classList.add('hidden');
}

/* ===========================
   6. RETRY LOGIC
=========================== */
function initRetryBtn() {
  document.getElementById('btnRetry')?.addEventListener('click', async () => {
    NetState.retryCount++;
    document.getElementById('skeletonMsg')?.classList.add('hidden');
    showSkeleton();
    startMapTimeout();
    try {
      const pos = await new Promise((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { timeout: 8000 })
      );
      window._maptyApp?._destroyMap?.();
      window._maptyApp?._loadMap(pos);
    } catch {
      if (NetState.retryCount >= 2) {
        const yes = confirm('Could not connect to the map.\nSwitch to offline mode?');
        if (yes) enterOfflineMode();
        else document.getElementById('skeletonMsg')?.classList.remove('hidden');
      } else {
        document.getElementById('skeletonMsg')?.classList.remove('hidden');
      }
    }
  });
}

/* ===========================
   7. OFFLINE MODE — toast only, no overlay
=========================== */
function enterOfflineMode() {
  if (NetState.isOffline) return;
  NetState.isOffline = true;
  hideSkeleton();

  // Show offline badge permanently
  document.getElementById('offlineBadge')?.classList.remove('hidden');

  // Show 3-second toast then fade out
  showOfflineToast();
}

function showOfflineToast() {
  // Remove existing toast if any
  document.getElementById('offlineToast')?.remove();

  const toast = document.createElement('div');
  toast.id = 'offlineToast';
  toast.className = 'offline-toast';
  toast.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="1" y1="1" x2="23" y2="23"/>
      <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"/>
      <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"/>
      <path d="M10.71 5.05A16 16 0 0 1 22.56 9"/>
      <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"/>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"/>
      <circle cx="12" cy="20" r="1"/>
    </svg>
    <span>No internet — offline mode</span>
  `;
  // Append inside #map so it's scoped to map area
  const mapEl = document.getElementById('map');
  if (mapEl) mapEl.appendChild(toast);
  else document.body.appendChild(toast);

  // Fade in
  requestAnimationFrame(() => toast.classList.add('offline-toast--visible'));

  // Fade out after 3s
  setTimeout(() => {
    toast.classList.remove('offline-toast--visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
  }, 3000);
}

/* ===========================
   8. EXIT OFFLINE MODE
=========================== */
function exitOfflineMode() {
  if (!NetState.isOffline) return;
  NetState.isOffline = false;
  document.getElementById('offlineBadge')?.classList.add('hidden');
  if (!NetState.mapReady) {
    showSkeleton();
    startMapTimeout();
    window._maptyApp?._getPosition();
  }
}

/* ===========================
   9. APP STARTUP FLOW
=========================== */
function startApp() {
  initOnlineDetector();
  initRetryBtn();
  if (!navigator.onLine) return;
  showSkeleton();
  startMapTimeout();
}

// ─── MAIN APP CLASS ──────────────────────────────────────────────
class App {
  #map;
  #tileLayer = null;
  #mapZoomLevel = 13;
  #mapEvent;
  #workouts = [];

  // Route planner
  #routeMode = false;
  #routeStep = 0;
  #routePointA = null;
  #routePointB = null;
  #routingControl = null;
  #routeMarkerA = null;
  #routeMarkerB = null;
  #routeActivityMode = 'running';

  // Route progress
  // KEY FIX: progress line is drawn in a custom Leaflet pane with zIndex 650,
  // which is higher than the routing polyline pane (400) but below markers (600→800).
  // This guarantees the grey line always renders ON TOP of the green route.
  #routeCoords = [];
  #routeTotalDist = 0;
  #progressLine = null;
  #progressWatchId = null;
  #coveredUpToIndex = 0;
  #arrivedShown = false;
  #nearDestCount = 0;
  static #ARRIVAL_CONSEC = 3;
  static #ARRIVAL_DIST = 20;

  // Voice stats (Text-to-Speech)
  #voiceEnabled = false;
  #voiceKmAnnounced = 0;   // how many km milestones already announced
  #voiceStartTime = null;  // timestamp when tracking started (for pace calc)
  #voiceDistCovered = 0;   // metres covered since tracking start

  // Live tracking
  #trackingActive = false;
  #watchId = null;
  #trackingMarker = null;
  #trackingCoords = null;
  #prevTrackingCoords = null; // for distance accumulation

  // Lazy centering
  #userTouchingMap = false;
  #recenterTimer = null;

  // Night mode
  #nightMode = false;

  // Wake Lock
  #wakeLock = null;

  // PWA install
  #deferredInstallPrompt = null;

  #markers = new Map();
  #clusterGroup = null;  // Leaflet.markercluster group for workout markers
  #clusterEnabled = localStorage.getItem('clusterEnabled') === 'true';
  #poiMarkers = [];
  #userCoords = null;
  #autocompleteTimer = null;
  #filterDrag = { active: false, startX: 0, scrollLeft: 0 };

  #activitySpeeds = { running: 10, cycling: 20, walking: 5 };

  #activeWorkoutId = null;
  #workoutRouteLayer = null;

  // Custom pinned-place filters saved by user
  #customFilters = JSON.parse(localStorage.getItem('customFilters') || '[]');
  // Last clicked point on map (used by custom filter picker to bind a place)
  #pinnedCoord = null;

  #goalKm    = +(localStorage.getItem('goalKm')    || 35);
  #goalTime  = +(localStorage.getItem('goalTime')  || 300);
  #goalCount = +(localStorage.getItem('goalCount') || 7);
  #statsExpanded        = false;
  #statsWeekOffset      = 0;
  #statsSelectedDay     = null;
  #statsPrevGoalReached = false;

  constructor() {
    this._getPosition();
    this._getLocalStorage();
    startApp();
    window._maptyApp = this;

    form.addEventListener('submit', this._newWorkout.bind(this));
    inputType.addEventListener('change', this._toggleElevationField);
    containerWorkouts.addEventListener('click', this._moveToPopup.bind(this));
    btnRoute.addEventListener('click', this._startRouteMode.bind(this));
    btnCancelRoute.addEventListener('click', this._cancelRoute.bind(this));
    btnTrack.addEventListener('click', this._toggleTracking.bind(this));

    document.querySelectorAll('.route-mode-btn').forEach(btn =>
      btn.addEventListener('click', this._setActivityMode.bind(this))
    );

    this._initPOISearch();
    this._initSettings();
    this._initFilterScroll();
    this._initPWAInstall();
    this._initStats();
    this._initIOSBanner();
    this._initCustomFilters();

    // Restore preferences
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

  // ─── GEOLOCATION ─────────────────────────────────────────────────
  _destroyMap() {
    if (this.#map) {
      this.#map.remove();
      this.#map = null;
      this.#tileLayer = null;
      this.#clusterGroup = null;
      this.#markers.clear();
      NetState.mapReady = false;
    }
  }

  _getPosition() {
    if (navigator.geolocation)
      navigator.geolocation.getCurrentPosition(
        this._loadMap.bind(this),
        () => alert('Could not get your position')
      );
  }

  _loadMap(position) {
    const { latitude, longitude } = position.coords;
    const coords = [latitude, longitude];
    this.#userCoords = coords;

    this.#map = L.map('map').setView(coords, this.#mapZoomLevel);

    // Create a custom pane for the progress line with zIndex 650.
    // Leaflet's default polyline pane is 400; overlayPane is 200.
    // zIndex 650 puts our grey line above the route (400) but below markers (600-900).
    this.#map.createPane('progressPane');
    this.#map.getPane('progressPane').style.zIndex = 650;

    const tileKey = this.#nightMode ? 'night' : 'day';
    this.#tileLayer = L.tileLayer(TILES[tileKey], { attribution: TILE_ATTR[tileKey] }).addTo(this.#map);

    this.#map.on('click', this._handleMapClick.bind(this));

    // Signal map ready → hide skeleton
    this.#tileLayer.once('load', onMapReady);

    if (this.#clusterEnabled) {
      this.#clusterGroup = L.markerClusterGroup({
        maxClusterRadius: 60,
        iconCreateFunction: cluster => {
          const count = cluster.getChildCount();
          return L.divIcon({
            html: `<div class="workout-cluster"><span>${count}</span></div>`,
            className: '',
            iconSize: [40, 40],
            iconAnchor: [20, 20],
          });
        },
      });
      this.#map.addLayer(this.#clusterGroup);
    }
    this.#workouts.forEach(work => this._renderWorkoutMarker(work));

    this.#map.on('mousedown touchstart', () => {
      this.#userTouchingMap = true;
      clearTimeout(this.#recenterTimer);
    });
    this.#map.on('mouseup touchend', () => {
      this.#recenterTimer = setTimeout(() => { this.#userTouchingMap = false; }, 5000);
    });
  }

  // ─── SETTINGS ────────────────────────────────────────────────────
  _initSettings() {
    const btnGear     = document.getElementById('btnSettings');
    const panel       = document.getElementById('settingsPanel');
    const btnBack     = document.getElementById('btnSettingsBack');
    const itemShare   = document.getElementById('settingShare');
    const itemNight   = document.getElementById('settingNight');
    const nightToggle = document.getElementById('nightToggle');
    const itemVoice   = document.getElementById('settingVoice');
    const voiceToggle = document.getElementById('voiceToggle');
    const itemClear   = document.getElementById('settingClear');
    const itemInstall = document.getElementById('settingInstall');

    btnGear.addEventListener('click', e => { e.stopPropagation(); panel.classList.toggle('hidden'); });
    btnBack.addEventListener('click', () => panel.classList.add('hidden'));

    document.addEventListener('click', e => {
      if (!panel.classList.contains('hidden') && !panel.contains(e.target) && e.target !== btnGear)
        panel.classList.add('hidden');
    });

    itemShare.addEventListener('click', () => this._shareLocation());
    itemNight.addEventListener('click', () => this._toggleNightMode());
    nightToggle?.addEventListener('click', e => { e.stopPropagation(); this._toggleNightMode(); });
    itemVoice.addEventListener('click', () => this._toggleVoice());
    voiceToggle?.addEventListener('click', e => { e.stopPropagation(); this._toggleVoice(); });

    itemClear.addEventListener('click', () => {
      if (confirm('Delete all workouts?')) { localStorage.removeItem('workouts'); location.reload(); }
    });

    itemInstall?.addEventListener('click', () => {
      if (this.#deferredInstallPrompt) {
        this.#deferredInstallPrompt.prompt();
        this.#deferredInstallPrompt.userChoice.then(() => {
          this.#deferredInstallPrompt = null;
          if (itemInstall) itemInstall.style.display = 'none';
        });
      }
    });

    // Cluster markers toggle
    const clusterToggle = document.getElementById('clusterToggle');
    if (this.#clusterEnabled) clusterToggle?.classList.add('active');
    const doToggleCluster = () => {
      this.#clusterEnabled = !this.#clusterEnabled;
      localStorage.setItem('clusterEnabled', this.#clusterEnabled);
      clusterToggle?.classList.toggle('active', this.#clusterEnabled);
      location.reload();
    };
    document.getElementById('settingCluster')?.addEventListener('click', doToggleCluster);
    clusterToggle?.addEventListener('click', e => { e.stopPropagation(); doToggleCluster(); });
  }

  _initPWAInstall() {
    window.addEventListener('beforeinstallprompt', e => {
      e.preventDefault();
      this.#deferredInstallPrompt = e;
      const item = document.getElementById('settingInstall');
      if (item) item.style.display = 'flex';
    });
  }

  // ─── NIGHT MODE ──────────────────────────────────────────────────
  _toggleNightMode() {
    this.#nightMode = !this.#nightMode;
    document.body.classList.toggle('night-mode', this.#nightMode);
    document.getElementById('nightToggle')?.classList.toggle('active', this.#nightMode);
    localStorage.setItem('nightMode', this.#nightMode);

    if (this.#map && this.#tileLayer) {
      this.#map.removeLayer(this.#tileLayer);
      const key = this.#nightMode ? 'night' : 'day';
      this.#tileLayer = L.tileLayer(TILES[key], { attribution: TILE_ATTR[key] }).addTo(this.#map);
    }
  }

  // ─── VOICE STATS ─────────────────────────────────────────────────
  _toggleVoice() {
    this.#voiceEnabled = !this.#voiceEnabled;
    document.getElementById('voiceToggle')?.classList.toggle('active', this.#voiceEnabled);
    localStorage.setItem('voiceStats', this.#voiceEnabled);

    if (this.#voiceEnabled) {
      // Test TTS so browser grants audio permission
      this._speak('Voice stats enabled.');
    }
  }

  _speak(text) {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = 'pl-PL';
    utt.rate = 1.0;
    utt.pitch = 1.0;
    window.speechSynthesis.speak(utt);
  }

  // Called from tracking GPS fix — accumulates distance and triggers announcements
  _updateVoiceStats(lat, lng) {
    if (!this.#voiceEnabled || !this.#trackingActive) return;

    if (!this.#voiceStartTime) {
      this.#voiceStartTime = Date.now();
      this.#voiceDistCovered = 0;
      this.#voiceKmAnnounced = 0;
      this.#prevTrackingCoords = [lat, lng];
      return;
    }

    // Accumulate distance from previous fix
    if (this.#prevTrackingCoords) {
      const segM = this._haversine(this.#prevTrackingCoords, [lat, lng]);
      // Ignore GPS jumps > 100m between fixes (noise)
      if (segM < 100) this.#voiceDistCovered += segM;
    }
    this.#prevTrackingCoords = [lat, lng];

    const kmCovered = this.#voiceDistCovered / 1000;
    const nextMilestone = this.#voiceKmAnnounced + 1;

    if (kmCovered >= nextMilestone) {
      this.#voiceKmAnnounced = nextMilestone;

      const elapsedMin = (Date.now() - this.#voiceStartTime) / 60000;
      const paceMinPerKm = elapsedMin / kmCovered;
      const paceMin = Math.floor(paceMinPerKm);
      const paceSec = Math.round((paceMinPerKm - paceMin) * 60);
      const paceSec2 = paceSec < 10 ? `0${paceSec}` : `${paceSec}`;

      this._speak(
        `Pokonałeś ${nextMilestone} ${nextMilestone === 1 ? 'kilometr' : nextMilestone < 5 ? 'kilometry' : 'kilometrów'}. ` +
        `Średnie tempo: ${paceMin} minut ${paceSec2} sekund na kilometr.`
      );
    }
  }

  _resetVoiceStats() {
    this.#voiceKmAnnounced = 0;
    this.#voiceDistCovered = 0;
    this.#voiceStartTime = null;
    this.#prevTrackingCoords = null;
  }

  // ─── SHARE LOCATION ──────────────────────────────────────────────
  async _shareLocation() {
    const coords = this.#trackingCoords || this.#userCoords;
    if (!coords) { alert('Location not available yet. Start tracking first.'); return; }

    const [lat, lng] = coords;
    const url = `https://www.google.com/maps?q=${lat},${lng}`;

    if (navigator.share) {
      try { await navigator.share({ title: 'My location — Mapty', text: 'Here is my current location:', url }); return; }
      catch { /* cancelled */ }
    }

    try {
      await navigator.clipboard.writeText(url);
      this._showToast('📋 Link copied to clipboard!');
    } catch {
      prompt('Copy this link:', url);
    }
  }

  _showToast(message) {
    document.querySelector('.arrival-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'arrival-toast';
    toast.style.borderLeftColor = '#ffb545';
    toast.innerHTML = `<span class="arrival-toast__icon">📤</span><div><strong>${message}</strong></div><button class="arrival-toast__close">✕</button>`;
    document.body.appendChild(toast);
    toast.querySelector('.arrival-toast__close').addEventListener('click', () => toast.remove());
    setTimeout(() => toast?.remove(), 4000);
  }

  // ─── FILTER DRAG SCROLL ──────────────────────────────────────────
  _initFilterScroll() {
    const el = document.getElementById('poiFilters');
    if (!el) return;
    el.addEventListener('mousedown', e => {
      this.#filterDrag = { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft };
    });
    el.addEventListener('mouseleave', () => { this.#filterDrag.active = false; });
    el.addEventListener('mouseup',    () => { this.#filterDrag.active = false; });
    el.addEventListener('mousemove', e => {
      if (!this.#filterDrag.active) return;
      e.preventDefault();
      el.scrollLeft = this.#filterDrag.scrollLeft - (e.pageX - el.offsetLeft - this.#filterDrag.startX);
    });
  }

  // ─── SCREEN WAKE LOCK ────────────────────────────────────────────
  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
      this._updateWakeLockBadge(true);
    } catch { /* not available */ }
  }

  async _releaseWakeLock() {
    if (!this.#wakeLock) return;
    try { await this.#wakeLock.release(); } catch { /* ignore */ }
    this.#wakeLock = null;
    document.removeEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
    this._updateWakeLockBadge(false);
  }

  async _handleVisibilityChange() {
    if (this.#wakeLock !== null && document.visibilityState === 'visible' && this.#trackingActive)
      await this._requestWakeLock();
  }

  _updateWakeLockBadge(active) {
    let badge = btnTrack.querySelector('.wake-lock-badge');
    if (active) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'wake-lock-badge';
        badge.textContent = 'SCREEN ON';
        btnTrack.appendChild(badge);
      }
    } else {
      if (badge) badge.remove();
    }
  }

  // ─── LIVE TRACKING ───────────────────────────────────────────────
  _toggleTracking() {
    if (this.#trackingActive) this._stopTracking();
    else this._startTracking();
  }

  _startTracking() {
    if (!navigator.geolocation) return;

    this.#trackingActive = true;
    btnTrack.textContent = '⏹ Stop tracking';
    btnTrack.classList.add('tracking--active');
    this._requestWakeLock();
    this._resetVoiceStats();

    const dotIcon = L.divIcon({
      className: '',
      html: `<div class="tracking-dot"><div class="tracking-dot__pulse"></div><div class="tracking-dot__core"></div></div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    this.#watchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude: lat, longitude: lng } = position.coords;
        const latlng = [lat, lng];
        this.#trackingCoords = latlng;

        if (!this.#trackingMarker) {
          this.#trackingMarker = L.marker(latlng, { icon: dotIcon, zIndexOffset: 1000 }).addTo(this.#map);
          this.#map.setView(latlng, this.#mapZoomLevel, { animate: true });
        } else {
          this.#trackingMarker.setLatLng(latlng);
          if (!this.#userTouchingMap) {
            const markerPx = this.#map.latLngToContainerPoint(L.latLng(latlng));
            const centerPx = this.#map.getSize().divideBy(2);
            if (markerPx.distanceTo(centerPx) > 120) {
              this.#map.setView(latlng, this.#map.getZoom(), { animate: true, pan: { duration: 0.6 } });
            }
          }
        }

        // Update route progress
        if (this.#routeCoords.length > 0 && this.#progressLine) {
          this._updateRouteProgress(lat, lng);
        }

        // Update voice stats
        this._updateVoiceStats(lat, lng);
      },
      () => { alert('Could not get your position for tracking.'); this._stopTracking(); },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
    );
  }

  _stopTracking() {
    this.#trackingActive = false;
    this.#trackingCoords = null;
    btnTrack.textContent = '📍 Start tracking';
    btnTrack.classList.remove('tracking--active');
    this._releaseWakeLock();
    this._resetVoiceStats();

    if (this.#watchId !== null) { navigator.geolocation.clearWatch(this.#watchId); this.#watchId = null; }
    if (this.#trackingMarker) { this.#map.removeLayer(this.#trackingMarker); this.#trackingMarker = null; }
  }

  // ─── ROUTE PROGRESS ──────────────────────────────────────────────
  // THE FIX: progress line now uses pane:'progressPane' (zIndex 650).
  // Leaflet draws polylines in the overlayPane (zIndex 200) by default.
  // Leaflet Routing Machine also uses overlayPane.
  // By using a higher-z pane, the grey line always appears on top of green.

  _setupRouteProgress(routeCoords, totalDistM) {
    this.#routeCoords = routeCoords;
    this.#routeTotalDist = totalDistM;
    this.#coveredUpToIndex = 0;
    this.#arrivedShown = false;
    this.#nearDestCount = 0;

    if (this.#progressLine) { this.#map.removeLayer(this.#progressLine); this.#progressLine = null; }

    // Draw grey line in the custom high-z pane
    this.#progressLine = L.polyline([], {
      color: '#a0a0a0',
      weight: 7,
      opacity: 1,
      lineJoin: 'round',
      lineCap: 'round',
      pane: 'progressPane',   // ← THIS is what makes it render on top
    }).addTo(this.#map);

    if (!this.#trackingActive) this._startProgressOnlyWatch();
  }

  _startProgressOnlyWatch() {
    this.#progressWatchId = navigator.geolocation.watchPosition(
      position => {
        if (!this.#routeCoords.length) { navigator.geolocation.clearWatch(this.#progressWatchId); return; }
        this._updateRouteProgress(position.coords.latitude, position.coords.longitude);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  }

  _updateRouteProgress(lat, lng) {
    const userPt = L.latLng(lat, lng);
    let closestIdx = this.#coveredUpToIndex;
    let minDist = Infinity;

    for (let i = this.#coveredUpToIndex; i < this.#routeCoords.length; i++) {
      const d = userPt.distanceTo(L.latLng(this.#routeCoords[i]));
      if (d < minDist) { minDist = d; closestIdx = i; }
      if (d > minDist + 200 && i > this.#coveredUpToIndex + 15) break;
    }

    if (closestIdx > this.#coveredUpToIndex && minDist < 40) {
      this.#coveredUpToIndex = closestIdx;
      this.#progressLine.setLatLngs(this.#routeCoords.slice(0, this.#coveredUpToIndex + 1));
      this._updateRemainingStats();
    }

    const lastPt = L.latLng(this.#routeCoords[this.#routeCoords.length - 1]);
    if (userPt.distanceTo(lastPt) < App.#ARRIVAL_DIST) {
      this.#nearDestCount++;
    } else {
      this.#nearDestCount = 0;
    }

    if (this.#nearDestCount >= App.#ARRIVAL_CONSEC && !this.#arrivedShown) {
      this.#arrivedShown = true;
      this._showArrivalToast();
      if (this.#voiceEnabled) this._speak('Dotarłeś na miejsce. Cel osiągnięty!');
    }
  }

  _updateRemainingStats() {
    if (!this.#routeCoords.length) return;
    let remainM = 0;
    for (let i = this.#coveredUpToIndex; i < this.#routeCoords.length - 1; i++) {
      remainM += L.latLng(this.#routeCoords[i]).distanceTo(L.latLng(this.#routeCoords[i + 1]));
    }
    const remainKm = remainM / 1000;
    routeDist.textContent = remainKm.toFixed(2);
    routeTime.textContent = Math.max(0, Math.round((remainKm / this.#activitySpeeds[this.#routeActivityMode]) * 60));
  }

  _showArrivalToast() {
    document.querySelector('.arrival-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'arrival-toast';
    toast.innerHTML = `<span class="arrival-toast__icon">🎯</span><div><strong>You've arrived!</strong><p>Destination reached.</p></div><button class="arrival-toast__close">✕</button>`;
    document.body.appendChild(toast);
    toast.querySelector('.arrival-toast__close').addEventListener('click', () => toast.remove());
    setTimeout(() => toast?.remove(), 8000);
  }

  _stopRouteProgress() {
    if (this.#progressWatchId !== null) { navigator.geolocation.clearWatch(this.#progressWatchId); this.#progressWatchId = null; }
    if (this.#progressLine) { this.#map.removeLayer(this.#progressLine); this.#progressLine = null; }
    this.#routeCoords = [];
    this.#coveredUpToIndex = 0;
    this.#arrivedShown = false;
    this.#nearDestCount = 0;
    document.querySelector('.arrival-toast')?.remove();
  }

  // ─── MAP CLICK ───────────────────────────────────────────────────
  _handleMapClick(mapE) {
    // Always save clicked coords so custom filter picker can use them
    this.#pinnedCoord = [mapE.latlng.lat, mapE.latlng.lng];
    if (this.#routeMode && this.#routeStep < 3) this._handleRouteClick(mapE);
    else this._showForm(mapE);
  }

  _showForm(mapE) {
    this.#mapEvent = mapE;

    if (window.innerWidth <= 768) {
      // On mobile: show form as a centred overlay modal (like the custom filter modal)
      this._showFormModal();
    } else {
      form.classList.remove('hidden');
      inputDistance.focus();
    }
  }

  _showFormModal() {
    document.getElementById('workoutModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'workoutModal';
    modal.className = 'workout-modal';
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
      </div>
    `;
    document.body.appendChild(modal);

    const wmType    = document.getElementById('wm-type');
    const wmDist    = document.getElementById('wm-distance');
    const wmDur     = document.getElementById('wm-duration');
    const wmCad     = document.getElementById('wm-cadence');
    const wmElev    = document.getElementById('wm-elevation');
    const wmCadRow  = document.getElementById('wm-cadence-row');
    const wmElevRow = document.getElementById('wm-elev-row');

    wmType.addEventListener('change', () => {
      if (wmType.value === 'cycling') {
        wmCadRow.classList.add('hidden');
        wmElevRow.classList.remove('hidden');
      } else {
        // running + walking both use cadence
        wmCadRow.classList.remove('hidden');
        wmElevRow.classList.add('hidden');
      }
    });

    document.getElementById('wmCancel').addEventListener('click', () => modal.remove());

    document.getElementById('workoutModalForm').addEventListener('submit', e => {
      e.preventDefault();
      const type     = wmType.value;
      const distance = +wmDist.value;
      const duration = +wmDur.value;
      const { lat, lng } = this.#mapEvent.latlng;

      const validInputs = (...inputs) => inputs.every(inp => Number.isFinite(inp));
      const allPositive = (...inputs) => inputs.every(inp => inp > 0);

      let workout;
      if (type === 'running') {
        const cadence = +wmCad.value;
        if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
          return alert('Inputs have to be positive numbers!');
        workout = new Running([lat, lng], distance, duration, cadence);
      }
      if (type === 'cycling') {
        const elevation = +wmElev.value;
        if (!validInputs(distance, duration, elevation) || !allPositive(distance, duration))
          return alert('Inputs have to be positive numbers!');
        workout = new Cycling([lat, lng], distance, duration, elevation);
      }
      if (type === 'walking') {
        const cadence = +wmCad.value;
        if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
          return alert('Inputs have to be positive numbers!');
        workout = new Walking([lat, lng], distance, duration, cadence);
      }

      modal.remove();
      this.#workouts.push(workout);
      if (this.#routeCoords && this.#routeCoords.length > 1)
        workout.routeCoords = [...this.#routeCoords];
      this.#activeWorkoutId = '__pending__';
      this._renderWorkoutMarker(workout);
      this._renderWorkout(workout);
      this._setLocalStorage();
      this._renderStats(true);
      this._renderStreak();
    });

    setTimeout(() => wmDist.focus(), 100);
  }

  _hideForm() {
    inputDistance.value = inputDuration.value = inputCadence.value = inputElevation.value = '';
    form.style.display = 'none';
    form.classList.add('hidden');
    setTimeout(() => (form.style.display = 'grid'), 1000);

    if (window.innerWidth <= 768) {
      const sidebar = document.querySelector('.sidebar');
      sidebar.classList.remove('is-scrollable');
      sidebar.scrollTop = 0;
      sidebar.style.transition = 'height 0.32s cubic-bezier(0.4,0,0.2,1)';
      sidebar.style.height = '55vh';
    }
  }

  _toggleElevationField() {
    inputElevation.closest('.form__row').classList.toggle('form__row--hidden');
    inputCadence.closest('.form__row').classList.toggle('form__row--hidden');
  }

  // ─── WORKOUT ─────────────────────────────────────────────────────
  _newWorkout(e) {
    const validInputs = (...inputs) => inputs.every(inp => Number.isFinite(inp));
    const allPositive = (...inputs) => inputs.every(inp => inp > 0);
    e.preventDefault();

    const type = inputType.value;
    const distance = +inputDistance.value;
    const duration = +inputDuration.value;
    const { lat, lng } = this.#mapEvent.latlng;
    let workout;

    if (type === 'running') {
      const cadence = +inputCadence.value;
      if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
        return alert('Inputs have to be positive numbers!');
      workout = new Running([lat, lng], distance, duration, cadence);
    }

    if (type === 'cycling') {
      const elevation = +inputElevation.value;
      if (!validInputs(distance, duration, elevation) || !allPositive(distance, duration))
        return alert('Inputs have to be positive numbers!');
      workout = new Cycling([lat, lng], distance, duration, elevation);
    }

    if (type === 'walking') {
      const cadence = +inputCadence.value;
      if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
        return alert('Inputs have to be positive numbers!');
      workout = new Walking([lat, lng], distance, duration, cadence);
    }

    this.#workouts.push(workout);
    if (this.#routeCoords && this.#routeCoords.length > 1) {
      workout.routeCoords = [...this.#routeCoords];
    }
    // Signal that this marker should be shown immediately (not hidden like load-from-storage)
    this.#activeWorkoutId = '__pending__';
    this._renderWorkoutMarker(workout);
    this._renderWorkout(workout);
    this._hideForm();
    this._setLocalStorage();
    this._renderStats(true);
    this._renderStreak();
  }

  // ── Helpers: show / fully-hide a marker (invisible + not clickable) ──
  _showMarker(marker) {
    marker.setOpacity(1);
    if (marker._icon)   marker._icon.style.pointerEvents   = '';
    if (marker._shadow) marker._shadow.style.pointerEvents = '';
    // Icons may not be in DOM yet (called right after addTo) — wait one tick
    setTimeout(() => {
      if (marker._icon)   marker._icon.style.pointerEvents   = '';
      if (marker._shadow) marker._shadow.style.pointerEvents = '';
    }, 0);
  }

  _hideMarker(marker) {
    marker.setOpacity(0);
    marker.closePopup();
    setTimeout(() => {
      if (marker._icon)   marker._icon.style.pointerEvents   = 'none';
      if (marker._shadow) marker._shadow.style.pointerEvents = 'none';
    }, 0);
  }

  _renderWorkoutMarker(workout) {
    const icon = workout.type === 'running' ? '🏃‍♂️' : workout.type === 'cycling' ? '🚴‍♀️' : '🚶';
    const popupClass = workout.type === 'running' ? 'running-popup'
      : workout.type === 'cycling' ? 'cycling-popup' : 'walking-popup';

    const target = this.#clusterGroup || this.#map;
    const marker = L.marker(workout.coords)
      .bindPopup(L.popup({ maxWidth: 250, minWidth: 100, autoClose: false, closeOnClick: false, className: popupClass }))
      .setPopupContent(`${icon} ${workout.description}`);
    target.addLayer(marker);
    this.#markers.set(workout.id, marker);

    if (this.#clusterEnabled) {
      this._showMarker(marker);
      if (this.#activeWorkoutId === '__pending__') {
        this.#activeWorkoutId = workout.id;
        marker.openPopup();
      }
    } else {
      if (this.#activeWorkoutId === '__pending__') {
        this.#markers.forEach((m, id) => { if (id !== workout.id) this._hideMarker(m); });
        this._showMarker(marker);
        marker.openPopup();
        this.#activeWorkoutId = workout.id;
      } else {
        this._hideMarker(marker);
      }
    }
  }

  // Build route thumbnail using OpenStreetMap static tile + SVG overlay in an absolute-positioned div
  _buildRouteThumbnail(routeCoords) {
    if (!routeCoords || routeCoords.length < 2) return '';

    const lats = routeCoords.map(c => c[0]);
    const lngs = routeCoords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const cLat   = (minLat + maxLat) / 2;
    const cLng   = (minLng + maxLng) / 2;

    // Pick a zoom level so the route fits in 80x80px tile
    const latSpan = maxLat - minLat || 0.002;
    const lngSpan = maxLng - minLng || 0.002;
    const span = Math.max(latSpan, lngSpan);
    let zoom = 15;
    if (span > 0.05) zoom = 13;
    else if (span > 0.02) zoom = 14;
    else if (span > 0.008) zoom = 15;
    else zoom = 16;

    // OSM tile for the centre point
    const tileUrl = `https://tile.openstreetmap.org/${zoom}/${this._lngToTileX(cLng, zoom)}/${this._latToTileY(cLat, zoom)}.png`;

    // Project routeCoords onto the 80×80 thumbnail
    const W = 80, H = 80, PAD = 4;
    const ranLat = maxLat - minLat || 0.001;
    const ranLng = maxLng - minLng || 0.001;
    const toX = lng => PAD + ((lng - minLng) / ranLng) * (W - 2 * PAD);
    const toY = lat => (H - PAD) - ((lat - minLat) / ranLat) * (H - 2 * PAD);
    const pts = routeCoords
      .filter((_, i) => i % Math.max(1, Math.floor(routeCoords.length / 60)) === 0)
      .map(c => `${toX(c[1]).toFixed(1)},${toY(c[0]).toFixed(1)}`).join(' ');

    return `<div class="workout__thumb-wrap">
      <img class="workout__thumb-map" src="${tileUrl}" crossorigin="anonymous"
           onerror="this.style.display='none'" alt=""/>
      <svg class="workout__thumb-svg" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
        <polyline points="${pts}" fill="none" stroke="#00c46a" stroke-width="3"
                  stroke-linecap="round" stroke-linejoin="round" opacity="0.9"/>
      </svg>
    </div>`;
  }

  _lngToTileX(lng, zoom) {
    return Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
  }
  _latToTileY(lat, zoom) {
    const r = Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * Math.pow(2, zoom));
  }

  _renderWorkout(workout) {
    const icon = workout.type === 'running' ? '🏃‍♂️'
      : workout.type === 'cycling' ? '🚴‍♀️'
        : '🚶';

    const thumb = this._buildRouteThumbnail(workout.routeCoords);

    let html = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <h2 class="workout__title">${workout.description}</h2>
        ${thumb ? `<div class="workout__thumb-container">${thumb}</div>` : ''}
        <div class="workout__details">
          <span class="workout__icon">${icon}</span>
          <span class="workout__value">${workout.distance}</span>
          <span class="workout__unit">km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⏱</span>
          <span class="workout__value">${workout.duration}</span>
          <span class="workout__unit">min</span>
        </div>
    `;

    if (workout.type === 'running' || workout.type === 'walking')
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡️</span>
          <span class="workout__value">${workout.pace.toFixed(1)}</span>
          <span class="workout__unit">min/km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">🦶🏼</span>
          <span class="workout__value">${workout.cadence}</span>
          <span class="workout__unit">spm</span>
        </div>
      </li>`;

    if (workout.type === 'cycling')
      html += `
        <div class="workout__details">
          <span class="workout__icon">⚡️</span>
          <span class="workout__value">${workout.speed.toFixed(1)}</span>
          <span class="workout__unit">km/h</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⛰</span>
          <span class="workout__value">${workout.elevationGain}</span>
          <span class="workout__unit">m</span>
        </div>
      </li>`;

    html = html.replace('</li>', `
        <button class="workout__delete" data-id="${workout.id}" title="Delete workout">✕</button>
      </li>`);

    form.insertAdjacentHTML('afterend', html);
  }

  _moveToPopup(e) {
    if (!this.#map) return;
    const deleteBtn = e.target.closest('.workout__delete');
    if (deleteBtn) { e.stopPropagation(); this._deleteWorkout(deleteBtn.dataset.id); return; }
    const workoutEl = e.target.closest('.workout');
    if (!workoutEl) return;
    const workout = this.#workouts.find(w => w.id === workoutEl.dataset.id);
    if (!workout) return;

    if (this.#clusterEnabled) {
      document.querySelectorAll('.workout').forEach(el => el.classList.remove('workout--active'));
      this._clearWorkoutRoute();
      if (this.#activeWorkoutId === workout.id) {
        this.#activeWorkoutId = null;
      } else {
        this.#activeWorkoutId = workout.id;
        workoutEl.classList.add('workout--active');
        this.#map.setView(workout.coords, this.#mapZoomLevel, { animate: true, pan: { duration: 1 } });
        const marker = this.#markers.get(workout.id);
        if (marker) marker.openPopup();
        if (workout.routeCoords?.length > 1) this._showWorkoutRoute(workout.routeCoords);
      }
    } else {
      const isSame = this.#activeWorkoutId === workout.id;
      this.#markers.forEach(m => this._hideMarker(m));
      this._clearWorkoutRoute();
      document.querySelectorAll('.workout').forEach(el => el.classList.remove('workout--active'));
      if (isSame) {
        this.#activeWorkoutId = null;
      } else {
        this.#activeWorkoutId = workout.id;
        workoutEl.classList.add('workout--active');
        const marker = this.#markers.get(workout.id);
        if (marker) { this._showMarker(marker); marker.openPopup(); }
        this.#map.setView(workout.coords, this.#mapZoomLevel, { animate: true, pan: { duration: 1 } });
        if (workout.routeCoords?.length > 1) this._showWorkoutRoute(workout.routeCoords);
      }
    }
  }

  _showWorkoutRoute(coords) {
    this._clearWorkoutRoute();
    this.#workoutRouteLayer = L.polyline(coords, {
      color: '#00c46a', weight: 4, opacity: 0.75, dashArray: '8 6',
    }).addTo(this.#map);
  }

  _clearWorkoutRoute() {
    if (this.#workoutRouteLayer) {
      this.#map.removeLayer(this.#workoutRouteLayer);
      this.#workoutRouteLayer = null;
    }
  }

  _deleteWorkout(id) {
    const marker = this.#markers.get(id);
    if (marker) {
      // Remove from cluster group or map
      if (this.#clusterGroup) this.#clusterGroup.removeLayer(marker);
      else this.#map.removeLayer(marker);
      this.#markers.delete(id);
    }
    if (this.#activeWorkoutId === id) {
      this.#activeWorkoutId = null;
      this._clearWorkoutRoute();
    }
    this.#workouts = this.#workouts.filter(w => w.id !== id);
    const el = document.querySelector(`.workout[data-id="${id}"]`);
    if (el) {
      el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
      el.style.transform = 'translateX(-110%)';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 300);
    }
    this._setLocalStorage();
    this._renderStats();
    this._renderStreak();
  }

  _setLocalStorage() { localStorage.setItem('workouts', JSON.stringify(this.#workouts)); }

  _getLocalStorage() {
    const data = JSON.parse(localStorage.getItem('workouts'));
    if (!data) return;
    this.#workouts = data;
    this.#workouts.forEach(work => this._renderWorkout(work));
    this._renderStats();
    this._renderStreak();
  }

  reset() { localStorage.removeItem('workouts'); location.reload(); }

  // ─── iOS BANNER ──────────────────────────────────────────────────
  _initIOSBanner() {
    const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
    const standalone = ('standalone' in navigator && navigator.standalone)
      || window.matchMedia('(display-mode: standalone)').matches;
    if (!isIOS || standalone || localStorage.getItem('iosBannerDismissed')) return;
    const banner = document.getElementById('iosInstallBanner');
    const close  = document.getElementById('iosInstallClose');
    if (!banner) return;
    setTimeout(() => banner.classList.remove('hidden'), 2500);
    close?.addEventListener('click', () => {
      banner.classList.add('hidden');
      localStorage.setItem('iosBannerDismissed', '1');
    });
  }

  // ─── STREAK ──────────────────────────────────────────────────────
  _renderStreak() {
    const countEl = document.getElementById('streakCount');
    const dotsEl  = document.getElementById('streakDots');
    if (!countEl || !dotsEl) return;

    // Build a set of unique dates (YYYY-MM-DD) that have workouts
    const workoutDates = new Set(
      this.#workouts.map(w => new Date(w.date).toDateString())
    );

    // Count consecutive days ending today (or yesterday if no workout today)
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      if (workoutDates.has(d.toDateString())) streak++;
      else break;
    }

    countEl.textContent = streak;

    // Show last 7 days as dots
    dotsEl.innerHTML = '';
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const active = workoutDates.has(d.toDateString());
      const dot = document.createElement('div');
      dot.className = 'streak-bar__dot' + (active ? ' active' : '');
      dotsEl.appendChild(dot);
    }
  }

  // ─── WEEKLY STATS ────────────────────────────────────────────────
  _getWeekBounds(off = 0) {
    const now = new Date();
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() + (dow === 0 ? -6 : 1 - dow) + off * 7);
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { mon, sun };
  }

  _getWeekWorkouts(off = 0) {
    const { mon, sun } = this._getWeekBounds(off);
    return this.#workouts.filter(w => { const d = new Date(w.date); return d >= mon && d <= sun; });
  }

  _initStats() {
    const panel   = document.getElementById('statsPanel');
    const detail  = document.getElementById('statsDetail');
    const editor  = document.getElementById('statsGoalEditor');
    const inKm    = document.getElementById('goalKmInput');
    const inTime  = document.getElementById('goalTimeInput');
    const inCnt   = document.getElementById('goalCountInput');
    const prevBtn = document.getElementById('statsWeekPrev');
    const nextBtn = document.getElementById('statsWeekNext');
    if (!panel) return;

    if (inKm)   inKm.value   = this.#goalKm;
    if (inTime) inTime.value = this.#goalTime;
    if (inCnt)  inCnt.value  = this.#goalCount;

    panel.addEventListener('click', () => {
      this.#statsExpanded = !this.#statsExpanded;
      detail?.classList.toggle('hidden', !this.#statsExpanded);
      editor?.classList.toggle('hidden', !this.#statsExpanded);
      if (window.innerWidth <= 768) {
        const sidebar = document.querySelector('.sidebar');
        if (this.#statsExpanded) {
          sidebar?.classList.add('is-scrollable');
        } else {
          sidebar?.classList.remove('is-scrollable');
          if (sidebar) sidebar.scrollTop = 0;
        }
      }
    });
    detail?.addEventListener('click', e => e.stopPropagation());
    editor?.addEventListener('click', e => e.stopPropagation());

    prevBtn?.addEventListener('click', e => {
      e.stopPropagation();
      this.#statsWeekOffset--;
      this.#statsSelectedDay = null;
      if (nextBtn) nextBtn.disabled = false;
      this._renderStats();
    });
    nextBtn?.addEventListener('click', e => {
      e.stopPropagation();
      if (this.#statsWeekOffset >= 0) return;
      this.#statsWeekOffset++;
      this.#statsSelectedDay = null;
      if (this.#statsWeekOffset === 0 && nextBtn) nextBtn.disabled = true;
      this._renderStats();
    });

    const goal = (field, key, el, fb) => el?.addEventListener('change', () => {
      this[field] = Math.max(1, +el.value || fb);
      el.value = this[field];
      localStorage.setItem(key, this[field]);
      this._renderStats();
    });
    goal('#goalKm',    'goalKm',    inKm,   35);
    goal('#goalTime',  'goalTime',  inTime, 300);
    goal('#goalCount', 'goalCount', inCnt,  7);
  }

  _renderStats(animate = false) {
    const off   = this.#statsWeekOffset;
    const weekW = this._getWeekWorkouts(off);
    const { mon } = this._getWeekBounds(off);

    const wKm  = weekW.reduce((s, w) => s + (w.distance || 0), 0);
    const wMin = weekW.reduce((s, w) => s + (w.duration  || 0), 0);
    const wCnt = weekW.length;

    let sub = weekW;
    if (this.#statsSelectedDay !== null)
      sub = weekW.filter(w => Math.floor((new Date(w.date) - mon) / 86400000) === this.#statsSelectedDay);
    const sKm  = sub.reduce((s, w) => s + (w.distance || 0), 0);
    const sMin = sub.reduce((s, w) => s + (w.duration  || 0), 0);
    const sCnt = sub.length;

    const CIRC = 226.2;
    const ring = (id, pct) => {
      const el = document.getElementById(id);
      if (!el) return;
      const t = Math.max(0, CIRC - Math.min(pct, 1) * CIRC);
      if (animate) {
        el.style.transition = 'none';
        el.setAttribute('stroke-dashoffset', CIRC);
        void el.getBoundingClientRect();
        el.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)';
      }
      requestAnimationFrame(() => el.setAttribute('stroke-dashoffset', t.toFixed(1)));
    };
    ring('statsRingKm',       wKm  / this.#goalKm);
    ring('statsRingTime',     wMin / this.#goalTime);
    ring('statsRingWorkouts', wCnt / this.#goalCount);

    const fmtT = m => m >= 60 ? `${Math.floor(m/60)}h ${Math.round(m%60)}m` : `${Math.round(m)}m`;
    const set  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    set('statsValKm',       wKm.toFixed(1));
    set('statsValTime',     fmtT(wMin));
    set('statsValWorkouts', wCnt);

    const pct = Math.min(Math.round((wKm / this.#goalKm) * 100), 100);
    set('statsGoalPct', pct + '%');
    const fill = document.getElementById('statsGoalFill');
    if (fill) fill.style.width = pct + '%';

    if (pct >= 100 && !this.#statsPrevGoalReached && animate) {
      this.#statsPrevGoalReached = true;
      this._showGoalCelebration();
    } else if (pct < 100) { this.#statsPrevGoalReached = false; }

    const nxt = document.getElementById('statsWeekNext');
    if (off === 0) { set('statsWeekLabel', 'This week'); if (nxt) nxt.disabled = true; }
    else {
      const su = new Date(mon); su.setDate(mon.getDate() + 6);
      const fmt = d => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      set('statsWeekLabel', `${fmt(mon)}–${fmt(su)}`);
      if (nxt) nxt.disabled = false;
    }

    set('statsDetailKm',    sKm.toFixed(1));
    set('statsDetailTime',  fmtT(sMin));
    set('statsDetailCount', sCnt);
    set('statsDetailDate',  this.#statsSelectedDay !== null
      ? (() => { const d = new Date(mon); d.setDate(mon.getDate() + this.#statsSelectedDay); return d.getDate(); })()
      : '—');

    this._renderDayBars(weekW, mon);
    this._filterWorkoutsList(weekW);
  }

  _filterWorkoutsList(weekWorkouts) {
    const weekIds = new Set(weekWorkouts.map(w => w.id));
    document.querySelectorAll('.workout').forEach(el => {
      el.style.display = weekIds.has(el.dataset.id) ? '' : 'none';
    });
  }

  _renderDayBars(ww, mon) {
    const el = document.getElementById('statsDetailBars');
    if (!el) return;
    const N = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const km = Array(7).fill(0), tp = Array(7).fill('none'), dt = Array(7);
    for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); dt[i] = d.getDate(); }
    ww.forEach(w => { const i = Math.floor((new Date(w.date) - mon) / 86400000); if (i >= 0 && i < 7) { km[i] += w.distance || 0; tp[i] = w.type; } });
    const max = Math.max(...km, 0.1);
    el.innerHTML = N.map((name, i) => {
      const h = Math.round((km[i] / max) * 48);
      const c = tp[i] === 'running' ? '#00c46a' : tp[i] === 'cycling' ? '#ffb545' : tp[i] === 'walking' ? '#5badea' : '#3a4147';
      const a = this.#statsSelectedDay === i ? ' active' : '';
      return `<div class="stats-detail__day-col${a}" data-day="${i}"><div class="stats-detail__bar" style="height:${Math.max(h,km[i]>0?4:2)}px;background:${c}"></div><div class="stats-detail__day-name">${name}</div><div class="stats-detail__day-date">${dt[i]}</div></div>`;
    }).join('');
    el.querySelectorAll('.stats-detail__day-col').forEach(col =>
      col.addEventListener('click', e => {
        e.stopPropagation();
        const day = +col.dataset.day;
        this.#statsSelectedDay = this.#statsSelectedDay === day ? null : day;
        this._renderStats();
      })
    );
  }

  _showGoalCelebration() {
    const p = document.getElementById('statsPanel');
    p?.classList.add('goal-reached');
    setTimeout(() => p?.classList.remove('goal-reached'), 800);
    document.querySelector('.stats-goal-toast')?.remove();
    const t = document.createElement('div');
    t.className = 'stats-goal-toast';
    t.innerHTML = `<span class="stats-goal-toast__emoji">🏆</span><span class="stats-goal-toast__title">Weekly goal reached!</span><span class="stats-goal-toast__sub">Amazing — you crushed it 🎉</span>`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.transition = 'opacity 0.5s'; t.style.opacity = '0'; setTimeout(() => t.remove(), 500); }, 3500);
  }

  // ─── CUSTOM PINNED FILTERS ───────────────────────────────────────
  _initCustomFilters() {
    this._renderCustomFilterBtns();
  }

  _renderCustomFilterBtns() {
    const filters = document.getElementById('poiFilters');
    if (!filters) return;

    // Remove existing custom btns
    filters.querySelectorAll('.poi-filter-btn--custom').forEach(b => b.remove());

    // + button always first
    let addBtn = document.getElementById('btnAddCustomFilter');
    if (!addBtn) {
      addBtn = document.createElement('button');
      addBtn.id = 'btnAddCustomFilter';
      addBtn.className = 'poi-filter-btn poi-filter-btn--add';
      addBtn.title = 'Add custom place';
      addBtn.innerHTML = '＋';
      addBtn.addEventListener('click', e => { e.stopPropagation(); this._openCustomFilterModal(); });
      filters.prepend(addBtn);
    }

    // Render custom buttons — newest first (index 0 = newest)
    this.#customFilters.forEach((cf, idx) => {
      const btn = document.createElement('button');
      btn.className = 'poi-filter-btn poi-filter-btn--custom';
      btn.dataset.idx = idx;
      btn.innerHTML = `${cf.emoji} ${cf.name}`;
      btn.title = cf.name;

      // Long-press / right-click → delete
      let pressTimer;
      const startPress = () => { pressTimer = setTimeout(() => this._deleteCustomFilter(idx), 600); };
      const cancelPress = () => clearTimeout(pressTimer);
      btn.addEventListener('touchstart',  startPress,  { passive: true });
      btn.addEventListener('touchend',    cancelPress, { passive: true });
      btn.addEventListener('touchcancel', cancelPress, { passive: true });
      btn.addEventListener('contextmenu', e => { e.preventDefault(); this._deleteCustomFilter(idx); });

      // Click → show pinned place on map with full POI card
      btn.addEventListener('click', () => {
        document.querySelectorAll('.poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
        btn.classList.add('poi-filter-btn--active');
        const input = document.getElementById('poiInput');
        // Use address if it exists and is not empty, otherwise use the custom name
        if (input) input.value = (cf.address && cf.address.trim()) ? cf.address : cf.name;
        this._searchPOIAtCoords(cf.coords, cf.emoji, cf.name, cf.address || '');
      });

      // Insert right after the + button
      addBtn.insertAdjacentElement('afterend', btn);
    });
  }

  _openCustomFilterModal() {
    document.getElementById('customFilterModal')?.remove();

    const pinnedCoord = this.#pinnedCoord;

    const modal = document.createElement('div');
    modal.id = 'customFilterModal';
    modal.className = 'custom-filter-modal';
    modal.innerHTML = `
      <div class="custom-filter-modal__box">
        <div class="custom-filter-modal__title">Add custom place</div>

        <div class="custom-filter-modal__hint">
          👆 To set the location, <strong>click the start point "A" on the map</strong> (not via search).
        </div>

        <div class="custom-filter-modal__coord ${pinnedCoord ? '' : 'no-coord'}" id="cfCoordLabel">
          ${pinnedCoord
      ? `📍 Point selected: ${pinnedCoord[0].toFixed(5)}, ${pinnedCoord[1].toFixed(5)}`
      : '⚠️ No point selected — tap a spot on the map first'}
        </div>

        <div class="custom-filter-modal__field">
          <label class="custom-filter-modal__label">Name</label>
          <input class="custom-filter-modal__input" id="cfName" type="text"
                 placeholder="e.g. Home, Office…" maxlength="30"/>
        </div>

        <div class="custom-filter-modal__field">
          <label class="custom-filter-modal__label">Emoji</label>
          <div class="custom-filter-modal__emoji-grid" id="cfEmojiGrid">
            ${['🏠','🏢','🏫','🏋️','🛒','☕','🍕','🍺','🌳','⛪','🏥','💊','🚉','🅿️','🐶','🎯','🎸','📚','🏊','🚲'].map(em =>
      `<button class="cf-emoji-btn" data-emoji="${em}">${em}</button>`
    ).join('')}
          </div>
          <div class="custom-filter-modal__emoji-custom">
            <input class="custom-filter-modal__input" id="cfEmojiInput" type="text"
                   placeholder="Or type emoji…" maxlength="4"/>
          </div>
        </div>

        <div class="custom-filter-modal__actions">
          <button class="custom-filter-modal__btn custom-filter-modal__btn--cancel" id="cfCancel">Cancel</button>
          <button class="custom-filter-modal__btn custom-filter-modal__btn--save" id="cfSave">Save</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    let selectedEmoji = '';

    modal.querySelectorAll('.cf-emoji-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll('.cf-emoji-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedEmoji = btn.dataset.emoji;
        document.getElementById('cfEmojiInput').value = '';
      });
    });

    document.getElementById('cfEmojiInput').addEventListener('input', e => {
      selectedEmoji = e.target.value.trim();
      modal.querySelectorAll('.cf-emoji-btn').forEach(b => b.classList.remove('active'));
    });

    document.getElementById('cfCancel').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });

    document.getElementById('cfSave').addEventListener('click', async () => {
      const name  = document.getElementById('cfName').value.trim();
      const emoji = selectedEmoji || document.getElementById('cfEmojiInput').value.trim();

      if (!pinnedCoord) {
        alert('Please tap a spot on the map first to set the location.');
        return;
      }
      if (!name) {
        alert('Please enter a name for this place.');
        document.getElementById('cfName').focus();
        return;
      }
      if (!emoji) {
        alert('Please choose or type an emoji.');
        return;
      }

      // Reverse-geocode to get a street address for the search input
      let address = '';
      try {
        const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pinnedCoord[0]}&lon=${pinnedCoord[1]}&format=json`, { headers: { 'Accept-Language': 'en' } });
        const d = await r.json();
        const a = d.address || {};
        address = [a.road, a.house_number].filter(Boolean).join(' ')
          || d.display_name?.split(',')[0]
          || '';
      } catch { /* ignore — address stays empty */ }

      // Newest first: unshift instead of push
      this.#customFilters.unshift({ name, emoji, coords: pinnedCoord, address });
      localStorage.setItem('customFilters', JSON.stringify(this.#customFilters));
      this._renderCustomFilterBtns();
      modal.remove();
    });
  }

  _deleteCustomFilter(idx) {
    if (!confirm(`Remove "${this.#customFilters[idx].name}"?`)) return;
    // Remove the POI marker for this custom filter if it's currently shown
    this._clearPOIMarkers();
    // Also hide results
    const resultsList = document.getElementById('poiResults');
    if (resultsList) { resultsList.classList.add('hidden'); resultsList.innerHTML = ''; }
    const input = document.getElementById('poiInput');
    if (input) input.value = '';
    this.#customFilters.splice(idx, 1);
    localStorage.setItem('customFilters', JSON.stringify(this.#customFilters));
    this._renderCustomFilterBtns();
  }

  async _searchPOIAtCoords(coords, emoji, label, address) {
    const resultsList = document.getElementById('poiResults');
    resultsList.classList.remove('hidden');
    this._clearPOIMarkers();

    if (!this.#map) return;

    // Distance from user
    const distM = this.#userCoords ? this._haversine(this.#userCoords, coords) : null;
    const distTxt = distM != null
      ? distM < 1000 ? `${Math.round(distM)} m away` : `${(distM / 1000).toFixed(1)} km away`
      : '';

    const displayAddr = address || '';

    // Show marker at pinned coords
    const marker = L.marker(coords, {
      icon: L.divIcon({
        className: '',
        html: `<div style="background:#2d3439;border:2px solid #00c46a;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`,
        iconSize: [36, 36], iconAnchor: [18, 18],
      }),
    }).addTo(this.#map)
      .bindPopup(`<b>${emoji} ${label}</b>${displayAddr ? `<br>${displayAddr}` : ''}${distTxt ? `<br><small>${distTxt}</small>` : ''}<br><button onclick="window._poiSetA(${coords[0]},${coords[1]})" style="margin-top:6px;padding:4px 10px;background:#00c46a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">Set as route A →</button>`)
      .openPopup();
    this.#poiMarkers.push(marker);
    this.#map.setView(coords, 16, { animate: true });

    // Result card identical to regular POI results
    const li = document.createElement('li');
    li.className = 'poi-result-item';
    li.innerHTML = `
      <span class="poi-result-item__name">${emoji} ${label}</span>
      ${displayAddr ? `<span class="poi-result-item__addr">${displayAddr}</span>` : ''}
      ${distTxt ? `<span class="poi-result-item__dist">📍 ${distTxt}</span>` : ''}
    `;
    li.addEventListener('click', () => {
      this.#map.setView(coords, 16, { animate: true });
      marker.openPopup();
    });
    resultsList.innerHTML = '';
    resultsList.appendChild(li);
  }

  // ─── POI SEARCH ──────────────────────────────────────────────────
  _initPOISearch() {
    const input = document.getElementById('poiInput');
    const btn   = document.getElementById('poiSearchBtn');
    const filters = document.getElementById('poiFilters');
    const resultsList = document.getElementById('poiResults');

    btn.addEventListener('click', () => this._searchPOI(input.value.trim()));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') this._searchPOI(input.value.trim()); });

    input.addEventListener('input', () => {
      const val = input.value.trim();
      if (val === '') {
        resultsList.classList.add('hidden');
        resultsList.innerHTML = '';
        this._clearPOIMarkers();
        const dl = document.getElementById('poiSuggestions');
        if (dl) dl.innerHTML = '';
        return;
      }
      clearTimeout(this.#autocompleteTimer);
      if (val.length >= 2) {
        this.#autocompleteTimer = setTimeout(() => this._fetchAutocompleteSuggestions(val), 350);
      }
    });

    filters.addEventListener('click', e => {
      const filterBtn = e.target.closest('.poi-filter-btn');
      if (!filterBtn) return;
      document.querySelectorAll('.poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
      filterBtn.classList.add('poi-filter-btn--active');
      input.value = filterBtn.dataset.query;
      this._searchPOI(filterBtn.dataset.query);
    });
  }

  async _fetchAutocompleteSuggestions(query) {
    const datalist = document.getElementById('poiSuggestions');
    if (!datalist) return;
    let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=0`;
    if (this.#map) {
      const b = this.#map.getBounds();
      url += `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=1`;
    }
    try {
      const res = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();
      datalist.innerHTML = '';
      const seen = new Set();
      data.forEach(place => {
        const name = place.name || place.display_name.split(',')[0];
        if (name && !seen.has(name)) {
          seen.add(name);
          const opt = document.createElement('option');
          opt.value = name;
          datalist.appendChild(opt);
        }
      });
    } catch { /* fail silently */ }
  }

  async _searchPOI(query) {
    if (!query) return;

    const resultsList = document.getElementById('poiResults');
    resultsList.classList.remove('hidden');
    resultsList.innerHTML = `<li class="poi-loading"><div class="route-loading__spinner"><div class="route-loading__dot"></div><div class="route-loading__dot"></div><div class="route-loading__dot"></div></div>Searching…</li>`;
    this._clearPOIMarkers();

    let url;
    if (this.#map) {
      const b = this.#map.getBounds();
      url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=1`;
    } else {
      url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1`;
      if (this.#userCoords) url += `&lat=${this.#userCoords[0]}&lon=${this.#userCoords[1]}`;
    }

    try {
      const res  = await fetch(url, { headers: { 'Accept-Language': 'en' } });
      const data = await res.json();

      if (!data.length) {
        resultsList.innerHTML = `<li class="poi-empty">No results for "<b>${query}</b>" in this area.<br><small>Try zooming out or panning the map.</small></li>`;
        return;
      }

      const userPos = this.#userCoords;
      const withDist = data.map(p => ({ ...p, distM: userPos ? this._haversine(userPos, [+p.lat, +p.lon]) : null }));
      withDist.sort((a, b) => (a.distM ?? Infinity) - (b.distM ?? Infinity));

      resultsList.innerHTML = '';
      withDist.forEach(place => {
        const name = place.name || place.display_name.split(',')[0];
        const addr = place.address
          ? [place.address.road, place.address.house_number].filter(Boolean).join(' ')
          : place.display_name.split(',').slice(1, 3).join(',').trim();
        const distTxt = place.distM != null
          ? place.distM < 1000 ? `${Math.round(place.distM)} m away` : `${(place.distM / 1000).toFixed(1)} km away`
          : '';

        const li = document.createElement('li');
        li.className = 'poi-result-item';
        li.innerHTML = `
          <span class="poi-result-item__name">${name}</span>
          ${addr ? `<span class="poi-result-item__addr">${addr}</span>` : ''}
          ${distTxt ? `<span class="poi-result-item__dist">📍 ${distTxt}</span>` : ''}
        `;
        li.addEventListener('click', () => this._selectPOI(place, name));
        resultsList.appendChild(li);

        const emoji = this._poiEmoji(query);
        const marker = L.marker([+place.lat, +place.lon], {
          icon: L.divIcon({
            className: '',
            html: `<div style="background:#2d3439;border:2px solid #00c46a;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`,
            iconSize: [32, 32], iconAnchor: [16, 16],
          }),
        })
          .addTo(this.#map)
          .bindPopup(`<b>${name}</b>${addr ? `<br>${addr}` : ''}<br>${distTxt ? `<small>${distTxt}</small><br>` : ''}<button onclick="window._poiSetA(${place.lat},${place.lon})" style="margin-top:6px;padding:4px 10px;background:#00c46a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">Set as point A →</button>`);
        this.#poiMarkers.push(marker);
      });

      window._poiSetA = (lat, lon) => {
        if (this.#trackingActive && this.#trackingCoords) {
          this._autoRouteFromTracking([lat, lon]);
        } else {
          if (!this.#routeMode) this._startRouteMode();
          this.#routePointA = [lat, lon];
          this.#routeStep = 2;
          if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
          this.#routeMarkerA = L.marker([lat, lon], {
            icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
          }).addTo(this.#map);
          document.getElementById('stepAText').textContent = 'Start point set ✓';
          document.getElementById('stepAText').closest('.route-info__step').classList.add('route-info__step--done');
          document.getElementById('stepBText').textContent = 'Click the end point on the map';
          document.getElementById('map').style.cursor = 'crosshair';
          this.#map.closePopup();
          this.#map.setView([lat, lon], 15);
        }
      };

    } catch {
      resultsList.innerHTML = `<li class="poi-empty">Connection error. Please try again.</li>`;
    }
  }

  _autoRouteFromTracking(destCoords) {
    if (!this.#trackingCoords) return;
    this.#map.closePopup();
    this.#routeMode = true;
    this.#routeStep = 3;
    this.#routePointA = [...this.#trackingCoords];
    this.#routePointB = destCoords;

    btnRoute.classList.add('hidden');
    routeInfo.classList.remove('hidden');
    routeResult.classList.add('hidden');

    if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
    this.#routeMarkerA = L.marker(this.#routePointA, { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(this.#map);
    if (this.#routeMarkerB) this.#map.removeLayer(this.#routeMarkerB);
    this.#routeMarkerB = L.marker(destCoords, { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--b">B</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(this.#map);

    stepAText.textContent = 'Your position ✓';
    stepBText.textContent = 'Destination set ✓';
    stepAText.closest('.route-info__step').classList.add('route-info__step--done');
    stepBText.closest('.route-info__step').classList.add('route-info__step--done');
    document.getElementById('map').style.cursor = '';
    this._drawRoute();
  }

  _selectPOI(place, name) {
    this.#map.setView([+place.lat, +place.lon], 16, { animate: true });
    this.#poiMarkers.forEach(m => {
      const pos = m.getLatLng();
      if (Math.abs(pos.lat - +place.lat) < 0.0001 && Math.abs(pos.lng - +place.lon) < 0.0001) m.openPopup();
    });
  }

  _clearPOIMarkers() { this.#poiMarkers.forEach(m => this.#map.removeLayer(m)); this.#poiMarkers = []; }

  _poiEmoji(query) {
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

  _haversine([lat1, lon1], [lat2, lon2]) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  // ─── ROUTE PLANNER ───────────────────────────────────────────────
  _setActivityMode(e) {
    const btn = e.currentTarget;
    const mode = btn.dataset.mode;
    this.#routeActivityMode = mode;
    document.querySelectorAll('.route-mode-btn').forEach(b => b.classList.remove('route-mode-btn--active'));
    btn.classList.add('route-mode-btn--active');
    if (this.#routeStep === 3 && !routeResult.classList.contains('hidden')) {
      const distKm = parseFloat(routeDist.textContent);
      if (!isNaN(distKm)) routeTime.textContent = Math.round((distKm / this.#activitySpeeds[mode]) * 60);
    }
  }

  _startRouteMode() {
    if (!form.classList.contains('hidden')) this._hideForm();
    this.#routeMode = true;
    this.#routeStep = 1;
    this.#routePointA = null;
    this.#routePointB = null;

    btnRoute.classList.add('hidden');
    routeInfo.classList.remove('hidden');
    routeResult.classList.add('hidden');

    stepAText.textContent = 'Click the start point on the map';
    stepBText.textContent = 'Click the end point on the map';
    stepAText.closest('.route-info__step').classList.remove('route-info__step--done');
    stepBText.closest('.route-info__step').classList.remove('route-info__step--done');
    document.getElementById('map').style.cursor = 'crosshair';

    if (this.#trackingActive && this.#trackingCoords) {
      const [lat, lng] = this.#trackingCoords;
      this.#routePointA = [lat, lng];
      this.#routeStep = 2;
      if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
      this.#routeMarkerA = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(this.#map);
      stepAText.textContent = 'Your position ✓';
      stepAText.closest('.route-info__step').classList.add('route-info__step--done');
      stepBText.textContent = 'Click the destination on the map';
    }
  }

  _handleRouteClick(mapE) {
    const { lat, lng } = mapE.latlng;

    if (this.#routeStep === 1) {
      this.#routePointA = [lat, lng];
      this.#routeStep = 2;
      if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
      this.#routeMarkerA = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(this.#map);
      stepAText.textContent = 'Start point set ✓';
      stepAText.closest('.route-info__step').classList.add('route-info__step--done');
      stepBText.textContent = 'Click the end point on the map';

    } else if (this.#routeStep === 2) {
      this.#routePointB = [lat, lng];
      this.#routeStep = 3;
      if (this.#routeMarkerB) this.#map.removeLayer(this.#routeMarkerB);
      this.#routeMarkerB = L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--b">B</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(this.#map);
      stepBText.textContent = 'End point set ✓';
      stepBText.closest('.route-info__step').classList.add('route-info__step--done');
      document.getElementById('map').style.cursor = '';
      this._drawRoute();
    }
  }

  _drawRoute() {
    routeLoading.classList.remove('hidden');
    routeResult.classList.add('hidden');
    if (this.#routingControl) { this.#map.removeControl(this.#routingControl); this.#routingControl = null; }
    this._stopRouteProgress();

    this.#routingControl = L.Routing.control({
      waypoints: [L.latLng(this.#routePointA[0], this.#routePointA[1]), L.latLng(this.#routePointB[0], this.#routePointB[1])],
      routeWhileDragging: false, addWaypoints: false, draggableWaypoints: false,
      fitSelectedRoutes: true, show: false,
      lineOptions: { styles: [{ color: '#00c46a', weight: 6, opacity: 0.85 }] },
      createMarker: () => null,
    })
      .on('routesfound', e => {
        routeLoading.classList.add('hidden');
        const route = e.routes[0];
        const totalDistM = route.summary.totalDistance;
        const distKm = (totalDistM / 1000).toFixed(2);
        routeDist.textContent = distKm;
        routeTime.textContent = Math.round((parseFloat(distKm) / this.#activitySpeeds[this.#routeActivityMode]) * 60);
        routeResult.classList.remove('hidden');
        this._setupRouteProgress(route.coordinates.map(c => [c.lat, c.lng]), totalDistM);
      })
      .on('routingerror', () => {
        routeLoading.classList.add('hidden');
        routeDist.textContent = 'Error';
        routeTime.textContent = '—';
        routeResult.classList.remove('hidden');
      })
      .addTo(this.#map);
  }

  _cancelRoute() {
    this.#routeMode = false;
    this.#routeStep = 0;
    this.#routePointA = null;
    this.#routePointB = null;
    if (this.#routeMarkerA) { this.#map.removeLayer(this.#routeMarkerA); this.#routeMarkerA = null; }
    if (this.#routeMarkerB) { this.#map.removeLayer(this.#routeMarkerB); this.#routeMarkerB = null; }
    if (this.#routingControl) { this.#map.removeControl(this.#routingControl); this.#routingControl = null; }
    this._stopRouteProgress();
    routeLoading.classList.add('hidden');
    btnRoute.classList.remove('hidden');
    routeInfo.classList.add('hidden');
    routeResult.classList.add('hidden');
    document.getElementById('map').style.cursor = '';
  }
}

const app = new App();

// ─── MOBILE SLIDING PANEL ────────────────────────────────────────
(function initMobilePanel() {
  const sidebar = document.querySelector('.sidebar');
  const HANDLE_ZONE = 56; // px — only the top strip triggers drag
  let startY = 0, startH = 0, isDragging = false;

  const isMobile = () => window.innerWidth <= 768;
  const VH = () => window.innerHeight;

  const snapTo = (h, animate = true) => {
    sidebar.style.transition = animate
      ? 'height 0.32s cubic-bezier(0.4,0,0.2,1)'
      : 'none';
    sidebar.style.height = typeof h === 'number' ? h + 'px' : h;
  };

  const collapse = () => { snapTo('5.5rem'); sidebar.scrollTop = 0; };
  const toHalf   = () => { snapTo('55vh');   sidebar.scrollTop = 0; };
  const toTall   = () => { snapTo('80vh');   sidebar.scrollTop = 0; };
  const toFull   = () => snapTo('100dvh');

  if (isMobile()) toHalf();

  window.addEventListener('resize', () => {
    if (!isMobile()) { sidebar.style.height = ''; sidebar.style.transition = ''; }
  });

  sidebar.addEventListener('touchstart', e => {
    if (!isMobile()) return;
    const touch = e.touches[0];
    const rect  = sidebar.getBoundingClientRect();
    const touchY = touch.clientY - rect.top;

    // Only start drag if:
    // 1. Touch is in the top handle zone, AND
    // 2. Sidebar content is scrolled to the very top
    //    (so we don't steal scroll events mid-content)
    if (touchY > HANDLE_ZONE) return;
    if (sidebar.scrollTop > 4) return; // already scrolled inside — don't drag

    isDragging = true;
    startY = touch.clientY;
    startH = sidebar.offsetHeight;
    sidebar.style.transition = 'none';
  }, { passive: true });

  // Track on document so drag doesn't break if finger leaves sidebar
  document.addEventListener('touchmove', e => {
    if (!isDragging || !isMobile()) return;
    const delta = startY - e.touches[0].clientY;
    const newH  = Math.min(Math.max(startH + delta, 50), VH());
    sidebar.style.height = newH + 'px';
  }, { passive: true });

  document.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    const h  = sidebar.offsetHeight;
    const vh = VH();
    if      (h < vh * 0.18) collapse();
    else if (h < vh * 0.65) toHalf();
    else if (h < vh * 0.90) toTall();
    else                     toFull();
  });
})();