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
  saveReel,
  loadReels,
  deleteReel,
  cleanupExpiredReelsLocal,
  saveProfileToDB,
  loadProfileFromDB,
  type WorkoutRecord,
  type EnrichedActivity,
  type UnifiedWorkout,
  type PostRecord,
  type ProfileRecord,
  type ReelRecord,
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


// ── Upload media (image or video) to Cloudinary via multipart ────────────────

interface UploadResult { url: string; publicId: string; mediaType: 'image' | 'video' }

/**
 * Upload a File/Blob to /upload/media using multipart/form-data.
 * Works for both images and videos.
 */
export async function uploadMediaFile(
  file:           File | Blob,
  userId:         string,
  folder:         'activities' | 'posts' | 'avatars',
  fixedPublicId?: string,
  onProgress?:    (pct: number, phase: 'uploading' | 'compressing') => void,
): Promise<UploadResult | null> {
  if (!file || !userId) return null;

  const form = new FormData();
  form.append('file',   file, (file as File).name ?? 'upload');
  form.append('userId', userId);
  form.append('folder', folder);
  if (fixedPublicId) form.append('publicId', fixedPublicId);

  return new Promise(resolve => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BACKEND_URL}/upload/media`);
    xhr.timeout = 300_000; // 5 min

    // Upload progress (0–100% = sending bytes to server)
    xhr.upload.addEventListener('progress', e => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round(e.loaded / e.total * 100), 'uploading');
      }
    });

    // Upload done — now server is compressing
    xhr.upload.addEventListener('load', () => {
      if (onProgress) onProgress(100, 'compressing');
    });

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText) as {
          status: string; url: string; publicId: string; mediaType: 'image' | 'video';
        };
        resolve(data.status === 'ok'
          ? { url: data.url, publicId: data.publicId, mediaType: data.mediaType }
          : null);
      } catch { resolve(null); }
    });

    xhr.addEventListener('error',   () => resolve(null));
    xhr.addEventListener('timeout', () => resolve(null));
    xhr.send(form);
  });
}

/**
 * Backward-compat: upload base64 image (used for avatars and minimaps only).
 * New code should use uploadMediaFile instead.
 */
async function uploadIfBase64(
  base64:    string | null | undefined,
  userId:    string,
  folder:    'activities' | 'posts' | 'avatars',
  fixedPublicId?: string,
): Promise<UploadResult | null> {
  if (!base64) return null;
  // If it's already a Cloudinary URL — nothing to upload
  if (base64.startsWith('http')) return null;
  if (!base64.startsWith('data:image/') && !base64.startsWith('data:video/')) return null;

  // Convert base64 to Blob then use multipart upload
  try {
    const [meta, b64] = base64.split(',');
    const mime        = meta.split(':')[1].split(';')[0];
    const binary      = atob(b64);
    const bytes       = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    return await uploadMediaFile(blob, userId, folder, fixedPublicId);
  } catch {
    return null;
  }
}

async function deleteFromCloudinary(publicId: string, isVideo = false): Promise<void> {
  if (!isOnline()) return;
  try {
    await fetch(`${BACKEND_URL}/upload/media`, {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ publicId, isVideo }),
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




// ── Encoded Polyline (Google format) ─────────────────────────────────────────

function encodePolyline(coords: Array<[number, number]>): string {
  let result = '';
  let prevLat = 0, prevLon = 0;
  // Sample max 200 points
  const step = Math.max(1, Math.floor(coords.length / 200));
  const pts = coords.filter((_, i) => i % step === 0);
  for (const [lat, lon] of pts) {
    const encodeVal = (val: number) => {
      let v = Math.round(val * 1e5);
      v = v < 0 ? ~(v << 1) : v << 1;
      let str = '';
      while (v >= 0x20) { str += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      str += String.fromCharCode(v + 63);
      return str;
    };
    result += encodeVal(lat - prevLat) + encodeVal(lon - prevLon);
    prevLat = lat; prevLon = lon;
  }
  return result;
}

function decodePolyline(encoded: string): Array<[number, number]> {
  const coords: Array<[number, number]> = [];
  let lat = 0, lon = 0, i = 0;
  while (i < encoded.length) {
    const decode = () => {
      let b, shift = 0, result = 0;
      do { b = encoded.charCodeAt(i++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    lat += decode(); lon += decode();
    coords.push([lat / 1e5, lon / 1e5]);
  }
  return coords;
}

// ── Canvas minimap renderer ───────────────────────────────────────────────────

function renderMinimapCanvas(
  container: HTMLElement,
  coords:    Array<[number, number]>,
  sport:     string,
): void {
  if (!coords || coords.length === 0) return;

  // Read actual container dimensions — container must already be in DOM with CSS applied
  const dpr  = window.devicePixelRatio || 1;
  const rect = container.getBoundingClientRect();
  // CSS sets height:180px; width = card width minus margin 16px*2 = 32px
  // Fall back to offsetWidth/offsetHeight if getBoundingClientRect returns 0 (element hidden)
  const W = Math.round(rect.width  || container.offsetWidth  || 328);
  const H = Math.round(rect.height || container.offsetHeight || 180);

  const canvas  = document.createElement('canvas');
  // Render at physical pixel resolution (crisp on Retina/HiDPI)
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.cssText = 'width:100%;height:100%;border-radius:14px;display:block;position:absolute;top:0;left:0';
  container.style.position = 'relative';
  container.style.overflow = 'hidden';
  container.innerHTML = '';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(dpr, dpr); // all drawing in CSS pixels; canvas handles HiDPI internally

  const lats   = coords.map(p => p[0]);
  const lons   = coords.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const cLat   = (minLat + maxLat) / 2;
  const cLon   = (minLon + maxLon) / 2;

  // Standard Web Mercator helpers - fractional tile coords
  const latToTileY = (lat: number, z: number) => {
    const sin = Math.sin(lat * Math.PI / 180);
    return (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * Math.pow(2, z);
  };
  const lonToTileX = (lon: number, z: number) => (lon + 180) / 360 * Math.pow(2, z);

  // Pick zoom so route fits with 24px padding (mirrors fitBounds padding:[24,24])
  const PAD = 24;
  let zoom = 15;
  for (let z = 17; z >= 10; z--) {
    const spanX = (lonToTileX(maxLon, z) - lonToTileX(minLon, z)) * 256;
    const spanY = (latToTileY(minLat, z) - latToTileY(maxLat, z)) * 256;
    if (spanX <= W - PAD * 2 && spanY <= H - PAD * 2) { zoom = z; break; }
  }

  // Fractional tile position of map centre
  const cTx = lonToTileX(cLon, zoom);
  const cTy = latToTileY(cLat, zoom);

  // Convert lat/lon to canvas pixel, perfectly centred on (W/2, H/2)
  const toXY = (lat: number, lon: number) => ({
    x: (lonToTileX(lon, zoom) - cTx) * 256 + W / 2,
    y: (latToTileY(lat, zoom) - cTy) * 256 + H / 2,
  });

  // Tile grid covering canvas
  const tilesX   = Math.ceil(W / 256) + 2;
  const tilesY   = Math.ceil(H / 256) + 2;
  const originTx = Math.floor(cTx) - Math.floor(tilesX / 2);
  const originTy = Math.floor(cTy) - Math.floor(tilesY / 2);

  // Fallback background — visible while tiles load or if they fail
  ctx.fillStyle = '#f2efe9';
  ctx.fillRect(0, 0, W, H);

  // Load HOT OSM tiles — same provider as StatsView detail map
  // https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png
  const SUBS = ['a', 'b', 'c'];
  const tilePromises: Promise<void>[] = [];
  for (let dx = 0; dx < tilesX; dx++) {
    for (let dy = 0; dy < tilesY; dy++) {
      const tx = originTx + dx;
      const ty = originTy + dy;
      // Pixel position of this tile on canvas, anchored to fractional centre cTx/cTy
      const px = (tx - cTx) * 256 + W / 2;
      const py = (ty - cTy) * 256 + H / 2;
      const sub = SUBS[(tx + ty) % 3];
      const url = `https://${sub}.tile.openstreetmap.fr/hot/${zoom}/${tx}/${ty}.png`;
      tilePromises.push(new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload  = () => { ctx.drawImage(img, Math.round(px), Math.round(py), 256, 256); resolve(); };
        img.onerror = () => resolve();
        img.src     = url;
        setTimeout(resolve, 5000);
      }));
    }
  }

  Promise.all(tilePromises).then(() => {
    // Sport colors — identical to StatsView
    const color = sport === 'cycling' ? '#ffb545' : sport === 'walking' ? '#5badea' : '#00c46a';

    if (coords.length === 1) {
      // Single point — teardrop pin matching StatsView SVG (iconAnchor bottom = tip of pin)
      const { x, y } = toXY(coords[0][0], coords[0][1]);
      const R  = 12;          // circle radius
      const TH = R * 1.6;     // tail height below circle centre
      // Pin total height = R (top of circle) + R (centre→bottom of circle) + TH (tail)
      // Anchor = tip of tail = y coordinate. So circle centre = y - TH - R
      const cy = y - TH - R;
      // Draw teardrop body — circle top half, curve to tip, back up
      ctx.beginPath();
      ctx.arc(x, cy, R, Math.PI, 0);                          // top semicircle
      ctx.quadraticCurveTo(x + R, cy + R, x, cy + R + TH);   // right → tip
      ctx.quadraticCurveTo(x - R, cy + R, x - R, cy);        // tip → left
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      // Inner white dot (matches StatsView <circle cx=12 cy=12 r=5 fill=white/>)
      ctx.beginPath();
      ctx.arc(x, cy, R * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
    } else {
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
      ctx.lineWidth   = 4;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Start circleMarker — radius 6, fillColor=color, white border weight 2
      const ps = toXY(coords[0][0], coords[0][1]);
      ctx.beginPath();
      ctx.arc(ps.x, ps.y, 6, 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();

      // End circleMarker — radius 6, fillColor=#e74c3c, white border weight 2
      const pe = toXY(coords[coords.length - 1][0], coords[coords.length - 1][1]);
      ctx.beginPath();
      ctx.arc(pe.x, pe.y, 6, 0, Math.PI * 2);
      ctx.fillStyle   = '#e74c3c';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth   = 2;
      ctx.stroke();
    }
  });
}

export { renderMinimapCanvas, encodePolyline, decodePolyline };

export async function pushNow(
  userId:     string,
  enriched:   EnrichedActivity[],
  unified:    UnifiedWorkout[],
  posts:      PostRecord[],
): Promise<void> {
  if (!isOnline() || !userId) return;

  try {
    // Pobierz co już jest w Atlas
    const [atlasEnriched, atlasUnified, atlasPosts] = await Promise.all([
      apiGet<{ activityId: string; photoUrl: string | null; coordsEnc: string | null }>(`/enriched-activities?userId=${encodeURIComponent(userId)}`),
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
        const coordsEnc = toSave.coords && (toSave.coords as unknown[]).length > 0
          ? encodePolyline(toSave.coords as Array<[number, number]>)
          : null;
        await apiPost('/enriched-activities', { ...toSave, userId, activityId: toSave.id, coordsEnc, coords: [] });
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

// Napraw brakujące coordsEnc w Atlas dla starych aktywności
    const atlasMissingCoordsEnc = (atlasEnriched ?? []).filter(a => !a.coordsEnc);
    const atlasMissingIds = new Set(atlasMissingCoordsEnc.map(a => a.activityId));
    const enrichedToEncode = enriched.filter(a =>
      atlasMissingIds.has(a.id) && a.coords && a.coords.length > 0
    );
    for (const activity of enrichedToEncode) {
      try {
        const coordsEnc = encodePolyline(activity.coords as Array<[number, number]>);
        await apiPost(`/enriched-activities/${encodeURIComponent(activity.id)}/photo`, {
          userId, coordsEnc,
        });
        console.log(`[CloudSync] 📍 Fixed coordsEnc for: ${activity.name}`);
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
    void pushNow(userId, enriched, unified, posts);
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
          // Decode coordsEnc back to coords array
          const coordsEnc = raw.coordsEnc as string | null | undefined;
          const coords = coordsEnc ? decodePolyline(coordsEnc) : (raw.coords as Array<[number,number]> ?? []);
          await saveEnrichedActivity({ ...e, id, coords } as EnrichedActivity);
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

// ── Upload reelsa do Cloudinary i zapis w Atlas ──────────────────────────────

export async function uploadReel(
  file: File | Blob,
  userId: string,
  meta: {
    caption?:      string | null;
    captionX?:     number;
    captionY?:     number;
    captionSize?:  number;
    captionColor?: string;
    duration?:     number;
  } = {},
): Promise<ReelRecord | null> {
  if (!file || !userId) return null;
  try {
    const up = await uploadMediaFile(file as File, userId, 'activities');
    if (!up) return null;

    const reelId    = `reel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const now       = Date.now();
    const expiresAt = now + 24 * 60 * 60 * 1000;

    const reel: ReelRecord = {
      id:           reelId,
      userId,
      authorName:   localStorage.getItem('mapyou_userName') ?? 'Athlete',
      avatarB64:    localStorage.getItem('mapyou_avatar') ?? null,
      mediaUrl:     up.url,
      mediaType:    up.mediaType,
      publicId:     up.publicId,
      caption:      meta.caption ?? null,
      captionX:     meta.captionX ?? 50,
      captionY:     meta.captionY ?? 80,
      captionSize:  meta.captionSize ?? 20,
      captionColor: meta.captionColor ?? '#ffffff',
      duration:     meta.duration ?? 5,
      views:        [],
      likes:        [],
      createdAt:    now,
      expiresAt,
    };

    await saveReel(reel);

    if (isOnline()) {
      await fetch(`${BACKEND_URL}/reels`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          reelId: reel.id, userId: reel.userId,
          authorName: reel.authorName, avatarB64: null,
          mediaUrl: reel.mediaUrl, mediaType: reel.mediaType,
          publicId: reel.publicId, caption: reel.caption,
          captionX: reel.captionX, captionY: reel.captionY,
          captionSize: reel.captionSize, captionColor: reel.captionColor,
          duration: reel.duration,
        }),
        signal: AbortSignal.timeout(10_000),
      });
    }
    return reel;
  } catch (err) {
    console.error('[CS] uploadReel error:', err);
    return null;
  }
}

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
    // Encode coords as Encoded Polyline before sending to Atlas
    const coordsEnc = activity.coords && activity.coords.length > 0
      ? encodePolyline(activity.coords as Array<[number, number]>)
      : null;
    void apiPost('/enriched-activities', {
      ...activity,
      activityId: activity.id,
      userId,
      coordsEnc,
      coords:        [],   // never store raw coords in Atlas
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
    const userId = getUserId();
    // Upload zdjęcia do Cloudinary — zamień base64 na URL w IndexedDB
    const uploaded = await uploadIfBase64(post.photoUrl, userId, 'posts');
    const finalPost = uploaded
      ? { ...post, photoUrl: uploaded.url, photoPublicId: uploaded.publicId }
      : post;
    await savePost(finalPost);

    // Club-only posts — skip home feed, send only club IDs
    const isClubOnly = finalPost.clubIds && finalPost.clubIds.length > 0 && finalPost.addToHome === false;
    if (!isClubOnly) {
      // Normal post — goes to home feed
      void apiPost('/posts', {
        ...finalPost,
        postId:        finalPost.id,
        userId,
        photoUrl:      finalPost.photoUrl,
        photoPublicId: uploaded?.publicId ?? null,
      });
    } else {
      // Club-only — still save to backend posts collection (for club feed queries) but skip home
      void apiPost('/posts', {
        ...finalPost,
        postId:        finalPost.id,
        userId,
        photoUrl:      finalPost.photoUrl,
        photoPublicId: uploaded?.publicId ?? null,
        clubOnly:      true,
      });
    }
  },

  async deleteReel(id: string): Promise<void> {
    const reels = await loadReels();
    const reel  = reels.find(r => r.id === id);
    await deleteReel(id);
    if (reel && isOnline()) {
      const userId = getUserId();
      fetch(`${BACKEND_URL}/reels/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`, {
        method: 'DELETE' }).catch(() => {});
    }
  },

  async markReelViewed(reelId: string): Promise<void> {
    const userId = getUserId();
    if (!userId || !isOnline()) return;
    fetch(`${BACKEND_URL}/reels/${encodeURIComponent(reelId)}/view`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    }).catch(() => {});
  },

  async likeReel(reelId: string): Promise<{ liked: boolean; count: number } | null> {
    const userId = getUserId();
    if (!userId || !isOnline()) return null;
    try {
      const res = await fetch(`${BACKEND_URL}/reels/${encodeURIComponent(reelId)}/like`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });
      return await res.json() as { liked: boolean; count: number };
    } catch { return null; }
  },

  async fetchFeedReels(): Promise<{ userId: string; authorName: string; avatarB64: string | null; reels: ReelRecord[]; hasUnseen: boolean }[]> {
    const userId = getUserId();
    if (!userId || !isOnline()) return [];
    try {
      const res  = await fetch(`${BACKEND_URL}/reels/feed?userId=${encodeURIComponent(userId)}`, {
        cache: 'no-store', signal: AbortSignal.timeout(10_000),
      });
      const data = await res.json() as { status: string; data: { userId: string; authorName: string; avatarB64: string | null; reels: Record<string,unknown>[]; hasUnseen: boolean }[] };
      if (data.status !== 'ok') return [];
      return data.data.map(u => ({
        ...u,
        reels: u.reels.map((r) => ({
          id:           r['reelId'] as string,
          userId:       u.userId,
          authorName:   u.authorName,
          avatarB64:    u.avatarB64,
          mediaUrl:     r['mediaUrl'] as string,
          mediaType:    r['mediaType'] as 'image' | 'video',
          publicId:     '',
          caption:      r['caption'] as string | null,
          captionX:     r['captionX'] as number,
          captionY:     r['captionY'] as number,
          captionSize:  r['captionSize'] as number,
          captionColor: r['captionColor'] as string,
          duration:     r['duration'] as number,
          views:        r['views'] as string[],
          likes:        r['likes'] as string[],
          createdAt:    new Date(r['createdAt'] as string).getTime(),
          expiresAt:    new Date(r['expiresAt'] as string).getTime(),
        })),
      }));
    } catch { return []; }
  },

  async deletePost(id: string): Promise<void> {
    // Pobierz publicId i mediaType przed usunięciem
    const posts    = await loadPosts();
    const post     = posts.find(p => p.id === id);
    const publicId = post?.photoPublicId ?? null;
    const isVideo  = post?.mediaType === 'video';
    await deletePost(id);
    const userId = getUserId();
    await apiDelete(`/posts/${encodeURIComponent(id)}?userId=${encodeURIComponent(userId)}`);
    // Usuń media z Cloudinary (image lub video)
    if (publicId) void deleteFromCloudinary(publicId, isVideo);
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