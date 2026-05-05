// ─── HOME VIEW — Activity Feed ────────────────────────────────────────────────
// src/modules/HomeView.ts
import { loadEnrichedActivities } from './db.js';
import { openPublicProfile } from './PublicProfile.js';
import { BACKEND_URL } from '../config.js';
import { SPORT_COLORS, SPORT_ICONS, formatDuration, formatPace, formatDistance } from './Tracker.js';
import { generateShareImageFromEnriched } from './ShareImage.js';
import { loadProfileFromLocal } from './UserProfile.js';
import { getNotifications, getUnreadCount, markAllRead, clearAll, onNotificationsChange, notifyActivityAdded, } from './NotificationsService.js';
import { profileView, updateBestStreak } from './ProfileView.js';
import { searchView } from './SearchView.js';
import { openPostModal } from './PostModal.js';
import { openSaveActivityModal } from './SaveActivityModal.js';
import { loadUnifiedWorkouts } from './UnifiedWorkout.js';
import { statsView } from './StatsView.js';
import { loadPosts } from './db.js';
import { CS } from './cloudSync.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
// ── Static Map URL (Mapbox) ───────────────────────────────────────────────────
function generateStaticMapUrl(coords) {
    if (!coords || coords.length === 0)
        return null;
    const token = 'pk.eyJ1IjoibGVzemVrLW1pa3J1dCIsImEiOiJjbW8ybm5jZ3IwYmZjMnFxd3VycjBtaHZ4In0.mpY8zJ-aEW8n5iZhf2GrWA';
    if (coords.length === 1) {
        // Single point — just a pin marker
        const [lat, lon] = coords[0];
        return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/pin-l+1a73e8(${lon},${lat})/${lon},${lat},15,0/400x200?access_token=${token}`;
    }
    // Route — polyline + start pin
    const lats = coords.map(p => p[0]);
    const lons = coords.map(p => p[1]);
    const clat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const clon = (Math.min(...lons) + Math.max(...lons)) / 2;
    const step = Math.max(1, Math.floor(coords.length / 100));
    const pts = coords.filter((_, i) => i % step === 0);
    const geo = JSON.stringify({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: pts.map(p => [p[1], p[0]]) },
        properties: { stroke: '#00c46a', 'stroke-width': 3 },
    });
    const startLon = coords[0][1];
    const startLat = coords[0][0];
    const marker = `pin-l+1a73e8(${startLon},${startLat})`;
    return `https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/${marker},geojson(${encodeURIComponent(geo)})/${clon},${clat},13,0/400x200?access_token=${token}`;
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
// ── Mini map ──────────────────────────────────────────────────────────────────
const _activeMaps = new Map();
function renderMiniMap(container, coords, sport) {
    if (!coords || coords.length === 0) {
        container.innerHTML = '<div class="home-card__no-map">No GPS data</div>';
        return;
    }
    const existing = _activeMaps.get(container.id);
    if (existing) {
        try {
            existing.remove();
        }
        catch { }
    }
    const map = L.map(container, {
        zoomControl: false, dragging: false, touchZoom: false,
        scrollWheelZoom: false, doubleClickZoom: false,
        boxZoom: false, keyboard: false, attributionControl: false,
    });
    _activeMaps.set(container.id, map);
    L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(map);
    const color = SPORT_COLORS[sport] ?? '#00c46a';
    if (coords.length === 1) {
        // Single point — show pin marker, no polyline
        const [lat, lng] = coords[0];
        map.setView([lat, lng], 15);
        L.marker([lat, lng], {
            icon: L.divIcon({
                className: '',
                html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="28" height="42">
          <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"
            fill="${color}" stroke="white" stroke-width="1.5"/>
          <circle cx="12" cy="12" r="5" fill="white"/>
        </svg>`,
                iconSize: [28, 42],
                iconAnchor: [14, 42],
            }),
        }).addTo(map);
    }
    else {
        // Route — polyline with start/end markers
        const line = L.polyline(coords.map(c => L.latLng(c[0], c[1])), {
            color, weight: 4, opacity: 0.95,
        }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [16, 16] });
        const first = coords[0];
        const last = coords[coords.length - 1];
        L.circleMarker([first[0], first[1]], { radius: 5, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(map);
        L.circleMarker([last[0], last[1]], { radius: 5, color: '#fff', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).addTo(map);
    }
}
// ── Comment panel ─────────────────────────────────────────────────────────────
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
function buildPostCard(post, onRefresh) {
    const card = document.createElement('article');
    card.className = 'home-card home-card--post';
    card.dataset.id = post.id;
    const avatarHtml = post.avatarB64
        ? `<img src="${post.avatarB64}" class="home-card__avatar-img" alt="avatar"/>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
    const photoHtml = post.photoUrl
        ? `<div class="home-card__photo" data-photosrc="${post.photoUrl}"><img src="${post.photoUrl}" alt="" loading="lazy"/></div>`
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
            onRefresh();
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
            btn.classList.toggle('home-card__action--liked', d.liked);
            const el = card.querySelector(`[data-like-count="p_${post.id}"]`);
            if (el)
                el.textContent = String(d.count);
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
function buildCard(act) {
    const card = document.createElement('article');
    card.className = 'home-card';
    card.dataset.id = act.id;
    const color = SPORT_COLORS[act.sport] ?? '#00c46a';
    const icon = SPORT_ICONS[act.sport] ?? '🏅';
    const distFmt = formatDistance(act.distanceKm);
    const timeFmt = formatDuration(act.durationSec);
    const paceFmt = act.sport !== 'cycling' ? formatPace(act.paceMinKm) : act.speedKmH.toFixed(1);
    const paceLabel = act.sport !== 'cycling' ? 'min/km' : 'km/h';
    const mapId = `hcmap-${act.id}`;
    const intenHtml = act.intensity
        ? `<span class="home-card__badge" style="background:${intensityColor(act.intensity)}22;color:${intensityColor(act.intensity)};border:1px solid ${intensityColor(act.intensity)}44">${intensityLabel(act.intensity)}</span>`
        : '';
    const photoHtml = act.photoUrl
        ? `<div class="home-card__photo" data-photosrc="${act.photoUrl}"><img src="${act.photoUrl}" alt="Activity photo" loading="lazy"/></div>`
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

    ${act.minimapUrl ? `<div class="home-card__map-wrap"><img src="${act.minimapUrl}" class="home-card__minimap-img" alt="route"/></div>` : act.coords && act.coords.length > 0 ? `<div class="home-card__map-wrap" id="${mapId}"></div>` : ''}

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
                    btn.classList.toggle('home-card__action--liked', d.liked);
                    const el = card.querySelector(`[data-like-count="${act.id}"]`);
                    if (el)
                        el.textContent = String(d.count);
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
        ${notifs.length === 0
        ? '<div class="hn-empty"><span>🔔</span><p>No notifications yet</p></div>'
        : notifs.map(n => `
            <div class="hn-item ${n.read ? '' : 'hn-item--unread'}" data-id="${n.id}">
              <div class="hn-item__icon">${n.icon ?? '🔔'}</div>
              <div class="hn-item__body">
                <div class="hn-item__title">${n.title}</div>
                <div class="hn-item__body-text">${n.body}</div>
                <div class="hn-item__time">${_relTimeNotif(n.timestamp)}</div>
              </div>
            </div>`).join('')}
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
    _buildStreakWidget() {
        const wrap = document.createElement('div');
        wrap.className = 'home-streak';
        // Compute streak from unifiedWorkouts
        const workoutDates = new Set(this._workouts.map(w => {
            const d = new Date(typeof w.date === 'number' ? w.date : w.date);
            return d.toDateString();
        }));
        // Also include enriched activities dates
        let streak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        for (let i = 0; i < 365; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            if (workoutDates.has(d.toDateString()))
                streak++;
            else
                break;
        }
        const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const days = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            days.push({
                label: DAY_LABELS[d.getDay()],
                active: workoutDates.has(d.toDateString()),
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
    async render() {
        this.container = document.querySelector('#tabHome .home-scroll');
        if (!this.container)
            return;
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
        scroll.appendChild(this._buildStreakWidget());
        // Pobierz unified feed z Atlas (własne + znajomych)
        const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
        let serverFeed = [];
        let serverRes = {};
        if (userId) {
            try {
                const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}`);
                if (res.ok) {
                    const d = await res.json();
                    serverFeed = d.data ?? [];
                    this._feedHasMore = d.hasMore ?? false;
                    if (serverFeed.length > 0)
                        this._feedCursor = serverFeed[serverFeed.length - 1].date;
                }
            }
            catch { /* offline */ }
        }
        const feed = serverFeed.length > 0
            ? serverFeed
            : [
                ...activities.map(a => ({ kind: 'activity', date: a.date, data: a, isLocal: true })),
                ...posts.map(p => ({ kind: 'post', date: p.date, data: p, isLocal: true })),
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
            let card;
            if (isOwn && item.kind === 'activity') {
                const localAct = activities.find(a => a.id === (item.data.activityId ?? item.data.id));
                card = localAct ? buildCard(localAct) : this._buildFriendFeedCard(item.kind, item.data, userId);
            }
            else if (isOwn && item.kind === 'post') {
                const localPost = posts.find(p => p.id === (item.data.postId ?? item.data.id));
                card = localPost
                    ? buildPostCard(localPost, () => void this.render())
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
            scroll.appendChild(card);
            if (isOwn && item.kind === 'activity') {
                const localAct = activities.find(a => a.id === (item.data.activityId ?? item.data.id));
                if (localAct) {
                    requestAnimationFrame(() => {
                        setTimeout(() => {
                            const mapEl = document.getElementById(`hcmap-${localAct.id}`);
                            if (mapEl)
                                renderMiniMap(mapEl, localAct.coords, localAct.sport);
                        }, 80 + idx * 30);
                    });
                }
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
                    const btn = scroll.querySelector(`[data-like-count="${id}"]`)?.closest('.home-card__action');
                    if (btn)
                        btn.classList.add('home-card__action--liked');
                    const btnP = scroll.querySelector(`[data-like-count="p_${id}"]`)?.closest('.home-card__action');
                    if (btnP)
                        btnP.classList.add('home-card__action--liked');
                }
            }).catch(() => { });
        }
        // Infinite scroll
        this._setupInfiniteScroll(scroll, activities, posts, userId);
    }
    _setupInfiniteScroll(scroll, activities, posts, userId) {
        this._feedObserver?.disconnect();
        document.getElementById('feedSentinel')?.remove();
        if (!this._feedHasMore)
            return;
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
    async _loadMoreFeed(scroll, activities, posts, userId) {
        if (this._feedLoading || !this._feedHasMore)
            return;
        this._feedLoading = true;
        const spinner = document.createElement('div');
        spinner.id = 'feedLoadMore';
        spinner.className = 'home-loading';
        spinner.innerHTML = '<div class="home-loading__spinner"></div>';
        document.getElementById('feedSentinel')?.before(spinner);
        try {
            const res = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}&before=${this._feedCursor}`, { cache: 'no-store' });
            if (res.ok) {
                const d = await res.json();
                const newItems = d.data ?? [];
                this._feedHasMore = d.hasMore ?? false;
                if (newItems.length > 0) {
                    this._feedCursor = newItems[newItems.length - 1].date;
                    document.getElementById('feedLoadMore')?.remove();
                    document.getElementById('feedSentinel')?.remove();
                    newItems.forEach((item, idx) => {
                        const isOwn = item.data.userId === userId;
                        let card;
                        if (isOwn && item.kind === 'activity') {
                            const local = activities.find(a => a.id === (item.data.activityId ?? item.data.id));
                            card = local ? buildCard(local) : this._buildFriendFeedCard(item.kind, item.data, userId);
                        }
                        else if (isOwn && item.kind === 'post') {
                            const local = posts.find(p => p.id === (item.data.postId ?? item.data.id));
                            card = local ? buildPostCard(local, () => void this.render()) : this._buildFriendFeedCard(item.kind, item.data, userId);
                        }
                        else {
                            card = this._buildFriendFeedCard(item.kind, item.data, userId);
                        }
                        const lc = (item.data._likeCount ?? 0);
                        if (lc > 0) {
                            const id = (item.data.activityId ?? item.data.postId ?? item.data.id);
                            const el = card.querySelector('[data-like-count="' + id + '"], [data-like-count="p_' + id + '"]');
                            if (el)
                                el.textContent = String(lc);
                        }
                        card.style.animationDelay = String(idx * 60) + 'ms';
                        scroll.appendChild(card);
                    });
                    if (this._feedHasMore)
                        this._setupInfiniteScroll(scroll, activities, posts, userId);
                }
                else {
                    this._feedHasMore = false;
                }
            }
        }
        catch { }
        document.getElementById('feedLoadMore')?.remove();
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
                distanceKm: +(data.distanceKm ?? 0),
                durationSec: +(data.durationSec ?? 0),
                paceMinKm: +(data.paceMinKm ?? 0),
                speedKmH: +(data.speedKmH ?? 0),
                intensity: +(data.intensity ?? 0),
                notes: (data.notes ?? ''),
                coords: [],
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
                        newLike.classList.toggle('home-card__action--liked', d.liked);
                        const el = card.querySelector(`[data-like-count="${act.id}"]`);
                        if (el)
                            el.textContent = String(d.count);
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
//# sourceMappingURL=HomeView.js.map