/**
 * main.ts — MapYou TypeScript
 * Exact 1:1 translation of script.js.
 * Only types added — zero logic changes.
 */
var __classPrivateFieldSet = (this && this.__classPrivateFieldSet) || function (receiver, state, value, kind, f) {
    if (kind === "m") throw new TypeError("Private method is not writable");
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a setter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot write private member to an object whose class did not declare it");
    return (kind === "a" ? f.call(receiver, value) : f ? f.value = value : state.set(receiver, value)), value;
};
var __classPrivateFieldGet = (this && this.__classPrivateFieldGet) || function (receiver, state, kind, f) {
    if (kind === "a" && !f) throw new TypeError("Private accessor was defined without a getter");
    if (typeof state === "function" ? receiver !== state || !f : !state.has(receiver)) throw new TypeError("Cannot read private member from an object whose class did not declare it");
    return kind === "m" ? f : kind === "a" ? f.call(receiver) : f ? f.value : state.get(receiver);
};
var _a, _App_map, _App_tileLayer, _App_mapZoomLevel, _App_mapEvent, _App_workouts, _App_routeMode, _App_routeStep, _App_routePointA, _App_routePointB, _App_routeLine, _App_routeMarkerA, _App_routeMarkerB, _App_routeActivityMode, _App_routeCoords, _App_routeTotalDist, _App_progressLine, _App_progressWatchId, _App_coveredUpToIndex, _App_arrivedShown, _App_nearDestCount, _App_ARRIVAL_CONSEC, _App_ARRIVAL_DIST, _App_voiceEnabled, _App_voiceKmAnnounced, _App_voiceStartTime, _App_voiceDistCovered, _App_trackingActive, _App_watchId, _App_trackingMarker, _App_trackingCoords, _App_prevTrackingCoords, _App_userTouchingMap, _App_recenterTimer, _App_tracker, _App_historyPanel, _App_nightMode, _App_wakeLock, _App_deferredInstallPrompt, _App_markers, _App_clusterGroup, _App_clusterEnabled, _App_poiMarkers, _App_userCoords, _App_autocompleteTimer, _App_filterDrag, _App_activitySpeeds, _App_activeWorkoutId, _App_workoutRouteLayer, _App_customFilters, _App_pinnedCoord, _App_goalKm, _App_goalTime, _App_goalCount, _App_statsExpanded, _App_statsWeekOffset, _App_statsSelectedDay, _App_statsPrevGoalReached;
import { MAPBOX_TOKEN } from './config.js';
import { Workout, Running, Cycling, Walking } from './models/Workout.js';
import { WorkoutType } from './types/index.js';
import { NetState, showSkeleton, startMapTimeout, initOnlineDetector, initRetryBtn, } from './modules/OfflineDetector.js';
import { initWeatherComponents, switchToGPSWeather } from './modules/initWeatherComponents.js';
import { getIPLocation, requestGPSPermission, subscribeToPermissionChanges, hasGPSPermission } from './modules/LocationService.js';
import { loadWorkoutsFromDB, saveWorkoutToDB, deleteWorkoutFromDB, saveEnrichedActivity, clearAllWorkoutsFromDB, migrateLocalStorageToIndexedDB, } from './modules/db.js';
import { initPushNotifications, resubscribeIfNeeded, sendWorkoutAddedPush, sendWorkoutDeletedPush, sendWelcomeBackPush, sendLongBreakPush, sendArrivedAtDestinationPush, sendWeatherPush, } from './modules/PushNotifications.js';
import { Tracker, formatDuration, formatPace, formatDistance, SPORT_COLORS } from './modules/Tracker.js';
import { showGoodJobSplash, ActivityHistoryPanel } from './modules/ActivityView.js';
import { saveActivity } from './modules/db.js';
import { homeView } from './modules/HomeView.js';
import { statsView } from './modules/StatsView.js';
import { notifyActivityAdded } from './modules/NotificationsService.js';
import { migrateToUnified, saveUnifiedWorkout } from './modules/UnifiedWorkout.js';
import { openSaveActivityModal } from './modules/SaveActivityModal.js';
import { liveTracker } from './modules/LiveTracker.js';
import { FriendsView } from './modules/FriendsView.js';
import { showNameModalIfNeeded, openChangeNameModal } from './modules/UserName.js';
import { initUserProfile } from './modules/UserProfile.js';
import { syncToMongoIfNeeded } from './modules/syncToMongo.js';
// ─── DOM refs (module-level, identical to script.js) ─────────────────────────
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
const TILES = {
    day: 'https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png',
    night: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
};
const TILE_ATTR = {
    day: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    night: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/">CARTO</a>',
};
// ─── App class ────────────────────────────────────────────────────────────────
class App {
    constructor() {
        _App_map.set(this, void 0);
        _App_tileLayer.set(this, null);
        _App_mapZoomLevel.set(this, 13);
        _App_mapEvent.set(this, void 0);
        _App_workouts.set(this, []);
        _App_routeMode.set(this, false);
        _App_routeStep.set(this, 0);
        _App_routePointA.set(this, null);
        _App_routePointB.set(this, null);
        _App_routeLine.set(this, null);
        _App_routeMarkerA.set(this, null);
        _App_routeMarkerB.set(this, null);
        _App_routeActivityMode.set(this, 'running');
        _App_routeCoords.set(this, []);
        _App_routeTotalDist.set(this, 0);
        _App_progressLine.set(this, null);
        _App_progressWatchId.set(this, null);
        _App_coveredUpToIndex.set(this, 0);
        _App_arrivedShown.set(this, false);
        _App_nearDestCount.set(this, 0);
        _App_voiceEnabled.set(this, false);
        _App_voiceKmAnnounced.set(this, 0);
        _App_voiceStartTime.set(this, null);
        _App_voiceDistCovered.set(this, 0);
        _App_trackingActive.set(this, false);
        _App_watchId.set(this, null);
        _App_trackingMarker.set(this, null);
        _App_trackingCoords.set(this, null);
        _App_prevTrackingCoords.set(this, null);
        _App_userTouchingMap.set(this, false);
        _App_recenterTimer.set(this, null);
        _App_tracker.set(this, null);
        _App_historyPanel.set(this, null);
        _App_nightMode.set(this, false);
        _App_wakeLock.set(this, null);
        _App_deferredInstallPrompt.set(this, null);
        _App_markers.set(this, new Map());
        _App_clusterGroup.set(this, null);
        _App_clusterEnabled.set(this, localStorage.getItem('clusterEnabled') === 'true');
        _App_poiMarkers.set(this, []);
        _App_userCoords.set(this, null);
        _App_autocompleteTimer.set(this, null);
        _App_filterDrag.set(this, { active: false, startX: 0, scrollLeft: 0 });
        _App_activitySpeeds.set(this, { running: 10, cycling: 20, walking: 5 });
        _App_activeWorkoutId.set(this, null);
        _App_workoutRouteLayer.set(this, null);
        _App_customFilters.set(this, JSON.parse(localStorage.getItem('customFilters') ?? '[]'));
        _App_pinnedCoord.set(this, null);
        _App_goalKm.set(this, +(localStorage.getItem('goalKm') ?? 35));
        _App_goalTime.set(this, +(localStorage.getItem('goalTime') ?? 300));
        _App_goalCount.set(this, +(localStorage.getItem('goalCount') ?? 7));
        _App_statsExpanded.set(this, false);
        _App_statsWeekOffset.set(this, 0);
        _App_statsSelectedDay.set(this, null);
        _App_statsPrevGoalReached.set(this, false);
        void this._loadMapFromIP();
        void this._getLocalStorage();
        form.addEventListener('submit', this._newWorkout.bind(this));
        inputType.addEventListener('change', this._toggleElevationField);
        containerWorkouts.addEventListener('click', this._moveToPopup.bind(this));
        this._initContainerSwipe();
        btnRoute.addEventListener('click', this._startRouteMode.bind(this));
        btnCancelRoute.addEventListener('click', this._cancelRoute.bind(this));
        btnTrack.addEventListener('click', this._toggleTracking.bind(this));
        document.querySelectorAll('.route-mode-btn').forEach(btn => btn.addEventListener('click', this._setActivityMode.bind(this)));
        this._initPOISearch();
        this._initSettings();
        this._initFilterScroll();
        this._initPWAInstall();
        this._initStats();
        this._initIOSBanner();
        this._initCustomFilters();
        if (localStorage.getItem('nightMode') === 'true') {
            __classPrivateFieldSet(this, _App_nightMode, true, "f");
            document.body.classList.add('night-mode');
            document.getElementById('nightToggle')?.classList.add('active');
        }
        if (localStorage.getItem('voiceStats') === 'true') {
            __classPrivateFieldSet(this, _App_voiceEnabled, true, "f");
            document.getElementById('voiceToggle')?.classList.add('active');
        }
    }
    // ── GEOLOCATION ───────────────────────────────────────────────────────────
    /** Load map using IP location — no GPS permission needed */
    async _loadMapFromIP() {
        const DEFAULT_COORDS = [52.237, 21.017]; // Warsaw fallback
        // If GPS already granted from a previous session → use precise coords immediately
        // (hasGPSPermission reads localStorage only — no browser prompt)
        if (await hasGPSPermission()) {
            try {
                const { getGPSLocation } = await import('./modules/LocationService.js');
                const gpsCoords = await getGPSLocation();
                this._loadMap(gpsCoords, __classPrivateFieldGet(this, _App_mapZoomLevel, "f")); // precise zoom for GPS
                console.info('[Map] Loaded with GPS (previously granted)');
                subscribeToPermissionChanges((c) => this._recenterMapToGPS(c));
                return;
            }
            catch {
                console.warn('[Map] GPS failed despite permission — falling back to IP');
            }
        }
        // No GPS permission yet → use IP location
        let coords = DEFAULT_COORDS;
        const ipLoc = await getIPLocation();
        if (ipLoc) {
            coords = ipLoc.coords;
            console.info(`[Map] IP location: ${ipLoc.city}, ${ipLoc.country}`);
        }
        else {
            console.warn('[Map] IP location failed — using default coords');
        }
        this._loadMap(coords, 11); // zoom 11 for IP — "your area" without half of Poland
        // Subscribe to future GPS grants → auto re-center when user allows in Track tab
        subscribeToPermissionChanges((gpsCoords) => {
            this._recenterMapToGPS(gpsCoords);
        });
    }
    /** Center map on GPS coords (called after permission granted) */
    _recenterMapToGPS(coords) {
        __classPrivateFieldSet(this, _App_userCoords, coords, "f");
        if (__classPrivateFieldGet(this, _App_map, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").setView(coords, __classPrivateFieldGet(this, _App_mapZoomLevel, "f"), { animate: true });
        }
    }
    /** @deprecated Use _loadMapFromIP instead — kept for initRetryBtn compatibility */
    _getPosition() {
        void this._loadMapFromIP();
    }
    _loadMap(coords, zoom) {
        __classPrivateFieldSet(this, _App_userCoords, coords, "f");
        __classPrivateFieldSet(this, _App_map, L.map('map').setView(coords, zoom ?? __classPrivateFieldGet(this, _App_mapZoomLevel, "f")), "f");
        __classPrivateFieldGet(this, _App_map, "f").createPane('progressPane');
        const pane = __classPrivateFieldGet(this, _App_map, "f").getPane('progressPane');
        if (pane)
            pane.style.zIndex = '650';
        const tileKey = __classPrivateFieldGet(this, _App_nightMode, "f") ? 'night' : 'day';
        __classPrivateFieldSet(this, _App_tileLayer, L.tileLayer(TILES[tileKey], { attribution: TILE_ATTR[tileKey] }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
        __classPrivateFieldGet(this, _App_map, "f").on('click', this._handleMapClick.bind(this));
        __classPrivateFieldGet(this, _App_tileLayer, "f").once('load', () => {
            NetState.mapReady = true;
            NetState.retryCount = 0;
            if (NetState.timeoutId)
                clearTimeout(NetState.timeoutId);
            document.getElementById('mapSkeleton')?.classList.add('hidden');
            document.getElementById('skeletonMsg')?.classList.add('hidden');
        });
        if (__classPrivateFieldGet(this, _App_clusterEnabled, "f")) {
            __classPrivateFieldSet(this, _App_clusterGroup, L.markerClusterGroup({
                maxClusterRadius: 60,
                iconCreateFunction: (cluster) => {
                    const count = cluster.getChildCount();
                    return L.divIcon({
                        html: `<div class="workout-cluster"><span>${count}</span></div>`,
                        className: '', iconSize: [40, 40], iconAnchor: [20, 20],
                    });
                },
            }), "f");
            __classPrivateFieldGet(this, _App_map, "f").addLayer(__classPrivateFieldGet(this, _App_clusterGroup, "f"));
        }
        __classPrivateFieldGet(this, _App_workouts, "f").forEach(w => this._renderWorkoutMarker(w));
        __classPrivateFieldGet(this, _App_map, "f").on('mousedown touchstart', () => {
            __classPrivateFieldSet(this, _App_userTouchingMap, true, "f");
            if (__classPrivateFieldGet(this, _App_recenterTimer, "f"))
                clearTimeout(__classPrivateFieldGet(this, _App_recenterTimer, "f"));
        });
        __classPrivateFieldGet(this, _App_map, "f").on('mouseup touchend', () => {
            __classPrivateFieldSet(this, _App_recenterTimer, setTimeout(() => { __classPrivateFieldSet(this, _App_userTouchingMap, false, "f"); }, 5000), "f");
        });
        // Przy każdym starcie wyślij subskrypcję do backendu (naprawia reset MemoryDB)
        void resubscribeIfNeeded();
        void initPushNotifications().then(async () => {
            // longBreak ma priorytet — jeśli wysłany, pomijamy welcomeBack
            const longBreakSent = await sendLongBreakPush();
            if (!longBreakSent)
                void sendWelcomeBackPush();
            // Push pogodowy jeśli warunki sprzyjają
            void sendWeatherPush();
        });
        this._initTracker();
    }
    // ── SETTINGS ──────────────────────────────────────────────────────────────
    _initSettings() {
        const btnGear = document.getElementById('btnSettings');
        const panel = document.getElementById('settingsPanel');
        const btnBack = document.getElementById('btnSettingsBack');
        const itemShare = document.getElementById('settingShare');
        const itemNight = document.getElementById('settingNight');
        const nightToggle = document.getElementById('nightToggle');
        const itemVoice = document.getElementById('settingVoice');
        const voiceToggle = document.getElementById('voiceToggle');
        const itemClear = document.getElementById('settingClear');
        const itemInstall = document.getElementById('settingInstall');
        btnGear.addEventListener('click', e => { e.stopPropagation(); panel.classList.toggle('hidden'); });
        btnBack.addEventListener('click', () => panel.classList.add('hidden'));
        document.addEventListener('click', (e) => {
            if (!panel.classList.contains('hidden') &&
                !panel.contains(e.target) &&
                e.target !== btnGear)
                panel.classList.add('hidden');
        });
        itemShare.addEventListener('click', () => void this._shareLocation());
        itemNight.addEventListener('click', () => this._toggleNightMode());
        nightToggle?.addEventListener('click', e => { e.stopPropagation(); this._toggleNightMode(); });
        itemVoice.addEventListener('click', () => this._toggleVoice());
        voiceToggle?.addEventListener('click', e => { e.stopPropagation(); this._toggleVoice(); });
        itemClear.addEventListener('click', () => {
            if (confirm('Delete all workouts?')) {
                void clearAllWorkoutsFromDB().then(() => location.reload());
            }
        });
        itemInstall?.addEventListener('click', () => {
            if (__classPrivateFieldGet(this, _App_deferredInstallPrompt, "f")) {
                void __classPrivateFieldGet(this, _App_deferredInstallPrompt, "f").prompt();
                void __classPrivateFieldGet(this, _App_deferredInstallPrompt, "f").userChoice.then(() => {
                    __classPrivateFieldSet(this, _App_deferredInstallPrompt, null, "f");
                    if (itemInstall)
                        itemInstall.style.display = 'none';
                });
            }
        });
        const clusterToggle = document.getElementById('clusterToggle');
        if (__classPrivateFieldGet(this, _App_clusterEnabled, "f"))
            clusterToggle?.classList.add('active');
        const doToggleCluster = () => {
            __classPrivateFieldSet(this, _App_clusterEnabled, !__classPrivateFieldGet(this, _App_clusterEnabled, "f"), "f");
            localStorage.setItem('clusterEnabled', String(__classPrivateFieldGet(this, _App_clusterEnabled, "f")));
            clusterToggle?.classList.toggle('active', __classPrivateFieldGet(this, _App_clusterEnabled, "f"));
            location.reload();
        };
        document.getElementById('settingCluster')?.addEventListener('click', doToggleCluster);
        clusterToggle?.addEventListener('click', e => { e.stopPropagation(); doToggleCluster(); });
    }
    _initPWAInstall() {
        window.addEventListener('beforeinstallprompt', (e) => {
            e.preventDefault();
            __classPrivateFieldSet(this, _App_deferredInstallPrompt, e, "f");
            const item = document.getElementById('settingInstall');
            if (item)
                item.style.display = 'flex';
        });
    }
    _toggleNightMode() {
        __classPrivateFieldSet(this, _App_nightMode, !__classPrivateFieldGet(this, _App_nightMode, "f"), "f");
        document.body.classList.toggle('night-mode', __classPrivateFieldGet(this, _App_nightMode, "f"));
        document.getElementById('nightToggle')?.classList.toggle('active', __classPrivateFieldGet(this, _App_nightMode, "f"));
        localStorage.setItem('nightMode', String(__classPrivateFieldGet(this, _App_nightMode, "f")));
        if (__classPrivateFieldGet(this, _App_map, "f") && __classPrivateFieldGet(this, _App_tileLayer, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_tileLayer, "f"));
            const key = __classPrivateFieldGet(this, _App_nightMode, "f") ? 'night' : 'day';
            __classPrivateFieldSet(this, _App_tileLayer, L.tileLayer(TILES[key], { attribution: TILE_ATTR[key] }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
        }
    }
    // ── VOICE ─────────────────────────────────────────────────────────────────
    _toggleVoice() {
        __classPrivateFieldSet(this, _App_voiceEnabled, !__classPrivateFieldGet(this, _App_voiceEnabled, "f"), "f");
        document.getElementById('voiceToggle')?.classList.toggle('active', __classPrivateFieldGet(this, _App_voiceEnabled, "f"));
        localStorage.setItem('voiceStats', String(__classPrivateFieldGet(this, _App_voiceEnabled, "f")));
        if (__classPrivateFieldGet(this, _App_voiceEnabled, "f"))
            this._speak('Voice stats enabled.');
    }
    _speak(text) {
        if (!('speechSynthesis' in window))
            return;
        window.speechSynthesis.cancel();
        const utt = new SpeechSynthesisUtterance(text);
        utt.lang = 'pl-PL';
        utt.rate = 1.0;
        utt.pitch = 1.0;
        window.speechSynthesis.speak(utt);
    }
    _updateVoiceStats(lat, lng) {
        if (!__classPrivateFieldGet(this, _App_voiceEnabled, "f") || !__classPrivateFieldGet(this, _App_trackingActive, "f"))
            return;
        if (!__classPrivateFieldGet(this, _App_voiceStartTime, "f")) {
            __classPrivateFieldSet(this, _App_voiceStartTime, Date.now(), "f");
            __classPrivateFieldSet(this, _App_voiceDistCovered, 0, "f");
            __classPrivateFieldSet(this, _App_voiceKmAnnounced, 0, "f");
            __classPrivateFieldSet(this, _App_prevTrackingCoords, [lat, lng], "f");
            return;
        }
        if (__classPrivateFieldGet(this, _App_prevTrackingCoords, "f")) {
            const seg = this._haversine(__classPrivateFieldGet(this, _App_prevTrackingCoords, "f"), [lat, lng]);
            if (seg < 100)
                __classPrivateFieldSet(this, _App_voiceDistCovered, __classPrivateFieldGet(this, _App_voiceDistCovered, "f") + seg, "f");
        }
        __classPrivateFieldSet(this, _App_prevTrackingCoords, [lat, lng], "f");
        const km = __classPrivateFieldGet(this, _App_voiceDistCovered, "f") / 1000;
        const next = __classPrivateFieldGet(this, _App_voiceKmAnnounced, "f") + 1;
        if (km >= next) {
            __classPrivateFieldSet(this, _App_voiceKmAnnounced, next, "f");
            const elapsed = (Date.now() - __classPrivateFieldGet(this, _App_voiceStartTime, "f")) / 60000;
            const pace = elapsed / km;
            const pm = Math.floor(pace), ps = Math.round((pace - pm) * 60);
            this._speak(`Pokonałeś ${next} ${next === 1 ? 'kilometr' : next < 5 ? 'kilometry' : 'kilometrów'}. ` +
                `Średnie tempo: ${pm} minut ${ps < 10 ? '0' + ps : ps} sekund na kilometr.`);
        }
    }
    _resetVoiceStats() {
        __classPrivateFieldSet(this, _App_voiceKmAnnounced, 0, "f");
        __classPrivateFieldSet(this, _App_voiceDistCovered, 0, "f");
        __classPrivateFieldSet(this, _App_voiceStartTime, null, "f");
        __classPrivateFieldSet(this, _App_prevTrackingCoords, null, "f");
    }
    // ── SHARE ─────────────────────────────────────────────────────────────────
    async _shareLocation() {
        const coords = __classPrivateFieldGet(this, _App_trackingCoords, "f") ?? __classPrivateFieldGet(this, _App_userCoords, "f");
        if (!coords) {
            alert('Location not available yet. Start tracking first.');
            return;
        }
        const [lat, lng] = coords;
        const url = `https://www.google.com/maps?q=${lat},${lng}`;
        if (navigator.share) {
            try {
                await navigator.share({ title: 'My location — Mapty', text: 'Here is my current location:', url });
                return;
            }
            catch { /* cancelled */ }
        }
        try {
            await navigator.clipboard.writeText(url);
            this._showToast('📋 Link copied to clipboard!');
        }
        catch {
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
    // ── FILTER DRAG ───────────────────────────────────────────────────────────
    _initFilterScroll() {
        const el = document.getElementById('poiFilters');
        if (!el)
            return;
        el.addEventListener('mousedown', (e) => {
            __classPrivateFieldSet(this, _App_filterDrag, { active: true, startX: e.pageX - el.offsetLeft, scrollLeft: el.scrollLeft }, "f");
        });
        el.addEventListener('mouseleave', () => { __classPrivateFieldGet(this, _App_filterDrag, "f").active = false; });
        el.addEventListener('mouseup', () => { __classPrivateFieldGet(this, _App_filterDrag, "f").active = false; });
        el.addEventListener('mousemove', (e) => {
            if (!__classPrivateFieldGet(this, _App_filterDrag, "f").active)
                return;
            e.preventDefault();
            el.scrollLeft = __classPrivateFieldGet(this, _App_filterDrag, "f").scrollLeft - (e.pageX - el.offsetLeft - __classPrivateFieldGet(this, _App_filterDrag, "f").startX);
        });
    }
    // ── WAKE LOCK ─────────────────────────────────────────────────────────────
    async _requestWakeLock() {
        if (!('wakeLock' in navigator))
            return;
        try {
            __classPrivateFieldSet(this, _App_wakeLock, await navigator.wakeLock.request('screen'), "f");
            document.addEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
            this._updateWakeLockBadge(true);
        }
        catch { /* not available */ }
    }
    async _releaseWakeLock() {
        if (!__classPrivateFieldGet(this, _App_wakeLock, "f"))
            return;
        try {
            await __classPrivateFieldGet(this, _App_wakeLock, "f").release();
        }
        catch { /* ignore */ }
        __classPrivateFieldSet(this, _App_wakeLock, null, "f");
        document.removeEventListener('visibilitychange', this._handleVisibilityChange.bind(this));
        this._updateWakeLockBadge(false);
    }
    async _handleVisibilityChange() {
        if (__classPrivateFieldGet(this, _App_wakeLock, "f") !== null && document.visibilityState === 'visible' && __classPrivateFieldGet(this, _App_trackingActive, "f"))
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
        }
        else {
            badge?.remove();
        }
    }
    // ── TRACKING ──────────────────────────────────────────────────────────────
    _toggleTracking() {
        if (__classPrivateFieldGet(this, _App_trackingActive, "f"))
            this._stopTracking();
        else
            this._startTracking();
    }
    _startTracking() {
        if (!navigator.geolocation)
            return;
        __classPrivateFieldSet(this, _App_trackingActive, true, "f");
        btnTrack.textContent = '⏹ Stop tracking';
        btnTrack.classList.add('tracking--active');
        void this._requestWakeLock();
        this._resetVoiceStats();
        const dotIcon = L.divIcon({
            className: '',
            html: `<div class="tracking-dot"><div class="tracking-dot__pulse"></div><div class="tracking-dot__core"></div></div>`,
            iconSize: [18, 18], iconAnchor: [9, 9],
        });
        __classPrivateFieldSet(this, _App_watchId, navigator.geolocation.watchPosition(position => {
            const { latitude: lat, longitude: lng } = position.coords;
            const latlng = [lat, lng];
            __classPrivateFieldSet(this, _App_trackingCoords, latlng, "f");
            if (!__classPrivateFieldGet(this, _App_trackingMarker, "f")) {
                __classPrivateFieldSet(this, _App_trackingMarker, L.marker(latlng, { icon: dotIcon, zIndexOffset: 1000 }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
                __classPrivateFieldGet(this, _App_map, "f").setView(latlng, __classPrivateFieldGet(this, _App_mapZoomLevel, "f"), { animate: true });
            }
            else {
                __classPrivateFieldGet(this, _App_trackingMarker, "f").setLatLng(latlng);
                if (!__classPrivateFieldGet(this, _App_userTouchingMap, "f")) {
                    const mp = __classPrivateFieldGet(this, _App_map, "f").latLngToContainerPoint(L.latLng(latlng));
                    const cp = __classPrivateFieldGet(this, _App_map, "f").getSize().divideBy(2);
                    if (mp.distanceTo(cp) > 120)
                        __classPrivateFieldGet(this, _App_map, "f").setView(latlng, __classPrivateFieldGet(this, _App_map, "f").getZoom(), { animate: true, duration: 0.6 });
                }
            }
            if (__classPrivateFieldGet(this, _App_routeCoords, "f").length > 0 && __classPrivateFieldGet(this, _App_progressLine, "f"))
                this._updateRouteProgress(lat, lng);
            this._updateVoiceStats(lat, lng);
        }, () => { alert('Could not get your position for tracking.'); this._stopTracking(); }, { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }), "f");
    }
    _stopTracking() {
        __classPrivateFieldSet(this, _App_trackingActive, false, "f");
        __classPrivateFieldSet(this, _App_trackingCoords, null, "f");
        btnTrack.textContent = '📍 Start tracking';
        btnTrack.classList.remove('tracking--active');
        void this._releaseWakeLock();
        this._resetVoiceStats();
        if (__classPrivateFieldGet(this, _App_watchId, "f") !== null) {
            navigator.geolocation.clearWatch(__classPrivateFieldGet(this, _App_watchId, "f"));
            __classPrivateFieldSet(this, _App_watchId, null, "f");
        }
        if (__classPrivateFieldGet(this, _App_trackingMarker, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_trackingMarker, "f"));
            __classPrivateFieldSet(this, _App_trackingMarker, null, "f");
        }
    }
    // ── ROUTE PROGRESS ────────────────────────────────────────────────────────
    _setupRouteProgress(routeCoords, totalDistM) {
        __classPrivateFieldSet(this, _App_routeCoords, routeCoords, "f");
        __classPrivateFieldSet(this, _App_routeTotalDist, totalDistM, "f");
        __classPrivateFieldSet(this, _App_coveredUpToIndex, 0, "f");
        __classPrivateFieldSet(this, _App_arrivedShown, false, "f");
        __classPrivateFieldSet(this, _App_nearDestCount, 0, "f");
        if (__classPrivateFieldGet(this, _App_progressLine, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_progressLine, "f"));
            __classPrivateFieldSet(this, _App_progressLine, null, "f");
        }
        __classPrivateFieldSet(this, _App_progressLine, L.polyline([], {
            color: '#a0a0a0', weight: 7, opacity: 1,
            lineJoin: 'round', lineCap: 'round', pane: 'progressPane',
        }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
        if (!__classPrivateFieldGet(this, _App_trackingActive, "f"))
            this._startProgressOnlyWatch();
    }
    _startProgressOnlyWatch() {
        __classPrivateFieldSet(this, _App_progressWatchId, navigator.geolocation.watchPosition(pos => {
            if (!__classPrivateFieldGet(this, _App_routeCoords, "f").length) {
                if (__classPrivateFieldGet(this, _App_progressWatchId, "f") !== null)
                    navigator.geolocation.clearWatch(__classPrivateFieldGet(this, _App_progressWatchId, "f"));
                return;
            }
            this._updateRouteProgress(pos.coords.latitude, pos.coords.longitude);
        }, () => { }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }), "f");
    }
    _updateRouteProgress(lat, lng) {
        var _b;
        const userPt = L.latLng(lat, lng);
        let closestIdx = __classPrivateFieldGet(this, _App_coveredUpToIndex, "f"), minDist = Infinity;
        for (let i = __classPrivateFieldGet(this, _App_coveredUpToIndex, "f"); i < __classPrivateFieldGet(this, _App_routeCoords, "f").length; i++) {
            const d = userPt.distanceTo(L.latLng(__classPrivateFieldGet(this, _App_routeCoords, "f")[i]));
            if (d < minDist) {
                minDist = d;
                closestIdx = i;
            }
            if (d > minDist + 200 && i > __classPrivateFieldGet(this, _App_coveredUpToIndex, "f") + 15)
                break;
        }
        if (closestIdx > __classPrivateFieldGet(this, _App_coveredUpToIndex, "f") && minDist < 40) {
            __classPrivateFieldSet(this, _App_coveredUpToIndex, closestIdx, "f");
            __classPrivateFieldGet(this, _App_progressLine, "f").setLatLngs(__classPrivateFieldGet(this, _App_routeCoords, "f").slice(0, __classPrivateFieldGet(this, _App_coveredUpToIndex, "f") + 1));
            this._updateRemainingStats();
        }
        const lastPt = L.latLng(__classPrivateFieldGet(this, _App_routeCoords, "f")[__classPrivateFieldGet(this, _App_routeCoords, "f").length - 1]);
        if (userPt.distanceTo(lastPt) < __classPrivateFieldGet(_a, _a, "f", _App_ARRIVAL_DIST))
            __classPrivateFieldSet(this, _App_nearDestCount, (_b = __classPrivateFieldGet(this, _App_nearDestCount, "f"), _b++, _b), "f");
        else
            __classPrivateFieldSet(this, _App_nearDestCount, 0, "f");
        if (__classPrivateFieldGet(this, _App_nearDestCount, "f") >= __classPrivateFieldGet(_a, _a, "f", _App_ARRIVAL_CONSEC) && !__classPrivateFieldGet(this, _App_arrivedShown, "f")) {
            __classPrivateFieldSet(this, _App_arrivedShown, true, "f");
            this._showArrivalToast();
            if (__classPrivateFieldGet(this, _App_voiceEnabled, "f"))
                this._speak('Dotarłeś na miejsce. Cel osiągnięty!');
            void sendArrivedAtDestinationPush();
        }
    }
    _updateRemainingStats() {
        if (!__classPrivateFieldGet(this, _App_routeCoords, "f").length)
            return;
        let remainM = 0;
        for (let i = __classPrivateFieldGet(this, _App_coveredUpToIndex, "f"); i < __classPrivateFieldGet(this, _App_routeCoords, "f").length - 1; i++)
            remainM += L.latLng(__classPrivateFieldGet(this, _App_routeCoords, "f")[i]).distanceTo(L.latLng(__classPrivateFieldGet(this, _App_routeCoords, "f")[i + 1]));
        const rKm = remainM / 1000;
        routeDist.textContent = rKm.toFixed(2);
        routeTime.textContent = String(Math.max(0, Math.round((rKm / __classPrivateFieldGet(this, _App_activitySpeeds, "f")[__classPrivateFieldGet(this, _App_routeActivityMode, "f")]) * 60)));
    }
    _showArrivalToast() {
        document.querySelector('.arrival-toast')?.remove();
        const t = document.createElement('div');
        t.className = 'arrival-toast';
        t.innerHTML = `<span class="arrival-toast__icon">🎯</span><div><strong>You've arrived!</strong><p>Destination reached.</p></div><button class="arrival-toast__close">✕</button>`;
        document.body.appendChild(t);
        t.querySelector('.arrival-toast__close').addEventListener('click', () => t.remove());
        setTimeout(() => t?.remove(), 8000);
    }
    _stopRouteProgress() {
        if (__classPrivateFieldGet(this, _App_progressWatchId, "f") !== null) {
            navigator.geolocation.clearWatch(__classPrivateFieldGet(this, _App_progressWatchId, "f"));
            __classPrivateFieldSet(this, _App_progressWatchId, null, "f");
        }
        if (__classPrivateFieldGet(this, _App_progressLine, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_progressLine, "f"));
            __classPrivateFieldSet(this, _App_progressLine, null, "f");
        }
        __classPrivateFieldSet(this, _App_routeCoords, [], "f");
        __classPrivateFieldSet(this, _App_coveredUpToIndex, 0, "f");
        __classPrivateFieldSet(this, _App_arrivedShown, false, "f");
        __classPrivateFieldSet(this, _App_nearDestCount, 0, "f");
        document.querySelector('.arrival-toast')?.remove();
    }
    // ── MAP CLICK ─────────────────────────────────────────────────────────────
    _handleMapClick(mapE) {
        // Never open workout form when Home tab or Friends tab is active —
        // clicks there should not fall through to the map handler.
        const activeTab = document.querySelector('.tab-panel--active');
        if (activeTab && (activeTab.id === 'tabHome' || activeTab.id === 'tabFriends'))
            return;
        __classPrivateFieldSet(this, _App_pinnedCoord, [mapE.latlng.lat, mapE.latlng.lng], "f");
        if (__classPrivateFieldGet(this, _App_routeMode, "f") && __classPrivateFieldGet(this, _App_routeStep, "f") < 3)
            this._handleRouteClick(mapE);
        else
            this._showForm(mapE);
    }
    _showForm(mapE) {
        __classPrivateFieldSet(this, _App_mapEvent, mapE, "f");
        if (window.innerWidth <= 768)
            this._showFormModal();
        else {
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
      </div>`;
        document.body.appendChild(modal);
        const wmType = document.getElementById('wm-type');
        const wmDist = document.getElementById('wm-distance');
        const wmDur = document.getElementById('wm-duration');
        const wmCad = document.getElementById('wm-cadence');
        const wmElev = document.getElementById('wm-elevation');
        const wmCadRow = document.getElementById('wm-cadence-row');
        const wmElevRow = document.getElementById('wm-elev-row');
        wmType.addEventListener('change', () => {
            if (wmType.value === 'cycling') {
                wmCadRow.classList.add('hidden');
                wmElevRow.classList.remove('hidden');
            }
            else {
                wmCadRow.classList.remove('hidden');
                wmElevRow.classList.add('hidden');
            }
        });
        document.getElementById('wmCancel').addEventListener('click', () => modal.remove());
        document.getElementById('workoutModalForm').addEventListener('submit', e => {
            e.preventDefault();
            const type = wmType.value;
            const distance = +wmDist.value, duration = +wmDur.value;
            const { lat, lng } = __classPrivateFieldGet(this, _App_mapEvent, "f").latlng;
            const validInputs = (...v) => v.every(n => Number.isFinite(n));
            const allPositive = (...v) => v.every(n => n > 0);
            let workout;
            if (type === WorkoutType.Running) {
                const cadence = +wmCad.value;
                if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
                    return void alert('Inputs have to be positive numbers!');
                workout = new Running([lat, lng], distance, duration, cadence);
            }
            else if (type === WorkoutType.Cycling) {
                const elevation = +wmElev.value;
                if (!validInputs(distance, duration, elevation) || !allPositive(distance, duration))
                    return void alert('Inputs have to be positive numbers!');
                workout = new Cycling([lat, lng], distance, duration, elevation);
            }
            else {
                const cadence = +wmCad.value;
                if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
                    return void alert('Inputs have to be positive numbers!');
                workout = new Walking([lat, lng], distance, duration, cadence);
            }
            modal.remove();
            __classPrivateFieldGet(this, _App_workouts, "f").push(workout);
            if (__classPrivateFieldGet(this, _App_routeCoords, "f")?.length > 1)
                workout.routeCoords = [...__classPrivateFieldGet(this, _App_routeCoords, "f")];
            __classPrivateFieldSet(this, _App_activeWorkoutId, '__pending__', "f");
            this._renderWorkoutMarker(workout);
            this._renderWorkout(workout);
            this._setLocalStorage();
            this._renderStats(true);
            this._renderStreak();
            void sendWorkoutAddedPush();
            // Save to enrichedActivities + unifiedWorkouts + refresh views
            const _wm = workout.toJSON();
            const _wmDistKm = Number(_wm.distance) || 0;
            const _wmDurSec = Math.round((Number(_wm.duration) || 0) * 60);
            const _wmPace = _wmDurSec > 0 && _wmDistKm > 0 ? (_wmDurSec / 60) / _wmDistKm : 0;
            const _wmSpeed = _wmDurSec > 0 && _wmDistKm > 0 ? _wmDistKm / (_wmDurSec / 3600) : 0;
            const _wmType = (workout.type ?? 'running');
            const _wmDate = workout.date ? new Date(workout.date).toISOString() : new Date().toISOString();
            const _wmEnriched = {
                id: String(workout.id),
                sport: _wmType,
                date: new Date(_wmDate).getTime(),
                name: workout.description ?? '',
                description: workout.description ?? '',
                photoUrl: null,
                distanceKm: _wmDistKm,
                durationSec: _wmDurSec,
                paceMinKm: _wmPace,
                speedKmH: _wmSpeed,
                intensity: 0,
                notes: '',
                // Use routeCoords (planned route) if available, else fall back to workout point coords
                coords: Array.isArray(_wm.routeCoords) && _wm.routeCoords.length > 0
                    ? _wm.routeCoords
                    : (Array.isArray(_wm.coords) && _wm.coords.length === 2
                        ? [_wm.coords] // single point [lat,lng] → wrap in array
                        : []),
            };
            void saveEnrichedActivity(_wmEnriched);
            void saveUnifiedWorkout({
                ..._wmEnriched,
                type: _wmType,
                source: 'manual',
                elevGain: Number(_wm.elevGain ?? 0) || 0,
            });
            notifyActivityAdded(workout.description ?? workout.type, _wmDistKm, workout.type);
            void homeView.render();
            void statsView.render();
        });
        setTimeout(() => wmDist.focus(), 100);
    }
    _hideForm() {
        inputDistance.value = inputDuration.value = inputCadence.value = inputElevation.value = '';
        form.style.display = 'none';
        form.classList.add('hidden');
        setTimeout(() => (form.style.display = 'grid'), 1000);
        document.querySelector('.tab-scroll')?.scrollTo({ top: 0 });
    }
    _toggleElevationField() {
        inputElevation.closest('.form__row').classList.toggle('form__row--hidden');
        inputCadence.closest('.form__row').classList.toggle('form__row--hidden');
    }
    // ── WORKOUT ───────────────────────────────────────────────────────────────
    _newWorkout(e) {
        const validInputs = (...v) => v.every(n => Number.isFinite(n));
        const allPositive = (...v) => v.every(n => n > 0);
        e.preventDefault();
        const type = inputType.value;
        const distance = +inputDistance.value, duration = +inputDuration.value;
        const { lat, lng } = __classPrivateFieldGet(this, _App_mapEvent, "f").latlng;
        let workout;
        if (type === WorkoutType.Running) {
            const cadence = +inputCadence.value;
            if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
                return void alert('Inputs have to be positive numbers!');
            workout = new Running([lat, lng], distance, duration, cadence);
        }
        else if (type === WorkoutType.Cycling) {
            const elevation = +inputElevation.value;
            if (!validInputs(distance, duration, elevation) || !allPositive(distance, duration))
                return void alert('Inputs have to be positive numbers!');
            workout = new Cycling([lat, lng], distance, duration, elevation);
        }
        else {
            const cadence = +inputCadence.value;
            if (!validInputs(distance, duration, cadence) || !allPositive(distance, duration, cadence))
                return void alert('Inputs have to be positive numbers!');
            workout = new Walking([lat, lng], distance, duration, cadence);
        }
        __classPrivateFieldGet(this, _App_workouts, "f").push(workout);
        if (__classPrivateFieldGet(this, _App_routeCoords, "f")?.length > 1)
            workout.routeCoords = [...__classPrivateFieldGet(this, _App_routeCoords, "f")];
        __classPrivateFieldSet(this, _App_activeWorkoutId, '__pending__', "f");
        this._renderWorkoutMarker(workout);
        this._renderWorkout(workout);
        this._hideForm();
        this._setLocalStorage();
        this._renderStats(true);
        this._renderStreak();
        void sendWorkoutAddedPush();
        // Save to enrichedActivities (for Home feed) + unifiedWorkouts (for Stats)
        const _w = workout.toJSON();
        const _distKm = Number(_w.distance) || 0;
        const _durMin = Number(_w.duration) || 0;
        const _durSec = Math.round(_durMin * 60);
        const _pace = _durMin > 0 && _distKm > 0 ? _durMin / _distKm : 0;
        const _speed = _durSec > 0 && _distKm > 0 ? _distKm / (_durSec / 3600) : 0;
        const _wType = (workout.type ?? 'running');
        const _wDate = workout.date ? new Date(workout.date).toISOString() : new Date().toISOString();
        const _enriched = {
            id: String(workout.id),
            sport: _wType,
            date: new Date(_wDate).getTime(),
            name: workout.description ?? '',
            description: workout.description ?? '',
            photoUrl: null,
            distanceKm: _distKm,
            durationSec: _durSec,
            paceMinKm: _pace,
            speedKmH: _speed,
            intensity: 0,
            notes: '',
            coords: Array.isArray(_w.routeCoords) && _w.routeCoords.length > 0
                ? _w.routeCoords
                : (Array.isArray(_w.coords) && _w.coords.length === 2
                    ? [_w.coords]
                    : []),
        };
        void saveEnrichedActivity(_enriched);
        void saveUnifiedWorkout({
            ..._enriched,
            type: _wType,
            source: 'manual',
            elevGain: Number(_w.elevGain ?? 0) || 0,
        });
        // Notify + refresh views
        notifyActivityAdded(workout.description ?? workout.type, _distKm, workout.type);
        void homeView.render();
        void statsView.render();
    }
    // ── MARKERS ───────────────────────────────────────────────────────────────
    _showMarker(marker) {
        marker.setOpacity(1);
        const m = marker;
        if (m._icon)
            m._icon.style.pointerEvents = '';
        if (m._shadow)
            m._shadow.style.pointerEvents = '';
        setTimeout(() => {
            if (m._icon)
                m._icon.style.pointerEvents = '';
            if (m._shadow)
                m._shadow.style.pointerEvents = '';
        }, 0);
    }
    _hideMarker(marker) {
        marker.setOpacity(0);
        marker.closePopup();
        setTimeout(() => {
            const m = marker;
            if (m._icon)
                m._icon.style.pointerEvents = 'none';
            if (m._shadow)
                m._shadow.style.pointerEvents = 'none';
        }, 0);
    }
    _renderWorkoutMarker(workout) {
        const icon = workout.type === WorkoutType.Running ? '🏃‍♂️' : workout.type === WorkoutType.Cycling ? '🚴‍♀️' : '🚶';
        const popupClass = `${workout.type}-popup`;
        const target = __classPrivateFieldGet(this, _App_clusterGroup, "f") ?? __classPrivateFieldGet(this, _App_map, "f");
        const marker = L.marker(workout.coords)
            .bindPopup(L.popup({ maxWidth: 250, minWidth: 100, autoClose: false, closeOnClick: false, className: popupClass }))
            .setPopupContent(`${icon} ${workout.description}`);
        target.addLayer(marker);
        __classPrivateFieldGet(this, _App_markers, "f").set(workout.id, marker);
        if (__classPrivateFieldGet(this, _App_clusterEnabled, "f")) {
            this._showMarker(marker);
            if (__classPrivateFieldGet(this, _App_activeWorkoutId, "f") === '__pending__') {
                __classPrivateFieldSet(this, _App_activeWorkoutId, workout.id, "f");
                marker.openPopup();
            }
        }
        else {
            if (__classPrivateFieldGet(this, _App_activeWorkoutId, "f") === '__pending__') {
                __classPrivateFieldGet(this, _App_markers, "f").forEach((m, id) => { if (id !== workout.id)
                    this._hideMarker(m); });
                this._showMarker(marker);
                marker.openPopup();
                __classPrivateFieldSet(this, _App_activeWorkoutId, workout.id, "f");
            }
            else {
                this._hideMarker(marker);
            }
        }
    }
    // ── WORKOUT CARD ──────────────────────────────────────────────────────────
    _buildRouteThumbnail(routeCoords) {
        if (!routeCoords || routeCoords.length < 2)
            return '';
        const lats = routeCoords.map(c => c[0]), lngs = routeCoords.map(c => c[1]);
        const minLat = Math.min(...lats), maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
        const cLat = (minLat + maxLat) / 2, cLng = (minLng + maxLng) / 2;
        const span = Math.max(maxLat - minLat || 0.002, maxLng - minLng || 0.002);
        let zoom = 15;
        if (span > 0.05)
            zoom = 13;
        else if (span > 0.02)
            zoom = 14;
        else if (span > 0.008)
            zoom = 15;
        else
            zoom = 16;
        const tileUrl = `https://tile.openstreetmap.org/${zoom}/${this._lngToTileX(cLng, zoom)}/${this._latToTileY(cLat, zoom)}.png`;
        const W = 80, H = 80, PAD = 4;
        const ranLat = maxLat - minLat || 0.001, ranLng = maxLng - minLng || 0.001;
        const toX = (lng) => PAD + ((lng - minLng) / ranLng) * (W - 2 * PAD);
        const toY = (lat) => (H - PAD) - ((lat - minLat) / ranLat) * (H - 2 * PAD);
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
    _lngToTileX(lng, zoom) { return Math.floor((lng + 180) / 360 * Math.pow(2, zoom)); }
    _latToTileY(lat, zoom) {
        const r = Math.PI / 180;
        return Math.floor((1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * Math.pow(2, zoom));
    }
    _renderWorkout(workout) {
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
    _initContainerSwipe() {
        let startX = 0, startY = 0, currentX = 0;
        let swipeEl = null;
        let isSwiping = false, locked = false;
        const THRESHOLD = 80;
        document.addEventListener('touchstart', (e) => {
            const el = e.target.closest('.workout');
            if (!el)
                return;
            swipeEl = el;
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            currentX = 0;
            isSwiping = false;
            locked = false;
            swipeEl.style.transition = 'none';
        }, { passive: true });
        document.addEventListener('touchmove', (e) => {
            if (!swipeEl || locked)
                return;
            const dx = e.touches[0].clientX - startX;
            const dy = e.touches[0].clientY - startY;
            if (!isSwiping && Math.abs(dy) > Math.abs(dx) + 10) {
                locked = true;
                return;
            }
            if (Math.abs(dx) > 10)
                isSwiping = true;
            if (!isSwiping)
                return;
            if (e.cancelable)
                e.preventDefault();
            currentX = dx;
            const clamped = Math.max(-150, Math.min(150, dx));
            swipeEl.style.transform = `translateX(${clamped}px)`;
            const ratio = Math.min(Math.abs(clamped) / THRESHOLD, 1);
            swipeEl.style.boxShadow = `inset 0 0 0 2px rgba(255,80,80,${ratio * 0.9})`;
        }, { passive: false });
        document.addEventListener('touchend', () => {
            if (!swipeEl || !isSwiping) {
                swipeEl = null;
                return;
            }
            const el = swipeEl;
            swipeEl = null;
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
                    if (id && confirm('Delete this workout?'))
                        this._deleteWorkout(id);
                }, 280);
            }
            else {
                el.style.transform = '';
                el.style.boxShadow = '';
            }
        }, { passive: true });
        document.addEventListener('touchcancel', () => {
            if (!swipeEl)
                return;
            swipeEl.style.transition = '';
            swipeEl.style.transform = '';
            swipeEl.style.boxShadow = '';
            swipeEl = null;
        }, { passive: true });
    }
    _moveToPopup(e) {
        if (!__classPrivateFieldGet(this, _App_map, "f"))
            return;
        const target = e.target;
        const deleteBtn = target.closest('.workout__delete');
        if (deleteBtn) {
            e.stopPropagation();
            this._deleteWorkout(deleteBtn.dataset.id);
            return;
        }
        const workoutEl = target.closest('.workout');
        if (!workoutEl)
            return;
        const workout = __classPrivateFieldGet(this, _App_workouts, "f").find(w => w.id === workoutEl.dataset.id);
        if (!workout)
            return;
        document.querySelectorAll('.workout').forEach(el => el.classList.remove('workout--active'));
        this._clearWorkoutRoute();
        const isSame = __classPrivateFieldGet(this, _App_activeWorkoutId, "f") === workout.id;
        if (!__classPrivateFieldGet(this, _App_clusterEnabled, "f"))
            __classPrivateFieldGet(this, _App_markers, "f").forEach(m => this._hideMarker(m));
        if (isSame) {
            __classPrivateFieldSet(this, _App_activeWorkoutId, null, "f");
        }
        else {
            __classPrivateFieldSet(this, _App_activeWorkoutId, workout.id, "f");
            workoutEl.classList.add('workout--active');
            const marker = __classPrivateFieldGet(this, _App_markers, "f").get(workout.id);
            if (marker) {
                this._showMarker(marker);
                marker.openPopup();
            }
            __classPrivateFieldGet(this, _App_map, "f").setView(workout.coords, __classPrivateFieldGet(this, _App_mapZoomLevel, "f"), { animate: true, duration: 1 });
            if (workout.routeCoords && workout.routeCoords.length > 1)
                this._showWorkoutRoute(workout.routeCoords);
        }
    }
    _showWorkoutRoute(coords) {
        this._clearWorkoutRoute();
        __classPrivateFieldSet(this, _App_workoutRouteLayer, L.polyline(coords, { color: '#00c46a', weight: 4, opacity: 0.75, dashArray: '8 6' }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
    }
    _clearWorkoutRoute() {
        if (__classPrivateFieldGet(this, _App_workoutRouteLayer, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_workoutRouteLayer, "f"));
            __classPrivateFieldSet(this, _App_workoutRouteLayer, null, "f");
        }
    }
    _deleteWorkout(id) {
        const marker = __classPrivateFieldGet(this, _App_markers, "f").get(id);
        if (marker) {
            if (__classPrivateFieldGet(this, _App_clusterGroup, "f"))
                __classPrivateFieldGet(this, _App_clusterGroup, "f").removeLayer(marker);
            else
                __classPrivateFieldGet(this, _App_map, "f").removeLayer(marker);
            __classPrivateFieldGet(this, _App_markers, "f").delete(id);
        }
        if (__classPrivateFieldGet(this, _App_activeWorkoutId, "f") === id) {
            __classPrivateFieldSet(this, _App_activeWorkoutId, null, "f");
            this._clearWorkoutRoute();
        }
        __classPrivateFieldSet(this, _App_workouts, __classPrivateFieldGet(this, _App_workouts, "f").filter(w => w.id !== id), "f");
        const el = document.querySelector(`.workout[data-id="${id}"]`);
        if (el) {
            el.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
            el.style.transform = 'translateX(-110%)';
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 300);
        }
        void deleteWorkoutFromDB(id);
        this._renderStats();
        this._renderStreak();
        void sendWorkoutDeletedPush();
    }
    _setLocalStorage() {
        // Zapisuje ostatnio dodany workout do IndexedDB
        // (wywoływane po każdym push do #workouts)
        const last = __classPrivateFieldGet(this, _App_workouts, "f")[__classPrivateFieldGet(this, _App_workouts, "f").length - 1];
        if (last)
            void saveWorkoutToDB(last.toJSON());
    }
    async _getLocalStorage() {
        // Migruj dane z localStorage do IndexedDB (tylko raz, przy pierwszym uruchomieniu)
        await migrateLocalStorageToIndexedDB();
        // Wczytaj z IndexedDB
        const data = await loadWorkoutsFromDB();
        if (!data.length)
            return;
        __classPrivateFieldSet(this, _App_workouts, data.map((d) => Workout.fromData(d)), "f");
        __classPrivateFieldGet(this, _App_workouts, "f").forEach(w => this._renderWorkout(w));
        this._renderStats();
        this._renderStreak();
    }
    // ── TRACKER ───────────────────────────────────────────────────────────────
    _initTracker() {
        const map = __classPrivateFieldGet(this, _App_map, "f");
        // Init tracker
        __classPrivateFieldSet(this, _App_tracker, new Tracker(map, stats => {
            const sport = __classPrivateFieldGet(this, _App_tracker, "f")?.currentSport ?? 'running';
            const d = document.getElementById('trkDist');
            const t = document.getElementById('trkTime');
            const p = document.getElementById('trkPace');
            const l = document.getElementById('trkPaceLbl');
            if (d)
                d.textContent = formatDistance(stats.distanceKm);
            if (t)
                t.textContent = formatDuration(stats.durationSec);
            if (sport === 'cycling') {
                if (p)
                    p.textContent = stats.speedKmH.toFixed(1);
                if (l)
                    l.textContent = 'km/h';
            }
            else {
                if (p)
                    p.textContent = formatPace(stats.paceMinKm);
                if (l)
                    l.textContent = 'min/km';
            }
        }), "f");
        // Historia
        const histEl = document.getElementById('activityHistoryList');
        if (histEl) {
            __classPrivateFieldSet(this, _App_historyPanel, new ActivityHistoryPanel(histEl, map), "f");
            void __classPrivateFieldGet(this, _App_historyPanel, "f").render();
        }
        // History toggle
        document.getElementById('trkHistoryToggle')?.addEventListener('click', () => {
            document.getElementById('trkHistoryPanel')?.classList.toggle('hidden');
        });
        document.getElementById('trkHistoryClose')?.addEventListener('click', () => {
            document.getElementById('trkHistoryPanel')?.classList.add('hidden');
        });
        // ── Permission ────────────────────────────────────────────────────────
        const permEl = document.getElementById('trkPermission');
        const allowBtn = document.getElementById('trkPermAllow');
        const skipBtn = document.getElementById('trkPermSkip');
        const _showMain = () => permEl?.classList.add('hidden');
        const _showPerm = () => permEl?.classList.remove('hidden');
        // Check current permission state — show/hide panel accordingly
        const _checkPerm = async () => {
            const granted = await hasGPSPermission();
            if (granted)
                _showMain();
            else
                _showPerm();
        };
        void _checkPerm();
        // "Allow location" button — requests GPS, then upgrades map + weather
        allowBtn?.addEventListener('click', async () => {
            if (allowBtn) {
                allowBtn.disabled = true;
                allowBtn.textContent = 'Requesting…';
            }
            const coords = await requestGPSPermission();
            if (allowBtn) {
                allowBtn.disabled = false;
                allowBtn.textContent = 'Allow location';
            }
            if (coords) {
                _showMain();
                // Upgrade map center to GPS
                this._recenterMapToGPS(coords);
                // Upgrade weather to GPS
                void switchToGPSWeather();
                // Dispatch event so other modules know
                window.dispatchEvent(new CustomEvent('mapyou:gps-granted', { detail: { coords } }));
            }
            else {
                // Permission denied — show friendly message inside the panel
                const msg = permEl?.querySelector('.trk-perm__denied');
                if (msg) {
                    msg.style.display = 'block';
                }
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
        // ── Sport selector ────────────────────────────────────────────────────
        document.getElementById('trackerSportSelector')?.addEventListener('click', e => {
            const btn = e.target.closest('.trk-sport-tab');
            if (!btn?.dataset.sport || __classPrivateFieldGet(this, _App_tracker, "f")?.isActive)
                return;
            document.querySelectorAll('.trk-sport-tab').forEach(b => b.classList.remove('trk-sport-tab--active'));
            btn.classList.add('trk-sport-tab--active');
            __classPrivateFieldGet(this, _App_tracker, "f")?.setSport(btn.dataset.sport);
            const color = SPORT_COLORS[btn.dataset.sport];
            const sb = document.getElementById('trkBtnStart');
            if (sb) {
                sb.style.background = color;
                sb.style.boxShadow = `0 6px 28px ${color}80`;
            }
        });
        // ── START ─────────────────────────────────────────────────────────────
        document.getElementById('trkBtnStart')?.addEventListener('click', () => {
            if (!__classPrivateFieldGet(this, _App_tracker, "f"))
                return;
            __classPrivateFieldGet(this, _App_tracker, "f").start();
            void liveTracker.start(); // ← rozpocznij live tracking
            void this._requestWakeLock();
            this._enterTrackingView();
        });
        // ── PAUSE / RESUME ────────────────────────────────────────────────────
        document.getElementById('trkBtnPause')?.addEventListener('click', () => {
            if (!__classPrivateFieldGet(this, _App_tracker, "f")?.isActive)
                return;
            if (__classPrivateFieldGet(this, _App_tracker, "f").isPaused) {
                __classPrivateFieldGet(this, _App_tracker, "f").resume();
                void liveTracker.resume(); // ← wznów live tracking
                this._setTrackingState('active');
            }
            else {
                __classPrivateFieldGet(this, _App_tracker, "f").pause();
                void liveTracker.pause(); // ← pauza live trackingu
                this._setTrackingState('paused');
            }
        });
        // ── STOP ──────────────────────────────────────────────────────────────
        document.getElementById('trkBtnStop')?.addEventListener('click', () => {
            if (!__classPrivateFieldGet(this, _App_tracker, "f"))
                return;
            const activity = __classPrivateFieldGet(this, _App_tracker, "f").stop();
            void liveTracker.finish(); // ← zakończ live tracking
            void this._releaseWakeLock();
            this._exitTrackingView();
            if (!activity)
                return;
            showGoodJobSplash(() => {
                // Open save modal → user fills name, photo, intensity, notes
                openSaveActivityModal(activity, 
                // onSave
                async (enriched) => {
                    await saveActivity(activity);
                    // Save to unified for Stats → Progress
                    await saveUnifiedWorkout({
                        id: enriched.id,
                        type: enriched.sport,
                        source: 'tracking',
                        date: new Date(enriched.date).toISOString(),
                        distanceKm: enriched.distanceKm,
                        durationSec: enriched.durationSec,
                        paceMinKm: enriched.paceMinKm,
                        speedKmH: enriched.speedKmH,
                        elevGain: 0,
                        coords: enriched.coords,
                        name: enriched.name,
                        description: enriched.description,
                        notes: enriched.notes,
                        intensity: enriched.intensity,
                        photoUrl: enriched.photoUrl,
                    });
                    notifyActivityAdded(enriched.name || enriched.description, enriched.distanceKm, enriched.sport);
                    __classPrivateFieldGet(this, _App_tracker, "f")?.reset();
                    await __classPrivateFieldGet(this, _App_historyPanel, "f")?.render();
                    await statsView.render();
                    await homeView.render();
                    homeView.switchToHome();
                }, 
                // onCancel — user dismissed modal without saving → clear the route from map
                () => {
                    __classPrivateFieldGet(this, _App_tracker, "f")?.reset();
                });
            });
        });
        // ── DISCARD ───────────────────────────────────────────────────────────
        document.getElementById('trkBtnDiscard')?.addEventListener('click', () => {
            if (!confirm('Discard activity?'))
                return;
            void liveTracker.finish(); // ← zakończ live tracking (jak przy Stop)
            __classPrivateFieldGet(this, _App_tracker, "f")?.reset();
            void this._releaseWakeLock();
            this._exitTrackingView();
        });
    }
    _enterTrackingView() {
        const nav = document.querySelector('.bottom-nav');
        if (nav)
            nav.style.display = 'none';
        document.getElementById('mapSearchBarMobile')?.classList.add('msb--hidden-tab');
        // Ukryj bottom bar (sport selector + start btn)
        const bottom = document.getElementById('trkBottom');
        if (bottom)
            bottom.style.display = 'none';
        const histBtn = document.getElementById('trkHistoryToggle');
        if (histBtn)
            histBtn.style.display = 'none';
        document.getElementById('tabMap')?.classList.add('tab-panel--active');
        document.getElementById('trackerOverlay')?.classList.remove('hidden');
        document.getElementById('routeMiniPill')?.classList.add('pill--above-tracker');
        this._setTrackingState('active');
        setTimeout(() => window.app.invalidateMapSize(), 150);
    }
    _exitTrackingView() {
        document.getElementById('trackerOverlay')?.classList.add('hidden');
        document.getElementById('routeMiniPill')?.classList.remove('pill--above-tracker');
        document.getElementById('tabMap')?.classList.remove('tab-panel--active');
        const nav = document.querySelector('.bottom-nav');
        if (nav)
            nav.style.display = '';
        // Przywróć bottom bar
        const bottom = document.getElementById('trkBottom');
        if (bottom)
            bottom.style.display = '';
        const histBtn = document.getElementById('trkHistoryToggle');
        if (histBtn)
            histBtn.style.display = '';
        this._setTrackingState('idle');
    }
    _setTrackingState(state) {
        const sport = __classPrivateFieldGet(this, _App_tracker, "f")?.currentSport ?? 'running';
        const color = SPORT_COLORS[sport];
        const pauseBtn = document.getElementById('trkBtnPause');
        const stopBtn = document.getElementById('trkBtnStop');
        const discardBtn = document.getElementById('trkBtnDiscard');
        if (state === 'active') {
            if (pauseBtn) {
                pauseBtn.textContent = '⏸ Pause';
                pauseBtn.style.background = color;
            }
            // Finish zawsze widoczny podczas nagrywania
            stopBtn?.classList.remove('hidden');
            discardBtn?.classList.add('hidden');
        }
        else if (state === 'paused') {
            if (pauseBtn) {
                pauseBtn.textContent = '▶ Resume';
                pauseBtn.style.background = '#555';
            }
            stopBtn?.classList.remove('hidden');
            discardBtn?.classList.remove('hidden');
        }
    }
    reset() { void clearAllWorkoutsFromDB().then(() => location.reload()); }
    /** Called by bottom nav when switching to Map tab */
    invalidateMapSize() {
        try {
            __classPrivateFieldGet(this, _App_map, "f")?.invalidateSize();
        }
        catch { /* ignore */ }
    }
    // ── iOS BANNER ────────────────────────────────────────────────────────────
    _initIOSBanner() {
        const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
        const standalone = ('standalone' in navigator && navigator.standalone)
            || window.matchMedia('(display-mode: standalone)').matches;
        if (!isIOS || standalone || localStorage.getItem('iosBannerDismissed'))
            return;
        const banner = document.getElementById('iosInstallBanner');
        const close = document.getElementById('iosInstallClose');
        if (!banner)
            return;
        setTimeout(() => banner.classList.remove('hidden'), 2500);
        close?.addEventListener('click', () => { banner.classList.add('hidden'); localStorage.setItem('iosBannerDismissed', '1'); });
    }
    // ── STREAK ────────────────────────────────────────────────────────────────
    _renderStreak() {
        const countEl = document.getElementById('streakCount');
        const dotsEl = document.getElementById('streakDots');
        if (!countEl || !dotsEl)
            return;
        const workoutDates = new Set(__classPrivateFieldGet(this, _App_workouts, "f").map(w => new Date(w.date).toDateString()));
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            if (workoutDates.has(d.toDateString()))
                streak++;
            else
                break;
        }
        countEl.textContent = String(streak);
        dotsEl.innerHTML = '';
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dot = document.createElement('div');
            dot.className = 'streak-bar__dot' + (workoutDates.has(d.toDateString()) ? ' active' : '');
            dotsEl.appendChild(dot);
        }
    }
    // ── STATS ─────────────────────────────────────────────────────────────────
    _getWeekBounds(off = 0) {
        const now = new Date(), dow = now.getDay();
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
        return __classPrivateFieldGet(this, _App_workouts, "f").filter(w => { const d = new Date(w.date); return d >= mon && d <= sun; });
    }
    _initStats() {
        const panel = document.getElementById('statsPanel');
        if (!panel)
            return;
        const detail = document.getElementById('statsDetail');
        const editor = document.getElementById('statsGoalEditor');
        const inKm = document.getElementById('goalKmInput');
        const inTime = document.getElementById('goalTimeInput');
        const inCnt = document.getElementById('goalCountInput');
        const prevBtn = document.getElementById('statsWeekPrev');
        const nextBtn = document.getElementById('statsWeekNext');
        if (inKm)
            inKm.value = String(__classPrivateFieldGet(this, _App_goalKm, "f"));
        if (inTime)
            inTime.value = String(__classPrivateFieldGet(this, _App_goalTime, "f"));
        if (inCnt)
            inCnt.value = String(__classPrivateFieldGet(this, _App_goalCount, "f"));
        panel.addEventListener('click', () => {
            __classPrivateFieldSet(this, _App_statsExpanded, !__classPrivateFieldGet(this, _App_statsExpanded, "f"), "f");
            detail?.classList.toggle('hidden', !__classPrivateFieldGet(this, _App_statsExpanded, "f"));
            editor?.classList.toggle('hidden', !__classPrivateFieldGet(this, _App_statsExpanded, "f"));
            const scroll = document.querySelector('#tabStats .tab-scroll');
            if (scroll)
                scroll.style.overflowY = __classPrivateFieldGet(this, _App_statsExpanded, "f") ? 'auto' : '';
        });
        detail?.addEventListener('click', e => e.stopPropagation());
        editor?.addEventListener('click', e => e.stopPropagation());
        prevBtn?.addEventListener('click', e => {
            var _b;
            e.stopPropagation();
            __classPrivateFieldSet(this, _App_statsWeekOffset, (_b = __classPrivateFieldGet(this, _App_statsWeekOffset, "f"), _b--, _b), "f");
            __classPrivateFieldSet(this, _App_statsSelectedDay, null, "f");
            if (nextBtn)
                nextBtn.disabled = false;
            this._renderStats();
        });
        nextBtn?.addEventListener('click', e => {
            var _b;
            e.stopPropagation();
            if (__classPrivateFieldGet(this, _App_statsWeekOffset, "f") >= 0)
                return;
            __classPrivateFieldSet(this, _App_statsWeekOffset, (_b = __classPrivateFieldGet(this, _App_statsWeekOffset, "f"), _b++, _b), "f");
            __classPrivateFieldSet(this, _App_statsSelectedDay, null, "f");
            if (__classPrivateFieldGet(this, _App_statsWeekOffset, "f") === 0 && nextBtn)
                nextBtn.disabled = true;
            this._renderStats();
        });
        const goal = (field, key, el, fb) => el?.addEventListener('change', () => {
            this[field] = Math.max(1, +el.value || fb);
            el.value = String(this[field]);
            localStorage.setItem(key, String(this[field]));
            this._renderStats();
        });
        goal('#goalKm', 'goalKm', inKm, 35);
        goal('#goalTime', 'goalTime', inTime, 300);
        goal('#goalCount', 'goalCount', inCnt, 7);
    }
    _renderStats(animate = false) {
        const off = __classPrivateFieldGet(this, _App_statsWeekOffset, "f"), weekW = this._getWeekWorkouts(off), { mon } = this._getWeekBounds(off);
        const wKm = weekW.reduce((s, w) => s + (w.distance || 0), 0);
        const wMin = weekW.reduce((s, w) => s + (w.duration || 0), 0);
        const wCnt = weekW.length;
        let sub = weekW;
        if (__classPrivateFieldGet(this, _App_statsSelectedDay, "f") !== null)
            sub = weekW.filter(w => Math.floor((new Date(w.date).getTime() - mon.getTime()) / 86400000) === __classPrivateFieldGet(this, _App_statsSelectedDay, "f"));
        const sKm = sub.reduce((s, w) => s + (w.distance || 0), 0);
        const sMin = sub.reduce((s, w) => s + (w.duration || 0), 0);
        const sCnt = sub.length;
        const CIRC = 226.2;
        const ring = (id, pct) => {
            const el = document.getElementById(id);
            if (!el)
                return;
            const t = Math.max(0, CIRC - Math.min(pct, 1) * CIRC);
            if (animate) {
                el.style.transition = 'none';
                el.setAttribute('stroke-dashoffset', String(CIRC));
                void el.getBoundingClientRect();
                el.style.transition = 'stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)';
            }
            requestAnimationFrame(() => el.setAttribute('stroke-dashoffset', t.toFixed(1)));
        };
        ring('statsRingKm', wKm / __classPrivateFieldGet(this, _App_goalKm, "f"));
        ring('statsRingTime', wMin / __classPrivateFieldGet(this, _App_goalTime, "f"));
        ring('statsRingWorkouts', wCnt / __classPrivateFieldGet(this, _App_goalCount, "f"));
        const fmtT = (m) => m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`;
        const set = (id, v) => { const el = document.getElementById(id); if (el)
            el.textContent = String(v); };
        set('statsValKm', wKm.toFixed(1));
        set('statsValTime', fmtT(wMin));
        set('statsValWorkouts', wCnt);
        const pct = Math.min(Math.round((wKm / __classPrivateFieldGet(this, _App_goalKm, "f")) * 100), 100);
        set('statsGoalPct', pct + '%');
        const fill = document.getElementById('statsGoalFill');
        if (fill)
            fill.style.width = pct + '%';
        if (pct >= 100 && !__classPrivateFieldGet(this, _App_statsPrevGoalReached, "f") && animate) {
            __classPrivateFieldSet(this, _App_statsPrevGoalReached, true, "f");
            this._showGoalCelebration();
        }
        else if (pct < 100) {
            __classPrivateFieldSet(this, _App_statsPrevGoalReached, false, "f");
        }
        const nxt = document.getElementById('statsWeekNext');
        if (off === 0) {
            set('statsWeekLabel', 'This week');
            if (nxt)
                nxt.disabled = true;
        }
        else {
            const su = new Date(mon);
            su.setDate(mon.getDate() + 6);
            const fmt = (d) => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
            set('statsWeekLabel', `${fmt(mon)}–${fmt(su)}`);
            if (nxt)
                nxt.disabled = false;
        }
        set('statsDetailKm', sKm.toFixed(1));
        set('statsDetailTime', fmtT(sMin));
        set('statsDetailCount', sCnt);
        set('statsDetailDate', __classPrivateFieldGet(this, _App_statsSelectedDay, "f") !== null ? (() => { const d = new Date(mon); d.setDate(mon.getDate() + __classPrivateFieldGet(this, _App_statsSelectedDay, "f")); return d.getDate(); })() : '—');
        this._renderDayBars(weekW, mon);
        this._filterWorkoutsList(weekW);
    }
    _filterWorkoutsList(weekWorkouts) {
        const ids = new Set(weekWorkouts.map(w => w.id));
        document.querySelectorAll('.workout').forEach(el => { el.style.display = ids.has(el.dataset.id ?? '') ? '' : 'none'; });
    }
    _renderDayBars(ww, mon) {
        const el = document.getElementById('statsDetailBars');
        if (!el)
            return;
        const N = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const km = Array(7).fill(0), tp = Array(7).fill('none'), dt = Array(7);
        for (let i = 0; i < 7; i++) {
            const d = new Date(mon);
            d.setDate(mon.getDate() + i);
            dt[i] = d.getDate();
        }
        ww.forEach(w => { const i = Math.floor((new Date(w.date).getTime() - mon.getTime()) / 86400000); if (i >= 0 && i < 7) {
            km[i] += (w.distance || 0);
            tp[i] = w.type;
        } });
        const max = Math.max(...km, 0.1);
        el.innerHTML = N.map((name, i) => {
            const h = Math.round((km[i] / max) * 48), c = tp[i] === 'running' ? '#00c46a' : tp[i] === 'cycling' ? '#ffb545' : tp[i] === 'walking' ? '#5badea' : '#3a4147', a = __classPrivateFieldGet(this, _App_statsSelectedDay, "f") === i ? ' active' : '';
            return `<div class="stats-detail__day-col${a}" data-day="${i}"><div class="stats-detail__bar" style="height:${Math.max(h, km[i] > 0 ? 4 : 2)}px;background:${c}"></div><div class="stats-detail__day-name">${name}</div><div class="stats-detail__day-date">${dt[i]}</div></div>`;
        }).join('');
        el.querySelectorAll('.stats-detail__day-col').forEach(col => col.addEventListener('click', e => {
            e.stopPropagation();
            const day = +col.dataset.day;
            __classPrivateFieldSet(this, _App_statsSelectedDay, __classPrivateFieldGet(this, _App_statsSelectedDay, "f") === day ? null : day, "f");
            this._renderStats();
        }));
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
    // ── CUSTOM FILTERS ────────────────────────────────────────────────────────
    _initCustomFilters() {
        this._renderCustomFilterBtns();
    }
    _renderCustomFilterBtns() {
        const filters = document.getElementById('poiFilters');
        if (!filters)
            return;
        filters.querySelectorAll('.poi-filter-btn--custom').forEach(el => el.remove());
        let addBtn = filters.querySelector('.poi-filter-add');
        if (!addBtn) {
            addBtn = document.createElement('button');
            addBtn.className = 'poi-filter-btn poi-filter-add';
            addBtn.title = 'Add custom place';
            addBtn.innerHTML = '＋';
            addBtn.addEventListener('click', e => { e.stopPropagation(); this._openCustomFilterModal(); });
            filters.prepend(addBtn);
        }
        __classPrivateFieldGet(this, _App_customFilters, "f").forEach((cf, idx) => {
            const btn = document.createElement('button');
            btn.className = 'poi-filter-btn poi-filter-btn--custom';
            btn.innerHTML = `${cf.emoji} ${cf.name}`;
            btn.title = cf.name;
            let pressTimer;
            btn.addEventListener('touchstart', () => { pressTimer = setTimeout(() => this._deleteCustomFilter(idx), 600); }, { passive: true });
            btn.addEventListener('touchend', () => clearTimeout(pressTimer), { passive: true });
            btn.addEventListener('touchcancel', () => clearTimeout(pressTimer), { passive: true });
            btn.addEventListener('contextmenu', e => { e.preventDefault(); this._deleteCustomFilter(idx); });
            btn.addEventListener('click', () => {
                document.querySelectorAll('.poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
                btn.classList.add('poi-filter-btn--active');
                const input = document.getElementById('poiInput');
                if (input)
                    input.value = (cf.address?.trim()) ? cf.address : cf.name;
                void this._searchPOIAtCoords(cf.coords, cf.emoji, cf.name, cf.address ?? '');
            });
            addBtn.insertAdjacentElement('afterend', btn);
        });
    }
    _openCustomFilterModal() {
        document.getElementById('customFilterModal')?.remove();
        const pinnedCoord = __classPrivateFieldGet(this, _App_pinnedCoord, "f");
        const modal = document.createElement('div');
        modal.id = 'customFilterModal';
        modal.className = 'custom-filter-modal';
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
            ${['🏠', '🏢', '🏫', '🏋️', '🛒', '☕', '🍕', '🍺', '🌳', '⛪', '🏥', '💊', '🚉', '🅿️', '🐶', '🎯', '🎸', '📚', '🏊', '🚲'].map(em => `<button class="cf-emoji-btn" data-emoji="${em}">${em}</button>`).join('')}
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
        modal.querySelectorAll('.cf-emoji-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.cf-emoji-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedEmoji = btn.dataset.emoji ?? '';
                document.getElementById('cfEmojiInput').value = '';
            });
        });
        document.getElementById('cfEmojiInput').addEventListener('input', e => {
            selectedEmoji = e.target.value.trim();
            modal.querySelectorAll('.cf-emoji-btn').forEach(b => b.classList.remove('active'));
        });
        document.getElementById('cfCancel').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', e => { if (e.target === modal)
            modal.remove(); });
        document.getElementById('cfSave').addEventListener('click', async () => {
            const name = document.getElementById('cfName').value.trim();
            const emoji = selectedEmoji || document.getElementById('cfEmojiInput').value.trim();
            if (!pinnedCoord) {
                alert('Please tap a spot on the map first.');
                return;
            }
            if (!name) {
                alert('Please enter a name.');
                document.getElementById('cfName').focus();
                return;
            }
            if (!emoji) {
                alert('Please choose or type an emoji.');
                return;
            }
            let address = '';
            try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pinnedCoord[0]}&lon=${pinnedCoord[1]}&format=json`, { headers: { 'Accept-Language': 'en' } });
                const d = await r.json();
                const a = d.address ?? {};
                address = [a.road, a.house_number].filter(Boolean).join(' ') || d.display_name?.split(',')[0] || '';
            }
            catch { /* ignore */ }
            __classPrivateFieldGet(this, _App_customFilters, "f").unshift({ name, emoji, coords: pinnedCoord, address });
            localStorage.setItem('customFilters', JSON.stringify(__classPrivateFieldGet(this, _App_customFilters, "f")));
            this._renderCustomFilterBtns();
            modal.remove();
        });
    }
    _deleteCustomFilter(idx) {
        if (!confirm(`Remove "${__classPrivateFieldGet(this, _App_customFilters, "f")[idx].name}"?`))
            return;
        this._clearPOIMarkers();
        const rl = document.getElementById('poiResults');
        if (rl) {
            rl.classList.add('hidden');
            rl.innerHTML = '';
        }
        const input = document.getElementById('poiInput');
        if (input)
            input.value = '';
        __classPrivateFieldGet(this, _App_customFilters, "f").splice(idx, 1);
        localStorage.setItem('customFilters', JSON.stringify(__classPrivateFieldGet(this, _App_customFilters, "f")));
        this._renderCustomFilterBtns();
    }
    async _searchPOIAtCoords(coords, emoji, label, address) {
        const rl = document.getElementById('poiResults');
        if (!rl)
            return;
        rl.classList.remove('hidden');
        this._clearPOIMarkers();
        if (!__classPrivateFieldGet(this, _App_map, "f"))
            return;
        const distM = __classPrivateFieldGet(this, _App_userCoords, "f") ? this._haversine(__classPrivateFieldGet(this, _App_userCoords, "f"), coords) : null;
        const distTxt = distM != null ? (distM < 1000 ? `${Math.round(distM)} m away` : `${(distM / 1000).toFixed(1)} km away`) : '';
        // Register _poiSetA so the popup button works for custom filters too
        window._poiSetA = (lat, lon) => {
            if (__classPrivateFieldGet(this, _App_trackingActive, "f") && __classPrivateFieldGet(this, _App_trackingCoords, "f")) {
                this._autoRouteFromTracking([lat, lon]);
            }
            else {
                if (!__classPrivateFieldGet(this, _App_routeMode, "f"))
                    this._startRouteModeFromPOI();
                __classPrivateFieldSet(this, _App_routePointA, [lat, lon], "f");
                __classPrivateFieldSet(this, _App_routeStep, 2, "f");
                if (__classPrivateFieldGet(this, _App_routeMarkerA, "f"))
                    __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerA, "f"));
                __classPrivateFieldSet(this, _App_routeMarkerA, L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
                stepAText.textContent = 'Start point set ✓';
                stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
                stepBText.textContent = 'Click the end point on the map';
                document.getElementById('map').style.cursor = 'crosshair';
                __classPrivateFieldGet(this, _App_map, "f").closePopup();
                __classPrivateFieldGet(this, _App_map, "f").setView([lat, lon], 15);
            }
        };
        const marker = L.marker(coords, {
            icon: L.divIcon({
                className: '',
                html: `<div style="background:#2d3439;border:2px solid #00c46a;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`,
                iconSize: [36, 36], iconAnchor: [18, 18],
            }),
        }).addTo(__classPrivateFieldGet(this, _App_map, "f"))
            .bindPopup(`<b>${emoji} ${label}</b>${address ? `<br>${address}` : ''}${distTxt ? `<br><small>${distTxt}</small>` : ''}<br><button onclick="window._poiSetA(${coords[0]},${coords[1]})" style="margin-top:6px;padding:4px 10px;background:#00c46a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">Set as route A →</button>`)
            .openPopup();
        __classPrivateFieldGet(this, _App_poiMarkers, "f").push(marker);
        __classPrivateFieldGet(this, _App_map, "f").setView(coords, 16, { animate: true });
        const li = document.createElement('li');
        li.className = 'poi-result-item';
        li.innerHTML = `<span class="poi-result-item__name">${emoji} ${label}</span>${address ? `<span class="poi-result-item__addr">${address}</span>` : ''}${distTxt ? `<span class="poi-result-item__dist">📍 ${distTxt}</span>` : ''}`;
        li.addEventListener('click', () => { __classPrivateFieldGet(this, _App_map, "f").setView(coords, 16, { animate: true }); marker.openPopup(); });
        rl.innerHTML = '';
        rl.appendChild(li);
    }
    // ── POI SEARCH ────────────────────────────────────────────────────────────
    _initPOISearch() {
        const input = document.getElementById('poiInput');
        const btn = document.getElementById('poiSearchBtn');
        const filters = document.getElementById('poiFilters');
        const rl = document.getElementById('poiResults');
        if (!input || !btn || !filters || !rl)
            return;
        btn.addEventListener('click', () => void this._searchPOI(input.value.trim()));
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter')
            void this._searchPOI(input.value.trim()); });
        input.addEventListener('input', () => {
            const val = input.value.trim();
            if (val === '') {
                rl.classList.add('hidden');
                rl.innerHTML = '';
                this._clearPOIMarkers();
                const dl = document.getElementById('poiSuggestions');
                if (dl)
                    dl.innerHTML = '';
                return;
            }
            if (__classPrivateFieldGet(this, _App_autocompleteTimer, "f"))
                clearTimeout(__classPrivateFieldGet(this, _App_autocompleteTimer, "f"));
            if (val.length >= 2)
                __classPrivateFieldSet(this, _App_autocompleteTimer, setTimeout(() => void this._fetchAutocompleteSuggestions(val), 350), "f");
        });
        filters.addEventListener('click', (e) => {
            const filterBtn = e.target.closest('.poi-filter-btn');
            if (!filterBtn)
                return;
            document.querySelectorAll('.poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
            filterBtn.classList.add('poi-filter-btn--active');
            if (filterBtn.dataset.query) {
                if (input)
                    input.value = filterBtn.dataset.query;
                void this._searchPOI(filterBtn.dataset.query);
            }
        });
    }
    async _fetchAutocompleteSuggestions(query) {
        const dl = document.getElementById('poiSuggestions');
        if (!dl)
            return;
        let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=6&addressdetails=0`;
        if (__classPrivateFieldGet(this, _App_map, "f")) {
            const b = __classPrivateFieldGet(this, _App_map, "f").getBounds();
            url += `&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=1`;
        }
        try {
            const data = await fetch(url, { headers: { 'Accept-Language': 'en' } }).then(r => r.json());
            dl.innerHTML = '';
            const seen = new Set();
            data.forEach(p => { const n = p.name ?? p.display_name.split(',')[0]; if (n && !seen.has(n)) {
                seen.add(n);
                const o = document.createElement('option');
                o.value = n;
                dl.appendChild(o);
            } });
        }
        catch { /* ignore */ }
    }
    async _searchPOI(query) {
        if (!query)
            return;
        const rl = document.getElementById('poiResults');
        if (!rl)
            return;
        rl.classList.remove('hidden');
        rl.innerHTML = `<li class="poi-loading"><div class="route-loading__spinner"><div class="route-loading__dot"></div><div class="route-loading__dot"></div><div class="route-loading__dot"></div></div>Searching…</li>`;
        this._clearPOIMarkers();
        let url;
        if (__classPrivateFieldGet(this, _App_map, "f")) {
            const b = __classPrivateFieldGet(this, _App_map, "f").getBounds();
            url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1&viewbox=${b.getWest()},${b.getNorth()},${b.getEast()},${b.getSouth()}&bounded=1`;
        }
        else {
            url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=10&addressdetails=1`;
            if (__classPrivateFieldGet(this, _App_userCoords, "f"))
                url += `&lat=${__classPrivateFieldGet(this, _App_userCoords, "f")[0]}&lon=${__classPrivateFieldGet(this, _App_userCoords, "f")[1]}`;
        }
        try {
            const data = await fetch(url, { headers: { 'Accept-Language': 'en' } }).then(r => r.json());
            if (!data.length) {
                rl.innerHTML = `<li class="poi-empty">No results for "<b>${query}</b>" in this area.<br><small>Try zooming out or panning the map.</small></li>`;
                return;
            }
            const withDist = data.map(p => ({ ...p, distM: __classPrivateFieldGet(this, _App_userCoords, "f") ? this._haversine(__classPrivateFieldGet(this, _App_userCoords, "f"), [+p.lat, +p.lon]) : null }));
            withDist.sort((a, b) => (a.distM ?? Infinity) - (b.distM ?? Infinity));
            rl.innerHTML = '';
            withDist.forEach(place => {
                const name = place.name ?? place.display_name.split(',')[0];
                const addr = place.address ? [place.address.road, place.address.house_number].filter(Boolean).join(' ') : place.display_name.split(',').slice(1, 3).join(',').trim();
                const distTxt = place.distM != null ? (place.distM < 1000 ? `${Math.round(place.distM)} m away` : `${(place.distM / 1000).toFixed(1)} km away`) : '';
                const li = document.createElement('li');
                li.className = 'poi-result-item';
                li.innerHTML = `<span class="poi-result-item__name">${name}</span>${addr ? `<span class="poi-result-item__addr">${addr}</span>` : ''}${distTxt ? `<span class="poi-result-item__dist">📍 ${distTxt}</span>` : ''}`;
                li.addEventListener('click', () => this._selectPOI(place, name));
                rl.appendChild(li);
                const emoji = this._poiEmoji(query);
                const marker = L.marker([+place.lat, +place.lon], {
                    icon: L.divIcon({ className: '', html: `<div style="background:#2d3439;border:2px solid #00c46a;border-radius:50%;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">${emoji}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] }),
                }).addTo(__classPrivateFieldGet(this, _App_map, "f"))
                    .bindPopup(`<b>${name}</b>${addr ? `<br>${addr}` : ''}<br>${distTxt ? `<small>${distTxt}</small><br>` : ''}<button onclick="window._poiSetA(${place.lat},${place.lon})" style="margin-top:6px;padding:4px 10px;background:#00c46a;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px;font-weight:700">Set as point A →</button>`);
                __classPrivateFieldGet(this, _App_poiMarkers, "f").push(marker);
            });
            window._poiSetA = (lat, lon) => {
                if (__classPrivateFieldGet(this, _App_trackingActive, "f") && __classPrivateFieldGet(this, _App_trackingCoords, "f")) {
                    this._autoRouteFromTracking([lat, lon]);
                }
                else {
                    if (!__classPrivateFieldGet(this, _App_routeMode, "f"))
                        this._startRouteModeFromPOI();
                    __classPrivateFieldSet(this, _App_routePointA, [lat, lon], "f");
                    __classPrivateFieldSet(this, _App_routeStep, 2, "f");
                    if (__classPrivateFieldGet(this, _App_routeMarkerA, "f"))
                        __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerA, "f"));
                    __classPrivateFieldSet(this, _App_routeMarkerA, L.marker([lat, lon], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
                    stepAText.textContent = 'Start point set ✓';
                    stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
                    stepBText.textContent = 'Click the end point on the map';
                    document.getElementById('map').style.cursor = 'crosshair';
                    __classPrivateFieldGet(this, _App_map, "f").closePopup();
                    __classPrivateFieldGet(this, _App_map, "f").setView([lat, lon], 15);
                }
            };
        }
        catch {
            rl.innerHTML = `<li class="poi-empty">Connection error. Please try again.</li>`;
        }
    }
    _autoRouteFromTracking(destCoords) {
        if (!__classPrivateFieldGet(this, _App_trackingCoords, "f"))
            return;
        __classPrivateFieldGet(this, _App_map, "f").closePopup();
        __classPrivateFieldSet(this, _App_routeMode, true, "f");
        __classPrivateFieldSet(this, _App_routeStep, 3, "f");
        __classPrivateFieldSet(this, _App_routePointA, [...__classPrivateFieldGet(this, _App_trackingCoords, "f")], "f");
        __classPrivateFieldSet(this, _App_routePointB, destCoords, "f");
        btnRoute.classList.add('hidden');
        routeInfo.classList.remove('hidden');
        routeResult.classList.add('hidden');
        if (__classPrivateFieldGet(this, _App_routeMarkerA, "f"))
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerA, "f"));
        __classPrivateFieldSet(this, _App_routeMarkerA, L.marker(__classPrivateFieldGet(this, _App_routePointA, "f"), { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
        if (__classPrivateFieldGet(this, _App_routeMarkerB, "f"))
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerB, "f"));
        __classPrivateFieldSet(this, _App_routeMarkerB, L.marker(destCoords, { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--b">B</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
        stepAText.textContent = 'Your position ✓';
        stepBText.textContent = 'Destination set ✓';
        stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
        stepBText.closest('.route-info__step')?.classList.add('route-info__step--done');
        document.getElementById('map').style.cursor = '';
        this._drawRoute();
    }
    _selectPOI(place, _name) {
        __classPrivateFieldGet(this, _App_map, "f").setView([+place.lat, +place.lon], 16, { animate: true });
        __classPrivateFieldGet(this, _App_poiMarkers, "f").forEach(m => {
            const pos = m.getLatLng();
            if (Math.abs(pos.lat - +place.lat) < 0.0001 && Math.abs(pos.lng - +place.lon) < 0.0001)
                m.openPopup();
        });
    }
    _clearPOIMarkers() { __classPrivateFieldGet(this, _App_poiMarkers, "f").forEach(m => __classPrivateFieldGet(this, _App_map, "f")?.removeLayer(m)); __classPrivateFieldSet(this, _App_poiMarkers, [], "f"); }
    _poiEmoji(query) {
        if (/grocery|store|shop|market|sklep|żabka|biedronk|lidl/i.test(query))
            return '🛒';
        if (/water|fountain|woda|fontanna/i.test(query))
            return '💧';
        if (/toilet|wc|restroom|toaleta/i.test(query))
            return '🚻';
        if (/pharmacy|chemist|apteka/i.test(query))
            return '💊';
        if (/park|forest|las|garden/i.test(query))
            return '🌳';
        if (/cafe|coffee|kawiarnia/i.test(query))
            return '☕';
        if (/hospital|clinic|doctor|szpital/i.test(query))
            return '🏥';
        if (/restaurant|restauracja|bar|pub/i.test(query))
            return '🍴';
        if (/paczkomat|inpost|parcel/i.test(query))
            return '📦';
        if (/atm|bankomat/i.test(query))
            return '🏧';
        if (/hotel|hostel/i.test(query))
            return '🏨';
        if (/church|kościół|chapel/i.test(query))
            return '⛪';
        return '📍';
    }
    _haversine([lat1, lon1], [lat2, lon2]) {
        const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    // ── ROUTE PLANNER ─────────────────────────────────────────────────────────
    _setActivityMode(e) {
        const btn = e.currentTarget;
        const mode = btn.dataset.mode ?? 'running';
        __classPrivateFieldSet(this, _App_routeActivityMode, mode, "f");
        document.querySelectorAll('.route-mode-btn').forEach(b => b.classList.remove('route-mode-btn--active'));
        btn.classList.add('route-mode-btn--active');
        if (__classPrivateFieldGet(this, _App_routeStep, "f") === 3 && !routeResult.classList.contains('hidden')) {
            const distKm = parseFloat(routeDist.textContent ?? '');
            if (!isNaN(distKm))
                routeTime.textContent = String(Math.round((distKm / __classPrivateFieldGet(this, _App_activitySpeeds, "f")[mode]) * 60));
        }
    }
    /** Called only from POI "Set as route A" — starts route mode without triggering BottomNav hideSearch patch. */
    _startRouteModeFromPOI() {
        this._startRouteModeCore();
    }
    _startRouteMode() {
        this._startRouteModeCore();
    }
    _startRouteModeCore() {
        if (!form.classList.contains('hidden'))
            this._hideForm();
        __classPrivateFieldSet(this, _App_routeMode, true, "f");
        __classPrivateFieldSet(this, _App_routeStep, 1, "f");
        __classPrivateFieldSet(this, _App_routePointA, null, "f");
        __classPrivateFieldSet(this, _App_routePointB, null, "f");
        btnRoute.classList.add('hidden');
        routeInfo.classList.remove('hidden');
        routeResult.classList.add('hidden');
        stepAText.textContent = 'Click the start point on the map';
        stepBText.textContent = 'Click the end point on the map';
        stepAText.closest('.route-info__step')?.classList.remove('route-info__step--done');
        stepBText.closest('.route-info__step')?.classList.remove('route-info__step--done');
        document.getElementById('map').style.cursor = 'crosshair';
        if (__classPrivateFieldGet(this, _App_trackingActive, "f") && __classPrivateFieldGet(this, _App_trackingCoords, "f")) {
            const [lat, lng] = __classPrivateFieldGet(this, _App_trackingCoords, "f");
            __classPrivateFieldSet(this, _App_routePointA, [lat, lng], "f");
            __classPrivateFieldSet(this, _App_routeStep, 2, "f");
            if (__classPrivateFieldGet(this, _App_routeMarkerA, "f"))
                __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerA, "f"));
            __classPrivateFieldSet(this, _App_routeMarkerA, L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
            stepAText.textContent = 'Your position ✓';
            stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
            stepBText.textContent = 'Click the destination on the map';
        }
    }
    _handleRouteClick(mapE) {
        const { lat, lng } = mapE.latlng;
        if (__classPrivateFieldGet(this, _App_routeStep, "f") === 1) {
            __classPrivateFieldSet(this, _App_routePointA, [lat, lng], "f");
            __classPrivateFieldSet(this, _App_routeStep, 2, "f");
            if (__classPrivateFieldGet(this, _App_routeMarkerA, "f"))
                __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerA, "f"));
            __classPrivateFieldSet(this, _App_routeMarkerA, L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--a">A</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
            stepAText.textContent = 'Start point set ✓';
            stepAText.closest('.route-info__step')?.classList.add('route-info__step--done');
            stepBText.textContent = 'Click the end point on the map';
        }
        else if (__classPrivateFieldGet(this, _App_routeStep, "f") === 2) {
            __classPrivateFieldSet(this, _App_routePointB, [lat, lng], "f");
            __classPrivateFieldSet(this, _App_routeStep, 3, "f");
            if (__classPrivateFieldGet(this, _App_routeMarkerB, "f"))
                __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerB, "f"));
            __classPrivateFieldSet(this, _App_routeMarkerB, L.marker([lat, lng], { icon: L.divIcon({ className: '', html: '<div class="route-marker route-marker--b">B</div>', iconSize: [28, 28], iconAnchor: [14, 14] }) }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
            stepBText.textContent = 'End point set ✓';
            stepBText.closest('.route-info__step')?.classList.add('route-info__step--done');
            document.getElementById('map').style.cursor = '';
            this._drawRoute();
        }
    }
    _drawRoute() {
        routeLoading.classList.remove('hidden');
        routeResult.classList.add('hidden');
        if (__classPrivateFieldGet(this, _App_routeLine, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeLine, "f"));
            __classPrivateFieldSet(this, _App_routeLine, null, "f");
        }
        this._stopRouteProgress();
        const [aLat, aLng] = __classPrivateFieldGet(this, _App_routePointA, "f");
        const [bLat, bLng] = __classPrivateFieldGet(this, _App_routePointB, "f");
        const profile = __classPrivateFieldGet(this, _App_routeActivityMode, "f") === 'cycling' ? 'cycling' :
            __classPrivateFieldGet(this, _App_routeActivityMode, "f") === 'walking' ? 'walking' : 'walking';
        const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${aLng},${aLat};${bLng},${bLat}?geometries=geojson&overview=full&access_token=${MAPBOX_TOKEN}`;
        fetch(url)
            .then(r => r.json())
            .then((data) => {
            if (!data.routes?.length)
                throw new Error('No route found');
            const route = data.routes[0];
            const coords = route.geometry.coordinates.map(c => [c[1], c[0]]);
            const totalDistM = route.distance;
            const distKm = (totalDistM / 1000).toFixed(2);
            routeLoading.classList.add('hidden');
            routeDist.textContent = distKm;
            routeTime.textContent = String(Math.round(parseFloat(distKm) / __classPrivateFieldGet(this, _App_activitySpeeds, "f")[__classPrivateFieldGet(this, _App_routeActivityMode, "f")] * 60));
            routeResult.classList.remove('hidden');
            // Rysuj trasę
            const latLngs = coords.map(c => L.latLng(c[0], c[1]));
            __classPrivateFieldSet(this, _App_routeLine, L.polyline(latLngs, { color: '#00c46a', weight: 6, opacity: 0.85 }).addTo(__classPrivateFieldGet(this, _App_map, "f")), "f");
            __classPrivateFieldGet(this, _App_map, "f").fitBounds(__classPrivateFieldGet(this, _App_routeLine, "f").getBounds(), { padding: [40, 40] });
            this._setupRouteProgress(coords, totalDistM);
        })
            .catch(() => {
            routeLoading.classList.add('hidden');
            routeDist.textContent = 'Error';
            routeTime.textContent = '—';
            routeResult.classList.remove('hidden');
        });
    }
    _cancelRoute() {
        __classPrivateFieldSet(this, _App_routeMode, false, "f");
        __classPrivateFieldSet(this, _App_routeStep, 0, "f");
        __classPrivateFieldSet(this, _App_routePointA, null, "f");
        __classPrivateFieldSet(this, _App_routePointB, null, "f");
        if (__classPrivateFieldGet(this, _App_routeMarkerA, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerA, "f"));
            __classPrivateFieldSet(this, _App_routeMarkerA, null, "f");
        }
        if (__classPrivateFieldGet(this, _App_routeMarkerB, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeMarkerB, "f"));
            __classPrivateFieldSet(this, _App_routeMarkerB, null, "f");
        }
        if (__classPrivateFieldGet(this, _App_routeLine, "f")) {
            __classPrivateFieldGet(this, _App_map, "f").removeLayer(__classPrivateFieldGet(this, _App_routeLine, "f"));
            __classPrivateFieldSet(this, _App_routeLine, null, "f");
        }
        this._stopRouteProgress();
        routeLoading.classList.add('hidden');
        btnRoute.classList.remove('hidden');
        routeInfo.classList.add('hidden');
        routeResult.classList.add('hidden');
        document.getElementById('map').style.cursor = '';
    }
}
_a = App, _App_map = new WeakMap(), _App_tileLayer = new WeakMap(), _App_mapZoomLevel = new WeakMap(), _App_mapEvent = new WeakMap(), _App_workouts = new WeakMap(), _App_routeMode = new WeakMap(), _App_routeStep = new WeakMap(), _App_routePointA = new WeakMap(), _App_routePointB = new WeakMap(), _App_routeLine = new WeakMap(), _App_routeMarkerA = new WeakMap(), _App_routeMarkerB = new WeakMap(), _App_routeActivityMode = new WeakMap(), _App_routeCoords = new WeakMap(), _App_routeTotalDist = new WeakMap(), _App_progressLine = new WeakMap(), _App_progressWatchId = new WeakMap(), _App_coveredUpToIndex = new WeakMap(), _App_arrivedShown = new WeakMap(), _App_nearDestCount = new WeakMap(), _App_voiceEnabled = new WeakMap(), _App_voiceKmAnnounced = new WeakMap(), _App_voiceStartTime = new WeakMap(), _App_voiceDistCovered = new WeakMap(), _App_trackingActive = new WeakMap(), _App_watchId = new WeakMap(), _App_trackingMarker = new WeakMap(), _App_trackingCoords = new WeakMap(), _App_prevTrackingCoords = new WeakMap(), _App_userTouchingMap = new WeakMap(), _App_recenterTimer = new WeakMap(), _App_tracker = new WeakMap(), _App_historyPanel = new WeakMap(), _App_nightMode = new WeakMap(), _App_wakeLock = new WeakMap(), _App_deferredInstallPrompt = new WeakMap(), _App_markers = new WeakMap(), _App_clusterGroup = new WeakMap(), _App_clusterEnabled = new WeakMap(), _App_poiMarkers = new WeakMap(), _App_userCoords = new WeakMap(), _App_autocompleteTimer = new WeakMap(), _App_filterDrag = new WeakMap(), _App_activitySpeeds = new WeakMap(), _App_activeWorkoutId = new WeakMap(), _App_workoutRouteLayer = new WeakMap(), _App_customFilters = new WeakMap(), _App_pinnedCoord = new WeakMap(), _App_goalKm = new WeakMap(), _App_goalTime = new WeakMap(), _App_goalCount = new WeakMap(), _App_statsExpanded = new WeakMap(), _App_statsWeekOffset = new WeakMap(), _App_statsSelectedDay = new WeakMap(), _App_statsPrevGoalReached = new WeakMap();
_App_ARRIVAL_CONSEC = { value: 3 };
_App_ARRIVAL_DIST = { value: 20 };
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
        if (!SEARCH_BAR)
            return;
        SEARCH_BAR.classList.remove('msb--hidden-tab', 'msb--hidden-route');
        SEARCH_BAR.classList.add('msb--visible');
    }
    function showMobileSearch() {
        const bar = MOBILE_SEARCH_BAR ?? SEARCH_BAR;
        if (!bar)
            return;
        bar.classList.remove('msb--hidden-tab', 'msb--hidden-route');
        bar.classList.add('msb--visible');
    }
    function hideSearchRoute() {
        if (!SEARCH_BAR)
            return;
        SEARCH_BAR.classList.add('msb--hidden-route');
        SEARCH_BAR.classList.remove('msb--visible');
        MOBILE_SEARCH_BAR?.classList.add('msb--hidden-route');
        MOBILE_SEARCH_BAR?.classList.remove('msb--visible');
    }
    function hideSearchTab() {
        if (!SEARCH_BAR)
            return;
        SEARCH_BAR.classList.add('msb--hidden-tab');
        SEARCH_BAR.classList.remove('msb--visible', 'msb--hidden-route');
    }
    function hideMobileSearchTab() {
        const bar = MOBILE_SEARCH_BAR ?? SEARCH_BAR;
        if (!bar)
            return;
        bar.classList.add('msb--hidden-tab');
        bar.classList.remove('msb--visible', 'msb--hidden-route');
    }
    const isDesktop = () => window.innerWidth >= 900;
    function switchTab(tabId) {
        // ── Desktop ──────────────────────────────────────────────────
        if (isDesktop()) {
            document.querySelectorAll('.bottom-nav__item')
                .forEach(b => b.classList.remove('bottom-nav__item--active'));
            document.querySelector(`.bottom-nav__item[data-tab="${tabId}"]`)
                ?.classList.add('bottom-nav__item--active');
            activeTab = tabId;
            if (tabId === 'tabStats') {
                document.getElementById('tabStats')?.classList.add('tab-panel--active');
                void _migrationReady.then(() => statsView.init());
            }
            else {
                document.getElementById('tabStats')?.classList.remove('tab-panel--active');
            }
            if (tabId === 'tabMap')
                setTimeout(() => window.app.invalidateMapSize(), 80);
            return;
        }
        // ── Mobile ───────────────────────────────────────────────────
        if (tabId === activeTab) {
            const scroll = document.querySelector(`#${tabId} .tab-scroll`);
            if (scroll)
                scroll.classList.toggle('tab-scroll--collapsed', !scroll.classList.contains('tab-scroll--collapsed'));
            return;
        }
        document.querySelector(`#${activeTab} .tab-scroll`)?.classList.add('tab-scroll--collapsed'); // collapse leaving tab before hiding
        document.getElementById(activeTab)?.classList.remove('tab-panel--active');
        document.querySelector(`.bottom-nav__item[data-tab="${activeTab}"]`)?.classList.remove('bottom-nav__item--active');
        activeTab = tabId;
        document.getElementById(activeTab)?.classList.add('tab-panel--active');
        document.querySelector(`.bottom-nav__item[data-tab="${activeTab}"]`)?.classList.add('bottom-nav__item--active');
        document.querySelector(`#${activeTab} .tab-scroll`)?.classList.remove('tab-scroll--collapsed');
        if (activeTab === 'tabMap') {
            if (!routeActive)
                showMobileSearch();
            setTimeout(() => window.app.invalidateMapSize(), 80);
        }
        else if (activeTab === 'tabTracker') {
            hideMobileSearchTab();
            // Show permission panel if GPS not yet granted
            void hasGPSPermission().then(granted => {
                const perm = document.getElementById('trkPermission');
                if (!perm)
                    return;
                if (granted)
                    perm.classList.add('hidden');
                else
                    perm.classList.remove('hidden');
            });
        }
        else if (activeTab === 'tabHome') {
            hideMobileSearchTab();
            if (!homeViewInited) {
                homeViewInited = true;
                homeView.init();
            }
            else {
                // Always re-render when switching to Home so new workouts appear immediately
                void homeView.render();
            }
        }
        else if (activeTab === 'tabFriends') {
            hideMobileSearchTab();
            // Inicjalizuj FriendsView przy pierwszym wejściu
            if (!friendsViewInited) {
                friendsViewInited = true;
                friendsView.init();
            }
            // Pre-generuj link zaproszenia w tle żeby share był synchroniczny
            void friendsView._precacheInviteLink();
        }
        else {
            hideMobileSearchTab();
        }
        if (activeTab === 'tabStats')
            void _migrationReady.then(() => statsView.init());
    }
    // mirrorWorkoutList replaced by StatsView
    document.querySelectorAll('.bottom-nav__item').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));
    function patchApp() {
        if (!window.app?._startRouteMode) {
            setTimeout(patchApp, 150);
            return;
        }
        const origStart = window.app._startRouteMode.bind(window.app);
        const origCancel = window.app._cancelRoute.bind(window.app);
        window.app._startRouteMode = function (...a) {
            origStart(...a);
            routeActive = true;
            hideSearchRoute();
            if (activeTab !== 'tabMap')
                switchTab('tabMap');
        };
        window.app._cancelRoute = function (...a) {
            origCancel(...a);
            routeActive = false;
            if (activeTab === 'tabMap')
                showSearch();
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
        const coords = [pos.coords.latitude, pos.coords.longitude];
        window.app._loadMap(coords);
    });
    // ── Wire desktop sidebar search ──────────────────────────────
    function initSidebarSearch() {
        if (!window.app?._searchPOI) {
            setTimeout(initSidebarSearch, 200);
            return;
        }
        const app = window.app;
        const inp = document.getElementById('poiInputDesktop');
        const resultsEl = document.getElementById('poiResultsDesktop');
        document.getElementById('poiSearchBtnDesktop')?.addEventListener('click', () => {
            if (inp?.value.trim())
                app._searchPOI(inp.value.trim());
        });
        inp?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && inp.value.trim())
                app._searchPOI(inp.value.trim());
        });
        document.getElementById('btnSettingsDesktop')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('settingsPanel')?.classList.toggle('hidden');
        });
        document.getElementById('poiFiltersDesktop')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.poi-filter-btn');
            if (!btn?.dataset.query)
                return;
            document.querySelectorAll('#poiFiltersDesktop .poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
            btn.classList.add('poi-filter-btn--active');
            if (inp)
                inp.value = btn.dataset.query;
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
        if (!window.app?._searchPOI) {
            setTimeout(initMobileSearch, 200);
            return;
        }
        const app = window.app;
        const inp = document.getElementById('poiInputMobile');
        const mobileResults = document.getElementById('poiResultsMobile');
        document.getElementById('poiSearchBtnMobile')?.addEventListener('click', () => {
            if (inp?.value.trim())
                app._searchPOI(inp.value.trim());
        });
        inp?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && inp.value.trim())
                app._searchPOI(inp.value.trim());
        });
        document.getElementById('btnSettingsMobile')?.addEventListener('click', (e) => {
            e.stopPropagation();
            document.getElementById('settingsPanel')?.classList.toggle('hidden');
        });
        document.getElementById('poiFiltersMobile')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.poi-filter-btn');
            if (!btn?.dataset.query)
                return;
            document.querySelectorAll('#poiFiltersMobile .poi-filter-btn').forEach(b => b.classList.remove('poi-filter-btn--active'));
            btn.classList.add('poi-filter-btn--active');
            if (inp)
                inp.value = btn.dataset.query;
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
    const pill = document.getElementById('routeMiniPill');
    const distEl = document.getElementById('routeMiniDist');
    const timeEl = document.getElementById('routeMiniTime');
    if (!pill)
        return;
    function sync() {
        const d = document.getElementById('routeDist')?.textContent;
        const t = document.getElementById('routeTime')?.textContent;
        if (distEl)
            distEl.textContent = d ?? '—';
        if (timeEl)
            timeEl.textContent = t ?? '—';
        const hasRoute = !document.getElementById('routeResult')?.classList.contains('hidden');
        // Widoczny gdy: aktywna zakładka ma zwinięty pasek LUB tracker jest aktywny
        const activePanel = document.querySelector('.tab-panel--active');
        const collapsed = !!activePanel?.querySelector('.tab-scroll.tab-scroll--collapsed');
        const trackerActive = !document.getElementById('trackerOverlay')?.classList.contains('hidden');
        pill?.classList.toggle('hidden', !(hasRoute && (collapsed || trackerActive)));
    }
    const obs = new MutationObserver(sync);
    const rr = document.getElementById('routeResult');
    if (rr)
        obs.observe(rr, { attributes: true });
    document.querySelectorAll('.tab-scroll').forEach(sc => obs.observe(sc, { attributes: true }));
    document.querySelectorAll('.tab-panel').forEach(p => obs.observe(p, { attributes: true }));
    const trackerOv = document.getElementById('trackerOverlay');
    if (trackerOv)
        obs.observe(trackerOv, { attributes: true });
})();
// ─── WEATHER COMPONENTS (top bar + modal) ────────────────────────────────────
void initWeatherComponents();
// ─── FRIENDS & LIVE TRACKING ─────────────────────────────────────────────────
const friendsView = new FriendsView();
let friendsViewInited = false;
let homeViewInited = false;
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
// ─── Sync do MongoDB Atlas (jednorazowa migracja z IndexedDB) ───────────────
void syncToMongoIfNeeded();
//# sourceMappingURL=main.js.map