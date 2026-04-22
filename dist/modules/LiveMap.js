// ─── LIVE MAP ─────────────────────────────────────────────────────────────────
// src/modules/LiveMap.ts
//
// Renderuje trasę znajomego w czasie rzeczywistym na mapie Leaflet.
// Polluje backend co POLL_INTERVAL_MS i aktualizuje mapę.
import { BACKEND_URL } from '../config.js';
// ── Stałe ─────────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS = 5000; // odświeżaj co 5 sekund
const ROUTE_COLOR = '#00c46a';
// ── LiveMap class ─────────────────────────────────────────────────────────────
export class LiveMap {
    constructor() {
        Object.defineProperty(this, "_map", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_polyline", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_marker", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_token", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_pollTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_onStatus", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_container", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    /** Zachowaj kontener i callback — mapę inicjujemy dopiero gdy kontener jest widoczny */
    init(container, onStatus) {
        this._container = container;
        this._onStatus = onStatus;
        // NIE inicjujemy Leaflet tutaj — kontener ma display:none i mapa miałaby rozmiar 0x0
    }
    /** Inicjalizuj mapę Leaflet (lazy — wywołaj dopiero gdy kontener jest widoczny) */
    _initMap() {
        if (this._map || !this._container)
            return;
        this._map = L.map(this._container, {
            zoomControl: true,
            attributionControl: false,
        }).setView([52, 19], 13);
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap',
        }).addTo(this._map);
        this._polyline = L.polyline([], {
            color: ROUTE_COLOR,
            weight: 5,
            opacity: 0.9,
        }).addTo(this._map);
    }
    /** Zacznij oglądać trasę danego tokenu */
    watch(token) {
        this._token = token;
        this._stopPolling();
        this._initMap(); // lazy init — mapa jest teraz widoczna
        void this._poll(); // natychmiastowe pobranie
        this._pollTimer = setInterval(() => void this._poll(), POLL_INTERVAL_MS);
    }
    /** Zatrzymaj polling */
    stop() {
        this._stopPolling();
        this._token = null;
    }
    /** Zniszcz mapę */
    destroy() {
        this._stopPolling();
        if (this._map) {
            this._map.remove();
            this._map = null;
        }
    }
    // ── Private ────────────────────────────────────────────────────────────────
    _stopPolling() {
        if (this._pollTimer) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
        }
    }
    async _poll() {
        if (!this._token || !this._map)
            return;
        try {
            const res = await fetch(`${BACKEND_URL}/live/${this._token}`);
            if (!res.ok) {
                this._onStatus?.({ token: this._token, userName: '?', session: 'not_found', startedAt: 0, updatedAt: 0, current: null, history: [] });
                return;
            }
            const data = await res.json();
            this._onStatus?.(data);
            this._updateMap(data);
            // Zatrzymaj polling jeśli sesja zakończona
            if (data.session === 'finished')
                this._stopPolling();
        }
        catch (err) {
            console.warn('[LiveMap] poll error:', err);
        }
    }
    _updateMap(data) {
        if (!this._map || !this._polyline)
            return;
        // Aktualizuj trasę
        const latLngs = data.history.map(p => L.latLng(p.lat, p.lng));
        this._polyline.setLatLngs(latLngs);
        // Aktualizuj marker aktualnej pozycji
        if (data.current) {
            const pos = L.latLng(data.current.lat, data.current.lng);
            if (!this._marker) {
                // Utwórz marker przy pierwszej pozycji i od razu centruj mapę
                this._marker = L.circleMarker(pos, {
                    radius: 10,
                    color: '#fff',
                    fillColor: ROUTE_COLOR,
                    fillOpacity: 1,
                    weight: 3,
                }).addTo(this._map);
                // Zawsze centruj na pierwszej pozycji znajomego
                this._map.setView(pos, 16, { animate: true });
            }
            else {
                this._marker.setLatLng(pos);
            }
            // Centruj mapę na aktualnej pozycji (tylko jeśli sesja aktywna)
            if (data.session === 'running') {
                this._map.panTo(pos, { animate: true, duration: 0.8 });
            }
        }
        // Dopasuj widok do trasy jeśli jest historia i brak aktualnej pozycji
        if (latLngs.length > 1 && !data.current) {
            this._map.fitBounds(this._polyline.getBounds(), { padding: [40, 40] });
        }
    }
    /** Odśwież rozmiar mapy (po pokazaniu kontenera) */
    invalidateSize() {
        this._map?.invalidateSize();
    }
}
//# sourceMappingURL=LiveMap.js.map