// ─── SEARCH VIEW ──────────────────────────────────────────────────────────────
// src/modules/SearchView.ts
//
// Friends & Clubs search panel opened from Home via 🔍 button.
// Friends: search, invite, list (backend-ready placeholders)
// Clubs: create locally, search by name/location (backend-ready)
/* eslint-disable @typescript-eslint/no-explicit-any */
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
const LS_CLUBS = 'mapyou_local_clubs';
const LS_FRIENDS = 'mapyou_local_friends';
// ── Storage helpers ───────────────────────────────────────────────────────────
export function loadClubs() {
    try {
        return JSON.parse(localStorage.getItem(LS_CLUBS) ?? '[]');
    }
    catch {
        return [];
    }
}
export function saveClubs(clubs) {
    localStorage.setItem(LS_CLUBS, JSON.stringify(clubs));
}
export function getJoinedClubs() {
    return loadClubs().filter(c => c.joined || c.isOwner);
}
export function addToClubFeed(clubId, item) {
    const clubs = loadClubs();
    const club = clubs.find(c => c.id === clubId);
    if (!club)
        return;
    if (!club.feed)
        club.feed = [];
    club.feed.unshift(item);
    saveClubs(clubs);
}
function loadFriends() {
    try {
        return JSON.parse(localStorage.getItem(LS_FRIENDS) ?? '[]');
    }
    catch {
        return [];
    }
}
// ── SearchView class ──────────────────────────────────────────────────────────
export class SearchView {
    constructor() {
        Object.defineProperty(this, "_tab", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'friends'
        });
        Object.defineProperty(this, "_friendQuery", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ''
        });
        Object.defineProperty(this, "_clubQuery", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: ''
        });
        Object.defineProperty(this, "_followingSet", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Set()
        }); // userIds I already follow
    }
    open() {
        document.getElementById('searchViewOverlay')?.remove();
        const el = this._build();
        document.body.appendChild(el);
        requestAnimationFrame(() => {
            el.classList.add('sv2-overlay--visible');
            setTimeout(() => el.querySelector('.sv2-sheet')?.classList.add('sv2-sheet--open'), 10);
        });
        this._bindEvents(el);
        this._renderTab(this._tab, el);
    }
    close() {
        const el = document.getElementById('searchViewOverlay');
        if (!el)
            return;
        el.querySelector('.sv2-sheet')?.classList.remove('sv2-sheet--open');
        el.classList.remove('sv2-overlay--visible');
        setTimeout(() => el.remove(), 360);
    }
    // ── Shell ─────────────────────────────────────────────────────────────────
    _build() {
        const wrap = document.createElement('div');
        wrap.innerHTML = `
    <div class="sv2-overlay" id="searchViewOverlay">
      <div class="sv2-sheet">
        <div class="sv2-handle"></div>
        <div class="sv2-header">
          <button class="sv2-back" id="sv2Back">←</button>
          <h2 class="sv2-title">Search</h2>
        </div>
        <div class="sv2-tabs">
          <button class="sv2-tab sv2-tab--active" data-sv2="friends">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Friends
          </button>
          <button class="sv2-tab" data-sv2="clubs">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/>
            </svg>
            Clubs
          </button>
        </div>
        <div class="sv2-content" id="sv2Content"></div>
      </div>
    </div>`;
        return wrap.firstElementChild;
    }
    // ── Events ────────────────────────────────────────────────────────────────
    _bindEvents(el) {
        el.querySelector('#sv2Back')?.addEventListener('click', () => this.close());
        el.addEventListener('click', e => { if (e.target === el)
            this.close(); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape')
            this.close(); }, { once: true });
        el.querySelectorAll('.sv2-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                el.querySelectorAll('.sv2-tab').forEach(b => b.classList.remove('sv2-tab--active'));
                btn.classList.add('sv2-tab--active');
                this._tab = btn.dataset.sv2;
                this._renderTab(this._tab, el);
            });
        });
        // Swipe
        const sheet = el.querySelector('.sv2-sheet');
        const handle = el.querySelector('.sv2-handle');
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
            if (e.changedTouches[0].clientY - startY > 120)
                this.close();
            else
                sheet.style.transform = '';
        });
    }
    _renderTab(tab, el) {
        const content = el.querySelector('#sv2Content');
        if (tab === 'friends')
            this._renderFriends(content);
        else
            this._renderClubs(content);
    }
    // ══════════════════════════════════════════════════════════════════════════
    // FRIENDS TAB
    // ══════════════════════════════════════════════════════════════════════════
    _renderFriends(el) {
        el.innerHTML = `
      <div class="sv2-search-wrap">
        <div class="sv2-search-row">
          <div class="sv2-search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="sv2-search-icon">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input class="sv2-search-input" id="sv2FriendSearch" type="text"
              placeholder="Search athletes…" value="${this._friendQuery}" autocomplete="off"/>
          </div>
        </div>
      </div>
      <div id="sv2FriendResults" style="padding-bottom:32px"></div>`;
        const resultsEl = el.querySelector('#sv2FriendResults');
        const myUserId = getUserId();
        const renderUserList = (users, title) => {
            if (!users.length) {
                resultsEl.innerHTML = `<div class="sv2-empty"><div class="sv2-empty__icon">👥</div><p class="sv2-empty__title">No results</p></div>`;
                return;
            }
            resultsEl.innerHTML = `
        <div class="sv2-section-title">${title}</div>
        <div class="sv2-list">${users.map(u => {
                const isFollowing = this._followingSet.has(u.userId);
                const loc = [u.city, u.region].filter(Boolean).join(', ');
                const avatar = u.avatarB64
                    ? `<img src="${u.avatarB64}" style="width:100%;height:100%;object-fit:cover;border-radius:50%"/>`
                    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;
                return `
            <div class="sv2-item" data-userid="${u.userId}" style="cursor:pointer">
              <div class="sv2-item__avatar">${avatar}</div>
              <div class="sv2-item__info">
                <span class="sv2-item__name">${u.name}</span>
                ${loc ? `<span class="sv2-item__sub">📍 ${loc}</span>` : ''}
                ${u.followersCount ? `<span class="sv2-item__desc">${u.followersCount} followers</span>` : ''}
              </div>
              <button class="sv2-badge ${isFollowing ? 'sv2-badge--gray' : 'sv2-badge--green'}"
                data-follow="${u.userId}">${isFollowing ? 'Following' : 'Follow'}</button>
            </div>`;
            }).join('')}
        </div>`;
            // Follow buttons
            resultsEl.querySelectorAll('[data-follow]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const targetId = btn.dataset.follow;
                    const isNow = this._followingSet.has(targetId);
                    if (isNow) {
                        await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
                        this._followingSet.delete(targetId);
                        btn.textContent = 'Follow';
                        btn.className = 'sv2-badge sv2-badge--green';
                    }
                    else {
                        await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(targetId)}`, { method: 'POST' });
                        this._followingSet.add(targetId);
                        btn.textContent = 'Following';
                        btn.className = 'sv2-badge sv2-badge--gray';
                    }
                });
            });
            // Item click → open public profile
            resultsEl.querySelectorAll('.sv2-item').forEach(item => {
                item.addEventListener('click', e => {
                    if (e.target.closest('[data-follow]'))
                        return;
                    const uid = item.dataset.userid;
                    if (!uid)
                        return;
                    // Lower search overlay so profile appears on top
                    const searchOverlay = document.getElementById('searchViewOverlay');
                    if (searchOverlay)
                        searchOverlay.style.zIndex = '4999';
                    import('./PublicProfile.js').then(m => {
                        m.openPublicProfile(uid);
                        // Restore z-index when profile closes
                        const watcher = setInterval(() => {
                            if (!document.querySelector('.pv-overlay--visible')) {
                                clearInterval(watcher);
                                if (searchOverlay)
                                    searchOverlay.style.zIndex = '';
                            }
                        }, 300);
                    });
                });
            });
        };
        const loadSuggestions = async () => {
            resultsEl.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">Loading…</div>';
            try {
                // Load my following list to know who I already follow
                const meRes = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}`);
                const meData = await meRes.json();
                this._followingSet = new Set(meData.data?.following ?? []);
                const res = await fetch(`${BACKEND_URL}/users/suggestions?userId=${encodeURIComponent(myUserId)}`);
                const data = await res.json();
                renderUserList(data.data ?? [], 'People you may know');
            }
            catch {
                resultsEl.innerHTML = '<div class="sv2-empty"><p class="sv2-empty__title">Offline</p></div>';
            }
        };
        const searchUsers = async (q) => {
            if (!q.trim()) {
                void loadSuggestions();
                return;
            }
            resultsEl.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">Searching…</div>';
            try {
                const res = await fetch(`${BACKEND_URL}/users/search?q=${encodeURIComponent(q)}&exclude=${encodeURIComponent(myUserId)}`);
                const data = await res.json();
                renderUserList(data.data ?? [], `Results for "${q}"`);
            }
            catch {
                resultsEl.innerHTML = '<div class="sv2-empty"><p class="sv2-empty__title">Error</p></div>';
            }
        };
        void loadSuggestions();
        let _debounce;
        el.querySelector('#sv2FriendSearch')?.addEventListener('input', e => {
            this._friendQuery = e.target.value;
            clearTimeout(_debounce);
            _debounce = setTimeout(() => void searchUsers(this._friendQuery), 400);
        });
    }
    // ══════════════════════════════════════════════════════════════════════════
    // CLUBS TAB
    // ══════════════════════════════════════════════════════════════════════════
    _renderClubs(el) {
        const userLoc = this._getUserLocation();
        el.innerHTML = `
      <div class="sv2-search-wrap">
        <div class="sv2-search-row">
          <div class="sv2-search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="sv2-search-icon">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input class="sv2-search-input" id="sv2ClubSearch" type="text"
              placeholder="Search clubs by name or city…" value="${this._clubQuery}" autocomplete="off"/>
          </div>
          <button class="sv2-create-btn" id="sv2CreateClub">+ Create</button>
        </div>
        <div class="sv2-location-pill" id="sv2LocationBtn" style="cursor:pointer;user-select:none">
          📍 ${userLoc ? `Near ${userLoc}` : 'Set location'} <span style="opacity:.5">▾</span>
        </div>
      </div>
      <div id="sv2ClubResults" style="padding-bottom:32px"></div>`;
        const resultsEl = el.querySelector('#sv2ClubResults');
        const myUserId = getUserId();
        const renderClubs = (clubs, title) => {
            if (!clubs.length) {
                resultsEl.innerHTML = '<div class="sv2-empty"><div class="sv2-empty__icon">🚴</div><p class="sv2-empty__title">No clubs found</p></div>';
                return;
            }
            const sportIcons = { running: '🏃', walking: '🚶', cycling: '🚴', fitness: '💪', hiking: '🥾', other: '🏅' };
            resultsEl.innerHTML = `
        <div class="sv2-section-title">${title}</div>
        <div class="sv2-list">
          ${clubs.map(c => {
                const isMember = c.members.includes(myUserId);
                const icon = sportIcons[c.sport] ?? '🏅';
                const avatar = c.avatarB64
                    ? `<img src="${c.avatarB64}" style="width:100%;height:100%;object-fit:cover;border-radius:14px"/>`
                    : `<span style="font-size:24px">${icon}</span>`;
                return `
              <div class="sv2-item" data-club-id="${c.clubId}" style="cursor:pointer">
                <div class="sv2-item__avatar sv2-item__avatar--club">${avatar}</div>
                <div class="sv2-item__info">
                  <span class="sv2-item__name">${c.name}</span>
                  <span class="sv2-item__sub">${c.members.length} members · ${[c.city, c.region].filter(Boolean).join(', ')}</span>
                  ${c.description ? `<span class="sv2-item__desc">${c.description.slice(0, 60)}</span>` : ''}
                </div>
                <button class="sv2-badge ${isMember ? 'sv2-badge--gray' : 'sv2-badge--green'}"
                  data-club-join="${c.clubId}">${isMember ? 'Joined' : 'Join'}</button>
              </div>`;
            }).join('')}
        </div>`;
            // Join/Leave
            resultsEl.querySelectorAll('[data-club-join]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const cid = btn.dataset.clubJoin;
                    const joined = btn.textContent === 'Joined';
                    const url = `${BACKEND_URL}/clubs/${encodeURIComponent(cid)}/${joined ? 'leave' : 'join'}`;
                    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: myUserId }) });
                    btn.textContent = joined ? 'Join' : 'Joined';
                    btn.className = joined ? 'sv2-badge sv2-badge--green' : 'sv2-badge sv2-badge--gray';
                });
            });
        };
        const userRegion = localStorage.getItem('mapyou_region') ?? '';
        const searchOverride = localStorage.getItem('mapyou_search_city'); // null=not set, ''=cleared by user
        const loadNearby = async () => {
            resultsEl.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">Loading…</div>';
            try {
                let label = '';
                let url = `${BACKEND_URL}/clubs`;
                if (searchOverride !== null) {
                    // User explicitly set or cleared location
                    if (searchOverride.trim()) {
                        label = searchOverride;
                        url = `${BACKEND_URL}/clubs?city=${encodeURIComponent(searchOverride)}`;
                    }
                    // else '' = show all
                }
                else if (userRegion) {
                    label = userRegion;
                    url = `${BACKEND_URL}/clubs?region=${encodeURIComponent(userRegion)}`;
                }
                else if (userLoc) {
                    label = userLoc;
                    url = `${BACKEND_URL}/clubs?city=${encodeURIComponent(userLoc)}`;
                }
                const res = await fetch(url, { cache: 'no-store' });
                const data = await res.json();
                renderClubs(data.data ?? [], label ? `Near ${label}` : 'All clubs');
            }
            catch {
                resultsEl.innerHTML = '<div class="sv2-empty"><p class="sv2-empty__title">Offline</p></div>';
            }
        };
        const searchClubs = async (q) => {
            if (!q.trim()) {
                void loadNearby();
                return;
            }
            resultsEl.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">Searching…</div>';
            try {
                const res = await fetch(`${BACKEND_URL}/clubs?q=${encodeURIComponent(q)}`, { cache: 'no-store' });
                const data = await res.json();
                renderClubs(data.data ?? [], `Results for "${q}"`);
            }
            catch {
                resultsEl.innerHTML = '<div class="sv2-empty"><p class="sv2-empty__title">Error</p></div>';
            }
        };
        // Location picker — uses separate search key, doesn't touch profile city
        el.querySelector('#sv2LocationBtn')?.addEventListener('click', () => {
            const current = localStorage.getItem('mapyou_search_city') ?? localStorage.getItem('mapyou_city') ?? '';
            const city = prompt('Enter city or region (empty = show all):', current);
            if (city === null)
                return;
            if (city.trim()) {
                localStorage.setItem('mapyou_search_city', city.trim());
            }
            else {
                localStorage.removeItem('mapyou_search_city');
            }
            this._renderClubs(el);
        });
        // Load my clubs from local storage + backend
        const myClubs = loadClubs();
        if (myClubs.length > 0) {
            const mySection = document.createElement('div');
            mySection.innerHTML = `
        <div class="sv2-section-title">My Clubs</div>
        <div class="sv2-list">
          ${myClubs.map(c => {
                const sportIcons = { running: '🏃', walking: '🚶', cycling: '🚴', fitness: '💪', hiking: '🥾', other: '🏅' };
                return `<div class="sv2-item">
              <div class="sv2-item__avatar sv2-item__avatar--club">
                ${c.logoB64 ? `<img src="${c.logoB64}" style="width:100%;height:100%;object-fit:cover;border-radius:14px"/>` : `<span style="font-size:24px">${sportIcons[c.sport] ?? '🏅'}</span>`}
              </div>
              <div class="sv2-item__info">
                <span class="sv2-item__name">${c.name}</span>
                <span class="sv2-item__sub">${c.memberCount} members · ${c.location}</span>
              </div>
              <span class="sv2-badge sv2-badge--gray">Owner</span>
            </div>`;
            }).join('')}
        </div>`;
            resultsEl.insertAdjacentElement('beforebegin', mySection);
        }
        void loadNearby();
        // Create club
        el.querySelector('#sv2CreateClub')?.addEventListener('click', () => {
            this._openCreateClubModal(el);
        });
        // Search with debounce
        let _debounce;
        el.querySelector('#sv2ClubSearch')?.addEventListener('input', e => {
            this._clubQuery = e.target.value;
            clearTimeout(_debounce);
            _debounce = setTimeout(() => void searchClubs(this._clubQuery), 400);
        });
    }
    _buildClubItem(c) {
        const sportIcons = {
            running: '🏃', walking: '🚶', cycling: '🚴', fitness: '💪', hiking: '🥾', other: '🏅',
        };
        const colors = {
            running: '#00c46a', cycling: '#ffb545', walking: '#5badea', fitness: '#f97316', hiking: '#a78bfa', other: '#6b7280',
        };
        const icon = sportIcons[c.sport] ?? '🏅';
        const logoStyle = c.logoB64
            ? `background:url('${c.logoB64}') center/cover no-repeat;`
            : `background:${colors[c.sport] ?? '#00c46a'}22;`;
        return `
      <div class="sv2-item sv2-item--club" data-club-open="${c.id}" style="cursor:pointer">
        <div class="sv2-item__avatar sv2-item__avatar--club" style="${logoStyle}">
          ${c.logoB64 ? '' : `<span style="font-size:1.6rem">${icon}</span>`}
        </div>
        <div class="sv2-item__info">
          <span class="sv2-item__name">${c.name}</span>
          <span class="sv2-item__sub">📍 ${c.location} · ${c.memberCount} member${c.memberCount !== 1 ? 's' : ''}</span>
          ${c.description ? `<span class="sv2-item__desc">${c.description}</span>` : ''}
        </div>
        <div class="sv2-item__actions">
          ${c.isOwner
            ? `<button class="sv2-badge sv2-badge--red" data-club-del="${c.id}">Delete</button>`
            : `<button class="sv2-badge ${c.joined ? 'sv2-badge--gray' : 'sv2-badge--green'}" data-club-join="${c.id}">
                ${c.joined ? 'Leave' : 'Join'}
              </button>`}
        </div>
      </div>`;
    }
    // ── Create club modal ─────────────────────────────────────────────────────
    _openClubDetail(club) {
        document.getElementById('clubDetailModal')?.remove();
        const sportIcons = {
            running: '🏃', walking: '🚶', cycling: '🚴', fitness: '💪', hiking: '🥾', other: '🏅',
        };
        const icon = sportIcons[club.sport] ?? '🏅';
        const colors = {
            running: '#00c46a', cycling: '#ffb545', walking: '#5badea', fitness: '#f97316', hiking: '#a78bfa', other: '#6b7280',
        };
        const color = colors[club.sport] ?? '#00c46a';
        const modal = document.createElement('div');
        modal.id = 'clubDetailModal';
        modal.className = 'sv2-club-detail-overlay';
        const feed = club.feed ?? [];
        const feedHtml = feed.length === 0
            ? `<div class="sv2-club-detail__feed-empty">
           <span>📢</span>
           <p>No posts yet in this club.</p>
           <p class="sv2-club-detail__feed-sub">Share activities or posts to see them here.</p>
         </div>`
            : feed.map(f => `
          <div class="sv2-club-feed-item">
            <div class="sv2-club-feed-item__top">
              <span class="sv2-club-feed-item__author">${f.authorName}</span>
              <span class="sv2-club-feed-item__date">${new Date(f.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
            </div>
            <div class="sv2-club-feed-item__title">${f.title}</div>
            ${f.body ? `<div class="sv2-club-feed-item__body">${f.body}</div>` : ''}
            ${f.type === 'activity' && f.distanceKm ? `
              <div class="sv2-club-feed-item__stats">
                <span>${f.distanceKm.toFixed(2)} km</span>
                ${f.durationSec ? `<span>${Math.floor(f.durationSec / 60)}m</span>` : ''}
              </div>` : ''}
          </div>`).join('');
        modal.innerHTML = `
      <div class="sv2-club-detail">
        <!-- Banner -->
        <div class="sv2-club-detail__banner" style="${club.bannerB64
            ? `background:url('${club.bannerB64}') center/cover`
            : `background:linear-gradient(135deg,${color}33,${color}11)`}">
          <button class="sv2-club-detail__back" id="cdbBack">←</button>
          ${club.isOwner ? `
          <label class="sv2-club-detail__edit-banner" title="Change banner">
            📷
            <input type="file" accept="image/*" id="cdbBannerInput" style="display:none"/>
          </label>` : ''}
          <div class="sv2-club-detail__logo" style="${club.logoB64
            ? `background:url('${club.logoB64}') center/cover;border:2px solid ${color}44`
            : `background:${color}22;border:2px solid ${color}44`}">
            ${club.logoB64 ? '' : `<span style="font-size:2.8rem">${icon}</span>`}
            ${club.isOwner ? `
            <label class="sv2-club-detail__edit-logo" title="Change logo">
              ✏️
              <input type="file" accept="image/*" id="cdbLogoInput" style="display:none"/>
            </label>` : ''}
          </div>
        </div>

        <!-- Info -->
        <div class="sv2-club-detail__info">
          <h2 class="sv2-club-detail__name">${club.name}</h2>
          <div class="sv2-club-detail__meta">
            <span>${icon} ${club.sport.charAt(0).toUpperCase() + club.sport.slice(1)}</span>
            <span>👥 ${club.memberCount} member${club.memberCount !== 1 ? 's' : ''}</span>
            <span>🌐 Public</span>
            ${club.location ? `<span>📍 ${club.location}</span>` : ''}
          </div>
          ${club.description ? `<p class="sv2-club-detail__desc">${club.description}</p>` : ''}
          <div class="sv2-club-detail__actions">
            ${club.isOwner
            ? `<button class="sv2-club-action sv2-club-action--owner" disabled>👑 You own this club</button>`
            : `<button class="sv2-club-action ${club.joined ? 'sv2-club-action--leave' : 'sv2-club-action--join'}"
                  id="cdbJoin">${club.joined ? 'Leave club' : 'Join club'}</button>`}
          </div>
        </div>

        <!-- Feed -->
        <div class="sv2-club-detail__section-title">Club Feed</div>
        <div class="sv2-club-detail__feed">${feedHtml}</div>

        <!-- Members -->
        <div class="sv2-club-detail__section-title">Members (${club.memberCount})</div>
        <div class="sv2-club-detail__members">
          <div class="sv2-item" style="margin:0 16px">
            <div class="sv2-item__avatar">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
                <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
              </svg>
            </div>
            <div class="sv2-item__info">
              <span class="sv2-item__name">${localStorage.getItem('mapyou_userName') ?? 'You'}</span>
              <span class="sv2-item__sub">${club.isOwner ? '👑 Owner' : '👤 Member'}</span>
            </div>
          </div>
        </div>
      </div>`;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('sv2-club-detail-overlay--visible'));
        const close = () => {
            modal.classList.remove('sv2-club-detail-overlay--visible');
            setTimeout(() => modal.remove(), 320);
        };
        modal.querySelector('#cdbBack')?.addEventListener('click', close);
        // Banner upload
        modal.querySelector('#cdbBannerInput')?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = reader.result;
                const clubs = loadClubs();
                const c = clubs.find(x => x.id === club.id);
                if (c) {
                    c.bannerB64 = b64;
                    saveClubs(clubs);
                }
                const bannerEl = modal.querySelector('.sv2-club-detail__banner');
                if (bannerEl)
                    bannerEl.style.background = `url('${b64}') center/cover`;
            };
            reader.readAsDataURL(file);
        });
        // Logo upload
        modal.querySelector('#cdbLogoInput')?.addEventListener('change', e => {
            const file = e.target.files?.[0];
            if (!file)
                return;
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = reader.result;
                const clubs = loadClubs();
                const c = clubs.find(x => x.id === club.id);
                if (c) {
                    c.logoB64 = b64;
                    saveClubs(clubs);
                }
                const logoEl = modal.querySelector('.sv2-club-detail__logo');
                if (logoEl) {
                    logoEl.style.background = `url('${b64}') center/cover`;
                    logoEl.innerHTML = '';
                }
            };
            reader.readAsDataURL(file);
        });
        modal.querySelector('#cdbJoin')?.addEventListener('click', () => {
            const clubs = loadClubs();
            const c = clubs.find(x => x.id === club.id);
            if (!c)
                return;
            c.joined = !c.joined;
            c.memberCount = Math.max(0, c.memberCount + (c.joined ? 1 : -1));
            saveClubs(clubs);
            close();
        });
    }
    _openCreateClubModal(parentEl) {
        document.getElementById('createClubModal')?.remove();
        const userLoc = this._getUserLocation() ?? '';
        const modal = document.createElement('div');
        modal.id = 'createClubModal';
        modal.className = 'sv2-modal-overlay';
        modal.innerHTML = `
      <div class="sv2-modal">
        <div class="sv2-modal__header">
          <h3 class="sv2-modal__title">Create Club</h3>
          <button class="sv2-modal__close" id="ccClose">✕</button>
        </div>
        <div class="sv2-modal__body">
          <div class="sv2-modal__field">
            <label class="sv2-modal__label">Club Name *</label>
            <input class="sv2-modal__input" id="ccName" type="text" maxlength="50" placeholder="e.g. Morning Runners Gdańsk"/>
          </div>
          <div class="sv2-modal__field">
            <label class="sv2-modal__label">Sport</label>
            <select class="sv2-modal__input" id="ccSport">
              <option value="running">🏃 Running</option>
              <option value="cycling">🚴 Cycling</option>
              <option value="walking">🚶 Walking</option>
              <option value="hiking">🥾 Hiking</option>
              <option value="fitness">💪 Fitness</option>
              <option value="other">🏅 Other</option>
            </select>
          </div>
          <div class="sv2-modal__field">
            <label class="sv2-modal__label">Location</label>
            <input class="sv2-modal__input" id="ccLocation" type="text" maxlength="60"
              placeholder="City or region" value="${userLoc}"/>
          </div>
          <div class="sv2-modal__field">
            <label class="sv2-modal__label">Description <span style="opacity:.4">(optional)</span></label>
            <textarea class="sv2-modal__input sv2-modal__textarea" id="ccDesc" maxlength="200"
              placeholder="What is your club about?"></textarea>
          </div>
        </div>
        <div class="sv2-modal__footer">
          <button class="sv2-modal__btn sv2-modal__btn--cancel" id="ccCancel">Cancel</button>
          <button class="sv2-modal__btn sv2-modal__btn--save" id="ccSave">Create Club</button>
        </div>
      </div>`;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('sv2-modal-overlay--visible'));
        const close = () => {
            modal.classList.remove('sv2-modal-overlay--visible');
            setTimeout(() => modal.remove(), 280);
        };
        modal.querySelector('#ccClose')?.addEventListener('click', close);
        modal.querySelector('#ccCancel')?.addEventListener('click', close);
        modal.addEventListener('click', e => { if (e.target === modal)
            close(); });
        // Auto-fill region from city via Nominatim (OpenStreetMap, no API key needed)
        let _nominatimTimer;
        modal.querySelector('#ccLocation')?.addEventListener('input', e => {
            const cityVal = e.target.value.trim();
            const regionEl = modal.querySelector('#ccRegion');
            if (!regionEl)
                return;
            clearTimeout(_nominatimTimer);
            if (cityVal.length < 3) {
                regionEl.value = '';
                return;
            }
            _nominatimTimer = setTimeout(async () => {
                try {
                    const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityVal)}&format=json&limit=1&addressdetails=1`, { headers: { 'Accept-Language': 'en' } });
                    const data = await res.json();
                    const addr = data[0]?.address;
                    if (addr)
                        regionEl.value = addr.state ?? addr.county ?? '';
                }
                catch { /* offline */ }
            }, 600);
        });
        modal.querySelector('#ccSave')?.addEventListener('click', () => {
            const name = (modal.querySelector('#ccName')?.value ?? '').trim();
            if (!name) {
                modal.querySelector('#ccName')?.focus();
                return;
            }
            const myUserId = getUserId();
            const city = (modal.querySelector('#ccLocation')?.value ?? '').trim();
            const region = (modal.querySelector('#ccRegion')?.value ?? '').trim();
            if (!city) {
                const inp = modal.querySelector('#ccLocation');
                inp?.focus();
                inp?.classList.add('sv2-modal__input--error');
                return;
            }
            const clubId = `club_${Date.now()}`;
            const club = {
                id: clubId,
                name,
                sport: (modal.querySelector('#ccSport')?.value ?? 'other'),
                description: (modal.querySelector('#ccDesc')?.value ?? '').trim(),
                location: region ? `${city}, ${region}` : city,
                memberCount: 1,
                isOwner: true,
                joined: true,
                createdAt: Date.now(),
            };
            // Sync to backend
            fetch(`${BACKEND_URL}/clubs`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    clubId, ownerId: myUserId, name: club.name,
                    sport: club.sport, description: club.description,
                    city, region, members: [myUserId],
                }),
            }).catch(() => { });
            saveClubs([...loadClubs(), club]);
            close();
            this._renderClubs(parentEl);
        });
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    _getUserLocation() {
        // First try profile city (most accurate)
        const profileCity = localStorage.getItem('mapyou_city');
        if (profileCity)
            return profileCity;
        // Fallback to IP location
        try {
            const raw = localStorage.getItem('mapty_ip_coords') ?? localStorage.getItem('mapyou_last_city');
            if (!raw)
                return null;
            const parsed = JSON.parse(raw);
            return parsed?.city ?? parsed?.cityName ?? null;
        }
        catch {
            return null;
        }
    }
}
export const searchView = new SearchView();
//# sourceMappingURL=SearchView.js.map