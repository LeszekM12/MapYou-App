// ─── LIVE TRACKER ────────────────────────────────────────────────────────────
// src/modules/LiveTracker.ts
//
// Zarządza sesją live-trackingu podczas treningu:
//   - generuje token
//   - wysyła pozycję co INTERVAL_MS sekund
//   - obsługuje pause/resume/finish
//   - integruje z push notifications do znajomych

import { BACKEND_URL } from '../config.js';
import { getAllFriends } from './FriendsDB.js';
import { getUserId } from './PushNotifications.js';

// ── Stałe ─────────────────────────────────────────────────────────────────────

const INTERVAL_MS    = 5_000;   // wysyłaj pozycję co 5 sekund
const LS_TOKEN_KEY   = 'mapyou_live_token';
const LS_USERNAME    = 'mapyou_userName';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function getUserName(): string {
  return localStorage.getItem(LS_USERNAME) ?? 'Someone';
}

export function setUserName(name: string): void {
  localStorage.setItem(LS_USERNAME, name.trim());
}

export function getLiveUrl(token: string): string {
  const base = window.location.href.split('#')[0].split('?')[0];
  return `${base}#live=${token}`;
}

// ── LiveTracker class ─────────────────────────────────────────────────────────

export class LiveTracker {
  private _token:    string | null = null;
  private _active:   boolean       = false;
  private _paused:   boolean       = false;
  private _watchId:  number | null = null;
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _lastPos:  GeolocationPosition | null = null;

  get token():   string | null { return this._token; }
  get isActive(): boolean       { return this._active; }
  get liveUrl():  string | null { return this._token ? getLiveUrl(this._token) : null; }

  // ── Start ──────────────────────────────────────────────────────────────────

  async start(): Promise<string> {
    if (this._active) return this._token!;

    // Generuj token i zapisz w localStorage (odtworzenie po reload)
    this._token  = generateToken();
    this._active = true;
    this._paused = false;
    localStorage.setItem(LS_TOKEN_KEY, this._token);

    const userName  = getUserName();
    const liveUrl   = getLiveUrl(this._token);

    // Zbierz push subskrypcje znajomych
    const friends   = await getAllFriends();
    const friendSubs = friends
      .filter(f => f.pushSub?.endpoint)
      .map(f => f.pushSub);

    // Zarejestruj sesję na backendzie + wyślij push do znajomych
    try {
      await fetch(`${BACKEND_URL}/live/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token: this._token, userName, liveUrl, friendSubs }),
      });
    } catch (err) {
      console.warn('[LiveTracker] start failed:', err);
    }

    // Zacznij śledzenie GPS
    this._startGPS();

    // Wysyłaj pozycję co INTERVAL_MS
    this._interval = setInterval(() => {
      if (!this._paused && this._lastPos) void this._sendPosition();
    }, INTERVAL_MS);

    console.log(`[LiveTracker] Started: ${this._token}`);
    return this._token;
  }

  // ── Pause ──────────────────────────────────────────────────────────────────

  async pause(): Promise<void> {
    if (!this._active || this._paused) return;
    this._paused = true;
    this._stopGPS();
    try {
      await fetch(`${BACKEND_URL}/live/pause`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this._token }),
      });
    } catch { /* ignoruj */ }
  }

  // ── Resume ─────────────────────────────────────────────────────────────────

  async resume(): Promise<void> {
    if (!this._active || !this._paused) return;
    this._paused = false;
    this._startGPS();
    try {
      await fetch(`${BACKEND_URL}/live/resume`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this._token }),
      });
    } catch { /* ignoruj */ }
  }

  // ── Finish ─────────────────────────────────────────────────────────────────

  async finish(): Promise<void> {
    if (!this._active) return;
    this._active = false;
    this._paused = false;

    this._stopGPS();
    if (this._interval) { clearInterval(this._interval); this._interval = null; }

    try {
      await fetch(`${BACKEND_URL}/live/finish`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: this._token }),
      });
    } catch { /* ignoruj */ }

    localStorage.removeItem(LS_TOKEN_KEY);
    console.log(`[LiveTracker] Finished: ${this._token}`);
    this._token = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _startGPS(): void {
    this._watchId = navigator.geolocation.watchPosition(
      pos => { this._lastPos = pos; },
      err => console.warn('[LiveTracker] GPS:', err),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 },
    );
  }

  private _stopGPS(): void {
    if (this._watchId !== null) {
      navigator.geolocation.clearWatch(this._watchId);
      this._watchId = null;
    }
  }

  private async _sendPosition(): Promise<void> {
    if (!this._lastPos || !this._token) return;
    const { latitude: lat, longitude: lng, speed } = this._lastPos.coords;
    try {
      await fetch(`${BACKEND_URL}/live/update`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          token:     this._token,
          lat,
          lng,
          speed:     speed ? Math.round(speed * 3.6) : 0,  // m/s → km/h
          timestamp: Date.now(),
        }),
      });
    } catch { /* ignoruj błąd sieciowy — spróbuje następnym razem */ }
  }
}

// Singleton — jedna instancja na całą apkę
export const liveTracker = new LiveTracker();
