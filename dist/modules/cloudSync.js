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
                await apiPost('/enriched-activities', { ...toSave, userId, activityId: toSave.id });
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
        // Napraw brakujące minimapUrl
        const enrichedMissingMinimap = enriched.filter(a => atlasEnrichedIds.has(a.id) && !a.minimapUrl && a.coords && a.coords.length > 1);
        for (const activity of enrichedMissingMinimap) {
            try {
                const minimapUrl = generateStaticMapUrl(activity.coords);
                if (minimapUrl) {
                    await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, { userId, minimapUrl });
                    await saveEnrichedActivity({ ...activity, minimapUrl });
                    console.log(`[CloudSync] 🗺️ Generated minimapUrl for: ${activity.name}`);
                }
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
// ── Static Map URL (Mapbox) ───────────────────────────────────────────────────
function generateStaticMapUrl(coords) {
    if (!coords || coords.length < 2)
        return null;
    const lats = coords.map(p => p[0]);
    const lons = coords.map(p => p[1]);
    const clat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const clon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const step = Math.max(1, Math.floor(coords.length / 100));
    const pts = coords.filter((_, i) => i % step === 0);
    const geo = JSON.stringify({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p[1], p[0]]) }, properties: { stroke: '#00c46a', 'stroke-width': 3 } });
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/geojson(${encodeURIComponent(geo)})/${clon},${clat},13,0/400x200?access_token=pk.eyJ1IjoibGVzemVrLW1pa3J1dCIsImEiOiJjbW8ybm5jZ3IwYmZjMnFxd3VycjBtaHZ4In0.mpY8zJ-aEW8n5iZhf2GrWA`;
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
                    await saveEnrichedActivity({ ...e, id });
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
        if (!activity.minimapUrl && activity.coords && activity.coords.length > 1) {
            activity.minimapUrl = generateStaticMapUrl(activity.coords);
        }
        const id = await saveEnrichedActivity(activity);
        const userId = getUserId();
        // Upload zdjęcia do Cloudinary — zamień base64 na URL w IndexedDB
        const uploaded = await uploadIfBase64(activity.photoUrl, userId, 'activities');
        if (uploaded) {
            // Zamień base64 na URL w IndexedDB (lżejsze dane lokalnie)
            await saveEnrichedActivity({ ...activity, photoUrl: uploaded.url, photoPublicId: uploaded.publicId });
        }
        void apiPost('/enriched-activities', {
            ...activity,
            activityId: activity.id,
            userId,
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