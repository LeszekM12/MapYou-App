// ─── HOME VIEW — Activity Feed ────────────────────────────────────────────────
// src/modules/HomeView.ts

import { loadEnrichedActivities, type EnrichedActivity } from './db.js';
import { SPORT_COLORS, SPORT_ICONS, formatDuration, formatPace, formatDistance } from './Tracker.js';
import type { SportType } from './Tracker.js';
import { generateShareImageFromEnriched } from './ShareImage.js';
import { openProfileModal, loadProfileFromLocal } from './UserProfile.js';

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

// ── Mini map ──────────────────────────────────────────────────────────────────

const _activeMaps = new Map<string, L.Map>();

function renderMiniMap(
  container: HTMLElement,
  coords: Array<[number, number]>,
  sport: SportType,
): void {
  if (!coords || coords.length < 2) {
    container.innerHTML = '<div class="home-card__no-map">No GPS data</div>';
    return;
  }
  const existing = _activeMaps.get(container.id);
  if (existing) { try { existing.remove(); } catch {} }

  const map = L.map(container, {
    zoomControl: false, dragging: false, touchZoom: false,
    scrollWheelZoom: false, doubleClickZoom: false,
    boxZoom: false, keyboard: false, attributionControl: false,
  });
  _activeMaps.set(container.id, map);
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

// ── Comment panel ─────────────────────────────────────────────────────────────

function openCommentPanel(card: HTMLElement, actId: string): void {
  card.querySelector('.home-card__comment-panel')?.remove();

  const panel = document.createElement('div');
  panel.className = 'home-card__comment-panel';
  const storageKey = `hc_comments_${actId}`;
  const savedComments: Array<{text: string; ts: number}> =
    JSON.parse(localStorage.getItem(storageKey) ?? '[]');

  const renderComments = () => savedComments
    .map(c => `<div class="hcc__item"><span class="hcc__text">${c.text}</span><span class="hcc__ts">${relativeDate(c.ts)}</span></div>`)
    .join('') || '<p class="hcc__empty">No comments yet</p>';

  panel.innerHTML = `
    <div class="hcc__list" id="hcc-list-${actId}">${renderComments()}</div>
    <div class="hcc__form">
      <input class="hcc__input" placeholder="Add a comment…" maxlength="200"/>
      <button class="hcc__send">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
      </button>
    </div>`;

  card.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('home-card__comment-panel--open'));

  const input = panel.querySelector<HTMLInputElement>('.hcc__input')!;
  input.focus();

  const sendComment = () => {
    const text = input.value.trim();
    if (!text) return;
    savedComments.push({ text, ts: Date.now() });
    localStorage.setItem(storageKey, JSON.stringify(savedComments));
    input.value = '';
    const list = panel.querySelector(`#hcc-list-${actId}`)!;
    list.innerHTML = renderComments();
    list.scrollTop = list.scrollHeight;
    // Update count badge
    const countEl = card.querySelector<HTMLElement>(`[data-comment-count="${actId}"]`);
    if (countEl) countEl.textContent = String(savedComments.length);
  };

  panel.querySelector('.hcc__send')?.addEventListener('click', sendComment);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') sendComment(); });
}

// ── Share panel ───────────────────────────────────────────────────────────────

function openSharePanel(card: HTMLElement, act: EnrichedActivity): void {
  card.querySelector('.home-card__share-panel')?.remove();

  const panel = document.createElement('div');
  panel.className = 'home-card__share-panel';
  panel.innerHTML = `
    <div class="hcs__title">Share activity</div>
    <div class="hcs__options">
      <button class="hcs__opt" id="hcsDownload-${act.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
        </svg>
        <span>Download image</span>
      </button>
      <button class="hcs__opt" id="hcsCopy-${act.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
          <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        <span>Copy link</span>
      </button>
      <button class="hcs__opt${!navigator.share ? ' hcs__opt--disabled' : ''}" id="hcsNative-${act.id}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
        <span>Share via…</span>
      </button>
    </div>`;

  card.appendChild(panel);
  requestAnimationFrame(() => panel.classList.add('home-card__share-panel--open'));

  // Download image
  panel.querySelector(`#hcsDownload-${act.id}`)?.addEventListener('click', async () => {
    const btn = panel.querySelector<HTMLButtonElement>(`#hcsDownload-${act.id}`)!;
    const span = btn.querySelector('span')!;
    btn.classList.add('hcs__opt--loading');
    span.textContent = 'Generating…';
    try {
      await generateShareImageFromEnriched(act);
      span.textContent = 'Downloaded! ✓';
      setTimeout(() => { span.textContent = 'Download image'; btn.classList.remove('hcs__opt--loading'); }, 2000);
    } catch {
      span.textContent = 'Error — try again';
      btn.classList.remove('hcs__opt--loading');
    }
  });

  // Copy link
  panel.querySelector(`#hcsCopy-${act.id}`)?.addEventListener('click', async () => {
    const url = window.location.href.split('#')[0];
    const shareText = `${act.name || act.description} — ${act.distanceKm.toFixed(2)} km in ${formatDuration(act.durationSec)} 🏃 #MapYou`;
    try {
      await navigator.clipboard.writeText(shareText + '\n' + url);
      const btn = panel.querySelector<HTMLButtonElement>(`#hcsCopy-${act.id}`)!;
      btn.querySelector('span')!.textContent = 'Copied! ✓';
      setTimeout(() => { btn.querySelector('span')!.textContent = 'Copy link'; }, 2000);
    } catch {}
  });

  // Native share (Web Share API)
  if (navigator.share) {
    panel.querySelector(`#hcsNative-${act.id}`)?.addEventListener('click', async () => {
      try {
        await navigator.share({
          title: act.name || act.description,
          text: `${act.name || act.description} — ${act.distanceKm.toFixed(2)} km · ${formatDuration(act.durationSec)} via MapYou`,
          url: window.location.href,
        });
      } catch {}
    });
  }

  // Auto-close when clicking outside
  setTimeout(() => {
    const closeHandler = (e: MouseEvent) => {
      if (!panel.contains(e.target as Node) && !card.querySelector('.home-card__action--share')?.contains(e.target as Node)) {
        panel.classList.remove('home-card__share-panel--open');
        setTimeout(() => panel.remove(), 280);
        document.removeEventListener('click', closeHandler);
      }
    };
    document.addEventListener('click', closeHandler);
  }, 100);
}

// ── Lightbox ──────────────────────────────────────────────────────────────────

function openLightbox(src: string): void {
  const existing = document.getElementById('homeLightbox');
  if (existing) existing.remove();

  const lb = document.createElement('div');
  lb.id = 'homeLightbox';
  lb.className = 'home-lightbox';
  lb.innerHTML = `
    <div class="home-lightbox__backdrop"></div>
    <div class="home-lightbox__inner">
      <button class="home-lightbox__close" aria-label="Close">✕</button>
      <img class="home-lightbox__img" src="${src}" alt="Activity photo"/>
    </div>`;
  document.body.appendChild(lb);

  requestAnimationFrame(() => lb.classList.add('home-lightbox--open'));

  const close = () => {
    lb.classList.remove('home-lightbox--open');
    setTimeout(() => lb.remove(), 280);
  };
  lb.querySelector('.home-lightbox__close')?.addEventListener('click', close);
  lb.querySelector('.home-lightbox__backdrop')?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); }, { once: true });
}

// ── Card builder ──────────────────────────────────────────────────────────────

function buildCard(act: EnrichedActivity): HTMLElement {
  const card = document.createElement('article');
  card.className = 'home-card';
  card.dataset.id = act.id;

  const color     = SPORT_COLORS[act.sport as SportType] ?? '#00c46a';
  const icon      = SPORT_ICONS[act.sport as SportType]  ?? '🏅';
  const distFmt   = formatDistance(act.distanceKm);
  const timeFmt   = formatDuration(act.durationSec);
  const paceFmt   = act.sport !== 'cycling' ? formatPace(act.paceMinKm) : act.speedKmH.toFixed(1);
  const paceLabel = act.sport !== 'cycling' ? 'min/km' : 'km/h';
  const mapId     = `hcmap-${act.id}`;

  const intenHtml = act.intensity
    ? `<span class="home-card__badge" style="background:${intensityColor(act.intensity)}22;color:${intensityColor(act.intensity)};border:1px solid ${intensityColor(act.intensity)}44">${intensityLabel(act.intensity)}</span>`
    : '';

  const photoHtml = act.photoUrl
    ? `<div class="home-card__photo" data-photosrc="${act.photoUrl}"><img src="${act.photoUrl}" alt="Activity photo" loading="lazy"/></div>`
    : '';

  const notesHtml = act.notes
    ? `<p class="home-card__notes">🔒 ${act.notes}</p>`
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
      ? `<p class="home-card__desc">${act.description}</p>` : ''}

    <div class="home-card__map-wrap" id="${mapId}"></div>

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
      <button class="home-card__action home-card__action--like" data-action="like" aria-label="Like">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <span class="home-card__action-count" data-like-count="${act.id}">0</span>
      </button>

      <button class="home-card__action home-card__action--comment" data-action="comment" aria-label="Comment">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="home-card__action-count" data-comment-count="${act.id}">0</span>
      </button>

      <button class="home-card__action home-card__action--share" data-action="share" aria-label="Share">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </button>
    </div>`;

  // ── Wire actions — stopPropagation prevents workout form from opening ──────
  card.querySelectorAll<HTMLElement>('.home-card__action').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation(); // prevent Leaflet map click, but NOT preventDefault (breaks buttons)
      const action = btn.dataset.action;

      if (action === 'like') {
        const liked = btn.classList.toggle('home-card__action--liked');
        const lsKey = `hc_likes_${act.id}`;
        const prev  = parseInt(localStorage.getItem(lsKey) ?? '0', 10);
        const next  = Math.max(0, prev + (liked ? 1 : -1));
        localStorage.setItem(lsKey, String(next));
        const el = card.querySelector<HTMLElement>(`[data-like-count="${act.id}"]`);
        if (el) el.textContent = String(next);
        // Pulse animation
        btn.classList.add('home-card__action--pulse');
        setTimeout(() => btn.classList.remove('home-card__action--pulse'), 400);
      }

      if (action === 'comment') {
        const existing = card.querySelector('.home-card__comment-panel');
        if (existing) {
          existing.classList.remove('home-card__comment-panel--open');
          setTimeout(() => existing.remove(), 280);
        } else {
          openCommentPanel(card, act.id);
        }
      }

      if (action === 'share') {
        const existing = card.querySelector('.home-card__share-panel');
        if (existing) {
          existing.classList.remove('home-card__share-panel--open');
          setTimeout(() => existing.remove(), 280);
        } else {
          openSharePanel(card, act);
        }
      }
    });
  });

  // ── Wire photo click → lightbox ──────────────────────────────────────────
  const photoEl = card.querySelector<HTMLElement>('.home-card__photo[data-photosrc]');
  if (photoEl) {
    photoEl.addEventListener('click', (e) => {
      e.stopPropagation();
      const src = photoEl.dataset.photosrc;
      if (src) openLightbox(src);
    });
  }

  // Restore persisted likes
  const lsKey = `hc_likes_${act.id}`;
  const likeCount = parseInt(localStorage.getItem(lsKey) ?? '0', 10);
  if (likeCount > 0) {
    const el = card.querySelector<HTMLElement>(`[data-like-count="${act.id}"]`);
    if (el) el.textContent = String(likeCount);
    card.querySelector('.home-card__action--like')?.classList.add('home-card__action--liked');
  }

  // Restore comment count
  const commentKey = `hc_comments_${act.id}`;
  const comments: unknown[] = JSON.parse(localStorage.getItem(commentKey) ?? '[]');
  if (comments.length > 0) {
    const el = card.querySelector<HTMLElement>(`[data-comment-count="${act.id}"]`);
    if (el) el.textContent = String(comments.length);
  }

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

    // ── Block map-click passthrough at the tab container level ────────────────
    // Only stopPropagation on the *container* itself — NOT on children
    // (children handle their own events normally).
    const tabEl = document.getElementById('tabHome');
    if (tabEl) {
      // Use capture:false so buttons get the event first, then we stop it here
      tabEl.addEventListener('click', (e: Event) => {
        if (tabEl.classList.contains('tab-panel--active')) {
          e.stopPropagation();
          // Do NOT preventDefault — that would break button clicks
        }
      }, false);
      // Also block touchend which Leaflet uses to synthesise map clicks
      tabEl.addEventListener('touchend', (e: Event) => {
        if (tabEl.classList.contains('tab-panel--active')) {
          e.stopPropagation();
        }
      }, { passive: true });
    }

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

    const greeting = document.createElement('div');
    greeting.className = 'home-greeting';
    const hour    = new Date().getHours();
    const greet   = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
    const profile = loadProfileFromLocal();
    const avatarHtml = profile.avatarB64
      ? `<img src="${profile.avatarB64}" class="home-greeting__avatar-img" alt="avatar"/>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22">
           <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
         </svg>`;
    greeting.innerHTML = `
      <div class="home-greeting__row">
        <div class="home-greeting__text-wrap">
          <h2 class="home-greeting__text">${greet}, <strong>${profile.name}</strong> 👋</h2>
          <p class="home-greeting__sub">${activities.length} activit${activities.length === 1 ? 'y' : 'ies'} recorded</p>
        </div>
        <button class="home-greeting__profile-btn" id="profileNavAvatar" aria-label="Open profile">
          ${avatarHtml}
        </button>
      </div>`;
    scroll.appendChild(greeting);

    // Wire profile button — stopPropagation so it doesn't bubble to map
    greeting.querySelector('#profileNavAvatar')?.addEventListener('click', e => {
      e.stopPropagation();
      openProfileModal();
    });

    activities.forEach((act, idx) => {
      const card = buildCard(act);
      card.style.animationDelay = `${idx * 60}ms`;
      // IMPORTANT: block ALL clicks from bubbling to the app-level map click handler
      scroll.appendChild(card);

      requestAnimationFrame(() => {
        setTimeout(() => {
          const mapEl = document.getElementById(`hcmap-${act.id}`);
          if (mapEl) renderMiniMap(mapEl, act.coords, act.sport as SportType);
        }, 80 + idx * 30);
      });
    });


  }

  switchToHome(): void {
    const btn = document.querySelector<HTMLElement>('.bottom-nav__item[data-tab="tabHome"]');
    btn?.click();
  }
}

export const homeView = new HomeView();
