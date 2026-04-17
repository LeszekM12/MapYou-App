// ─── ACTIVITY VIEW ───────────────────────────────────────────────────────────
// src/modules/ActivityView.ts
// Widok podsumowania po treningu + lista historii aktywności

import type { ActivityRecord, SportType } from './Tracker.js';
import { formatDuration, formatPace, formatDistance } from './Tracker.js';
import { loadActivities, deleteActivity } from './db.js';

const SPORT_ICON: Record<SportType, string> = {
  running: '🏃',
  walking: '🚶',
  cycling: '🚴',
};
const SPORT_LABEL: Record<SportType, string> = {
  running: 'Running',
  walking: 'Walking',
  cycling: 'Cycling',
};
const SPORT_COLOR: Record<SportType, string> = {
  running: '#00c46a',
  walking: '#5badea',
  cycling: '#ffb545',
};

// ── Summary modal po zakończeniu treningu ─────────────────────────────────────

export function showActivitySummary(
  activity:  ActivityRecord,
  map:       L.Map,
  onDiscard: () => void,
  onSave:    (activity: ActivityRecord) => void,
): void {
  // Usuń stary modal jeśli istnieje
  document.getElementById('activitySummaryModal')?.remove();

  const color = SPORT_COLOR[activity.sport];

  const modal = document.createElement('div');
  modal.id        = 'activitySummaryModal';
  modal.className = 'activity-summary-modal';

  const durationFmt = formatDuration(activity.durationSec);
  const distFmt     = formatDistance(activity.distanceKm);
  const paceFmt     = formatPace(activity.paceMinKm);
  const speedFmt    = activity.speedKmH.toFixed(1);

  const months = ['January','February','March','April','May','June',
                  'July','August','September','October','November','December'];
  const d = new Date(activity.date);
  const dateStr = `${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;

  // Stat pomocniczy — pokaż pace dla running/walking, speed dla cycling
  const thirdStat = activity.sport === 'cycling'
    ? `<div class="act-sum__stat">
         <span class="act-sum__stat-val">${speedFmt}</span>
         <span class="act-sum__stat-label">km/h avg</span>
       </div>`
    : `<div class="act-sum__stat">
         <span class="act-sum__stat-val">${paceFmt}</span>
         <span class="act-sum__stat-label">min/km pace</span>
       </div>`;

  modal.innerHTML = `
    <div class="act-sum__backdrop"></div>
    <div class="act-sum__card">
      <div class="act-sum__header" style="border-top: 4px solid ${color}">
        <div class="act-sum__sport-badge" style="background:${color}">
          <span class="act-sum__sport-icon">${SPORT_ICON[activity.sport]}</span>
        </div>
        <div class="act-sum__title-block">
          <h2 class="act-sum__title">${SPORT_LABEL[activity.sport]}</h2>
          <p class="act-sum__date">${dateStr}</p>
        </div>
      </div>

      <div class="act-sum__map-preview" id="actSumMapPreview"></div>

      <div class="act-sum__stats">
        <div class="act-sum__stat act-sum__stat--big">
          <span class="act-sum__stat-val">${distFmt}</span>
          <span class="act-sum__stat-label">km</span>
        </div>
        <div class="act-sum__stat act-sum__stat--big">
          <span class="act-sum__stat-val">${durationFmt}</span>
          <span class="act-sum__stat-label">time</span>
        </div>
        ${thirdStat}
      </div>

      <div class="act-sum__actions">
        <button class="act-sum__btn act-sum__btn--discard" id="actSumDiscard">Discard</button>
        <button class="act-sum__btn act-sum__btn--save" id="actSumSave" style="background:${color}">Save Activity</button>
      </div>
    </div>`;

  document.body.appendChild(modal);

  // Renderuj mini-mapkę trasy w modalu
  if (activity.coords.length > 1) {
    setTimeout(() => {
      const container = document.getElementById('actSumMapPreview');
      if (!container) return;
      const miniMap = L.map(container, {
        zoomControl: false, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false,
        keyboard: false, attributionControl: false,
      });
      L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(miniMap);
      const line = L.polyline(
        activity.coords.map(c => L.latLng(c[0], c[1])),
        { color, weight: 4, opacity: 0.9 },
      ).addTo(miniMap);
      miniMap.fitBounds(line.getBounds(), { padding: [16, 16] });

      // Start/end markers
      const first = activity.coords[0];
      const last  = activity.coords[activity.coords.length - 1];
      L.circleMarker([first[0], first[1]], { radius: 6, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(miniMap);
      L.circleMarker([last[0],  last[1]],  { radius: 6, color: '#fff', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).addTo(miniMap);
    }, 100);
  } else {
    const container = document.getElementById('actSumMapPreview');
    if (container) {
      container.innerHTML = '<div class="act-sum__no-map">📍 No GPS data recorded</div>';
    }
  }

  // Animacja wejścia
  requestAnimationFrame(() => modal.classList.add('act-sum--visible'));

  modal.querySelector('#actSumDiscard')?.addEventListener('click', () => {
    modal.classList.remove('act-sum--visible');
    setTimeout(() => { modal.remove(); onDiscard(); }, 300);
  });

  modal.querySelector('#actSumSave')?.addEventListener('click', () => {
    modal.classList.remove('act-sum--visible');
    setTimeout(() => { modal.remove(); onSave(activity); }, 300);
  });
}

// ── Activity history panel ────────────────────────────────────────────────────

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

    if (activities.length === 0) {
      this.container.innerHTML = `
        <div class="act-history__empty">
          <span class="act-history__empty-icon">🏁</span>
          <p>No activities yet.<br>Start your first workout!</p>
        </div>`;
      return;
    }

    activities.forEach((act: ActivityRecord) => {
      const color    = SPORT_COLOR[act.sport];
      const item     = document.createElement('div');
      item.className = 'act-history__item';
      item.dataset.id = act.id;

      const months = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];
      const d = new Date(act.date);
      const dateStr = `${months[d.getMonth()]} ${d.getDate()}`;

      const thirdVal  = act.sport === 'cycling'
        ? `${act.speedKmH.toFixed(1)} km/h`
        : `${formatPace(act.paceMinKm)} /km`;

      item.innerHTML = `
        <div class="act-history__color-bar" style="background:${color}"></div>
        <div class="act-history__content">
          <div class="act-history__top">
            <span class="act-history__icon">${SPORT_ICON[act.sport]}</span>
            <span class="act-history__name">${act.description}</span>
            <span class="act-history__date">${dateStr}</span>
          </div>
          <div class="act-history__stats">
            <span>${formatDistance(act.distanceKm)} km</span>
            <span>${formatDuration(act.durationSec)}</span>
            <span>${thirdVal}</span>
          </div>
        </div>
        <button class="act-history__delete" data-id="${act.id}" title="Delete">✕</button>`;

      // Kliknięcie na kartę — pokaż trasę na mapie
      item.addEventListener('click', (e) => {
        const target = e.target as HTMLElement;
        if (target.closest('.act-history__delete')) return;
        this._showOnMap(act);
      });

      // Usuń aktywność
      item.querySelector('.act-history__delete')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm('Delete this activity?')) return;
        await deleteActivity(act.id);
        item.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
        item.style.transform  = 'translateX(-110%)';
        item.style.opacity    = '0';
        setTimeout(() => item.remove(), 300);
        if (this.activeLine) { this.map.removeLayer(this.activeLine); this.activeLine = null; }
      });

      this.container.appendChild(item);
    });
  }

  private _showOnMap(act: ActivityRecord): void {
    if (this.activeLine) {
      this.map.removeLayer(this.activeLine);
      this.activeLine = null;
    }
    if (!act.coords.length) return;
    const color = SPORT_COLOR[act.sport];
    this.activeLine = L.polyline(
      act.coords.map(c => L.latLng(c[0], c[1])),
      { color, weight: 5, opacity: 0.9 },
    ).addTo(this.map);
    this.map.fitBounds(this.activeLine.getBounds(), { padding: [40, 40] });
  }
}
