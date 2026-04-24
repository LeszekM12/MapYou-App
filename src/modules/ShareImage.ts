// ─── SHARE IMAGE ─────────────────────────────────────────────────────────────
// src/modules/ShareImage.ts
//
// Generates a beautiful share image (canvas → PNG download) from an
// EnrichedActivity. Reuses all OSM-tile-rendering logic from ActivityView.ts.
// Adds photo support if the activity has one.

import type { EnrichedActivity } from './db.js';
import { SPORT_COLORS, SPORT_ICONS, formatDuration, formatPace, formatDistance } from './Tracker.js';
import type { SportType } from './Tracker.js';

// ── OSM tile helpers (copied from ActivityView.ts) ────────────────────────────

function _lngToTileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
}
function _latToTileY(lat: number, zoom: number): number {
  const r = Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * Math.pow(2, zoom),
  );
}
function _latLngToPixel(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const n = Math.pow(2, zoom);
  const x = ((lng + 180) / 360) * n * 256;
  const r = Math.PI / 180;
  const y = (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * n * 256;
  return { x, y };
}
async function _loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload  = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

async function _drawMapTiles(
  ctx: CanvasRenderingContext2D,
  coords: [number, number][],
  canvasX: number, canvasY: number,
  canvasW: number, canvasH: number,
): Promise<{ toCanvasX: (lng: number) => number; toCanvasY: (lat: number) => number } | null> {
  if (!coords.length) return null;

  const lats = coords.map(c => c[0]);
  const lngs = coords.map(c => c[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  let zoom = 14;
  for (let z = 16; z >= 8; z--) {
    const txa = _lngToTileX(minLng, z), txb = _lngToTileX(maxLng, z);
    const tya = _latToTileY(maxLat, z), tyb = _latToTileY(minLat, z);
    if ((txb - txa + 1) <= 6 && (tyb - tya + 1) <= 6) { zoom = z; break; }
    if (z === 8) zoom = 8;
  }

  const pad  = 1;
  const txMin = _lngToTileX(minLng, zoom) - pad;
  const txMax = _lngToTileX(maxLng, zoom) + pad;
  const tyMin = _latToTileY(maxLat, zoom) - pad;
  const tyMax = _latToTileY(minLat, zoom) + pad;

  const gridPixelX0 = txMin * 256;
  const gridPixelY0 = tyMin * 256;

  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  const centre = _latLngToPixel(cLat, cLng, zoom);
  const srcX = centre.x - canvasW / 2;
  const srcY = centre.y - canvasH / 2;

  const tmpW = (txMax - txMin + 1) * 256;
  const tmpH = (tyMax - tyMin + 1) * 256;
  const tmp  = document.createElement('canvas');
  tmp.width  = tmpW; tmp.height = tmpH;
  const tctx = tmp.getContext('2d')!;

  const subs = ['a','b','c'];
  await Promise.all(
    Array.from({ length: (txMax - txMin + 1) * (tyMax - tyMin + 1) }, (_, idx) => {
      const tx = txMin + Math.floor(idx / (tyMax - tyMin + 1));
      const ty = tyMin + (idx % (tyMax - tyMin + 1));
      const sub = subs[(tx + ty) % 3];
      const url = `https://${sub}.tile.openstreetmap.fr/hot/${zoom}/${tx}/${ty}.png`;
      return _loadImage(url).then(img => {
        if (img) tctx.drawImage(img, (tx - txMin) * 256, (ty - tyMin) * 256, 256, 256);
      });
    }),
  );

  ctx.save();
  ctx.beginPath();
  const rctx = ctx as CanvasRenderingContext2D & { roundRect?(x:number,y:number,w:number,h:number,r:number): void };
  if (rctx.roundRect) rctx.roundRect(canvasX, canvasY, canvasW, canvasH, 20);
  else ctx.rect(canvasX, canvasY, canvasW, canvasH);
  ctx.clip();
  ctx.drawImage(tmp, srcX - gridPixelX0, srcY - gridPixelY0, canvasW, canvasH, canvasX, canvasY, canvasW, canvasH);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(canvasX, canvasY, canvasW, canvasH);
  ctx.restore();

  return {
    toCanvasX: (lng: number) => canvasX + (_latLngToPixel(0, lng, zoom).x - srcX),
    toCanvasY: (lat: number) => canvasY + (_latLngToPixel(lat, 0, zoom).y - srcY),
  };
}

function _drawRouteFallback(
  ctx: CanvasRenderingContext2D,
  coords: [number, number][],
  color: string,
  mapX: number, mapY: number, mapW: number, mapH: number,
): void {
  const lats = coords.map(c => c[0]);
  const lngs = coords.map(c => c[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad = 40;
  const scaleX = (mapW - pad * 2) / (maxLng - minLng || 0.001);
  const scaleY = (mapH - pad * 2) / (maxLat - minLat || 0.001);
  const scale  = Math.min(scaleX, scaleY);
  const offX   = mapX + pad + ((mapW - pad * 2) - (maxLng - minLng) * scale) / 2;
  const offY   = mapY + pad + ((mapH - pad * 2) - (maxLat - minLat) * scale) / 2;
  const toX = (lng: number) => offX + (lng - minLng) * scale;
  const toY = (lat: number) => offY + (mapH - pad * 2) - (lat - minLat) * scale;

  ctx.shadowColor = color; ctx.shadowBlur = 12;
  ctx.strokeStyle = color; ctx.lineWidth = 4;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  ctx.beginPath();
  coords.forEach((c, i) => i === 0 ? ctx.moveTo(toX(c[1]), toY(c[0])) : ctx.lineTo(toX(c[1]), toY(c[0])));
  ctx.stroke(); ctx.shadowBlur = 0;

  const s0 = coords[0], s1 = coords[coords.length - 1];
  ctx.fillStyle = '#00c46a';
  ctx.beginPath(); ctx.arc(toX(s0[1]), toY(s0[0]), 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath(); ctx.arc(toX(s1[1]), toY(s1[0]), 8, 0, Math.PI * 2); ctx.fill();
}

// ── Rounded rect helper ───────────────────────────────────────────────────────

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rctx = ctx as CanvasRenderingContext2D & { roundRect?(x:number,y:number,w:number,h:number,r:number): void };
  ctx.beginPath();
  if (rctx.roundRect) rctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function generateShareImageFromEnriched(act: EnrichedActivity): Promise<void> {
  const color = SPORT_COLORS[act.sport as SportType] ?? '#00c46a';
  const icon  = SPORT_ICONS[act.sport as SportType]  ?? '🏅';

  const hasPhoto = !!act.photoUrl;
  const canvasH  = hasPhoto ? 1200 : 1000;

  const canvas  = document.createElement('canvas');
  canvas.width  = 800;
  canvas.height = canvasH;
  const ctx     = canvas.getContext('2d')!;

  // ── Background ──────────────────────────────────────────────────────────────
  ctx.fillStyle = '#171c20';
  ctx.fillRect(0, 0, 800, canvasH);

  // Gradient mesh background
  const mesh = ctx.createRadialGradient(400, 0, 0, 400, 0, 600);
  mesh.addColorStop(0, color + '18');
  mesh.addColorStop(1, 'transparent');
  ctx.fillStyle = mesh;
  ctx.fillRect(0, 0, 800, canvasH);

  // ── Top accent bar ──────────────────────────────────────────────────────────
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 800, 5);

  // ── Header ──────────────────────────────────────────────────────────────────
  // Sport badge
  roundRect(ctx, 40, 24, 60, 60, 16);
  ctx.fillStyle = color + '22';
  ctx.fill();
  ctx.font = '32px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(icon, 70, 63);
  ctx.textAlign = 'left';

  // Activity name
  ctx.font = 'bold 26px Manrope, system-ui, sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(act.name || act.description, 116, 48, 644);

  // Description (if different from name)
  if (act.description && act.name && act.description !== act.name) {
    ctx.font = '16px Manrope, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillText(act.description, 116, 70, 644);
  }

  // Date + sport type
  const d = new Date(act.date);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  ctx.font = '15px Manrope, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fillText(`${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${act.sport}`, 116, 92);

  // ── Map area ─────────────────────────────────────────────────────────────────
  const mapX = 24, mapY = 108, mapW = 752, mapH = 420;

  // Map background
  roundRect(ctx, mapX, mapY, mapW, mapH, 20);
  ctx.fillStyle = '#242a30';
  ctx.fill();

  if (act.coords.length > 1) {
    const transform = await _drawMapTiles(ctx, act.coords as [number,number][], mapX, mapY, mapW, mapH);
    if (transform) {
      const { toCanvasX, toCanvasY } = transform;
      ctx.save();
      roundRect(ctx, mapX, mapY, mapW, mapH, 20);
      ctx.clip();

      // Route shadow/glow
      ctx.shadowColor = color; ctx.shadowBlur = 16;
      ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 8;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      act.coords.forEach((c, i) => {
        const x = toCanvasX(c[1]), y = toCanvasY(c[0]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      ctx.strokeStyle = color; ctx.lineWidth = 4; ctx.shadowBlur = 0;
      ctx.beginPath();
      act.coords.forEach((c, i) => {
        const x = toCanvasX(c[1]), y = toCanvasY(c[0]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      const drawDot = (lat: number, lng: number, fill: string) => {
        const x = toCanvasX(lng), y = toCanvasY(lat);
        ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill();
        ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = fill; ctx.fill();
      };
      drawDot(act.coords[0][0], act.coords[0][1], '#00c46a');
      drawDot(act.coords[act.coords.length-1][0], act.coords[act.coords.length-1][1], '#e74c3c');
      ctx.restore();
    } else {
      _drawRouteFallback(ctx, act.coords as [number,number][], color, mapX, mapY, mapW, mapH);
    }
  } else {
    ctx.font = '20px Manrope, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.textAlign = 'center';
    ctx.fillText('No GPS route recorded', 400, mapY + mapH / 2);
    ctx.textAlign = 'left';
  }

  let nextY = mapY + mapH + 24;

  // ── Photo (if any) ───────────────────────────────────────────────────────────
  if (hasPhoto && act.photoUrl) {
    const photoImg = await _loadImage(act.photoUrl);
    if (photoImg) {
      const ph = 220, py = nextY, px = 24, pw = 752;
      roundRect(ctx, px, py, pw, ph, 16); ctx.fillStyle = '#242a30'; ctx.fill();
      ctx.save();
      roundRect(ctx, px, py, pw, ph, 16); ctx.clip();
      // Cover-fit the photo
      const scale = Math.max(pw / photoImg.width, ph / photoImg.height);
      const sw = photoImg.width * scale, sh = photoImg.height * scale;
      ctx.drawImage(photoImg, px + (pw - sw) / 2, py + (ph - sh) / 2, sw, sh);
      ctx.fillStyle = 'rgba(0,0,0,0.15)'; ctx.fillRect(px, py, pw, ph);
      ctx.restore();
      nextY += ph + 24;
    }
  }

  // ── Stats ────────────────────────────────────────────────────────────────────
  const statsY = nextY;
  const statW  = 800 / 3;

  const stats: [string, string][] = [
    [formatDistance(act.distanceKm), 'km'],
    [formatDuration(act.durationSec), 'time'],
    [act.sport === 'cycling' ? act.speedKmH.toFixed(1) : formatPace(act.paceMinKm),
     act.sport === 'cycling' ? 'km/h' : 'min/km'],
  ];

  stats.forEach(([val, lbl], i) => {
    const x = i * statW + statW / 2;
    ctx.textAlign = 'center';
    ctx.font = 'bold 48px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(val, x, statsY + 52);
    ctx.font = '15px Manrope, system-ui, sans-serif';
    ctx.fillStyle = color + 'cc';
    ctx.fillText(lbl.toUpperCase(), x, statsY + 75);

    // Separator
    if (i < 2) {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect((i + 1) * statW - 1, statsY + 10, 1, 70);
    }
  });
  ctx.textAlign = 'left';
  nextY = statsY + 100;

  // ── Intensity badge ──────────────────────────────────────────────────────────
  if (act.intensity) {
    const intLabels = ['', 'Easy', 'Moderate', 'Hard', 'Very Hard', 'Max Effort'];
    const intColors = ['', '#4ade80', '#facc15', '#fb923c', '#f87171', '#ef4444'];
    const ic = intColors[act.intensity] ?? color;
    roundRect(ctx, 40, nextY, 140, 30, 8);
    ctx.fillStyle = ic + '22'; ctx.fill();
    ctx.font = 'bold 14px Manrope, system-ui, sans-serif';
    ctx.fillStyle = ic;
    ctx.textAlign = 'center';
    ctx.fillText(intLabels[act.intensity] ?? '', 110, nextY + 20);
    ctx.textAlign = 'left';
    nextY += 50;
  }

  // ── Divider ──────────────────────────────────────────────────────────────────
  ctx.strokeStyle = color + '30'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(40, nextY); ctx.lineTo(760, nextY); ctx.stroke();
  nextY += 20;

  // ── Footer / branding ────────────────────────────────────────────────────────
  // MapYou logo text
  ctx.font = 'bold 20px Manrope, system-ui, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText('🗺 MapYou', 40, nextY + 20);

  // Horizontal rule at bottom
  const footerY = canvasH - 10;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 3;
  ctx.beginPath(); ctx.moveTo(40, footerY); ctx.lineTo(760, footerY); ctx.stroke();

  // ── Download ──────────────────────────────────────────────────────────────────
  const link = document.createElement('a');
  link.href     = canvas.toDataURL('image/png');
  link.download = `mapyou-${act.sport}-${new Date(act.date).toISOString().slice(0, 10)}.png`;
  link.click();
}
