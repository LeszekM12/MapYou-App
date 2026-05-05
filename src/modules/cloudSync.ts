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
      cache: 'no-store',
    });
    if (!res.ok || res.status === 304) return null;
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


// ── Push lokalnych danych których brakuje w Atlas ────────────────────────────
// Odpala się przy każdym starcie — naprawia braki bez ręcznego sync

// ── Generate minimap and upload to Cloudinary ────────────────────────────────
// Renders Leaflet map on hidden canvas, exports PNG, uploads to Cloudinary
async function generateAndUploadMinimap(
  activity: EnrichedActivity,
  userId:   string,
): Promise<string | null> {
  if (!activity.coords || activity.coords.length === 0) return null;
  if (!isOnline()) return null;

  return new Promise<string | null>((resolve) => {
    // Create hidden container
    const container = document.createElement('div');
    container.style.cssText = 'width:400px;height:200px;position:fixed;left:-9999px;top:-9999px;z-index:-1';
    document.body.appendChild(container);

    declare const L: any; // Leaflet loaded globally
    const coords   = activity.coords as Array<[number, number]>;
    const color    = activity.sport === 'cycling' ? '#ffb545' : activity.sport === 'walking' ? '#5badea' : '#00c46a';

    const map = L.map(container, {
      zoomControl: false, dragging: false, touchZoom: false,
      scrollWheelZoom: false, doubleClickZoom: false,
      boxZoom: false, keyboard: false, attributionControl: false,
    });

    // Use Mapbox tiles (no CORS issues)
    L.tileLayer(
      `https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=pk.eyJ1IjoibGVzemVrLW1pa3J1dCIsImEiOiJjbW8ybm5jZ3IwYmZjMnFxd3VycjBtaHZ4In0.mpY8zJ-aEW8n5iZhf2GrWA`,
      { tileSize: 512, zoomOffset: -1 }
    ).addTo(map);

    if (coords.length === 1) {
      const [lat, lng] = coords[0];
      map.setView([lat, lng], 15);
      L.circleMarker([lat, lng], { radius: 8, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(map);
    } else {
      const line = L.polyline(coords.map(c => L.latLng(c[0], c[1])), { color, weight: 4, opacity: 0.95 }).addTo(map);
      map.fitBounds(line.getBounds(), { padding: [16, 16] });
      const first = coords[0];
      const last  = coords[coords.length - 1];
      L.circleMarker([first[0], first[1]], { radius: 6, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(map);
      L.circleMarker([last[0],  last[1]],  { radius: 6, color: '#fff', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).addTo(map);
    }

    // Wait for tiles to load then screenshot
    const timeout = setTimeout(() => {
      cleanup();
      resolve(null);
    }, 8000);

    map.once('idle', async () => {
      clearTimeout(timeout);
      try {
        // Use html2canvas to capture the map
        const canvas = await (window as Window & { html2canvas?: (el: HTMLElement, opts: Record<string,unknown>) => Promise<HTMLCanvasElement> }).html2canvas?.(container, {
          useCORS: true, allowTaint: false, scale: 1,
          width: 400, height: 200, logging: false,
        });
        if (!canvas) { cleanup(); resolve(null); return; }
        const base64 = canvas.toDataURL('image/jpeg', 0.85);
        const uploaded = await uploadIfBase64(base64, userId, 'activities', `minimaps/${userId}/${activity.id}`);
        cleanup();
        resolve(uploaded?.url ?? null);
      } catch {
        cleanup();
        resolve(null);
      }
    });

    function cleanup() {
      try { map.remove(); } catch {}
      container.remove();
    }
  });
}

async function _pushMissingToAtlas(
  userId:     string,
  enriched:   EnrichedActivity[],
  unified:    UnifiedWorkout[],
  posts:      PostRecord[],
): Promise<void> {
  if (!isOnline() || !userId) return;

  try {
    // Pobierz co już jest w Atlas
    const [atlasEnriched, atlasUnified, atlasPosts] = await Promise.all([
      apiGet<{ activityId: string; photoUrl: string | null }>(`/enriched-activities?userId=${encodeURIComponent(userId)}`),
      apiGet<{ workoutId: string }>(`/unified-workouts?userId=${encodeURIComponent(userId)}`),
      apiGet<{ postId: string; photoUrl: string | null }>(`/posts?userId=${encodeURIComponent(userId)}`),
    ]);

    const atlasEnrichedIds  = new Set((atlasEnriched ?? []).map(a => a.activityId));
    const atlasUnifiedIds   = new Set((atlasUnified ?? []).map(w => w.workoutId));
    const atlasPostIds      = new Set((atlasPosts ?? []).map(p => p.postId));
    // Mapa aktywności w Atlas z null photoUrl
    const atlasNullPhotoIds = new Set((atlasEnriched ?? []).filter(a => !a.photoUrl).map(a => a.activityId));
    const atlasNullPostIds  = new Set((atlasPosts ?? []).filter(p => !p.photoUrl).map(p => p.postId));

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
      } catch {}
    }

    // Napraw istniejące rekordy w Atlas z photoUrl: null
    // Obsługuje zarówno base64 jak i URL Cloudinary w IndexedDB
    const enrichedToFix = enriched.filter(a =>
      atlasNullPhotoIds.has(a.id) && a.photoUrl && a.photoUrl.length > 0
    );
    for (const activity of enrichedToFix) {
      try {
        let finalUrl = activity.photoUrl!;
        let publicId = activity.photoPublicId ?? null;
        // Jeśli base64 — uploaduj do Cloudinary
        if (finalUrl.startsWith('data:')) {
          const uploaded = await uploadIfBase64(finalUrl, userId, 'activities', `activities/${userId}/${activity.id}`);
          if (!uploaded) continue;
          finalUrl = uploaded.url;
          publicId = uploaded.publicId;
          await saveEnrichedActivity({ ...activity, photoUrl: finalUrl, photoPublicId: publicId });
        }
        // Zaktualizuj Atlas
        await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, {
          userId, photoUrl: finalUrl, photoPublicId: publicId,
        });
        console.log(`[CloudSync] 🖼️ Fixed photo for activity: ${activity.id} → ${finalUrl.substring(0, 50)}`);
      } catch {}
    }

    // Napraw posty z photoUrl: null w Atlas
    const postsToFix = posts.filter(p =>
      atlasNullPostIds.has(p.id) && p.photoUrl && p.photoUrl.length > 0
    );
    for (const post of postsToFix) {
      try {
        let finalUrl = post.photoUrl!;
        let publicId = post.photoPublicId ?? null;
        if (finalUrl.startsWith('data:')) {
          const uploaded = await uploadIfBase64(finalUrl, userId, 'posts', `posts/${userId}/${post.id}`);
          if (!uploaded) continue;
          finalUrl = uploaded.url;
          publicId = uploaded.publicId;
          await savePost({ ...post, photoUrl: finalUrl, photoPublicId: publicId });
        }
        await apiPost(`/posts/${encodeURIComponent(post.id)}/photo`, {
          userId, photoUrl: finalUrl, photoPublicId: publicId,
        });
        console.log(`[CloudSync] 🖼️ Fixed photo for post: ${post.id} → ${finalUrl.substring(0, 50)}`);
      } catch {}
    }

    // Push brakujących unified workouts
    const missingUnified = unified.filter(w => !atlasUnifiedIds.has(w.id));
    for (const workout of missingUnified) {
      try {
        await apiPost('/unified-workouts', { ...workout, userId, workoutId: workout.id });
        console.log(`[CloudSync] 📤 Pushed missing workout: ${workout.id}`);
      } catch {}
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
      } catch {}
    }

    // Napraw brakujące minimapUrl — generuj miniaturę i uploaduj do Cloudinary
    const enrichedMissingMinimap = enriched.filter(a =>
      atlasEnrichedIds.has(a.id) &&
      a.coords && a.coords.length > 0 &&
      (!a.minimapUrl || a.minimapUrl.includes('api.mapbox.com'))
    );
    for (const activity of enrichedMissingMinimap) {
      try {
        const minimapUrl = await generateAndUploadMinimap(activity, userId);
        if (minimapUrl) {
          await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, { userId, minimapUrl });
          await saveEnrichedActivity({ ...activity, minimapUrl } as EnrichedActivity);
          console.log(`[CloudSync] 🗺️ Uploaded minimap for: ${activity.name} → ${minimapUrl}`);
        }
      } catch {}
    }

    // Push stats (weeklyWins, bestStreak) — zawsze aktualizuj
    const weeklyWins = parseInt(localStorage.getItem('mapyou_weekly_wins') ?? '0', 10);
    const bestStreak = parseInt(localStorage.getItem('mapyou_best_streak') ?? '0', 10);
    if (weeklyWins > 0 || bestStreak > 0) {
      await apiPost('/users', { userId, weeklyWins, bestStreak }).catch(() => {});
    }

    if (missingEnriched.length + missingUnified.length + missingPosts.length > 0) {
      console.log(`[CloudSync] ✅ Pushed ${missingEnriched.length} activities, ${missingUnified.length} workouts, ${missingPosts.length} posts`);
    }
  } catch (err) {
    console.warn('[CloudSync] _pushMissingToAtlas error:', err);
  }
}





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
    // Ale zawsze sprawdź czy lokalne dane są w Atlas — push brakujących
    void _pushMissingToAtlas(userId, enriched, unified, posts);
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
    // Generate minimap and upload to Cloudinary
    if ((!activity.minimapUrl || activity.minimapUrl.includes('api.mapbox.com')) && activity.coords && activity.coords.length > 0) {
      void generateAndUploadMinimap(activity, getUserId()).then(async minimapUrl => {
        if (minimapUrl) {
          await saveEnrichedActivity({ ...activity, minimapUrl } as EnrichedActivity);
          await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, { userId: getUserId(), minimapUrl });
        }
      });
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
