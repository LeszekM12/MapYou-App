// ─── NATIVE GEOLOCATION SHIM (Capacitor) ─────────────────────────────────────
// In the Capacitor WebView, web `navigator.geolocation` has no UI to show a
// permission prompt, so it silently fails. This module, ON NATIVE ONLY,
// replaces `navigator.geolocation` with an implementation backed by the
// @capacitor/geolocation plugin (which shows the real Android/iOS permission
// dialog). The rest of the app keeps calling navigator.geolocation as usual —
// zero changes at call sites, and the web/PWA build is untouched.
//
// Permission flow (matches the desired UX):
//  • First use → system permission popup (once).
//  • Granted → remembered by the OS; no more popups.
//  • Denied → next call tries requestPermissions() again, so tapping
//    "Start tracking" re-triggers the popup (until "Don't ask again",
//    at which point Android only allows granting via Settings).
function capGeo() {
    const cap = globalThis.Capacitor;
    if (!cap?.isNativePlatform?.())
        return null;
    return cap.Plugins?.['Geolocation'] ?? null;
}
const toWebPosition = (p) => ({
    timestamp: p.timestamp,
    coords: {
        latitude: p.coords.latitude,
        longitude: p.coords.longitude,
        accuracy: p.coords.accuracy,
        altitude: p.coords.altitude,
        altitudeAccuracy: p.coords.altitudeAccuracy,
        speed: p.coords.speed,
        heading: p.coords.heading,
        toJSON() { return this; },
    },
    toJSON() { return this; },
});
const permError = () => ({
    code: 1, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
    message: 'Location permission denied',
});
const posError = (msg) => ({
    code: 2, PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3,
    message: msg,
});
/** Ensure permission; re-requests on every denied call so a "Start tracking"
 *  tap re-shows the popup (until OS-level "don't ask again"). */
async function ensurePermission(g) {
    try {
        const st = await g.checkPermissions();
        if (st.location === 'granted')
            return true;
        const req = await g.requestPermissions();
        return req.location === 'granted';
    }
    catch {
        return false;
    }
}
/** Install the shim. Call once at startup; no-op on web. */
export function installNativeGeolocation() {
    const g = capGeo();
    if (!g)
        return; // web/PWA → keep the browser implementation
    let nextId = 1;
    const watches = new Map(); // webId -> native watch id (null while starting)
    const shim = {
        getCurrentPosition(success, error, options) {
            void (async () => {
                if (!(await ensurePermission(g))) {
                    error?.(permError());
                    return;
                }
                try {
                    const p = await g.getCurrentPosition({
                        enableHighAccuracy: options?.enableHighAccuracy ?? true,
                        timeout: options?.timeout ?? 10000,
                        maximumAge: options?.maximumAge ?? 0,
                    });
                    success(toWebPosition(p));
                }
                catch (e) {
                    error?.(posError(e instanceof Error ? e.message : 'position_unavailable'));
                }
            })();
        },
        watchPosition(success, error, options) {
            const webId = nextId++;
            watches.set(webId, null);
            void (async () => {
                if (!(await ensurePermission(g))) {
                    error?.(permError());
                    watches.delete(webId);
                    return;
                }
                if (!watches.has(webId))
                    return; // cleared while asking
                try {
                    const nativeId = await g.watchPosition({
                        enableHighAccuracy: options?.enableHighAccuracy ?? true,
                        timeout: options?.timeout ?? 10000,
                        maximumAge: options?.maximumAge ?? 0,
                    }, (pos, err) => {
                        if (pos)
                            success(toWebPosition(pos));
                        else if (err)
                            error?.(posError(String(err)));
                    });
                    if (watches.has(webId))
                        watches.set(webId, nativeId);
                    else
                        void g.clearWatch({ id: nativeId }); // cleared meanwhile
                }
                catch (e) {
                    error?.(posError(e instanceof Error ? e.message : 'watch_failed'));
                    watches.delete(webId);
                }
            })();
            return webId;
        },
        clearWatch(webId) {
            const nativeId = watches.get(webId);
            watches.delete(webId);
            if (nativeId)
                void g.clearWatch({ id: nativeId });
        },
    };
    try {
        Object.defineProperty(navigator, 'geolocation', { value: shim, configurable: true });
    }
    catch {
        // Some WebViews expose it read-only; fall back to patching methods.
        const nav = navigator.geolocation;
        nav['getCurrentPosition'] = shim.getCurrentPosition.bind(shim);
        nav['watchPosition'] = shim.watchPosition.bind(shim);
        nav['clearWatch'] = shim.clearWatch.bind(shim);
    }
}
//# sourceMappingURL=nativeGeo.js.map