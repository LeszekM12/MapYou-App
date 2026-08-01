// ─── LIVE TRACKER ────────────────────────────────────────────────────────────
// src/modules/LiveTracker.ts
//
// Zarządza sesją live-trackingu podczas treningu:
//   - generuje token
//   - wysyła pozycję co INTERVAL_MS sekund
//   - obsługuje pause/resume/finish
//   - integruje z push notifications do znajomych

import { BACKEND_URL, PUBLIC_BASE_URL } from '../config.js';
import { dlog } from '../utils/log.js';
import { getAllFriends, updateFriendLiveToken } from './FriendsDB.js';
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
  return `${PUBLIC_BASE_URL}/#live=${token}`;
}

// ── LiveTracker class ─────────────────────────────────────────────────────────

export class LiveTracker {
  private _token:    string | null = null;
  private _sport:    string = 'running';
  private _active:   boolean       = false;
  private _paused:   boolean       = false;
  private _watchId:  number | null = null;
  private _interval: ReturnType<typeof setInterval> | null = null;
  private _lastPos:  GeolocationPosition | null = null;

  get token():   string | null { return this._token; }
  setSport(sport: string): void { this._sport = sport; }
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

    const friends  = await getAllFriends();
    const myUserId = getUserId();

    // Lokalne subskrypcje znajomych jako materiał pomocniczy. Backend i tak
    // dolozy swieze po swojej stronie — patrz komentarz nizej.
    const friendSubs = friends.filter(f => f.pushSub?.endpoint).map(f => f.pushSub);

    // ── Rejestracja sesji MUSI byc pierwsza ──────────────────────────────────
    // Wczesniej przed tym zapytaniem stalo `await navigator.serviceWorker.ready`.
    // Na iOS `navigator.serviceWorker` nie istnieje, wiec linia rzucala od razu
    // i leciala do catch — sesja powstawala. Na Androidzie obiekt ISTNIEJE, a
    // `.ready` to obietnica, ktora NIGDY sie nie rozwiazuje, jesli zaden worker
    // nie zostal aktywowany. `await` wisial w nieskonczonosc, `/live/start`
    // nigdy nie leciał, a natywny tracker mimo to slal `/live/update` — backend
    // odpowiadal 404, bo sesja nie istniala. Stad live dzialal tylko z iPhone'a
    // na Samsunga, nigdy odwrotnie.
    //
    // Teraz sesja powstaje ZANIM cokolwiek moze sie zawiesic. `ownerEndpoint`
    // jest tylko usprawnieniem dopasowania sesji do znajomego, wiec dochodzi
    // osobnym zadaniem, gdy juz go znamy.
    try {
      const res = await fetch(`${BACKEND_URL}/live/start`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        signal:  AbortSignal.timeout(15_000),
        body:    JSON.stringify({ token: this._token, userName, liveUrl, friendSubs, sport: this._sport ?? 'running', myUserId }),
      });
      if (!res.ok) console.warn('[LiveTracker] /live/start HTTP', res.status);
    } catch (err) {
      console.warn('[LiveTracker] start failed:', err);
    }

    // Wlasny endpoint push — dopiero teraz, z twardym limitem czasu.
    // `serviceWorker.ready` potrafi nie rozwiazac sie nigdy, wiec NIGDY nie
    // wolno na nia czekac bez wyscigu z timerem.
    void (async () => {
      try {
        if (!('serviceWorker' in navigator)) return;
        const reg = await Promise.race([
          navigator.serviceWorker.ready,
          new Promise<null>(r => setTimeout(() => r(null), 3000)),
        ]);
        if (!reg) return;
        const sub = await reg.pushManager.getSubscription();
        if (!sub?.endpoint) return;
        await fetch(`${BACKEND_URL}/live/start`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ token: this._token, userName, liveUrl, friendSubs: [], sport: this._sport ?? 'running', myUserId, ownerEndpoint: sub.endpoint }),
        });
      } catch { /* brak push — sesja i tak dziala po userId */ }
    })();

    // Zacznij śledzenie GPS
    this._startGPS();

    // Wysyłaj pozycję co INTERVAL_MS (web/PWA; na iOS przy blokadzie ticki śpią,
    // wtedy pozycje dowozi feedPosition() z natywnego GPS Trackera)
    this._interval = setInterval(() => {
      if (!this._paused && this._lastPos) void this._maybeSend();
    }, INTERVAL_MS);

    // Zapisz token przy wszystkich znajomych — żeby pojawił się przycisk Watch
    for (const f of friends) {
      await updateFriendLiveToken(f.subscriptionId, this._token);
    }

    dlog(`[LiveTracker] Started: ${this._token}`);
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
        body: JSON.stringify({ token: this._token, sport: this._sport }),
      });
    } catch { /* ignoruj */ }

    // Wyczyść token u wszystkich znajomych
    const allFriends = await getAllFriends();
    for (const f of allFriends) {
      if (f.liveToken === this._token) {
        await updateFriendLiveToken(f.subscriptionId, null);
      }
    }

    localStorage.removeItem(LS_TOKEN_KEY);
    dlog(`[LiveTracker] Finished: ${this._token}`);
    this._token = null;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _lastSendAt = 0;

  /** Feed a fresh position from the Tracker's native GPS pipeline.
   *  On iOS the lock screen suspends JS timers AND web watchers, so the
   *  interval below (and _startGPS) go silent — but native GPS callbacks in
   *  Tracker._onPosition keep flowing. This keeps the friend's live view
   *  moving with the screen locked. Sends share one throttle (INTERVAL_MS)
   *  with the interval path, so the rate never doubles in the foreground. */
  feedPosition(lat: number, lng: number, speedMs?: number | null): void {
    if (!this._active) return;
    this._lastPos = {
      coords: { latitude: lat, longitude: lng, speed: speedMs ?? null },
      timestamp: Date.now(),
    } as GeolocationPosition;
    if (!this._paused) void this._maybeSend();
  }

  private async _maybeSend(): Promise<void> {
    const now = Date.now();
    if (now - this._lastSendAt < INTERVAL_MS) return;
    this._lastSendAt = now;
    await this._sendPosition();
  }

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
