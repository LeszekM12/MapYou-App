// ─── SYNC TO MONGODB + CLOUDINARY ────────────────────────────────────────────
// src/modules/syncToMongo.ts
import { BACKEND_URL } from '../config.js';
import { loadWorkoutsFromDB, loadActivities, loadEnrichedActivities, loadUnifiedWorkouts, loadPosts, loadProfileFromDB, db, } from './db.js';
import { getUserId } from './PushNotifications.js';
const LS_SYNCED_KEY = 'mapyou_mongo_synced';
const LS_SYNC_FAILED = 'mapyou_mongo_sync_failed_at';
const RETRY_AFTER_MS = 5 * 60 * 1000;
// ── Kompresja zdjęcia przed uploadem ─────────────────────────────────────────
// Zmniejsza do max 1920px, quality 0.85 — niewidoczna różnica, ~5x mniejszy plik
async function compressImage(base64, maxPx = 1920, quality = 0.85) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            // Skaluj tylko jeśli większe niż maxPx
            if (width > maxPx || height > maxPx) {
                if (width > height) {
                    height = Math.round((height * maxPx) / width);
                    width = maxPx;
                }
                else {
                    width = Math.round((width * maxPx) / height);
                    height = maxPx;
                }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            const compressed = canvas.toDataURL('image/jpeg', quality);
            resolve(compressed);
        };
        img.onerror = () => resolve(base64); // fallback — zostaw oryginał
        img.src = base64;
    });
}
// ── Czekaj na gotowość Dexie ──────────────────────────────────────────────────
async function waitForDexie(timeoutMs = 10000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        try {
            await db.open();
            return true;
        }
        catch {
            await new Promise(r => setTimeout(r, 300));
        }
    }
    console.warn('[Sync] Dexie not ready after timeout');
    return false;
}
// ── Upload zdjęcia do Cloudinary przez backend ────────────────────────────────
async function uploadImageToCloudinary(base64, userId, folder, publicId) {
    if (!base64 || !base64.startsWith('data:image/'))
        return base64 || null;
    try {
        // Kompresuj przed uploadem
        const compressed = await compressImage(base64);
        console.log(`[Sync] Compressed: ${Math.round(base64.length / 1024)}KB → ${Math.round(compressed.length / 1024)}KB`);
        const res = await fetch(`${BACKEND_URL}/upload/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: compressed, userId, folder, publicId }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        return data.status === 'ok' ? data.url : null;
    }
    catch {
        return null;
    }
}
// ── Zamień base64 na URL ──────────────────────────────────────────────────────
async function migratePhotos(userId, enrichedActivities, posts, profile) {
    console.log('[Sync] Uploading photos to Cloudinary...');
    const migratedActivities = await Promise.all(enrichedActivities.map(async (a) => {
        if (!a.photoUrl?.startsWith('data:image/'))
            return a;
        const url = await uploadImageToCloudinary(a.photoUrl, userId, 'activities');
        return { ...a, photoUrl: url };
    }));
    const migratedPosts = await Promise.all(posts.map(async (p) => {
        if (!p.photoUrl?.startsWith('data:image/'))
            return p;
        const url = await uploadImageToCloudinary(p.photoUrl, userId, 'posts');
        return { ...p, photoUrl: url };
    }));
    let migratedProfile = profile;
    if (profile?.avatarB64?.startsWith('data:image/')) {
        const url = await uploadImageToCloudinary(profile.avatarB64, userId, 'avatars', `mapyou/avatars/${userId}/avatar`);
        migratedProfile = url
            ? { ...profile, avatarB64: null, avatarUrl: url }
            : profile;
    }
    return {
        enrichedActivities: migratedActivities,
        posts: migratedPosts,
        profile: migratedProfile,
    };
}
// ── Główna funkcja ────────────────────────────────────────────────────────────
export async function syncToMongoIfNeeded() {
    if (localStorage.getItem(LS_SYNCED_KEY) === 'true')
        return;
    const lastFailed = Number(localStorage.getItem(LS_SYNC_FAILED) ?? 0);
    if (lastFailed > 0 && Date.now() - lastFailed < RETRY_AFTER_MS)
        return;
    const userId = getUserId();
    console.log(`[Sync] Starting for userId=${userId}`);
    const dexieReady = await waitForDexie();
    if (!dexieReady) {
        _markFailed();
        return;
    }
    console.log('[Sync] Dexie ready');
    try {
        const healthRes = await fetch(`${BACKEND_URL}/health`, { signal: AbortSignal.timeout(8000) });
        if (!healthRes.ok) {
            _markFailed();
            return;
        }
        console.log('[Sync] Backend alive');
        const statusRes = await fetch(`${BACKEND_URL}/migrate/status/${encodeURIComponent(userId)}`, { signal: AbortSignal.timeout(8000) });
        if (!statusRes.ok) {
            _markFailed();
            return;
        }
        const statusData = await statusRes.json();
        const totalInAtlas = Object.values(statusData.counts).reduce((a, b) => a + b, 0);
        console.log(`[Sync] Atlas has ${totalInAtlas} records for this user`);
        if (totalInAtlas > 0) {
            _markSynced();
            console.log(`[Sync] Already synced (${totalInAtlas} records)`);
            return;
        }
        const [workouts, activities, enrichedActivities, unifiedWorkouts, posts, profile] = await Promise.all([
            loadWorkoutsFromDB(), loadActivities(), loadEnrichedActivities(),
            loadUnifiedWorkouts(), loadPosts(), loadProfileFromDB(),
        ]);
        console.log(`[Sync] IndexedDB: workouts=${workouts.length} activities=${activities.length} enriched=${enrichedActivities.length} unified=${unifiedWorkouts.length} posts=${posts.length}`);
        const totalLocal = workouts.length + activities.length + enrichedActivities.length + unifiedWorkouts.length + posts.length;
        if (totalLocal === 0) {
            _markSynced();
            console.log('[Sync] IndexedDB empty — nothing to migrate');
            return;
        }
        console.log(`[Sync] Migrating ${totalLocal} records...`);
        const { enrichedActivities: migratedActivities, posts: migratedPosts, profile: migratedProfile } = await migratePhotos(userId, enrichedActivities, posts, profile);
        const migrateRes = await fetch(`${BACKEND_URL}/migrate/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId, workouts, activities,
                enrichedActivities: migratedActivities,
                unifiedWorkouts, posts: migratedPosts,
                profile: migratedProfile ?? undefined,
            }),
            signal: AbortSignal.timeout(60000),
        });
        if (!migrateRes.ok) {
            console.error('[Sync] migrate/bulk failed:', migrateRes.status);
            _markFailed();
            return;
        }
        const migrateData = await migrateRes.json();
        if (migrateData.status === 'ok') {
            _markSynced();
            console.log('[Sync] Migration complete:', JSON.stringify(migrateData.summary));
        }
        else {
            _markFailed();
        }
    }
    catch (err) {
        _markFailed();
        console.warn('[Sync] Error:', String(err));
    }
}
// ── Helpers ───────────────────────────────────────────────────────────────────
function _markSynced() {
    localStorage.setItem(LS_SYNCED_KEY, 'true');
    localStorage.removeItem(LS_SYNC_FAILED);
}
function _markFailed() {
    localStorage.setItem(LS_SYNC_FAILED, String(Date.now()));
}
export function resetSyncFlag() {
    localStorage.removeItem(LS_SYNCED_KEY);
    localStorage.removeItem(LS_SYNC_FAILED);
    console.log('[Sync] Sync flag reset');
}
window.resetSync = resetSyncFlag;
//# sourceMappingURL=syncToMongo.js.map