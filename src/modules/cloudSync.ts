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

// ── Generate minimap PNG on canvas and upload to Cloudinary ──────────────────
// Fetches OSM tiles via backend proxy, draws GPS route, uploads to Cloudinary

function _latLonToTile(lat: number, lon: number, zoom: number): { tx: number; ty: number } {
  const n = Math.pow(2, zoom);
  const tx = Math.floor((lon + 180) / 360 * n);
  const ty = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  return { tx, ty };
}

function _tileToPixel(tx: number, ty: number, zoom: number, originTx: number, originTy: number): { px: number; py: number } {
  return { px: (tx - originTx) * 256, py: (ty - originTy) * 256 };
}

function _latLonToPixel(lat: number, lon: number, zoom: number, originTx: number, originTy: number): { px: number; py: number } {
  const n = Math.pow(2, zoom);
  const px = ((lon + 180) / 360 * n - originTx) * 256;
  const py = ((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n - originTy) * 256;
  return { px, py };
}

async function _loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src     = url;
    setTimeout(() => resolve(null), 5000);
  });
}

async function generateAndUploadMinimap(
  activity: EnrichedActivity,
  userId:   string,
): Promise<string | null> {
  const coords = activity.coords as Array<[number, number]>;
  if (!coords || coords.length === 0) return null;
  if (!isOnline()) return null;

  try {
    const W = 400, H = 200;
    const canvas  = document.createElement('canvas');
    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;

    // Calculate bounds
    const lats   = coords.map(p => p[0]);
    const lons   = coords.map(p => p[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLon = Math.min(...lons), maxLon = Math.max(...lons);
    const cLat   = (minLat + maxLat) / 2;
    const cLon   = (minLon + maxLon) / 2;

    // Choose zoom level
    const latSpan = maxLat - minLat || 0.001;
    const lonSpan = maxLon - minLon || 0.001;
    let zoom = 15;
    for (let z = 16; z >= 10; z--) {
      const n = Math.pow(2, z);
      const pxSpanLon = lonSpan / 360 * n * 256;
      const pxSpanLat = latSpan / 360 * n * 256;
      if (pxSpanLon < W * 0.7 && pxSpanLat < H * 0.7) { zoom = z; break; }
    }

    // Get origin tile
    const centerTile = _latLonToTile(cLat, cLon, zoom);
    const tilesX = Math.ceil(W / 256) + 1;
    const tilesY = Math.ceil(H / 256) + 1;
    const originTx = centerTile.tx - Math.floor(tilesX / 2);
    const originTy = centerTile.ty - Math.floor(tilesY / 2);

    // Draw tiles
    const tilePromises: Promise<void>[] = [];
    for (let dx = 0; dx < tilesX + 1; dx++) {
      for (let dy = 0; dy < tilesY + 1; dy++) {
        const tx = originTx + dx;
        const ty = originTy + dy;
        const px = dx * 256 - (centerTile.tx - originTx) * 256 + W / 2 - 128;
        const py = dy * 256 - (centerTile.ty - originTy) * 256 + H / 2 - 128;
        const url = `${BACKEND_URL}/upload/tile?z=${zoom}&x=${tx}&y=${ty}`;
        tilePromises.push(
          _loadImage(url).then(img => {
            if (img) ctx.drawImage(img, Math.round(px), Math.round(py), 256, 256);
          })
        );
      }
    }
    await Promise.all(tilePromises);

    // Fallback background if tiles failed
    const imgData = ctx.getImageData(0, 0, 1, 1);
    if (imgData.data[3] === 0) {
      ctx.fillStyle = '#e8e0d8';
      ctx.fillRect(0, 0, W, H);
    }

    // Convert coords to pixels
    const toP = (lat: number, lon: number) => {
      const p = _latLonToPixel(lat, lon, zoom, originTx, originTy);
      // Offset to center
      const offX = W / 2 - (centerTile.tx - originTx + 0.5) * 256;
      const offY = H / 2 - (centerTile.ty - originTy + 0.5) * 256;
      return { x: p.px + offX + 128, y: p.py + offY + 128 };
    };

    const color = activity.sport === 'cycling' ? '#ffb545'
      : activity.sport === 'walking'  ? '#5badea'
        : '#00c46a';

    if (coords.length === 1) {
      const { x, y } = toP(coords[0][0], coords[0][1]);
      // Draw pin SVG-style
      ctx.beginPath();
      ctx.arc(x, y - 8, 10, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      // Pin tip
      ctx.beginPath();
      ctx.moveTo(x - 6, y - 4);
      ctx.lineTo(x, y + 4);
      ctx.lineTo(x + 6, y - 4);
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      // Draw route
      ctx.beginPath();
      const p0 = toP(coords[0][0], coords[0][1]);
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i < coords.length; i++) {
        const p = toP(coords[i][0], coords[i][1]);
        ctx.lineTo(p.x, p.y);
      }
      ctx.strokeStyle = color;
      ctx.lineWidth   = 3;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();

      // Start pin
      const ps = toP(coords[0][0], coords[0][1]);
      ctx.beginPath();
      ctx.arc(ps.x, ps.y - 6, 7, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(ps.x - 4, ps.y - 1);
      ctx.lineTo(ps.x, ps.y + 5);
      ctx.lineTo(ps.x + 4, ps.y - 1);
      ctx.fillStyle = color;
      ctx.fill();

      // End dot
      const pe = toP(coords[coords.length-1][0], coords[coords.length-1][1]);
      ctx.beginPath();
      ctx.arc(pe.x, pe.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#e74c3c';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const base64 = canvas.toDataURL('image/jpeg', 0.85);
    const uploaded = await uploadIfBase64(base64, userId, 'activities', `minimaps/${userId}/${activity.id}`);
    return uploaded?.url ?? null;
  } catch (err) {
    console.warn('[CloudSync] generateAndUploadMinimap error:', err);
    return null;
  }
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

    // Generuj minimapUrl dla aktywności które go nie mają lub mają stary URL
    const enrichedMissingMinimap = enriched.filter(a =>
      atlasEnrichedIds.has(a.id) &&
      a.coords && a.coords.length > 0 &&
      (!a.minimapUrl || a.minimapUrl.includes('staticmap.openstreetmap') || a.minimapUrl.includes('api.mapbox.com'))
    );
    for (const activity of enrichedMissingMinimap) {
      try {
        const minimapUrl = await generateAndUploadMinimap(activity, userId);
        if (minimapUrl) {
          await saveEnrichedActivity({ ...activity, minimapUrl });
          await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, { userId, minimapUrl });
          console.log(`[CloudSync] 🗺️ Minimap: ${activity.name} → ${minimapUrl.substring(0, 60)}`);
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
    const id = await saveEnrichedActivity(activity);
    // Generate minimap async — don't block save
    if (!activity.minimapUrl && activity.coords && activity.coords.length > 0) {
      void generateAndUploadMinimap(activity, getUserId()).then(async minimapUrl => {
        if (minimapUrl) {
          await saveEnrichedActivity({ ...activity, minimapUrl });
          await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, {
            userId: getUserId(), minimapUrl,
          });
          console.log(`[CloudSync] 🗺️ Minimap uploaded: ${minimapUrl.substring(0, 60)}`);
        }
      });
    }
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