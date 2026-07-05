// ─── BACKGROUND GPS TRACKING (Capacitor foreground service) ──────────────────
// Wraps @capacitor-community/background-geolocation so an active workout keeps
// recording the route while the screen is locked or the app is backgrounded.
// On Android this runs a FOREGROUND SERVICE (required — otherwise the OS,
// especially Samsung, kills GPS in the background). On web/PWA it is a no-op and
// the app keeps using the foreground `navigator.geolocation` watch from Krok A.
//
// The plugin is read from the global Capacitor.Plugins registry (no npm import —
// this app has no bundler and often loads JS from GitHub Pages via server.url).
function bgPlugin() {
    const cap = globalThis.Capacitor;
    if (!cap?.isNativePlatform?.())
        return null;
    return cap.Plugins?.['BackgroundGeolocation'] ?? null;
}
const bgToWebPosition = (l) => ({
    timestamp: l.time ?? Date.now(),
    coords: {
        latitude: l.latitude,
        longitude: l.longitude,
        accuracy: l.accuracy ?? 0,
        altitude: l.altitude,
        altitudeAccuracy: l.altitudeAccuracy,
        speed: l.speed,
        heading: l.bearing,
        toJSON() { return this; },
    },
    toJSON() { return this; },
});
class BgTracker {
    constructor() {
        Object.defineProperty(this, "_watcherId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    /** True when a real background foreground-service tracker is usable. */
    isAvailable() {
        return bgPlugin() !== null;
    }
    /** Start recording in the background. `onLoc` gets every fix (foreground AND
     *  background). Returns false if unavailable (caller should fall back). */
    async start(onLoc, notif = { title: 'MapYou', message: 'Nagrywanie treningu…' }, onError) {
        const p = bgPlugin();
        if (!p)
            return false;
        if (this._watcherId)
            await this.stop(); // never run two watchers
        try {
            this._watcherId = await p.addWatcher({
                backgroundTitle: notif.title,
                backgroundMessage: notif.message,
                requestPermissions: true, // shows the location permission popup on first use
                stale: false,
                distanceFilter: 5, // metres — good balance of detail vs battery
            }, (loc, err) => {
                if (err) {
                    onError?.(err.code ?? 'error');
                    return;
                }
                if (loc)
                    onLoc(bgToWebPosition(loc));
            });
            return true;
        }
        catch {
            this._watcherId = null;
            return false;
        }
    }
    async stop() {
        const p = bgPlugin();
        const id = this._watcherId;
        this._watcherId = null;
        if (p && id) {
            try {
                await p.removeWatcher({ id });
            }
            catch { /* ignore */ }
        }
    }
    get active() { return this._watcherId !== null; }
    /** Open OS settings (for when the user picked "don't ask again"). */
    async openSettings() {
        const p = bgPlugin();
        if (p) {
            try {
                await p.openSettings();
            }
            catch { /* ignore */ }
        }
    }
}
export const bgTracker = new BgTracker();
//# sourceMappingURL=bgTracker.js.map