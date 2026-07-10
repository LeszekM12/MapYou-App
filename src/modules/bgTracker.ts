// ─── BACKGROUND GPS TRACKING (Capacitor foreground service) ──────────────────
// Wraps @capacitor-community/background-geolocation so an active workout keeps
// recording the route while the screen is locked or the app is backgrounded.
// On Android this runs a FOREGROUND SERVICE (required — otherwise the OS,
// especially Samsung, kills GPS in the background). On web/PWA it is a no-op and
// the app keeps using the foreground `navigator.geolocation` watch from Krok A.
//
// The plugin is read from the global Capacitor.Plugins registry (no npm import —
// this app has no bundler and often loads JS from GitHub Pages via server.url).

interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
  altitude: number | null;
  altitudeAccuracy: number | null;
  speed: number | null;
  bearing: number | null;
  time: number | null;
}

interface BgWatcherOptions {
  backgroundMessage: string;      // presence enables the foreground service
  backgroundTitle: string;
  requestPermissions: boolean;
  stale: boolean;
  distanceFilter: number;         // metres between updates
}

interface BgGeoPlugin {
  addWatcher(opts: BgWatcherOptions, cb: (loc: BgLocation | undefined, err?: { code?: string; message?: string }) => void): Promise<string>;
  removeWatcher(opts: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

function bgPlugin(): BgGeoPlugin | null {
  const cap = (globalThis as unknown as { Capacitor?: { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.['BackgroundGeolocation'] as BgGeoPlugin | undefined) ?? null;
}

const bgToWebPosition = (l: BgLocation): GeolocationPosition => ({
  timestamp: l.time ?? Date.now(),
  coords: {
    latitude:  l.latitude,
    longitude: l.longitude,
    accuracy:  l.accuracy ?? 0,
    altitude:  l.altitude,
    altitudeAccuracy: l.altitudeAccuracy,
    speed:     l.speed,
    heading:   l.bearing,
    toJSON() { return this; },
  },
  toJSON() { return this; },
} as GeolocationPosition);

class BgTracker {
  private _watcherId: string | null = null;

  /** True when a real background foreground-service tracker is usable. */
  isAvailable(): boolean {
    return bgPlugin() !== null;
  }

  /** Start recording in the background. `onLoc` gets every fix (foreground AND
   *  background). Returns false if unavailable (caller should fall back). */
  async start(
    onLoc: (pos: GeolocationPosition) => void,
    notif: { title: string; message: string } = { title: 'MapYou', message: 'Nagrywanie treningu…' },
    onError?: (code: string) => void,
  ): Promise<boolean> {
    const p = bgPlugin();
    if (!p) return false;
    if (this._watcherId) await this.stop(); // never run two watchers
    try {
      this._watcherId = await p.addWatcher(
        {
          backgroundTitle:   notif.title,
          backgroundMessage: notif.message,
          requestPermissions: true,   // shows the location permission popup on first use
          stale: false,
          distanceFilter: 0,          // every fix (~1 Hz) — keeps Live Activity
                                      // ticking on the lock screen; route/distance
                                      // noise is filtered in Tracker (MIN_STEP_M)
        },
        (loc, err) => {
          if (err) { onError?.(err.code ?? 'error'); return; }
          if (loc) onLoc(bgToWebPosition(loc));
        },
      );
      return true;
    } catch {
      this._watcherId = null;
      return false;
    }
  }

  async stop(): Promise<void> {
    const p = bgPlugin();
    const id = this._watcherId;
    this._watcherId = null;
    if (p && id) { try { await p.removeWatcher({ id }); } catch { /* ignore */ } }
  }

  get active(): boolean { return this._watcherId !== null; }

  /** Open OS settings (for when the user picked "don't ask again"). */
  async openSettings(): Promise<void> {
    const p = bgPlugin();
    if (p) { try { await p.openSettings(); } catch { /* ignore */ } }
  }
}

export const bgTracker = new BgTracker();
