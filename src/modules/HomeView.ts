// ─── HOME VIEW — Activity Feed ────────────────────────────────────────────────
// src/modules/HomeView.ts

import { loadEnrichedActivities, type EnrichedActivity } from './db.js';
import { openPublicProfile } from './PublicProfile.js';
import { BACKEND_URL } from '../config.js';
import { renderMinimapCanvas, decodePolyline, encodePolyline, pushNow, uploadReel } from './cloudSync.js';
import { SPORT_COLORS, SPORT_ICONS, formatDuration, formatPace, formatDistance } from './Tracker.js';
import type { SportType } from './Tracker.js';
import { generateShareImageFromEnriched } from './ShareImage.js';
import { loadProfileFromLocal } from './UserProfile.js';
import {
  getNotifications, getUnreadCount, markAllRead, markRead, clearAll,
  onNotificationsChange, notifyActivityAdded, type AppNotification,
} from './NotificationsService.js';
import { profileView, updateBestStreak } from './ProfileView.js';
import { searchView } from './SearchView.js';
import { openPostModal } from './PostModal.js';
import { openSaveActivityModal } from './SaveActivityModal.js';
import { loadUnifiedWorkouts, saveUnifiedWorkout, type UnifiedWorkout } from './UnifiedWorkout.js';
import { statsView } from './StatsView.js';
import { loadPosts, savePost, deletePost, type PostRecord } from './db.js';
import { CS } from './cloudSync.js';

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

// ── Mini map — uses renderMinimapCanvas from cloudSync.ts ──────────────────

// ── Comment panel ─────────────────────────────────────────────────────────────

export function openCommentPanel(card: HTMLElement, actId: string): void {
  card.querySelector('.home-card__comment-panel')?.remove();

  const panel = document.createElement('div');
  panel.className = 'home-card__comment-panel';

  // Determine itemType from actId prefix
  const itemType = actId.startsWith('p_') ? 'post' : 'activity';
  const realId   = actId.startsWith('p_') ? actId.slice(2) : actId;
  const userId   = localStorage.getItem('mapyou_userId_profile') ?? '';
  const userName = localStorage.getItem('mapyou_userName') ?? 'Athlete';

  panel.innerHTML = `
    <div class="hcc__list" id="hcc-list-${actId}">
      <p class="hcc__empty">Loading…</p>
    </div>
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
  const list  = panel.querySelector<HTMLElement>(`#hcc-list-${actId}`)!;
  input.focus();

  // Load comments from Atlas
  const renderAtlasComments = (comments: Array<{authorName: string; text: string; createdAt: string}>) => {
    list.innerHTML = comments.length
      ? comments.map(c => `<div class="hcc__item">
          <span class="hcc__author">${c.authorName}</span>
          <span class="hcc__text">${c.text}</span>
        </div>`).join('')
      : '<p class="hcc__empty">No comments yet</p>';
    list.scrollTop = list.scrollHeight;
  };

  void fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(realId)}`)
    .then(r => r.json())
    .then((d: { data: Array<{authorName: string; text: string; createdAt: string}> }) => {
      renderAtlasComments(d.data ?? []);
      // Update count badge
      const countEl = card.querySelector<HTMLElement>(`[data-comment-count="${actId}"], [data-comment-count="${realId}"]`);
      if (countEl) countEl.textContent = String(d.data?.length ?? 0);
    }).catch(() => { list.innerHTML = '<p class="hcc__empty">No comments yet</p>'; });

  const sendComment = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    input.disabled = true;
    try {
      const res = await fetch(`${BACKEND_URL}/feed/comment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId, authorName: userName, itemId: realId, itemType, text }),
      });
      if (res.ok) {
        // Reload comments
        const r2 = await fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(realId)}`);
        const d2 = await r2.json() as { data: Array<{authorName: string; text: string; createdAt: string}> };
        renderAtlasComments(d2.data ?? []);
        const countEl = card.querySelector<HTMLElement>(`[data-comment-count="${actId}"], [data-comment-count="${realId}"]`);
        if (countEl) countEl.textContent = String(d2.data?.length ?? 0);
      }
    } catch {}
    input.disabled = false;
    input.focus();
  };

  panel.querySelector('.hcc__send')?.addEventListener('click', () => void sendComment());
  input.addEventListener('keydown', e => { if (e.key === 'Enter') void sendComment(); });
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

// ── Post card builder ─────────────────────────────────────────────────────────

function buildPostCard(post: PostRecord, onRefresh: () => Promise<void> | void): HTMLElement {
  const card = document.createElement('article');
  card.className = 'home-card home-card--post';
  card.dataset.id = post.id;

  const avatarHtml = post.avatarB64
    ? `<img src="${post.avatarB64}" class="home-card__avatar-img" alt="avatar"/>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;

  const _postIsVideo = post.mediaType === 'video' || (post.photoUrl?.includes('/video/upload/') ?? false);
  const _postHasReel = (post as unknown as Record<string,unknown>)._authorHasReel as boolean | undefined;
  const photoHtml = post.photoUrl
    ? _postIsVideo
      ? `<div class="home-card__photo"><video src="${post.photoUrl}" type="video/mp4" playsinline controls preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px"></video></div>`
      : `<div class="home-card__photo" data-photosrc="${post.photoUrl}"><img src="${post.photoUrl}" alt="" loading="lazy"/></div>`
    : '';

  // Truncate body at 250 chars
  const TRUNC = 250;
  const isLong = (post.body?.length ?? 0) > TRUNC;
  const bodyHtml = post.body ? `
    <p class="home-card__desc home-card__post-body" id="pbody-${post.id}">
      ${isLong ? post.body.slice(0, TRUNC) + '…' : post.body}
    </p>
    ${isLong ? `<button class="home-card__read-more" id="pmore-${post.id}">…więcej</button>` : ''}` : '';

  card.innerHTML = `
    <div class="home-card__header">
      <div class="home-card__avatar home-card__avatar--user">${avatarHtml}</div>
      <div class="home-card__meta">
        <h3 class="home-card__name">${post.authorName}</h3>
        <span class="home-card__time">${relativeDate(post.date)}</span>
      </div>
      <div class="home-card__post-actions">
        <span class="home-card__post-badge">Post</span>
        <button class="home-card__post-menu-btn" id="pmenu-${post.id}" aria-label="Post options">⋯</button>
      </div>
    </div>

    ${post.title ? `<h4 class="home-card__post-title">${post.title}</h4>` : ''}
    ${bodyHtml}
    ${photoHtml}

    <div class="home-card__footer" style="border-top:1px solid rgba(255,255,255,0.06)">
      <button class="home-card__action home-card__action--like" data-action="like" aria-label="Like">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
        </svg>
        <span class="home-card__action-count" data-like-count="p_${post.id}">0</span>
      </button>
      <button class="home-card__action home-card__action--comment" data-action="comment" aria-label="Comment">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="home-card__action-count" data-comment-count="p_${post.id}">0</span>
      </button>
    </div>`;

  // …więcej toggle
  if (isLong) {
    let expanded = false;
    card.querySelector(`#pmore-${post.id}`)?.addEventListener('click', e => {
      e.stopPropagation();
      expanded = !expanded;
      const bodyEl = card.querySelector<HTMLElement>(`#pbody-${post.id}`);
      const moreBtn = card.querySelector<HTMLElement>(`#pmore-${post.id}`);
      if (bodyEl) bodyEl.textContent = expanded ? post.body! : post.body!.slice(0, TRUNC) + '…';
      if (moreBtn) moreBtn.textContent = expanded ? 'mniej' : '…więcej';
    });
  }

  // Mark as own card
  card.querySelector('.home-card__avatar--user')?.setAttribute('data-own-profile', 'true');
  card.querySelector('.home-card__avatar--user')?.addEventListener('click', e => {
    e.stopPropagation();
    void profileView.open();
  });

  // ⋯ menu — edit / delete
  card.querySelector(`#pmenu-${post.id}`)?.addEventListener('click', e => {
    e.stopPropagation();
    // Remove existing menu
    card.querySelector('.home-card__post-menu')?.remove();

    const menu = document.createElement('div');
    menu.className = 'home-card__post-menu';
    menu.innerHTML = `
      <button class="home-card__post-menu-item" data-pm="edit">✏️ Edit</button>
      <button class="home-card__post-menu-item home-card__post-menu-item--del" data-pm="delete">🗑 Delete</button>`;
    card.querySelector('.home-card__post-actions')?.appendChild(menu);
    requestAnimationFrame(() => menu.classList.add('home-card__post-menu--open'));

    // Edit
    menu.querySelector('[data-pm="edit"]')?.addEventListener('click', ev => {
      ev.stopPropagation();
      menu.remove();
      _openEditPostModal(post, onRefresh);
    });

    // Delete
    menu.querySelector('[data-pm="delete"]')?.addEventListener('click', async ev => {
      ev.stopPropagation();
      menu.remove();
      if (!confirm('Delete this post?')) return;
      await CS.deletePost(post.id);
      await onRefresh();
    });

    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function h() {
        menu.remove();
        document.removeEventListener('click', h);
      });
    }, 50);
  });

  // Wire like — Atlas
  card.querySelector('[data-action="like"]')?.addEventListener('click', e => {
    e.stopPropagation();
    const btn    = e.currentTarget as HTMLElement;
    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
    btn.classList.add('home-card__action--pulse');
    setTimeout(() => btn.classList.remove('home-card__action--pulse'), 400);
    void fetch(`${BACKEND_URL}/feed/like`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, itemId: post.id, itemType: 'post' }),
    }).then(r => r.json()).then((d: { liked: boolean; count: number }) => {
      btn.classList.toggle('home-card__action--liked', d.liked);
      const el = card.querySelector<HTMLElement>(`[data-like-count="p_${post.id}"]`);
      if (el) el.textContent = String(d.count);
    }).catch(() => {
      const liked = btn.classList.toggle('home-card__action--liked');
      const lsKey = `hc_likes_p_${post.id}`;
      const next = Math.max(0, parseInt(localStorage.getItem(lsKey) ?? '0', 10) + (liked ? 1 : -1));
      localStorage.setItem(lsKey, String(next));
      const el = card.querySelector<HTMLElement>(`[data-like-count="p_${post.id}"]`);
      if (el) el.textContent = String(next);
    });
  });

  // Wire comment
  card.querySelector('[data-action="comment"]')?.addEventListener('click', e => {
    e.stopPropagation();
    const existing = card.querySelector('.home-card__comment-panel');
    if (existing) {
      existing.classList.remove('home-card__comment-panel--open');
      setTimeout(() => existing.remove(), 280);
    } else {
      openCommentPanel(card, `p_${post.id}`);
    }
  });

  // Wire photo lightbox
  const photoEl = card.querySelector<HTMLElement>('.home-card__photo[data-photosrc]');
  if (photoEl) {
    photoEl.addEventListener('click', e => {
      e.stopPropagation();
      const src = photoEl.dataset.photosrc;
      if (src) openLightbox(src);
    });
  }

  // Like count loaded from feed response batch

  card.addEventListener('click', e => { e.stopPropagation(); });

  // Click avatar → open own profile
  card.querySelector('.home-card__avatar--user')?.addEventListener('click', e => {
    e.stopPropagation();
    void profileView.open();
  });

  return card;
}

// ── Edit post modal ───────────────────────────────────────────────────────────

function _openEditPostModal(post: PostRecord, onSave: () => void): void {
  document.getElementById('editPostModal')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'editPostModal';
  overlay.className = 'pm-overlay';
  overlay.innerHTML = `
    <div class="pm-sheet" id="editPostSheet">
      <div class="pm-handle"></div>
      <div class="pm-header">
        <h2 class="pm-header__title">Edit Post</h2>
        <button class="pm-close" id="epmClose">✕</button>
      </div>
      <div class="pm-body">
        <div class="pm-field">
          <label class="pm-label" for="epmTitle">Title</label>
          <input class="pm-input" id="epmTitle" type="text" maxlength="20"
            value="${post.title ?? ''}" autocomplete="off"/>
        </div>
        <div class="pm-field">
          <label class="pm-label" for="epmDesc">
            Description
            <span class="pm-char-count" id="epmCount">${(post.body ?? '').length}/500</span>
          </label>
          <textarea class="pm-textarea" id="epmDesc" rows="6" maxlength="500">${post.body ?? ''}</textarea>
        </div>
      </div>
      <div class="pm-footer">
        <button class="pm-btn pm-btn--cancel" id="epmCancel">Cancel</button>
        <button class="pm-btn pm-btn--post" id="epmSave">Save</button>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => {
    overlay.classList.add('pm-overlay--visible');
    setTimeout(() => overlay.querySelector<HTMLElement>('#editPostSheet')?.classList.add('pm-sheet--open'), 10);
  });

  const close = () => {
    overlay.querySelector('#editPostSheet')?.classList.remove('pm-sheet--open');
    overlay.classList.remove('pm-overlay--visible');
    setTimeout(() => overlay.remove(), 350);
  };

  overlay.querySelector('#epmClose')?.addEventListener('click', close);
  overlay.querySelector('#epmCancel')?.addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });

  const descEl  = overlay.querySelector<HTMLTextAreaElement>('#epmDesc')!;
  const countEl = overlay.querySelector<HTMLElement>('#epmCount')!;
  descEl.addEventListener('input', () => { countEl.textContent = `${descEl.value.length}/500`; });

  overlay.querySelector('#epmSave')?.addEventListener('click', async () => {
    const title = (overlay.querySelector<HTMLInputElement>('#epmTitle')?.value ?? '').trim();
    const body  = descEl.value.trim();
    await CS.savePost({ ...post, title, body });
    close();
    onSave();
  });
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

  const _actIsVideo = act.mediaType === 'video' || (act.photoUrl?.includes('/video/upload/') ?? false);
  const photoHtml = act.photoUrl
    ? _actIsVideo
      ? `<div class="home-card__photo"><video src="${act.photoUrl}" type="video/mp4" playsinline controls preload="metadata" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:14px"></video></div>`
      : `<div class="home-card__photo" data-photosrc="${act.photoUrl}"><img src="${act.photoUrl}" alt="Activity photo" loading="lazy"/></div>`
    : '';

  const notesHtml = act.notes
    ? `<p class="home-card__notes">🔒 ${act.notes}</p>`
    : '';

  const profile = loadProfileFromLocal();
  const userAvatarHtml = profile.avatarB64
    ? `<img src="${profile.avatarB64}" class="home-card__avatar-img" alt="avatar"/>`
    : `<span>${icon}</span>`;

  card.innerHTML = `
    <div class="home-card__header">
      <div class="home-card__avatar home-card__avatar--user" style="border-color:${color}40;background:${color}20">
        ${userAvatarHtml}
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

    ${act.coords && act.coords.length > 0 ? `<div class="home-card__map-wrap" id="${mapId}"></div>` : (act as unknown as Record<string,unknown>).coordsEnc ? `<div class="home-card__map-wrap home-card__map-wrap--canvas"></div>` : ''}

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
        btn.classList.add('home-card__action--pulse');
        setTimeout(() => btn.classList.remove('home-card__action--pulse'), 400);
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        void fetch(`${BACKEND_URL}/feed/like`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, itemId: act.id, itemType: 'activity' }),
        }).then(r => r.json()).then((d: { liked: boolean; count: number }) => {
          btn.classList.toggle('home-card__action--liked', d.liked);
          const el = card.querySelector<HTMLElement>(`[data-like-count="${act.id}"]`);
          if (el) el.textContent = String(d.count);
        }).catch(() => {
          // offline fallback
          const liked = btn.classList.toggle('home-card__action--liked');
          const lsKey = `hc_likes_${act.id}`;
          const next = Math.max(0, parseInt(localStorage.getItem(lsKey) ?? '0', 10) + (liked ? 1 : -1));
          localStorage.setItem(lsKey, String(next));
          const el = card.querySelector<HTMLElement>(`[data-like-count="${act.id}"]`);
          if (el) el.textContent = String(next);
        });
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

  // Like count loaded from feed response batch

  // Comment count loaded from feed response batch

  // Click avatar → open own profile
  card.querySelector('.home-card__avatar--user')?.addEventListener('click', e => {
    e.stopPropagation();
    void profileView.open();
  });

  return card;
}

// ── HomeView class ────────────────────────────────────────────────────────────

// ── Notification panel ────────────────────────────────────────────────────────

function _relTimeNotif(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)   return 'Just now';
  if (mins < 60)  return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)   return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days > 1 ? 's' : ''} ago`;
}

function _renderNotifList(notifs: Array<{id:string;title:string;body:string;icon?:string;read:boolean;timestamp:number;type?:string;meta?:string}>, list: HTMLElement, userId: string): void {
  if (notifs.length === 0) {
    list.innerHTML = '<div class="hn-empty"><span>🔔</span><p>No notifications yet</p></div>';
    return;
  }

  list.innerHTML = notifs.map(n => {
    // Parse meta for follow_request/follow: userId|userName|avatarB64
    let requesterId = '', requesterName = '', avatarB64 = '';
    if ((n.type === 'follow_request' || n.type === 'follow' || n.type === 'follow_accepted') && n.meta) {
      const parts = n.meta.split('|');
      requesterId   = parts[0] ?? '';
      requesterName = parts[1] ?? '';
      avatarB64     = parts[2] ?? '';
    }
    const avatarHtml = (n.type === 'follow_request' || n.type === 'follow' || n.type === 'follow_accepted')
      ? (avatarB64
          ? `<img src="${avatarB64}" style="width:44px;height:44px;border-radius:50%;object-fit:cover;flex-shrink:0"/>`
          : `<div style="width:44px;height:44px;border-radius:50%;background:#333;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;flex-shrink:0">${requesterName[0] ?? '?'}</div>`)
      : `<div class="hn-item__icon">${n.icon ?? '🔔'}</div>`;

    return `<div class="hn-item ${n.read ? '' : 'hn-item--unread'}" data-id="${n.id}">
      <div style="display:flex;align-items:flex-start;gap:12px;width:100%">
        ${(n.type === 'follow_request' || n.type === 'follow' || n.type === 'follow_accepted') && requesterId
          ? `<div data-open-profile="${requesterId}" style="cursor:pointer;flex-shrink:0">${avatarHtml}</div>`
          : avatarHtml}
        <div class="hn-item__body" style="flex:1">
          <div class="hn-item__title">${(n.type === 'follow_request' || n.type === 'follow' || n.type === 'follow_accepted') && requesterName ? requesterName : n.title}</div>
          <div class="hn-item__body-text">${n.body}</div>
          <div class="hn-item__time">${_relTimeNotif(n.timestamp)}</div>
          ${n.type === 'follow_request' && requesterId ? `
            <div style="display:flex;gap:8px;margin-top:8px">
              <button class="hn-approve-btn" data-requester="${requesterId}" data-notif="${n.id}"
                style="background:#00c46a;border:none;color:#fff;border-radius:8px;padding:6px 14px;font-size:1.2rem;cursor:pointer;font-family:inherit;font-weight:700">Accept</button>
              <button class="hn-reject-btn" data-requester="${requesterId}" data-notif="${n.id}"
                style="background:rgba(248,113,113,0.12);border:1.5px solid #f87171;color:#f87171;border-radius:8px;padding:6px 14px;font-size:1.2rem;cursor:pointer;font-family:inherit;font-weight:700">Decline</button>
            </div>` : ''}
        </div>
      </div>
    </div>`;
  }).join('');

  // Open profile from notification
  list.querySelectorAll<HTMLElement>('[data-open-profile]').forEach(el => {
    el.addEventListener('click', () => {
      const uid = el.dataset.openProfile!;
      if (uid) import('./PublicProfile.js').then(m => m.openPublicProfile(uid));
    });
  });

  // Approve/Reject handlers
  list.querySelectorAll<HTMLButtonElement>('.hn-approve-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const requesterId = btn.dataset.requester!;
      const notifId     = btn.dataset.notif!;
      await fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}/follow-approve/${encodeURIComponent(requesterId)}`, { method: 'POST' });
      // Delete from backend so it doesn't come back
      await fetch(`${BACKEND_URL}/notifications/${encodeURIComponent(notifId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
      btn.closest('.hn-item')!.innerHTML = '<div style="display:flex;align-items:center;gap:10px;padding:4px 0"><div style="font-size:1.8rem">✅</div><div style="color:#fff;font-size:1.3rem;font-weight:600">Accepted</div></div>';
    });
  });
  list.querySelectorAll<HTMLButtonElement>('.hn-reject-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const requesterId = btn.dataset.requester!;
      const notifId     = btn.dataset.notif!;
      await fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}/follow-reject/${encodeURIComponent(requesterId)}`, { method: 'POST' });
      // Delete from backend so it doesn't come back
      await fetch(`${BACKEND_URL}/notifications/${encodeURIComponent(notifId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
      btn.closest('.hn-item')?.remove();
    });
  });
}

function _openNotifPanel(): void {
  document.getElementById('homeNotifPanel')?.remove();
  markAllRead();

  const panel    = document.createElement('div');
  panel.id       = 'homeNotifPanel';
  panel.className = 'hn-panel';

  panel.innerHTML = `
    <div class="hn-overlay" id="hnOverlay"></div>
    <div class="hn-sheet" id="hnSheet">
      <div class="hn-handle"></div>
      <div class="hn-header">
        <h2 class="hn-header__title">Notifications</h2>
        <button class="hn-clear" id="hnClear">Clear all</button>
      </div>
      <div class="hn-list" id="hnList">
        <div class="hn-empty"><span>⏳</span><p>Loading…</p></div>
      </div>
    </div>`;

  document.body.appendChild(panel);
  requestAnimationFrame(() => {
    panel.querySelector<HTMLElement>('#hnSheet')?.classList.add('hn-sheet--open');
    panel.querySelector<HTMLElement>('#hnOverlay')?.classList.add('hn-overlay--visible');
  });

  const userId  = localStorage.getItem('mapyou_userId_profile') ?? '';
  const hnList  = panel.querySelector<HTMLElement>('#hnList')!;

  // Load from backend + merge with local
  const loadNotifs = async () => {
    try {
      const res  = await fetch(`${BACKEND_URL}/notifications?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
      const data = await res.json() as { status: string; data: Array<{notifId:string;title:string;body:string;icon:string;read:boolean;timestamp:number;type?:string;meta?:string}> };
      if (data.status === 'ok') {
        // Merge backend notifs with local notifs
        const backendNotifs = data.data.map(n => ({ id: n.notifId, title: n.title, body: n.body, icon: n.icon, read: n.read, timestamp: n.timestamp, type: n.type, meta: n.meta }));
        const localNotifs   = getNotifications();
        // Merge — backend takes priority, add local ones not in backend
        const backendIds    = new Set(backendNotifs.map(n => n.id));
        const merged        = [...backendNotifs, ...localNotifs.filter(n => !backendIds.has(n.id))];
        merged.sort((a, b) => b.timestamp - a.timestamp);
        _renderNotifList(merged, hnList, userId);
        // Mark backend notifs as read
        if (userId) void fetch(`${BACKEND_URL}/notifications/read-all?userId=${encodeURIComponent(userId)}`, { method: 'PUT' });
        return;
      }
    } catch { /* offline fallback */ }
    // Fallback to local
    _renderNotifList(getNotifications(), hnList, userId);
  };
  void loadNotifs();

  const close = () => {
    panel.querySelector('#hnSheet')?.classList.remove('hn-sheet--open');
    panel.querySelector('#hnOverlay')?.classList.remove('hn-overlay--visible');
    setTimeout(() => panel.remove(), 340);
  };

  panel.querySelector('#hnOverlay')?.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, { once: true });

  panel.querySelector('#hnClear')?.addEventListener('click', async () => {
    // Clear backend
    if (userId) {
      await fetch(`${BACKEND_URL}/notifications/all?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }).catch(() => {});
    }
    // Clear local
    clearAll();
    // Update badge
    const bell  = document.getElementById('homeNotifBell');
    bell?.querySelector('.home-bell__badge')?.remove();
    hnList.innerHTML = '<div class="hn-empty"><span>🔔</span><p>No notifications yet</p></div>';
  });

  // Swipe to close
  const sheet  = panel.querySelector<HTMLElement>('#hnSheet')!;
  const handle = panel.querySelector<HTMLElement>('.hn-handle')!;
  let startY = 0;
  handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchmove', e => {
    const d = e.touches[0].clientY - startY;
    if (d > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${d}px)`; }
  }, { passive: true });
  handle.addEventListener('touchend', e => {
    sheet.style.transition = '';
    if (e.changedTouches[0].clientY - startY > 100) close();
    else sheet.style.transform = '';
  });
}

export class HomeView {
  private container:     HTMLElement | null        = null;
  private _inited:       boolean                   = false;
  private _workouts:     UnifiedWorkout[]           = [];
  private _feedCursor:   number                    = Date.now();
  private _feedHasMore:  boolean                   = true;
  private _feedLoading:  boolean                   = false;
  private _feedObserver: IntersectionObserver|null = null;

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
      // but only when the target IS the tabEl itself, not its children
      tabEl.addEventListener('touchend', (e: Event) => {
        if (tabEl.classList.contains('tab-panel--active') && e.target === tabEl) {
          e.stopPropagation();
        }
      }, { passive: true });
    }

    void this.render();
    this._mountFAB();
  }

  private _mountFAB(): void {
    // Remove if already exists
    document.getElementById('homeFAB')?.remove();

    const fab = document.createElement('div');
    fab.id = 'homeFAB';
    fab.innerHTML = `
      <div class="home-fab__menu" id="homeFABMenu">
        <button class="home-fab__option" id="fabOptPost">
          <span class="home-fab__option-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 1 2-2v-7"/>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
            </svg>
          </span>
          <span class="home-fab__option-label">Post</span>
        </button>
        <button class="home-fab__option" id="fabOptActivity">
          <span class="home-fab__option-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </span>
          <span class="home-fab__option-label">Add activity</span>
        </button>
      </div>
      <button class="home-fab__btn" id="homeFABBtn" aria-label="Create">
        <svg class="home-fab__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="24" height="24">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>`;

    const tabEl = document.getElementById('tabHome');
    tabEl?.appendChild(fab);

    const btn  = fab.querySelector<HTMLElement>('#homeFABBtn')!;
    const menu = fab.querySelector<HTMLElement>('#homeFABMenu')!;

    const toggleMenu = (open: boolean) => {
      fab.classList.toggle('home-fab--open', open);
      btn.setAttribute('aria-expanded', String(open));
    };

    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu(!fab.classList.contains('home-fab--open'));
    });

    // Post option
    fab.querySelector('#fabOptPost')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu(false);
      openPostModal(async () => {
        // Push to Atlas first, then refresh feed so new post is visible immediately
        const { loadEnrichedActivities, loadUnifiedWorkouts, loadPosts } = await import('./db.js');
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        const [enriched, unified, posts] = await Promise.all([loadEnrichedActivities(), loadUnifiedWorkouts(), loadPosts()]);
        await pushNow(userId, enriched, unified, posts);
        await this.render();
      });
    });

    // Add activity option — opens SaveActivityModal with empty/manual activity
    fab.querySelector('#fabOptActivity')?.addEventListener('click', e => {
      e.stopPropagation();
      toggleMenu(false);
      const manualActivity = {
        id:          String(Date.now()),
        sport:       'running' as import('./Tracker.js').SportType,
        date:        new Date().toISOString(),
        distanceKm:  0,
        durationSec: 0,
        paceMinKm:   0,
        speedKmH:    0,
        coords:      [] as Array<[number, number]>,
        description: '',
      };
      openSaveActivityModal(
        manualActivity,
        async (enriched) => {
          // Fire in-app notification
          notifyActivityAdded(enriched.name || enriched.description, enriched.distanceKm, enriched.sport);
          // Save to unifiedWorkouts so Stats → Progress sees it immediately
          await CS.saveUnifiedWorkout({
            id:          enriched.id,
            type:        enriched.sport as import('./UnifiedWorkout.js').WorkoutType,
            source:      'manual',
            date:        new Date(enriched.date).toISOString(),
            distanceKm:  enriched.distanceKm,
            durationSec: enriched.durationSec,
            paceMinKm:   enriched.paceMinKm,
            speedKmH:    enriched.speedKmH,
            elevGain:    0,
            coords:      enriched.coords,
            name:        enriched.name,
            description: enriched.description,
            notes:       enriched.notes,
            intensity:   enriched.intensity,
            photoUrl:    enriched.photoUrl,
          } as UnifiedWorkout);
          // Push to Atlas first so the new activity is visible in feed immediately
          const { loadEnrichedActivities: _lea, loadUnifiedWorkouts: _luw, loadPosts: _lp } = await import('./db.js');
          const _userId = localStorage.getItem('mapyou_userId_profile') ?? '';
          const [_enriched, _unified, _posts] = await Promise.all([_lea(), _luw(), _lp()]);
          await pushNow(_userId, _enriched, _unified, _posts);
          // Refresh Home feed
          await this.render();
          // Refresh Stats (Progress + History)
          await statsView.render();
        },
        undefined,
      );
    });

    // Close menu on outside click
    document.addEventListener('click', (e) => {
      if (!fab.contains(e.target as Node)) toggleMenu(false);
    });
  }

  private _buildGreeting(activityCount: number): HTMLElement {
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
    const unread = getUnreadCount();
    greeting.innerHTML = `
      <div class="home-greeting__row">
        <div class="home-greeting__text-wrap">
          <h2 class="home-greeting__text">${greet}, <strong>${profile.name}</strong> 👋</h2>
          <p class="home-greeting__sub">${activityCount} activit${activityCount === 1 ? 'y' : 'ies'} recorded</p>
        </div>
        <div class="home-greeting__actions">
          <button class="home-greeting__search-btn" id="homeSearchBtn" aria-label="Search friends & clubs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
          </button>
          <button class="home-greeting__bell-btn" id="homeNotifBell" aria-label="Notifications">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
              <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
            </svg>
            ${unread > 0 ? `<span class="home-bell__badge">${unread > 9 ? '9+' : unread}</span>` : ''}
          </button>
          <button class="home-greeting__profile-btn" id="profileNavAvatar" aria-label="Open profile">
            ${avatarHtml}
          </button>
        </div>
      </div>`;

    greeting.querySelector('#profileNavAvatar')?.addEventListener('click', e => {
      e.stopPropagation();
      void profileView.open();
    });

    greeting.querySelector('#homeSearchBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      searchView.open();
    });

    greeting.querySelector('#homeNotifBell')?.addEventListener('click', e => {
      e.stopPropagation();
      _openNotifPanel();
    });

    // Update badge when notifications change
    onNotificationsChange(count => {
      const bell  = document.getElementById('homeNotifBell');
      if (!bell) return;
      const badge = bell.querySelector('.home-bell__badge');
      if (count > 0) {
        if (badge) { badge.textContent = count > 9 ? '9+' : String(count); }
        else {
          const b = document.createElement('span');
          b.className   = 'home-bell__badge';
          b.textContent = count > 9 ? '9+' : String(count);
          bell.appendChild(b);
        }
      } else {
        badge?.remove();
      }
    });

    // Sync unread count from backend on init
    void (async () => {
      try {
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        if (!userId) return;
        const res  = await fetch(`${BACKEND_URL}/notifications?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        const data = await res.json() as { status: string; unread: number };
        if (data.status === 'ok' && data.unread > 0) {
          const bell  = document.getElementById('homeNotifBell');
          if (!bell) return;
          const badge = bell.querySelector('.home-bell__badge');
          const count = data.unread;
          if (badge) { badge.textContent = count > 9 ? '9+' : String(count); }
          else {
            const b = document.createElement('span');
            b.className   = 'home-bell__badge';
            b.textContent = count > 9 ? '9+' : String(count);
            bell.appendChild(b);
          }
        }
      } catch { /* offline */ }
    })();

    return greeting;
  }

  private _buildStreakWidget(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'home-streak';

    // Compute streak from unifiedWorkouts
    const workoutDates = new Set(this._workouts.map(w => {
      const d = new Date(typeof w.date === 'number' ? w.date : w.date);
      return d.toDateString();
    }));
    // Also include enriched activities dates
    let streak = 0;
    const today = new Date(); today.setHours(0,0,0,0);
    for (let i = 0; i < 365; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      if (workoutDates.has(d.toDateString())) streak++;
      else break;
    }

    const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const days: Array<{label: string; active: boolean; isToday: boolean}> = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      days.push({
        label:   DAY_LABELS[d.getDay()],
        active:  workoutDates.has(d.toDateString()),
        isToday: i === 0,
      });
    }

    // Update best streak record (for trophies + personal records)
    updateBestStreak(streak);

    wrap.innerHTML = `
      <div class="home-streak__inner">
        <div class="home-streak__flame-wrap">
          <svg class="home-streak__flame" viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C12 2 7 8 7 13.5C7 16.5376 9.46243 19 12 19C14.5376 19 17 16.5376 17 13.5C17 11 15 9 15 9C15 9 15 11.5 13 12.5C13 12.5 14 10 12 8C12 8 12 10.5 10.5 11.5C10.5 11.5 9 10 9 8C7.5 10 7 11.5 7 13.5" fill="#f97316" opacity="0.9"/>
            <path d="M12 30C12 30 5 22 5 15C5 10.5 8 6 12 4C12 4 10 9 12 12C14 9 15 6 15 6C17 9 19 12 19 15C19 22 12 30 12 30Z" fill="#f97316"/>
            <path d="M12 28C12 28 7 21 7 16C7 13 9 10.5 12 9C12 9 11 13 13 15C13 15 11 12 14 11C15 13 16 15 16 17C16 21 12 28 12 28Z" fill="#fb923c" opacity="0.7"/>
          </svg>
          <span class="home-streak__count">${streak}</span>
        </div>
        <div class="home-streak__right">
          <div class="home-streak__title">${streak === 0 ? 'Start your streak!' : streak === 1 ? '1-day streak 🔥' : `${streak}-day streak 🔥`}</div>
          <div class="home-streak__dots">
            ${days.map(d => `
              <div class="home-streak__day">
                <div class="home-streak__dot${d.active ? ' home-streak__dot--active' : ''}${d.isToday ? ' home-streak__dot--today' : ''}"></div>
                <span class="home-streak__day-label${d.isToday ? ' home-streak__day-label--today' : ''}">${d.label}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>`;

    return wrap;
  }

  // ── Reels bar ──────────────────────────────────────────────────────────────

  private _reelsFeed: { userId: string; authorName: string; avatarB64: string | null; reels: import('./db.js').ReelRecord[]; hasUnseen: boolean }[] = [];

  private async _buildReelsBar(): Promise<HTMLElement | null> {
    const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
    this._reelsFeed = await CS.fetchFeedReels();

    const myReels = this._reelsFeed.find(u => u.userId === myUserId);
    const others  = this._reelsFeed.filter(u => u.userId !== myUserId);

    // Always show bar — user needs + button to add their first reel

    const bar = document.createElement('div');
    bar.className = 'home-reels-bar home-reels-bar--in-header';

    // My avatar with + button
    const profile     = loadProfileFromLocal();
    const myAvatarHtml = profile.avatarB64
      ? `<img src="${profile.avatarB64}" class="home-reel-avatar__img" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;border:2px solid #141417;"/>`
      : `<div class="home-reel-avatar__placeholder">${profile.name?.[0] ?? '?'}</div>`;

    const myHasReel   = !!myReels;
    const myHasUnseen = myReels?.hasUnseen ?? false;
    const myItem = document.createElement('div');
    myItem.className = 'home-reel-item';
    myItem.innerHTML = `
      <div class="home-reel-avatar ${myHasReel ? (myHasUnseen ? 'home-reel-avatar--active' : 'home-reel-avatar--seen') : ''}">
        ${myAvatarHtml}
        <div class="home-reel-add-btn" id="reelAddBtn" title="Add reel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="10" height="10"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </div>
      </div>
      <span class="home-reel-name">Your reel</span>`;

    myItem.querySelector('#reelAddBtn')?.addEventListener('click', e => {
      e.stopPropagation();
      void this._openReelCreator();
    });

    if (myHasReel) {
      myItem.querySelector('.home-reel-avatar')?.addEventListener('click', () => {
        void this._openReelsViewer(myUserId, 0);
      });
    }
    bar.appendChild(myItem);

    // Friends reels
    for (const u of others) {
      const item = document.createElement('div');
      item.className = 'home-reel-item';
      const avatarContent = u.avatarB64
        ? `<img src="${u.avatarB64}" class="home-reel-avatar__img" alt="${u.authorName}"/>`
        : `<div class="home-reel-avatar__placeholder">${u.authorName[0] ?? '?'}</div>`;
      item.innerHTML = `
        <div class="home-reel-avatar ${u.hasUnseen ? 'home-reel-avatar--active' : 'home-reel-avatar--seen'}">
          ${avatarContent}
        </div>
        <span class="home-reel-name">${u.authorName.split(' ')[0]}</span>`;
      item.querySelector('.home-reel-avatar')?.addEventListener('click', () => {
        void this._openReelsViewer(u.userId, 0);
      });
      bar.appendChild(item);
    }

    return bar;
  }

  // ── Reel Creator ───────────────────────────────────────────────────────────

  private async _openReelCreator(): Promise<void> {
    const overlay = document.createElement('div');
    overlay.className = 'home-reel-creator';
    overlay.innerHTML = `
      <div class="home-reel-creator__header">
        <button class="home-reel-creator__close" id="reelCreatorClose">✕</button>
        <span class="home-reel-creator__title">New Reel</span>
        <div style="width:28px;"></div>
      </div>
      <div class="home-reel-creator__canvas" id="reelCreatorCanvas">
        <label class="home-reel-creator__pick" for="reelFileInput">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
            <rect x="3" y="3" width="18" height="18" rx="3"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <polyline points="21,15 16,10 5,21"/>
          </svg>
          <span>Tap to add photo or video</span>
          <input type="file" accept="image/*,video/*" id="reelFileInput" style="display:none"/>
        </label>
      </div>
      <!-- Right side tools — Instagram style, visible after file selected -->
      <div class="home-reel-creator__right-tools" id="reelCreatorTools" style="display:none">
        <button class="home-reel-creator__tool-btn" id="reelTextToggle" title="Add text">
          <span style="font-size:16px;font-weight:700;color:#fff;">Aa</span>
          <span class="home-reel-creator__tool-lbl">Text</span>
        </button>
        <div class="home-reel-creator__tool-btn" id="reelColorPicker" title="Color">
          <div class="home-reel-creator__color-wheel"></div>
          <span class="home-reel-creator__tool-lbl">Color</span>
        </div>
        <button class="home-reel-creator__tool-btn" id="reelSizePicker" title="Size">
          <span style="font-size:14px;font-weight:700;color:#fff;" id="reelSizeLabel">M</span>
          <span class="home-reel-creator__tool-lbl">Size</span>
        </button>
      </div>
      <!-- Text input — shown when text tool active -->
      <input type="text" class="home-reel-creator__caption" id="reelCaption" placeholder="Type text…" maxlength="80" style="display:none"/>
      <!-- Bottom bar — share button + hint -->
      <div class="home-reel-creator__bottom">
        <span class="home-reel-creator__hint">Max 10 MB photos · 500 MB videos</span>
        <button class="home-reel-creator__share" id="reelCreatorShare" disabled>Share ➤</button>
      </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('home-reel-creator--visible'));

    let selectedFile: File | null = null;
    let captionColor = '#ffffff';
    let captionSize  = 20;
    let isDragging   = false;
    let dragStartX   = 0, dragStartY   = 0;
    let captionPct   = { x: 50, y: 80 };

    const canvas    = overlay.querySelector<HTMLElement>('#reelCreatorCanvas')!;
    const tools     = overlay.querySelector<HTMLElement>('#reelCreatorTools')!;
    const shareBtn  = overlay.querySelector<HTMLButtonElement>('#reelCreatorShare')!;
    const captionEl = overlay.querySelector<HTMLInputElement>('#reelCaption')!;

    overlay.querySelector('#reelCreatorClose')?.addEventListener('click', () => {
      overlay.classList.remove('home-reel-creator--visible');
      setTimeout(() => overlay.remove(), 350);
    });

    // File input
    overlay.querySelector('#reelFileInput')?.addEventListener('change', (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const isVid = file.type.startsWith('video/');
      if (!isVid && file.size > 10 * 1024 * 1024) { alert('Max 10 MB for photos'); return; }
      if (isVid  && file.size > 500 * 1024 * 1024) { alert('Max 500 MB for videos'); return; }
      selectedFile = file;
      const url = URL.createObjectURL(file);
      canvas.innerHTML = isVid
        ? `<video src="${url}" class="home-reel-creator__preview" autoplay muted loop playsinline></video><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div>`
        : `<img src="${url}" class="home-reel-creator__preview" alt="preview"/><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div>`;
      // Reset tool overlays so ensureTools() re-creates them inside new canvas
      _palette = null; _sizeWrap = null;
      tools.style.display = 'flex';
      shareBtn.disabled = false;
    });

    // Caption drag
    const updateCaptionOverlay = () => {
      const ov = overlay.querySelector<HTMLElement>('#captionOverlay');
      if (!ov) return;
      const text = captionEl.value;
      ov.innerHTML = text ? `<span class="home-reel-creator__caption-text" style="font-size:${captionSize}px;color:${captionColor};left:${captionPct.x}%;top:${captionPct.y}%;transform:translate(-50%,-50%)">${text}</span>` : '';
    };
    captionEl.addEventListener('input', updateCaptionOverlay);

    const isToolEl = (t: EventTarget | null) => {
      if (!t) return false;
      const el = t as HTMLElement;
      return !!(el.closest('.home-reel-creator__size-slider-wrap') ||
                el.closest('.home-reel-creator__palette') ||
                el.closest('.home-reel-creator__right-tools') ||
                el.closest('.home-reel-creator__caption'));
    };
    canvas.addEventListener('mousedown', e => {
      if (isToolEl(e.target)) return;
      isDragging = true; dragStartX = e.clientX; dragStartY = e.clientY;
    });
    canvas.addEventListener('touchstart', e => {
      if (isToolEl(e.target)) return;
      isDragging = true; dragStartX = e.touches[0].clientX; dragStartY = e.touches[0].clientY;
    }, { passive: true });
    const onMove = (x: number, y: number) => {
      if (!isDragging) return;
      const rect = canvas.getBoundingClientRect();
      captionPct = { x: ((x - rect.left) / rect.width) * 100, y: ((y - rect.top) / rect.height) * 100 };
      updateCaptionOverlay();
    };
    canvas.addEventListener('mousemove', e => onMove(e.clientX, e.clientY));
    canvas.addEventListener('touchmove', e => onMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
    window.addEventListener('mouseup', () => { isDragging = false; });
    window.addEventListener('touchend', () => { isDragging = false; });

    // Colors
    overlay.querySelectorAll('.home-reel-creator__color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        captionColor = (btn as HTMLElement).dataset.color ?? '#ffffff';
        updateCaptionOverlay();
      });
    });

    // Sizes
    overlay.querySelectorAll('.home-reel-creator__sizes button').forEach(btn => {
      btn.addEventListener('click', () => {
        overlay.querySelectorAll('.home-reel-creator__sizes button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        captionSize = Number((btn as HTMLElement).dataset.size ?? 20);
        updateCaptionOverlay();
      });
    });

    // Share
    // Show caption input when text tool clicked
    overlay.querySelector('#reelTextToggle')?.addEventListener('click', () => {
      const cap = overlay.querySelector<HTMLInputElement>('#reelCaption')!;
      cap.style.display = cap.style.display === 'none' ? 'block' : 'none';
      if (cap.style.display === 'block') cap.focus();
    });

    // Color & size tools — lazy init after file pick to survive canvas.innerHTML reset
    const COLORS = ['#ffffff','#000000','#ff3b30','#ff9500','#ffcc00','#00c46a','#007aff','#af52de','#ff2d55','#5ac8fa'];
    let _palette: HTMLElement | null = null;
    let _sizeWrap: HTMLElement | null = null;

    const ensureTools = () => {
      if (_palette) return;
      _palette = document.createElement('div');
      _palette.className = 'home-reel-creator__palette';
      _palette.style.display = 'none';
      _palette.innerHTML = COLORS.map(c =>
        `<button class="home-reel-creator__color-swatch" data-color="${c}" style="background:${c}"></button>`
      ).join('');
      canvas.appendChild(_palette);
      _palette.addEventListener('click', e => {
        const btn = (e.target as HTMLElement).closest('[data-color]') as HTMLElement | null;
        if (!btn) return;
        captionColor = btn.dataset.color ?? '#ffffff';
        const wheel = overlay.querySelector<HTMLElement>('.home-reel-creator__color-wheel');
        if (wheel) wheel.style.background = captionColor;
        updateCaptionOverlay();
        _palette!.style.display = 'none';
      });

      _sizeWrap = document.createElement('div');
      _sizeWrap.className = 'home-reel-creator__size-slider-wrap';
      _sizeWrap.style.display = 'none';
      _sizeWrap.innerHTML = `
        <input type="range" min="12" max="48" value="${captionSize}" step="1" class="home-reel-creator__size-slider"/>
        <span class="home-reel-creator__size-val">${captionSize}px</span>`;
      canvas.appendChild(_sizeWrap);
      _sizeWrap.querySelector('input')?.addEventListener('input', e => {
        captionSize = Number((e.target as HTMLInputElement).value);
        const val = _sizeWrap!.querySelector<HTMLElement>('.home-reel-creator__size-val');
        if (val) val.textContent = `${captionSize}px`;
        const lbl = overlay.querySelector<HTMLElement>('#reelSizeLabel');
        if (lbl) lbl.textContent = String(captionSize);
        updateCaptionOverlay();
      });
    };

    overlay.querySelector('#reelColorPicker')?.addEventListener('click', () => {
      ensureTools();
      const isOpen = _palette!.style.display !== 'none';
      _palette!.style.display = isOpen ? 'none' : 'flex';
      _sizeWrap!.style.display = 'none';
    });

    overlay.querySelector('#reelSizePicker')?.addEventListener('click', () => {
      ensureTools();
      const isOpen = _sizeWrap!.style.display !== 'none';
      _sizeWrap!.style.display = isOpen ? 'none' : 'flex';
      _palette!.style.display = 'none';
    });

    shareBtn.addEventListener('click', async () => {
      if (!selectedFile) return;
      shareBtn.disabled  = true;
      shareBtn.textContent = 'Uploading…';
      const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
      const reel = await uploadReel(selectedFile, myUserId, {
        caption:      captionEl.value || null,
        captionX:     captionPct.x,
        captionY:     captionPct.y,
        captionSize,
        captionColor,
      });
      if (reel) {
        overlay.classList.remove('home-reel-creator--visible');
        setTimeout(() => overlay.remove(), 350);
        await this.render();
      } else {
        shareBtn.disabled  = false;
        shareBtn.textContent = 'Share';
        alert('Upload failed, please try again');
      }
    });
  }

  // ── Reels Viewer ───────────────────────────────────────────────────────────

  private _viewerTimer: ReturnType<typeof setTimeout> | null = null;
  private _viewerInterval: ReturnType<typeof setInterval> | null = null;

  private async _openReelsViewer(startUserId: string, startIndex: number): Promise<void> {
    const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
    const allGroups = this._reelsFeed;
    let groupIdx = allGroups.findIndex(u => u.userId === startUserId);
    if (groupIdx < 0) groupIdx = 0;
    let reelIdx = startIndex;

    const overlay = document.createElement('div');
    overlay.className = 'home-reel-viewer';
    overlay.addEventListener('contextmenu', e => e.preventDefault());
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('home-reel-viewer--visible'));

    const renderViewer = () => {
      if (groupIdx >= allGroups.length) {
        closeViewer(); return;
      }
      const group = allGroups[groupIdx];
      if (reelIdx >= group.reels.length) {
        groupIdx++; reelIdx = 0;
        renderViewer(); return;
      }
      const reel = group.reels[reelIdx];
      const totalReels = group.reels.length;

      // Mark as viewed
      void CS.markReelViewed(reel.id);

      const isLiked = reel.likes.includes(myUserId);
      const isVideo = reel.mediaType === 'video';
      const dur     = isVideo ? reel.duration : (reel.duration || 5);

      overlay.innerHTML = `
        <div class="home-reel-viewer__bg">
          ${isVideo
            ? `<video class="home-reel-viewer__media" src="${reel.mediaUrl}" autoplay muted playsinline id="reelViewerVideo" oncontextmenu="return false"></video>`
            : `<img class="home-reel-viewer__media" src="${reel.mediaUrl}" alt="reel" oncontextmenu="return false" draggable="false"/>`}
          ${reel.caption ? `<span class="home-reel-viewer__caption" style="left:${reel.captionX}%;top:${reel.captionY}%;font-size:${reel.captionSize}px;color:${reel.captionColor}">${reel.caption}</span>` : ''}
        </div>
        <div class="home-reel-viewer__top">
          <div class="home-reel-viewer__bars">
            ${group.reels.map((_, i) => `<div class="home-reel-viewer__bar ${i < reelIdx ? 'done' : i === reelIdx ? 'active' : ''}" id="reelBar${i}"></div>`).join('')}
          </div>
          <div class="home-reel-viewer__author" id="reelViewerAuthor" style="cursor:pointer">
            <div class="home-reel-avatar ${reel.views.includes(myUserId) ? 'home-reel-avatar--seen' : 'home-reel-avatar--active'} home-reel-avatar--sm">
              ${group.avatarB64 ? `<img src="${group.avatarB64}" class="home-reel-avatar__img"/>` : `<div class="home-reel-avatar__placeholder">${group.authorName[0]}</div>`}
            </div>
            <span class="home-reel-viewer__name">${group.authorName}</span>
            <span class="home-reel-viewer__time">${(() => { const s=Math.floor((Date.now()-reel.createdAt)/1000); return s<60?'just now':s<3600?Math.floor(s/60)+'m ago':Math.floor(s/3600)+'h ago'; })()}</span>
          </div>
          <button class="home-reel-viewer__close" id="reelViewerClose">✕</button>
        </div>
        <div class="home-reel-viewer__actions">
          <button class="home-reel-viewer__like ${isLiked ? 'liked' : ''}" id="reelViewerLike">
            <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span id="reelLikeCount">${reel.likes.length}</span>
          </button>
          ${group.userId === myUserId ? `<button class="home-reel-viewer__delete" id="reelViewerDelete">🗑</button>` : ''}
        </div>
        <div class="home-reel-viewer__tap-left" id="reelTapLeft"></div>
        <div class="home-reel-viewer__tap-right" id="reelTapRight"></div>`;

      // Progress bar animation
      if (this._viewerTimer) clearTimeout(this._viewerTimer);
      if (this._viewerInterval) clearInterval(this._viewerInterval);

      const bar = overlay.querySelector<HTMLElement>(`#reelBar${reelIdx}`);
      let elapsed = 0;
      const step = 50;
      const videEl = overlay.querySelector<HTMLVideoElement>('#reelViewerVideo');

      const getDur = () => isVideo && videEl ? (videEl.duration || dur) : dur;

      let paused = false;
      overlay.querySelector('.home-reel-viewer__bg')?.addEventListener('touchstart', () => { paused = true; videEl?.pause(); }, { passive: true });
      overlay.querySelector('.home-reel-viewer__bg')?.addEventListener('touchend', () => { paused = false; videEl?.play().catch(()=>{}); });

      this._viewerInterval = setInterval(() => {
        if (paused) return;
        elapsed += step;
        const pct = Math.min((elapsed / (getDur() * 1000)) * 100, 100);
        if (bar) bar.style.setProperty('--p', `${pct}%`);
        if (pct >= 100) {
          clearInterval(this._viewerInterval!);
          reelIdx++;
          renderViewer();
        }
      }, step);

      // Close
      overlay.querySelector('#reelViewerClose')?.addEventListener('click', closeViewer);

      // Author click — pause reel and open profile
      overlay.querySelector('#reelViewerAuthor')?.addEventListener('click', () => {
        // Pause timer
        if (this._viewerInterval) { clearInterval(this._viewerInterval); this._viewerInterval = null; }
        const vid = overlay.querySelector<HTMLVideoElement>('#reelViewerVideo');
        vid?.pause();

        // Lower viewer z-index so profile appears on top
        overlay.style.zIndex = '4999';

        // Open profile
        if (group.userId === myUserId) {
          void profileView.open();
        } else {
          openPublicProfile(group.userId);
        }

        // Resume when profile closes — poll for overlay removal
        const resumeWatcher = setInterval(() => {
          const profileOpen = document.querySelector('.pv-overlay--visible');
          if (!profileOpen) {
            clearInterval(resumeWatcher);
            overlay.style.zIndex = '9100'; // restore viewer on top
            vid?.play().catch(() => {});
            // Restart interval from current position
            let elapsed = 0;
            const step = 50;
            const barEl = overlay.querySelector<HTMLElement>(`#reelBar${reelIdx}`);
            const getDur = () => reel.mediaType === 'video' && vid ? (vid.duration || reel.duration) : (reel.duration || 5);
            this._viewerInterval = setInterval(() => {
              elapsed += step;
              const pct = Math.min((elapsed / (getDur() * 1000)) * 100, 100);
              if (barEl) barEl.style.setProperty('--p', `${pct}%`);
              if (pct >= 100) { clearInterval(this._viewerInterval!); reelIdx++; renderViewer(); }
            }, step);
          }
        }, 300);
      });

      // Like
      overlay.querySelector('#reelViewerLike')?.addEventListener('click', async () => {
        const result = await CS.likeReel(reel.id);
        if (result) {
          const btn = overlay.querySelector('#reelViewerLike');
          btn?.classList.toggle('liked', result.liked);
          const countEl = overlay.querySelector('#reelLikeCount');
          if (countEl) countEl.textContent = String(result.count);
        }
      });

      // Delete (own reel)
      overlay.querySelector('#reelViewerDelete')?.addEventListener('click', async () => {
        if (!confirm('Delete this reel?')) return;
        await CS.deleteReel(reel.id);
        closeViewer();
        await this.render();
      });

      // Tap navigation
      overlay.querySelector('#reelTapLeft')?.addEventListener('click', () => {
        if (reelIdx > 0) { reelIdx--; } else if (groupIdx > 0) { groupIdx--; reelIdx = allGroups[groupIdx].reels.length - 1; }
        renderViewer();
      });
      overlay.querySelector('#reelTapRight')?.addEventListener('click', () => {
        reelIdx++; renderViewer();
      });
    };

    const closeViewer = () => {
      if (this._viewerTimer) clearTimeout(this._viewerTimer);
      if (this._viewerInterval) clearInterval(this._viewerInterval);
      overlay.classList.remove('home-reel-viewer--visible');
      setTimeout(() => overlay.remove(), 300);
    };

    renderViewer();
  }

  async render(): Promise<void> {
    this.container = document.querySelector<HTMLElement>('#tabHome .home-scroll');
    if (!this.container) return;
    this._inited = true;
    const scroll = this.container;

    scroll.innerHTML = '<div class="home-loading"><div class="home-loading__spinner"></div></div>';

    const [activities, posts, workouts] = await Promise.all([
      loadEnrichedActivities(),
      loadPosts(),
      loadUnifiedWorkouts(),
    ]);
    this._workouts = workouts;

    scroll.innerHTML = '';
    scroll.appendChild(this._buildGreeting(activities.length + posts.length));

    // Reels bar — directly under header, BEFORE streak (Instagram style)
    const reelsBar = await this._buildReelsBar();
    if (reelsBar) scroll.appendChild(reelsBar);

    scroll.appendChild(this._buildStreakWidget());

    // Pobierz unified feed z Atlas (własne + znajomych)
    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
    let serverFeed: Array<{ kind: string; date: number; data: Record<string, unknown> }> = [];
    let serverRes: { hasMore?: boolean } = {};
    if (userId) {
      try {
        const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        if (res.ok) {
          const d = await res.json() as { status: string; hasMore: boolean; data: typeof serverFeed };
          serverFeed = d.data ?? [];
          this._feedHasMore = d.hasMore ?? false;
          if (serverFeed.length > 0) this._feedCursor = serverFeed[serverFeed.length - 1].date as number;
        }
      } catch { /* offline */ }
    }

    type FeedItem = { kind: string; date: number; data: Record<string, unknown>; isLocal?: boolean };

    const feed: FeedItem[] = serverFeed.length > 0
      ? serverFeed
      : [
          ...activities.map(a => ({ kind: 'activity', date: a.date, data: a as unknown as Record<string, unknown>, isLocal: true })),
          ...posts.map(p => ({ kind: 'post', date: p.date, data: p as unknown as Record<string, unknown>, isLocal: true })),
        ].sort((a, b) => b.date - a.date);

    if (feed.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'home-empty';
      empty.innerHTML = `
        <div class="home-empty__icon">🏃</div>
        <h3 class="home-empty__title">Nothing here yet</h3>
        <p class="home-empty__sub">Finish a workout or tap + to create a post</p>`;
      scroll.appendChild(empty);
      return;
    }

    feed.forEach((item, idx) => {
      const isOwn = (item.data.userId === userId) || !!item.isLocal;
      let card: HTMLElement;

      if (isOwn && item.kind === 'activity') {
        const localAct = activities.find(a => a.id === (item.data.activityId ?? item.data.id));
        if (localAct) {
          // Save coordsEnc BEFORE mutating coords
          const enc = (item.data.coordsEnc as string | null) ??
            (localAct.coords && localAct.coords.length > 0
              ? encodePolyline(localAct.coords as Array<[number,number]>)
              : null);
          (item.data as Record<string,unknown>)._coordsEncResolved = enc;
          (localAct as unknown as Record<string,unknown>).coordsEnc = enc;
          (localAct as unknown as Record<string,unknown>).coords = [];
        }
        card = localAct ? buildCard(localAct) : this._buildFriendFeedCard(item.kind, item.data, userId);
      } else if (isOwn && item.kind === 'post') {
        const localPost = posts.find(p => p.id === (item.data.postId ?? item.data.id));
        card = localPost
          ? buildPostCard(localPost, () => this.render())
          : this._buildFriendFeedCard(item.kind, item.data, userId);
      } else {
        card = this._buildFriendFeedCard(item.kind, item.data, userId);
      }

      // Set like/comment counts from feed response
      const itemId = (item.data.activityId ?? item.data.postId ?? item.data.id) as string;
      const lc = (item.data._likeCount ?? 0) as number;
      const cc = (item.data._commentCount ?? 0) as number;
      if (lc > 0) {
        const likeEl = card.querySelector<HTMLElement>(`[data-like-count="${itemId}"], [data-like-count="p_${itemId}"]`);
        if (likeEl) likeEl.textContent = String(lc);
      }
      if (cc > 0) {
        const commentEl = card.querySelector<HTMLElement>(`[data-comment-count="${itemId}"]`);
        if (commentEl) commentEl.textContent = String(cc);
      }

      card.style.animationDelay = `${idx * 60}ms`;
      scroll.appendChild(card);

      const actId = (item.data.activityId ?? item.data.id) as string;
      if (item.kind === 'activity') {
        requestAnimationFrame(() => {
          setTimeout(() => {
            const coordsEnc = (item.data._coordsEncResolved ?? item.data.coordsEnc ?? null) as string | null;
            const localAct = activities.find(a => a.id === actId);
            const enc = coordsEnc ?? null;
            if (enc) {
              const mapEl = card.querySelector<HTMLElement>('.home-card__map-wrap--canvas, .home-card__map-wrap');
              if (mapEl) {
                mapEl.style.display = 'block';
                const coords = decodePolyline(enc);
                renderMinimapCanvas(mapEl, coords, (item.data.sport ?? localAct?.sport ?? 'running') as string);
              }
            }
          }, 80 + idx * 30);
        });
      }
    });

    const friendsFeedEl = document.getElementById('friendsFeed');
    if (friendsFeedEl) friendsFeedEl.innerHTML = '';

    // Batch load liked state
    if (userId && feed.length > 0) {
      const itemIds = feed.map(f => (f.data.activityId ?? f.data.postId ?? f.data.id) as string).filter(Boolean);
      void fetch(`${BACKEND_URL}/feed/likes/batch?userId=${encodeURIComponent(userId)}&items=${encodeURIComponent(itemIds.join(','))}`, { cache: 'no-store' })
        .then(r => r.json())
        .then((resp: { status: string; data: Record<string, { count: number; liked: boolean }> }) => {
          if (resp.status !== 'ok') return;
          for (const [id, info] of Object.entries(resp.data)) {
            if (!info.liked) continue;
            const btn = scroll.querySelector<HTMLElement>(`[data-like-count="${id}"]`)?.closest('.home-card__action') as HTMLElement | null;
            if (btn) btn.classList.add('home-card__action--liked');
            const btnP = scroll.querySelector<HTMLElement>(`[data-like-count="p_${id}"]`)?.closest('.home-card__action') as HTMLElement | null;
            if (btnP) btnP.classList.add('home-card__action--liked');
          }
        }).catch(() => {});
    }

    // Infinite scroll
    this._setupInfiniteScroll(scroll, activities, posts, userId);
  }

  private _setupInfiniteScroll(scroll: HTMLElement, activities: import('./db.js').EnrichedActivity[], posts: import('./db.js').PostRecord[], userId: string): void {
    this._feedObserver?.disconnect();
    document.getElementById('feedSentinel')?.remove();
    if (!this._feedHasMore) return;
    const sentinel = document.createElement('div');
    sentinel.id = 'feedSentinel';
    sentinel.style.height = '1px';
    scroll.appendChild(sentinel);
    this._feedObserver = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && !this._feedLoading && this._feedHasMore) {
        void this._loadMoreFeed(scroll, activities, posts, userId);
      }
    }, { rootMargin: '300px' });
    this._feedObserver.observe(sentinel);
  }

  private async _loadMoreFeed(scroll: HTMLElement, activities: import('./db.js').EnrichedActivity[], posts: import('./db.js').PostRecord[], userId: string): Promise<void> {
    if (this._feedLoading || !this._feedHasMore) return;
    this._feedLoading = true;
    const spinner = document.createElement('div');
    spinner.id = 'feedLoadMore';
    spinner.className = 'home-loading';
    spinner.innerHTML = '<div class="home-loading__spinner"></div>';
    document.getElementById('feedSentinel')?.before(spinner);
    try {
      const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}&before=${this._feedCursor}`, { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json() as { status: string; hasMore: boolean; data: Array<{ kind: string; date: number; data: Record<string, unknown> }> };
        const newItems = d.data ?? [];
        this._feedHasMore = d.hasMore ?? false;
        if (newItems.length > 0) {
          this._feedCursor = newItems[newItems.length - 1].date;
          document.getElementById('feedLoadMore')?.remove();
          document.getElementById('feedSentinel')?.remove();
          newItems.forEach((item, idx) => {
            const isOwn = item.data.userId === userId;
            let card: HTMLElement;
            let resolvedEnc: string | null = null;
            if (isOwn && item.kind === 'activity') {
              const local = activities.find(a => a.id === (item.data.activityId ?? item.data.id));
              if (local) {
                resolvedEnc = (item.data.coordsEnc as string | null) ??
                  (local.coords && local.coords.length > 0 ? encodePolyline(local.coords as Array<[number,number]>) : null);
                (local as unknown as Record<string,unknown>).coordsEnc = resolvedEnc;
                (local as unknown as Record<string,unknown>).coords = [];
              }
              card = local ? buildCard(local) : this._buildFriendFeedCard(item.kind, item.data, userId);
            } else if (isOwn && item.kind === 'post') {
              const local = posts.find(p => p.id === (item.data.postId ?? item.data.id));
              card = local ? buildPostCard(local, () => this.render()) : this._buildFriendFeedCard(item.kind, item.data, userId);
            } else {
              card = this._buildFriendFeedCard(item.kind, item.data, userId);
              resolvedEnc = (item.data.coordsEnc as string | null) ?? null;
            }
            const lc = (item.data._likeCount ?? 0) as number;
            if (lc > 0) { const id = (item.data.activityId ?? item.data.postId ?? item.data.id) as string; const el = card.querySelector<HTMLElement>('[data-like-count="' + id + '"], [data-like-count="p_' + id + '"]'); if (el) el.textContent = String(lc); }
            card.style.animationDelay = String(idx * 60) + 'ms';
            scroll.appendChild(card);
            // Render canvas minimap
            if (item.kind === 'activity' && resolvedEnc) {
              requestAnimationFrame(() => {
                setTimeout(() => {
                  const mapEl = card.querySelector<HTMLElement>('.home-card__map-wrap--canvas, .home-card__map-wrap');
                  if (mapEl) {
                    mapEl.style.display = 'block';
                    renderMinimapCanvas(mapEl, decodePolyline(resolvedEnc!), (item.data.sport ?? 'running') as string);
                  }
                }, 80 + idx * 30);
              });
            }
          });
          if (this._feedHasMore) this._setupInfiniteScroll(scroll, activities, posts, userId);
        } else {
          this._feedHasMore = false;
        }
      }
    } catch {}
    document.getElementById('feedLoadMore')?.remove();
    this._feedLoading = false;
  }

  private async _renderFriendsFeed(): Promise<void> {
    const feedEl = document.getElementById('friendsFeed');
    if (!feedEl) return;

    const userId = localStorage.getItem('mapyou_userId_profile');
    if (!userId) return;

    try {
      const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}`);
      if (!res.ok) { feedEl.innerHTML = ''; return; }
      const data = await res.json() as {
        status: string;
        data: Array<{ kind: string; date: number; data: Record<string, unknown> }>;
      };

      // Filtruj tylko aktywności znajomych (nie własne)
      const friendItems = data.data.filter(item => item.data.userId !== userId);
      if (!friendItems.length) { feedEl.innerHTML = ''; return; }

      const header = document.createElement('div');
      header.className = 'friends-feed__header';
      header.innerHTML = '<span>Friends Activity</span>';

      feedEl.innerHTML = '';
      feedEl.appendChild(header);

      for (const item of friendItems) {
        const card = this._buildFriendFeedCard(item.kind, item.data, userId);
        feedEl.appendChild(card);
      }
    } catch {
      feedEl.innerHTML = '';
    }
  }

  private _buildFriendFeedCard(
    kind:     string,
    data:     Record<string, unknown>,
    myUserId: string,
  ): HTMLElement {
    if (kind === 'activity') {
      const act = {
        id:          (data.activityId ?? data.id ?? '') as string,
        sport:       (data.sport ?? 'running') as string,
        date:        data.date as number,
        name:        (data.name ?? data.description ?? '') as string,
        description: (data.description ?? '') as string,
        photoUrl:    (data.photoUrl ?? null) as string | null,
        minimapUrl:  (data.minimapUrl ?? null) as string | null,
        coordsEnc:   (data.coordsEnc ?? null) as string | null,
        distanceKm:  +(data.distanceKm ?? 0),
        durationSec: +(data.durationSec ?? 0),
        paceMinKm:   +(data.paceMinKm ?? 0),
        speedKmH:    +(data.speedKmH ?? 0),
        intensity:   +(data.intensity ?? 0),
        notes:       (data.notes ?? '') as string,
        coords:      [] as Array<[number, number]>,
      } as unknown as import('./db.js').EnrichedActivity;

      const card = buildCard(act);

      // Override avatar and name with friend's
      const avatarEl = card.querySelector<HTMLElement>('.home-card__avatar--user');
      const authorName = (data.authorName ?? '') as string;
      if (avatarEl) {
        const avatar = (data.authorAvatarUrl ?? null) as string | null;
        avatarEl.innerHTML = avatar
          ? `<img src="${avatar}" class="home-card__avatar-img" alt="avatar"/>`
          : `<span style="font-size:16px;font-weight:700">${authorName.charAt(0).toUpperCase()}</span>`;
        avatarEl.style.background = 'rgba(74,222,128,0.15)';
        avatarEl.style.borderColor = 'rgba(74,222,128,0.3)';
      }
      // Override name shown in header
      const nameEl = card.querySelector<HTMLElement>('.home-card__name');
      if (nameEl && authorName) nameEl.textContent = act.name || authorName;

      // Replace avatar element to remove own-profile handler from buildCard
      const friendUserId = (data.userId ?? '') as string;
      if (avatarEl) {
        const newAvatarEl = avatarEl.cloneNode(true) as HTMLElement;
        avatarEl.replaceWith(newAvatarEl);
        newAvatarEl.removeAttribute('data-own-profile');
        newAvatarEl.addEventListener('click', e => {
          e.stopPropagation();
          if (friendUserId) void openPublicProfile(friendUserId);
        });
      }

      // Override like button to use Atlas
      const likeBtn = card.querySelector<HTMLElement>('.home-card__action--like');
      const newLike = likeBtn?.cloneNode(true) as HTMLElement;
      if (likeBtn && newLike) {
        likeBtn.replaceWith(newLike);
        newLike.addEventListener('click', async e => {
          e.stopPropagation();
          const res = await fetch(`${BACKEND_URL}/feed/like`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: myUserId, itemId: act.id, itemType: 'activity' }),
          });
          if (res.ok) {
            const d = await res.json() as { liked: boolean; count: number };
            newLike.classList.toggle('home-card__action--liked', d.liked);
            const el = card.querySelector<HTMLElement>(`[data-like-count="${act.id}"]`);
            if (el) el.textContent = String(d.count);
          }
        });
      }

      return card;
    } else {
      const post = {
        id:         (data.postId ?? data.id ?? '') as string,
        type:       'post' as const,
        date:       data.date as number,
        title:      (data.title ?? '') as string,
        body:       (data.body ?? '') as string,
        photoUrl:   (data.photoUrl ?? null) as string | null,
        authorName: (data.authorName ?? '') as string,
        avatarB64:  (data.authorAvatarUrl ?? null) as string | null,
      } as import('./db.js').PostRecord;

      const card = buildPostCard(post, () => {});
      card.querySelector('.home-card__post-menu-btn')?.remove();

      // Replace avatar element to remove own-profile handler
      const postFriendId = (data.userId ?? '') as string;
      const postAvatarEl = card.querySelector<HTMLElement>('.home-card__avatar--user');
      if (postAvatarEl) {
        const newPostAvatar = postAvatarEl.cloneNode(true) as HTMLElement;
        postAvatarEl.replaceWith(newPostAvatar);
        newPostAvatar.addEventListener('click', e => {
          e.stopPropagation();
          if (postFriendId) void openPublicProfile(postFriendId);
        });
      }

      const likeBtn = card.querySelector<HTMLElement>('.home-card__action--like');
      const newLike = likeBtn?.cloneNode(true) as HTMLElement;
      if (likeBtn && newLike) {
        likeBtn.replaceWith(newLike);
        newLike.addEventListener('click', async e => {
          e.stopPropagation();
          const res = await fetch(`${BACKEND_URL}/feed/like`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: myUserId, itemId: post.id, itemType: 'post' }),
          });
          if (res.ok) {
            const d = await res.json() as { liked: boolean; count: number };
            newLike.classList.toggle('home-card__action--liked', d.liked);
            const el = card.querySelector<HTMLElement>(`[data-like-count="p_${post.id}"]`);
            if (el) el.textContent = String(d.count);
          }
        });
      }

      return card;
    }
  }

  private async _loadFeedItemMeta(
    card:     HTMLElement,
    itemId:   string,
    itemType: string,
    userId:   string,
  ): Promise<void> {
    try {
      const [lr, cr] = await Promise.all([
        fetch(`${BACKEND_URL}/feed/likes/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`),
        fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(itemId)}`),
      ]);
      if (lr.ok) {
        const ld = await lr.json() as { count: number; liked: boolean };
        const btn = card.querySelector('.ff-card__like');
        if (btn) {
          btn.classList.toggle('ff-card__like--liked', ld.liked);
          const el = btn.querySelector('.ff-like-count');
          if (el) el.textContent = String(ld.count);
        }
      }
      if (cr.ok) {
        const cd = await cr.json() as { data: Array<{ authorName: string; text: string }> };
        const list = card.querySelector('.ff-comments__list');
        if (list) {
          list.innerHTML = cd.data.map(c =>
            `<div class="ff-comment"><span class="ff-comment__author">${c.authorName}</span><span class="ff-comment__text">${c.text}</span></div>`
          ).join('');
        }
        const el = card.querySelector('.ff-comment-count');
        if (el) el.textContent = String(cd.data.length);
      }
    } catch {}
  }

  switchToHome(): void {
    const btn = document.querySelector<HTMLElement>('.bottom-nav__item[data-tab="tabHome"]');
    btn?.click();
  }
}

export const homeView = new HomeView();


// ── Exported reel viewer for profile views ────────────────────────────────────
export function openReelViewer(
  group: { userId: string; authorName?: string; avatarB64?: string | null; reels: Record<string,unknown>[]; hasUnseen?: boolean },
  onAllViewed?: () => void,
): void {
  const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
  let reelIdx    = 0;

  const overlay = document.createElement('div');
  overlay.className = 'home-reel-viewer';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('home-reel-viewer--visible'));

  const render = () => {
    const reel    = group.reels[reelIdx] as Record<string,unknown>;
    const reelId  = reel.reelId as string;
    const url     = reel.mediaUrl as string;
    const isVideo = (reel.mediaType as string) === 'video';
    const views   = (reel.views as string[]) ?? [];

    overlay.innerHTML = `
      <div class="home-reel-viewer__bg">
        ${isVideo
          ? `<video class="home-reel-viewer__media" src="${url}" autoplay muted playsinline></video>`
          : `<img class="home-reel-viewer__media" src="${url}" alt="reel" draggable="false"/>`}
        <div class="home-reel-viewer__top">
          <div class="home-reel-viewer__bars">
            ${group.reels.map((_, i) => `<div class="home-reel-viewer__bar ${i < reelIdx ? 'done' : i === reelIdx ? 'active' : ''}" id="reelBar${i}"></div>`).join('')}
          </div>
          <div class="home-reel-viewer__author">
            <div class="home-reel-avatar ${views.includes(myUserId) ? 'home-reel-avatar--seen' : 'home-reel-avatar--active'} home-reel-avatar--sm">
              ${group.avatarB64 ? `<img src="${group.avatarB64}" class="home-reel-avatar__img"/>` : ''}
            </div>
            <span class="home-reel-viewer__name">${group.authorName ?? ''}</span>
          </div>
          <button class="home-reel-viewer__close" id="reelClose">✕</button>
        </div>
      </div>`;

    // Mark as viewed
    if (!views.includes(myUserId)) {
      void fetch(`${BACKEND_URL}/reels/${encodeURIComponent(reelId)}/view`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: myUserId }),
      });
    }

    overlay.querySelector('#reelClose')?.addEventListener('click', () => {
      overlay.classList.remove('home-reel-viewer--visible');
      setTimeout(() => { overlay.remove(); onAllViewed?.(); }, 300);
    });

    overlay.querySelector('.home-reel-viewer__media')?.addEventListener('click', () => {
      if (reelIdx < group.reels.length - 1) { reelIdx++; render(); }
      else {
        overlay.classList.remove('home-reel-viewer--visible');
        setTimeout(() => { overlay.remove(); onAllViewed?.(); }, 300);
      }
    });
  };

  render();
}
