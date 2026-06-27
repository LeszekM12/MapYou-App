// ─── HOME VIEW — Activity Feed ────────────────────────────────────────────────
// src/modules/HomeView.ts

import { loadEnrichedActivities, deleteEnrichedActivity, deleteActivity, updateEnrichedActivityFields, type EnrichedActivity } from './db.js';
import { isRouteSaved, saveRoute, unsaveRoute, type SavedRoute } from './SavedRoutes.js';
import { openPublicProfile } from './PublicProfile.js';
import { BACKEND_URL } from '../config.js';
import { renderMinimapCanvas, decodePolyline, encodePolyline, pushNow, uploadReel } from './cloudSync.js';
import { SPORT_COLORS, SPORT_ICONS, getIcon, getColor, getSportLabel, formatDuration, formatPace, formatDistance } from './Tracker.js';
import type { SportType } from './Tracker.js';
import { generateShareImageFromEnriched, composeActivityReel } from './ShareImage.js';
import { loadProfileFromLocal } from './UserProfile.js';
import {
  getNotifications, getUnreadCount, markAllRead, markRead, clearAll,
  onNotificationsChange, notifyActivityAdded, syncFromBackend, markAllReadRemote,
  type AppNotification, type NotifTarget,
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





// Tap-to-zoom for activity photos (Stats detail + activity detail). Delegated, bound once.
if (typeof document !== 'undefined' && !(window as unknown as Record<string, unknown>).__photoZoomBound) {
  (window as unknown as Record<string, unknown>).__photoZoomBound = true;
  document.addEventListener('click', e => {
    const img = (e.target as HTMLElement).closest('.sv-detail-photo img, .ad-photo img') as HTMLImageElement | null;
    if (!img) return;
    e.stopPropagation();
    const ov = document.createElement('div');
    ov.className = 'sv-lightbox';
    ov.innerHTML = `<img src="${img.src}" alt=""/>`;
    ov.addEventListener('click', () => ov.remove());
    document.body.appendChild(ov);
  });
}

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

// Keep every like button for an item (feed card, post card, activity detail) in sync
function broadcastLike(id: string, liked: boolean, count: number): void {
  document.querySelectorAll<HTMLElement>(`[data-like-count="${id}"], [data-like-count="p_${id}"]`).forEach(el => {
    el.textContent = String(count);
    el.closest('.home-card__action')?.classList.toggle('home-card__action--liked', liked);
  });
}

function openCommentPanel(card: HTMLElement, actId: string): void {
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

// ── Full-screen comments view (Strava-style — keyboard never covers input) ────

function openCommentsView(card: HTMLElement, actId: string): void {
  document.getElementById('commentsView')?.remove();

  const itemType = actId.startsWith('p_') ? 'post' : 'activity';
  const realId   = actId.startsWith('p_') ? actId.slice(2) : actId;
  const userId   = localStorage.getItem('mapyou_userId_profile') ?? '';
  const userName = localStorage.getItem('mapyou_userName') ?? 'Athlete';

  const ov = document.createElement('div');
  ov.id = 'commentsView';
  ov.className = 'cv-overlay';
  ov.innerHTML = `
    <div class="cv-sheet">
      <div class="cv-header">
        <button class="cv-back" id="cvBack" aria-label="Back">‹</button>
        <span class="cv-title">Comments</span>
      </div>
      <div class="cv-list" id="cvList"><p class="cv-empty">Loading…</p></div>
      <div class="cv-form">
        <input class="cv-input" id="cvInput" placeholder="Add a comment…" maxlength="200"/>
        <button class="cv-send" id="cvSend" aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="18" height="18">
            <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
          </svg>
        </button>
      </div>
    </div>`;
  document.body.appendChild(ov);

  // Keep the sheet sized to the visible viewport so the keyboard never covers the input
  const sheet = ov.querySelector<HTMLElement>('.cv-sheet')!;
  const vv = window.visualViewport;
  const applyVV = (): void => {
    if (!vv) return;
    sheet.style.height = `${vv.height}px`;
    sheet.style.transform = `translateY(${vv.offsetTop}px)`;
  };
  if (vv) { vv.addEventListener('resize', applyVV); vv.addEventListener('scroll', applyVV); applyVV(); }

  const close = (): void => {
    if (vv) { vv.removeEventListener('resize', applyVV); vv.removeEventListener('scroll', applyVV); }
    ov.remove();
  };
  ov.querySelector('#cvBack')?.addEventListener('click', close);

  const input = ov.querySelector<HTMLInputElement>('#cvInput')!;
  const list  = ov.querySelector<HTMLElement>('#cvList')!;

  const render = (comments: Array<{ authorName: string; text: string }>): void => {
    list.innerHTML = comments.length
      ? comments.map(c => `<div class="cv-item">
          <span class="cv-author">${c.authorName}</span>
          <span class="cv-text">${c.text}</span>
        </div>`).join('')
      : '<p class="cv-empty">No comments yet — be the first.</p>';
    list.scrollTop = list.scrollHeight;
  };

  const updateCount = (n: number): void => {
    const el = card.querySelector<HTMLElement>(`[data-comment-count="${actId}"], [data-comment-count="${realId}"]`);
    if (el) el.textContent = String(n);
  };

  void fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(realId)}`)
    .then(r => r.json())
    .then((d: { data: Array<{ authorName: string; text: string }> }) => {
      render(d.data ?? []); updateCount(d.data?.length ?? 0);
    })
    .catch(() => { list.innerHTML = '<p class="cv-empty">No comments yet</p>'; });

  const send = async (): Promise<void> => {
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
        const r2 = await fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(realId)}`);
        const d2 = await r2.json() as { data: Array<{ authorName: string; text: string }> };
        render(d2.data ?? []); updateCount(d2.data?.length ?? 0);
      }
    } catch {}
    input.disabled = false;
    input.focus();
  };

  ov.querySelector('#cvSend')?.addEventListener('click', () => void send());
  input.addEventListener('keydown', e => { if (e.key === 'Enter') void send(); });
  setTimeout(() => input.focus(), 300);
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

export function buildPostCard(post: PostRecord, onRefresh: () => Promise<void> | void): HTMLElement {
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
      broadcastLike(post.id, d.liked, d.count);
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

// ── Activity detail screen (Strava-style) ─────────────────────────────────────
function estimateCalories(sport: string, distanceKm: number, durationSec: number, weightKg: number | null): number {
  const hours = durationSec / 3600;
  if (hours <= 0) return 0;
  const w = weightKg && weightKg > 0 ? weightKg : 70;
  let met = 7;
  if (sport === 'running')      met = 9.8;
  else if (sport === 'cycling') met = 7.5;
  else if (sport === 'walking') met = 3.8;
  else if (sport === 'hiking')  met = 6.0;
  return Math.round(met * w * hours);
}

let _adMap: L.Map | null = null;

function adToast(msg: string): void {
  document.getElementById('adToast')?.remove();
  const t = document.createElement('div');
  t.id = 'adToast';
  t.className = 'ad-toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('ad-toast--show'));
  setTimeout(() => { t.classList.remove('ad-toast--show'); setTimeout(() => t.remove(), 250); }, 2200);
}

function openActivityOptionsMenu(
  ov: HTMLElement,
  itemId: string,
  visibility: 'everyone' | 'friends' | 'only_me',
  muted: boolean,
  closeDetail: () => void,
): void {
  document.getElementById('adMenuOverlay')?.remove();
  const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
  const opts: Array<{ v: 'everyone' | 'friends' | 'only_me'; ic: string; t: string; s: string }> = [
    { v: 'everyone', ic: '🌐', t: 'Everyone', s: 'Visible to everyone' },
    { v: 'friends',  ic: '👥', t: 'Friends',  s: 'You and your friends' },
    { v: 'only_me',  ic: '🔒', t: 'Only me',  s: 'Only you can see it' },
  ];
  const menu = document.createElement('div');
  menu.id = 'adMenuOverlay';
  menu.className = 'adm-overlay';
  menu.innerHTML = `
    <div class="adm-sheet">
      <div class="adm-grab"></div>
      <div class="adm-section-title">Who can see this?</div>
      ${opts.map(o => `
        <button class="adm-row${o.v === visibility ? ' adm-row--active' : ''}" data-vis="${o.v}">
          <span class="adm-ic">${o.ic}</span>
          <span class="adm-txt"><span class="adm-t">${o.t}</span><span class="adm-s">${o.s}</span></span>
          <span class="adm-check">${o.v === visibility ? '✓' : ''}</span>
        </button>`).join('')}
      <div class="adm-divider"></div>
      <button class="adm-row" id="admMute">
        <span class="adm-ic">🚫</span>
        <span class="adm-txt"><span class="adm-t">Hide from feed</span><span class="adm-s">Stays on your profile, not in feeds</span></span>
        <span class="adm-toggle${muted ? ' adm-toggle--on' : ''}"><span class="adm-knob"></span></span>
      </button>
      <div class="adm-divider"></div>
      <button class="adm-row adm-row--danger" id="admDelete">
        <span class="adm-ic">🗑️</span>
        <span class="adm-txt"><span class="adm-t">Delete activity</span><span class="adm-s">This cannot be undone</span></span>
      </button>
    </div>`;
  document.body.appendChild(menu);
  const closeMenu = (): void => menu.remove();
  menu.addEventListener('click', e => { if (e.target === menu) closeMenu(); });

  let curVis = visibility, curMuted = muted;
  const refreshBadge = (): void => {
    const badge = ov.querySelector('#adVisBadge');
    if (!badge) return;
    const t  = curVis === 'everyone' ? 'Everyone' : curVis === 'friends' ? 'Friends' : 'Only me';
    const ic = curVis === 'everyone' ? '🌐' : curVis === 'friends' ? '👥' : '🔒';
    badge.textContent = `${ic} ${t}${curMuted ? ' · Hidden from feed' : ''}`;
  };
  const patch = async (body: { visibility?: string; muted?: boolean }): Promise<void> => {
    try {
      await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(itemId)}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, ...body }),
      });
    } catch { /* offline: local change stays, syncs later */ }
  };

  menu.querySelectorAll<HTMLElement>('[data-vis]').forEach(row => {
    row.addEventListener('click', () => {
      const v = row.dataset.vis as 'everyone' | 'friends' | 'only_me';
      curVis = v;
      menu.querySelectorAll<HTMLElement>('[data-vis]').forEach(r => {
        r.classList.toggle('adm-row--active', r === row);
        const chk = r.querySelector('.adm-check'); if (chk) chk.textContent = r === row ? '✓' : '';
      });
      void updateEnrichedActivityFields(itemId, { visibility: v });
      void patch({ visibility: v });
      refreshBadge();
      adToast('Visibility updated');
    });
  });

  menu.querySelector('#admMute')?.addEventListener('click', () => {
    curMuted = !curMuted;
    menu.querySelector('.adm-toggle')?.classList.toggle('adm-toggle--on', curMuted);
    void updateEnrichedActivityFields(itemId, { muted: curMuted });
    void patch({ muted: curMuted });
    refreshBadge();
    adToast(curMuted ? 'Hidden from feed' : 'Shown in feed');
  });

  menu.querySelector('#admDelete')?.addEventListener('click', () => {
    if (!confirm('Delete this activity? This cannot be undone.')) return;
    void (async () => {
      try {
        await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
      } catch { /* ignore */ }
      await deleteEnrichedActivity(itemId);
      await deleteActivity(itemId);
      try {
        const k = 'mapyou_deleted_workout_ids';
        const arr = JSON.parse(localStorage.getItem(k) || '[]') as string[];
        if (Array.isArray(arr) && !arr.includes(itemId)) { arr.push(itemId); localStorage.setItem(k, JSON.stringify(arr)); }
      } catch { /* ignore */ }
      try { sessionStorage.removeItem(`mapyou_feedcache_${userId}`); } catch { /* ignore */ }
      closeMenu();
      closeDetail();
      adToast('Activity deleted');
      void homeView.render();
    })();
  });
}

export async function openActivityDetail(act: EnrichedActivity, isOwn: boolean, actId?: string): Promise<void> {
  document.getElementById('activityDetailOverlay')?.remove();
  if (_adMap) { try { _adMap.remove(); } catch { /* ignore */ } _adMap = null; }

  // Own activities: reload full record (coords / laps / notes) from IndexedDB
  let full: EnrichedActivity = act;
  if (isOwn) {
    const realId = actId || ((act as unknown as Record<string, unknown>).activityId as string) || act.id;
    const fresh = (await loadEnrichedActivities()).find(a => a.id === realId);
    if (fresh) full = fresh;
  }

  const rec     = full as unknown as Record<string, unknown>;
  const color   = getColor(full.sport);
  const icon    = getIcon(full.sport);
  const isCycle = full.sport === 'cycling';
  const timeFmt = formatDuration(full.durationSec);
  const paceFmt = isCycle ? full.speedKmH.toFixed(1) : formatPace(full.paceMinKm);
  const paceLbl = isCycle ? 'km/h' : 'min/km';
  const profile = loadProfileFromLocal();
  const kcal    = estimateCalories(full.sport, full.distanceKm, full.durationSec, profile.weightKg);

  const ownCoords    = isOwn && Array.isArray(full.coords) && full.coords.length > 0;
  const encoded      = (rec._coordsEncResolved as string | null) ?? (rec.coordsEnc as string | null) ?? null;
  const friendCoords = !ownCoords && encoded ? decodePolyline(encoded) : null;

  const routeCoords = (ownCoords ? (full.coords as Array<[number, number]>) : (friendCoords ?? [])) as Array<[number, number]>;
  const hasRoute    = routeCoords.length > 0;
  const visibility  = ((rec.visibility as string) || 'everyone') as 'everyone' | 'friends' | 'only_me';
  const muted       = rec.muted === true;
  const visText     = visibility === 'everyone' ? 'Everyone' : visibility === 'friends' ? 'Friends' : 'Only me';
  const visIco      = visibility === 'everyone' ? '🌐' : visibility === 'friends' ? '👥' : '🔒';
  const visBadge    = `${visIco} ${visText}${muted ? ' · Hidden from feed' : ''}`;

  const authorName = (rec.authorName as string) || (isOwn ? (profile.name || 'You') : getSportLabel(full.sport));
  const avatarSrc  = (rec.avatarB64 as string | null) ?? (rec.authorAvatarUrl as string | null) ?? (isOwn ? profile.avatarB64 : null);
  const avatarHtml = avatarSrc ? `<img src="${avatarSrc}" alt="avatar"/>` : `<span>${icon}</span>`;
  const title      = (full.name || '').replace(/^(undefined|null)\s*/i, '').trim() || getSportLabel(full.sport);
  const dateStr    = new Date(full.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
                   + ' · ' + new Date(full.date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });

  const photoIsVideo = full.mediaType === 'video' || (full.photoUrl?.includes('/video/upload/') ?? false);
  const photoHtml = full.photoUrl
    ? photoIsVideo
      ? `<div class="ad-photo"><video src="${full.photoUrl}" playsinline controls preload="metadata"></video></div>`
      : `<div class="ad-photo"><img src="${full.photoUrl}" alt="Activity photo" loading="lazy"/></div>`
    : '';

  // Splits — author only, only when real laps exist
  let splitsHtml = '';
  const lapsArr = rec.laps as Array<{ km: number; durationSec: number; paceMinKm: number }> | undefined;
  if (isOwn && Array.isArray(lapsArr) && lapsArr.length > 0) {
    const laps = lapsArr;
    const slowest = Math.max(...laps.map(l => l.paceMinKm || 0)) || 1;        // longest bar = slowest
    const rows = laps.map(l => {
      const w = Math.max(8, Math.round(((l.paceMinKm || 0) / slowest) * 100));
      return `<div class="ad-split">
        <span class="ad-split-km">${l.km}</span>
        <div class="ad-split-bar"><div class="ad-split-fill" style="width:${w}%;background:${color}"></div></div>
        <span class="ad-split-pace">${formatPace(l.paceMinKm)}</span>
      </div>`;
    }).join('');
    splitsHtml = `<div class="ad-section"><h3 class="ad-section-title">Splity (per km)</h3>${rows}</div>`;
  }

  const notesHtml = (isOwn && full.notes)
    ? `<div class="ad-section"><h3 class="ad-section-title">Notatki</h3><p class="ad-notes">🔒 ${full.notes}</p></div>`
    : '';

  const itemId       = actId || (rec.activityId as string) || full.id;
  const likeCount    = (rec._likeCount as number) ?? 0;
  const commentCount = (rec._commentCount as number) ?? 0;
  const viewCount    = (((act as unknown as Record<string, unknown>)._viewCount ?? (act as unknown as Record<string, unknown>).views) as number)
                       ?? (rec._viewCount as number) ?? (rec.views as number) ?? 0;

  const heroInner = (ownCoords || friendCoords)
    ? `<div class="ad-hero-map" id="adHeroMap"></div>`
    : `<div class="ad-hero-empty" style="background:linear-gradient(135deg, ${color}22, ${color}44)"><span>${icon}</span></div>`;

  const ov = document.createElement('div');
  ov.id = 'activityDetailOverlay';
  ov.className = 'ad-overlay';
  // When opened from a profile overlay (own #profileViewOverlay z5000 / public z9600),
  // sit above it but below child panels (comments ~9999, photo zoom 99999).
  if (document.getElementById('publicProfileOverlay') || document.getElementById('profileViewOverlay')) {
    ov.style.zIndex = '9650';
  }
  ov.innerHTML = `
    <div class="ad-hero">
      <button class="ad-back" id="adBack" aria-label="Back">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      ${heroInner}
      <div class="ad-hero-ctrls">
        ${hasRoute ? `<button class="ad-ctrl" id="adBookmark" aria-label="Save route">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="${isRouteSaved(itemId) ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg>
        </button>` : ''}
        ${isOwn ? `<button class="ad-ctrl" id="adMore" aria-label="Options">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><circle cx="12" cy="5" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="12" cy="19" r="1.8"/></svg>
        </button>` : ''}
      </div>
    </div>
    <div class="ad-sheet">
      <div class="ad-grab"></div>
      <div class="ad-author">
        <div class="ad-avatar" style="border-color:${color}55;background:${color}22">${avatarHtml}</div>
        <div class="ad-author-text">
          <span class="ad-author-name">${authorName}</span>
          <span class="ad-date">${icon} ${dateStr}</span>
        </div>
        <span class="ad-sport" style="color:${color}">${getSportLabel(full.sport)}</span>
      </div>
      ${isOwn ? `<div class="ad-vis" id="adVisBadge">${visBadge}</div>` : ''}

      <h2 class="ad-title">${title}</h2>
      ${full.description && full.description !== title ? `<p class="ad-desc">${full.description}</p>` : ''}

      <div class="ad-stats">
        <div class="ad-stat"><span class="ad-stat-v">${full.distanceKm.toFixed(2)}</span><span class="ad-stat-l">Dystans (km)</span></div>
        <div class="ad-stat"><span class="ad-stat-v">${timeFmt}</span><span class="ad-stat-l">Czas</span></div>
        <div class="ad-stat"><span class="ad-stat-v">${paceFmt}</span><span class="ad-stat-l">${isCycle ? 'Prędkość' : 'Tempo'} (${paceLbl})</span></div>
        <div class="ad-stat"><span class="ad-stat-v">${kcal}</span><span class="ad-stat-l">Kalorie (szac.)</span></div>
      </div>

      ${photoHtml}
      ${splitsHtml}
      ${notesHtml}

      <div class="home-card__footer ad-footer" style="border-top:1px solid var(--app-border)">
        <button class="home-card__action home-card__action--like" data-action="like" aria-label="Like">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <span class="home-card__action-count" data-like-count="${itemId}">${likeCount > 0 ? likeCount : 0}</span>
        </button>
        <button class="home-card__action home-card__action--comment" data-action="comment" aria-label="Comment">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <span class="home-card__action-count" data-comment-count="${itemId}">${commentCount > 0 ? commentCount : 0}</span>
        </button>
        <span class="home-card__action home-card__action--views" aria-label="Views">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>
          </svg>
          <span class="home-card__action-count">${viewCount > 0 ? viewCount : 0}</span>
        </span>
        <button class="home-card__action home-card__action--share" data-action="share" aria-label="Share">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
          </svg>
        </button>
      </div>
    </div>`;

  document.body.appendChild(ov);

  const close = () => {
    if (_adMap) { try { _adMap.remove(); } catch { /* ignore */ } _adMap = null; }
    ov.remove();
  };
  ov.querySelector('#adBack')?.addEventListener('click', close);

  // Bookmark — save/unsave this route to Track → Routes (anyone with a map)
  const bookmarkBtn = ov.querySelector<HTMLElement>('#adBookmark');
  bookmarkBtn?.addEventListener('click', () => {
    const svg = bookmarkBtn.querySelector('svg');
    if (isRouteSaved(itemId)) {
      unsaveRoute(itemId);
      svg?.setAttribute('fill', 'none');
      adToast('Removed from saved routes');
    } else {
      const route: SavedRoute = {
        id: itemId, name: title, sport: full.sport,
        distanceKm: full.distanceKm, durationSec: full.durationSec,
        date: new Date(full.date).toISOString(), coords: routeCoords,
      };
      saveRoute(route);
      svg?.setAttribute('fill', 'currentColor');
      adToast('Saved to Track → Routes');
    }
  });

  // Author-only options menu (visibility / hide-from-feed / delete)
  ov.querySelector<HTMLElement>('#adMore')?.addEventListener('click', () => {
    openActivityOptionsMenu(ov, itemId, visibility, muted, close);
  });

  // Draggable bottom sheet — drag up to expand (~80%), down to reveal the map
  const sheet = ov.querySelector('.ad-sheet') as HTMLElement;
  const grab  = ov.querySelector('.ad-grab') as HTMLElement;
  if (sheet && grab) {
    let startY = 0, startT = 0, curT = 0, dragging = false;
    const expandedT = 0;                                          // translateY 0 → full 80vh visible
    const defaultT  = (): number => Math.round(window.innerHeight * 0.24); // rest: ~56vh visible
    const maxT      = (): number => Math.max(0, sheet.offsetHeight - 150);  // collapsed: 150px peek
    // Start at the comfortable default position (not fully expanded)
    curT = defaultT();
    sheet.style.transform = `translateY(${curT}px)`;
    grab.addEventListener('pointerdown', e => {
      dragging = true; startY = e.clientY; startT = curT;
      sheet.style.transition = 'none';
      try { grab.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    grab.addEventListener('pointermove', e => {
      if (!dragging) return;
      let t = startT + (e.clientY - startY);
      t = Math.max(expandedT, Math.min(maxT(), t));
      curT = t; sheet.style.transform = `translateY(${t}px)`;
    });
    const end = (): void => {
      if (!dragging) return;
      dragging = false; sheet.style.transition = '';
      const dT = defaultT(), mT = maxT();
      // Snap to the nearest of: expanded (80%) / default (~56%) / collapsed (peek)
      if (curT < dT * 0.5)              curT = expandedT;
      else if (curT < (dT + mT) / 2)    curT = dT;
      else                              curT = mT;
      sheet.style.transform = `translateY(${curT}px)`;
    };
    grab.addEventListener('pointerup', end);
    grab.addEventListener('pointercancel', end);
  }

  // Hero map / minimap (after layout + entry animation, so dimensions are final)
  const sheetPx = Math.round(window.innerHeight * 0.56);
  setTimeout(() => {
    const mapEl = document.getElementById('adHeroMap');
    if (!mapEl) return;
    if (ownCoords) {
      _adMap = L.map(mapEl, { zoomControl: false, attributionControl: false, dragging: true });
      L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(_adMap);
      const pts = full.coords.map(c => L.latLng(c[0], c[1]));
      if (pts.length === 1) {
        _adMap.setView(pts[0], 15);
        L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(_adMap);
      } else {
        const line = L.polyline(pts, { color, weight: 4, opacity: 0.95 }).addTo(_adMap);
        // Push the route into the visible area above the sheet
        _adMap.fitBounds(line.getBounds(), { paddingTopLeft: [28, 28], paddingBottomRight: [28, sheetPx] });
        L.circleMarker(pts[0], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(_adMap);
        L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#e74c3c', fillOpacity: 1 }).addTo(_adMap);
      }
      // Leaflet renders blank if created before the container settled — force a resize pass
      setTimeout(() => { try { _adMap?.invalidateSize(); } catch { /* ignore */ } }, 250);
    } else if (friendCoords && friendCoords.length > 0) {
      renderMinimapCanvas(mapEl, friendCoords, full.sport);
    }
  }, 320);

  // Footer — same like/comment/share behaviour as the feed (backend like toggle)
  ov.querySelectorAll<HTMLElement>('.ad-footer .home-card__action').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const action = btn.dataset.action;
      const sheetEl = ov.querySelector('.ad-sheet') as HTMLElement;
      if (action === 'like') {
        btn.classList.add('home-card__action--pulse');
        setTimeout(() => btn.classList.remove('home-card__action--pulse'), 400);
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        void fetch(`${BACKEND_URL}/feed/like`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, itemId, itemType: 'activity' }),
        }).then(r => r.json()).then((d: { liked: boolean; count: number }) => {
          broadcastLike(itemId, d.liked, d.count);
        }).catch(() => { /* offline: ignore */ });
      }
      if (action === 'comment') {
        openCommentsView(sheetEl, itemId);
      }
      if (action === 'share') {
        const existing = sheetEl.querySelector('.home-card__share-panel');
        if (existing) { existing.classList.remove('home-card__share-panel--open'); setTimeout(() => existing.remove(), 280); }
        else openSharePanel(sheetEl, full);
      }
    });
  });

  // Load current like state + count, and the comment count
  {
    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
    if (userId) {
      void fetch(`${BACKEND_URL}/feed/likes/batch?userId=${encodeURIComponent(userId)}&items=${encodeURIComponent(itemId)}`, { cache: 'no-store' })
        .then(r => r.json())
        .then((resp: { status: string; data: Record<string, { count: number; liked: boolean }> }) => {
          if (resp.status !== 'ok') return;
          const info = resp.data[itemId];
          if (!info) return;
          const likeBtn = ov.querySelector('.ad-footer .home-card__action--like');
          likeBtn?.classList.toggle('home-card__action--liked', info.liked);
          const el = ov.querySelector<HTMLElement>(`[data-like-count="${itemId}"]`);
          if (el) el.textContent = String(info.count);
        }).catch(() => { /* ignore */ });
    }
    // Comment count — keep detail in sync with the feed (works for own + friends')
    void fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(itemId)}`)
      .then(r => r.json())
      .then((d: { data?: unknown[] }) => {
        if (!Array.isArray(d.data)) return;
        const el = ov.querySelector<HTMLElement>(`[data-comment-count="${itemId}"]`);
        if (el) el.textContent = String(d.data.length);
      }).catch(() => { /* ignore */ });
  }
}

export function buildCard(act: EnrichedActivity): HTMLElement {
  const card = document.createElement('article');
  card.className = 'home-card';
  card.dataset.id = act.id;

  const color     = getColor(act.sport);
  const icon      = getIcon(act.sport);
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
  const _actRec = act as unknown as Record<string, unknown>;
  const avatarSrc = (_actRec.avatarB64 as string | null)
    ?? (_actRec.authorAvatarUrl as string | null)
    ?? profile.avatarB64;
  const userAvatarHtml = avatarSrc
    ? `<img src="${avatarSrc}" class="home-card__avatar-img" alt="avatar"/>`
    : `<span>${icon}</span>`;
  const _cleanName = (s: string): string => (s || '')
    .replace(/^(undefined|null)\s+/i, '')
    .replace(/^undefined$/i, '')
    .trim();
  const _displayName = _cleanName(act.name) || _cleanName(act.description) || getSportLabel(act.sport);

  card.innerHTML = `
    <div class="home-card__header">
      <div class="home-card__avatar home-card__avatar--user" style="border-color:${color}40;background:${color}20">
        ${userAvatarHtml}
      </div>
      <div class="home-card__meta">
        ${(act as unknown as Record<string,unknown>).authorName ? `<span class="home-card__author-name" style="font-size:1.2rem;font-weight:700;color:#fff;display:block;line-height:1.2">${(act as unknown as Record<string,unknown>).authorName as string}</span>` : ''}
        <h3 class="home-card__name">${_displayName}</h3>
        <span class="home-card__time">${relativeDate(act.date)}</span>
      </div>
      <div class="home-card__badges">
        ${intenHtml}
        <span class="home-card__sport-badge" style="color:${color}">${getSportLabel(act.sport)}</span>
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

      <span class="home-card__action home-card__action--views" aria-label="Views">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/>
        </svg>
        <span class="home-card__action-count">${((act as unknown as Record<string, unknown>).views as number) ?? 0}</span>
      </span>

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
          broadcastLike(act.id, d.liked, d.count);
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

// Deep-link a tapped notification straight to its content.
async function _routeNotifTarget(t: NotifTarget): Promise<void> {
  try {
    if (t.kind === 'activity') {
      const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
      // Own activity — already in IndexedDB
      const own = (await loadEnrichedActivities()).find(a => a.id === t.id);
      if (own) { void openActivityDetail(own, true, t.id); return; }
      // Friend activity — fetch from backend (needs author userId)
      if (t.userId && t.userId !== myUserId) {
        try {
          const res = await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(t.id)}?userId=${encodeURIComponent(t.userId)}`);
          const j = await res.json() as { status: string; data?: Record<string, unknown> };
          if (j.status === 'ok' && j.data) {
            const act = { ...j.data, id: (j.data.activityId as string) ?? t.id } as unknown as EnrichedActivity;
            void openActivityDetail(act, false, t.id);
          }
        } catch { /* ignore */ }
      }
    } else if (t.kind === 'reel') {
      const hv = homeView as unknown as Record<string, unknown>;
      await (hv._openReelsViewer as (uid: string, idx: number) => Promise<void>)(t.userId ?? t.id, 0);
    } else if (t.kind === 'live') {
      const fn = (window as unknown as Record<string, unknown>).__openLive as ((token: string, name: string) => void) | undefined;
      fn?.(t.id, t.name ?? 'Live Tracking');
    } else if (t.kind === 'profile') {
      openPublicProfile(t.userId ?? t.id);
    }
  } catch { /* ignore routing errors */ }
}

// Parse an activity deep-link URL/hash: #activity=ID&u=AUTHOR
function _parseActivityDeepLink(url: string): { id: string; userId?: string } | null {
  const m = url.match(/[#&?]activity=([^&]+)/);
  if (!m) return null;
  const u = url.match(/[#&?]u=([^&]+)/);
  return { id: decodeURIComponent(m[1]), userId: u ? decodeURIComponent(u[1]) : undefined };
}

// Push deep-links for activities: SW message (app open) + cold-start hash. Bound once.
if (typeof window !== 'undefined' && !(window as unknown as Record<string, unknown>).__activityDeepLinkBound) {
  (window as unknown as Record<string, unknown>).__activityDeepLinkBound = true;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if ((e as MessageEvent).data?.type === 'OPEN_ACTIVITY') {
        const dl = _parseActivityDeepLink((e as MessageEvent).data.url as string);
        if (dl) void _routeNotifTarget({ kind: 'activity', id: dl.id, userId: dl.userId });
      }
    });
  }
  const dl = _parseActivityDeepLink(window.location.hash);
  if (dl) {
    history.replaceState(null, '', window.location.pathname);
    setTimeout(() => void _routeNotifTarget({ kind: 'activity', id: dl.id, userId: dl.userId }), 600);
  }
}

const _NOTIF_EMPTY_HTML = '<div class="hn-empty"><span>🔔</span><p>No notifications yet</p></div>';

function _notifItemHtml(n: AppNotification): string {
  return `
    <div class="hn-item ${n.read ? '' : 'hn-item--unread'} ${n.target ? 'hn-item--link' : ''}" data-id="${n.id}">
      <div class="hn-item__icon">${n.icon ?? '🔔'}</div>
      <div class="hn-item__body">
        <div class="hn-item__title">${n.title}</div>
        <div class="hn-item__body-text">${n.body}</div>
        <div class="hn-item__time">${_relTimeNotif(n.timestamp)}</div>
      </div>
      ${n.target ? '<div class="hn-item__chevron">›</div>' : ''}
    </div>`;
}

function _openNotifPanel(): void {
  document.getElementById('homeNotifPanel')?.remove();
  markAllRead();

  const notifs   = getNotifications();
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
        ${notifs.length === 0 ? _NOTIF_EMPTY_HTML : notifs.map(_notifItemHtml).join('')}
      </div>
    </div>`;

  document.body.appendChild(panel);
  requestAnimationFrame(() => {
    panel.querySelector<HTMLElement>('#hnSheet')?.classList.add('hn-sheet--open');
    panel.querySelector<HTMLElement>('#hnOverlay')?.classList.add('hn-overlay--visible');
  });

  const close = () => {
    panel.querySelector('#hnSheet')?.classList.remove('hn-sheet--open');
    panel.querySelector('#hnOverlay')?.classList.remove('hn-overlay--visible');
    setTimeout(() => panel.remove(), 340);
  };

  panel.querySelector('#hnOverlay')?.addEventListener('click', close);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); }, { once: true });

  // Tap a notification → jump straight to its content (re-bound after each render)
  const bindItems = (): void => {
    panel.querySelectorAll<HTMLElement>('.hn-item').forEach(item => {
      item.addEventListener('click', () => {
        const n = getNotifications().find(x => x.id === item.dataset.id);
        if (!n?.target) return;
        close();
        void _routeNotifTarget(n.target);
      });
    });
  };
  bindItems();

  // Pull friends' notifications from the backend so they show in the bell even
  // when the phone never received (or has disabled) push, then re-render.
  const uid = localStorage.getItem('mapyou_userId_profile') ?? '';
  void syncFromBackend(uid).then(() => {
    const listEl = panel.querySelector('#hnList');
    if (!listEl) return;
    const fresh = getNotifications();
    listEl.innerHTML = fresh.length === 0 ? _NOTIF_EMPTY_HTML : fresh.map(_notifItemHtml).join('');
    bindItems();
    markAllRead();
    void markAllReadRemote(uid);
  });

  panel.querySelector('#hnClear')?.addEventListener('click', () => {
    clearAll();
    panel.querySelector('#hnList')!.innerHTML =
      '<div class="hn-empty"><span>🔔</span><p>No notifications yet</p></div>';
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
  private _ptrInited:    boolean                   = false;
  private _homeSection:  'home' | 'explore'        = 'home';
  private _switcherAutohideInited: boolean         = false;
  private _exploreFeed:    Array<{ kind: string; date: number; data: Record<string, unknown> }> | null = null;
  private _exploreOffset:  number                  = 0;
  private _exploreHasMore: boolean                 = false;
  private _exploreLoading: boolean                 = false;
  private _geo:            { lat: number; lng: number } | null = null;
  private _geoTried:       boolean                 = false;
  private _lastHomeFeed:   Array<{ kind: string; date: number; data: Record<string, unknown> }> = [];
  private _repaintFeed:    ((feed: Array<{ kind: string; date: number; data: Record<string, unknown> }>) => void) | null = null;
  private _impObserver?:   IntersectionObserver;
  private _impSeen:        Set<string>             = new Set();
  private _impPending:     Set<string>             = new Set();
  private _impTimer?:      number;
  private _impFlushBound:  boolean                 = false;
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

    // One-time on load: pull friends' notifications so the bell badge reflects
    // them even if push was never received / is disabled.
    if (!(window as unknown as Record<string, unknown>).__notifSyncedOnce) {
      (window as unknown as Record<string, unknown>).__notifSyncedOnce = true;
      const _nuid = localStorage.getItem('mapyou_userId_profile') ?? '';
      if (_nuid) void syncFromBackend(_nuid);
    }

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

    return greeting;
  }

  private _buildStreakWidget(activities: EnrichedActivity[]): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'home-streak-carousel';

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayMs = today.getTime();
    const dow = (today.getDay() + 6) % 7;              // 0 = Monday
    const monday = new Date(today); monday.setDate(today.getDate() - dow); monday.setHours(0, 0, 0, 0);

    // Active day keys (union of enriched activities + unified workouts) + per-day icon
    const dayKey = (ts: number): number => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const activeKeys = new Set<number>();
    const dayMeta = new Map<number, { icon: string; color: string }>();
    for (const a of activities) {
      const k = dayKey(a.date);
      activeKeys.add(k);
      if (!dayMeta.has(k)) dayMeta.set(k, { icon: getIcon(a.sport), color: getColor(a.sport) });
    }
    for (const w of this._workouts) {
      activeKeys.add(dayKey(typeof w.date === 'number' ? w.date : Date.parse(w.date as unknown as string)));
    }

    // Streak (consecutive days up to today)
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today); d.setDate(today.getDate() - i);
      if (activeKeys.has(d.getTime())) streak++; else break;
    }
    updateBestStreak(streak);

    // Week day circles (Mon-first)
    const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const k = d.getTime();
      const meta = dayMeta.get(k);
      return {
        label: DAY_LABELS[i], num: d.getDate(), key: k,
        active: activeKeys.has(k), isToday: k === todayMs, isFuture: k > todayMs,
        icon: meta?.icon ?? '', color: meta?.color ?? '',
      };
    });

    const dayCircle = (d: typeof days[number]): string => {
      const cls = ['hday'];
      if (d.isToday)  cls.push('hday--today');
      if (d.active)   cls.push('hday--active');
      if (d.isFuture) cls.push('hday--future');
      const style = d.active && !d.isToday ? ` style="background:${d.color}"` : '';
      const inner = d.active ? `<span class="hday-ico">${d.icon}</span>` : `<span class="hday-num">${d.num}</span>`;
      return `<div class="hday-col">
        <span class="hday-label${d.isToday ? ' hday-label--today' : ''}">${d.label}</span>
        <div class="${cls.join(' ')}"${style} ${d.active ? `data-day="${d.key}" role="button"` : ''}>${inner}</div>
      </div>`;
    };

    // Weekly totals
    const weekStart = monday.getTime();
    const weekEnd   = weekStart + 7 * 86400000;
    const weekActs  = activities.filter(a => a.date >= weekStart && a.date < weekEnd);
    const weekCount = weekActs.length;
    const weekTime  = weekActs.reduce((s, a) => s + a.durationSec, 0);
    const weekDist  = weekActs.reduce((s, a) => s + a.distanceKm, 0);

    wrap.innerHTML = `
      <div class="hsc-track">
        <div class="hsc-slide hsc-streak">
          <div class="hsc-streak__top">
            <div class="hsc-flame">
              <svg viewBox="0 0 24 30" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 30C12 30 5 22 5 15C5 10.5 8 6 12 4C12 4 10 9 12 12C14 9 15 6 15 6C17 9 19 12 19 15C19 22 12 30 12 30Z" fill="#f97316"/>
                <path d="M12 28C12 28 7 21 7 16C7 13 9 10.5 12 9C12 9 11 13 13 15C13 15 11 12 14 11C15 13 16 15 16 17C16 21 12 28 12 28Z" fill="#fb923c" opacity="0.75"/>
              </svg>
              <span class="hsc-flame__num">${streak}</span>
            </div>
            <div class="hsc-streak__title">${streak === 0 ? 'Start your streak!' : streak === 1 ? '1-day streak' : `${streak}-day streak`}</div>
          </div>
          <div class="hsc-week">${days.map(dayCircle).join('')}</div>
        </div>
        <div class="hsc-slide hsc-week-ov">
          <div class="hsc-week-ov__head">
            <span class="hsc-week-ov__title">This week</span>
            <button class="hsc-week-ov__more" id="hscMore">See more ›</button>
          </div>
          <div class="hsc-week-ov__stats">
            <div class="hsc-ovstat"><span class="hsc-ovstat__v">${weekCount}</span><span class="hsc-ovstat__l">Activities</span></div>
            <div class="hsc-ovstat"><span class="hsc-ovstat__v">${formatDuration(weekTime)}</span><span class="hsc-ovstat__l">Time</span></div>
            <div class="hsc-ovstat"><span class="hsc-ovstat__v">${formatDistance(weekDist)}</span><span class="hsc-ovstat__l">Distance (km)</span></div>
          </div>
        </div>
      </div>
      <div class="hsc-dots"><span class="hsc-dot hsc-dot--active"></span><span class="hsc-dot"></span></div>`;

    // Dots follow horizontal scroll
    const track = wrap.querySelector<HTMLElement>('.hsc-track')!;
    const dots  = wrap.querySelectorAll<HTMLElement>('.hsc-dot');
    track.addEventListener('scroll', () => {
      const idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      dots.forEach((d, i) => d.classList.toggle('hsc-dot--active', i === idx));
    }, { passive: true });

    // Tap a day with activity → day details
    wrap.querySelectorAll<HTMLElement>('[data-day]').forEach(el =>
      el.addEventListener('click', () => { void this._openDayDetails(Number(el.dataset.day)); }));

    // "See more" → month calendar
    wrap.querySelector('#hscMore')?.addEventListener('click', () => { void this._openStreakCalendar(); });

    return wrap;
  }

  // ── Day details (opened from a streak day circle) ───────────────────────────

  private async _openDayDetails(dayMs: number): Promise<void> {
    document.getElementById('dayDetailsOverlay')?.remove();
    const acts = (await loadEnrichedActivities())
      .filter(a => { const d = new Date(a.date); d.setHours(0, 0, 0, 0); return d.getTime() === dayMs; })
      .sort((x, y) => y.date - x.date);

    const dateLabel = new Date(dayMs).toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' });
    const totDist = acts.reduce((s, a) => s + a.distanceKm, 0);
    const totTime = acts.reduce((s, a) => s + a.durationSec, 0);

    const ov = document.createElement('div');
    ov.id = 'dayDetailsOverlay';
    ov.className = 'dd-overlay';
    ov.innerHTML = `
      <div class="dd-sheet">
        <div class="dd-header">
          <button class="dd-back" id="ddBack" aria-label="Back">‹</button>
          <span class="dd-title">${dateLabel}</span>
        </div>
        <div class="dd-summary">
          <div class="dd-stat"><span class="dd-stat-v">${acts.length}</span><span class="dd-stat-l">Activities</span></div>
          <div class="dd-stat"><span class="dd-stat-v">${formatDistance(totDist)}</span><span class="dd-stat-l">km</span></div>
          <div class="dd-stat"><span class="dd-stat-v">${formatDuration(totTime)}</span><span class="dd-stat-l">Time</span></div>
        </div>
        <div class="dd-list">${acts.length
          ? acts.map(a => `
            <div class="dd-item" data-id="${a.id}">
              <span class="dd-item-icon" style="background:${getColor(a.sport)}22;color:${getColor(a.sport)}">${getIcon(a.sport)}</span>
              <span class="dd-item-main">
                <span class="dd-item-title">${getSportLabel(a.sport)}</span>
                <span class="dd-item-meta">${formatDistance(a.distanceKm)} km · ${formatDuration(a.durationSec)}</span>
              </span>
              <span class="dd-item-chev">›</span>
            </div>`).join('')
          : '<p class="dd-empty">No activities this day</p>'}</div>
      </div>`;
    document.body.appendChild(ov);

    ov.querySelector('#ddBack')?.addEventListener('click', () => ov.remove());
    ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
    ov.querySelectorAll<HTMLElement>('.dd-item').forEach(el =>
      el.addEventListener('click', () => {
        const a = acts.find(x => x.id === el.dataset.id);
        if (!a) return;
        ov.remove();
        void openActivityDetail(a, true, a.id);
      }));
  }

  // ── Activity calendar (opened from the streak panel) ────────────────────────

  private async _openStreakCalendar(): Promise<void> {
    document.getElementById('calOverlay')?.remove();

    const acts = await loadEnrichedActivities();
    const keyOf = (ts: number): string => {
      const d = new Date(ts);
      return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    };
    const byDay = new Map<string, EnrichedActivity[]>();
    for (const a of acts) {
      const k = keyOf(a.date);
      const arr = byDay.get(k);
      if (arr) arr.push(a); else byDay.set(k, [a]);
    }

    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const WD = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const curY = today.getFullYear(), curM = today.getMonth();

    let viewY = curY, viewM = curM;
    let selKey: string | null = keyOf(today.getTime());

    const ov = document.createElement('div');
    ov.id = 'calOverlay';
    ov.className = 'cal-overlay';
    document.body.appendChild(ov);

    const close = (): void => ov.remove();

    const renderDetail = (): string => {
      if (!selKey) return '<div class="cal-empty">Pick a day to see its activities.</div>';
      const list = byDay.get(selKey) ?? [];
      const [y, m, d] = selKey.split('-').map(Number);
      const dateLabel = `${d} ${MONTHS[m]} ${y}`;
      if (list.length === 0) {
        return `<div class="cal-detail__date">${dateLabel}</div><div class="cal-empty">No activities this day.</div>`;
      }
      const totKm  = list.reduce((s, a) => s + (a.distanceKm || 0), 0);
      const totSec = list.reduce((s, a) => s + (a.durationSec || 0), 0);
      const rows = list.map(a => `
        <div class="cal-act" data-actid="${a.id}">
          <span class="cal-act__icon">${getIcon(a.sport)}</span>
          <span class="cal-act__main">
            <span class="cal-act__title">${a.name || getSportLabel(a.sport)}</span>
            <span class="cal-act__meta">${a.distanceKm > 0 ? formatDistance(a.distanceKm) + ' km · ' : ''}${formatDuration(a.durationSec)}</span>
          </span>
          <span class="cal-act__chevron">›</span>
        </div>`).join('');
      return `
        <div class="cal-detail__date">${dateLabel}</div>
        <div class="cal-summary">
          <div class="cal-summary__item"><div class="cal-summary__val">${list.length}</div><div class="cal-summary__lbl">Activities</div></div>
          <div class="cal-summary__item"><div class="cal-summary__val">${formatDistance(totKm)}</div><div class="cal-summary__lbl">km</div></div>
          <div class="cal-summary__item"><div class="cal-summary__val">${formatDuration(totSec)}</div><div class="cal-summary__lbl">Time</div></div>
        </div>
        ${rows}`;
    };

    const render = (): void => {
      const first = new Date(viewY, viewM, 1);
      const lead = (first.getDay() + 6) % 7;                 // Monday-first offset
      const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
      const atCurrent = viewY === curY && viewM === curM;

      let cells = '';
      for (let i = 0; i < lead; i++) cells += '<div class="cal-cell cal-cell--empty"></div>';
      for (let day = 1; day <= daysInMonth; day++) {
        const key = `${viewY}-${viewM}-${day}`;
        const cellDate = new Date(viewY, viewM, day);
        const hasAct = byDay.has(key);
        const isToday = viewY === curY && viewM === curM && day === today.getDate();
        const isFuture = cellDate.getTime() > today.getTime();
        const isSel = key === selKey;
        const cls = ['cal-cell',
          hasAct ? 'cal-cell--active' : '',
          isToday ? 'cal-cell--today' : '',
          isFuture ? 'cal-cell--future' : '',
          isSel ? 'cal-cell--sel' : ''].filter(Boolean).join(' ');
        cells += `<div class="${cls}" ${isFuture ? '' : `data-day="${day}"`}>${day}</div>`;
      }

      ov.innerHTML = `
        <div class="cal-sheet">
          <div class="cal-top"><button class="cal-close" id="calClose" aria-label="Close">✕</button></div>
          <div class="cal-header">
            <button class="cal-nav" id="calPrev" aria-label="Previous month">‹</button>
            <div class="cal-header__title">${MONTHS[viewM]} ${viewY}</div>
            <button class="cal-nav" id="calNext" aria-label="Next month" ${atCurrent ? 'disabled' : ''}>›</button>
          </div>
          <div class="cal-weekdays">${WD.map(w => `<span>${w}</span>`).join('')}</div>
          <div class="cal-grid">${cells}</div>
          <div class="cal-detail" id="calDetail">${renderDetail()}</div>
        </div>`;

      ov.querySelector('#calClose')?.addEventListener('click', close);
      ov.querySelector('#calPrev')?.addEventListener('click', () => {
        viewM--; if (viewM < 0) { viewM = 11; viewY--; }
        render();
      });
      ov.querySelector('#calNext')?.addEventListener('click', () => {
        if (atCurrent) return;
        viewM++; if (viewM > 11) { viewM = 0; viewY++; }
        render();
      });
      ov.querySelectorAll<HTMLElement>('[data-day]').forEach(cell => {
        cell.addEventListener('click', () => {
          selKey = `${viewY}-${viewM}-${cell.dataset.day}`;
          render();
        });
      });
      ov.querySelectorAll<HTMLElement>('.cal-act').forEach(row => {
        row.addEventListener('click', () => {
          const a = acts.find(x => x.id === row.dataset.actid);
          if (a) void openActivityDetail(a, true, a.id);
        });
      });
    };

    render();
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

  private async _openWorkoutPicker(onPick: (act: EnrichedActivity) => void): Promise<void> {
    const acts = (await loadEnrichedActivities()).slice(0, 50);
    const ov = document.createElement('div');
    ov.className = 'rwp-overlay';
    ov.innerHTML = `
      <div class="rwp-sheet">
        <div class="rwp-header"><span class="rwp-title">Choose a workout</span><button class="rwp-close" id="rwpClose" aria-label="Close">✕</button></div>
        <div class="rwp-list">${acts.length ? acts.map(a => `
          <button class="rwp-item" data-id="${a.id}">
            <span class="rwp-ic" style="background:${getColor(a.sport)}22;color:${getColor(a.sport)}">${getIcon(a.sport)}</span>
            <span class="rwp-main">
              <span class="rwp-name">${(a.name || '').replace(/^(undefined|null)\s*/i, '').trim() || getSportLabel(a.sport)}</span>
              <span class="rwp-meta">${formatDistance(a.distanceKm)} km · ${formatDuration(a.durationSec)} · ${new Date(a.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}</span>
            </span>
            <span class="rwp-chev">›</span>
          </button>`).join('') : '<p class="rwp-empty">No workouts yet — record one first</p>'}</div>
      </div>`;
    document.body.appendChild(ov);
    const close = (): void => ov.remove();
    ov.querySelector('#rwpClose')?.addEventListener('click', close);
    ov.addEventListener('click', e => { if (e.target === ov) close(); });
    ov.querySelectorAll<HTMLElement>('.rwp-item').forEach(el => el.addEventListener('click', () => {
      const a = acts.find(x => x.id === el.dataset.id);
      if (!a) return;
      close();
      onPick(a);
    }));
  }

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
        <button class="home-reel-creator__workout" id="reelFromWorkout" type="button">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>
          <span>Create from a workout</span>
        </button>
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
        <button class="home-reel-creator__tool-btn" id="reelGridToggle" title="Alignment grid">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.6" width="20" height="20"><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></svg>
          <span class="home-reel-creator__tool-lbl">Grid</span>
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
    let reelActivityId: string | null = null;
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
      reelActivityId = null;
      const url = URL.createObjectURL(file);
      canvas.innerHTML = isVid
        ? `<video src="${url}" class="home-reel-creator__preview" autoplay muted loop playsinline></video><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div><div class="home-reel-creator__grid" id="reelGrid" hidden></div>`
        : `<img src="${url}" class="home-reel-creator__preview" alt="preview"/><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div><div class="home-reel-creator__grid" id="reelGrid" hidden></div>`;
      // Reset tool overlays so ensureTools() re-creates them inside new canvas
      _palette = null; _sizeWrap = null;
      tools.style.display = 'flex';
      shareBtn.disabled = false;
    });

    // Create from a workout → compose a clean 9:16 reel and link it to the activity
    overlay.querySelector('#reelFromWorkout')?.addEventListener('click', () => {
      void this._openWorkoutPicker(async (actv) => {
        canvas.innerHTML = '<div class="home-reel-creator__composing"><div class="home-loading__spinner"></div><span>Building your reel…</span></div>';
        const prof = loadProfileFromLocal();
        const blob = await composeActivityReel(actv, { authorName: prof.name || 'You', avatarUrl: prof.avatarB64 ?? null });
        if (!blob) { alert('Could not build the reel — this workout has no route or stats.'); canvas.innerHTML = ''; return; }
        const file = new File([blob], 'reel.jpg', { type: 'image/jpeg' });
        selectedFile = file;
        reelActivityId = actv.id;
        const url = URL.createObjectURL(file);
        canvas.innerHTML = `<img src="${url}" class="home-reel-creator__preview" alt="reel"/><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div><div class="home-reel-creator__grid" id="reelGrid" hidden></div>`;
        _palette = null; _sizeWrap = null;
        tools.style.display = 'flex';
        shareBtn.disabled = false;
      });
    });

    // Alignment grid toggle (rule-of-thirds + center lines)
    overlay.querySelector('#reelGridToggle')?.addEventListener('click', () => {
      const grid = overlay.querySelector<HTMLElement>('#reelGrid');
      if (!grid) return;
      grid.hidden = !grid.hidden;
      overlay.querySelector('#reelGridToggle')?.classList.toggle('home-reel-creator__tool-btn--active', !grid.hidden);
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
        activityId:   reelActivityId,
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
          ${reel.activityId ? `<button class="home-reel-viewer__activity" id="reelViewerActivity">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>
            View activity
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><polyline points="9 18 15 12 9 6"/></svg>
          </button>` : ''}
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

      // View activity — deep-link from an activity reel into its details
      overlay.querySelector('#reelViewerActivity')?.addEventListener('click', async e => {
        e.stopPropagation();
        const aid = reel.activityId;
        if (!aid) return;
        closeViewer();
        let act = (await loadEnrichedActivities()).find(a => a.id === aid) ?? null;
        if (!act) {
          try {
            const res = await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(aid)}?userId=${encodeURIComponent(group.userId)}`, { cache: 'no-store' });
            if (res.ok) { const d = await res.json() as { data?: EnrichedActivity } & EnrichedActivity; act = (d.data ?? d) as EnrichedActivity; }
          } catch { /* ignore */ }
        }
        if (act) void openActivityDetail(act, act.userId === myUserId, aid);
      });

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
    this._setupPullToRefresh(scroll);
    this._homeSection = 'home';

    scroll.innerHTML = '<div class="home-loading"><div class="home-loading__spinner"></div></div>';

    const [activities, posts, workouts] = await Promise.all([
      loadEnrichedActivities(),
      loadPosts(),
      loadUnifiedWorkouts(),
    ]);
    this._workouts = workouts;

    scroll.innerHTML = '';
    scroll.appendChild(this._buildGreeting(activities.length + posts.length));

    // Reels bar — filled asynchronously so it never blocks the feed
    const reelsSlot = document.createElement('div');
    reelsSlot.id = 'homeReelsSlot';
    scroll.appendChild(reelsSlot);
    void this._buildReelsBar().then(bar => {
      const slot = document.getElementById('homeReelsSlot');
      if (!slot) return;
      if (bar) slot.replaceWith(bar); else slot.remove();
    }).catch(() => { /* ignore */ });

    scroll.appendChild(this._buildStreakWidget(activities));

    // Section switcher (Home / Explore) — sticky, auto-hide like X
    scroll.appendChild(this._buildSectionSwitcher());
    this._setupSwitcherAutohide(scroll);

    // Dedicated feed container so the feed can be repainted alone when server data arrives
    const feedList = document.createElement('div');
    feedList.id = 'homeFeedList';
    scroll.appendChild(feedList);
    this._setupSectionSwipe(feedList);

    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
    type FeedItem = { kind: string; date: number; data: Record<string, unknown>; isLocal?: boolean };

    const localFeed: FeedItem[] = [
      ...activities.map(a => ({ kind: 'activity', date: a.date, data: a as unknown as Record<string, unknown>, isLocal: true })),
      ...posts.map(p => ({ kind: 'post', date: p.date, data: p as unknown as Record<string, unknown>, isLocal: true })),
    ].sort((a, b) => b.date - a.date);

    const paintFeed = (feed: FeedItem[]): void => {
      feedList.innerHTML = '';
      this._feedObserver?.disconnect();
      document.getElementById('feedSentinel')?.remove();

      if (feed.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'home-empty';
        empty.innerHTML = `
          <div class="home-empty__icon">🏃</div>
          <h3 class="home-empty__title">Nothing here yet</h3>
          <p class="home-empty__sub">Finish a workout or tap + to create a post</p>`;
        feedList.appendChild(empty);
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
          (localAct as unknown as Record<string,unknown>).views = (item.data._viewCount as number) ?? 0;
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
      if (item.kind === 'activity') {
        card.style.cursor = 'pointer';
        card.addEventListener('click', e => {
          if ((e.target as HTMLElement).closest('button, a, video, input, [data-action], [data-pm], .home-card__photo, .home-card__avatar--user, .home-card__comment-panel, .hcs')) return;
          void openActivityDetail(item.data as unknown as EnrichedActivity, isOwn, (item.data.activityId ?? item.data.id) as string);
        });
      }
      feedList.appendChild(card);
      if (item.kind === 'activity') this._observeImpression(card, (item.data.activityId ?? item.data.id) as string);

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
              const btn = feedList.querySelector<HTMLElement>(`[data-like-count="${id}"]`)?.closest('.home-card__action') as HTMLElement | null;
              if (btn) btn.classList.add('home-card__action--liked');
              const btnP = feedList.querySelector<HTMLElement>(`[data-like-count="p_${id}"]`)?.closest('.home-card__action') as HTMLElement | null;
              if (btnP) btnP.classList.add('home-card__action--liked');
            }
          }).catch(() => {});
      }

      // Infinite scroll
      this._setupInfiniteScroll(feedList, activities, posts, userId);
    };
    this._repaintFeed = paintFeed;

    // 1) Instant paint — cached server feed (incl. friends) if present, else local-only
    const cached = this._readFeedCache(userId);
    if (cached) {
      this._feedHasMore = cached.hasMore;
      if (cached.feed.length > 0) this._feedCursor = cached.feed[cached.feed.length - 1].date;
    }
    const initialFeed = (cached && cached.feed.length > 0) ? (cached.feed as FeedItem[]) : localFeed;
    this._lastHomeFeed = initialFeed;
    paintFeed(initialFeed);
    const shownSig = this._feedSig(initialFeed);

    // 2) Revalidate from server in the background (timeout-guarded), repaint only if changed
    if (userId) {
      void this._fetchServerFeed(userId).then(result => {
        if (!result) return;                                 // offline / timeout: keep what's shown
        this._writeFeedCache(userId, result.feed, result.hasMore);
        this._feedHasMore = result.hasMore;
        if (result.feed.length > 0) this._feedCursor = result.feed[result.feed.length - 1].date;
        this._lastHomeFeed = result.feed as FeedItem[];
        if (!document.body.contains(feedList)) return;       // user navigated away
        if (this._homeSection !== 'home') return;            // don't clobber the Explore view
        if (this._feedSig(result.feed as FeedItem[]) !== shownSig) paintFeed(result.feed as FeedItem[]);
      }).catch(() => { /* ignore */ });
    }
  }

  // ── Section switcher: Home / Explore (style 3 — texts + dot) ────────────────

  private _buildSectionSwitcher(): HTMLElement {
    const sw = document.createElement('div');
    sw.id = 'homeSwitcher';
    sw.className = 'home-switcher';
    sw.innerHTML = `
      <button class="home-switcher__tab${this._homeSection === 'home' ? ' home-switcher__tab--active' : ''}" data-sec="home">Home</button>
      <button class="home-switcher__tab${this._homeSection === 'explore' ? ' home-switcher__tab--active' : ''}" data-sec="explore">Explore</button>
      <span class="home-switcher__dot"></span>`;
    sw.querySelectorAll<HTMLElement>('.home-switcher__tab').forEach(t =>
      t.addEventListener('click', () => {
        this.container?.scrollTo({ top: 0, behavior: 'smooth' });
        this._setSection(t.dataset.sec === 'explore' ? 'explore' : 'home');
      }));
    requestAnimationFrame(() => this._positionSwitcherDot());
    return sw;
  }

  private _positionSwitcherDot(): void {
    const sw = document.getElementById('homeSwitcher');
    if (!sw) return;
    const active = sw.querySelector<HTMLElement>('.home-switcher__tab--active');
    const dot    = sw.querySelector<HTMLElement>('.home-switcher__dot');
    if (!active || !dot) return;
    dot.style.transition = '';   // restore CSS transition (drag sets it to none)
    dot.style.left = `${active.offsetLeft + active.offsetWidth / 2}px`;
  }

  private _setSection(sec: 'home' | 'explore', fromSwipe = false): void {
    if (this._homeSection === sec && !fromSwipe) return;
    const dir = sec === 'explore' ? -1 : 1;
    this._homeSection = sec;

    const sw = document.getElementById('homeSwitcher');
    sw?.querySelectorAll<HTMLElement>('.home-switcher__tab').forEach(t =>
      t.classList.toggle('home-switcher__tab--active', t.dataset.sec === sec));
    this._positionSwitcherDot();

    if (!fromSwipe) {
      const fl = document.getElementById('homeFeedList');
      if (fl) {
        fl.style.transition = 'transform .16s ease, opacity .16s ease';
        fl.style.transform = `translateX(${dir * -18}px)`;
        fl.style.opacity = '0.5';
        requestAnimationFrame(() => {
          fl.style.transform = `translateX(${dir * 18}px)`;
          setTimeout(() => { fl.style.transform = ''; fl.style.opacity = '1'; }, 30);
        });
      }
    }

    if (sec === 'explore') {
      if (this._exploreFeed) this._repaintFeed?.(this._exploreFeed);   // instant from memory
      else { this._paintFeedLoading(); void this._loadExplore(); }
    } else {
      this._repaintFeed?.(this._lastHomeFeed);
    }
  }

  private _commitSwipe(sec: 'home' | 'explore'): void {
    const fl = document.getElementById('homeFeedList');
    if (!fl) { this._setSection(sec, true); return; }
    const w = fl.clientWidth || window.innerWidth;
    const out = sec === 'explore' ? -w : w;
    const sw = document.getElementById('homeSwitcher');
    sw?.querySelectorAll<HTMLElement>('.home-switcher__tab').forEach(t =>
      t.classList.toggle('home-switcher__tab--active', t.dataset.sec === sec));
    this._positionSwitcherDot();
    fl.style.transition = 'transform .16s ease, opacity .16s ease';
    fl.style.transform = `translateX(${out}px)`;
    fl.style.opacity = '0';
    setTimeout(() => {
      this._setSection(sec, true);                 // repaint, no built-in slide
      fl.style.transition = 'none';
      fl.style.transform = `translateX(${-out}px)`;
      fl.style.opacity = '0';
      requestAnimationFrame(() => {
        fl.style.transition = 'transform .2s ease, opacity .2s ease';
        fl.style.transform = '';
        fl.style.opacity = '1';
      });
    }, 160);
  }

  private _dragDot(p: number): void {
    const sw = document.getElementById('homeSwitcher'); if (!sw) return;
    const tabs = sw.querySelectorAll<HTMLElement>('.home-switcher__tab');
    const dot  = sw.querySelector<HTMLElement>('.home-switcher__dot');
    if (tabs.length < 2 || !dot) return;
    const homeC = tabs[0].offsetLeft + tabs[0].offsetWidth / 2;
    const explC = tabs[1].offsetLeft + tabs[1].offsetWidth / 2;
    const cl = Math.max(0, Math.min(1, p));
    dot.style.transition = 'none';
    dot.style.left = `${homeC + (explC - homeC) * cl}px`;
  }

  private _paintFeedLoading(): void {
    const fl = document.getElementById('homeFeedList');
    if (fl) fl.innerHTML = '<div class="home-loading"><div class="home-loading__spinner"></div></div>';
  }

  private async _getGeo(): Promise<{ lat: number; lng: number } | null> {
    if (this._geo) return this._geo;
    if (this._geoTried) return null;
    this._geoTried = true;
    if (!('geolocation' in navigator)) return null;
    return new Promise(resolve => {
      let done = false;
      const finish = (v: { lat: number; lng: number } | null): void => { if (!done) { done = true; this._geo = v; resolve(v); } };
      const t = setTimeout(() => finish(null), 6000);
      navigator.geolocation.getCurrentPosition(
        pos => { clearTimeout(t); finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
        ()  => { clearTimeout(t); finish(null); },
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 },
      );
    });
  }

  private async _loadExplore(): Promise<void> {
    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
    if (!userId) return;
    const geo = await this._getGeo();
    const geoQ = geo ? `&lat=${geo.lat}&lng=${geo.lng}` : '';
    try {
      const res = await fetch(`${BACKEND_URL}/feed/explore?userId=${encodeURIComponent(userId)}${geoQ}&offset=0`, { cache: 'no-store' });
      const d = await res.json() as { status: string; hasMore: boolean; data: Array<{ kind: string; date: number; data: Record<string, unknown> }> };
      this._exploreFeed    = d.data ?? [];
      this._exploreOffset  = this._exploreFeed.length;
      this._exploreHasMore = d.hasMore ?? false;
      if (this._homeSection === 'explore') this._repaintFeed?.(this._exploreFeed);
    } catch {
      if (this._homeSection === 'explore') {
        const fl = document.getElementById('homeFeedList');
        if (fl) fl.innerHTML = `
          <div class="home-empty">
            <div class="home-empty__icon">🌐</div>
            <h3 class="home-empty__title">Couldn't load Explore</h3>
            <p class="home-empty__sub">Check your connection and try again</p>
          </div>`;
      }
    }
  }

  // ── Impression tracking (X-style reach) ─────────────────────────────────────

  private _observeImpression(card: HTMLElement, id: string): void {
    if (!id || this._impSeen.has(id)) return;
    if (!this._impObserver) {
      this._impObserver = new IntersectionObserver(entries => {
        for (const e of entries) {
          if (!e.isIntersecting || e.intersectionRatio < 0.5) continue;
          const eid = (e.target as HTMLElement).dataset.impId;
          this._impObserver?.unobserve(e.target);
          if (eid && !this._impSeen.has(eid)) { this._impSeen.add(eid); this._impPending.add(eid); this._scheduleImpFlush(); }
        }
      }, { threshold: [0.5] });
    }
    if (!this._impFlushBound) {
      this._impFlushBound = true;
      const flush = (): void => { void this._flushImpressions(); };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
      window.addEventListener('pagehide', flush);
    }
    card.dataset.impId = id;
    this._impObserver.observe(card);
  }

  private _scheduleImpFlush(): void {
    if (this._impTimer) return;
    this._impTimer = window.setTimeout(() => { this._impTimer = undefined; void this._flushImpressions(); }, 4000);
  }

  private async _flushImpressions(): Promise<void> {
    if (this._impPending.size === 0) return;
    const ids = [...this._impPending];
    this._impPending.clear();
    try {
      await fetch(`${BACKEND_URL}/feed/impressions`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      });
    } catch { /* offline: drop (already marked seen this session) */ }
  }

  private _setupSwitcherAutohide(scroll: HTMLElement): void {
    if (this._switcherAutohideInited) return;
    this._switcherAutohideInited = true;
    let lastY = scroll.scrollTop;
    scroll.addEventListener('scroll', () => {
      const sw = document.getElementById('homeSwitcher');
      if (!sw) return;
      const y = scroll.scrollTop;
      const stuck = sw.getBoundingClientRect().top <= scroll.getBoundingClientRect().top + 1;
      if (!stuck) {
        sw.classList.remove('home-switcher--hidden');          // natural spot under streak → always visible
      } else if (y > lastY + 6 && y > 120) {
        sw.classList.add('home-switcher--hidden');             // scrolling down → hide
      } else if (y < lastY - 6) {
        sw.classList.remove('home-switcher--hidden');          // scrolling up → show
      }
      lastY = y;
    }, { passive: true });
  }

  private _setupSectionSwipe(feedList: HTMLElement): void {
    let sx = 0, sy = 0, dx = 0, active = false, decided = false, horizontal = false;
    const width = (): number => feedList.clientWidth || window.innerWidth || 1;

    feedList.addEventListener('touchstart', e => {
      if (e.touches.length !== 1) { active = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY;
      dx = 0; active = true; decided = false; horizontal = false;
    }, { passive: true });

    feedList.addEventListener('touchmove', e => {
      if (!active) return;
      dx = e.touches[0].clientX - sx;
      const dy = e.touches[0].clientY - sy;
      if (!decided) {
        if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
          decided = true;
          horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
          if (horizontal) feedList.style.transition = 'none';
        }
      }
      if (!horizontal) return;
      e.preventDefault();
      const cur = this._homeSection;
      let d = dx;
      if (cur === 'home' && d > 0) d *= 0.25;        // nothing left of Home
      if (cur === 'explore' && d < 0) d *= 0.25;     // nothing right of Explore
      const w = width();
      const cl = Math.max(-w, Math.min(w, d));
      feedList.style.transform = `translateX(${cl}px)`;
      feedList.style.opacity = String(1 - Math.min(0.45, Math.abs(cl) / w * 0.6));
      const p = cur === 'home' ? -cl / w : 1 - (cl / w);   // 0 = Home, 1 = Explore
      this._dragDot(p);
    }, { passive: false });

    const end = (): void => {
      if (!active) return; active = false;
      if (!horizontal) { feedList.style.transform = ''; feedList.style.opacity = '1'; return; }
      const w = width();
      const cur = this._homeSection;
      const progress = dx / w;
      if (cur === 'home' && progress < -0.28)        this._commitSwipe('explore');
      else if (cur === 'explore' && progress > 0.28) this._commitSwipe('home');
      else {
        feedList.style.transition = 'transform .2s ease, opacity .2s ease';
        feedList.style.transform = ''; feedList.style.opacity = '1';
        this._positionSwitcherDot();
      }
    };
    feedList.addEventListener('touchend', end, { passive: true });
    feedList.addEventListener('touchcancel', end, { passive: true });
  }

  // ── Pull-to-refresh (app-styled) ────────────────────────────────────────────

  private _setupPullToRefresh(scroll: HTMLElement): void {
    if (this._ptrInited) return;
    this._ptrInited = true;

    const ind = document.createElement('div');
    ind.className = 'home-ptr';
    ind.innerHTML = '<div class="home-ptr__spinner"></div>';
    (scroll.parentElement ?? document.body).appendChild(ind);
    const spinner = ind.querySelector<HTMLElement>('.home-ptr__spinner')!;

    const THRESH = 64;
    let startY = 0, pulling = false, dist = 0, refreshing = false;

    const reset = (): void => { ind.style.transform = 'translateX(-50%) translateY(0)'; ind.style.opacity = '0'; spinner.style.transform = ''; };

    scroll.addEventListener('touchstart', e => {
      if (refreshing) return;
      pulling = scroll.scrollTop <= 0;
      startY = e.touches[0].clientY;
      dist = 0;
    }, { passive: true });

    scroll.addEventListener('touchmove', e => {
      if (!pulling || refreshing) return;
      dist = e.touches[0].clientY - startY;
      if (dist <= 0 || scroll.scrollTop > 0) { pulling = scroll.scrollTop <= 0; reset(); return; }
      const d = Math.min(110, dist * 0.5);                       // damped travel
      ind.style.transform = `translateX(-50%) translateY(${d}px)`;
      ind.style.opacity = String(Math.min(1, d / THRESH));
      spinner.style.transform = `rotate(${d * 4}deg)`;
      if (dist > 6) e.preventDefault();                          // take over the gesture
    }, { passive: false });

    const release = async (): Promise<void> => {
      if (!pulling) return;
      pulling = false;
      if (refreshing) return;
      if (dist * 0.5 < THRESH) { reset(); return; }
      refreshing = true;
      ind.classList.add('home-ptr--active');
      ind.style.transform = `translateX(-50%) translateY(${THRESH}px)`;
      ind.style.opacity = '1';
      spinner.style.transform = '';
      try {
        const uid = localStorage.getItem('mapyou_userId_profile') ?? '';
        if (uid) { try { sessionStorage.removeItem(`mapyou_feedcache_${uid}`); } catch { /* ignore */ } }
        await this.render();
      } finally {
        refreshing = false;
        ind.classList.remove('home-ptr--active');
        reset();
      }
    };
    scroll.addEventListener('touchend', () => void release(), { passive: true });
    scroll.addEventListener('touchcancel', () => void release(), { passive: true });
  }

  // ── Feed cache + background fetch helpers ───────────────────────────────────

  private _feedSig(feed: Array<{ date: number; data: Record<string, unknown> }>): string {
    return feed.map(f =>
      `${(f.data.activityId ?? f.data.postId ?? f.data.id) as string}:${(f.data._likeCount ?? 0) as number}:${(f.data._commentCount ?? 0) as number}`,
    ).join('|');
  }

  private _readFeedCache(userId: string): { feed: Array<{ kind: string; date: number; data: Record<string, unknown> }>; hasMore: boolean } | null {
    if (!userId) return null;
    try {
      const raw = sessionStorage.getItem(`mapyou_feedcache_${userId}`);
      if (!raw) return null;
      const o = JSON.parse(raw) as { feed?: Array<{ kind: string; date: number; data: Record<string, unknown> }>; hasMore?: boolean };
      return Array.isArray(o.feed) ? { feed: o.feed, hasMore: !!o.hasMore } : null;
    } catch { return null; }
  }

  private _writeFeedCache(userId: string, feed: Array<{ kind: string; date: number; data: Record<string, unknown> }>, hasMore: boolean): void {
    if (!userId) return;
    try { sessionStorage.setItem(`mapyou_feedcache_${userId}`, JSON.stringify({ feed, hasMore })); }
    catch { /* quota exceeded — skip caching */ }
  }

  private async _fetchServerFeed(userId: string): Promise<{ feed: Array<{ kind: string; date: number; data: Record<string, unknown> }>; hasMore: boolean } | null> {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 5000);
      const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}`, { cache: 'no-store', signal: ctrl.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      const d = await res.json() as { status: string; hasMore: boolean; data: Array<{ kind: string; date: number; data: Record<string, unknown> }> };
      return { feed: d.data ?? [], hasMore: d.hasMore ?? false };
    } catch { return null; }
  }

  private _setupInfiniteScroll(scroll: HTMLElement, activities: import('./db.js').EnrichedActivity[], posts: import('./db.js').PostRecord[], userId: string): void {
    this._feedObserver?.disconnect();
    document.getElementById('feedSentinel')?.remove();
    const hasMore = this._homeSection === 'explore' ? this._exploreHasMore : this._feedHasMore;
    if (!hasMore) return;
    const sentinel = document.createElement('div');
    sentinel.id = 'feedSentinel';
    sentinel.style.height = '1px';
    scroll.appendChild(sentinel);
    this._feedObserver = new IntersectionObserver(entries => {
      const explore = this._homeSection === 'explore';
      const loading = explore ? this._exploreLoading : this._feedLoading;
      const more    = explore ? this._exploreHasMore : this._feedHasMore;
      if (entries[0].isIntersecting && !loading && more) {
        void this._loadMoreFeed(scroll, activities, posts, userId);
      }
    }, { rootMargin: '300px' });
    this._feedObserver.observe(sentinel);
  }

  private async _loadMoreFeed(scroll: HTMLElement, activities: import('./db.js').EnrichedActivity[], posts: import('./db.js').PostRecord[], userId: string): Promise<void> {
    const explore = this._homeSection === 'explore';
    if ((explore ? this._exploreLoading : this._feedLoading) || !(explore ? this._exploreHasMore : this._feedHasMore)) return;
    if (explore) this._exploreLoading = true; else this._feedLoading = true;
    const spinner = document.createElement('div');
    spinner.id = 'feedLoadMore';
    spinner.className = 'home-loading';
    spinner.innerHTML = '<div class="home-loading__spinner"></div>';
    document.getElementById('feedSentinel')?.before(spinner);
    try {
      const geoQ = this._geo ? `&lat=${this._geo.lat}&lng=${this._geo.lng}` : '';
      const url = explore
        ? `${BACKEND_URL}/feed/explore?userId=${encodeURIComponent(userId)}${geoQ}&offset=${this._exploreOffset}`
        : `${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}&before=${this._feedCursor}`;
      const res = await fetch(url, { cache: 'no-store' });
      if (res.ok) {
        const d = await res.json() as { status: string; hasMore: boolean; data: Array<{ kind: string; date: number; data: Record<string, unknown> }> };
        const newItems = d.data ?? [];
        if (explore) this._exploreHasMore = d.hasMore ?? false; else this._feedHasMore = d.hasMore ?? false;
        if (newItems.length > 0) {
          if (explore) { this._exploreOffset += newItems.length; this._exploreFeed?.push(...newItems); }
          else this._feedCursor = newItems[newItems.length - 1].date;
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
                (local as unknown as Record<string,unknown>).views = (item.data._viewCount as number) ?? 0;
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
            if (item.kind === 'activity') {
              card.style.cursor = 'pointer';
              card.addEventListener('click', e => {
                if ((e.target as HTMLElement).closest('button, a, video, input, [data-action], [data-pm], .home-card__photo, .home-card__avatar--user, .home-card__comment-panel, .hcs')) return;
                void openActivityDetail(item.data as unknown as EnrichedActivity, isOwn, (item.data.activityId ?? item.data.id) as string);
              });
            }
            scroll.appendChild(card);
            if (item.kind === 'activity') this._observeImpression(card, (item.data.activityId ?? item.data.id) as string);
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
          if (explore ? this._exploreHasMore : this._feedHasMore) this._setupInfiniteScroll(scroll, activities, posts, userId);
        } else if (explore) { this._exploreHasMore = false; } else { this._feedHasMore = false; }
      }
    } catch {}
    document.getElementById('feedLoadMore')?.remove();
    if (explore) this._exploreLoading = false; else this._feedLoading = false;
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
        // Render minimap for activities with coordsEnc
        const enc = (item.data.coordsEnc ?? item.data._coordsEncResolved ?? null) as string | null;
        if (enc && item.kind === 'activity') {
          const mapEl = card.querySelector<HTMLElement>('.home-card__map-wrap--canvas, .home-card__map-wrap');
          if (mapEl) {
            const coords = decodePolyline(enc);
            if (coords.length > 0) renderMinimapCanvas(mapEl, coords, (item.data.sport ?? 'running') as string);
          }
        }
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
        views:       +(data._viewCount ?? data.views ?? 0),
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
            broadcastLike(act.id, d.liked, d.count);
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

/** Eksportowana funkcja do otwierania viewera z zewnątrz (ProfileView, PublicProfile) */
export function openReelViewer(
  group: { userId: string; authorName: string; avatarB64: string | null; reels: unknown[]; hasUnseen: boolean },
  onSeen: () => void,
): void {
  // Inject the group into the feed temporarily so _openReelsViewer can find it
  const hv = homeView as unknown as Record<string, unknown>;
  const feed = hv._reelsFeed as typeof group[] | undefined;
  if (feed) {
    const existing = feed.findIndex(g => g.userId === group.userId);
    if (existing >= 0) feed[existing] = group;
    else feed.unshift(group);
  }
  void (hv._openReelsViewer as (uid: string, idx: number) => Promise<void>)(group.userId, 0);
  onSeen();
}

import { getIcon as _gi2, getColor as _gc2 } from './Tracker.js';
(window as unknown as Record<string, unknown>)._mapyouGetIcon  = _gi2;
(window as unknown as Record<string, unknown>)._mapyouGetColor = _gc2;
