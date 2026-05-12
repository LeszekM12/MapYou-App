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
const LS_PENDING_CLUBS = 'mapyou_pending_clubs'; // clubIds user has requested to join
// ── Storage helpers ───────────────────────────────────────────────────────────
export function loadClubs() {
    try {
        return JSON.parse(localStorage.getItem(LS_CLUBS) ?? '[]');
    }
    catch {
        return [];
    }
}
export function getPendingClubs() {
    try {
        return JSON.parse(localStorage.getItem(LS_PENDING_CLUBS) ?? '[]');
    }
    catch {
        return [];
    }
}
export function addPendingClub(clubId) {
    const p = getPendingClubs();
    if (!p.includes(clubId)) {
        p.push(clubId);
        localStorage.setItem(LS_PENDING_CLUBS, JSON.stringify(p));
    }
}
export function removePendingClub(clubId) {
    localStorage.setItem(LS_PENDING_CLUBS, JSON.stringify(getPendingClubs().filter(id => id !== clubId)));
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
          <button class="sv2-tab ${this._tab === 'friends' ? 'sv2-tab--active' : ''}" data-sv2="friends">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
              <circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
            </svg>
            Friends
          </button>
          <button class="sv2-tab ${this._tab === 'clubs' ? 'sv2-tab--active' : ''}" data-sv2="clubs">
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
          ${(() => {
            const ov = localStorage.getItem('mapyou_search_city');
            if (ov !== null)
                return ov ? `📍 Near ${ov} ▾` : '🌍 All locations ▾';
            return userLoc ? `📍 Near ${userLoc} ▾` : '📍 Set location ▾';
        })()}
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
                  <span class="sv2-item__sub">${c.members.length} member${c.members.length !== 1 ? 's' : ''} · ${[c.city, c['region']].filter(Boolean).join(', ')}</span>
                  ${c.description ? `<span class="sv2-item__desc">${c.description.slice(0, 60)}</span>` : ''}
                </div>
                <button class="sv2-badge ${isMember ? 'sv2-badge--gray' : 'sv2-badge--green'}"
                  data-club-join="${c.clubId}">${isMember ? 'Joined'
                    : getPendingClubs().includes(c.clubId) ? 'Pending'
                        : c.isPrivate ? 'Request'
                            : 'Join'}</button>
              </div>`;
            }).join('')}
        </div>`;
            // Open club detail on click
            resultsEl.querySelectorAll('.sv2-item[data-club-id]').forEach(item => {
                item.addEventListener('click', e => {
                    if (e.target.closest('[data-club-join]'))
                        return;
                    const cid = item.dataset.clubId;
                    const clubData = clubs.find(c => c.clubId === cid);
                    if (!clubData)
                        return;
                    const myUserId = getUserId();
                    // Convert backend club to LocalClub for detail view
                    const localClub = {
                        id: clubData.clubId,
                        name: clubData.name,
                        sport: clubData.sport,
                        description: clubData.description,
                        location: [clubData.city, clubData.region].filter(Boolean).join(', '),
                        memberCount: clubData.members.length,
                        isOwner: clubData.members[0] === myUserId,
                        joined: clubData.members.includes(myUserId),
                        createdAt: Date.now(),
                        feed: [],
                        logoB64: clubData.avatarB64 ?? undefined,
                    };
                    this._openClubDetail(localClub);
                });
            });
            // Join/Leave
            resultsEl.querySelectorAll('[data-club-join]').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation();
                    const cid = btn.dataset.clubJoin;
                    const curText = btn.textContent?.trim() ?? '';
                    const joined = curText === 'Joined';
                    const pending = curText === 'Pending';
                    const clubData = clubs.find(c => c.clubId === cid);
                    const isPrivate = !!clubData?.isPrivate;
                    if (pending) {
                        // Cancel request
                        await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(cid)}/cancel-request`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: myUserId }),
                        });
                        removePendingClub(cid);
                        btn.textContent = isPrivate ? 'Request' : 'Join';
                        btn.className = 'sv2-badge sv2-badge--green';
                        return;
                    }
                    if (joined) {
                        // Leave
                        await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(cid)}/leave`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: myUserId }),
                        });
                        btn.textContent = isPrivate ? 'Request' : 'Join';
                        btn.className = 'sv2-badge sv2-badge--green';
                        removePendingClub(cid);
                    }
                    else if (isPrivate) {
                        // Send join request
                        await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(cid)}/request`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: myUserId }),
                        });
                        addPendingClub(cid);
                        btn.textContent = 'Pending';
                        btn.className = 'sv2-badge sv2-badge--gray';
                    }
                    else {
                        // Join public
                        await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(cid)}/join`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ userId: myUserId }),
                        });
                        btn.textContent = 'Joined';
                        btn.className = 'sv2-badge sv2-badge--gray';
                    }
                    // Update member count in card
                    const subEl = btn.closest('.sv2-item')?.querySelector('.sv2-item__sub');
                    if (subEl) {
                        const m = subEl.textContent?.match(/(\d+) member/);
                        if (m) {
                            const n = joined ? Math.max(0, Number(m[1]) - 1) : Number(m[1]) + 1;
                            subEl.textContent = subEl.textContent.replace(m[0], n + ' member' + (n !== 1 ? 's' : ''));
                        }
                    }
                    // Sync local club list for PostModal/SaveActivityModal
                    const localClubs = loadClubs();
                    const existing = localClubs.find(lc => lc.id === cid);
                    if (!existing && !joined) {
                        const cd = clubs.find(c => c.clubId === cid);
                        if (cd) {
                            localClubs.push({ id: cid, name: cd.name, sport: cd.sport,
                                description: cd.description,
                                location: [cd.city, cd.region ?? ''].filter(Boolean).join(', '),
                                memberCount: cd.members.length + 1, isOwner: false, joined: true,
                                createdAt: Date.now(), feed: [] });
                            saveClubs(localClubs);
                        }
                    }
                    else if (existing && joined) {
                        existing.joined = false;
                        saveClubs(localClubs);
                    }
                });
            });
        };
        const userRegion = localStorage.getItem('mapyou_region') ?? '';
        const loadNearby = async () => {
            resultsEl.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">Loading…</div>';
            try {
                // Read fresh every time so location changes take effect
                const override = localStorage.getItem('mapyou_search_city');
                let label = '';
                let url = `${BACKEND_URL}/clubs`;
                if (override !== null) {
                    if (override.trim()) {
                        label = override.trim();
                        url = `${BACKEND_URL}/clubs?city=${encodeURIComponent(override.trim())}`;
                    }
                    // override === '' means show all
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
        // My Clubs — fetch from backend for fresh data (logo, memberCount, etc.)
        const mySection = document.createElement('div');
        mySection.id = 'sv2MyClubsSection';
        resultsEl.insertAdjacentElement('beforebegin', mySection);
        const renderMyClubs = (backendClubs) => {
            const sportIcons = { running: '🏃', walking: '🚶', cycling: '🚴', fitness: '💪', hiking: '🥾', other: '🏅' };
            const myClubIds = new Set(loadClubs().filter(c => c.joined || c.isOwner).map(c => c.id));
            const mine = backendClubs.filter(c => myClubIds.has(c.clubId) || c.ownerId === myUserId || c.members.includes(myUserId));
            if (!mine.length) {
                mySection.innerHTML = '';
                return;
            }
            mySection.innerHTML = `
        <div class="sv2-section-title">My Clubs</div>
        <div class="sv2-list">
          ${mine.map(c => {
                const icon = sportIcons[c.sport] ?? '🏅';
                const isOwner = c.ownerId === myUserId;
                return `<div class="sv2-item" data-my-club-id="${c.clubId}" style="cursor:pointer">
              <div class="sv2-item__avatar sv2-item__avatar--club">
                ${c.avatarB64 ? `<img src="${c.avatarB64}" style="width:100%;height:100%;object-fit:cover;border-radius:14px"/>` : `<span style="font-size:24px">${icon}</span>`}
              </div>
              <div class="sv2-item__info">
                <span class="sv2-item__name">${c.name}</span>
                <span class="sv2-item__sub">${c.members.length} members · ${[c.city, c.region].filter(Boolean).join(', ')}</span>
              </div>
              <span class="sv2-badge sv2-badge--gray">${isOwner ? 'Owner' : 'Joined'}</span>
            </div>`;
            }).join('')}
        </div>`;
            mySection.querySelectorAll('[data-my-club-id]').forEach(item => {
                item.addEventListener('click', () => {
                    const cid = item.dataset.myClubId;
                    const cd = mine.find(c => c.clubId === cid);
                    if (!cd)
                        return;
                    const localClub = {
                        id: cd.clubId, name: cd.name, sport: cd.sport, description: cd.description,
                        location: [cd.city, cd.region ?? ''].filter(Boolean).join(', '),
                        memberCount: cd.members.length, isOwner: cd.ownerId === myUserId,
                        joined: cd.members.includes(myUserId), createdAt: Date.now(),
                        logoB64: cd.avatarB64 ?? undefined, feed: [],
                    };
                    localClub.isPrivate = cd.isPrivate ?? false;
                    this._openClubDetail(localClub);
                });
            });
        };
        // Load backend clubs — used for both My Clubs and Nearby
        void (async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/clubs`, { cache: 'no-store' });
                const data = await res.json();
                if (data.status === 'ok') {
                    renderMyClubs(data.data);
                }
            }
            catch { /* offline */ }
        })();
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
        const sportIcons = { running: '🏃', walking: '🚶', cycling: '🚴', fitness: '💪', hiking: '🥾', other: '🏅' };
        const icon = sportIcons[club.sport] ?? '🏅';
        const color = club.sport === 'cycling' ? '#ffb545' : club.sport === 'running' ? '#00c46a' : '#5badea';
        const myUserId = getUserId();
        const modal = document.createElement('div');
        modal.id = 'clubDetailModal';
        modal.className = 'sv2-club-detail-overlay';
        // Fetch fresh club data from backend (to get isPrivate, memberCount, avatarB64)
        void fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}`, { cache: 'no-store' })
            .then(r => r.json())
            .then((d) => {
            if (d.status === 'ok' && d.data) {
                const fresh = d.data;
                if (fresh.isPrivate !== undefined)
                    club.isPrivate = fresh.isPrivate;
                if (fresh.members)
                    club.memberCount = fresh.members.length;
                if (fresh.avatarB64)
                    club.logoB64 = fresh.avatarB64;
                if (fresh.bannerUrl)
                    club.bannerB64 = fresh.bannerUrl;
                // Check if user is member
                if (fresh.members)
                    club.joined = fresh.members.includes(myUserId);
                renderModal('feed');
            }
        }).catch(() => { });
        const renderModal = (tab = 'feed') => {
            const isMember = club.joined || club.isOwner;
            modal.innerHTML = `
        <div class="sv2-club-detail__banner" style="${club.bannerB64 ? `background:url('${club.bannerB64}') center/cover` : `background:linear-gradient(135deg,${color}33,${color}11)`}">
          <button class="sv2-club-detail__back" id="cdbBack">←</button>
          ${club.isOwner ? `<label class="sv2-club-detail__edit-banner" for="cdbBannerInput">📷 Edit</label><input type="file" accept="image/*" id="cdbBannerInput" style="display:none"/>` : ''}
          <div class="sv2-club-detail__logo" style="${club.logoB64 ? `background:url('${club.logoB64}') center/cover no-repeat;border:2px solid ${color}44` : `background:rgba(255,255,255,0.08)`}">
            ${club.logoB64 ? '' : `<span style="font-size:2.8rem">${icon}</span>`}
            ${club.isOwner ? `<label class="sv2-club-detail__edit-logo" for="cdbLogoInput">✏️</label><input type="file" accept="image/*" id="cdbLogoInput" style="display:none"/>` : ''}
          </div>
        </div>

        <div class="sv2-club-detail__info">
          <h2 class="sv2-club-detail__name">${club.name}</h2>
          <div class="sv2-club-detail__meta">
            <span>${icon} ${club.sport}</span>
            <span>👥 ${club.memberCount} members</span>
            <span>${club.isPrivate ? '🔒 Private' : '🌐 Public'}</span>
            <span>📍 ${club.location}</span>
          </div>
          <p class="sv2-club-detail__desc">${club.description || ''}</p>
        </div>

        <!-- Action buttons row — Strava style -->
        <div class="sv2-club-detail__action-row">
          ${club.isOwner ? `
            <button class="sv2-club-detail__action-btn" id="cdbPrivacy">
              <span>${club.isPrivate ? '🌐' : '🔒'}</span>
              <span>${club.isPrivate ? 'Public' : 'Private'}</span>
            </button>
            <button class="sv2-club-detail__action-btn" id="cdbShare">
              <span>🔗</span><span>Share</span>
            </button>
            <button class="sv2-club-detail__action-btn" id="cdbDelete" style="color:#f87171">
              <span>🗑</span><span>Delete</span>
            </button>` : `
            <button class="sv2-club-detail__action-btn ${isMember ? 'sv2-club-detail__action-btn--active' : ''}" id="cdbJoin">
              <span>${isMember ? '✓' : getPendingClubs().includes(club.id) ? '⏳' : '+'}</span>
              <span>${isMember ? 'Joined' : getPendingClubs().includes(club.id) ? 'Pending' : (club.isPrivate ? 'Request' : 'Join')}</span>
            </button>
            <button class="sv2-club-detail__action-btn" id="cdbShare">
              <span>🔗</span><span>Share</span>
            </button>`}
          <button class="sv2-club-detail__action-btn ${tab === 'feed' ? 'sv2-club-detail__action-btn--active' : ''}" id="cdbTabFeed">
            <span>📢</span><span>Feed</span>
          </button>
          <button class="sv2-club-detail__action-btn ${tab === 'members' ? 'sv2-club-detail__action-btn--active' : ''}" id="cdbTabMembers">
            <span>👥</span><span>Members</span>
          </button>
        </div>

        ${isMember ? `
        <div class="sv2-club-detail__actions" style="padding:0 16px 12px">
          <button class="sv2-club-action sv2-club-action--join" id="cdbAddPost">✏️ Add Post to Club</button>
        </div>` : ''}

        <!-- Feed tab -->
        <div id="cdbFeedSection" style="${tab === 'feed' ? '' : 'display:none'}">
          <div class="sv2-club-detail__section-title">CLUB FEED</div>
          <div class="sv2-club-detail__feed" id="cdbFeed">
            <div class="sv2-club-detail__feed-empty"><span>⏳</span><p>Loading…</p></div>
          </div>
        </div>

        <!-- Members + Stats tab -->
        <div id="cdbMembersSection" style="${tab === 'members' ? '' : 'display:none'}">
          <div class="sv2-club-detail__section-title">STATISTICS</div>
          <div id="cdbStats" style="padding:0 16px 8px;color:rgba(255,255,255,0.5);font-size:1.2rem">Loading…</div>
          <div class="sv2-club-detail__section-title">MEMBERS</div>
          <div class="sv2-club-detail__members" id="cdbMembers">
            <div style="padding:16px;color:rgba(255,255,255,0.3)">Loading…</div>
          </div>
          ${club.isOwner ? `
          <div class="sv2-club-detail__section-title" id="cdbPendingTitle" style="display:none">JOIN REQUESTS</div>
          <div id="cdbPending"></div>` : ''}
        </div>`;
            // Back
            modal.querySelector('#cdbBack')?.addEventListener('click', close);
            // Tab switching
            modal.querySelector('#cdbTabFeed')?.addEventListener('click', () => renderModal('feed'));
            modal.querySelector('#cdbTabMembers')?.addEventListener('click', () => {
                renderModal('members');
                loadMembersAndStats();
            });
            // Load feed if on feed tab
            if (tab === 'feed')
                loadFeed();
            if (tab === 'members')
                loadMembersAndStats();
            // Banner/logo upload
            const uploadToCloud = async (file) => {
                const { uploadMediaFile } = await import('./cloudSync.js');
                return (await uploadMediaFile(file, myUserId, 'activities'))?.url ?? null;
            };
            modal.querySelector('#cdbBannerInput')?.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file)
                    return;
                const url = await uploadToCloud(file);
                if (!url)
                    return;
                const clubs = loadClubs();
                const c = clubs.find(x => x.id === club.id);
                if (c) {
                    c.bannerB64 = url;
                    saveClubs(clubs);
                    club.bannerB64 = url;
                }
                await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bannerUrl: url }) });
                renderModal(tab);
            });
            modal.querySelector('#cdbLogoInput')?.addEventListener('change', async (e) => {
                const file = e.target.files?.[0];
                if (!file)
                    return;
                const url = await uploadToCloud(file);
                if (!url)
                    return;
                const clubs = loadClubs();
                const c = clubs.find(x => x.id === club.id);
                if (c) {
                    c.logoB64 = url;
                    saveClubs(clubs);
                    club.logoB64 = url;
                }
                await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatarB64: url }) });
                renderModal(tab);
            });
            // Join / Request
            modal.querySelector('#cdbJoin')?.addEventListener('click', async () => {
                const isPrivate = !!club.isPrivate;
                if (club.joined) {
                    await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/leave`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUserId }) });
                    club.joined = false;
                    club.memberCount = Math.max(0, club.memberCount - 1);
                    removePendingClub(club.id);
                    const lcs2 = loadClubs();
                    const lc2 = lcs2.find(c => c.id === club.id);
                    if (lc2) {
                        lc2.joined = false;
                        lc2.memberCount = club.memberCount;
                        saveClubs(lcs2);
                    }
                }
                else if (isPrivate) {
                    await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/request`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUserId }) });
                    addPendingClub(club.id);
                    renderModal(tab);
                    return;
                }
                else {
                    await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/join`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: myUserId }) });
                    club.joined = true;
                    club.memberCount++;
                    const lcs = loadClubs();
                    const lc = lcs.find(c => c.id === club.id);
                    if (lc) {
                        lc.joined = true;
                        lc.memberCount++;
                        saveClubs(lcs);
                    }
                    else {
                        loadClubs();
                        saveClubs([...loadClubs(), { ...club }]);
                    }
                }
                renderModal(tab);
            });
            // Privacy toggle
            modal.querySelector('#cdbPrivacy')?.addEventListener('click', async () => {
                const nowPrivate = !club.isPrivate;
                club.isPrivate = nowPrivate;
                const lcs = loadClubs();
                const lc = lcs.find(c => c.id === club.id);
                if (lc) {
                    lc.isPrivate = nowPrivate;
                    saveClubs(lcs);
                }
                await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isPrivate: nowPrivate }) });
                renderModal(tab);
            });
            // Share
            modal.querySelector('#cdbShare')?.addEventListener('click', async () => {
                try {
                    const res = await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/invite`, { method: 'POST' });
                    const data = await res.json();
                    if (data.status !== 'ok')
                        throw new Error('Failed');
                    const link = `${window.location.href.split('#')[0]}#club=${data.code}`;
                    if (navigator.share) {
                        await navigator.share({ title: `Join ${club.name} on MapYou`, url: link });
                    }
                    else {
                        await navigator.clipboard.writeText(link);
                        const btn = modal.querySelector('#cdbShare');
                        if (btn) {
                            btn.querySelectorAll('span')[0].textContent = '✓';
                            setTimeout(() => btn.querySelectorAll('span')[0].textContent = '🔗', 2000);
                        }
                    }
                }
                catch { /* ignore */ }
            });
            // Delete
            modal.querySelector('#cdbDelete')?.addEventListener('click', async () => {
                if (!confirm(`Delete "${club.name}"?`))
                    return;
                await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}`, { method: 'DELETE' });
                saveClubs(loadClubs().filter(c => c.id !== club.id));
                close();
            });
            // Add Post — lower z-index so PostModal appears on top
            modal.querySelector('#cdbAddPost')?.addEventListener('click', () => {
                modal.style.zIndex = '4999';
                import('./PostModal.js').then(m => {
                    m.openPostModal(post => {
                        post.clubIds = [club.id];
                        import('./cloudSync.js').then(cs => {
                            void cs.CS.savePost(post).then(() => { loadFeed(); });
                        });
                    });
                    // Restore z-index when PostModal closes
                    const watcher = setInterval(() => {
                        if (!document.querySelector('.pm-overlay--visible, .pm-overlay') || document.querySelector('.pm-overlay')?.classList.contains('pm-overlay--hidden')) {
                            clearInterval(watcher);
                            setTimeout(() => { modal.style.zIndex = ''; }, 400);
                        }
                    }, 300);
                });
            });
        }; // end renderModal
        const loadFeed = () => {
            const feedEl = modal.querySelector('#cdbFeed');
            if (!feedEl)
                return;
            fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/feed?requesterId=${encodeURIComponent(myUserId)}`, { cache: 'no-store' })
                .then(r => r.json())
                .then((data) => {
                if (!feedEl)
                    return;
                if (!data.data?.length) {
                    feedEl.innerHTML = '<div class="sv2-club-detail__feed-empty"><span>📢</span><p>No posts yet.</p><p class="sv2-club-detail__feed-sub">Share activities or posts to see them here.</p></div>';
                    return;
                }
                feedEl.innerHTML = data.data.map(f => {
                    const d = f.data;
                    if (f.kind === 'request') {
                        return `<div class="sv2-club-feed-item" style="border:1.5px solid rgba(0,196,106,0.3);background:rgba(0,196,106,0.06)">
                <div class="sv2-club-feed-item__top">
                  <span class="sv2-club-feed-item__author">🔔 Join Request</span>
                  <span class="sv2-club-feed-item__date">now</span>
                </div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
                  <div data-profile-uid="${d.userId}" style="width:36px;height:36px;border-radius:50%;overflow:hidden;background:#444;flex-shrink:0;cursor:pointer">
                    ${d.avatarB64 ? `<img src="${d.avatarB64}" style="width:100%;height:100%;object-fit:cover"/>` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700;color:#fff">${d.authorName[0]}</div>`}
                  </div>
                  <span data-profile-uid="${d.userId}" style="flex:1;font-weight:700;color:#fff;cursor:pointer">${d.authorName}</span>
                  <button data-feed-approve="${d.userId}" style="background:#00c46a;border:none;color:#fff;border-radius:8px;padding:6px 14px;font-size:1.1rem;cursor:pointer;font-family:inherit;font-weight:700">Accept</button>
                  <button data-feed-reject="${d.userId}" style="background:rgba(248,113,113,0.12);border:1.5px solid #f87171;color:#f87171;border-radius:8px;padding:6px 14px;font-size:1.1rem;cursor:pointer;font-family:inherit;font-weight:700;margin-left:6px">Decline</button>
                </div>
              </div>`;
                    }
                    return `<div class="sv2-club-feed-item">
              <div class="sv2-club-feed-item__top">
                <span class="sv2-club-feed-item__author">${d.authorName ?? ''}</span>
                <span class="sv2-club-feed-item__date">${new Date(f.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}</span>
              </div>
              <div class="sv2-club-feed-item__title">${d.name ?? d.title ?? ''}</div>
              ${d.distanceKm ? `<div class="sv2-club-feed-item__stats"><span>${d.distanceKm.toFixed(2)} km</span>${d.durationSec ? `<span>${Math.floor(d.durationSec / 60)}m</span>` : ''}</div>` : ''}
              ${d.photoUrl && d.mediaType !== 'video' ? `<img src="${d.photoUrl}" style="width:100%;border-radius:10px;margin-top:8px;object-fit:cover;max-height:200px" onerror="this.style.display='none'"/>` : ''}
            </div>`;
                }).join('');
                // Approve/reject from feed
                feedEl.querySelectorAll('[data-feed-approve]').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/approve/${encodeURIComponent(btn.dataset.feedApprove)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: myUserId }) });
                        loadFeed();
                    });
                });
                feedEl.querySelectorAll('[data-feed-reject]').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/reject/${encodeURIComponent(btn.dataset.feedReject)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: myUserId }) });
                        loadFeed();
                    });
                });
                // Profile click on request cards
                feedEl.querySelectorAll('[data-profile-uid]').forEach(el => {
                    el.addEventListener('click', () => {
                        const uid = el.dataset.profileUid;
                        modal.style.zIndex = '4999';
                        import('./PublicProfile.js').then(m => {
                            m.openPublicProfile(uid);
                            const w = setInterval(() => {
                                if (!document.querySelector('.pv-overlay--visible')) {
                                    clearInterval(w);
                                    modal.style.zIndex = '';
                                }
                            }, 300);
                        });
                    });
                });
            }).catch(() => { const feedEl2 = modal.querySelector('#cdbFeed'); if (feedEl2)
                feedEl2.innerHTML = '<div class="sv2-club-detail__feed-empty"><span>📡</span><p>Offline</p></div>'; });
        };
        const loadMembersAndStats = async () => {
            // Stats
            fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/stats`, { cache: 'no-store' })
                .then(r => r.json())
                .then((data) => {
                const statsEl = modal.querySelector('#cdbStats');
                if (!statsEl)
                    return;
                statsEl.innerHTML = `
            <div style="display:flex;gap:16px;flex-wrap:wrap;padding:4px 0 12px">
              <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:10px 16px;flex:1;min-width:120px">
                <div style="font-size:2rem;font-weight:800;color:#fff">${data.totalKm.toFixed(1)}</div>
                <div style="font-size:1.1rem;color:rgba(255,255,255,0.4)">Total km</div>
              </div>
              <div style="background:rgba(255,255,255,0.05);border-radius:12px;padding:10px 16px;flex:1;min-width:120px">
                <div style="font-size:2rem;font-weight:800;color:#fff">${data.activities}</div>
                <div style="font-size:1.1rem;color:rgba(255,255,255,0.4)">Activities</div>
              </div>
            </div>
            <div style="padding:4px 0 8px">
              ${data.ranking.slice(0, 10).map((r, i) => `
                <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                  <span style="font-size:1.3rem;font-weight:700;color:rgba(255,255,255,0.4);width:20px">${i + 1}</span>
                  <div style="width:32px;height:32px;border-radius:50%;overflow:hidden;background:#333;flex-shrink:0">
                    ${r.avatarB64 ? `<img src="${r.avatarB64}" style="width:100%;height:100%;object-fit:cover"/>` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:#fff">${r.name[0]}</div>`}
                  </div>
                  <span style="flex:1;font-size:1.3rem;color:#fff">${r.name}</span>
                  <span style="font-size:1.3rem;font-weight:700;color:#00c46a">${r.km.toFixed(1)} km</span>
                </div>`).join('')}
            </div>`;
            }).catch(() => { });
            // Members
            fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/members`, { cache: 'no-store' })
                .then(r => r.json())
                .then(async (data) => {
                const membersEl = modal.querySelector('#cdbMembers');
                if (!membersEl)
                    return;
                membersEl.innerHTML = data.data.map(u => `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
              <div style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:#333;flex-shrink:0">
                ${u.avatarB64 ? `<img src="${u.avatarB64}" style="width:100%;height:100%;object-fit:cover"/>` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff">${u.name[0]}</div>`}
              </div>
              <div style="flex:1">
                <div style="font-size:1.35rem;font-weight:700;color:#fff">${u.name}</div>
                ${u.userId === data.ownerId ? '<div style="font-size:1.1rem;color:#00c46a">👑 Owner</div>' : '<div style="font-size:1.1rem;color:rgba(255,255,255,0.4)">Member</div>'}
              </div>
            </div>`).join('');
                // Pending requests (owner only)
                if (club.isOwner && data.pendingMembers?.length) {
                    const pendingTitle = modal.querySelector('#cdbPendingTitle');
                    const pendingEl = modal.querySelector('#cdbPending');
                    if (pendingTitle)
                        pendingTitle.style.display = '';
                    if (pendingEl) {
                        // Fetch user details for pending members
                        const pendingUsers = await Promise.all(data.pendingMembers.map(uid => fetch(`${BACKEND_URL}/users/${encodeURIComponent(uid)}`, { cache: 'no-store' })
                            .then(r => r.json())
                            .then((d) => d.data ?? { userId: uid, name: uid.slice(0, 10) + '…', avatarB64: null })
                            .catch(() => ({ userId: uid, name: uid.slice(0, 10) + '…', avatarB64: null }))));
                        pendingEl.innerHTML = pendingUsers.map(u => `
                <div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,0.05)">
                  <div data-open-profile="${u.userId}" style="width:40px;height:40px;border-radius:50%;overflow:hidden;background:#444;flex-shrink:0;cursor:pointer">
                    ${u.avatarB64
                            ? `<img src="${u.avatarB64}" style="width:100%;height:100%;object-fit:cover"/>`
                            : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:700;color:#fff">${u.name[0]}</div>`}
                  </div>
                  <span data-open-profile="${u.userId}" style="flex:1;font-size:1.3rem;font-weight:600;color:#fff;cursor:pointer">${u.name}</span>
                  <button style="background:#00c46a;border:none;color:#fff;border-radius:8px;padding:7px 14px;font-size:1.2rem;cursor:pointer;font-family:inherit;margin-right:6px;font-weight:700" data-approve="${u.userId}">Accept</button>
                  <button style="background:rgba(248,113,113,0.12);border:1.5px solid #f87171;color:#f87171;border-radius:8px;padding:7px 14px;font-size:1.2rem;cursor:pointer;font-family:inherit;font-weight:700" data-reject="${u.userId}">Decline</button>
                </div>`).join('');
                        // Profile click
                        pendingEl.querySelectorAll('[data-open-profile]').forEach(el => {
                            el.addEventListener('click', () => {
                                const uid = el.dataset.openProfile;
                                modal.style.zIndex = '4999';
                                import('./PublicProfile.js').then(m => {
                                    m.openPublicProfile(uid);
                                    const w = setInterval(() => {
                                        if (!document.querySelector('.pv-overlay--visible')) {
                                            clearInterval(w);
                                            modal.style.zIndex = '';
                                        }
                                    }, 300);
                                });
                            });
                        });
                        pendingEl.querySelectorAll('[data-approve]').forEach(btn => {
                            btn.addEventListener('click', async () => {
                                await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/approve/${encodeURIComponent(btn.dataset.approve)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: myUserId }) });
                                removePendingClub(club.id);
                                club.memberCount++;
                                loadMembersAndStats();
                            });
                        });
                        pendingEl.querySelectorAll('[data-reject]').forEach(btn => {
                            btn.addEventListener('click', async () => {
                                await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(club.id)}/reject/${encodeURIComponent(btn.dataset.reject)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerId: myUserId }) });
                                loadMembersAndStats();
                            });
                        });
                    }
                }
            }).catch(() => { });
        };
        const close = () => {
            modal.classList.remove('sv2-club-detail-overlay--visible');
            setTimeout(() => modal.remove(), 300);
        };
        // Show loading state first, then render after fresh data arrives
        modal.innerHTML = '<div style="padding:40px;text-align:center;color:rgba(255,255,255,0.3)">Loading…</div>';
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('sv2-club-detail-overlay--visible'));
        // renderModal is called by the fresh-fetch callback above
        // Fallback: if fetch fails or takes too long, render anyway after 1s
        setTimeout(() => { if (!modal.querySelector('.sv2-club-detail__action-row'))
            renderModal('feed'); }, 1000);
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
            <label class="sv2-modal__label">City <span style="color:#ef4444">*</span></label>
            <input class="sv2-modal__input" id="ccLocation" type="text" maxlength="60"
              placeholder="e.g. Elbląg" value="${userLoc}"/>
          </div>
          <div class="sv2-modal__field">
            <label class="sv2-modal__label">Region
              <span style="opacity:.4;font-size:1rem">(auto-filled, editable)</span>
            </label>
            <input class="sv2-modal__input" id="ccRegion" type="text" maxlength="80"
              placeholder="e.g. Warmian-Masurian"/>
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