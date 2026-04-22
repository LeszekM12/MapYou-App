// ─── HOME VIEW — Activity Feed ────────────────────────────────────────────────
// src/modules/HomeView.ts
//
// Strava-style activity feed. Reads from IndexedDB (activities table).
// Renders into #tabHome .home-scroll.

import { loadEnrichedActivities, type EnrichedActivity } from './db.js';
import { SPORT_COLORS, SPORT_ICONS, formatDuration, formatPace, formatDistance } from './Tracker.js';
import type { SportType } from './Tracker.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function relativeDate(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const mins  = Math.floor(diff / 60_000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7)   return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}

function intensityLabel(n: number): string {
  const labels = ['', 'Easy', 'Moderate', 'Hard', 'Very Hard', 'Max Effort'];
  return labels[n] ?? '';
}

function intensityColor(n: number): string {
  const colors = ['', '#4ade80', '#facc15', '#fb923c', '#f87171', '#ef4444'];
  return colors[n] ?? '#4ade80';
}

// ── Map mini-render helper ────────────────────────────────────────────────────

function renderMiniMap(
  container: HTMLElement,
  coords: Array<[number, number]>,
  sport: SportType,
): void {
  if (!coords || coords.length < 2) {
    container.innerHTML = '<div class="home-card__no-map">No GPS data</div>';
    return;
  }
  const map = L.map(container, {
    zoomControl: false, dragging: false, touchZoom: false,
    scrollWheelZoom: false, doubleClickZoom: false,
    boxZoom: false, keyboard: false, attributionControl: false,
  });
  L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(map);
  const color = SPORT_COLORS[sport] ?? '#00c46a';
  const line = L.polyline(coords.map(c => L.latLng(c[0], c[1])), {
    color, weight: 4, opacity: 0.95,
  }).addTo(map);
  map.fitBounds(line.getBounds(), { padding: [16, 16] });
  const first = coords[0];
  const last  = coords[coords.length - 1];
  L.circleMarker([first[0], first[1]], { radius: 5, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(map);
  L.circleMarker([last[0], last[1]],   { radius: 5, color: '#fff', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).addTo(map);
}

// ── Card builder ──────────────────────────────────────────────────────────────

function buildCard(act: EnrichedActivity): HTMLElement {
  const card = document.createElement('article');
  card.className = 'home-card';
  card.dataset.id = act.id;

  const color    = SPORT_COLORS[act.sport as SportType] ?? '#00c46a';
  const icon     = SPORT_ICONS[act.sport as SportType]  ?? '🏅';
  const distFmt  = formatDistance(act.distanceKm);
  const timeFmt  = formatDuration(act.durationSec);
  const paceFmt  = act.sport !== 'cycling'
    ? formatPace(act.paceMinKm)
    : act.speedKmH.toFixed(1);
  const paceLabel = act.sport !== 'cycling' ? 'min/km' : 'km/h';

  const intenHtml = act.intensity
    ? `<span class="home-card__badge" style="background:${intensityColor(act.intensity)}22;color:${intensityColor(act.intensity)};border:1px solid ${intensityColor(act.intensity)}44">${intensityLabel(act.intensity)}</span>`
    : '';

  const photoHtml = act.photoUrl
    ? `<div class="home-card__photo"><img src="${act.photoUrl}" alt="Activity photo" loading="lazy"/></div>`
    : '';

  const notesHtml = act.notes
    ? `<p class="home-card__notes">${act.notes}</p>`
    : '';

  card.innerHTML = `
    <div class="home-card__header">
      <div class="home-card__avatar" style="background:${color}20;border:2px solid ${color}40">
        <span>${icon}</span>
      </div>
      <div class="home-card__meta">
        <h3 class="home-card__name">${act.name || act.description}</h3>
        <span class="home-card__time">${relativeDate(act.date)}</span>
      </div>
      <div class="home-card__badges">
        ${intenHtml}
        <span class="home-card__sport-badge" style="color:${color}">${act.sport}</span>
      </div>
    </div>

    ${act.description && act.name && act.description !== act.name
      ? `<p class="home-card__desc">${act.description}</p>`
      : ''}

    <div class="home-card__map-wrap" id="hcmap-${act.id}"></div>

    ${photoHtml}

    <div class="home-card__stats">
      <div class="home-card__stat">
        <span class="home-card__stat-val">${distFmt}</span>
        <span class="home-card__stat-lbl">km</span>
      </div>
      <div class="home-card__stat-sep"></div>
      <div class="home-card__stat">
        <span class="home-card__stat-val">${timeFmt}</span>
        <span class="home-card__stat-lbl">time</span>
      </div>
      <div class="home-card__stat-sep"></div>
      <div class="home-card__stat">
        <span class="home-card__stat-val">${paceFmt}</span>
        <span class="home-card__stat-lbl">${paceLabel}</span>
      </div>
    </div>

    ${notesHtml}

    <div class="home-card__footer" style="border-top:1px solid ${color}18">
      <button class="home-card__action" data-action="like">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
      </button>
    </div>`;

  return card;
}

// ── HomeView class ────────────────────────────────────────────────────────────

export class HomeView {
  private container: HTMLElement | null = null;
  private _inited = false;

  init(): void {
    this.container = document.querySelector('#tabHome .home-scroll');
    if (!this.container) return;
    this._inited = true;
    void this.render();
  }

  async render(): Promise<void> {
    if (!this._inited) this.init();
    const scroll = this.container;
    if (!scroll) return;

    scroll.innerHTML = '<div class="home-loading"><div class="home-loading__spinner"></div></div>';

    const activities = await loadEnrichedActivities();

    if (activities.length === 0) {
      scroll.innerHTML = `
        <div class="home-empty">
          <div class="home-empty__icon">🏃</div>
          <h3 class="home-empty__title">No activities yet</h3>
          <p class="home-empty__sub">Finish your first workout to see it here</p>
        </div>`;
      return;
    }

    scroll.innerHTML = '';

    // Header greeting
    const greeting = document.createElement('div');
    greeting.className = 'home-greeting';
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const userName = localStorage.getItem('mapyou_userName') ?? 'Athlete';
    greeting.innerHTML = `
      <h2 class="home-greeting__text">${greet}, <strong>${userName}</strong> 👋</h2>
      <p class="home-greeting__sub">${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} recorded</p>`;
    scroll.appendChild(greeting);

    // Cards
    activities.forEach((act, idx) => {
      const card = buildCard(act);
      card.style.animationDelay = `${idx * 60}ms`;
      scroll.appendChild(card);

      // Lazy-init mini map after card is in DOM
      requestAnimationFrame(() => {
        setTimeout(() => {
          const mapEl = document.getElementById(`hcmap-${act.id}`);
          if (mapEl) renderMiniMap(mapEl, act.coords, act.sport as SportType);
        }, 80 + idx * 30);
      });
    });

    // Like buttons
    scroll.querySelectorAll<HTMLElement>('[data-action="like"]').forEach(btn => {
      btn.addEventListener('click', () => btn.classList.toggle('home-card__action--liked'));
    });
  }

  /** Navigate to Home tab programmatically */
  switchToHome(): void {
    const btn = document.querySelector<HTMLElement>('.bottom-nav__item[data-tab="tabHome"]');
    btn?.click();
  }
}

export const homeView = new HomeView();
