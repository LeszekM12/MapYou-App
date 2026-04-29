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
import { getUserId } from './PushNotifications.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
function isOnline() {
    return navigator.onLine;
}
async function apiPost(path, body) {
    if (!isOnline())
        return false;
    try {
        const res = await fetch(`${BACKEND_URL}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(10000),
        });
        return res.ok;
    }
    catch {
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
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        return data.status === 'ok' ? data.data : null;
    }
    catch {
        return null;
    }
}
// ── Hydratacja — pobierz dane z Atlas do IndexedDB przy starcie ───────────────
const LS_HYDRATED_KEY = 'mapyou_hydrated_at';
const HYDRATE_MAX_AGE = 24 * 60 * 60 * 1000; // re-hydrate max raz na dobę
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
                await saveWorkoutToDB(w);
            }
            count += serverWorkouts.length;
        }
        if (serverActivities?.length) {
            for (const a of serverActivities) {
                await saveActivity(a);
            }
            count += serverActivities.length;
        }
        if (serverEnriched?.length) {
            for (const e of serverEnriched) {
                // Mapuj activityId → id jeśli potrzeba
                const mapped = { ...e, id: e.activityId ?? e.id };
                await saveEnrichedActivity(mapped);
            }
            count += serverEnriched.length;
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
                const mapped = { ...p, id: p.postId ?? p.id };
                await savePost(mapped);
            }
            count += serverPosts.length;
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
        void apiPost('/enriched-activities', {
            ...activity,
            activityId: activity.id,
            userId,
        });
        return id;
    },
    async deleteEnrichedActivity(id) {
        await deleteEnrichedActivity(id);
        const userId = getUserId();
        void apiDelete(`/enriched-activities/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
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
        void apiPost('/posts', {
            ...post,
            postId: post.id,
            userId,
        });
    },
    async deletePost(id) {
        await deletePost(id);
        const userId = getUserId();
        void apiDelete(`/posts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
    },
    // ── Profile ──────────────────────────────────────────────────────────────────
    async saveProfile(profile) {
        await saveProfileToDB(profile);
        const userId = getUserId();
        void apiPost('/users', { ...profile, userId });
    },
    // ── Hydratacja przy starcie ───────────────────────────────────────────────────
    hydrate,
};
//# sourceMappingURL=cloudSync.js.map