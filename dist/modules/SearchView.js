// ─── SEARCH VIEW ──────────────────────────────────────────────────────────────
// src/modules/SearchView.ts
//
// Friends & Clubs search panel opened from Home via 🔍 button.
// Friends: search, invite, list (backend-ready placeholders)
// Clubs: create locally, search by name/location (backend-ready)
/* eslint-disable @typescript-eslint/no-explicit-any */
const LS_CLUBS = 'mapyou_local_clubs';
const LS_FRIENDS = 'mapyou_local_friends';
// ── Storage helpers ───────────────────────────────────────────────────────────
function loadClubs() {
    try {
        return JSON.parse(localStorage.getItem(LS_CLUBS) ?? '[]');
    }
    catch {
        return [];
    }
}
function saveClubs(clubs) {
    localStorage.setItem(LS_CLUBS, JSON.stringify(clubs));
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
        const friends = loadFriends();
        el.innerHTML = `
      <div class="sv2-search-wrap">
        <div class="sv2-search-row">
          <div class="sv2-search-box">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="sv2-search-icon">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
            </svg>
            <input class="sv2-search-input" id="sv2FriendSearch" type="text"
              placeholder="Search friends…" value="${this._friendQuery}" autocomplete="off"/>
          </div>
        </div>
      </div>

      ${friends.length === 0 ? `
        <div class="sv2-empty">
          <div class="sv2-empty__icon">👥</div>
          <p class="sv2-empty__title">No friends yet</p>
          <p class="sv2-empty__sub">Invite friends using your link from the Friends tab</p>
        </div>` : `
        <div class="sv2-section-title">Your Friends</div>
        <div class="sv2-list" id="sv2FriendList">
          ${friends.map(f => `
            <div class="sv2-item">
              <div class="sv2-item__avatar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="22" height="22">
                  <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
                </svg>
              </div>
              <div class="sv2-item__info">
                <span class="sv2-item__name">${f.name}</span>
                <span class="sv2-item__sub">📍 ${f.location || 'Unknown location'}</span>
              </div>
              <span class="sv2-badge sv2-badge--green">Following</span>
            </div>`).join('')}
        </div>`}

      <div class="sv2-section-title" style="margin-top:20px">Suggestions</div>
      <div class="sv2-backend-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Friend suggestions will appear here when the backend is ready.
      </div>

      <button class="sv2-invite-btn" id="sv2InviteBtn">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
          <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
          <polyline points="22,6 12,13 2,6"/>
        </svg>
        Invite Friends
      </button>`;
        // Search input
        el.querySelector('#sv2FriendSearch')?.addEventListener('input', e => {
            this._friendQuery = e.target.value;
        });
        // Invite btn — opens Friends tab
        el.querySelector('#sv2InviteBtn')?.addEventListener('click', () => {
            this.close();
            document.querySelector('.bottom-nav__item[data-tab="tabFriends"]')?.click();
        });
    }
    // ══════════════════════════════════════════════════════════════════════════
    // CLUBS TAB
    // ══════════════════════════════════════════════════════════════════════════
    _renderClubs(el) {
        const clubs = loadClubs();
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
        ${userLoc ? `<div class="sv2-location-pill">📍 Near ${userLoc}</div>` : ''}
      </div>

      ${clubs.length === 0 ? `
        <div class="sv2-empty">
          <div class="sv2-empty__icon">🚴</div>
          <p class="sv2-empty__title">No clubs yet</p>
          <p class="sv2-empty__sub">Create your own club or wait for the backend to connect to local clubs</p>
        </div>` : `
        <div class="sv2-section-title">Your Clubs</div>
        <div class="sv2-list" id="sv2ClubList">
          ${clubs.map(c => this._buildClubItem(c)).join('')}
        </div>`}

      <div class="sv2-section-title" style="margin-top:20px">Discover Clubs</div>
      <div class="sv2-backend-note">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="18" height="18">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Local club discovery will be available when the backend launches.
      </div>`;
        // Search
        el.querySelector('#sv2ClubSearch')?.addEventListener('input', e => {
            this._clubQuery = e.target.value.toLowerCase();
            const list = el.querySelector('#sv2ClubList');
            if (!list)
                return;
            list.querySelectorAll('.sv2-item').forEach(item => {
                const name = item.querySelector('.sv2-item__name')?.textContent?.toLowerCase() ?? '';
                const loc = item.querySelector('.sv2-item__sub')?.textContent?.toLowerCase() ?? '';
                item.style.display = name.includes(this._clubQuery) || loc.includes(this._clubQuery) ? '' : 'none';
            });
        });
        // Create club
        el.querySelector('#sv2CreateClub')?.addEventListener('click', () => {
            this._openCreateClubModal(el);
        });
        // Club actions
        el.querySelectorAll('[data-club-join]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.clubJoin;
                const clubs = loadClubs();
                const club = clubs.find(c => c.id === id);
                if (!club)
                    return;
                club.joined = !club.joined;
                if (club.joined)
                    club.memberCount++;
                else
                    club.memberCount = Math.max(0, club.memberCount - 1);
                saveClubs(clubs);
                this._renderClubs(el);
            });
        });
        el.querySelectorAll('[data-club-del]').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.clubDel;
                if (!confirm('Delete this club?'))
                    return;
                saveClubs(loadClubs().filter(c => c.id !== id));
                this._renderClubs(el);
            });
        });
    }
    _buildClubItem(c) {
        const sportIcons = {
            running: '🏃', walking: '🚶', cycling: '🚴', fitness: '💪', hiking: '🥾', other: '🏅',
        };
        const icon = sportIcons[c.sport] ?? '🏅';
        return `
      <div class="sv2-item sv2-item--club">
        <div class="sv2-item__avatar sv2-item__avatar--club">
          <span style="font-size:1.6rem">${icon}</span>
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
        modal.querySelector('#ccSave')?.addEventListener('click', () => {
            const name = (modal.querySelector('#ccName')?.value ?? '').trim();
            if (!name) {
                modal.querySelector('#ccName')?.focus();
                return;
            }
            const club = {
                id: `club_${Date.now()}`,
                name,
                sport: (modal.querySelector('#ccSport')?.value ?? 'other'),
                description: (modal.querySelector('#ccDesc')?.value ?? '').trim(),
                location: (modal.querySelector('#ccLocation')?.value ?? '').trim(),
                memberCount: 1,
                isOwner: true,
                joined: true,
                createdAt: Date.now(),
            };
            saveClubs([...loadClubs(), club]);
            close();
            this._renderClubs(parentEl);
        });
    }
    // ── Helpers ───────────────────────────────────────────────────────────────
    _getUserLocation() {
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