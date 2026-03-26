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

// ─── MAIN APP CLASS ──────────────────────────────────────────────
class App {
  #map;
  #mapZoomLevel = 13;
  #mapEvent;
  #workouts = [];

  // Route planner state
  #routeMode = false;
  #routeStep = 0;
  #routePointA = null;
  #routePointB = null;
  #routingControl = null;
  #routeMarkerA = null;
  #routeMarkerB = null;
  #routeActivityMode = 'running';

  // Route progress state
  #routeCoords = [];
  #progressLine = null;
  #progressWatchId = null;

  // Live tracking state
  #trackingActive = false;
  #watchId = null;
  #trackingMarker = null;
  #trackingCoords = null; // latest GPS fix while tracking

  // Wake Lock
  #wakeLock = null;

  #markers = new Map();
  #poiMarkers = [];
  #userCoords = null;

  #activitySpeeds = { running: 10, cycling: 20, walking: 5 };

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
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(this.#map);

    this.#map.on('click', this._handleMapClick.bind(this));
    this.#workouts.forEach(work => this._renderWorkoutMarker(work));
  }

  // ─── SCREEN WAKE LOCK ────────────────────────────────────────────
  async _requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      this.#wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
      this._updateWakeLockBadge(true);
    } catch { /* not available — fail silently */ }
  }

  async _releaseWakeLock() {
    if (!this.#wakeLock) return;
    try { await this.#wakeLock.release(); } catch { /* ignore */ }
    this.#wakeLock = null;
    document.removeEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
    this._updateWakeLockBadge(false);
  }

  async _handleVisibilityChange() {
    if (this.#wakeLock !== null && document.visibilityState === 'visible' && this.#trackingActive) {
      await this._requestWakeLock();
    }
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
    if (this.#trackingActive) {
      this._stopTracking();
    } else {
      this._startTracking();
    }
  }

  _startTracking() {
    if (!navigator.geolocation) return;

    this.#trackingActive = true;
    btnTrack.textContent = '⏹ Stop tracking';
    btnTrack.classList.add('tracking--active');
    this._requestWakeLock();

    const dotIcon = L.divIcon({
      className: '',
      html: `<div class="tracking-dot">
               <div class="tracking-dot__pulse"></div>
               <div class="tracking-dot__core"></div>
             </div>`,
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    this.#watchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude: lat, longitude: lng } = position.coords;
        const latlng = [lat, lng];
        this.#trackingCoords = latlng; // always keep latest fix

        if (!this.#trackingMarker) {
          this.#trackingMarker = L.marker(latlng, { icon: dotIcon, zIndexOffset: 1000 }).addTo(this.#map);
          this.#map.setView(latlng, this.#mapZoomLevel, { animate: true });
        } else {
          this.#trackingMarker.setLatLng(latlng);
          this.#map.setView(latlng, this.#map.getZoom(), { animate: true, pan: { duration: 0.5 } });
        }
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

    if (this.#watchId !== null) {
      navigator.geolocation.clearWatch(this.#watchId);
      this.#watchId = null;
    }
    if (this.#trackingMarker) {
      this.#map.removeLayer(this.#trackingMarker);
      this.#trackingMarker = null;
    }
  }

  // ─── ROUTE PROGRESS ──────────────────────────────────────────────
  _startRouteProgress(routeCoords) {
    this.#routeCoords = routeCoords;

    if (this.#progressWatchId !== null) {
      navigator.geolocation.clearWatch(this.#progressWatchId);
    }
    if (this.#progressLine) this.#map.removeLayer(this.#progressLine);

    this.#progressLine = L.polyline([], {
      color: '#888',
      weight: 5,
      opacity: 0.7,
    }).addTo(this.#map);

    let coveredUpToIndex = 0;

    this.#progressWatchId = navigator.geolocation.watchPosition(
      position => {
        const { latitude: lat, longitude: lng } = position.coords;
        const userPt = L.latLng(lat, lng);

        let closestIdx = coveredUpToIndex;
        let minDist = Infinity;

        for (let i = coveredUpToIndex; i < this.#routeCoords.length; i++) {
          const d = userPt.distanceTo(L.latLng(this.#routeCoords[i]));
          if (d < minDist) { minDist = d; closestIdx = i; }
        }

        if (closestIdx > coveredUpToIndex && minDist < 50) {
          coveredUpToIndex = closestIdx;
        }

        this.#progressLine.setLatLngs(this.#routeCoords.slice(0, coveredUpToIndex + 1));
      },
      () => { /* GPS error — progress pauses silently */ },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 15000 }
    );
  }

  _stopRouteProgress() {
    if (this.#progressWatchId !== null) {
      navigator.geolocation.clearWatch(this.#progressWatchId);
      this.#progressWatchId = null;
    }
    if (this.#progressLine) {
      this.#map.removeLayer(this.#progressLine);
      this.#progressLine = null;
    }
    this.#routeCoords = [];
  }

  // ─── MAP CLICK HANDLER ───────────────────────────────────────────
  _handleMapClick(mapE) {
    if (this.#routeMode) {
      this._handleRouteClick(mapE);
    } else {
      this._showForm(mapE);
    }
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
        const minH = window.innerHeight * 0.55;
        const maxH = window.innerHeight * 0.85;
        sidebar.style.height = Math.min(Math.max(needed, minH), maxH) + 'px';
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

  // ─── CREATE NEW WORKOUT ──────────────────────────────────────────
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
    if (deleteBtn) {
      e.stopPropagation();
      this._deleteWorkout(deleteBtn.dataset.id);
      return;
    }

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
  }

  _setLocalStorage() { localStorage.setItem('workouts', JSON.stringify(this.#workouts)); }

  _getLocalStorage() {
    const data = JSON.parse(localStorage.getItem('workouts'));
    if (!data) return;
    this.#workouts = data;
    this.#workouts.forEach(work => this._renderWorkout(work));
  }

  reset() { localStorage.removeItem('workouts'); location.reload(); }

  // ─── POI SEARCH ──────────────────────────────────────────────────

  _initPOISearch() {
    const input = document.getElementById('poiInput');
    const btn   = document.getElementById('poiSearchBtn');
    const filters = document.getElementById('poiFilters');

    btn.addEventListener('click', () => this._searchPOI(input.value.trim()));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') this._searchPOI(input.value.trim());
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

  async _searchPOI(query) {
    if (!query) return;

    const resultsList = document.getElementById('poiResults');
    resultsList.classList.remove('hidden');
    resultsList.innerHTML = `<li class="poi-loading">
      <div class="route-loading__spinner">
        <div class="route-loading__dot"></div>
        <div class="route-loading__dot"></div>
        <div class="route-loading__dot"></div>
      </div>
      Searching…
    </li>`;

    this._clearPOIMarkers();

    let url;
    if (this.#map) {
      const bounds = this.#map.getBounds();
      const sw = bounds.getSouthWest();
      const ne = bounds.getNorthEast();
      const viewbox = `${sw.lng},${ne.lat},${ne.lng},${sw.lat}`;
      url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1&viewbox=${viewbox}&bounded=1`;
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
      const withDist = data.map(p => ({
        ...p,
        distM: userPos ? this._haversine(userPos, [+p.lat, +p.lon]) : null,
      }));
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
            iconSize: [32, 32],
            iconAnchor: [16, 16],
          }),
        })
          .addTo(this.#map)
          .bindPopup(`
            <b>${name}</b>${addr ? `<br>${addr}` : ''}<br>
            ${distTxt ? `<small>${distTxt}</small><br>` : ''}
            <button onclick="window._poiSetA(${place.lat},${place.lon})" style="margin-top:6px;padding:4px 10px;background:#00c46a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">Set as point A →</button>
          `);
        this.#poiMarkers.push(marker);
      });

      // ── AUTO-ROUTE: if tracking is active, clicking "Set as point A" routes
      // FROM current GPS position TO the POI automatically ──
      window._poiSetA = (lat, lon) => {
        if (this.#trackingActive && this.#trackingCoords) {
          // Tracking is on — route FROM current position TO this POI directly
          this._autoRouteFromTracking([lat, lon]);
        } else {
          // Normal flow — set as point A in route planner
          if (!this.#routeMode) this._startRouteMode();
          this.#routePointA = [lat, lon];
          this.#routeStep = 2;
          if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
          this.#routeMarkerA = L.marker([lat, lon], {
            icon: L.divIcon({
              className: '',
              html: '<div class="route-marker route-marker--a">A</div>',
              iconSize: [28, 28], iconAnchor: [14, 14],
            }),
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

  // ─── AUTO-ROUTE FROM TRACKING POSITION ───────────────────────────
  // Called when tracking is active and user picks a destination.
  // Sets point A = current GPS, point B = destination, draws route immediately.
  _autoRouteFromTracking(destCoords) {
    if (!this.#trackingCoords) return;

    this.#map.closePopup();

    // Prepare route mode state
    this.#routeMode = true;
    this.#routeStep = 3;
    this.#routePointA = [...this.#trackingCoords];
    this.#routePointB = destCoords;

    btnRoute.classList.add('hidden');
    routeInfo.classList.remove('hidden');
    routeResult.classList.add('hidden');

    // Place marker A at current GPS position
    if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
    this.#routeMarkerA = L.marker(this.#routePointA, {
      icon: L.divIcon({
        className: '',
        html: '<div class="route-marker route-marker--a">A</div>',
        iconSize: [28, 28], iconAnchor: [14, 14],
      }),
    }).addTo(this.#map);

    // Place marker B at destination
    if (this.#routeMarkerB) this.#map.removeLayer(this.#routeMarkerB);
    this.#routeMarkerB = L.marker(destCoords, {
      icon: L.divIcon({
        className: '',
        html: '<div class="route-marker route-marker--b">B</div>',
        iconSize: [28, 28], iconAnchor: [14, 14],
      }),
    }).addTo(this.#map);

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

  _clearPOIMarkers() {
    this.#poiMarkers.forEach(m => this.#map.removeLayer(m));
    this.#poiMarkers = [];
  }

  _poiEmoji(query) {
    if (/grocery|store|shop|market|sklep|żabka|biedronk|lidl/i.test(query)) return '🛒';
    if (/water|fountain|woda|fontanna|jezioro|staw|rzeka/i.test(query)) return '💧';
    if (/toilet|wc|restroom|toaleta/i.test(query)) return '🚻';
    if (/pharmacy|chemist|apteka/i.test(query)) return '💊';
    if (/park|forest|las|garden/i.test(query)) return '🌳';
    if (/cafe|coffee|kawiarnia/i.test(query)) return '☕';
    if (/hospital|clinic|doctor|szpital/i.test(query)) return '🏥';
    if (/restaurant|restaurcja|bar|pub/i.test(query)) return '🍴';
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
      if (!isNaN(distKm)) {
        routeTime.textContent = Math.round((distKm / this.#activitySpeeds[mode]) * 60);
      }
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

    // ── AUTO-ROUTE: if tracking active, set point A to current GPS immediately ──
    if (this.#trackingActive && this.#trackingCoords) {
      const [lat, lng] = this.#trackingCoords;
      this.#routePointA = [lat, lng];
      this.#routeStep = 2;

      if (this.#routeMarkerA) this.#map.removeLayer(this.#routeMarkerA);
      this.#routeMarkerA = L.marker([lat, lng], {
        icon: L.divIcon({
          className: '',
          html: '<div class="route-marker route-marker--a">A</div>',
          iconSize: [28, 28], iconAnchor: [14, 14],
        }),
      }).addTo(this.#map);

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
      this.#routeMarkerA = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      }).addTo(this.#map);

      stepAText.textContent = 'Start point set ✓';
      stepAText.closest('.route-info__step').classList.add('route-info__step--done');
      stepBText.textContent = 'Click the end point on the map';

    } else if (this.#routeStep === 2) {
      this.#routePointB = [lat, lng];
      this.#routeStep = 3;

      if (this.#routeMarkerB) this.#map.removeLayer(this.#routeMarkerB);
      this.#routeMarkerB = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--b">B</div>', iconSize: [28, 28], iconAnchor: [14, 14] }),
      }).addTo(this.#map);

      stepBText.textContent = 'End point set ✓';
      stepBText.closest('.route-info__step').classList.add('route-info__step--done');
      document.getElementById('map').style.cursor = '';

      this._drawRoute();
    }
  }

  _drawRoute() {
    routeLoading.classList.remove('hidden');
    routeResult.classList.add('hidden');

    if (this.#routingControl) {
      this.#map.removeControl(this.#routingControl);
      this.#routingControl = null;
    }

    this._stopRouteProgress();

    this.#routingControl = L.Routing.control({
      waypoints: [
        L.latLng(this.#routePointA[0], this.#routePointA[1]),
        L.latLng(this.#routePointB[0], this.#routePointB[1]),
      ],
      routeWhileDragging: false,
      addWaypoints: false,
      draggableWaypoints: false,
      fitSelectedRoutes: true,
      show: false,
      lineOptions: { styles: [{ color: '#00c46a', weight: 5, opacity: 0.85 }] },
      createMarker: () => null,
    })
      .on('routesfound', e => {
        routeLoading.classList.add('hidden');
        const route = e.routes[0];
        const distKm = (route.summary.totalDistance / 1000).toFixed(2);
        const speed = this.#activitySpeeds[this.#routeActivityMode];
        routeDist.textContent = distKm;
        routeTime.textContent = Math.round((parseFloat(distKm) / speed) * 60);
        routeResult.classList.remove('hidden');

        // Start greying out the route as user walks it
        const coords = route.coordinates.map(c => [c.lat, c.lng]);
        this._startRouteProgress(coords);
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
  const HANDLE_ZONE = 56;
  let startY = 0, startHeight = 0, isDragging = false;

  const isMobile = () => window.innerWidth <= 768;
  const snapTo = h => { sidebar.style.transition = 'height 0.32s cubic-bezier(0.4,0,0.2,1)'; sidebar.style.height = h; };
  const collapse = () => snapTo('5.5rem');
  const toHalf   = () => snapTo('55vh');
  const toFull   = () => snapTo('85vh');

  if (isMobile()) toHalf();

  window.addEventListener('resize', () => {
    if (!isMobile()) { sidebar.style.height = ''; sidebar.style.transition = ''; }
    else toHalf();
  });

  sidebar.addEventListener('touchstart', e => {
    if (!isMobile()) return;
    const touch = e.touches[0];
    const rect = sidebar.getBoundingClientRect();
    if (touch.clientY - rect.top > HANDLE_ZONE) return;
    isDragging = true;
    startY = touch.clientY;
    startHeight = sidebar.offsetHeight;
    sidebar.style.transition = 'none';
  }, { passive: true });

  sidebar.addEventListener('touchmove', e => {
    if (!isDragging || !isMobile()) return;
    const delta = startY - e.touches[0].clientY;
    const newH = Math.min(Math.max(startHeight + delta, 50), window.innerHeight * 0.88);
    sidebar.style.height = newH + 'px';
  }, { passive: true });

  sidebar.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    const h = sidebar.offsetHeight;
    const vh = window.innerHeight;
    if      (h < vh * 0.18) collapse();
    else if (h < vh * 0.65) toHalf();
    else                     toFull();
  });
})();
