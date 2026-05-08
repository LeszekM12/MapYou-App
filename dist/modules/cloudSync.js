// ─── CLOUD SYNC ──────────────────────────────────────────────────────────────
// src/modules/cloudSync.ts
//
// Dwukierunkowy real-time sync między IndexedDB a MongoDB Atlas.
//
// ZAPIS:   każda operacja save/delete idzie do IndexedDB + Atlas równolegle
// ODCZYT:  przy starcie apki — jeśli IndexedDB puste, pobierz z Atlas
// USUNIECIE: IndexedDB + Atlas równolegle
//
// Zasada: IndexedDB jest zawsze źródłem prawdy lokalnie (offline działa).
//         Atlas jest kopią w chmurze (sync gdy online).
//
// Użycie:
//   import { CS } from './cloudSync.js';
//   await CS.saveWorkout(workout);           // zamiast saveWorkoutToDB()
//   await CS.deleteWorkout(id);              // zamiast deleteWorkoutFromDB()
//   await CS.saveActivity(activity);         // zamiast saveActivity()
//   await CS.saveEnrichedActivity(activity); // zamiast saveEnrichedActivity()
//   await CS.saveUnifiedWorkout(workout);    // zamiast saveUnifiedWorkout()
//   await CS.savePost(post);                 // zamiast savePost()
//   await CS.deletePost(id);                 // zamiast deletePost()
//   await CS.hydrate();                      // przy starcie — pobierz z Atlas jeśli IndexedDB puste
import { BACKEND_URL } from '../config.js';
import { saveWorkoutToDB, deleteWorkoutFromDB, loadWorkoutsFromDB, saveActivity, loadActivities, deleteActivity, saveEnrichedActivity, loadEnrichedActivities, deleteEnrichedActivity, saveUnifiedWorkout, loadUnifiedWorkouts, deleteUnifiedWorkout, savePost, loadPosts, deletePost, saveProfileToDB, } from './db.js';
import { getUserId } from './UserProfile.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
function isOnline() {
    return navigator.onLine;
}
async function apiPost(path, body) {
    if (!isOnline()) {
        console.warn('[CS] offline, skipping POST', path);
        return false;
    }
    try {
        const res = await fetch(`${BACKEND_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            console.error('[CS] POST failed', path, res.status, await res.text().catch(() => ''));
        else
            console.log('[CS] POST ok', path, res.status);
        return res.ok;
    }
    catch (err) {
        console.error('[CS] POST error', path, err);
        return false;
    }
}
async function apiDelete(path) {
    if (!isOnline())
        return false;
    try {
        const res = await fetch(`${BACKEND_URL}${path}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(10000),
        });
        return res.ok;
    }
    catch {
        return false;
    }
}
async function apiGet(path) {
    if (!isOnline())
        return null;
    try {
        const res = await fetch(`${BACKEND_URL}${path}`, {
            signal: AbortSignal.timeout(10000),
            cache: 'no-store',
        });
        if (!res.ok || res.status === 304)
            return null;
        const data = await res.json();
        return data.status === 'ok' ? data.data : null;
    }
    catch {
        return null;
    }
}
async function uploadIfBase64(base64, userId, folder, fixedPublicId) {
    if (!base64 || !base64.startsWith('data:image/'))
        return null;
    try {
        const res = await fetch(`${BACKEND_URL}/upload/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, userId, folder, publicId: fixedPublicId }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        return data.status === 'ok' ? { url: data.url, publicId: data.publicId } : null;
    }
    catch {
        return null;
    }
}
async function deleteFromCloudinary(publicId) {
    if (!isOnline())
        return;
    try {
        await fetch(`${BACKEND_URL}/upload/image`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ publicId }),
            signal: AbortSignal.timeout(10000),
        });
    }
    catch { /* ignoruj błąd sieciowy */ }
}
// ── Hydratacja — pobierz dane z Atlas do IndexedDB przy starcie ───────────────
const LS_HYDRATED_KEY = 'mapyou_hydrated_at';
const HYDRATE_MAX_AGE = 24 * 60 * 60 * 1000; // re-hydrate max raz na dobę
// ── Push lokalnych danych których brakuje w Atlas ────────────────────────────
// Odpala się przy każdym starcie — naprawia braki bez ręcznego sync
// ── Generate minimap PNG on canvas and upload to Cloudinary ──────────────────
// Fetches OSM tiles via backend proxy, draws GPS route, uploads to Cloudinary
function _latLonToTile(lat, lon, zoom) {
    const n = Math.pow(2, zoom);
    const tx = Math.floor((lon + 180) / 360 * n);
    const ty = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
    return { tx, ty };
}
function _tileToPixel(tx, ty, zoom, originTx, originTy) {
    return { px: (tx - originTx) * 256, py: (ty - originTy) * 256 };
}
function _latLonToPixel(lat, lon, zoom, originTx, originTy) {
    const n = Math.pow(2, zoom);
    const px = ((lon + 180) / 360 * n - originTx) * 256;
    const py = ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - originTy) * 256;
    return { px, py };
}
async function _loadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
        setTimeout(() => resolve(null), 5000);
    });
}
// ── Encoded Polyline (Google format) ─────────────────────────────────────────
function encodePolyline(coords) {
    let result = '';
    let prevLat = 0, prevLon = 0;
    // Sample max 200 points
    const step = Math.max(1, Math.floor(coords.length / 200));
    const pts = coords.filter((_, i) => i % step === 0);
    for (const [lat, lon] of pts) {
        const encodeVal = (val) => {
            let v = Math.round(val * 1e5);
            v = v < 0 ? ~(v << 1) : v << 1;
            let str = '';
            while (v >= 0x20) {
                str += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
                v >>= 5;
            }
            str += String.fromCharCode(v + 63);
            return str;
        };
        result += encodeVal(lat - prevLat) + encodeVal(lon - prevLon);
        prevLat = lat;
        prevLon = lon;
    }
    return result;
}
function decodePolyline(encoded) {
    const coords = [];
    let lat = 0, lon = 0, i = 0;
    while (i < encoded.length) {
        const decode = () => {
            let b, shift = 0, result = 0;
            do {
                b = encoded.charCodeAt(i++) - 63;
                result |= (b & 0x1f) << shift;
                shift += 5;
            } while (b >= 0x20);
            return result & 1 ? ~(result >> 1) : result >> 1;
        };
        lat += decode();
        lon += decode();
        coords.push([lat / 1e5, lon / 1e5]);
    }
    return coords;
}
// ── Canvas minimap renderer ───────────────────────────────────────────────────
function renderMinimapCanvas(container, coords, sport) {
    if (!coords || coords.length === 0)
        return;
    const W = 400, H = 200;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    canvas.style.cssText = 'width:100%;height:100%;border-radius:12px;display:block;position:absolute;top:0;left:0';
    container.style.position = 'relative';
    container.style.overflow = 'hidden';
    container.innerHTML = '';
    container.appendChild(canvas);
    const ctx = canvas.getContext('2d');
    const lats = coords.map(p => p[0]);
    const lons = coords.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const cLat = (minLat + maxLat) / 2;
    const cLon = (minLon + maxLon) / 2;
    // Choose zoom
    const latSpan = maxLat - minLat || 0.001;
    const lonSpan = maxLon - minLon || 0.001;
    let zoom = 15;
    for (let z = 16; z >= 10; z--) {
        const n = Math.pow(2, z);
        if (lonSpan / 360 * n * 256 < W * 0.7 && latSpan / 360 * n * 256 < H * 0.7) {
            zoom = z;
            break;
        }
    }
    const n = Math.pow(2, zoom);
    const centerTx = Math.floor((cLon + 180) / 360 * n);
    const centerTy = Math.floor((1 - Math.log(Math.tan(cLat * Math.PI / 180) + 1 / Math.cos(cLat * Math.PI / 180)) / Math.PI) / 2 * n);
    const tilesX = Math.ceil(W / 256) + 2;
    const tilesY = Math.ceil(H / 256) + 2;
    const originTx = centerTx - Math.floor(tilesX / 2);
    const originTy = centerTy - Math.floor(tilesY / 2);
    const toXY = (lat, lon) => {
        const px = ((lon + 180) / 360 * n - originTx) * 256;
        const sinLat = Math.sin(lat * Math.PI / 180);
        const py = (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * n * 256 - originTy * 256;
        const cx = (centerTx - originTx) * 256 + 128;
        const cy = (centerTy - originTy) * 256 + 128;
        return { x: px - cx + W / 2, y: py - cy + H / 2 };
    };
    // Fallback background — visible while tiles load or if they fail
    ctx.fillStyle = '#f2efe9';
    ctx.fillRect(0, 0, W, H);
    // Load HOT OSM tiles — same provider as StatsView detail map
    // https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png
    const SUBS = ['a', 'b', 'c'];
    const tilePromises = [];
    for (let dx = 0; dx < tilesX; dx++) {
        for (let dy = 0; dy < tilesY; dy++) {
            const tx = originTx + dx;
            const ty = originTy + dy;
            const cx = (centerTx - originTx) * 256 + 128;
            const cy = (centerTy - originTy) * 256 + 128;
            const px = dx * 256 - cx + W / 2;
            const py = dy * 256 - cy + H / 2;
            const sub = SUBS[(tx + ty) % 3];
            const url = `https://${sub}.tile.openstreetmap.fr/hot/${zoom}/${tx}/${ty}.png`;
            tilePromises.push(new Promise(resolve => {
                const img = new Image();
                img.crossOrigin = 'anonymous';
                img.onload = () => { ctx.drawImage(img, Math.round(px), Math.round(py), 256, 256); resolve(); };
                img.onerror = () => resolve();
                img.src = url;
                setTimeout(resolve, 5000);
            }));
        }
    }
    Promise.all(tilePromises).then(() => {
        // Sport colors — identical to StatsView
        const color = sport === 'cycling' ? '#ffb545' : sport === 'walking' ? '#5badea' : '#00c46a';
        if (coords.length === 1) {
            // Single point — teardrop pin, matching StatsView SVG marker style
            const { x, y } = toXY(coords[0][0], coords[0][1]);
            const R = 12; // pin circle radius
            // Draw teardrop body
            ctx.beginPath();
            ctx.arc(x, y - R, R, Math.PI, 0); // top half circle
            ctx.quadraticCurveTo(x + R, y, x, y + R * 1.6); // right side to tip
            ctx.quadraticCurveTo(x - R, y, x - R, y - R); // left side from tip
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            // Inner white circle
            ctx.beginPath();
            ctx.arc(x, y - R, R * 0.42, 0, Math.PI * 2);
            ctx.fillStyle = '#fff';
            ctx.fill();
        }
        else {
            // Route polyline — weight: 4, opacity: 0.95 (matches StatsView)
            ctx.globalAlpha = 0.95;
            ctx.beginPath();
            const p0 = toXY(coords[0][0], coords[0][1]);
            ctx.moveTo(p0.x, p0.y);
            for (let i = 1; i < coords.length; i++) {
                const p = toXY(coords[i][0], coords[i][1]);
                ctx.lineTo(p.x, p.y);
            }
            ctx.strokeStyle = color;
            ctx.lineWidth = 4;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.stroke();
            ctx.globalAlpha = 1;
            // Start circleMarker — radius 6, fillColor=color, white border weight 2
            const ps = toXY(coords[0][0], coords[0][1]);
            ctx.beginPath();
            ctx.arc(ps.x, ps.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = color;
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
            // End circleMarker — radius 6, fillColor=#e74c3c, white border weight 2
            const pe = toXY(coords[coords.length - 1][0], coords[coords.length - 1][1]);
            ctx.beginPath();
            ctx.arc(pe.x, pe.y, 6, 0, Math.PI * 2);
            ctx.fillStyle = '#e74c3c';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });
}
export { renderMinimapCanvas, encodePolyline, decodePolyline };
async function _pushMissingToAtlas(userId, enriched, unified, posts) {
    if (!isOnline() || !userId)
        return;
    try {
        // Pobierz co już jest w Atlas
        const [atlasEnriched, atlasUnified, atlasPosts] = await Promise.all([
            apiGet(`/enriched-activities?userId=${encodeURIComponent(userId)}`),
            apiGet(`/unified-workouts?userId=${encodeURIComponent(userId)}`),
            apiGet(`/posts?userId=${encodeURIComponent(userId)}`),
        ]);
        const atlasEnrichedIds = new Set((atlasEnriched ?? []).map(a => a.activityId));
        const atlasUnifiedIds = new Set((atlasUnified ?? []).map(w => w.workoutId));
        const atlasPostIds = new Set((atlasPosts ?? []).map(p => p.postId));
        // Mapa aktywności w Atlas z null photoUrl
        const atlasNullPhotoIds = new Set((atlasEnriched ?? []).filter(a => !a.photoUrl).map(a => a.activityId));
        const atlasNullPostIds = new Set((atlasPosts ?? []).filter(p => !p.photoUrl).map(p => p.postId));
        // Push brakujących enriched activities
        const missingEnriched = enriched.filter(a => !atlasEnrichedIds.has(a.id));
        for (const activity of missingEnriched) {
            try {
                const uploaded = await uploadIfBase64(activity.photoUrl, userId, 'activities', `activities/${userId}/${activity.id}`);
                const toSave = uploaded
                    ? { ...activity, photoUrl: uploaded.url, photoPublicId: uploaded.publicId }
                    : activity;
                const coordsEnc = toSave.coords && toSave.coords.length > 0
                    ? encodePolyline(toSave.coords)
                    : null;
                await apiPost('/enriched-activities', { ...toSave, userId, activityId: toSave.id, coordsEnc, coords: [] });
                console.log(`[CloudSync] 📤 Pushed missing activity: ${activity.id}`);
            }
            catch { }
        }
        // Napraw istniejące rekordy w Atlas z photoUrl: null
        // Obsługuje zarówno base64 jak i URL Cloudinary w IndexedDB
        const enrichedToFix = enriched.filter(a => atlasNullPhotoIds.has(a.id) && a.photoUrl && a.photoUrl.length > 0);
        for (const activity of enrichedToFix) {
            try {
                let finalUrl = activity.photoUrl;
                let publicId = activity.photoPublicId ?? null;
                // Jeśli base64 — uploaduj do Cloudinary
                if (finalUrl.startsWith('data:')) {
                    const uploaded = await uploadIfBase64(finalUrl, userId, 'activities', `activities/${userId}/${activity.id}`);
                    if (!uploaded)
                        continue;
                    finalUrl = uploaded.url;
                    publicId = uploaded.publicId;
                    await saveEnrichedActivity({ ...activity, photoUrl: finalUrl, photoPublicId: publicId });
                }
                // Zaktualizuj Atlas
                await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, {
                    userId, photoUrl: finalUrl, photoPublicId: publicId,
                });
                console.log(`[CloudSync] 🖼️ Fixed photo for activity: ${activity.id} → ${finalUrl.substring(0, 50)}`);
            }
            catch { }
        }
        // Napraw posty z photoUrl: null w Atlas
        const postsToFix = posts.filter(p => atlasNullPostIds.has(p.id) && p.photoUrl && p.photoUrl.length > 0);
        for (const post of postsToFix) {
            try {
                let finalUrl = post.photoUrl;
                let publicId = post.photoPublicId ?? null;
                if (finalUrl.startsWith('data:')) {
                    const uploaded = await uploadIfBase64(finalUrl, userId, 'posts', `posts/${userId}/${post.id}`);
                    if (!uploaded)
                        continue;
                    finalUrl = uploaded.url;
                    publicId = uploaded.publicId;
                    await savePost({ ...post, photoUrl: finalUrl, photoPublicId: publicId });
                }
                await apiPost(`/posts/${encodeURIComponent(post.id)}/photo`, {
                    userId, photoUrl: finalUrl, photoPublicId: publicId,
                });
                console.log(`[CloudSync] 🖼️ Fixed photo for post: ${post.id} → ${finalUrl.substring(0, 50)}`);
            }
            catch { }
        }
        // Push brakujących unified workouts
        const missingUnified = unified.filter(w => !atlasUnifiedIds.has(w.id));
        for (const workout of missingUnified) {
            try {
                await apiPost('/unified-workouts', { ...workout, userId, workoutId: workout.id });
                console.log(`[CloudSync] 📤 Pushed missing workout: ${workout.id}`);
            }
            catch { }
        }
        // Push brakujących posts
        const missingPosts = posts.filter(p => !atlasPostIds.has(p.id));
        for (const post of missingPosts) {
            try {
                const uploaded = await uploadIfBase64(post.photoUrl, userId, 'posts', `posts/${userId}/${post.id}`);
                const toSave = uploaded
                    ? { ...post, photoUrl: uploaded.url, photoPublicId: uploaded.publicId }
                    : post;
                await apiPost('/posts', { ...toSave, userId, postId: toSave.id });
                console.log(`[CloudSync] 📤 Pushed missing post: ${post.id}`);
            }
            catch { }
        }
        // Napraw brakujące coordsEnc w Atlas dla starych aktywności
        const atlasMissingCoordsEnc = (atlasEnriched ?? []).filter(a => !a.coordsEnc);
        const atlasMissingIds = new Set(atlasMissingCoordsEnc.map(a => a.activityId));
        const enrichedToEncode = enriched.filter(a => atlasMissingIds.has(a.id) && a.coords && a.coords.length > 0);
        for (const activity of enrichedToEncode) {
            try {
                const coordsEnc = encodePolyline(activity.coords);
                await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, {
                    userId, coordsEnc,
                });
                console.log(`[CloudSync] 📍 Fixed coordsEnc for: ${activity.name}`);
            }
            catch { }
        }
        // Push stats (weeklyWins, bestStreak) — zawsze aktualizuj
        const weeklyWins = parseInt(localStorage.getItem('mapyou_weekly_wins') ?? '0', 10);
        const bestStreak = parseInt(localStorage.getItem('mapyou_best_streak') ?? '0', 10);
        if (weeklyWins > 0 || bestStreak > 0) {
            await apiPost('/users', { userId, weeklyWins, bestStreak }).catch(() => { });
        }
        if (missingEnriched.length + missingUnified.length + missingPosts.length > 0) {
            console.log(`[CloudSync] ✅ Pushed ${missingEnriched.length} activities, ${missingUnified.length} workouts, ${missingPosts.length} posts`);
        }
    }
    catch (err) {
        console.warn('[CloudSync] _pushMissingToAtlas error:', err);
    }
}
export async function hydrate() {
    if (!isOnline())
        return;
    const userId = getUserId();
    const lastHydrated = Number(localStorage.getItem(LS_HYDRATED_KEY) ?? 0);
    // Sprawdź czy IndexedDB ma dane — jeśli tak i hydratacja była niedawno, skip
    const [workouts, activities, enriched, unified, posts] = await Promise.all([
        loadWorkoutsFromDB(),
        loadActivities(),
        loadEnrichedActivities(),
        loadUnifiedWorkouts(),
        loadPosts(),
    ]);
    const hasLocalData = workouts.length + activities.length + enriched.length + unified.length + posts.length > 0;
    if (hasLocalData && Date.now() - lastHydrated < HYDRATE_MAX_AGE) {
        console.log('[CloudSync] ✅ IndexedDB has data, skipping hydration');
        // Ale zawsze sprawdź czy lokalne dane są w Atlas — push brakujących
        void _pushMissingToAtlas(userId, enriched, unified, posts);
        return;
    }
    console.log('[CloudSync] 🔄 Hydrating from Atlas...');
    try {
        // Pobierz wszystkie kolekcje z Atlas równolegle
        const [serverWorkouts, serverActivities, serverEnriched, serverUnified, serverPosts, serverProfile,] = await Promise.all([
            apiGet(`/workouts?userId=${encodeURIComponent(userId)}`),
            apiGet(`/activities?userId=${encodeURIComponent(userId)}`),
            apiGet(`/enriched-activities?userId=${encodeURIComponent(userId)}`),
            apiGet(`/unified-workouts?userId=${encodeURIComponent(userId)}`),
            apiGet(`/posts?userId=${encodeURIComponent(userId)}`),
            fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}`, { signal: AbortSignal.timeout(10000) })
                .then(r => r.ok ? r.json() : null)
                .then(d => d?.status === 'ok' ? d.data : null)
                .catch(() => null),
        ]);
        let count = 0;
        // Zapisz do IndexedDB (put = upsert, nie duplikuje)
        if (serverWorkouts?.length) {
            for (const w of serverWorkouts) {
                try {
                    const raw = w;
                    const id = (raw.workoutId ?? raw.id);
                    if (!id)
                        continue;
                    await saveWorkoutToDB({ ...raw, id });
                    count++;
                }
                catch { /* skip problematic record */ }
            }
        }
        if (serverActivities?.length) {
            for (const a of serverActivities) {
                try {
                    const raw = a;
                    const id = (raw.activityId ?? raw.id);
                    if (!id)
                        continue;
                    await saveActivity({ ...a, id });
                    count++;
                }
                catch { /* skip problematic record */ }
            }
        }
        if (serverEnriched?.length) {
            for (const e of serverEnriched) {
                try {
                    const raw = e;
                    const id = (raw.activityId ?? raw.id);
                    if (!id)
                        continue;
                    // Decode coordsEnc back to coords array
                    const coordsEnc = raw.coordsEnc;
                    const coords = coordsEnc ? decodePolyline(coordsEnc) : (raw.coords ?? []);
                    await saveEnrichedActivity({ ...e, id, coords });
                    count++;
                }
                catch { /* skip */ }
            }
        }
        if (serverUnified?.length) {
            for (const u of serverUnified) {
                const mapped = { ...u, id: u.workoutId ?? u.id };
                await saveUnifiedWorkout(mapped);
            }
            count += serverUnified.length;
        }
        if (serverPosts?.length) {
            for (const p of serverPosts) {
                try {
                    const raw = p;
                    const id = (raw.postId ?? raw.id);
                    if (!id)
                        continue;
                    await savePost({ ...p, id });
                    count++;
                }
                catch { /* skip */ }
            }
        }
        if (serverProfile) {
            await saveProfileToDB(serverProfile);
        }
        localStorage.setItem(LS_HYDRATED_KEY, String(Date.now()));
        console.log(`[CloudSync] ✅ Hydrated ${count} records from Atlas`);
    }
    catch (err) {
        console.warn('[CloudSync] Hydration failed:', err);
    }
}
// ── CS — główny obiekt syncu ──────────────────────────────────────────────────
export const CS = {
    // ── Workouty ────────────────────────────────────────────────────────────────
    async saveWorkout(workout) {
        const id = await saveWorkoutToDB(workout);
        const userId = getUserId();
        void apiPost('/workouts', {
            ...workout,
            workoutId: workout.id ?? workout.workoutId ?? id,
            userId,
        });
        return id;
    },
    async deleteWorkout(id) {
        await deleteWorkoutFromDB(id);
        const userId = getUserId();
        void apiDelete(`/workouts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
    },
    // ── Activities (GPS tracked) ─────────────────────────────────────────────────
    async saveActivity(activity) {
        const id = await saveActivity(activity);
        const userId = getUserId();
        void apiPost('/activities', {
            ...activity,
            activityId: activity.id,
            userId,
        });
        return id;
    },
    async deleteActivity(id) {
        await deleteActivity(id);
        const userId = getUserId();
        void apiDelete(`/activities/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
    },
    // ── EnrichedActivities (Home feed) ───────────────────────────────────────────
    async saveEnrichedActivity(activity) {
        const id = await saveEnrichedActivity(activity);
        const userId = getUserId();
        // Upload zdjęcia do Cloudinary — zamień base64 na URL w IndexedDB
        const uploaded = await uploadIfBase64(activity.photoUrl, userId, 'activities');
        if (uploaded) {
            // Zamień base64 na URL w IndexedDB (lżejsze dane lokalnie)
            await saveEnrichedActivity({ ...activity, photoUrl: uploaded.url, photoPublicId: uploaded.publicId });
        }
        // Encode coords as Encoded Polyline before sending to Atlas
        const coordsEnc = activity.coords && activity.coords.length > 0
            ? encodePolyline(activity.coords)
            : null;
        void apiPost('/enriched-activities', {
            ...activity,
            activityId: activity.id,
            userId,
            coordsEnc,
            coords: [], // never store raw coords in Atlas
            photoUrl: uploaded?.url ?? activity.photoUrl,
            photoPublicId: uploaded?.publicId ?? null,
        });
        return id;
    },
    async deleteEnrichedActivity(id) {
        // Pobierz publicId przed usunięciem
        const activities = await loadEnrichedActivities();
        const activity = activities.find(a => a.id === id);
        const publicId = activity?.photoPublicId;
        await deleteEnrichedActivity(id);
        const userId = getUserId();
        void apiDelete(`/enriched-activities/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
        // Usuń zdjęcie z Cloudinary
        if (publicId)
            void deleteFromCloudinary(publicId);
    },
    // ── UnifiedWorkouts (Stats) ──────────────────────────────────────────────────
    async saveUnifiedWorkout(workout) {
        await saveUnifiedWorkout(workout);
        const userId = getUserId();
        void apiPost('/unified-workouts', {
            ...workout,
            workoutId: workout.id,
            userId,
        });
    },
    async deleteUnifiedWorkout(id) {
        await deleteUnifiedWorkout(id);
        const userId = getUserId();
        void apiDelete(`/unified-workouts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
    },
    // ── Posts ────────────────────────────────────────────────────────────────────
    async savePost(post) {
        await savePost(post);
        const userId = getUserId();
        // Upload zdjęcia do Cloudinary — zamień base64 na URL w IndexedDB
        const uploaded = await uploadIfBase64(post.photoUrl, userId, 'posts');
        if (uploaded) {
            await savePost({ ...post, photoUrl: uploaded.url, photoPublicId: uploaded.publicId });
        }
        void apiPost('/posts', {
            ...post,
            postId: post.id,
            userId,
            photoUrl: uploaded?.url ?? post.photoUrl,
            photoPublicId: uploaded?.publicId ?? null,
        });
    },
    async deletePost(id) {
        // Pobierz publicId przed usunięciem
        const posts = await loadPosts();
        const post = posts.find(p => p.id === id);
        const publicId = post?.photoPublicId;
        await deletePost(id);
        const userId = getUserId();
        void apiDelete(`/posts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
        // Usuń zdjęcie z Cloudinary
        if (publicId)
            void deleteFromCloudinary(publicId);
    },
    // ── Profile ──────────────────────────────────────────────────────────────────
    async saveProfile(profile) {
        await saveProfileToDB(profile);
        const userId = getUserId();
        // Upload avatara do Cloudinary przed zapisem do Atlas
        const uploaded = await uploadIfBase64(profile.avatarB64, userId, 'avatars', `mapyou/avatars/${userId}/avatar`);
        void apiPost('/users', {
            ...profile,
            userId,
            avatarB64: uploaded?.url ?? profile.avatarB64,
        });
    },
    // ── Hydratacja przy starcie ───────────────────────────────────────────────────
    hydrate,
};
//# sourceMappingURL=cloudSync.js.map