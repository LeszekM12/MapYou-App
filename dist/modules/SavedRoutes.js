// src/modules/SavedRoutes.ts
// User-curated routes: snapshots of completed Track activities the user
// explicitly saved as reusable, followable routes. Stored independently of
// the activity so deleting the activity doesn't lose the route.
const KEY = 'mapyou_saved_routes';
// Eligibility thresholds — only "real" routes can be saved (anti-spam)
const MIN_POINTS = 30;
const MIN_DISTANCE = 1; // km
const MIN_DURATION = 5 * 60; // seconds
export function getSavedRoutes() {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
        return Array.isArray(raw) ? raw : [];
    }
    catch {
        return [];
    }
}
export function isRouteSaved(id) {
    return getSavedRoutes().some(r => r.id === id);
}
export function saveRoute(route) {
    const list = getSavedRoutes();
    if (!list.some(r => r.id === route.id)) {
        list.unshift(route);
        localStorage.setItem(KEY, JSON.stringify(list));
    }
}
export function unsaveRoute(id) {
    localStorage.setItem(KEY, JSON.stringify(getSavedRoutes().filter(r => r.id !== id)));
}
// Is this activity good enough to be offered as a saved route?
export function routeEligible(coordsLen, distanceKm, durationSec) {
    return coordsLen >= MIN_POINTS && distanceKm >= MIN_DISTANCE && durationSec >= MIN_DURATION;
}
//# sourceMappingURL=SavedRoutes.js.map