// ─── ACTIVITY VIEW ───────────────────────────────────────────────────────────
// src/modules/ActivityView.ts

import type { ActivityRecord, SportType } from './Tracker.js';
import { formatDuration, formatPace, formatDistance, SPORT_ICONS, SPORT_COLORS } from './Tracker.js';
import { loadActivities, deleteActivity } from './db.js';

// ── Splash "Dobra robota!" ────────────────────────────────────────────────────

export function showGoodJobSplash(onDone: () => void): void {
  const el = document.createElement('div');
  el.className = 'goodjob-splash';
  el.innerHTML = `
    <div class="goodjob-splash__bg"></div>
    <div class="goodjob-splash__content">
      <div class="goodjob-splash__icon">👟</div>
      <h1 class="goodjob-splash__title">Great job!</h1>
      <p class="goodjob-splash__sub">Keep it up!</p>
    </div>`;
  document.body.appendChild(el);

  requestAnimationFrame(() => el.classList.add('goodjob-splash--visible'));

  setTimeout(() => {
    el.classList.add('goodjob-splash--fade');
    setTimeout(() => { el.remove(); onDone(); }, 600);
  }, 1800);
}

// ── Activity Summary Modal ────────────────────────────────────────────────────

export function showActivitySummary(
  activity:  ActivityRecord,
  map:       L.Map,
  onDiscard: () => void,
  onSave:    (activity: ActivityRecord) => void,
): void {
  document.getElementById('activitySummaryModal')?.remove();

  const color    = SPORT_COLORS[activity.sport];
  const modal    = document.createElement('div');
  modal.id        = 'activitySummaryModal';
  modal.className = 'act-sum';

  const durationFmt = formatDuration(activity.durationSec);
  const distFmt     = formatDistance(activity.distanceKm);
  const paceFmt     = formatPace(activity.paceMinKm);
  const speedFmt    = activity.speedKmH.toFixed(1);
  const months      = ['January','February','March','April','May','June',
                       'July','August','September','October','November','December'];
  const d    = new Date(activity.date);
  const date = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  const thirdStat = activity.sport === 'cycling'
    ? `<div class="act-sum__stat"><span class="act-sum__val">${speedFmt}</span><span class="act-sum__lbl">km/h avg</span></div>`
    : `<div class="act-sum__stat"><span class="act-sum__val">${paceFmt}</span><span class="act-sum__lbl">min/km</span></div>`;

  modal.innerHTML = `
    <div class="act-sum__sheet">
      <div class="act-sum__handle"></div>
      <div class="act-sum__header" style="border-left:4px solid ${color}">
        <div class="act-sum__badge" style="background:${color}20;border:2px solid ${color}">
          <span style="font-size:2.4rem">${SPORT_ICONS[activity.sport]}</span>
        </div>
        <div>
          <h2 class="act-sum__name">${activity.description}</h2>
          <p class="act-sum__date">${date}</p>
        </div>
      </div>

      <div class="act-sum__map" id="actSumMap"></div>

      <div class="act-sum__stats">
        <div class="act-sum__stat act-sum__stat--big">
          <span class="act-sum__val">${distFmt}</span>
          <span class="act-sum__lbl">km</span>
        </div>
        <div class="act-sum__stat act-sum__stat--big">
          <span class="act-sum__val">${durationFmt}</span>
          <span class="act-sum__lbl">time</span>
        </div>
        ${thirdStat}
      </div>

      <div class="act-sum__actions">
        <button class="act-sum__btn act-sum__btn--discard" id="actSumDiscard">Discard</button>
        <button class="act-sum__btn act-sum__btn--share" id="actSumShare">📤 Share</button>
        <button class="act-sum__btn act-sum__btn--save" id="actSumSave" style="background:${color}">Save</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Mini mapa
  if (activity.coords.length > 1) {
    setTimeout(() => {
      const container = document.getElementById('actSumMap');
      if (!container) return;
      const miniMap = L.map(container, {
        zoomControl: false, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false,
        boxZoom: false, keyboard: false, attributionControl: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(miniMap);
      const line = L.polyline(
        activity.coords.map(c => L.latLng(c[0], c[1])),
        { color, weight: 4, opacity: 0.95 },
      ).addTo(miniMap);
      miniMap.fitBounds(line.getBounds(), { padding: [20, 20] });

      const first = activity.coords[0];
      const last  = activity.coords[activity.coords.length - 1];
      L.circleMarker([first[0], first[1]], { radius:6, color:'#fff', fillColor:'#00c46a', fillOpacity:1, weight:2 }).addTo(miniMap);
      L.circleMarker([last[0],  last[1]],  { radius:6, color:'#fff', fillColor:'#e74c3c', fillOpacity:1, weight:2 }).addTo(miniMap);
    }, 150);
  } else {
    const c = document.getElementById('actSumMap');
    if (c) c.innerHTML = '<div class="act-sum__no-map">No GPS data</div>';
  }

  requestAnimationFrame(() => modal.classList.add('act-sum--visible'));

  modal.querySelector('#actSumDiscard')?.addEventListener('click', () => {
    _closeModal(modal, onDiscard);
  });

  modal.querySelector('#actSumShare')?.addEventListener('click', () => {
    void generateShareImage(activity);
  });

  modal.querySelector('#actSumSave')?.addEventListener('click', () => {
    _closeModal(modal, () => onSave(activity));
  });
}

function _closeModal(modal: HTMLElement, cb: () => void): void {
  modal.classList.remove('act-sum--visible');
  setTimeout(() => { modal.remove(); cb(); }, 300);
}

// ── Share image generator ─────────────────────────────────────────────────────

// ── OSM tile helpers ──────────────────────────────────────────────────────────

function _lngToTileX(lng: number, zoom: number): number {
  return Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
}
function _latToTileY(lat: number, zoom: number): number {
  const r = Math.PI / 180;
  return Math.floor(
    (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * Math.pow(2, zoom),
  );
}
// Pixel offset of a lat/lng within the tile grid (at given zoom, 256px tiles)
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
    img.onerror = () => resolve(null);   // fail gracefully
    img.src = url;
  });
}

/**
 * Render OSM tiles into a canvas region.
 * Returns coordinate-to-canvas transform functions for drawing the route on top.
 */
async function _drawMapTiles(
  ctx:    CanvasRenderingContext2D,
  coords: [number, number][],
  canvasX: number, canvasY: number,
  canvasW: number, canvasH: number,
): Promise<{
  toCanvasX: (lng: number) => number;
  toCanvasY: (lat: number) => number;
} | null> {
  if (!coords.length) return null;

  const lats = coords.map(c => c[0]);
  const lngs = coords.map(c => c[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  // Pick zoom so the route fits nicely in the map area
  let zoom = 14;
  for (let z = 16; z >= 8; z--) {
    const txa = _lngToTileX(minLng, z);
    const txb = _lngToTileX(maxLng, z);
    const tya = _latToTileY(maxLat, z);  // note: y increases southward
    const tyb = _latToTileY(minLat, z);
    const tilesW = txb - txa + 1;
    const tilesH = tyb - tya + 1;
    if (tilesW <= 6 && tilesH <= 6) { zoom = z; break; }
    if (z === 8) zoom = 8;
  }

  // Tile range to cover the bounding box + 1-tile margin
  const pad  = 1;
  const txMin = _lngToTileX(minLng, zoom) - pad;
  const txMax = _lngToTileX(maxLng, zoom) + pad;
  const tyMin = _latToTileY(maxLat, zoom) - pad;   // maxLat → smaller tileY
  const tyMax = _latToTileY(minLat, zoom) + pad;

  // Pixel bounds of the entire tile grid we're about to fetch
  const gridPixelX0 = txMin * 256;
  const gridPixelY0 = tyMin * 256;
  const gridPixelX1 = (txMax + 1) * 256;
  const gridPixelY1 = (tyMax + 1) * 256;

  // Centre of bounding box in world pixels
  const cLat = (minLat + maxLat) / 2;
  const cLng = (minLng + maxLng) / 2;
  const centre = _latLngToPixel(cLat, cLng, zoom);

  // We want the centre of the route to be at the centre of canvasW×canvasH
  const srcCX = centre.x;
  const srcCY = centre.y;

  // Source rect in world-pixel space (centred on route, sized to canvas)
  const srcX = srcCX - canvasW / 2;
  const srcY = srcCY - canvasH / 2;

  // Build a temporary off-screen canvas large enough for all tiles
  const tmpW = (txMax - txMin + 1) * 256;
  const tmpH = (tyMax - tyMin + 1) * 256;
  const tmp  = document.createElement('canvas');
  tmp.width  = tmpW;
  tmp.height = tmpH;
  const tctx = tmp.getContext('2d')!;

  // Subdomains for OSM hot tile server
  const subs = ['a','b','c'];
  const tilePromises: Promise<void>[] = [];

  for (let tx = txMin; tx <= txMax; tx++) {
    for (let ty = tyMin; ty <= tyMax; ty++) {
      const sub = subs[(tx + ty) % 3];
      const url = `https://${sub}.tile.openstreetmap.fr/hot/${zoom}/${tx}/${ty}.png`;
      const dx  = (tx - txMin) * 256;
      const dy  = (ty - tyMin) * 256;
      tilePromises.push(
        _loadImage(url).then(img => {
          if (img) tctx.drawImage(img, dx, dy, 256, 256);
        }),
      );
    }
  }

  await Promise.all(tilePromises);

  // Clip & draw the tile mosaic into the canvas map region
  ctx.save();
  ctx.beginPath();
  if ((ctx as CanvasRenderingContext2D & { roundRect?: (x:number,y:number,w:number,h:number,r:number)=>void }).roundRect) {
    (ctx as CanvasRenderingContext2D & { roundRect: (x:number,y:number,w:number,h:number,r:number)=>void })
      .roundRect(canvasX, canvasY, canvasW, canvasH, 16);
  } else {
    ctx.rect(canvasX, canvasY, canvasW, canvasH);
  }
  ctx.clip();

  // Offset: srcX/srcY in world-pixel space, relative to our tile grid origin
  const drawSrcX = srcX - gridPixelX0;
  const drawSrcY = srcY - gridPixelY0;

  ctx.drawImage(tmp, drawSrcX, drawSrcY, canvasW, canvasH, canvasX, canvasY, canvasW, canvasH);

  // Dark overlay so the coloured route pops
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fillRect(canvasX, canvasY, canvasW, canvasH);

  ctx.restore();

  // Return transform: world-pixel → canvas coords
  const toCanvasX = (lng: number) => {
    const wp = _latLngToPixel(0, lng, zoom).x;
    // horizontal: wp relative to srcX
    return canvasX + (wp - srcX);
  };
  const toCanvasY = (lat: number) => {
    const wp = _latLngToPixel(lat, 0, zoom).y;
    return canvasY + (wp - srcY);
  };

  return { toCanvasX, toCanvasY };
}

export async function generateShareImage(activity: ActivityRecord): Promise<void> {
  const color = SPORT_COLORS[activity.sport];

  // Utwórz canvas
  const canvas  = document.createElement('canvas');
  canvas.width  = 800;
  canvas.height = 1000;
  const ctx     = canvas.getContext('2d')!;

  // Tło
  ctx.fillStyle = '#1a1f23';
  ctx.fillRect(0, 0, 800, 1000);

  // Gradient na górze
  const grad = ctx.createLinearGradient(0, 0, 800, 400);
  grad.addColorStop(0, color + '22');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 800, 400);

  // Sport ikona + nazwa
  ctx.font = 'bold 28px Manrope, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText(activity.description, 48, 72);

  // Data
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const d = new Date(activity.date);
  ctx.font = '18px Manrope, sans-serif';
  ctx.fillStyle = '#aaa';
  ctx.fillText(`${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`, 48, 104);

  // Obszar mapy
  const mapX = 24, mapY = 130, mapW = 752, mapH = 480;

  // Fallback tło mapy (widoczne gdy brak GPS lub kafelki się nie załadują)
  ctx.fillStyle = '#242a30';
  ctx.beginPath();
  if (ctx.roundRect) {
    ctx.roundRect(mapX, mapY, mapW, mapH, 16);
  } else {
    ctx.rect(mapX, mapY, mapW, mapH);
  }
  ctx.fill();

  // Trasa na mapie
  if (activity.coords.length > 1) {
    // 1. Narysuj kafelki OSM jako tło
    const transform = await _drawMapTiles(ctx, activity.coords, mapX, mapY, mapW, mapH);

    if (transform) {
      // 2. Rysuj trasę używając prawdziwych współrzędnych geo → piksele canvas
      const { toCanvasX, toCanvasY } = transform;

      // Clip do obszaru mapy żeby trasa nie wychodziła poza zaokrąglone rogi
      ctx.save();
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(mapX, mapY, mapW, mapH, 16);
      } else {
        ctx.rect(mapX, mapY, mapW, mapH);
      }
      ctx.clip();

      // Cień / glow
      ctx.shadowColor = color;
      ctx.shadowBlur  = 14;
      ctx.strokeStyle = color;
      ctx.lineWidth   = 5;
      ctx.lineJoin    = 'round';
      ctx.lineCap     = 'round';
      ctx.beginPath();
      activity.coords.forEach((c, i) => {
        const x = toCanvasX(c[1]);
        const y = toCanvasY(c[0]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Biała obwódka trasy dla czytelności na jasnym tle
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth   = 8;
      ctx.beginPath();
      activity.coords.forEach((c, i) => {
        const x = toCanvasX(c[1]);
        const y = toCanvasY(c[0]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Kolorowa linia trasy na wierzch
      ctx.strokeStyle = color;
      ctx.lineWidth   = 4;
      ctx.beginPath();
      activity.coords.forEach((c, i) => {
        const x = toCanvasX(c[1]);
        const y = toCanvasY(c[0]);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      });
      ctx.stroke();

      // Punkt startowy (zielony) i końcowy (czerwony)
      const s0 = activity.coords[0];
      const s1 = activity.coords[activity.coords.length - 1];

      const drawDot = (lat: number, lng: number, fill: string) => {
        const x = toCanvasX(lng), y = toCanvasY(lat);
        ctx.beginPath();
        ctx.arc(x, y, 9, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
      };
      drawDot(s0[0], s0[1], '#00c46a');
      drawDot(s1[0], s1[1], '#e74c3c');

      ctx.restore();
    } else {
      // Fallback: brak kafelków — rysuj trasę na ciemnym tle jak poprzednio
      _drawRouteFallback(ctx, activity.coords, color, mapX, mapY, mapW, mapH);
    }
  } else {
    ctx.font = '20px Manrope, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.textAlign = 'center';
    ctx.fillText('No GPS route recorded', 400, mapY + mapH / 2);
    ctx.textAlign = 'left';
  }

  // Statystyki
  const statsY = 650;
  const stats: Array<[string, string]> = [
    [formatDistance(activity.distanceKm), 'km'],
    [formatDuration(activity.durationSec), 'time'],
    [activity.sport === 'cycling'
      ? activity.speedKmH.toFixed(1)
      : formatPace(activity.paceMinKm),
     activity.sport === 'cycling' ? 'km/h' : 'min/km'],
  ];

  stats.forEach(([val, lbl], i) => {
    const x = 48 + i * 250;
    ctx.font = 'bold 52px Manrope, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(val, x, statsY + 52);
    ctx.font = '18px Manrope, sans-serif';
    ctx.fillStyle = '#888';
    ctx.fillText(lbl, x, statsY + 80);
  });

  // Logo Mapty
  ctx.font = 'bold 22px Manrope, sans-serif';
  ctx.fillStyle = color;
  ctx.fillText('🗺 mapty', 48, 970);
  ctx.font = '16px Manrope, sans-serif';
  ctx.fillStyle = '#555';
  ctx.fillText('leszekm12.github.io/Mapty-App', 180, 970);

  // Linia dekoracyjna
  ctx.strokeStyle = color;
  ctx.lineWidth   = 3;
  ctx.beginPath(); ctx.moveTo(48, 985); ctx.lineTo(752, 985); ctx.stroke();

  // Pobierz
  const link  = document.createElement('a');
  link.href   = canvas.toDataURL('image/png');
  link.download = `mapty-${activity.sport}-${new Date(activity.date).toISOString().slice(0,10)}.png`;
  link.click();
}

/** Fallback: draw route on dark background (no tiles) */
function _drawRouteFallback(
  ctx:    CanvasRenderingContext2D,
  coords: [number, number][],
  color:  string,
  mapX: number, mapY: number, mapW: number, mapH: number,
): void {
  const lats  = coords.map(c => c[0]);
  const lngs  = coords.map(c => c[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const pad    = 40;
  const scaleX = (mapW - pad * 2) / (maxLng - minLng || 0.001);
  const scaleY = (mapH - pad * 2) / (maxLat - minLat || 0.001);
  const scale  = Math.min(scaleX, scaleY);
  const offX   = mapX + pad + ((mapW - pad * 2) - (maxLng - minLng) * scale) / 2;
  const offY   = mapY + pad + ((mapH - pad * 2) - (maxLat - minLat) * scale) / 2;

  const toX = (lng: number) => offX + (lng - minLng) * scale;
  const toY = (lat: number) => offY + (mapH - pad * 2) - (lat - minLat) * scale;

  ctx.shadowColor = color;
  ctx.shadowBlur  = 12;
  ctx.strokeStyle = color;
  ctx.lineWidth   = 4;
  ctx.lineJoin    = 'round';
  ctx.lineCap     = 'round';
  ctx.beginPath();
  coords.forEach((c, i) => {
    i === 0 ? ctx.moveTo(toX(c[1]), toY(c[0])) : ctx.lineTo(toX(c[1]), toY(c[0]));
  });
  ctx.stroke();
  ctx.shadowBlur = 0;

  const s0 = coords[0], s1 = coords[coords.length - 1];
  ctx.fillStyle = '#00c46a';
  ctx.beginPath(); ctx.arc(toX(s0[1]), toY(s0[0]), 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e74c3c';
  ctx.beginPath(); ctx.arc(toX(s1[1]), toY(s1[0]), 8, 0, Math.PI * 2); ctx.fill();
}

// ── Activity History Panel ────────────────────────────────────────────────────

export class ActivityHistoryPanel {
  private container: HTMLElement;
  private map:       L.Map;
  private activeLine: L.Polyline | null = null;

  constructor(container: HTMLElement, map: L.Map) {
    this.container = container;
    this.map       = map;
  }

  async render(): Promise<void> {
    const activities = await loadActivities();
    this.container.innerHTML = '';

    if (!activities.length) {
      this.container.innerHTML = `
        <div class="act-history__empty">
          <span>🏁</span>
          <p>No activities yet.<br>Start your first workout!</p>
        </div>`;
      return;
    }

    activities.forEach((act: ActivityRecord) => {
      const color = SPORT_COLORS[act.sport];
      const item  = document.createElement('div');
      item.className  = 'act-history__item';
      item.dataset.id = act.id;

      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = new Date(act.date);

      const third = act.sport === 'cycling'
        ? `${act.speedKmH.toFixed(1)} km/h`
        : `${formatPace(act.paceMinKm)} /km`;

      item.innerHTML = `
        <div class="act-history__bar" style="background:${color}"></div>
        <div class="act-history__body">
          <div class="act-history__top">
            <span>${SPORT_ICONS[act.sport]}</span>
            <span class="act-history__name">${act.description}</span>
            <span class="act-history__date">${months[d.getMonth()]} ${d.getDate()}</span>
          </div>
          <div class="act-history__stats">
            <span>${formatDistance(act.distanceKm)} km</span>
            <span>${formatDuration(act.durationSec)}</span>
            <span>${third}</span>
          </div>
        </div>
        <button class="act-history__del" title="Delete">✕</button>`;

      item.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('.act-history__del')) return;
        // Toggle: kliknięcie aktywnej karty usuwa trasę
        if (item.classList.contains('act-history__item--active')) {
          item.classList.remove('act-history__item--active');
          if (this.activeLine) { this.map.removeLayer(this.activeLine); this.activeLine = null; }
        } else {
          document.querySelectorAll('.act-history__item--active').forEach(el => el.classList.remove('act-history__item--active'));
          item.classList.add('act-history__item--active');
          this._showOnMap(act);
        }
      });

      item.querySelector('.act-history__del')?.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Delete this activity?')) return;
        await deleteActivity(act.id);
        item.style.opacity   = '0';
        item.style.transform = 'translateX(-110%)';
        setTimeout(() => item.remove(), 300);
        if (this.activeLine) { this.map.removeLayer(this.activeLine); this.activeLine = null; }
      });

      this.container.appendChild(item);
    });
  }

  private _showOnMap(act: ActivityRecord): void {
    if (this.activeLine) { this.map.removeLayer(this.activeLine); this.activeLine = null; }
    if (!act.coords.length) return;
    this.activeLine = L.polyline(
      act.coords.map(c => L.latLng(c[0], c[1])),
      { color: SPORT_COLORS[act.sport], weight: 5, opacity: 0.95 },
    ).addTo(this.map);
    this.map.fitBounds(this.activeLine.getBounds(), { padding: [60, 60] });
  }
}
