// ─── HOME VIEW — Activity Feed ────────────────────────────────────────────────
// src/modules/HomeView.ts
import { loadEnrichedActivities, deleteEnrichedActivity, deleteActivity, updateEnrichedActivityFields } from './db.js';
import { isRouteSaved, saveRoute, unsaveRoute } from './SavedRoutes.js';
import { openPublicProfile } from './PublicProfile.js';
import { BACKEND_URL } from '../config.js';
import { renderMinimapCanvas, decodePolyline, encodePolyline, pushNow, uploadReel } from './cloudSync.js';
import { getIcon, getColor, getSportLabel, formatDuration, formatPace, formatDistance } from './Tracker.js';
import { generateShareImageFromEnriched, composeActivityReel } from './ShareImage.js';
import { loadProfileFromLocal } from './UserProfile.js';
import { getNotifications, getUnreadCount, markAllRead, clearAll, onNotificationsChange, notifyActivityAdded, syncFromBackend, markAllReadRemote, } from './NotificationsService.js';
import { profileView, updateBestStreak } from './ProfileView.js';
import { searchView } from './SearchView.js';
import { openPostModal } from './PostModal.js';
import { openSaveActivityModal } from './SaveActivityModal.js';
import { loadUnifiedWorkouts } from './UnifiedWorkout.js';
import { statsView } from './StatsView.js';
import { loadPosts } from './db.js';
import { CS } from './cloudSync.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
// Tap-to-zoom for activity photos (Stats detail + activity detail). Delegated, bound once.
if (typeof document !== 'undefined' && !window.__photoZoomBound) {
    window.__photoZoomBound = true;
    document.addEventListener('click', e => {
        const img = e.target.closest('.sv-detail-photo img, .ad-photo img');
        if (!img)
            return;
        e.stopPropagation();
        const ov = document.createElement('div');
        ov.className = 'sv-lightbox';
        ov.innerHTML = `<img src="${img.src}" alt=""/>`;
        ov.addEventListener('click', () => ov.remove());
        document.body.appendChild(ov);
    });
}
function relativeDate(timestamp) {
    const diff = Date.now() - timestamp;
    const mins = Math.floor(diff / 60000);
    if (mins < 1)
        return 'Just now';
    if (mins < 60)
        return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)
        return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)
        return `${days}d ago`;
    return new Date(timestamp).toLocaleDateString('en', { month: 'short', day: 'numeric' });
}
function intensityLabel(n) {
    const labels = ['', 'Easy', 'Moderate', 'Hard', 'Very Hard', 'Max Effort'];
    return labels[n] ?? '';
}
function intensityColor(n) {
    const colors = ['', '#4ade80', '#facc15', '#fb923c', '#f87171', '#ef4444'];
    return colors[n] ?? '#4ade80';
}
// ── Mini map — uses renderMinimapCanvas from cloudSync.ts ──────────────────
// ── Comment panel ─────────────────────────────────────────────────────────────
// Keep every like button for an item (feed card, post card, activity detail) in sync
function broadcastLike(id, liked, count) {
    document.querySelectorAll(`[data-like-count="${id}"], [data-like-count="p_${id}"]`).forEach(el => {
        el.textContent = String(count);
        el.closest('.home-card__action')?.classList.toggle('home-card__action--liked', liked);
    });
}
// Local liked-reels cache so a like shows instantly on re-entry, before the
// feed re-fetch catches up with the server.
function getLikedReels() {
    try {
        return new Set(JSON.parse(localStorage.getItem('mapyou_liked_reels') ?? '[]'));
    }
    catch {
        return new Set();
    }
}
function setReelLiked(id, liked) {
    const s = getLikedReels();
    if (liked)
        s.add(id);
    else
        s.delete(id);
    try {
        localStorage.setItem('mapyou_liked_reels', JSON.stringify([...s]));
    }
    catch { /* ignore */ }
}
function openCommentPanel(card, actId) {
    card.querySelector('.home-card__comment-panel')?.remove();
    const panel = document.createElement('div');
    panel.className = 'home-card__comment-panel';
    // Determine itemType from actId prefix
    const itemType = actId.startsWith('p_') ? 'post' : 'activity';
    const realId = actId.startsWith('p_') ? actId.slice(2) : actId;
    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
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
    const input = panel.querySelector('.hcc__input');
    const list = panel.querySelector(`#hcc-list-${actId}`);
    input.focus();
    // Load comments from Atlas
    const renderAtlasComments = (comments) => {
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
        .then((d) => {
        renderAtlasComments(d.data ?? []);
        // Update count badge
        const countEl = card.querySelector(`[data-comment-count="${actId}"], [data-comment-count="${realId}"]`);
        if (countEl)
            countEl.textContent = String(d.data?.length ?? 0);
    }).catch(() => { list.innerHTML = '<p class="hcc__empty">No comments yet</p>'; });
    const sendComment = async () => {
        const text = input.value.trim();
        if (!text)
            return;
        input.value = '';
        input.disabled = true;
        try {
            const res = await fetch(`${BACKEND_URL}/feed/comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, authorName: userName, itemId: realId, itemType, text }),
            });
            if (res.ok) {
                // Reload comments
                const r2 = await fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(realId)}`);
                const d2 = await r2.json();
                renderAtlasComments(d2.data ?? []);
                const countEl = card.querySelector(`[data-comment-count="${actId}"], [data-comment-count="${realId}"]`);
                if (countEl)
                    countEl.textContent = String(d2.data?.length ?? 0);
            }
        }
        catch { }
        input.disabled = false;
        input.focus();
    };
    panel.querySelector('.hcc__send')?.addEventListener('click', () => void sendComment());
    input.addEventListener('keydown', e => { if (e.key === 'Enter')
        void sendComment(); });
}
// ── Full-screen comments view (Strava-style — keyboard never covers input) ────
function openCommentsView(card, actId) {
    document.getElementById('commentsView')?.remove();
    const itemType = actId.startsWith('p_') ? 'post' : 'activity';
    const realId = actId.startsWith('p_') ? actId.slice(2) : actId;
    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
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
    const sheet = ov.querySelector('.cv-sheet');
    const vv = window.visualViewport;
    const applyVV = () => {
        if (!vv)
            return;
        sheet.style.height = `${vv.height}px`;
        sheet.style.transform = `translateY(${vv.offsetTop}px)`;
    };
    if (vv) {
        vv.addEventListener('resize', applyVV);
        vv.addEventListener('scroll', applyVV);
        applyVV();
    }
    const close = () => {
        if (vv) {
            vv.removeEventListener('resize', applyVV);
            vv.removeEventListener('scroll', applyVV);
        }
        ov.remove();
    };
    ov.querySelector('#cvBack')?.addEventListener('click', close);
    const input = ov.querySelector('#cvInput');
    const list = ov.querySelector('#cvList');
    const render = (comments) => {
        list.innerHTML = comments.length
            ? comments.map(c => `<div class="cv-item">
          <span class="cv-author">${c.authorName}</span>
          <span class="cv-text">${c.text}</span>
        </div>`).join('')
            : '<p class="cv-empty">No comments yet — be the first.</p>';
        list.scrollTop = list.scrollHeight;
    };
    const updateCount = (n) => {
        const el = card.querySelector(`[data-comment-count="${actId}"], [data-comment-count="${realId}"]`);
        if (el)
            el.textContent = String(n);
    };
    void fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(realId)}`)
        .then(r => r.json())
        .then((d) => {
        render(d.data ?? []);
        updateCount(d.data?.length ?? 0);
    })
        .catch(() => { list.innerHTML = '<p class="cv-empty">No comments yet</p>'; });
    const send = async () => {
        const text = input.value.trim();
        if (!text)
            return;
        input.value = '';
        input.disabled = true;
        try {
            const res = await fetch(`${BACKEND_URL}/feed/comment`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, authorName: userName, itemId: realId, itemType, text }),
            });
            if (res.ok) {
                const r2 = await fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(realId)}`);
                const d2 = await r2.json();
                render(d2.data ?? []);
                updateCount(d2.data?.length ?? 0);
            }
        }
        catch { }
        input.disabled = false;
        input.focus();
    };
    ov.querySelector('#cvSend')?.addEventListener('click', () => void send());
    input.addEventListener('keydown', e => { if (e.key === 'Enter')
        void send(); });
    setTimeout(() => input.focus(), 300);
}
// ── Share panel ───────────────────────────────────────────────────────────────
function openSharePanel(card, act) {
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
        const btn = panel.querySelector(`#hcsDownload-${act.id}`);
        const span = btn.querySelector('span');
        btn.classList.add('hcs__opt--loading');
        span.textContent = 'Generating…';
        try {
            await generateShareImageFromEnriched(act);
            span.textContent = 'Downloaded! ✓';
            setTimeout(() => { span.textContent = 'Download image'; btn.classList.remove('hcs__opt--loading'); }, 2000);
        }
        catch {
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
            const btn = panel.querySelector(`#hcsCopy-${act.id}`);
            btn.querySelector('span').textContent = 'Copied! ✓';
            setTimeout(() => { btn.querySelector('span').textContent = 'Copy link'; }, 2000);
        }
        catch { }
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
            }
            catch { }
        });
    }
    // Auto-close when clicking outside
    setTimeout(() => {
        const closeHandler = (e) => {
            if (!panel.contains(e.target) && !card.querySelector('.home-card__action--share')?.contains(e.target)) {
                panel.classList.remove('home-card__share-panel--open');
                setTimeout(() => panel.remove(), 280);
                document.removeEventListener('click', closeHandler);
            }
        };
        document.addEventListener('click', closeHandler);
    }, 100);
}
// ── Lightbox ──────────────────────────────────────────────────────────────────
function openLightbox(src) {
    const existing = document.getElementById('homeLightbox');
    if (existing)
        existing.remove();
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
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape')
        close(); }, { once: true });
}
// ── Post card builder ─────────────────────────────────────────────────────────
export function buildPostCard(post, onRefresh) {
    const card = document.createElement('article');
    card.className = 'home-card home-card--post';
    card.dataset.id = post.id;
    const avatarHtml = post.avatarB64
        ? `<img src="${post.avatarB64}" class="home-card__avatar-img" alt="avatar"/>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
    const _postIsVideo = post.mediaType === 'video' || (post.photoUrl?.includes('/video/upload/') ?? false);
    const _postHasReel = post._authorHasReel;
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
            const bodyEl = card.querySelector(`#pbody-${post.id}`);
            const moreBtn = card.querySelector(`#pmore-${post.id}`);
            if (bodyEl)
                bodyEl.textContent = expanded ? post.body : post.body.slice(0, TRUNC) + '…';
            if (moreBtn)
                moreBtn.textContent = expanded ? 'mniej' : '…więcej';
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
        menu.querySelector('[data-pm="delete"]')?.addEventListener('click', async (ev) => {
            ev.stopPropagation();
            menu.remove();
            if (!confirm('Delete this post?'))
                return;
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
        const btn = e.currentTarget;
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        btn.classList.add('home-card__action--pulse');
        setTimeout(() => btn.classList.remove('home-card__action--pulse'), 400);
        void fetch(`${BACKEND_URL}/feed/like`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, itemId: post.id, itemType: 'post' }),
        }).then(r => r.json()).then((d) => {
            broadcastLike(post.id, d.liked, d.count);
        }).catch(() => {
            const liked = btn.classList.toggle('home-card__action--liked');
            const lsKey = `hc_likes_p_${post.id}`;
            const next = Math.max(0, parseInt(localStorage.getItem(lsKey) ?? '0', 10) + (liked ? 1 : -1));
            localStorage.setItem(lsKey, String(next));
            const el = card.querySelector(`[data-like-count="p_${post.id}"]`);
            if (el)
                el.textContent = String(next);
        });
    });
    // Wire comment
    card.querySelector('[data-action="comment"]')?.addEventListener('click', e => {
        e.stopPropagation();
        const existing = card.querySelector('.home-card__comment-panel');
        if (existing) {
            existing.classList.remove('home-card__comment-panel--open');
            setTimeout(() => existing.remove(), 280);
        }
        else {
            openCommentPanel(card, `p_${post.id}`);
        }
    });
    // Wire photo lightbox
    const photoEl = card.querySelector('.home-card__photo[data-photosrc]');
    if (photoEl) {
        photoEl.addEventListener('click', e => {
            e.stopPropagation();
            const src = photoEl.dataset.photosrc;
            if (src)
                openLightbox(src);
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
function _openEditPostModal(post, onSave) {
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
        setTimeout(() => overlay.querySelector('#editPostSheet')?.classList.add('pm-sheet--open'), 10);
    });
    const close = () => {
        overlay.querySelector('#editPostSheet')?.classList.remove('pm-sheet--open');
        overlay.classList.remove('pm-overlay--visible');
        setTimeout(() => overlay.remove(), 350);
    };
    overlay.querySelector('#epmClose')?.addEventListener('click', close);
    overlay.querySelector('#epmCancel')?.addEventListener('click', close);
    overlay.addEventListener('click', e => { if (e.target === overlay)
        close(); });
    const descEl = overlay.querySelector('#epmDesc');
    const countEl = overlay.querySelector('#epmCount');
    descEl.addEventListener('input', () => { countEl.textContent = `${descEl.value.length}/500`; });
    overlay.querySelector('#epmSave')?.addEventListener('click', async () => {
        const title = (overlay.querySelector('#epmTitle')?.value ?? '').trim();
        const body = descEl.value.trim();
        await CS.savePost({ ...post, title, body });
        close();
        onSave();
    });
}
// ── Card builder ──────────────────────────────────────────────────────────────
// ── Activity detail screen (Strava-style) ─────────────────────────────────────
function estimateCalories(sport, distanceKm, durationSec, weightKg) {
    const hours = durationSec / 3600;
    if (hours <= 0)
        return 0;
    const w = weightKg && weightKg > 0 ? weightKg : 70;
    let met = 7;
    if (sport === 'running')
        met = 9.8;
    else if (sport === 'cycling')
        met = 7.5;
    else if (sport === 'walking')
        met = 3.8;
    else if (sport === 'hiking')
        met = 6.0;
    return Math.round(met * w * hours);
}
let _adMap = null;
function adToast(msg) {
    document.getElementById('adToast')?.remove();
    const t = document.createElement('div');
    t.id = 'adToast';
    t.className = 'ad-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('ad-toast--show'));
    setTimeout(() => { t.classList.remove('ad-toast--show'); setTimeout(() => t.remove(), 250); }, 2200);
}
function openActivityOptionsMenu(ov, itemId, visibility, muted, closeDetail) {
    document.getElementById('adMenuOverlay')?.remove();
    const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
    const opts = [
        { v: 'everyone', ic: '🌐', t: 'Everyone', s: 'Visible to everyone' },
        { v: 'friends', ic: '👥', t: 'Friends', s: 'You and your friends' },
        { v: 'only_me', ic: '🔒', t: 'Only me', s: 'Only you can see it' },
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
    const closeMenu = () => menu.remove();
    menu.addEventListener('click', e => { if (e.target === menu)
        closeMenu(); });
    let curVis = visibility, curMuted = muted;
    const refreshBadge = () => {
        const badge = ov.querySelector('#adVisBadge');
        if (!badge)
            return;
        const t = curVis === 'everyone' ? 'Everyone' : curVis === 'friends' ? 'Friends' : 'Only me';
        const ic = curVis === 'everyone' ? '🌐' : curVis === 'friends' ? '👥' : '🔒';
        badge.textContent = `${ic} ${t}${curMuted ? ' · Hidden from feed' : ''}`;
    };
    const patch = async (body) => {
        try {
            await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(itemId)}`, {
                method: 'PATCH', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId, ...body }),
            });
        }
        catch { /* offline: local change stays, syncs later */ }
    };
    menu.querySelectorAll('[data-vis]').forEach(row => {
        row.addEventListener('click', () => {
            const v = row.dataset.vis;
            curVis = v;
            menu.querySelectorAll('[data-vis]').forEach(r => {
                r.classList.toggle('adm-row--active', r === row);
                const chk = r.querySelector('.adm-check');
                if (chk)
                    chk.textContent = r === row ? '✓' : '';
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
        if (!confirm('Delete this activity? This cannot be undone.'))
            return;
        void (async () => {
            try {
                await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' });
            }
            catch { /* ignore */ }
            await deleteEnrichedActivity(itemId);
            await deleteActivity(itemId);
            try {
                const k = 'mapyou_deleted_workout_ids';
                const arr = JSON.parse(localStorage.getItem(k) || '[]');
                if (Array.isArray(arr) && !arr.includes(itemId)) {
                    arr.push(itemId);
                    localStorage.setItem(k, JSON.stringify(arr));
                }
            }
            catch { /* ignore */ }
            try {
                sessionStorage.removeItem(`mapyou_feedcache_${userId}`);
            }
            catch { /* ignore */ }
            closeMenu();
            closeDetail();
            adToast('Activity deleted');
            void homeView.render();
        })();
    });
}
export async function openActivityDetail(act, isOwn, actId) {
    document.getElementById('activityDetailOverlay')?.remove();
    if (_adMap) {
        try {
            _adMap.remove();
        }
        catch { /* ignore */ }
        _adMap = null;
    }
    // Own activities: reload full record (coords / laps / notes) from IndexedDB
    let full = act;
    if (isOwn) {
        const realId = actId || act.activityId || act.id;
        const fresh = (await loadEnrichedActivities()).find(a => a.id === realId);
        if (fresh)
            full = fresh;
    }
    const rec = full;
    const color = getColor(full.sport);
    const icon = getIcon(full.sport);
    const isCycle = full.sport === 'cycling';
    const timeFmt = formatDuration(full.durationSec);
    const paceFmt = isCycle ? full.speedKmH.toFixed(1) : formatPace(full.paceMinKm);
    const paceLbl = isCycle ? 'km/h' : 'min/km';
    const profile = loadProfileFromLocal();
    const kcal = estimateCalories(full.sport, full.distanceKm, full.durationSec, profile.weightKg);
    const ownCoords = isOwn && Array.isArray(full.coords) && full.coords.length > 0;
    const encoded = rec._coordsEncResolved ?? rec.coordsEnc ?? null;
    const friendCoords = !ownCoords && encoded ? decodePolyline(encoded) : null;
    const routeCoords = (ownCoords ? full.coords : (friendCoords ?? []));
    const hasRoute = routeCoords.length > 0;
    const visibility = (rec.visibility || 'everyone');
    const muted = rec.muted === true;
    const visText = visibility === 'everyone' ? 'Everyone' : visibility === 'friends' ? 'Friends' : 'Only me';
    const visIco = visibility === 'everyone' ? '🌐' : visibility === 'friends' ? '👥' : '🔒';
    const visBadge = `${visIco} ${visText}${muted ? ' · Hidden from feed' : ''}`;
    const authorName = rec.authorName || (isOwn ? (profile.name || 'You') : getSportLabel(full.sport));
    const avatarSrc = rec.avatarB64 ?? rec.authorAvatarUrl ?? (isOwn ? profile.avatarB64 : null);
    const avatarHtml = avatarSrc ? `<img src="${avatarSrc}" alt="avatar"/>` : `<span>${icon}</span>`;
    const title = (full.name || '').replace(/^(undefined|null)\s*/i, '').trim() || getSportLabel(full.sport);
    const dateStr = new Date(full.date).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
        + ' · ' + new Date(full.date).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
    const photoIsVideo = full.mediaType === 'video' || (full.photoUrl?.includes('/video/upload/') ?? false);
    const photoHtml = full.photoUrl
        ? photoIsVideo
            ? `<div class="ad-photo"><video src="${full.photoUrl}" playsinline controls preload="metadata"></video></div>`
            : `<div class="ad-photo"><img src="${full.photoUrl}" alt="Activity photo" loading="lazy"/></div>`
        : '';
    // Splits — author only, only when real laps exist
    let splitsHtml = '';
    const lapsArr = rec.laps;
    if (isOwn && Array.isArray(lapsArr) && lapsArr.length > 0) {
        const laps = lapsArr;
        const slowest = Math.max(...laps.map(l => l.paceMinKm || 0)) || 1; // longest bar = slowest
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
    const itemId = actId || rec.activityId || full.id;
    const likeCount = rec._likeCount ?? 0;
    const commentCount = rec._commentCount ?? 0;
    const viewCount = (act._viewCount ?? act.views)
        ?? rec._viewCount ?? rec.views ?? 0;
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
        if (_adMap) {
            try {
                _adMap.remove();
            }
            catch { /* ignore */ }
            _adMap = null;
        }
        ov.remove();
    };
    ov.querySelector('#adBack')?.addEventListener('click', close);
    // Bookmark — save/unsave this route to Track → Routes (anyone with a map)
    const bookmarkBtn = ov.querySelector('#adBookmark');
    bookmarkBtn?.addEventListener('click', () => {
        const svg = bookmarkBtn.querySelector('svg');
        if (isRouteSaved(itemId)) {
            unsaveRoute(itemId);
            svg?.setAttribute('fill', 'none');
            adToast('Removed from saved routes');
        }
        else {
            const route = {
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
    ov.querySelector('#adMore')?.addEventListener('click', () => {
        openActivityOptionsMenu(ov, itemId, visibility, muted, close);
    });
    // Draggable bottom sheet — drag up to expand (~80%), down to reveal the map
    const sheet = ov.querySelector('.ad-sheet');
    const grab = ov.querySelector('.ad-grab');
    if (sheet && grab) {
        let startY = 0, startT = 0, curT = 0, dragging = false;
        const expandedT = 0; // translateY 0 → full 80vh visible
        const defaultT = () => Math.round(window.innerHeight * 0.24); // rest: ~56vh visible
        const maxT = () => Math.max(0, sheet.offsetHeight - 150); // collapsed: 150px peek
        // Start at the comfortable default position (not fully expanded)
        curT = defaultT();
        sheet.style.transform = `translateY(${curT}px)`;
        grab.addEventListener('pointerdown', e => {
            dragging = true;
            startY = e.clientY;
            startT = curT;
            sheet.style.transition = 'none';
            try {
                grab.setPointerCapture(e.pointerId);
            }
            catch { /* ignore */ }
        });
        grab.addEventListener('pointermove', e => {
            if (!dragging)
                return;
            let t = startT + (e.clientY - startY);
            t = Math.max(expandedT, Math.min(maxT(), t));
            curT = t;
            sheet.style.transform = `translateY(${t}px)`;
        });
        const end = () => {
            if (!dragging)
                return;
            dragging = false;
            sheet.style.transition = '';
            const dT = defaultT(), mT = maxT();
            // Snap to the nearest of: expanded (80%) / default (~56%) / collapsed (peek)
            if (curT < dT * 0.5)
                curT = expandedT;
            else if (curT < (dT + mT) / 2)
                curT = dT;
            else
                curT = mT;
            sheet.style.transform = `translateY(${curT}px)`;
        };
        grab.addEventListener('pointerup', end);
        grab.addEventListener('pointercancel', end);
    }
    // Hero map / minimap (after layout + entry animation, so dimensions are final)
    const sheetPx = Math.round(window.innerHeight * 0.56);
    setTimeout(() => {
        const mapEl = document.getElementById('adHeroMap');
        if (!mapEl)
            return;
        if (ownCoords) {
            _adMap = L.map(mapEl, { zoomControl: false, attributionControl: false, dragging: true });
            L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(_adMap);
            const pts = full.coords.map(c => L.latLng(c[0], c[1]));
            if (pts.length === 1) {
                _adMap.setView(pts[0], 15);
                L.circleMarker(pts[0], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(_adMap);
            }
            else {
                const line = L.polyline(pts, { color, weight: 4, opacity: 0.95 }).addTo(_adMap);
                // Push the route into the visible area above the sheet
                _adMap.fitBounds(line.getBounds(), { paddingTopLeft: [28, 28], paddingBottomRight: [28, sheetPx] });
                L.circleMarker(pts[0], { radius: 6, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1 }).addTo(_adMap);
                L.circleMarker(pts[pts.length - 1], { radius: 6, color: '#fff', weight: 2, fillColor: '#e74c3c', fillOpacity: 1 }).addTo(_adMap);
            }
            // Leaflet renders blank if created before the container settled — force a resize pass
            setTimeout(() => { try {
                _adMap?.invalidateSize();
            }
            catch { /* ignore */ } }, 250);
        }
        else if (friendCoords && friendCoords.length > 0) {
            renderMinimapCanvas(mapEl, friendCoords, full.sport);
        }
    }, 320);
    // Footer — same like/comment/share behaviour as the feed (backend like toggle)
    ov.querySelectorAll('.ad-footer .home-card__action').forEach(btn => {
        btn.addEventListener('click', e => {
            e.stopPropagation();
            const action = btn.dataset.action;
            const sheetEl = ov.querySelector('.ad-sheet');
            if (action === 'like') {
                btn.classList.add('home-card__action--pulse');
                setTimeout(() => btn.classList.remove('home-card__action--pulse'), 400);
                const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
                void fetch(`${BACKEND_URL}/feed/like`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, itemId, itemType: 'activity' }),
                }).then(r => r.json()).then((d) => {
                    broadcastLike(itemId, d.liked, d.count);
                }).catch(() => { });
            }
            if (action === 'comment') {
                openCommentsView(sheetEl, itemId);
            }
            if (action === 'share') {
                const existing = sheetEl.querySelector('.home-card__share-panel');
                if (existing) {
                    existing.classList.remove('home-card__share-panel--open');
                    setTimeout(() => existing.remove(), 280);
                }
                else
                    openSharePanel(sheetEl, full);
            }
        });
    });
    // Load current like state + count, and the comment count
    {
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        if (userId) {
            void fetch(`${BACKEND_URL}/feed/likes/batch?userId=${encodeURIComponent(userId)}&items=${encodeURIComponent(itemId)}`, { cache: 'no-store' })
                .then(r => r.json())
                .then((resp) => {
                if (resp.status !== 'ok')
                    return;
                const info = resp.data[itemId];
                if (!info)
                    return;
                const likeBtn = ov.querySelector('.ad-footer .home-card__action--like');
                likeBtn?.classList.toggle('home-card__action--liked', info.liked);
                const el = ov.querySelector(`[data-like-count="${itemId}"]`);
                if (el)
                    el.textContent = String(info.count);
            }).catch(() => { });
        }
        // Comment count — keep detail in sync with the feed (works for own + friends')
        void fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(itemId)}`)
            .then(r => r.json())
            .then((d) => {
            if (!Array.isArray(d.data))
                return;
            const el = ov.querySelector(`[data-comment-count="${itemId}"]`);
            if (el)
                el.textContent = String(d.data.length);
        }).catch(() => { });
    }
}
export function buildCard(act) {
    const card = document.createElement('article');
    card.className = 'home-card';
    card.dataset.id = act.id;
    const color = getColor(act.sport);
    const icon = getIcon(act.sport);
    const distFmt = formatDistance(act.distanceKm);
    const timeFmt = formatDuration(act.durationSec);
    const paceFmt = act.sport !== 'cycling' ? formatPace(act.paceMinKm) : act.speedKmH.toFixed(1);
    const paceLabel = act.sport !== 'cycling' ? 'min/km' : 'km/h';
    const mapId = `hcmap-${act.id}`;
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
    const _actRec = act;
    const avatarSrc = _actRec.avatarB64
        ?? _actRec.authorAvatarUrl
        ?? profile.avatarB64;
    const userAvatarHtml = avatarSrc
        ? `<img src="${avatarSrc}" class="home-card__avatar-img" alt="avatar"/>`
        : `<span>${icon}</span>`;
    const _cleanName = (s) => (s || '')
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
        ${act.authorName ? `<span class="home-card__author-name" style="font-size:1.2rem;font-weight:700;color:#fff;display:block;line-height:1.2">${act.authorName}</span>` : ''}
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

    ${act.coords && act.coords.length > 0 ? `<div class="home-card__map-wrap" id="${mapId}"></div>` : act.coordsEnc ? `<div class="home-card__map-wrap home-card__map-wrap--canvas"></div>` : ''}

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
        <span class="home-card__action-count">${act.views ?? 0}</span>
      </span>

      <button class="home-card__action home-card__action--share" data-action="share" aria-label="Share">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
          <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
          <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
        </svg>
      </button>
    </div>`;
    // ── Wire actions — stopPropagation prevents workout form from opening ──────
    card.querySelectorAll('.home-card__action').forEach(btn => {
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
                }).then(r => r.json()).then((d) => {
                    broadcastLike(act.id, d.liked, d.count);
                }).catch(() => {
                    // offline fallback
                    const liked = btn.classList.toggle('home-card__action--liked');
                    const lsKey = `hc_likes_${act.id}`;
                    const next = Math.max(0, parseInt(localStorage.getItem(lsKey) ?? '0', 10) + (liked ? 1 : -1));
                    localStorage.setItem(lsKey, String(next));
                    const el = card.querySelector(`[data-like-count="${act.id}"]`);
                    if (el)
                        el.textContent = String(next);
                });
            }
            if (action === 'comment') {
                const existing = card.querySelector('.home-card__comment-panel');
                if (existing) {
                    existing.classList.remove('home-card__comment-panel--open');
                    setTimeout(() => existing.remove(), 280);
                }
                else {
                    openCommentPanel(card, act.id);
                }
            }
            if (action === 'share') {
                const existing = card.querySelector('.home-card__share-panel');
                if (existing) {
                    existing.classList.remove('home-card__share-panel--open');
                    setTimeout(() => existing.remove(), 280);
                }
                else {
                    openSharePanel(card, act);
                }
            }
        });
    });
    // ── Wire photo click → lightbox ──────────────────────────────────────────
    const photoEl = card.querySelector('.home-card__photo[data-photosrc]');
    if (photoEl) {
        photoEl.addEventListener('click', (e) => {
            e.stopPropagation();
            const src = photoEl.dataset.photosrc;
            if (src)
                openLightbox(src);
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
function _relTimeNotif(ts) {
    const diff = Date.now() - ts;
    const mins = Math.floor(diff / 60000);
    if (mins < 1)
        return 'Just now';
    if (mins < 60)
        return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)
        return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days} day${days > 1 ? 's' : ''} ago`;
}
// Deep-link a tapped notification straight to its content.
async function _routeNotifTarget(t) {
    try {
        if (t.kind === 'activity') {
            const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
            // Own activity — already in IndexedDB
            const own = (await loadEnrichedActivities()).find(a => a.id === t.id);
            if (own) {
                void openActivityDetail(own, true, t.id);
                return;
            }
            // Friend activity — fetch from backend (needs author userId)
            if (t.userId && t.userId !== myUserId) {
                try {
                    const res = await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(t.id)}?userId=${encodeURIComponent(t.userId)}`);
                    const j = await res.json();
                    if (j.status === 'ok' && j.data) {
                        const act = { ...j.data, id: j.data.activityId ?? t.id };
                        void openActivityDetail(act, false, t.id);
                    }
                }
                catch { /* ignore */ }
            }
        }
        else if (t.kind === 'reel') {
            const hv = homeView;
            await hv._openReelsViewer(t.userId ?? t.id, 0);
        }
        else if (t.kind === 'live') {
            const fn = window.__openLive;
            fn?.(t.id, t.name ?? 'Live Tracking');
        }
        else if (t.kind === 'profile') {
            openPublicProfile(t.userId ?? t.id);
        }
    }
    catch { /* ignore routing errors */ }
}
// Parse an activity deep-link URL/hash: #activity=ID&u=AUTHOR
function _parseActivityDeepLink(url) {
    const m = url.match(/[#&?]activity=([^&]+)/);
    if (!m)
        return null;
    const u = url.match(/[#&?]u=([^&]+)/);
    return { id: decodeURIComponent(m[1]), userId: u ? decodeURIComponent(u[1]) : undefined };
}
// Push deep-links for activities: SW message (app open) + cold-start hash. Bound once.
if (typeof window !== 'undefined' && !window.__activityDeepLinkBound) {
    window.__activityDeepLinkBound = true;
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.addEventListener('message', e => {
            if (e.data?.type === 'OPEN_ACTIVITY') {
                const dl = _parseActivityDeepLink(e.data.url);
                if (dl)
                    void _routeNotifTarget({ kind: 'activity', id: dl.id, userId: dl.userId });
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
function _notifItemHtml(n) {
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
function _openNotifPanel() {
    document.getElementById('homeNotifPanel')?.remove();
    markAllRead();
    const notifs = getNotifications();
    const panel = document.createElement('div');
    panel.id = 'homeNotifPanel';
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
        panel.querySelector('#hnSheet')?.classList.add('hn-sheet--open');
        panel.querySelector('#hnOverlay')?.classList.add('hn-overlay--visible');
    });
    const close = () => {
        panel.querySelector('#hnSheet')?.classList.remove('hn-sheet--open');
        panel.querySelector('#hnOverlay')?.classList.remove('hn-overlay--visible');
        setTimeout(() => panel.remove(), 340);
    };
    panel.querySelector('#hnOverlay')?.addEventListener('click', close);
    document.addEventListener('keydown', e => { if (e.key === 'Escape')
        close(); }, { once: true });
    // Tap a notification → jump straight to its content (re-bound after each render)
    const bindItems = () => {
        panel.querySelectorAll('.hn-item').forEach(item => {
            item.addEventListener('click', () => {
                const n = getNotifications().find(x => x.id === item.dataset.id);
                if (!n?.target)
                    return;
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
        if (!listEl)
            return;
        const fresh = getNotifications();
        listEl.innerHTML = fresh.length === 0 ? _NOTIF_EMPTY_HTML : fresh.map(_notifItemHtml).join('');
        bindItems();
        markAllRead();
        void markAllReadRemote(uid);
    });
    panel.querySelector('#hnClear')?.addEventListener('click', () => {
        clearAll();
        panel.querySelector('#hnList').innerHTML =
            '<div class="hn-empty"><span>🔔</span><p>No notifications yet</p></div>';
    });
    // Swipe to close
    const sheet = panel.querySelector('#hnSheet');
    const handle = panel.querySelector('.hn-handle');
    let startY = 0;
    handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    handle.addEventListener('touchmove', e => {
        const d = e.touches[0].clientY - startY;
        if (d > 0) {
            sheet.style.transition = 'none';
            sheet.style.transform = `translateY(${d}px)`;
        }
    }, { passive: true });
    handle.addEventListener('touchend', e => {
        sheet.style.transition = '';
        if (e.changedTouches[0].clientY - startY > 100)
            close();
        else
            sheet.style.transform = '';
    });
}
export class HomeView {
    constructor() {
        Object.defineProperty(this, "container", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_inited", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_workouts", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "_feedCursor", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: Date.now()
        });
        Object.defineProperty(this, "_feedHasMore", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: true
        });
        Object.defineProperty(this, "_ptrInited", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_homeSection", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'home'
        });
        Object.defineProperty(this, "_switcherAutohideInited", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_exploreFeed", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_exploreOffset", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "_exploreHasMore", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_exploreLoading", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_geo", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_geoTried", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_lastHomeFeed", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "_repaintFeed", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_impObserver", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_impSeen", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "_impPending", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        });
        Object.defineProperty(this, "_impTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_impFlushBound", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_feedLoading", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_feedObserver", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        // ── Reels bar ──────────────────────────────────────────────────────────────
        Object.defineProperty(this, "_reelsFeed", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        // ── Reels Viewer ───────────────────────────────────────────────────────────
        Object.defineProperty(this, "_viewerTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_viewerInterval", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    init() {
        this.container = document.querySelector('#tabHome .home-scroll');
        if (!this.container)
            return;
        this._inited = true;
        // ── Block map-click passthrough at the tab container level ────────────────
        // Only stopPropagation on the *container* itself — NOT on children
        // (children handle their own events normally).
        const tabEl = document.getElementById('tabHome');
        if (tabEl) {
            // Use capture:false so buttons get the event first, then we stop it here
            tabEl.addEventListener('click', (e) => {
                if (tabEl.classList.contains('tab-panel--active')) {
                    e.stopPropagation();
                    // Do NOT preventDefault — that would break button clicks
                }
            }, false);
            // Also block touchend which Leaflet uses to synthesise map clicks
            // but only when the target IS the tabEl itself, not its children
            tabEl.addEventListener('touchend', (e) => {
                if (tabEl.classList.contains('tab-panel--active') && e.target === tabEl) {
                    e.stopPropagation();
                }
            }, { passive: true });
        }
        void this.render();
        this._mountFAB();
    }
    _mountFAB() {
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
        const btn = fab.querySelector('#homeFABBtn');
        const menu = fab.querySelector('#homeFABMenu');
        const toggleMenu = (open) => {
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
                id: String(Date.now()),
                sport: 'running',
                date: new Date().toISOString(),
                distanceKm: 0,
                durationSec: 0,
                paceMinKm: 0,
                speedKmH: 0,
                coords: [],
                description: '',
            };
            openSaveActivityModal(manualActivity, async (enriched) => {
                // Fire in-app notification
                notifyActivityAdded(enriched.name || enriched.description, enriched.distanceKm, enriched.sport);
                // Save to unifiedWorkouts so Stats → Progress sees it immediately
                await CS.saveUnifiedWorkout({
                    id: enriched.id,
                    type: enriched.sport,
                    source: 'manual',
                    date: new Date(enriched.date).toISOString(),
                    distanceKm: enriched.distanceKm,
                    durationSec: enriched.durationSec,
                    paceMinKm: enriched.paceMinKm,
                    speedKmH: enriched.speedKmH,
                    elevGain: 0,
                    coords: enriched.coords,
                    name: enriched.name,
                    description: enriched.description,
                    notes: enriched.notes,
                    intensity: enriched.intensity,
                    photoUrl: enriched.photoUrl,
                });
                // Push to Atlas first so the new activity is visible in feed immediately
                const { loadEnrichedActivities: _lea, loadUnifiedWorkouts: _luw, loadPosts: _lp } = await import('./db.js');
                const _userId = localStorage.getItem('mapyou_userId_profile') ?? '';
                const [_enriched, _unified, _posts] = await Promise.all([_lea(), _luw(), _lp()]);
                await pushNow(_userId, _enriched, _unified, _posts);
                // Refresh Home feed
                await this.render();
                // Refresh Stats (Progress + History)
                await statsView.render();
            }, undefined);
        });
        // Close menu on outside click
        document.addEventListener('click', (e) => {
            if (!fab.contains(e.target))
                toggleMenu(false);
        });
    }
    _buildGreeting(activityCount) {
        const greeting = document.createElement('div');
        greeting.className = 'home-greeting';
        const hour = new Date().getHours();
        const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
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
        if (!window.__notifSyncedOnce) {
            window.__notifSyncedOnce = true;
            const _nuid = localStorage.getItem('mapyou_userId_profile') ?? '';
            if (_nuid)
                void syncFromBackend(_nuid);
        }
        // Update badge when notifications change
        onNotificationsChange(count => {
            const bell = document.getElementById('homeNotifBell');
            if (!bell)
                return;
            const badge = bell.querySelector('.home-bell__badge');
            if (count > 0) {
                if (badge) {
                    badge.textContent = count > 9 ? '9+' : String(count);
                }
                else {
                    const b = document.createElement('span');
                    b.className = 'home-bell__badge';
                    b.textContent = count > 9 ? '9+' : String(count);
                    bell.appendChild(b);
                }
            }
            else {
                badge?.remove();
            }
        });
        return greeting;
    }
    _buildStreakWidget(activities) {
        const wrap = document.createElement('div');
        wrap.className = 'home-streak-carousel';
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayMs = today.getTime();
        const dow = (today.getDay() + 6) % 7; // 0 = Monday
        const monday = new Date(today);
        monday.setDate(today.getDate() - dow);
        monday.setHours(0, 0, 0, 0);
        // Active day keys (union of enriched activities + unified workouts) + per-day icon
        const dayKey = (ts) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); };
        const activeKeys = new Set();
        const dayMeta = new Map();
        for (const a of activities) {
            const k = dayKey(a.date);
            activeKeys.add(k);
            if (!dayMeta.has(k))
                dayMeta.set(k, { icon: getIcon(a.sport), color: getColor(a.sport) });
        }
        for (const w of this._workouts) {
            activeKeys.add(dayKey(typeof w.date === 'number' ? w.date : Date.parse(w.date)));
        }
        // Streak (consecutive days up to today)
        let streak = 0;
        for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            if (activeKeys.has(d.getTime()))
                streak++;
            else
                break;
        }
        updateBestStreak(streak);
        // Week day circles (Mon-first)
        const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const days = Array.from({ length: 7 }, (_, i) => {
            const d = new Date(monday);
            d.setDate(monday.getDate() + i);
            const k = d.getTime();
            const meta = dayMeta.get(k);
            return {
                label: DAY_LABELS[i], num: d.getDate(), key: k,
                active: activeKeys.has(k), isToday: k === todayMs, isFuture: k > todayMs,
                icon: meta?.icon ?? '', color: meta?.color ?? '',
            };
        });
        const dayCircle = (d) => {
            const cls = ['hday'];
            if (d.isToday)
                cls.push('hday--today');
            if (d.active)
                cls.push('hday--active');
            if (d.isFuture)
                cls.push('hday--future');
            const style = d.active && !d.isToday ? ` style="background:${d.color}"` : '';
            const inner = d.active ? `<span class="hday-ico">${d.icon}</span>` : `<span class="hday-num">${d.num}</span>`;
            return `<div class="hday-col">
        <span class="hday-label${d.isToday ? ' hday-label--today' : ''}">${d.label}</span>
        <div class="${cls.join(' ')}"${style} ${d.active ? `data-day="${d.key}" role="button"` : ''}>${inner}</div>
      </div>`;
        };
        // Weekly totals
        const weekStart = monday.getTime();
        const weekEnd = weekStart + 7 * 86400000;
        const weekActs = activities.filter(a => a.date >= weekStart && a.date < weekEnd);
        const weekCount = weekActs.length;
        const weekTime = weekActs.reduce((s, a) => s + a.durationSec, 0);
        const weekDist = weekActs.reduce((s, a) => s + a.distanceKm, 0);
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
        const track = wrap.querySelector('.hsc-track');
        const dots = wrap.querySelectorAll('.hsc-dot');
        track.addEventListener('scroll', () => {
            const idx = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
            dots.forEach((d, i) => d.classList.toggle('hsc-dot--active', i === idx));
        }, { passive: true });
        // Tap a day with activity → day details
        wrap.querySelectorAll('[data-day]').forEach(el => el.addEventListener('click', () => { void this._openDayDetails(Number(el.dataset.day)); }));
        // "See more" → month calendar
        wrap.querySelector('#hscMore')?.addEventListener('click', () => { void this._openStreakCalendar(); });
        return wrap;
    }
    // ── Day details (opened from a streak day circle) ───────────────────────────
    async _openDayDetails(dayMs) {
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
        ov.addEventListener('click', e => { if (e.target === ov)
            ov.remove(); });
        ov.querySelectorAll('.dd-item').forEach(el => el.addEventListener('click', () => {
            const a = acts.find(x => x.id === el.dataset.id);
            if (!a)
                return;
            ov.remove();
            void openActivityDetail(a, true, a.id);
        }));
    }
    // ── Activity calendar (opened from the streak panel) ────────────────────────
    async _openStreakCalendar() {
        document.getElementById('calOverlay')?.remove();
        const acts = await loadEnrichedActivities();
        const keyOf = (ts) => {
            const d = new Date(ts);
            return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
        };
        const byDay = new Map();
        for (const a of acts) {
            const k = keyOf(a.date);
            const arr = byDay.get(k);
            if (arr)
                arr.push(a);
            else
                byDay.set(k, [a]);
        }
        const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
        const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const curY = today.getFullYear(), curM = today.getMonth();
        let viewY = curY, viewM = curM;
        let selKey = keyOf(today.getTime());
        const ov = document.createElement('div');
        ov.id = 'calOverlay';
        ov.className = 'cal-overlay';
        document.body.appendChild(ov);
        const close = () => ov.remove();
        const renderDetail = () => {
            if (!selKey)
                return '<div class="cal-empty">Pick a day to see its activities.</div>';
            const list = byDay.get(selKey) ?? [];
            const [y, m, d] = selKey.split('-').map(Number);
            const dateLabel = `${d} ${MONTHS[m]} ${y}`;
            if (list.length === 0) {
                return `<div class="cal-detail__date">${dateLabel}</div><div class="cal-empty">No activities this day.</div>`;
            }
            const totKm = list.reduce((s, a) => s + (a.distanceKm || 0), 0);
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
        const render = () => {
            const first = new Date(viewY, viewM, 1);
            const lead = (first.getDay() + 6) % 7; // Monday-first offset
            const daysInMonth = new Date(viewY, viewM + 1, 0).getDate();
            const atCurrent = viewY === curY && viewM === curM;
            let cells = '';
            for (let i = 0; i < lead; i++)
                cells += '<div class="cal-cell cal-cell--empty"></div>';
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
                viewM--;
                if (viewM < 0) {
                    viewM = 11;
                    viewY--;
                }
                render();
            });
            ov.querySelector('#calNext')?.addEventListener('click', () => {
                if (atCurrent)
                    return;
                viewM++;
                if (viewM > 11) {
                    viewM = 0;
                    viewY++;
                }
                render();
            });
            ov.querySelectorAll('[data-day]').forEach(cell => {
                cell.addEventListener('click', () => {
                    selKey = `${viewY}-${viewM}-${cell.dataset.day}`;
                    render();
                });
            });
            ov.querySelectorAll('.cal-act').forEach(row => {
                row.addEventListener('click', () => {
                    const a = acts.find(x => x.id === row.dataset.actid);
                    if (a)
                        void openActivityDetail(a, true, a.id);
                });
            });
        };
        render();
    }
    async _buildReelsBar() {
        const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
        this._reelsFeed = await CS.fetchFeedReels();
        const myReels = this._reelsFeed.find(u => u.userId === myUserId);
        const others = this._reelsFeed.filter(u => u.userId !== myUserId);
        // Always show bar — user needs + button to add their first reel
        const bar = document.createElement('div');
        bar.className = 'home-reels-bar home-reels-bar--in-header';
        // My avatar with + button
        const profile = loadProfileFromLocal();
        const myAvatarHtml = profile.avatarB64
            ? `<img src="${profile.avatarB64}" class="home-reel-avatar__img" alt="avatar" style="width:100%;height:100%;object-fit:cover;border-radius:50%;border:2px solid #141417;"/>`
            : `<div class="home-reel-avatar__placeholder">${profile.name?.[0] ?? '?'}</div>`;
        const myHasReel = !!myReels;
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
    async _openWorkoutPicker(onPick) {
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
        const close = () => ov.remove();
        ov.querySelector('#rwpClose')?.addEventListener('click', close);
        ov.addEventListener('click', e => { if (e.target === ov)
            close(); });
        ov.querySelectorAll('.rwp-item').forEach(el => el.addEventListener('click', () => {
            const a = acts.find(x => x.id === el.dataset.id);
            if (!a)
                return;
            close();
            onPick(a);
        }));
    }
    async _openReelCreator() {
        const overlay = document.createElement('div');
        overlay.className = 'home-reel-creator';
        overlay.innerHTML = `
      <div class="home-reel-creator__header">
        <button class="home-reel-creator__close" id="reelCreatorClose">✕</button>
        <span class="home-reel-creator__title">New Reel</span>
        <div style="width:28px;"></div>
      </div>
      <div class="home-reel-creator__stage">
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
      </div>
      <!-- Right side tools — Instagram style, visible after file selected -->
      <div class="home-reel-creator__right-tools" id="reelCreatorTools" style="display:none">
        <button class="home-reel-creator__tool-btn" id="reelTextToggle" title="Add text">
          <span style="font-size:17px;font-weight:800;color:#fff;">Aa</span>
          <span class="home-reel-creator__tool-lbl">Text</span>
        </button>
        <button class="home-reel-creator__tool-btn" id="reelStickerPicker" title="Stickers">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" width="23" height="23"><path d="M15.5 3H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h7l8-8V6a3 3 0 0 0-3-3z"/><path d="M14 21v-4a3 3 0 0 1 3-3h4"/></svg>
          <span class="home-reel-creator__tool-lbl">Stickers</span>
        </button>
        <button class="home-reel-creator__tool-btn" id="reelDrawToggle" title="Draw">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" width="22" height="22"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>
          <span class="home-reel-creator__tool-lbl">Draw</span>
        </button>
        <button class="home-reel-creator__tool-btn" id="reelDownload" title="Save to device">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" width="22" height="22"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          <span class="home-reel-creator__tool-lbl">Save</span>
        </button>
      </div>
      <!-- Bottom bar — audience + share -->
      <div class="home-reel-creator__bottom">
        <div class="home-reel-creator__audience" id="reelAudience">
          <button class="rca-opt rca-opt--active" data-aud="everyone" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18"/></svg>
            Everyone
          </button>
          <button class="rca-opt" data-aud="friends" type="button">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="15" height="15"><path d="M16 11a4 4 0 1 0-4-4M3 21v-1a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v1M21 21v-1a5 5 0 0 0-3-4.5"/><circle cx="9" cy="7" r="4"/></svg>
            Friends
          </button>
        </div>
        <button class="home-reel-creator__share" id="reelCreatorShare" disabled>Share ➤</button>
      </div>`;
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('home-reel-creator--visible'));
        let selectedFile = null;
        let reelActivityId = null;
        let audience = 'everyone';
        let isVideoMedia = false;
        const stickers = [];
        let selectedSticker = null;
        const FONTS = [
            { lbl: 'Modern', css: '-apple-system, system-ui, sans-serif', weight: '700' },
            { lbl: 'Classic', css: "Georgia, 'Times New Roman', serif", weight: '700' },
            { lbl: 'Typewriter', css: "'Courier New', monospace", weight: '700' },
            { lbl: 'Strong', css: "'Trebuchet MS', 'Segoe UI', sans-serif", weight: '900' },
            { lbl: 'Script', css: "'Brush Script MT', 'Comic Sans MS', cursive", weight: '700' },
        ];
        const STYLES = ['none', 'highlight', 'neon'];
        const canvas = overlay.querySelector('#reelCreatorCanvas');
        const tools = overlay.querySelector('#reelCreatorTools');
        const shareBtn = overlay.querySelector('#reelCreatorShare');
        overlay.querySelector('#reelCreatorClose')?.addEventListener('click', () => {
            overlay.classList.remove('home-reel-creator--visible');
            setTimeout(() => overlay.remove(), 350);
        });
        // File input
        overlay.querySelector('#reelFileInput')?.addEventListener('change', (e) => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            const isVid = file.type.startsWith('video/');
            if (!isVid && file.size > 10 * 1024 * 1024) {
                alert('Max 10 MB for photos');
                return;
            }
            if (isVid && file.size > 500 * 1024 * 1024) {
                alert('Max 500 MB for videos');
                return;
            }
            selectedFile = file;
            reelActivityId = null;
            isVideoMedia = isVid;
            stickers.length = 0;
            selectedSticker = null;
            const url = URL.createObjectURL(file);
            canvas.innerHTML = isVid
                ? `<video src="${url}" class="home-reel-creator__preview" autoplay muted loop playsinline></video><div class="home-reel-creator__stickers" id="reelStickers"></div><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div><div class="home-reel-creator__guides" id="reelGuides"></div>`
                : `<img src="${url}" class="home-reel-creator__preview" alt="preview"/><div class="home-reel-creator__stickers" id="reelStickers"></div><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div><div class="home-reel-creator__guides" id="reelGuides"></div>`;
            stickers.length = 0;
            selectedSticker = null;
            renderStickers();
            drawCanvas = null;
            _spawnN = 0;
            tools.style.display = 'flex';
            shareBtn.disabled = false;
        });
        // Create from a workout → compose a clean 9:16 reel and link it to the activity
        overlay.querySelector('#reelFromWorkout')?.addEventListener('click', () => {
            void this._openWorkoutPicker(async (actv) => {
                canvas.innerHTML = '<div class="home-reel-creator__composing"><div class="home-loading__spinner"></div><span>Building your reel…</span></div>';
                const prof = loadProfileFromLocal();
                const blob = await composeActivityReel(actv, { authorName: prof.name || 'You', avatarUrl: prof.avatarB64 ?? null });
                if (!blob) {
                    alert('Could not build the reel — this workout has no route or stats.');
                    canvas.innerHTML = '';
                    return;
                }
                const file = new File([blob], 'reel.jpg', { type: 'image/jpeg' });
                selectedFile = file;
                reelActivityId = actv.id;
                isVideoMedia = false;
                stickers.length = 0;
                selectedSticker = null;
                const url = URL.createObjectURL(file);
                canvas.innerHTML = `<img src="${url}" class="home-reel-creator__preview" alt="reel"/><div class="home-reel-creator__stickers" id="reelStickers"></div><div class="home-reel-creator__caption-overlay" id="captionOverlay"></div><div class="home-reel-creator__guides" id="reelGuides"></div>`;
                drawCanvas = null;
                _spawnN = 0;
                renderStickers();
                tools.style.display = 'flex';
                shareBtn.disabled = false;
            });
        });
        // Shared text styling (render + bake). Plain style gets a soft shadow so
        // white / light text stays readable on any background.
        const _layerStyleCss = (style, colorIn) => {
            const color = colorIn || '#ffffff';
            if (style === 'highlight') {
                const dark = ['#ffffff', '#ffcc00', '#ffd60a', '#00c46a', '#5ac8fa', '#fef08a'].includes(color.toLowerCase());
                return `background:${color};color:${dark ? '#000' : '#fff'};padding:0.08em 0.32em;border-radius:0.16em;-webkit-box-decoration-break:clone;box-decoration-break:clone;`;
            }
            if (style === 'neon')
                return `color:#fff;text-shadow:0 0 4px ${color},0 0 12px ${color},0 0 22px ${color};`;
            return `color:${color};text-shadow:0 1px 3px rgba(0,0,0,0.34);`;
        };
        // Snap guides (shared by every draggable layer)
        const SNAP = 2.4;
        const X_TARGETS = [50, 33.333, 66.667]; // center + thirds
        const Y_TARGETS = [50, 33.333, 66.667];
        const renderGuides = (vx, hy) => {
            const g = overlay.querySelector('#reelGuides');
            if (!g)
                return;
            g.innerHTML =
                (vx !== null ? `<div class="rg-line rg-line--v" style="left:${vx}%"></div>` : '') +
                    (hy !== null ? `<div class="rg-line rg-line--h" style="top:${hy}%"></div>` : '');
        };
        const clearGuides = () => { const g = overlay.querySelector('#reelGuides'); if (g)
            g.innerHTML = ''; };
        window.addEventListener('pointerup', () => clearGuides());
        // ── Audience selector ──
        overlay.querySelector('#reelAudience')?.addEventListener('click', e => {
            const btn = e.target.closest('.rca-opt');
            if (!btn)
                return;
            audience = btn.dataset.aud ?? 'everyone';
            overlay.querySelectorAll('.rca-opt').forEach(b => b.classList.toggle('rca-opt--active', b === btn));
        });
        // ── Sticker layer engine ──
        const _dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
        const _angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
        const _esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const TEXT_BASE = 34; // px in preview space; transform scale resizes
        const stickerLabel = (s) => s.kind === 'emoji' ? s.text :
            s.kind === 'location' ? `📍 ${s.text}` :
                s.kind === 'time' ? `🕐 ${s.text}` :
                    s.kind === 'hashtag' ? `#${s.text}` : `@${s.text}`;
        const wireSticker = (el) => {
            const cont = el.parentElement;
            const id = el.dataset.id ?? '';
            const layer = () => stickers.find(s => s.id === id);
            const applyStyle = () => { const L = layer(); if (L) {
                el.style.left = `${L.x}%`;
                el.style.top = `${L.y}%`;
                el.style.transform = `translate(-50%,-50%) rotate(${L.rotation}deg) scale(${L.scale})`;
            } };
            el.querySelector('.rst-del')?.addEventListener('click', ev => {
                ev.stopPropagation();
                const i = stickers.findIndex(s => s.id === id);
                if (i >= 0)
                    stickers.splice(i, 1);
                selectedSticker = null;
                renderStickers();
            });
            const pts = new Map();
            let pinchBase = null;
            let moved = false;
            let downX = 0, downY = 0;
            el.addEventListener('pointerdown', ev => {
                if (ev.target.classList.contains('rst-del'))
                    return;
                ev.stopPropagation();
                ev.preventDefault();
                selectedSticker = id;
                cont?.querySelectorAll('.rst-layer').forEach(n => n.classList.toggle('rst-layer--sel', n === el));
                try {
                    el.setPointerCapture(ev.pointerId);
                }
                catch { /* ok */ }
                pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
                if (pts.size === 1) {
                    moved = false;
                    downX = ev.clientX;
                    downY = ev.clientY;
                }
                if (pts.size === 2) {
                    const a = [...pts.values()];
                    const L = layer();
                    pinchBase = { dist: _dist(a[0], a[1]), scale: L?.scale ?? 1, angle: _angle(a[0], a[1]), rot: L?.rotation ?? 0 };
                }
            });
            el.addEventListener('pointermove', ev => {
                if (!pts.has(ev.pointerId))
                    return;
                pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
                const L = layer();
                if (!L)
                    return;
                if (Math.hypot(ev.clientX - downX, ev.clientY - downY) > 6)
                    moved = true;
                if (pts.size >= 2 && pinchBase) {
                    const a = [...pts.values()];
                    L.scale = Math.max(0.4, Math.min(4, pinchBase.scale * (_dist(a[0], a[1]) / pinchBase.dist)));
                    L.rotation = pinchBase.rot + (_angle(a[0], a[1]) - pinchBase.angle);
                    applyStyle();
                    return;
                }
                const rect = canvas.getBoundingClientRect();
                let px = ((ev.clientX - rect.left) / rect.width) * 100;
                let py = ((ev.clientY - rect.top) / rect.height) * 100;
                let vG = null, hG = null;
                for (const t of X_TARGETS) {
                    if (Math.abs(px - t) < SNAP) {
                        px = t;
                        vG = t;
                        break;
                    }
                }
                for (const t of Y_TARGETS) {
                    if (Math.abs(py - t) < SNAP) {
                        py = t;
                        hG = t;
                        break;
                    }
                }
                px = Math.max(4, Math.min(96, px));
                py = Math.max(4, Math.min(96, py));
                L.x = px;
                L.y = py;
                applyStyle();
                renderGuides(vG, hG);
            });
            const end = (ev) => {
                pts.delete(ev.pointerId);
                if (pts.size < 2)
                    pinchBase = null;
                if (pts.size === 0) {
                    clearGuides();
                    const L = layer();
                    if (!moved && L && L.kind === 'text')
                        openTextEditor(L); // tap text → edit
                }
            };
            el.addEventListener('pointerup', end);
            el.addEventListener('pointercancel', end);
        };
        const renderStickers = () => {
            const cont = overlay.querySelector('#reelStickers');
            if (!cont)
                return;
            cont.innerHTML = stickers.map(s => {
                const sel = s.id === selectedSticker ? ' rst-layer--sel' : '';
                let inner;
                if (s.kind === 'text') {
                    const f = FONTS[s.fontIdx] ?? FONTS[0];
                    const styleCss = _layerStyleCss(STYLES[s.styleIdx] ?? 'none', s.color);
                    inner = `<span class="rst-text" style="font-size:${TEXT_BASE}px;font-family:${f.css.replace(/"/g, "'")};font-weight:${f.weight};text-align:${s.align};${styleCss}">${_esc(s.text).replace(/\n/g, '<br>')}</span>`;
                }
                else if (s.kind === 'emoji') {
                    inner = `<span class="rst-emoji">${s.text}</span>`;
                }
                else {
                    inner = `<span class="rst-pill">${stickerLabel(s)}</span>`;
                }
                return `<div class="rst-layer${sel}" data-id="${s.id}" style="left:${s.x}%;top:${s.y}%;transform:translate(-50%,-50%) rotate(${s.rotation}deg) scale(${s.scale})">${inner}<button class="rst-del" type="button">✕</button></div>`;
            }).join('');
            cont.querySelectorAll('.rst-layer').forEach(el => wireSticker(el));
        };
        let _spawnN = 0;
        const addSticker = (kind, text) => {
            const t = text.trim();
            if (!t)
                return;
            const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            const y = 30 + ((_spawnN++ % 4) * 10); // stagger so new layers don't cover existing ones
            stickers.push({ id, kind, text: t, x: 50, y, scale: 1, rotation: 0, color: '#ffffff', fontIdx: 0, styleIdx: 0, align: 'center' });
            selectedSticker = id;
            renderStickers();
        };
        // Tap empty canvas → deselect the active layer (hide outline + delete handle)
        canvas.addEventListener('pointerdown', e => {
            const t = e.target;
            if (t.closest('.rst-layer'))
                return;
            if (selectedSticker) {
                selectedSticker = null;
                renderStickers();
            }
        });
        // ── Sticker tray (IG-style bottom sheet) ──
        const EMOJIS = ['🔥', '💪', '🏃', '🚴', '🏆', '⚡', '❤️', '😤', '🎉', '👏', '🥇', '💦', '🌄', '🧗', '⛰️', '🏅', '😮‍💨', '🚀', '✨', '💯', '🦵', '🫶', '😎', '🥵'];
        overlay.querySelector('#reelStickerPicker')?.addEventListener('click', () => {
            if (!selectedFile)
                return;
            if (isVideoMedia) {
                adToast('Stickers work on photos & workout reels');
                return;
            }
            const tray = document.createElement('div');
            tray.className = 'rst-tray';
            tray.innerHTML = `
        <div class="rst-tray__sheet">
          <div class="rst-tray__bar"></div>
          <div class="rst-tray__row">
            <button class="rst-opt" data-act="location"><span class="rst-opt__ic" style="color:#7c3aed">📍</span>Location</button>
            <button class="rst-opt" data-act="time"><span class="rst-opt__ic">🕐</span>Time</button>
            <button class="rst-opt" data-act="hashtag"><span class="rst-opt__ic" style="color:#d946ef">#</span>Hashtag</button>
            <button class="rst-opt" data-act="mention"><span class="rst-opt__ic" style="color:#f97316">@</span>Mention</button>
          </div>
          <div class="rst-tray__title">Emoji</div>
          <div class="rst-tray__emoji">${EMOJIS.map(e => `<button class="rst-emoji-btn" data-emoji="${e}">${e}</button>`).join('')}</div>
          <p class="rst-tray__note">Music, GIF, cutouts, polls & avatars aren't available yet.</p>
        </div>`;
            document.body.appendChild(tray);
            const close = () => tray.remove();
            tray.addEventListener('click', ev => { if (ev.target === tray)
                close(); });
            tray.querySelectorAll('.rst-emoji-btn').forEach(b => b.addEventListener('click', () => { addSticker('emoji', b.dataset.emoji ?? '🔥'); close(); }));
            tray.querySelectorAll('.rst-opt').forEach(b => b.addEventListener('click', () => {
                const act = b.dataset.act;
                close();
                if (act === 'time') {
                    addSticker('time', new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }));
                    return;
                }
                const ph = act === 'location' ? 'Place name' : act === 'hashtag' ? 'hashtag' : 'username';
                const val = window.prompt(act === 'location' ? 'Location' : act === 'hashtag' ? 'Hashtag (without #)' : 'Mention (without @)', '') ?? '';
                if (val.trim())
                    addSticker(act, val.replace(/^[#@]/, '').trim() || ph);
            }));
        });
        // ── Flatten caption + stickers onto the media (photos & workout reels) ──
        const _imgFromFile = (f) => new Promise(res => {
            const i = new Image();
            const u = URL.createObjectURL(f);
            i.onload = () => res(i);
            i.onerror = () => res(null);
            i.src = u;
        });
        const _rr = (ctx, x, y, w, h, r) => {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + w, y, x + w, y + h, r);
            ctx.arcTo(x + w, y + h, x, y + h, r);
            ctx.arcTo(x, y + h, x, y, r);
            ctx.arcTo(x, y, x + w, y, r);
            ctx.closePath();
        };
        const bakeFlat = async () => {
            if (!selectedFile)
                return null;
            const W = 1080, H = 1920;
            const img = await _imgFromFile(selectedFile);
            if (!img)
                return null;
            const c = document.createElement('canvas');
            c.width = W;
            c.height = H;
            const ctx = c.getContext('2d');
            if (!ctx)
                return null;
            const sc = Math.max(W / img.width, H / img.height);
            const dw = img.width * sc, dh = img.height * sc;
            ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
            const pxScale = W / canvas.getBoundingClientRect().width;
            // brush drawing sits under text & stickers
            if (drawCanvas && drawCanvas.width > 0)
                ctx.drawImage(drawCanvas, 0, 0, W, H);
            // layers (text + stickers), honouring rotation & scale
            for (const s of stickers) {
                const x = s.x / 100 * W, y = s.y / 100 * H;
                ctx.save();
                ctx.translate(x, y);
                if (s.rotation)
                    ctx.rotate(s.rotation * Math.PI / 180);
                if (s.kind === 'emoji') {
                    const fs = 64 * pxScale * s.scale;
                    ctx.font = `${fs}px system-ui`;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(s.text, 0, 0);
                    ctx.restore();
                    continue;
                }
                if (s.kind === 'text') {
                    const f = FONTS[s.fontIdx] ?? FONTS[0];
                    const fs = TEXT_BASE * pxScale * s.scale;
                    ctx.font = `${f.weight} ${fs}px ${f.css}`;
                    ctx.textBaseline = 'middle';
                    const lines = s.text.split('\n');
                    const lh = fs * 1.18;
                    const st = STYLES[s.styleIdx] ?? 'none';
                    const col = s.color || '#ffffff';
                    const maxW = Math.max(...lines.map(l => ctx.measureText(l).width), 1);
                    const anchorX = s.align === 'left' ? -maxW / 2 : s.align === 'right' ? maxW / 2 : 0;
                    ctx.textAlign = s.align === 'left' ? 'left' : s.align === 'right' ? 'right' : 'center';
                    lines.forEach((ln, i) => {
                        const ly = (i - (lines.length - 1) / 2) * lh;
                        const w = ctx.measureText(ln).width;
                        const lineLeft = s.align === 'left' ? anchorX : s.align === 'right' ? anchorX - w : -w / 2;
                        if (st === 'highlight') {
                            const dark = ['#ffffff', '#ffcc00', '#ffd60a', '#00c46a', '#5ac8fa'].includes(col.toLowerCase());
                            const padX = fs * 0.3, padY = fs * 0.14;
                            _rr(ctx, lineLeft - padX, ly - fs / 2 - padY, w + padX * 2, fs + padY * 2, fs * 0.18);
                            ctx.fillStyle = col;
                            ctx.fill();
                            ctx.fillStyle = dark ? '#000' : '#fff';
                            ctx.fillText(ln, anchorX, ly);
                        }
                        else if (st === 'neon') {
                            ctx.save();
                            ctx.shadowColor = col;
                            ctx.shadowBlur = fs * 0.55;
                            ctx.fillStyle = '#fff';
                            ctx.fillText(ln, anchorX, ly);
                            ctx.fillText(ln, anchorX, ly);
                            ctx.restore();
                        }
                        else {
                            ctx.save();
                            ctx.shadowColor = 'rgba(0,0,0,0.34)';
                            ctx.shadowBlur = fs * 0.12;
                            ctx.shadowOffsetY = fs * 0.04;
                            ctx.fillStyle = col;
                            ctx.fillText(ln, anchorX, ly);
                            ctx.restore();
                        }
                    });
                    ctx.restore();
                    continue;
                }
                // pills (location / time / hashtag / mention)
                const label = stickerLabel(s);
                const fs = 30 * pxScale * s.scale;
                ctx.font = `700 ${fs}px system-ui`;
                ctx.textAlign = 'left';
                ctx.textBaseline = 'middle';
                const padX = fs * 0.55, padY = fs * 0.34;
                const w = ctx.measureText(label).width;
                const bw = w + padX * 2, bh = fs + padY * 2;
                ctx.save();
                ctx.shadowColor = 'rgba(0,0,0,0.18)';
                ctx.shadowBlur = 14 * pxScale;
                ctx.shadowOffsetY = 4 * pxScale;
                _rr(ctx, -bw / 2, -bh / 2, bw, bh, bh / 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();
                ctx.restore();
                ctx.fillStyle = '#16181c';
                ctx.fillText(label, -bw / 2 + padX, 0);
                ctx.restore();
            }
            const blob = await new Promise(r => c.toBlob(b => r(b), 'image/jpeg', 0.92));
            return blob ? new File([blob], 'reel.jpg', { type: 'image/jpeg' }) : null;
        };
        // ── Instagram-style text editor (tap "Aa" or tap a text layer) ──
        const PRESET_COLORS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffcc00', '#00c46a', '#00b8d4', '#007aff', '#af52de', '#ff2d55'];
        const addTextLayer = (t) => {
            const id = `s_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`;
            stickers.push({ id, kind: 'text', text: t.text, x: 50, y: 42, scale: t.scale, rotation: 0, color: t.color, fontIdx: t.fontIdx, styleIdx: t.styleIdx, align: t.align });
            selectedSticker = id;
            renderStickers();
        };
        const openTextEditor = (existing) => {
            const draft = existing
                ? { text: existing.text, color: existing.color, fontIdx: existing.fontIdx, styleIdx: existing.styleIdx, align: existing.align, scale: existing.scale }
                : { text: '', color: '#ffffff', fontIdx: 0, styleIdx: 0, align: 'center', scale: 1 };
            const ed = document.createElement('div');
            ed.className = 'rte-overlay';
            ed.innerHTML = `
        <div class="rte-top">
          <button class="rte-btn" id="rteCancel" type="button">Cancel</button>
          <div class="rte-top-tools">
            <button class="rte-icn" id="rteAlign" title="Align">≡</button>
            <button class="rte-icn" id="rteStyle" title="Style">A</button>
          </div>
          <button class="rte-btn rte-btn--done" id="rteDone" type="button">Done</button>
        </div>
        <div class="rte-stage"><input type="range" class="rte-size" id="rteSize" min="0.5" max="3" step="0.05" value="${draft.scale}"/><div class="rte-input" id="rteInput" contenteditable="true" role="textbox" aria-label="Text"></div></div>
        <div class="rte-fonts" id="rteFonts">${FONTS.map((f, i) => `<button class="rte-font${i === draft.fontIdx ? ' rte-font--on' : ''}" data-f="${i}" style="font-family:${f.css};font-weight:${f.weight}">${f.lbl}</button>`).join('')}</div>
        <div class="rte-palette" id="rtePalette">
          <div class="rte-hue" id="rteHue"></div>
          <div class="rte-presets">${PRESET_COLORS.map(c => `<button class="rte-swatch" data-c="${c}" style="background:${c}"></button>`).join('')}</div>
        </div>`;
            document.body.appendChild(ed);
            const input = ed.querySelector('#rteInput');
            input.innerText = draft.text;
            const applyPreview = () => {
                const f = FONTS[draft.fontIdx];
                input.style.fontFamily = f.css;
                input.style.fontWeight = f.weight;
                input.style.textAlign = draft.align;
                input.style.fontSize = `${Math.round(30 * draft.scale)}px`;
                const st = STYLES[draft.styleIdx];
                input.style.background = 'transparent';
                input.style.textShadow = '';
                input.style.padding = '0';
                if (st === 'highlight') {
                    const dark = ['#ffffff', '#ffcc00', '#ffd60a', '#00c46a', '#5ac8fa'].includes(draft.color.toLowerCase());
                    input.style.background = draft.color;
                    input.style.color = dark ? '#000' : '#fff';
                    input.style.padding = '2px 10px';
                    input.style.borderRadius = '8px';
                }
                else if (st === 'neon') {
                    input.style.color = '#fff';
                    input.style.textShadow = `0 0 4px ${draft.color},0 0 14px ${draft.color}`;
                }
                else {
                    input.style.color = draft.color;
                    input.style.textShadow = '0 1px 4px rgba(0,0,0,0.4)';
                }
                ed.querySelectorAll('.rte-font').forEach(b => b.classList.toggle('rte-font--on', Number(b.dataset.f) === draft.fontIdx));
            };
            applyPreview();
            setTimeout(() => { input.focus(); const r = document.createRange(); r.selectNodeContents(input); r.collapse(false); const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r); }, 60);
            ed.querySelectorAll('.rte-font').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); draft.fontIdx = Number(b.dataset.f); applyPreview(); }));
            ed.querySelectorAll('.rte-swatch').forEach(b => b.addEventListener('pointerdown', e => { e.preventDefault(); draft.color = b.dataset.c ?? '#ffffff'; applyPreview(); }));
            const sizeEl = ed.querySelector('#rteSize');
            sizeEl?.addEventListener('input', () => { draft.scale = Number(sizeEl.value); applyPreview(); });
            const hue = ed.querySelector('#rteHue');
            const pickHue = (clientX) => {
                const r = hue.getBoundingClientRect();
                const t = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
                draft.color = t < 0.05 ? '#ffffff' : t < 0.10 ? '#000000' : `hsl(${Math.round(((t - 0.10) / 0.90) * 360)}, 85%, 55%)`;
                applyPreview();
            };
            let hueDown = false;
            hue.addEventListener('pointerdown', e => { hueDown = true; pickHue(e.clientX); });
            hue.addEventListener('pointermove', e => { if (hueDown)
                pickHue(e.clientX); });
            window.addEventListener('pointerup', () => { hueDown = false; });
            ed.querySelector('#rteAlign')?.addEventListener('pointerdown', e => { e.preventDefault(); draft.align = draft.align === 'center' ? 'left' : draft.align === 'left' ? 'right' : 'center'; applyPreview(); });
            ed.querySelector('#rteStyle')?.addEventListener('pointerdown', e => { e.preventDefault(); draft.styleIdx = (draft.styleIdx + 1) % STYLES.length; applyPreview(); });
            ed.querySelector('#rteCancel')?.addEventListener('click', () => ed.remove());
            ed.querySelector('#rteDone')?.addEventListener('click', () => {
                const text = (input.innerText ?? '').trim();
                ed.remove();
                if (!text) {
                    if (existing) {
                        const i = stickers.findIndex(s => s.id === existing.id);
                        if (i >= 0)
                            stickers.splice(i, 1);
                        selectedSticker = null;
                        renderStickers();
                    }
                    return;
                }
                if (existing) {
                    existing.text = text;
                    existing.color = draft.color;
                    existing.fontIdx = draft.fontIdx;
                    existing.styleIdx = draft.styleIdx;
                    existing.align = draft.align;
                    existing.scale = draft.scale;
                    selectedSticker = existing.id;
                    renderStickers();
                }
                else
                    addTextLayer({ ...draft, text });
            });
        };
        overlay.querySelector('#reelTextToggle')?.addEventListener('click', () => { if (selectedFile)
            openTextEditor(); });
        // ── Draw (brush over the media, baked at share) ──
        let drawCanvas = null;
        let drawColor = '#ff3b30';
        let drawSize = 8;
        let drawNeon = false;
        const ensureDrawCanvas = () => {
            if (drawCanvas && drawCanvas.isConnected)
                return drawCanvas;
            const rect = canvas.getBoundingClientRect();
            drawCanvas = document.createElement('canvas');
            drawCanvas.className = 'home-reel-creator__draw';
            drawCanvas.width = Math.round(rect.width);
            drawCanvas.height = Math.round(rect.height);
            canvas.appendChild(drawCanvas);
            return drawCanvas;
        };
        overlay.querySelector('#reelDrawToggle')?.addEventListener('click', () => {
            if (!selectedFile)
                return;
            if (isVideoMedia) {
                adToast('Draw works on photos & workout reels');
                return;
            }
            const dc = ensureDrawCanvas();
            if (!dc)
                return;
            dc.classList.add('home-reel-creator__draw--active');
            const dctx = dc.getContext('2d');
            let drawing = false;
            const pos = (e) => { const r = dc.getBoundingClientRect(); return { x: (e.clientX - r.left) * (dc.width / r.width), y: (e.clientY - r.top) * (dc.height / r.height) }; };
            const down = (e) => { drawing = true; const p = pos(e); dctx.beginPath(); dctx.moveTo(p.x, p.y); dctx.lineCap = 'round'; dctx.lineJoin = 'round'; };
            const move = (e) => { if (!drawing)
                return; const p = pos(e); dctx.strokeStyle = drawColor; dctx.lineWidth = drawSize; dctx.shadowColor = drawNeon ? drawColor : 'transparent'; dctx.shadowBlur = drawNeon ? drawSize * 1.6 : 0; dctx.lineTo(p.x, p.y); dctx.stroke(); };
            const up = () => { drawing = false; };
            dc.addEventListener('pointerdown', down);
            dc.addEventListener('pointermove', move);
            window.addEventListener('pointerup', up);
            // draw toolbar
            const bar = document.createElement('div');
            bar.className = 'rdraw-bar';
            bar.innerHTML = `
        ${PRESET_COLORS.slice(0, 8).map(c => `<button class="rdraw-c" data-c="${c}" style="background:${c}"></button>`).join('')}
        <button class="rdraw-x" id="rdrawNeon" title="Neon">✨</button>
        <button class="rdraw-x" id="rdrawErase" title="Erase">⌫</button>
        <button class="rdraw-done" id="rdrawDone">Done</button>`;
            overlay.appendChild(bar);
            bar.querySelectorAll('.rdraw-c').forEach(b => b.addEventListener('click', () => { drawColor = b.dataset.c ?? '#ff3b30'; drawNeon = false; bar.querySelector('#rdrawNeon')?.classList.remove('rdraw-x--on'); }));
            bar.querySelector('#rdrawNeon')?.addEventListener('click', () => { drawNeon = !drawNeon; bar.querySelector('#rdrawNeon')?.classList.toggle('rdraw-x--on', drawNeon); });
            bar.querySelector('#rdrawErase')?.addEventListener('click', () => dctx.clearRect(0, 0, dc.width, dc.height));
            bar.querySelector('#rdrawDone')?.addEventListener('click', () => {
                dc.classList.remove('home-reel-creator__draw--active');
                dc.removeEventListener('pointerdown', down);
                dc.removeEventListener('pointermove', move);
                window.removeEventListener('pointerup', up);
                bar.remove();
            });
        });
        // ── Save to device (flatten and download) ──
        overlay.querySelector('#reelDownload')?.addEventListener('click', async () => {
            if (!selectedFile)
                return;
            if (isVideoMedia) {
                adToast('Saving works on photos & workout reels');
                return;
            }
            const baked = await bakeFlat();
            const out = baked ?? selectedFile;
            const a = document.createElement('a');
            a.href = URL.createObjectURL(out);
            a.download = 'mapyou-reel.jpg';
            document.body.appendChild(a);
            a.click();
            a.remove();
            adToast('Saved to your device');
        });
        shareBtn.addEventListener('click', async () => {
            if (!selectedFile)
                return;
            shareBtn.disabled = true;
            shareBtn.textContent = 'Uploading…';
            const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
            // Photos & workout reels: flatten every layer (text, stickers, drawing) into the image.
            // Video can't be baked in-browser → keep the first text layer as a metadata overlay.
            let fileToUpload = selectedFile;
            let captionMeta = null;
            let cMeta = { x: 50, y: 80, size: 20, color: '#ffffff', font: FONTS[0].css, weight: FONTS[0].weight, style: 'none' };
            const hasOverlays = stickers.length > 0 || (!!drawCanvas && drawCanvas.width > 0);
            if (!isVideoMedia && hasOverlays) {
                const baked = await bakeFlat();
                if (baked)
                    fileToUpload = baked;
            }
            else if (isVideoMedia) {
                const tl = stickers.find(s => s.kind === 'text');
                if (tl) {
                    captionMeta = tl.text;
                    cMeta = { x: tl.x, y: tl.y, size: Math.round(34 * tl.scale), color: tl.color, font: FONTS[tl.fontIdx].css, weight: FONTS[tl.fontIdx].weight, style: STYLES[tl.styleIdx] };
                }
                if (stickers.some(s => s.kind !== 'text'))
                    adToast('Stickers aren\u2019t saved on videos yet');
            }
            const reel = await uploadReel(fileToUpload, myUserId, {
                caption: captionMeta,
                captionX: cMeta.x,
                captionY: cMeta.y,
                captionSize: cMeta.size,
                captionColor: cMeta.color,
                captionFont: cMeta.font,
                captionWeight: cMeta.weight,
                captionStyle: cMeta.style,
                activityId: reelActivityId,
                audience,
            });
            if (reel) {
                overlay.classList.remove('home-reel-creator--visible');
                setTimeout(() => overlay.remove(), 350);
                await this.render();
            }
            else {
                shareBtn.disabled = false;
                shareBtn.textContent = 'Share';
                alert('Upload failed, please try again');
            }
        });
    }
    async _openReelsViewer(startUserId, startIndex) {
        const myUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
        const allGroups = this._reelsFeed;
        let groupIdx = allGroups.findIndex(u => u.userId === startUserId);
        if (groupIdx < 0)
            groupIdx = 0;
        let reelIdx = startIndex;
        const overlay = document.createElement('div');
        overlay.className = 'home-reel-viewer';
        overlay.addEventListener('contextmenu', e => e.preventDefault());
        document.body.appendChild(overlay);
        requestAnimationFrame(() => overlay.classList.add('home-reel-viewer--visible'));
        const renderViewer = () => {
            if (groupIdx >= allGroups.length) {
                closeViewer();
                return;
            }
            const group = allGroups[groupIdx];
            if (reelIdx >= group.reels.length) {
                groupIdx++;
                reelIdx = 0;
                renderViewer();
                return;
            }
            const reel = group.reels[reelIdx];
            const totalReels = group.reels.length;
            // Mark as viewed
            void CS.markReelViewed(reel.id);
            const likedLocal = getLikedReels();
            const serverLiked = reel.likes.includes(myUserId);
            const isLiked = serverLiked || likedLocal.has(reel.id);
            const likeCount = reel.likes.length + (isLiked && !serverLiked ? 1 : 0);
            const isVideo = reel.mediaType === 'video';
            const dur = isVideo ? reel.duration : (reel.duration || 5);
            overlay.innerHTML = `
        <div class="home-reel-viewer__bg">
          ${isVideo
                ? `<video class="home-reel-viewer__media" src="${reel.mediaUrl}" autoplay muted playsinline id="reelViewerVideo" oncontextmenu="return false"></video>`
                : `<img class="home-reel-viewer__media" src="${reel.mediaUrl}" alt="reel" oncontextmenu="return false" draggable="false"/>`}
          ${reel.caption ? `<span class="home-reel-viewer__caption" style="${(() => {
                const ff = reel.captionFont ? `font-family:${reel.captionFont};` : '';
                const fw = `font-weight:${reel.captionWeight ?? '700'};`;
                const base = `left:${reel.captionX}%;top:${reel.captionY}%;font-size:${reel.captionSize}px;${ff}${fw}`;
                const st = reel.captionStyle ?? 'none';
                if (st === 'highlight') {
                    const dark = ['#ffffff', '#ffcc00', '#ffd60a', '#00c46a', '#5ac8fa'].includes((reel.captionColor || '').toLowerCase());
                    return `${base}background:${reel.captionColor};color:${dark ? '#000' : '#fff'};padding:0.08em 0.28em;border-radius:0.18em;-webkit-box-decoration-break:clone;box-decoration-break:clone;`;
                }
                if (st === 'neon') {
                    return `${base}color:#fff;text-shadow:0 0 4px ${reel.captionColor},0 0 12px ${reel.captionColor},0 0 22px ${reel.captionColor};`;
                }
                return `${base}color:${reel.captionColor};`;
            })()}">${reel.caption}</span>` : ''}
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
            <span class="home-reel-viewer__time">${(() => { const s = Math.floor((Date.now() - reel.createdAt) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.floor(s / 60) + 'm ago' : Math.floor(s / 3600) + 'h ago'; })()}</span>
          </div>
          <button class="home-reel-viewer__close" id="reelViewerClose">✕</button>
        </div>
        <div class="home-reel-viewer__actions">
          <button class="home-reel-viewer__like ${isLiked ? 'liked' : ''}" id="reelViewerLike">
            <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="24" height="24"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>
            <span id="reelLikeCount">${likeCount}</span>
          </button>
          ${group.userId === myUserId ? `<button class="home-reel-viewer__delete" id="reelViewerDelete">🗑</button>` : ''}
        </div>
        <div class="home-reel-viewer__tap-left" id="reelTapLeft"></div>
        <div class="home-reel-viewer__tap-right" id="reelTapRight"></div>`;
            // Progress bar animation
            if (this._viewerTimer)
                clearTimeout(this._viewerTimer);
            if (this._viewerInterval)
                clearInterval(this._viewerInterval);
            const bar = overlay.querySelector(`#reelBar${reelIdx}`);
            let elapsed = 0;
            const step = 50;
            const videEl = overlay.querySelector('#reelViewerVideo');
            const getDur = () => isVideo && videEl ? (videEl.duration || dur) : dur;
            let paused = false;
            overlay.querySelector('.home-reel-viewer__bg')?.addEventListener('touchstart', () => { paused = true; videEl?.pause(); }, { passive: true });
            overlay.querySelector('.home-reel-viewer__bg')?.addEventListener('touchend', () => { paused = false; videEl?.play().catch(() => { }); });
            // Pinch-to-zoom the media; springs back on release. Listeners live on the
            // overlay because the tap-nav layers sit above the media and eat its events.
            const mediaEl = overlay.querySelector('.home-reel-viewer__media');
            if (mediaEl) {
                overlay.style.touchAction = 'none';
                const zp = new Map();
                let zbase = null;
                const zd = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
                overlay.addEventListener('pointerdown', e => {
                    zp.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    if (zp.size === 2) {
                        const a = [...zp.values()];
                        zbase = { dist: zd(a[0], a[1]), cx: (a[0].x + a[1].x) / 2, cy: (a[0].y + a[1].y) / 2 };
                        mediaEl.style.transition = 'none';
                        paused = true;
                        videEl?.pause();
                    }
                });
                overlay.addEventListener('pointermove', e => {
                    if (!zp.has(e.pointerId))
                        return;
                    zp.set(e.pointerId, { x: e.clientX, y: e.clientY });
                    if (zp.size >= 2 && zbase) {
                        const a = [...zp.values()];
                        const scale = Math.max(1, Math.min(4, zd(a[0], a[1]) / zbase.dist));
                        const cx = (a[0].x + a[1].x) / 2, cy = (a[0].y + a[1].y) / 2;
                        mediaEl.style.transform = `translate(${cx - zbase.cx}px, ${cy - zbase.cy}px) scale(${scale})`;
                        e.preventDefault();
                    }
                });
                const zreset = (e) => {
                    zp.delete(e.pointerId);
                    if (zp.size < 2 && zbase) {
                        zbase = null;
                        mediaEl.style.transition = 'transform 0.25s ease';
                        mediaEl.style.transform = '';
                        paused = false;
                        videEl?.play().catch(() => { });
                    }
                };
                overlay.addEventListener('pointerup', zreset);
                overlay.addEventListener('pointercancel', zreset);
            }
            this._viewerInterval = setInterval(() => {
                if (paused)
                    return;
                elapsed += step;
                const pct = Math.min((elapsed / (getDur() * 1000)) * 100, 100);
                if (bar)
                    bar.style.setProperty('--p', `${pct}%`);
                if (pct >= 100) {
                    clearInterval(this._viewerInterval);
                    reelIdx++;
                    renderViewer();
                }
            }, step);
            // Close
            overlay.querySelector('#reelViewerClose')?.addEventListener('click', closeViewer);
            // View activity — deep-link from an activity reel into its details
            overlay.querySelector('#reelViewerActivity')?.addEventListener('click', async (e) => {
                e.stopPropagation();
                const aid = reel.activityId;
                if (!aid)
                    return;
                closeViewer();
                let act = (await loadEnrichedActivities()).find(a => a.id === aid) ?? null;
                if (!act) {
                    try {
                        const res = await fetch(`${BACKEND_URL}/enriched-activities/${encodeURIComponent(aid)}?userId=${encodeURIComponent(group.userId)}`, { cache: 'no-store' });
                        if (res.ok) {
                            const d = await res.json();
                            act = (d.data ?? d);
                        }
                    }
                    catch { /* ignore */ }
                }
                if (act)
                    void openActivityDetail(act, group.userId === myUserId, aid);
            });
            // Author click — pause reel and open profile
            overlay.querySelector('#reelViewerAuthor')?.addEventListener('click', () => {
                // Pause timer
                if (this._viewerInterval) {
                    clearInterval(this._viewerInterval);
                    this._viewerInterval = null;
                }
                const vid = overlay.querySelector('#reelViewerVideo');
                vid?.pause();
                // Lower viewer z-index so profile appears on top
                overlay.style.zIndex = '4999';
                // Open profile
                if (group.userId === myUserId) {
                    void profileView.open();
                }
                else {
                    openPublicProfile(group.userId);
                }
                // Resume when profile closes — poll for overlay removal
                const resumeWatcher = setInterval(() => {
                    const profileOpen = document.querySelector('.pv-overlay--visible');
                    if (!profileOpen) {
                        clearInterval(resumeWatcher);
                        overlay.style.zIndex = '9100'; // restore viewer on top
                        vid?.play().catch(() => { });
                        // Restart interval from current position
                        let elapsed = 0;
                        const step = 50;
                        const barEl = overlay.querySelector(`#reelBar${reelIdx}`);
                        const getDur = () => reel.mediaType === 'video' && vid ? (vid.duration || reel.duration) : (reel.duration || 5);
                        this._viewerInterval = setInterval(() => {
                            elapsed += step;
                            const pct = Math.min((elapsed / (getDur() * 1000)) * 100, 100);
                            if (barEl)
                                barEl.style.setProperty('--p', `${pct}%`);
                            if (pct >= 100) {
                                clearInterval(this._viewerInterval);
                                reelIdx++;
                                renderViewer();
                            }
                        }, step);
                    }
                }, 300);
            });
            // Like
            overlay.querySelector('#reelViewerLike')?.addEventListener('click', async () => {
                const btn = overlay.querySelector('#reelViewerLike');
                const countEl = overlay.querySelector('#reelLikeCount');
                const svg = btn?.querySelector('svg');
                // Optimistic: flip instantly and persist locally so it survives re-entry
                const nowLiked = !btn?.classList.contains('liked');
                btn?.classList.toggle('liked', nowLiked);
                svg?.setAttribute('fill', nowLiked ? 'currentColor' : 'none');
                if (countEl)
                    countEl.textContent = String(Math.max(0, parseInt(countEl.textContent ?? '0', 10) + (nowLiked ? 1 : -1)));
                setReelLiked(reel.id, nowLiked);
                // Reconcile with the server
                const result = await CS.likeReel(reel.id);
                if (result) {
                    btn?.classList.toggle('liked', result.liked);
                    svg?.setAttribute('fill', result.liked ? 'currentColor' : 'none');
                    if (countEl)
                        countEl.textContent = String(result.count);
                    setReelLiked(reel.id, result.liked);
                    if (result.liked && !reel.likes.includes(myUserId))
                        reel.likes.push(myUserId);
                    else if (!result.liked)
                        reel.likes = reel.likes.filter(u => u !== myUserId);
                }
            });
            // Delete (own reel)
            overlay.querySelector('#reelViewerDelete')?.addEventListener('click', async () => {
                if (!confirm('Delete this reel?'))
                    return;
                await CS.deleteReel(reel.id);
                closeViewer();
                await this.render();
            });
            // Tap navigation
            overlay.querySelector('#reelTapLeft')?.addEventListener('click', () => {
                if (reelIdx > 0) {
                    reelIdx--;
                }
                else if (groupIdx > 0) {
                    groupIdx--;
                    reelIdx = allGroups[groupIdx].reels.length - 1;
                }
                renderViewer();
            });
            overlay.querySelector('#reelTapRight')?.addEventListener('click', () => {
                reelIdx++;
                renderViewer();
            });
        };
        const closeViewer = () => {
            if (this._viewerTimer)
                clearTimeout(this._viewerTimer);
            if (this._viewerInterval)
                clearInterval(this._viewerInterval);
            overlay.classList.remove('home-reel-viewer--visible');
            setTimeout(() => overlay.remove(), 300);
        };
        renderViewer();
    }
    async render() {
        this.container = document.querySelector('#tabHome .home-scroll');
        if (!this.container)
            return;
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
            if (!slot)
                return;
            if (bar)
                slot.replaceWith(bar);
            else
                slot.remove();
        }).catch(() => { });
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
        const localFeed = [
            ...activities.map(a => ({ kind: 'activity', date: a.date, data: a, isLocal: true })),
            ...posts.map(p => ({ kind: 'post', date: p.date, data: p, isLocal: true })),
        ].sort((a, b) => b.date - a.date);
        const paintFeed = (feed) => {
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
                let card;
                if (isOwn && item.kind === 'activity') {
                    const localAct = activities.find(a => a.id === (item.data.activityId ?? item.data.id));
                    if (localAct) {
                        // Save coordsEnc BEFORE mutating coords
                        const enc = item.data.coordsEnc ??
                            (localAct.coords && localAct.coords.length > 0
                                ? encodePolyline(localAct.coords)
                                : null);
                        item.data._coordsEncResolved = enc;
                        localAct.coordsEnc = enc;
                        localAct.coords = [];
                        localAct.views = item.data._viewCount ?? 0;
                    }
                    card = localAct ? buildCard(localAct) : this._buildFriendFeedCard(item.kind, item.data, userId);
                }
                else if (isOwn && item.kind === 'post') {
                    const localPost = posts.find(p => p.id === (item.data.postId ?? item.data.id));
                    card = localPost
                        ? buildPostCard(localPost, () => this.render())
                        : this._buildFriendFeedCard(item.kind, item.data, userId);
                }
                else {
                    card = this._buildFriendFeedCard(item.kind, item.data, userId);
                }
                // Set like/comment counts from feed response
                const itemId = (item.data.activityId ?? item.data.postId ?? item.data.id);
                const lc = (item.data._likeCount ?? 0);
                const cc = (item.data._commentCount ?? 0);
                if (lc > 0) {
                    const likeEl = card.querySelector(`[data-like-count="${itemId}"], [data-like-count="p_${itemId}"]`);
                    if (likeEl)
                        likeEl.textContent = String(lc);
                }
                if (cc > 0) {
                    const commentEl = card.querySelector(`[data-comment-count="${itemId}"]`);
                    if (commentEl)
                        commentEl.textContent = String(cc);
                }
                card.style.animationDelay = `${idx * 60}ms`;
                if (item.kind === 'activity') {
                    card.style.cursor = 'pointer';
                    card.addEventListener('click', e => {
                        if (e.target.closest('button, a, video, input, [data-action], [data-pm], .home-card__photo, .home-card__avatar--user, .home-card__comment-panel, .hcs'))
                            return;
                        void openActivityDetail(item.data, isOwn, (item.data.activityId ?? item.data.id));
                    });
                }
                feedList.appendChild(card);
                if (item.kind === 'activity')
                    this._observeImpression(card, (item.data.activityId ?? item.data.id));
                const actId = (item.data.activityId ?? item.data.id);
                if (item.kind === 'activity') {
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            const coordsEnc = (item.data._coordsEncResolved ?? item.data.coordsEnc ?? null);
                            const localAct = activities.find(a => a.id === actId);
                            const enc = coordsEnc ?? null;
                            if (enc) {
                                const mapEl = card.querySelector('.home-card__map-wrap--canvas, .home-card__map-wrap');
                                if (mapEl) {
                                    mapEl.style.display = 'block';
                                    const coords = decodePolyline(enc);
                                    renderMinimapCanvas(mapEl, coords, (item.data.sport ?? localAct?.sport ?? 'running'));
                                }
                            }
                        }, 80 + idx * 30);
                    });
                }
            });
            const friendsFeedEl = document.getElementById('friendsFeed');
            if (friendsFeedEl)
                friendsFeedEl.innerHTML = '';
            // Batch load liked state
            if (userId && feed.length > 0) {
                const itemIds = feed.map(f => (f.data.activityId ?? f.data.postId ?? f.data.id)).filter(Boolean);
                void fetch(`${BACKEND_URL}/feed/likes/batch?userId=${encodeURIComponent(userId)}&items=${encodeURIComponent(itemIds.join(','))}`, { cache: 'no-store' })
                    .then(r => r.json())
                    .then((resp) => {
                    if (resp.status !== 'ok')
                        return;
                    for (const [id, info] of Object.entries(resp.data)) {
                        if (!info.liked)
                            continue;
                        const btn = feedList.querySelector(`[data-like-count="${id}"]`)?.closest('.home-card__action');
                        if (btn)
                            btn.classList.add('home-card__action--liked');
                        const btnP = feedList.querySelector(`[data-like-count="p_${id}"]`)?.closest('.home-card__action');
                        if (btnP)
                            btnP.classList.add('home-card__action--liked');
                    }
                }).catch(() => { });
            }
            // Infinite scroll
            this._setupInfiniteScroll(feedList, activities, posts, userId);
        };
        this._repaintFeed = paintFeed;
        // 1) Instant paint — cached server feed (incl. friends) if present, else local-only
        const cached = this._readFeedCache(userId);
        if (cached) {
            this._feedHasMore = cached.hasMore;
            if (cached.feed.length > 0)
                this._feedCursor = cached.feed[cached.feed.length - 1].date;
        }
        const initialFeed = (cached && cached.feed.length > 0) ? cached.feed : localFeed;
        this._lastHomeFeed = initialFeed;
        paintFeed(initialFeed);
        const shownSig = this._feedSig(initialFeed);
        // 2) Revalidate from server in the background (timeout-guarded), repaint only if changed
        if (userId) {
            void this._fetchServerFeed(userId).then(result => {
                if (!result)
                    return; // offline / timeout: keep what's shown
                this._writeFeedCache(userId, result.feed, result.hasMore);
                this._feedHasMore = result.hasMore;
                if (result.feed.length > 0)
                    this._feedCursor = result.feed[result.feed.length - 1].date;
                this._lastHomeFeed = result.feed;
                if (!document.body.contains(feedList))
                    return; // user navigated away
                if (this._homeSection !== 'home')
                    return; // don't clobber the Explore view
                if (this._feedSig(result.feed) !== shownSig)
                    paintFeed(result.feed);
            }).catch(() => { });
        }
    }
    // ── Section switcher: Home / Explore (style 3 — texts + dot) ────────────────
    _buildSectionSwitcher() {
        const sw = document.createElement('div');
        sw.id = 'homeSwitcher';
        sw.className = 'home-switcher';
        sw.innerHTML = `
      <button class="home-switcher__tab${this._homeSection === 'home' ? ' home-switcher__tab--active' : ''}" data-sec="home">Home</button>
      <button class="home-switcher__tab${this._homeSection === 'explore' ? ' home-switcher__tab--active' : ''}" data-sec="explore">Explore</button>
      <span class="home-switcher__dot"></span>`;
        sw.querySelectorAll('.home-switcher__tab').forEach(t => t.addEventListener('click', () => {
            this.container?.scrollTo({ top: 0, behavior: 'smooth' });
            this._setSection(t.dataset.sec === 'explore' ? 'explore' : 'home');
        }));
        requestAnimationFrame(() => this._positionSwitcherDot());
        return sw;
    }
    _positionSwitcherDot() {
        const sw = document.getElementById('homeSwitcher');
        if (!sw)
            return;
        const active = sw.querySelector('.home-switcher__tab--active');
        const dot = sw.querySelector('.home-switcher__dot');
        if (!active || !dot)
            return;
        dot.style.transition = ''; // restore CSS transition (drag sets it to none)
        dot.style.left = `${active.offsetLeft + active.offsetWidth / 2}px`;
    }
    _setSection(sec, fromSwipe = false) {
        if (this._homeSection === sec && !fromSwipe)
            return;
        const dir = sec === 'explore' ? -1 : 1;
        this._homeSection = sec;
        const sw = document.getElementById('homeSwitcher');
        sw?.querySelectorAll('.home-switcher__tab').forEach(t => t.classList.toggle('home-switcher__tab--active', t.dataset.sec === sec));
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
            if (this._exploreFeed)
                this._repaintFeed?.(this._exploreFeed); // instant from memory
            else {
                this._paintFeedLoading();
                void this._loadExplore();
            }
        }
        else {
            this._repaintFeed?.(this._lastHomeFeed);
        }
    }
    _commitSwipe(sec) {
        const fl = document.getElementById('homeFeedList');
        if (!fl) {
            this._setSection(sec, true);
            return;
        }
        const w = fl.clientWidth || window.innerWidth;
        const out = sec === 'explore' ? -w : w;
        const sw = document.getElementById('homeSwitcher');
        sw?.querySelectorAll('.home-switcher__tab').forEach(t => t.classList.toggle('home-switcher__tab--active', t.dataset.sec === sec));
        this._positionSwitcherDot();
        fl.style.transition = 'transform .16s ease, opacity .16s ease';
        fl.style.transform = `translateX(${out}px)`;
        fl.style.opacity = '0';
        setTimeout(() => {
            this._setSection(sec, true); // repaint, no built-in slide
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
    _dragDot(p) {
        const sw = document.getElementById('homeSwitcher');
        if (!sw)
            return;
        const tabs = sw.querySelectorAll('.home-switcher__tab');
        const dot = sw.querySelector('.home-switcher__dot');
        if (tabs.length < 2 || !dot)
            return;
        const homeC = tabs[0].offsetLeft + tabs[0].offsetWidth / 2;
        const explC = tabs[1].offsetLeft + tabs[1].offsetWidth / 2;
        const cl = Math.max(0, Math.min(1, p));
        dot.style.transition = 'none';
        dot.style.left = `${homeC + (explC - homeC) * cl}px`;
    }
    _paintFeedLoading() {
        const fl = document.getElementById('homeFeedList');
        if (fl)
            fl.innerHTML = '<div class="home-loading"><div class="home-loading__spinner"></div></div>';
    }
    async _getGeo() {
        if (this._geo)
            return this._geo;
        if (this._geoTried)
            return null;
        this._geoTried = true;
        if (!('geolocation' in navigator))
            return null;
        return new Promise(resolve => {
            let done = false;
            const finish = (v) => { if (!done) {
                done = true;
                this._geo = v;
                resolve(v);
            } };
            const t = setTimeout(() => finish(null), 6000);
            navigator.geolocation.getCurrentPosition(pos => { clearTimeout(t); finish({ lat: pos.coords.latitude, lng: pos.coords.longitude }); }, () => { clearTimeout(t); finish(null); }, { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 });
        });
    }
    async _loadExplore() {
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        if (!userId)
            return;
        const geo = await this._getGeo();
        const geoQ = geo ? `&lat=${geo.lat}&lng=${geo.lng}` : '';
        try {
            const res = await fetch(`${BACKEND_URL}/feed/explore?userId=${encodeURIComponent(userId)}${geoQ}&offset=0`, { cache: 'no-store' });
            const d = await res.json();
            this._exploreFeed = d.data ?? [];
            this._exploreOffset = this._exploreFeed.length;
            this._exploreHasMore = d.hasMore ?? false;
            if (this._homeSection === 'explore')
                this._repaintFeed?.(this._exploreFeed);
        }
        catch {
            if (this._homeSection === 'explore') {
                const fl = document.getElementById('homeFeedList');
                if (fl)
                    fl.innerHTML = `
          <div class="home-empty">
            <div class="home-empty__icon">🌐</div>
            <h3 class="home-empty__title">Couldn't load Explore</h3>
            <p class="home-empty__sub">Check your connection and try again</p>
          </div>`;
            }
        }
    }
    // ── Impression tracking (X-style reach) ─────────────────────────────────────
    _observeImpression(card, id) {
        if (!id || this._impSeen.has(id))
            return;
        if (!this._impObserver) {
            this._impObserver = new IntersectionObserver(entries => {
                for (const e of entries) {
                    if (!e.isIntersecting || e.intersectionRatio < 0.5)
                        continue;
                    const eid = e.target.dataset.impId;
                    this._impObserver?.unobserve(e.target);
                    if (eid && !this._impSeen.has(eid)) {
                        this._impSeen.add(eid);
                        this._impPending.add(eid);
                        this._scheduleImpFlush();
                    }
                }
            }, { threshold: [0.5] });
        }
        if (!this._impFlushBound) {
            this._impFlushBound = true;
            const flush = () => { void this._flushImpressions(); };
            document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden')
                flush(); });
            window.addEventListener('pagehide', flush);
        }
        card.dataset.impId = id;
        this._impObserver.observe(card);
    }
    _scheduleImpFlush() {
        if (this._impTimer)
            return;
        this._impTimer = window.setTimeout(() => { this._impTimer = undefined; void this._flushImpressions(); }, 4000);
    }
    async _flushImpressions() {
        if (this._impPending.size === 0)
            return;
        const ids = [...this._impPending];
        this._impPending.clear();
        try {
            await fetch(`${BACKEND_URL}/feed/impressions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids }),
            });
        }
        catch { /* offline: drop (already marked seen this session) */ }
    }
    _setupSwitcherAutohide(scroll) {
        if (this._switcherAutohideInited)
            return;
        this._switcherAutohideInited = true;
        let lastY = scroll.scrollTop;
        scroll.addEventListener('scroll', () => {
            const sw = document.getElementById('homeSwitcher');
            if (!sw)
                return;
            const y = scroll.scrollTop;
            const stuck = sw.getBoundingClientRect().top <= scroll.getBoundingClientRect().top + 1;
            if (!stuck) {
                sw.classList.remove('home-switcher--hidden'); // natural spot under streak → always visible
            }
            else if (y > lastY + 6 && y > 120) {
                sw.classList.add('home-switcher--hidden'); // scrolling down → hide
            }
            else if (y < lastY - 6) {
                sw.classList.remove('home-switcher--hidden'); // scrolling up → show
            }
            lastY = y;
        }, { passive: true });
    }
    _setupSectionSwipe(feedList) {
        let sx = 0, sy = 0, dx = 0, active = false, decided = false, horizontal = false;
        const width = () => feedList.clientWidth || window.innerWidth || 1;
        feedList.addEventListener('touchstart', e => {
            if (e.touches.length !== 1) {
                active = false;
                return;
            }
            sx = e.touches[0].clientX;
            sy = e.touches[0].clientY;
            dx = 0;
            active = true;
            decided = false;
            horizontal = false;
        }, { passive: true });
        feedList.addEventListener('touchmove', e => {
            if (!active)
                return;
            dx = e.touches[0].clientX - sx;
            const dy = e.touches[0].clientY - sy;
            if (!decided) {
                if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
                    decided = true;
                    horizontal = Math.abs(dx) > Math.abs(dy) * 1.3;
                    if (horizontal)
                        feedList.style.transition = 'none';
                }
            }
            if (!horizontal)
                return;
            e.preventDefault();
            const cur = this._homeSection;
            let d = dx;
            if (cur === 'home' && d > 0)
                d *= 0.25; // nothing left of Home
            if (cur === 'explore' && d < 0)
                d *= 0.25; // nothing right of Explore
            const w = width();
            const cl = Math.max(-w, Math.min(w, d));
            feedList.style.transform = `translateX(${cl}px)`;
            feedList.style.opacity = String(1 - Math.min(0.45, Math.abs(cl) / w * 0.6));
            const p = cur === 'home' ? -cl / w : 1 - (cl / w); // 0 = Home, 1 = Explore
            this._dragDot(p);
        }, { passive: false });
        const end = () => {
            if (!active)
                return;
            active = false;
            if (!horizontal) {
                feedList.style.transform = '';
                feedList.style.opacity = '1';
                return;
            }
            const w = width();
            const cur = this._homeSection;
            const progress = dx / w;
            if (cur === 'home' && progress < -0.28)
                this._commitSwipe('explore');
            else if (cur === 'explore' && progress > 0.28)
                this._commitSwipe('home');
            else {
                feedList.style.transition = 'transform .2s ease, opacity .2s ease';
                feedList.style.transform = '';
                feedList.style.opacity = '1';
                this._positionSwitcherDot();
            }
        };
        feedList.addEventListener('touchend', end, { passive: true });
        feedList.addEventListener('touchcancel', end, { passive: true });
    }
    // ── Pull-to-refresh (app-styled) ────────────────────────────────────────────
    _setupPullToRefresh(scroll) {
        if (this._ptrInited)
            return;
        this._ptrInited = true;
        const ind = document.createElement('div');
        ind.className = 'home-ptr';
        ind.innerHTML = '<div class="home-ptr__spinner"></div>';
        (scroll.parentElement ?? document.body).appendChild(ind);
        const spinner = ind.querySelector('.home-ptr__spinner');
        const THRESH = 64;
        let startY = 0, pulling = false, dist = 0, refreshing = false;
        const reset = () => { ind.style.transform = 'translateX(-50%) translateY(0)'; ind.style.opacity = '0'; spinner.style.transform = ''; };
        scroll.addEventListener('touchstart', e => {
            if (refreshing)
                return;
            pulling = scroll.scrollTop <= 0;
            startY = e.touches[0].clientY;
            dist = 0;
        }, { passive: true });
        scroll.addEventListener('touchmove', e => {
            if (!pulling || refreshing)
                return;
            dist = e.touches[0].clientY - startY;
            if (dist <= 0 || scroll.scrollTop > 0) {
                pulling = scroll.scrollTop <= 0;
                reset();
                return;
            }
            const d = Math.min(110, dist * 0.5); // damped travel
            ind.style.transform = `translateX(-50%) translateY(${d}px)`;
            ind.style.opacity = String(Math.min(1, d / THRESH));
            spinner.style.transform = `rotate(${d * 4}deg)`;
            if (dist > 6)
                e.preventDefault(); // take over the gesture
        }, { passive: false });
        const release = async () => {
            if (!pulling)
                return;
            pulling = false;
            if (refreshing)
                return;
            if (dist * 0.5 < THRESH) {
                reset();
                return;
            }
            refreshing = true;
            ind.classList.add('home-ptr--active');
            ind.style.transform = `translateX(-50%) translateY(${THRESH}px)`;
            ind.style.opacity = '1';
            spinner.style.transform = '';
            try {
                const uid = localStorage.getItem('mapyou_userId_profile') ?? '';
                if (uid) {
                    try {
                        sessionStorage.removeItem(`mapyou_feedcache_${uid}`);
                    }
                    catch { /* ignore */ }
                }
                await this.render();
            }
            finally {
                refreshing = false;
                ind.classList.remove('home-ptr--active');
                reset();
            }
        };
        scroll.addEventListener('touchend', () => void release(), { passive: true });
        scroll.addEventListener('touchcancel', () => void release(), { passive: true });
    }
    // ── Feed cache + background fetch helpers ───────────────────────────────────
    _feedSig(feed) {
        return feed.map(f => `${(f.data.activityId ?? f.data.postId ?? f.data.id)}:${(f.data._likeCount ?? 0)}:${(f.data._commentCount ?? 0)}`).join('|');
    }
    _readFeedCache(userId) {
        if (!userId)
            return null;
        try {
            const raw = sessionStorage.getItem(`mapyou_feedcache_${userId}`);
            if (!raw)
                return null;
            const o = JSON.parse(raw);
            return Array.isArray(o.feed) ? { feed: o.feed, hasMore: !!o.hasMore } : null;
        }
        catch {
            return null;
        }
    }
    _writeFeedCache(userId, feed, hasMore) {
        if (!userId)
            return;
        try {
            sessionStorage.setItem(`mapyou_feedcache_${userId}`, JSON.stringify({ feed, hasMore }));
        }
        catch { /* quota exceeded — skip caching */ }
    }
    async _fetchServerFeed(userId) {
        try {
            const ctrl = new AbortController();
            const timer = setTimeout(() => ctrl.abort(), 5000);
            const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}`, { cache: 'no-store', signal: ctrl.signal });
            clearTimeout(timer);
            if (!res.ok)
                return null;
            const d = await res.json();
            return { feed: d.data ?? [], hasMore: d.hasMore ?? false };
        }
        catch {
            return null;
        }
    }
    _setupInfiniteScroll(scroll, activities, posts, userId) {
        this._feedObserver?.disconnect();
        document.getElementById('feedSentinel')?.remove();
        const hasMore = this._homeSection === 'explore' ? this._exploreHasMore : this._feedHasMore;
        if (!hasMore)
            return;
        const sentinel = document.createElement('div');
        sentinel.id = 'feedSentinel';
        sentinel.style.height = '1px';
        scroll.appendChild(sentinel);
        this._feedObserver = new IntersectionObserver(entries => {
            const explore = this._homeSection === 'explore';
            const loading = explore ? this._exploreLoading : this._feedLoading;
            const more = explore ? this._exploreHasMore : this._feedHasMore;
            if (entries[0].isIntersecting && !loading && more) {
                void this._loadMoreFeed(scroll, activities, posts, userId);
            }
        }, { rootMargin: '300px' });
        this._feedObserver.observe(sentinel);
    }
    async _loadMoreFeed(scroll, activities, posts, userId) {
        const explore = this._homeSection === 'explore';
        if ((explore ? this._exploreLoading : this._feedLoading) || !(explore ? this._exploreHasMore : this._feedHasMore))
            return;
        if (explore)
            this._exploreLoading = true;
        else
            this._feedLoading = true;
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
                const d = await res.json();
                const newItems = d.data ?? [];
                if (explore)
                    this._exploreHasMore = d.hasMore ?? false;
                else
                    this._feedHasMore = d.hasMore ?? false;
                if (newItems.length > 0) {
                    if (explore) {
                        this._exploreOffset += newItems.length;
                        this._exploreFeed?.push(...newItems);
                    }
                    else
                        this._feedCursor = newItems[newItems.length - 1].date;
                    document.getElementById('feedLoadMore')?.remove();
                    document.getElementById('feedSentinel')?.remove();
                    newItems.forEach((item, idx) => {
                        const isOwn = item.data.userId === userId;
                        let card;
                        let resolvedEnc = null;
                        if (isOwn && item.kind === 'activity') {
                            const local = activities.find(a => a.id === (item.data.activityId ?? item.data.id));
                            if (local) {
                                resolvedEnc = item.data.coordsEnc ??
                                    (local.coords && local.coords.length > 0 ? encodePolyline(local.coords) : null);
                                local.coordsEnc = resolvedEnc;
                                local.coords = [];
                                local.views = item.data._viewCount ?? 0;
                            }
                            card = local ? buildCard(local) : this._buildFriendFeedCard(item.kind, item.data, userId);
                        }
                        else if (isOwn && item.kind === 'post') {
                            const local = posts.find(p => p.id === (item.data.postId ?? item.data.id));
                            card = local ? buildPostCard(local, () => this.render()) : this._buildFriendFeedCard(item.kind, item.data, userId);
                        }
                        else {
                            card = this._buildFriendFeedCard(item.kind, item.data, userId);
                            resolvedEnc = item.data.coordsEnc ?? null;
                        }
                        const lc = (item.data._likeCount ?? 0);
                        if (lc > 0) {
                            const id = (item.data.activityId ?? item.data.postId ?? item.data.id);
                            const el = card.querySelector('[data-like-count="' + id + '"], [data-like-count="p_' + id + '"]');
                            if (el)
                                el.textContent = String(lc);
                        }
                        card.style.animationDelay = String(idx * 60) + 'ms';
                        if (item.kind === 'activity') {
                            card.style.cursor = 'pointer';
                            card.addEventListener('click', e => {
                                if (e.target.closest('button, a, video, input, [data-action], [data-pm], .home-card__photo, .home-card__avatar--user, .home-card__comment-panel, .hcs'))
                                    return;
                                void openActivityDetail(item.data, isOwn, (item.data.activityId ?? item.data.id));
                            });
                        }
                        scroll.appendChild(card);
                        if (item.kind === 'activity')
                            this._observeImpression(card, (item.data.activityId ?? item.data.id));
                        if (item.kind === 'activity' && resolvedEnc) {
                            requestAnimationFrame(() => {
                                setTimeout(() => {
                                    const mapEl = card.querySelector('.home-card__map-wrap--canvas, .home-card__map-wrap');
                                    if (mapEl) {
                                        mapEl.style.display = 'block';
                                        renderMinimapCanvas(mapEl, decodePolyline(resolvedEnc), (item.data.sport ?? 'running'));
                                    }
                                }, 80 + idx * 30);
                            });
                        }
                    });
                    if (explore ? this._exploreHasMore : this._feedHasMore)
                        this._setupInfiniteScroll(scroll, activities, posts, userId);
                }
                else if (explore) {
                    this._exploreHasMore = false;
                }
                else {
                    this._feedHasMore = false;
                }
            }
        }
        catch { }
        document.getElementById('feedLoadMore')?.remove();
        if (explore)
            this._exploreLoading = false;
        else
            this._feedLoading = false;
    }
    async _renderFriendsFeed() {
        const feedEl = document.getElementById('friendsFeed');
        if (!feedEl)
            return;
        const userId = localStorage.getItem('mapyou_userId_profile');
        if (!userId)
            return;
        try {
            const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}`);
            if (!res.ok) {
                feedEl.innerHTML = '';
                return;
            }
            const data = await res.json();
            // Filtruj tylko aktywności znajomych (nie własne)
            const friendItems = data.data.filter(item => item.data.userId !== userId);
            if (!friendItems.length) {
                feedEl.innerHTML = '';
                return;
            }
            const header = document.createElement('div');
            header.className = 'friends-feed__header';
            header.innerHTML = '<span>Friends Activity</span>';
            feedEl.innerHTML = '';
            feedEl.appendChild(header);
            for (const item of friendItems) {
                const card = this._buildFriendFeedCard(item.kind, item.data, userId);
                feedEl.appendChild(card);
                // Render minimap for activities with coordsEnc
                const enc = (item.data.coordsEnc ?? item.data._coordsEncResolved ?? null);
                if (enc && item.kind === 'activity') {
                    const mapEl = card.querySelector('.home-card__map-wrap--canvas, .home-card__map-wrap');
                    if (mapEl) {
                        const coords = decodePolyline(enc);
                        if (coords.length > 0)
                            renderMinimapCanvas(mapEl, coords, (item.data.sport ?? 'running'));
                    }
                }
            }
        }
        catch {
            feedEl.innerHTML = '';
        }
    }
    _buildFriendFeedCard(kind, data, myUserId) {
        if (kind === 'activity') {
            const act = {
                id: (data.activityId ?? data.id ?? ''),
                sport: (data.sport ?? 'running'),
                date: data.date,
                name: (data.name ?? data.description ?? ''),
                description: (data.description ?? ''),
                photoUrl: (data.photoUrl ?? null),
                minimapUrl: (data.minimapUrl ?? null),
                coordsEnc: (data.coordsEnc ?? null),
                distanceKm: +(data.distanceKm ?? 0),
                durationSec: +(data.durationSec ?? 0),
                paceMinKm: +(data.paceMinKm ?? 0),
                speedKmH: +(data.speedKmH ?? 0),
                intensity: +(data.intensity ?? 0),
                notes: (data.notes ?? ''),
                coords: [],
                views: +(data._viewCount ?? data.views ?? 0),
            };
            const card = buildCard(act);
            // Override avatar and name with friend's
            const avatarEl = card.querySelector('.home-card__avatar--user');
            const authorName = (data.authorName ?? '');
            if (avatarEl) {
                const avatar = (data.authorAvatarUrl ?? null);
                avatarEl.innerHTML = avatar
                    ? `<img src="${avatar}" class="home-card__avatar-img" alt="avatar"/>`
                    : `<span style="font-size:16px;font-weight:700">${authorName.charAt(0).toUpperCase()}</span>`;
                avatarEl.style.background = 'rgba(74,222,128,0.15)';
                avatarEl.style.borderColor = 'rgba(74,222,128,0.3)';
            }
            // Override name shown in header
            const nameEl = card.querySelector('.home-card__name');
            if (nameEl && authorName)
                nameEl.textContent = act.name || authorName;
            // Replace avatar element to remove own-profile handler from buildCard
            const friendUserId = (data.userId ?? '');
            if (avatarEl) {
                const newAvatarEl = avatarEl.cloneNode(true);
                avatarEl.replaceWith(newAvatarEl);
                newAvatarEl.removeAttribute('data-own-profile');
                newAvatarEl.addEventListener('click', e => {
                    e.stopPropagation();
                    if (friendUserId)
                        void openPublicProfile(friendUserId);
                });
            }
            // Override like button to use Atlas
            const likeBtn = card.querySelector('.home-card__action--like');
            const newLike = likeBtn?.cloneNode(true);
            if (likeBtn && newLike) {
                likeBtn.replaceWith(newLike);
                newLike.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const res = await fetch(`${BACKEND_URL}/feed/like`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: myUserId, itemId: act.id, itemType: 'activity' }),
                    });
                    if (res.ok) {
                        const d = await res.json();
                        broadcastLike(act.id, d.liked, d.count);
                    }
                });
            }
            return card;
        }
        else {
            const post = {
                id: (data.postId ?? data.id ?? ''),
                type: 'post',
                date: data.date,
                title: (data.title ?? ''),
                body: (data.body ?? ''),
                photoUrl: (data.photoUrl ?? null),
                authorName: (data.authorName ?? ''),
                avatarB64: (data.authorAvatarUrl ?? null),
            };
            const card = buildPostCard(post, () => { });
            card.querySelector('.home-card__post-menu-btn')?.remove();
            // Replace avatar element to remove own-profile handler
            const postFriendId = (data.userId ?? '');
            const postAvatarEl = card.querySelector('.home-card__avatar--user');
            if (postAvatarEl) {
                const newPostAvatar = postAvatarEl.cloneNode(true);
                postAvatarEl.replaceWith(newPostAvatar);
                newPostAvatar.addEventListener('click', e => {
                    e.stopPropagation();
                    if (postFriendId)
                        void openPublicProfile(postFriendId);
                });
            }
            const likeBtn = card.querySelector('.home-card__action--like');
            const newLike = likeBtn?.cloneNode(true);
            if (likeBtn && newLike) {
                likeBtn.replaceWith(newLike);
                newLike.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const res = await fetch(`${BACKEND_URL}/feed/like`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: myUserId, itemId: post.id, itemType: 'post' }),
                    });
                    if (res.ok) {
                        const d = await res.json();
                        newLike.classList.toggle('home-card__action--liked', d.liked);
                        const el = card.querySelector(`[data-like-count="p_${post.id}"]`);
                        if (el)
                            el.textContent = String(d.count);
                    }
                });
            }
            return card;
        }
    }
    async _loadFeedItemMeta(card, itemId, itemType, userId) {
        try {
            const [lr, cr] = await Promise.all([
                fetch(`${BACKEND_URL}/feed/likes/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`),
                fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(itemId)}`),
            ]);
            if (lr.ok) {
                const ld = await lr.json();
                const btn = card.querySelector('.ff-card__like');
                if (btn) {
                    btn.classList.toggle('ff-card__like--liked', ld.liked);
                    const el = btn.querySelector('.ff-like-count');
                    if (el)
                        el.textContent = String(ld.count);
                }
            }
            if (cr.ok) {
                const cd = await cr.json();
                const list = card.querySelector('.ff-comments__list');
                if (list) {
                    list.innerHTML = cd.data.map(c => `<div class="ff-comment"><span class="ff-comment__author">${c.authorName}</span><span class="ff-comment__text">${c.text}</span></div>`).join('');
                }
                const el = card.querySelector('.ff-comment-count');
                if (el)
                    el.textContent = String(cd.data.length);
            }
        }
        catch { }
    }
    switchToHome() {
        const btn = document.querySelector('.bottom-nav__item[data-tab="tabHome"]');
        btn?.click();
    }
}
export const homeView = new HomeView();
/** Eksportowana funkcja do otwierania viewera z zewnątrz (ProfileView, PublicProfile) */
export function openReelViewer(group, onSeen) {
    // Inject the group into the feed temporarily so _openReelsViewer can find it
    const hv = homeView;
    const feed = hv._reelsFeed;
    if (feed) {
        const existing = feed.findIndex(g => g.userId === group.userId);
        if (existing >= 0)
            feed[existing] = group;
        else
            feed.unshift(group);
    }
    void hv._openReelsViewer(group.userId, 0);
    onSeen();
}
import { getIcon as _gi2, getColor as _gc2 } from './Tracker.js';
window._mapyouGetIcon = _gi2;
window._mapyouGetColor = _gc2;
//# sourceMappingURL=HomeView.js.map