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

  // Trasa na mapie (ciemne tło + rysowana linia)
  if (activity.coords.length > 1) {
    // Obszar trasy
    const mapY = 130, mapH = 480;
    ctx.fillStyle = '#242a30';
    ctx.beginPath();
    ctx.roundRect(24, mapY, 752, mapH, 16);
    ctx.fill();

    // Normalizacja coords do canvas
    const lats  = activity.coords.map(c => c[0]);
    const lngs  = activity.coords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad    = 40;
    const scaleX = (752 - pad * 2) / (maxLng - minLng || 0.001);
    const scaleY = (mapH - pad * 2) / (maxLat - minLat || 0.001);
    const scale  = Math.min(scaleX, scaleY);
    const offX   = 24 + pad + ((752 - pad*2) - (maxLng - minLng) * scale) / 2;
    const offY   = mapY + pad + ((mapH - pad*2) - (maxLat - minLat) * scale) / 2;

    const toX = (lng: number) => offX + (lng - minLng) * scale;
    const toY = (lat: number) => offY + (mapH - pad*2) - (lat - minLat) * scale + (mapY - offY + pad);

    // Linia trasy — glow effect
    ctx.shadowColor   = color;
    ctx.shadowBlur    = 12;
    ctx.strokeStyle   = color;
    ctx.lineWidth     = 4;
    ctx.lineJoin      = 'round';
    ctx.lineCap       = 'round';
    ctx.beginPath();
    activity.coords.forEach((c, i) => {
      const x = toX(c[1]), y = toY(c[0]);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    // Start/end dots
    const [s0, s1] = [activity.coords[0], activity.coords[activity.coords.length - 1]];
    ctx.fillStyle = '#00c46a';
    ctx.beginPath(); ctx.arc(toX(s0[1]), toY(s0[0]), 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath(); ctx.arc(toX(s1[1]), toY(s1[0]), 8, 0, Math.PI * 2); ctx.fill();
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
        this._showOnMap(act);
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
