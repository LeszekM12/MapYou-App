// ─── TRACKER MODULE ──────────────────────────────────────────────────────────
// src/modules/Tracker.ts
export const BUILTIN_SPORTS = ['running', 'walking', 'cycling'];
export const ALL_SPORTS = [
    { key: 'running', icon: '🏃', label: 'Running' },
    { key: 'walking', icon: '🚶', label: 'Walking' },
    { key: 'cycling', icon: '🚴', label: 'Cycling' },
    { key: 'swimming', icon: '🏊', label: 'Swimming' },
    { key: 'hiking', icon: '🥾', label: 'Hiking' },
    { key: 'skiing', icon: '⛷️', label: 'Skiing' },
    { key: 'tennis', icon: '🎾', label: 'Tennis' },
    { key: 'football', icon: '⚽', label: 'Football' },
    { key: 'basketball', icon: '🏀', label: 'Basketball' },
    { key: 'volleyball', icon: '🏐', label: 'Volleyball' },
    { key: 'yoga', icon: '🧘', label: 'Yoga' },
    { key: 'gym', icon: '🏋️', label: 'Gym' },
    { key: 'boxing', icon: '🥊', label: 'Boxing' },
    { key: 'rowing', icon: '🚣', label: 'Rowing' },
    { key: 'climbing', icon: '🧗', label: 'Climbing' },
    { key: 'skateboard', icon: '🛹', label: 'Skateboard' },
    { key: 'martial_arts', icon: '🥋', label: 'Martial Arts' },
    { key: 'dance', icon: '💃', label: 'Dance' },
    { key: 'crossfit', icon: '💪', label: 'CrossFit' },
    { key: 'pilates', icon: '🤸', label: 'Pilates' },
];
export function getSportIcon(sport) {
    const found = ALL_SPORTS.find(s => s.key === sport);
    if (found)
        return found.icon;
    const l = sport.toLowerCase();
    if (l.includes('run'))
        return '🏃';
    if (l.includes('walk'))
        return '🚶';
    if (l.includes('cycl') || l.includes('bike'))
        return '🚴';
    if (l.includes('swim'))
        return '🏊';
    if (l.includes('hik'))
        return '🥾';
    if (l.includes('ski'))
        return '⛷️';
    if (l.includes('tenn') || l.includes('teni'))
        return '🎾';
    if (l.includes('foot') || l.includes('soccer'))
        return '⚽';
    if (l.includes('basket'))
        return '🏀';
    if (l.includes('yoga'))
        return '🧘';
    if (l.includes('gym') || l.includes('weight'))
        return '🏋️';
    if (l.includes('box'))
        return '🥊';
    if (l.includes('row'))
        return '🚣';
    if (l.includes('climb'))
        return '🧗';
    if (l.includes('dance'))
        return '💃';
    if (l.includes('cross'))
        return '💪';
    if (l.includes('pilat'))
        return '🤸';
    return '🏅';
}
export function getCustomSports() {
    try {
        return JSON.parse(localStorage.getItem('mapyou_custom_sports') ?? '[]');
    }
    catch {
        return [];
    }
}
export function saveCustomSport(label) {
    // Key uses index-based ID to avoid encoding issues with non-ASCII chars
    const existing = getCustomSports();
    const key = 'custom_' + (existing.length + 1);
    const icon = getSportIcon(label);
    const sport = { key, icon, label };
    if (!existing.find(s => s.label.toLowerCase() === label.toLowerCase())) {
        existing.push(sport);
        localStorage.setItem('mapyou_custom_sports', JSON.stringify(existing));
    }
    return sport;
}
export function deleteCustomSport(key) {
    const updated = getCustomSports().filter(s => s.key !== key);
    localStorage.setItem('mapyou_custom_sports', JSON.stringify(updated));
}
export function getSportLabel(key) {
    const found = getAllSports().find(s => s.key === key);
    if (found)
        return found.label;
    // Check custom sports by label match (handles old keys like 'si_ownia')
    const customs = getCustomSports();
    const byLabel = customs.find(s => s.label.toLowerCase().replace(/[^a-z0-9]/g, '_') === key);
    if (byLabel)
        return byLabel.label;
    // Fallback — capitalize and replace underscores
    const polishNames = {
        'silownia': 'Siłownia', 'si_ownia': 'Siłownia',
        'bieganie': 'Bieganie', 'spacer': 'Spacer',
        'rower': 'Rower', 'plywanie': 'Pływanie',
        'pilka_nozna': 'Piłka nożna', 'koszykowka': 'Koszykówka',
        'siatkowka': 'Siatkówka', 'boks': 'Boks',
        'taniec': 'Taniec', 'joga': 'Joga',
    };
    if (polishNames[key.toLowerCase()])
        return polishNames[key.toLowerCase()];
    return key.replace(/_/g, ' ').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
export function getAllSports() {
    return [...ALL_SPORTS, ...getCustomSports()];
}
export const SPORT_ICONS = {
    running: '🏃',
    walking: '🚶',
    cycling: '🚴',
};
export function getIcon(sport) {
    return SPORT_ICONS[sport] ?? getSportIcon(sport);
}
export const SPORT_COLORS = {
    running: '#00c46a',
    walking: '#5badea',
    cycling: '#ffb545',
};
// 3 base sports keep their brand colors. Everything else uses one neutral
// color that flips with the theme: black on light bg, white on dark bg.
// Returns a concrete color (not a CSS var) so it also works inside <canvas>.
export function getColor(sport) {
    if (SPORT_COLORS[sport])
        return SPORT_COLORS[sport];
    const isDark = typeof document !== 'undefined'
        && document.body.classList.contains('night-mode');
    return isDark ? '#ffffff' : '#1a1a1a';
}
export class Tracker {
    constructor(map, onUpdate) {
        Object.defineProperty(this, "map", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "sport", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'running'
        });
        Object.defineProperty(this, "coords", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "polyline", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "dotMarker", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "watchId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "startTime", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "pausedTime", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        }); // ms spędzone na pauzie
        Object.defineProperty(this, "pauseStart", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "timerInterval", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "distanceM", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "onUpdate", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_active", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_paused", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        this.map = map;
        this.onUpdate = onUpdate;
    }
    get isActive() { return this._active; }
    get isPaused() { return this._paused; }
    get currentSport() { return this.sport; }
    setSport(sport) { this.sport = sport; }
    // ── Start ───────────────────────────────────────────────────────────────────
    start() {
        if (this._active)
            return;
        this._active = true;
        this._paused = false;
        this.coords = [];
        this.distanceM = 0;
        this.pausedTime = 0;
        this.startTime = Date.now();
        const color = SPORT_COLORS[this.sport];
        this.polyline = L.polyline([], {
            color, weight: 5, opacity: 0.95,
        }).addTo(this.map);
        this._startGPS();
        this.timerInterval = setInterval(() => {
            if (!this._paused)
                this.onUpdate(this._buildStats());
        }, 1000);
    }
    // ── Pause ───────────────────────────────────────────────────────────────────
    pause() {
        if (!this._active || this._paused)
            return;
        this._paused = true;
        this.pauseStart = Date.now();
        this._stopGPS();
    }
    // ── Resume ──────────────────────────────────────────────────────────────────
    resume() {
        if (!this._active || !this._paused)
            return;
        this._paused = false;
        this.pausedTime += Date.now() - this.pauseStart;
        this._startGPS();
        this.onUpdate(this._buildStats());
    }
    // ── Stop ────────────────────────────────────────────────────────────────────
    stop() {
        if (!this._active)
            return null;
        this._active = false;
        this._paused = false;
        this._stopGPS();
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        if (this.dotMarker) {
            this.map.removeLayer(this.dotMarker);
            this.dotMarker = null;
        }
        const stats = this._buildStats();
        const now = new Date().toISOString();
        const months = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const d = new Date(now);
        return {
            id: String(Date.now()),
            sport: this.sport,
            date: now,
            distanceKm: stats.distanceKm,
            durationSec: stats.durationSec,
            paceMinKm: stats.paceMinKm,
            speedKmH: stats.speedKmH,
            coords: [...this.coords],
            description: `${SPORT_ICONS[this.sport]} ${this.sport.charAt(0).toUpperCase() + this.sport.slice(1)} on ${months[d.getMonth()]} ${d.getDate()}`,
        };
    }
    // ── Reset ───────────────────────────────────────────────────────────────────
    reset() {
        this._stopGPS();
        if (this.timerInterval) {
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
        this.coords = [];
        this.distanceM = 0;
        this._active = false;
        this._paused = false;
    }
    // ── Draw saved activity ─────────────────────────────────────────────────────
    drawActivity(activity) {
        if (!activity.coords.length)
            return null;
        const color = SPORT_COLORS[activity.sport];
        const line = L.polyline(activity.coords.map(c => L.latLng(c[0], c[1])), { color, weight: 5, opacity: 0.95 }).addTo(this.map);
        this.map.fitBounds(line.getBounds(), { padding: [60, 60] });
        return line;
    }
    // ── Private ─────────────────────────────────────────────────────────────────
    _startGPS() {
        this.watchId = navigator.geolocation.watchPosition(pos => this._onPosition(pos), err => console.warn('[Tracker] GPS:', err), { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 });
    }
    _stopGPS() {
        if (this.watchId !== null) {
            navigator.geolocation.clearWatch(this.watchId);
            this.watchId = null;
        }
    }
    _onPosition(pos) {
        if (this._paused)
            return;
        const { latitude: lat, longitude: lng } = pos.coords;
        const newCoord = [lat, lng];
        if (this.coords.length > 0) {
            const prev = this.coords[this.coords.length - 1];
            const dist = L.latLng(prev[0], prev[1]).distanceTo(L.latLng(lat, lng));
            // Filtruj skoki GPS > 50m/s (błędy GPS)
            if (dist < 50)
                this.distanceM += dist;
        }
        this.coords.push(newCoord);
        this.polyline?.addLatLng(L.latLng(lat, lng));
        if (this.dotMarker) {
            this.dotMarker.setLatLng([lat, lng]);
        }
        else {
            this.dotMarker = L.circleMarker([lat, lng], {
                radius: 9, color: '#fff', fillColor: SPORT_COLORS[this.sport],
                fillOpacity: 1, weight: 2.5,
            }).addTo(this.map);
        }
        this.map.panTo([lat, lng], { animate: true, duration: 0.8 });
        this.onUpdate(this._buildStats());
    }
    _buildStats() {
        const elapsed = (Date.now() - this.startTime - this.pausedTime);
        const durationSec = Math.floor(elapsed / 1000);
        const distanceKm = this.distanceM / 1000;
        const durationMin = durationSec / 60;
        const paceMinKm = distanceKm > 0.01 ? durationMin / distanceKm : 0;
        const speedKmH = durationMin > 0 ? distanceKm / (durationMin / 60) : 0;
        return { distanceKm, durationSec, paceMinKm, speedKmH, coords: this.coords };
    }
}
// ── Formattery ────────────────────────────────────────────────────────────────
export function formatDuration(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function formatPace(paceMinKm) {
    if (!paceMinKm || paceMinKm > 99)
        return '--:--';
    const m = Math.floor(paceMinKm);
    const s = Math.round((paceMinKm - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}`;
}
export function formatDistance(km) { return km.toFixed(2); }
//# sourceMappingURL=Tracker.js.map