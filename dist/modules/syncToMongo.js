// ─── SYNC TO MONGODB + CLOUDINARY ────────────────────────────────────────────
// src/modules/syncToMongo.ts
//
// Jednorazowa migracja danych z IndexedDB → MongoDB Atlas przez backend.
// Zdjęcia (base64) są uploadowane do Cloudinary przed zapisem do Atlas.
// W bazie zostają tylko URL-e do zdjęć — nie base64.
//
// Kolejność:
//   1. Sprawdź flagę localStorage — jeśli synced, wyjdź
//   2. Sprawdź czy backend żyje
//   3. Sprawdź czy dane są już w Atlas
//   4. Upload zdjęć do Cloudinary → zamień base64 na URL
//   5. Wyślij dane do /migrate/bulk
//   6. Ustaw flagę
import { BACKEND_URL } from '../config.js';
import { loadWorkoutsFromDB, loadActivities, loadEnrichedActivities, loadUnifiedWorkouts, loadPosts, loadProfileFromDB, } from './db.js';
import { getUserId } from './PushNotifications.js';
// ── Stałe ─────────────────────────────────────────────────────────────────────
const LS_SYNCED_KEY = 'mapyou_mongo_synced';
const LS_SYNC_FAILED = 'mapyou_mongo_sync_failed_at';
const RETRY_AFTER_MS = 5 * 60 * 1000;
// ── Upload zdjęcia do Cloudinary przez backend ────────────────────────────────
async function uploadImageToCloudinary(base64, userId, folder, publicId) {
    // Nie uploaduj jeśli to już URL (zostało wcześniej uploadowane)
    if (!base64 || !base64.startsWith('data:image/'))
        return base64 || null;
    try {
        const res = await fetch(`${BACKEND_URL}/upload/image`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: base64, userId, folder, publicId }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        return data.status === 'ok' ? data.url : null;
    }
    catch {
        return null; // Nie blokuj migracji jeśli upload się nie powiedzie
    }
}
// ── Zamień base64 na URL we wszystkich kolekcjach ─────────────────────────────
async function migratePhotos(userId, enrichedActivities, posts, profile) {
    console.log('[Sync] 🖼  Uploading photos to Cloudinary...');
    // EnrichedActivities — photoUrl
    const migratedActivities = await Promise.all(enrichedActivities.map(async (activity) => {
        if (!activity.photoUrl?.startsWith('data:image/'))
            return activity;
        const url = await uploadImageToCloudinary(activity.photoUrl, userId, 'activities');
        return { ...activity, photoUrl: url };
    }));
    // Posts — photoUrl
    const migratedPosts = await Promise.all(posts.map(async (post) => {
        if (!post.photoUrl?.startsWith('data:image/'))
            return post;
        const url = await uploadImageToCloudinary(post.photoUrl, userId, 'posts');
        return { ...post, photoUrl: url };
    }));
    // Profile — avatarB64 (stały public_id — nie tworzy duplikatów)
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
    try {
        // Krok 1 — Backend żyje?
        const healthRes = await fetch(`${BACKEND_URL}/health`, {
            signal: AbortSignal.timeout(5000),
        });
        if (!healthRes.ok) {
            _markFailed();
            return;
        }
        // Krok 2 — Dane już w Atlas?
        const statusRes = await fetch(`${BACKEND_URL}/migrate/status/${encodeURIComponent(userId)}`, { signal: AbortSignal.timeout(5000) });
        if (!statusRes.ok) {
            _markFailed();
            return;
        }
        const statusData = await statusRes.json();
        const totalInAtlas = Object.values(statusData.counts).reduce((a, b) => a + b, 0);
        if (totalInAtlas > 0) {
            _markSynced();
            console.log(`[Sync] ✅ Already in MongoDB Atlas (${totalInAtlas} records)`);
            return;
        }
        // Krok 3 — Pobierz dane z IndexedDB
        const [workouts, activities, enrichedActivities, unifiedWorkouts, posts, profile] = await Promise.all([
            loadWorkoutsFromDB(),
            loadActivities(),
            loadEnrichedActivities(),
            loadUnifiedWorkouts(),
            loadPosts(),
            loadProfileFromDB(),
        ]);
        const totalLocal = workouts.length + activities.length +
            enrichedActivities.length + unifiedWorkouts.length + posts.length;
        if (totalLocal === 0) {
            _markSynced();
            console.log('[Sync] ✅ No local data — new user');
            return;
        }
        console.log(`[Sync] 🔄 Migrating ${totalLocal} records...`);
        // Krok 4 — Upload zdjęć do Cloudinary (zamień base64 → URL)
        const { enrichedActivities: migratedActivities, posts: migratedPosts, profile: migratedProfile } = await migratePhotos(userId, enrichedActivities, posts, profile);
        // Krok 5 — Wyślij do Atlas
        const migrateRes = await fetch(`${BACKEND_URL}/migrate/bulk`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId,
                workouts,
                activities,
                enrichedActivities: migratedActivities,
                unifiedWorkouts,
                posts: migratedPosts,
                profile: migratedProfile ?? undefined,
            }),
            signal: AbortSignal.timeout(60000), // 60s — może być dużo danych
        });
        if (!migrateRes.ok) {
            _markFailed();
            return;
        }
        const migrateData = await migrateRes.json();
        if (migrateData.status === 'ok') {
            _markSynced();
            console.log('[Sync] ✅ Migration complete:', migrateData.summary);
        }
        else {
            _markFailed();
        }
    }
    catch (err) {
        _markFailed();
        console.warn('[Sync] ⚠️  Backend unavailable, retry in 5 min:', err);
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
    console.log('[Sync] 🔄 Sync flag reset — will migrate on next load');
}
window.resetSync = resetSyncFlag;
//# sourceMappingURL=syncToMongo.js.map