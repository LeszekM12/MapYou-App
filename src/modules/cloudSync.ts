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
import {
  saveWorkoutToDB,
  deleteWorkoutFromDB,
  loadWorkoutsFromDB,
  saveActivity,
  loadActivities,
  deleteActivity,
  saveEnrichedActivity,
  loadEnrichedActivities,
  deleteEnrichedActivity,
  saveUnifiedWorkout,
  loadUnifiedWorkouts,
  deleteUnifiedWorkout,
  savePost,
  loadPosts,
  deletePost,
  saveProfileToDB,
  loadProfileFromDB,
  type WorkoutRecord,
  type EnrichedActivity,
  type UnifiedWorkout,
  type PostRecord,
  type ProfileRecord,
} from './db.js';
import type { ActivityRecord } from './Tracker.js';
import { getUserId } from './UserProfile.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function isOnline(): boolean {
  return navigator.onLine;
}

async function apiPost(path: string, body: unknown): Promise<boolean> {
  if (!isOnline()) { console.warn('[CS] offline, skipping POST', path); return false; }
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
      signal:  AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.error('[CS] POST failed', path, res.status, await res.text().catch(() => ''));
    else console.log('[CS] POST ok', path, res.status);
    return res.ok;
  } catch (err) {
    console.error('[CS] POST error', path, err);
    return false;
  }
}

async function apiDelete(path: string): Promise<boolean> {
  if (!isOnline()) return false;
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: 'DELETE',
      signal: AbortSignal.timeout(10_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function apiGet<T>(path: string): Promise<T[] | null> {
  if (!isOnline()) return null;
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { status: string; data: T[] };
    return data.status === 'ok' ? data.data : null;
  } catch {
    return null;
  }
}


// ── Upload zdjęcia do Cloudinary jeśli base64 ─────────────────────────────────

interface UploadResult { url: string; publicId: string }

async function uploadIfBase64(
  base64:    string | null | undefined,
  userId:    string,
  folder:    'activities' | 'posts' | 'avatars',
  fixedPublicId?: string,
): Promise<UploadResult | null> {
  if (!base64 || !base64.startsWith('data:image/')) return null;
  try {
    const res = await fetch(`${BACKEND_URL}/upload/image`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ image: base64, userId, folder, publicId: fixedPublicId }),
      signal:  AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { status: string; url: string; publicId: string };
    return data.status === 'ok' ? { url: data.url, publicId: data.publicId } : null;
  } catch {
    return null;
  }
}

async function deleteFromCloudinary(publicId: string): Promise<void> {
  if (!isOnline()) return;
  try {
    await fetch(`${BACKEND_URL}/upload/image`, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ publicId }),
      signal:  AbortSignal.timeout(10_000),
    });
  } catch { /* ignoruj błąd sieciowy */ }
}

// ── Hydratacja — pobierz dane z Atlas do IndexedDB przy starcie ───────────────

const LS_HYDRATED_KEY = 'mapyou_hydrated_at';
const HYDRATE_MAX_AGE = 24 * 60 * 60 * 1000; // re-hydrate max raz na dobę

export async function hydrate(): Promise<void> {
  if (!isOnline()) return;

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
    const [
      serverWorkouts,
      serverActivities,
      serverEnriched,
      serverUnified,
      serverPosts,
      serverProfile,
    ] = await Promise.all([
      apiGet<WorkoutRecord>(`/workouts?userId=${encodeURIComponent(userId)}`),
      apiGet<ActivityRecord>(`/activities?userId=${encodeURIComponent(userId)}`),
      apiGet<EnrichedActivity>(`/enriched-activities?userId=${encodeURIComponent(userId)}`),
      apiGet<UnifiedWorkout>(`/unified-workouts?userId=${encodeURIComponent(userId)}`),
      apiGet<PostRecord>(`/posts?userId=${encodeURIComponent(userId)}`),
      fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}`, { signal: AbortSignal.timeout(10_000) })
        .then(r => r.ok ? r.json() as Promise<{ status: string; data: ProfileRecord }> : null)
        .then(d => d?.status === 'ok' ? d.data : null)
        .catch(() => null),
    ]);

    let count = 0;

    // Zapisz do IndexedDB (put = upsert, nie duplikuje)
    if (serverWorkouts?.length) {
      for (const w of serverWorkouts) {
        try {
          const raw = w as unknown as Record<string, unknown>;
          const id = (raw.workoutId ?? raw.id) as string | undefined;
          if (!id) continue;
          await saveWorkoutToDB({ ...raw, id });
          count++;
        } catch { /* skip problematic record */ }
      }
    }

    if (serverActivities?.length) {
      for (const a of serverActivities) {
        try {
          const raw = a as unknown as Record<string, unknown>;
          const id = (raw.activityId ?? raw.id) as string | undefined;
          if (!id) continue;
          await saveActivity({ ...a, id } as typeof a);
          count++;
        } catch { /* skip problematic record */ }
      }
    }

    if (serverEnriched?.length) {
      for (const e of serverEnriched) {
        try {
          const raw = e as unknown as Record<string, unknown>;
          const id = (raw.activityId ?? raw.id) as string | undefined;
          if (!id) continue;
          await saveEnrichedActivity({ ...e, id } as EnrichedActivity);
          count++;
        } catch { /* skip */ }
      }
    }

    if (serverUnified?.length) {
      for (const u of serverUnified) {
        const mapped = { ...u, id: (u as unknown as Record<string, unknown>).workoutId as string ?? u.id };
        await saveUnifiedWorkout(mapped as UnifiedWorkout);
      }
      count += serverUnified.length;
    }

    if (serverPosts?.length) {
      for (const p of serverPosts) {
        try {
          const raw = p as unknown as Record<string, unknown>;
          const id = (raw.postId ?? raw.id) as string | undefined;
          if (!id) continue;
          await savePost({ ...p, id } as PostRecord);
          count++;
        } catch { /* skip */ }
      }
    }

    if (serverProfile) {
      await saveProfileToDB(serverProfile as ProfileRecord);
    }

    localStorage.setItem(LS_HYDRATED_KEY, String(Date.now()));
    console.log(`[CloudSync] ✅ Hydrated ${count} records from Atlas`);

  } catch (err) {
    console.warn('[CloudSync] Hydration failed:', err);
  }
}

// ── CS — główny obiekt syncu ──────────────────────────────────────────────────

export const CS = {

  // ── Workouty ────────────────────────────────────────────────────────────────

  async saveWorkout(workout: Record<string, unknown>): Promise<string> {
    const id = await saveWorkoutToDB(workout);
    const userId = getUserId();
    void apiPost('/workouts', {
      ...workout,
      workoutId: workout.id ?? workout.workoutId ?? id,
      userId,
    });
    return id;
  },

  async deleteWorkout(id: string): Promise<void> {
    await deleteWorkoutFromDB(id);
    const userId = getUserId();
    void apiDelete(`/workouts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
  },

  // ── Activities (GPS tracked) ─────────────────────────────────────────────────

  async saveActivity(activity: ActivityRecord): Promise<string> {
    const id = await saveActivity(activity);
    const userId = getUserId();
    void apiPost('/activities', {
      ...activity,
      activityId: activity.id,
      userId,
    });
    return id;
  },

  async deleteActivity(id: string): Promise<void> {
    await deleteActivity(id);
    const userId = getUserId();
    void apiDelete(`/activities/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
  },

  // ── EnrichedActivities (Home feed) ───────────────────────────────────────────

  async saveEnrichedActivity(activity: EnrichedActivity): Promise<string> {
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
      photoUrl:      uploaded?.url      ?? activity.photoUrl,
      photoPublicId: uploaded?.publicId ?? null,
    });
    return id;
  },

  async deleteEnrichedActivity(id: string): Promise<void> {
    // Pobierz publicId przed usunięciem
    const activities = await loadEnrichedActivities();
    const activity = activities.find(a => a.id === id);
    const publicId = (activity as unknown as Record<string, unknown>)?.photoPublicId as string | null;
    await deleteEnrichedActivity(id);
    const userId = getUserId();
    void apiDelete(`/enriched-activities/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
    // Usuń zdjęcie z Cloudinary
    if (publicId) void deleteFromCloudinary(publicId);
  },

  // ── UnifiedWorkouts (Stats) ──────────────────────────────────────────────────

  async saveUnifiedWorkout(workout: UnifiedWorkout): Promise<void> {
    await saveUnifiedWorkout(workout);
    const userId = getUserId();
    void apiPost('/unified-workouts', {
      ...workout,
      workoutId: workout.id,
      userId,
    });
  },

  async deleteUnifiedWorkout(id: string): Promise<void> {
    await deleteUnifiedWorkout(id);
    const userId = getUserId();
    void apiDelete(`/unified-workouts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
  },

  // ── Posts ────────────────────────────────────────────────────────────────────

  async savePost(post: PostRecord): Promise<void> {
    await savePost(post);
    const userId = getUserId();
    // Upload zdjęcia do Cloudinary — zamień base64 na URL w IndexedDB
    const uploaded = await uploadIfBase64(post.photoUrl, userId, 'posts');
    if (uploaded) {
      await savePost({ ...post, photoUrl: uploaded.url, photoPublicId: uploaded.publicId });
    }
    void apiPost('/posts', {
      ...post,
      postId:        post.id,
      userId,
      photoUrl:      uploaded?.url      ?? post.photoUrl,
      photoPublicId: uploaded?.publicId ?? null,
    });
  },

  async deletePost(id: string): Promise<void> {
    // Pobierz publicId przed usunięciem
    const posts = await loadPosts();
    const post = posts.find(p => p.id === id);
    const publicId = (post as unknown as Record<string, unknown>)?.photoPublicId as string | null;
    await deletePost(id);
    const userId = getUserId();
    void apiDelete(`/posts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
    // Usuń zdjęcie z Cloudinary
    if (publicId) void deleteFromCloudinary(publicId);
  },

  // ── Profile ──────────────────────────────────────────────────────────────────

  async saveProfile(profile: ProfileRecord): Promise<void> {
    await saveProfileToDB(profile);
    const userId = getUserId();
    // Upload avatara do Cloudinary przed zapisem do Atlas
    const uploaded = await uploadIfBase64(profile.avatarB64, userId, 'avatars',
      `mapyou/avatars/${userId}/avatar`);
    void apiPost('/users', {
      ...profile,
      userId,
      avatarB64: uploaded?.url ?? profile.avatarB64,
    });
  },

  // ── Hydratacja przy starcie ───────────────────────────────────────────────────

  hydrate,
};
