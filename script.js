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
  #poiMarkers = [];
  #userCoords = null;
  #autocompleteTimer = null;
  #filterDrag = { active: false, startX: 0, scrollLeft: 0 };

  #activitySpeeds = { running: 10, cycling: 20, walking: 5 };

  // Weekly stats — goals loaded from localStorage at field declaration (fixes reset bug)
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
    if (this.#routeMode) this._handleRouteClick(mapE);
    else this._showForm(mapE);
  }

  _showForm(mapE) {
    this.#mapEvent = mapE;
    form.classList.remove('hidden');
    inputDistance.focus();

    if (window.innerWidth <= 768) {
      const sidebar = document.querySelector('.sidebar');
      requestAnimationFrame(() => {
        sidebar.style.transition = 'height 0.32s cubic-bezier(0.4,0,0.2,1)';
        const needed = sidebar.scrollHeight;
        sidebar.style.height = Math.min(Math.max(needed, window.innerHeight * 0.55), window.innerHeight * 0.85) + 'px';
      });
    }
  }

  _hideForm() {
    inputDistance.value = inputDuration.value = inputCadence.value = inputElevation.value = '';
    form.style.display = 'none';
    form.classList.add('hidden');
    setTimeout(() => (form.style.display = 'grid'), 1000);

    if (window.innerWidth <= 768) {
      const sidebar = document.querySelector('.sidebar');
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

    this.#workouts.push(workout);
    this._renderWorkoutMarker(workout);
    this._renderWorkout(workout);
    this._hideForm();
    this._setLocalStorage();
    this._renderStats(true);
  }

  _renderWorkoutMarker(workout) {
    const marker = L.marker(workout.coords)
      .addTo(this.#map)
      .bindPopup(L.popup({ maxWidth: 250, minWidth: 100, autoClose: false, closeOnClick: false, className: `${workout.type}-popup` }))
      .setPopupContent(`${workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️'} ${workout.description}`)
      .openPopup();
    this.#markers.set(workout.id, marker);
  }

  _renderWorkout(workout) {
    let html = `
      <li class="workout workout--${workout.type}" data-id="${workout.id}">
        <h2 class="workout__title">${workout.description}</h2>
        <div class="workout__details">
          <span class="workout__icon">${workout.type === 'running' ? '🏃‍♂️' : '🚴‍♀️'}</span>
          <span class="workout__value">${workout.distance}</span>
          <span class="workout__unit">km</span>
        </div>
        <div class="workout__details">
          <span class="workout__icon">⏱</span>
          <span class="workout__value">${workout.duration}</span>
          <span class="workout__unit">min</span>
        </div>
    `;

    if (workout.type === 'running')
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
    const workout = this.#workouts.find(work => work.id === workoutEl.dataset.id);
    if (!workout) return;
    this.#map.setView(workout.coords, this.#mapZoomLevel, { animate: true, pan: { duration: 1 } });
  }

  _deleteWorkout(id) {
    const marker = this.#markers.get(id);
    if (marker) { this.#map.removeLayer(marker); this.#markers.delete(id); }
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
  }

  _setLocalStorage() { localStorage.setItem('workouts', JSON.stringify(this.#workouts)); }

  _getLocalStorage() {
    const data = JSON.parse(localStorage.getItem('workouts'));
    if (!data) return;
    this.#workouts = data;
    this.#workouts.forEach(work => this._renderWorkout(work));
    this._renderStats();
  }

  reset() { localStorage.removeItem('workouts'); location.reload(); }

  // ─── iOS INSTALL BANNER ──────────────────────────────────────────
  // Shows only on iOS Safari that hasn't installed the app yet.
  // Dismissed state persists in localStorage.
  _initIOSBanner() {
    const ua = navigator.userAgent;
    const isIOS = /iphone|ipad|ipod/i.test(ua);
    // standalone = already installed
    const isStandalone = ('standalone' in window.navigator && window.navigator.standalone)
      || window.matchMedia('(display-mode: standalone)').matches;
    if (!isIOS || isStandalone) return;
    if (localStorage.getItem('iosBannerDismissed')) return;

    const banner   = document.getElementById('iosInstallBanner');
    const closeBtn = document.getElementById('iosInstallClose');
    if (!banner) return;

    // Show after 2.5 s so the map has time to load first
    setTimeout(() => banner.classList.remove('hidden'), 2500);

    closeBtn?.addEventListener('click', () => {
      banner.classList.add('hidden');
      localStorage.setItem('iosBannerDismissed', '1');
    });
  }

  // ─── WEEKLY STATS ────────────────────────────────────────────────
  _getWeekBounds(offsetWeeks = 0) {
    const now = new Date();
    const dow = now.getDay();
    const diffToMon = dow === 0 ? -6 : 1 - dow;
    const mon = new Date(now);
    mon.setDate(now.getDate() + diffToMon + offsetWeeks * 7);
    mon.setHours(0, 0, 0, 0);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6);
    sun.setHours(23, 59, 59, 999);
    return { mon, sun };
  }

  _getWeekWorkouts(offsetWeeks = 0) {
    const { mon, sun } = this._getWeekBounds(offsetWeeks);
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

    // Sync inputs with already-loaded goal values (fixes goal reset bug)
    if (inKm)   inKm.value   = this.#goalKm;
    if (inTime) inTime.value = this.#goalTime;
    if (inCnt)  inCnt.value  = this.#goalCount;

    panel.addEventListener('click', () => {
      this.#statsExpanded = !this.#statsExpanded;
      detail?.classList.toggle('hidden', !this.#statsExpanded);
      editor?.classList.toggle('hidden', !this.#statsExpanded);
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

    inKm?.addEventListener('change', () => {
      this.#goalKm = Math.max(1, +inKm.value || 35);
      inKm.value = this.#goalKm;
      localStorage.setItem('goalKm', this.#goalKm);
      this._renderStats();
    });
    inTime?.addEventListener('change', () => {
      this.#goalTime = Math.max(1, +inTime.value || 300);
      inTime.value = this.#goalTime;
      localStorage.setItem('goalTime', this.#goalTime);
      this._renderStats();
    });
    inCnt?.addEventListener('change', () => {
      this.#goalCount = Math.max(1, +inCnt.value || 7);
      inCnt.value = this.#goalCount;
      localStorage.setItem('goalCount', this.#goalCount);
      this._renderStats();
    });
  }

  _renderStats(animate = false) {
    const offset  = this.#statsWeekOffset;
    const weekW   = this._getWeekWorkouts(offset);
    const { mon } = this._getWeekBounds(offset);

    const weekKm  = weekW.reduce((s, w) => s + (w.distance || 0), 0);
    const weekMin = weekW.reduce((s, w) => s + (w.duration  || 0), 0);
    const weekCnt = weekW.length;

    let subset = weekW;
    if (this.#statsSelectedDay !== null)
      subset = weekW.filter(w => Math.floor((new Date(w.date) - mon) / 86400000) === this.#statsSelectedDay);
    const subKm  = subset.reduce((s, w) => s + (w.distance || 0), 0);
    const subMin = subset.reduce((s, w) => s + (w.duration  || 0), 0);
    const subCnt = subset.length;

    const CIRC = 226.2;
    const setRing = (id, pct) => {
      const el = document.getElementById(id);
      if (!el) return;
      const off = Math.max(0, CIRC - Math.min(pct, 1) * CIRC);
      if (animate) {
        el.style.transition = 'none';
        el.setAttribute('stroke-dashoffset', CIRC);
        void el.getBoundingClientRect();
        el.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)';
      }
      requestAnimationFrame(() => el.setAttribute('stroke-dashoffset', off.toFixed(1)));
    };

    setRing('statsRingKm',       weekKm  / this.#goalKm);
    setRing('statsRingTime',     weekMin / this.#goalTime);
    setRing('statsRingWorkouts', weekCnt / this.#goalCount);

    const fmtT = m => m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;
    const set  = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

    set('statsValKm',       weekKm.toFixed(1));
    set('statsValTime',     fmtT(weekMin));
    set('statsValWorkouts', weekCnt);

    const goalPct = Math.min(Math.round((weekKm / this.#goalKm) * 100), 100);
    set('statsGoalPct', goalPct + '%');
    const fill = document.getElementById('statsGoalFill');
    if (fill) fill.style.width = goalPct + '%';

    if (goalPct >= 100 && !this.#statsPrevGoalReached && animate) {
      this.#statsPrevGoalReached = true;
      this._showGoalCelebration();
    } else if (goalPct < 100) {
      this.#statsPrevGoalReached = false;
    }

    const nextBtn = document.getElementById('statsWeekNext');
    if (offset === 0) {
      set('statsWeekLabel', 'This week');
      if (nextBtn) nextBtn.disabled = true;
    } else {
      const su = new Date(mon); su.setDate(mon.getDate() + 6);
      const fmt = d => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      set('statsWeekLabel', `${fmt(mon)}–${fmt(su)}`);
      if (nextBtn) nextBtn.disabled = false;
    }

    set('statsDetailKm',    subKm.toFixed(1));
    set('statsDetailTime',  fmtT(subMin));
    set('statsDetailCount', subCnt);
    if (this.#statsSelectedDay !== null) {
      const sel = new Date(mon); sel.setDate(mon.getDate() + this.#statsSelectedDay);
      set('statsDetailDate', sel.getDate());
    } else { set('statsDetailDate', '—'); }

    this._renderDayBars(weekW, mon);
  }

  _renderDayBars(weekWorkouts, mon) {
    const barsEl = document.getElementById('statsDetailBars');
    if (!barsEl) return;
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const kmPerDay  = Array(7).fill(0);
    const typPerDay = Array(7).fill('none');
    const datePerDay = Array(7);
    for (let i = 0; i < 7; i++) { const d = new Date(mon); d.setDate(mon.getDate() + i); datePerDay[i] = d.getDate(); }
    weekWorkouts.forEach(w => {
      const diff = Math.floor((new Date(w.date) - mon) / 86400000);
      if (diff >= 0 && diff < 7) { kmPerDay[diff] += w.distance || 0; typPerDay[diff] = w.type; }
    });
    const maxKm = Math.max(...kmPerDay, 0.1);
    barsEl.innerHTML = DAY_NAMES.map((name, i) => {
      const km = kmPerDay[i];
      const h = Math.round((km / maxKm) * 48);
      const color = typPerDay[i] === 'running' ? '#00c46a' : typPerDay[i] === 'cycling' ? '#ffb545' : '#3a4147';
      const act = this.#statsSelectedDay === i ? ' active' : '';
      return `<div class="stats-detail__day-col${act}" data-day="${i}"><div class="stats-detail__bar" style="height:${Math.max(h, km > 0 ? 4 : 2)}px;background:${color}"></div><div class="stats-detail__day-name">${name}</div><div class="stats-detail__day-date">${datePerDay[i]}</div></div>`;
    }).join('');
    barsEl.querySelectorAll('.stats-detail__day-col').forEach(col => {
      col.addEventListener('click', e => {
        e.stopPropagation();
        const day = +col.dataset.day;
        this.#statsSelectedDay = this.#statsSelectedDay === day ? null : day;
        this._renderStats();
      });
    });
  }

  _showGoalCelebration() {
    const panel = document.getElementById('statsPanel');
    panel?.classList.add('goal-reached');
    setTimeout(() => panel?.classList.remove('goal-reached'), 800);
    document.querySelector('.stats-goal-toast')?.remove();
    const toast = document.createElement('div');
    toast.className = 'stats-goal-toast';
    toast.innerHTML = `<span class="stats-goal-toast__emoji">🏆</span><span class="stats-goal-toast__title">Weekly goal reached!</span><span class="stats-goal-toast__sub">Amazing — you crushed your weekly target 🎉</span>`;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.transition = 'opacity 0.5s ease'; toast.style.opacity = '0'; setTimeout(() => toast.remove(), 500); }, 3500);
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
// The drag bar is drawn by sidebar::before in CSS (one bar, no duplicates).
// Sidebar has overflow-y: auto always — scroll works at every level.
// Drag only activates when touchstart lands in the top HANDLE_ZONE (56px),
// so scrolling the content below never interferes with dragging.
(function initMobilePanel() {
  const sidebar = document.querySelector('.sidebar');
  const HANDLE_ZONE = 56; // px from top of sidebar
  let startY = 0, startH = 0, isDragging = false;

  const isMobile = () => window.innerWidth <= 768;
  const VH = () => window.innerHeight;

  const snapTo = (h, animate = true) => {
    sidebar.style.transition = animate ? 'height 0.32s cubic-bezier(0.4,0,0.2,1)' : 'none';
    sidebar.style.height = typeof h === 'number' ? h + 'px' : h;
  };

  const collapse = () => snapTo('5.5rem');
  const toHalf   = () => snapTo('55vh');
  const toTall   = () => snapTo('80vh');
  const toFull   = () => snapTo('100dvh');

  if (isMobile()) toHalf();

  window.addEventListener('resize', () => {
    if (!isMobile()) { sidebar.style.height = ''; sidebar.style.transition = ''; }
  });

  sidebar.addEventListener('touchstart', e => {
    if (!isMobile()) return;
    const touch = e.touches[0];
    const rect  = sidebar.getBoundingClientRect();
    // Only drag if touch is in the handle zone at the top
    if (touch.clientY - rect.top > HANDLE_ZONE) return;
    isDragging = true;
    startY = touch.clientY;
    startH = sidebar.offsetHeight;
    sidebar.style.transition = 'none';
  }, { passive: true });

  // Listen on document so drag continues even if finger leaves the handle
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
