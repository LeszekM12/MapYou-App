// ─── FRIENDS VIEW ────────────────────────────────────────────────────────────
// src/modules/FriendsView.ts
//
// Zarządza zakładką Friends:
//   - lista znajomych z przyciskiem "Watch live"
//   - dodawanie znajomych przez link lub QR
//   - live mapa wbudowana w zakładkę
//   - polling statusu znajomych co 30s
import { getAllFriends, addFriend, deleteFriend, updateFriendLiveToken, generateInviteLink, fetchInviteByCode, parseInviteLink, checkInviteInUrl, } from './FriendsDB.js';
import { LiveMap } from './LiveMap.js';
import { BACKEND_URL } from '../config.js';
import { getUserName } from './LiveTracker.js';
// ── Stałe ─────────────────────────────────────────────────────────────────────
const STATUS_POLL_MS = 30000; // sprawdzaj status znajomych co 30s
// ── FriendsView class ─────────────────────────────────────────────────────────
export class FriendsView {
    constructor() {
        Object.defineProperty(this, "_liveMap", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new LiveMap()
        });
        Object.defineProperty(this, "_pollTimer", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_watchingId", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        }); // id znajomego którego oglądamy
    }
    // ── Init ───────────────────────────────────────────────────────────────────
    init() {
        // Sprawdź czy URL zawiera #invite= (ktoś wysłał link zaproszenia)
        const inviteCode = checkInviteInUrl();
        if (inviteCode) {
            history.replaceState(null, '', window.location.pathname);
            setTimeout(async () => {
                // Spróbuj pobrać z backendu (krótki kod)
                const inv = await fetchInviteByCode(inviteCode, BACKEND_URL);
                if (inv) {
                    this._showAddFriendModal(inv.name, inv.pushSub);
                }
                else {
                    // Fallback — stary base64 format
                    const parsed = parseInviteLink(`#invite=${inviteCode}`);
                    if (parsed)
                        this._showAddFriendModal(parsed.name, parsed.pushSub);
                }
            }, 500);
        }
        // Sprawdź czy URL zawiera #live= (oglądanie trasy)
        const hash = window.location.hash;
        if (hash.startsWith('#live=')) {
            const token = hash.replace('#live=', '');
            setTimeout(() => this._openLiveView(token, 'Live Tracking'), 500);
            history.replaceState(null, '', window.location.pathname);
        }
        // Inicjalizuj mapę w kontenerze
        const mapContainer = document.getElementById('friendsLiveMapContainer');
        if (mapContainer) {
            this._liveMap.init(mapContainer, (data) => this._onLiveUpdate(data));
        }
        // Podpnij przyciski
        document.getElementById('btnShareMyLink')?.addEventListener('click', () => this._shareMyLink());
        document.getElementById('btnAddFriend')?.addEventListener('click', () => this._showAddFriendModal());
        document.getElementById('btnScanQR')?.addEventListener('click', () => this._scanQR());
        document.getElementById('btnCloseLiveView')?.addEventListener('click', () => this._closeLiveView());
        // Renderuj listę
        void this.render();
        // Polling statusu znajomych
        this._pollTimer = setInterval(() => void this._pollFriendsStatus(), STATUS_POLL_MS);
        // Odbieraj wiadomości z Service Workera (po kliknięciu powiadomienia)
        navigator.serviceWorker.addEventListener('message', (e) => {
            if (e.data?.type === 'OPEN_LIVE') {
                void this._handleLivePushUrl(e.data.url);
            }
        });
    }
    destroy() {
        if (this._pollTimer)
            clearInterval(this._pollTimer);
        this._liveMap.stop();
    }
    // ── Render friends list ────────────────────────────────────────────────────
    async render() {
        const friends = await getAllFriends();
        const list = document.getElementById('friendsList');
        if (!list)
            return;
        if (friends.length === 0) {
            list.innerHTML = `
        <div class="friends-empty">
          <span class="friends-empty__icon">👥</span>
          <p>No friends yet.<br>Share your invite link to get started!</p>
        </div>`;
            return;
        }
        list.innerHTML = friends.map(f => this._buildFriendCard(f)).join('');
        // Podpnij przyciski
        list.querySelectorAll('[data-watch]').forEach(btn => {
            btn.addEventListener('click', () => {
                const token = btn.dataset.watch;
                const name = btn.dataset.name;
                this._openLiveView(token, name);
            });
        });
        list.querySelectorAll('[data-delete]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = Number(btn.dataset.delete);
                if (confirm('Remove this friend?')) {
                    await deleteFriend(id);
                    void this.render();
                }
            });
        });
    }
    _buildFriendCard(f) {
        const isLive = !!f.liveToken;
        const lastSeen = f.lastSeen
            ? new Date(f.lastSeen).toLocaleDateString('en', { month: 'short', day: 'numeric' })
            : 'Never';
        return `
    <div class="friend-card ${isLive ? 'friend-card--live' : ''}">
      <div class="friend-card__avatar">${f.name.charAt(0).toUpperCase()}</div>
      <div class="friend-card__info">
        <div class="friend-card__name">
          ${f.name}
          ${isLive ? '<span class="friend-card__live-badge">● LIVE</span>' : ''}
        </div>
        <div class="friend-card__meta">Last seen: ${lastSeen}</div>
      </div>
      <div class="friend-card__actions">
        ${isLive ? `
          <button class="friend-card__btn friend-card__btn--watch"
            data-watch="${f.liveToken}" data-name="${f.name}">
            👁 Watch
          </button>` : ''}
        <button class="friend-card__btn friend-card__btn--delete"
          data-delete="${f.id}">✕</button>
      </div>
    </div>`;
    }
    // ── Share my invite link ───────────────────────────────────────────────────
    async _shareMyLink() {
        // 1. Sprawdź czy push jest obsługiwany
        if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
            this._showToast('Push notifications not supported on this device');
            return;
        }
        // 2. Znajdź subskrypcję — przeszukaj WSZYSTKIE rejestracje SW
        let sub = null;
        try {
            const regs = await navigator.serviceWorker.getRegistrations();
            for (const reg of regs) {
                sub = await reg.pushManager.getSubscription();
                if (sub)
                    break;
            }
        }
        catch (err) {
            console.warn('[FriendsView] getSubscription error:', err);
        }
        // 3. Brak subskrypcji — poinformuj użytkownika
        if (!sub) {
            this._showToast('Enable notifications first in Settings ⚙️');
            return;
        }
        // 4. Wygeneruj KRÓTKI link przez backend (8 znaków zamiast 500)
        const name = getUserName();
        const subJson = sub.toJSON();
        this._showToast('Generating link... ⏳');
        let link;
        try {
            link = await generateInviteLink(name, subJson, BACKEND_URL);
        }
        catch {
            this._showToast('Failed to generate link — check connection');
            return;
        }
        // 5. Web Share API (natywny sheet na iOS/Android) lub clipboard fallback
        try {
            if (navigator.share) {
                await navigator.share({
                    title: `Add ${name} on MapYou`,
                    text: `${name} invited you to track their workouts live! 🏃`,
                    url: link,
                });
            }
            else {
                await navigator.clipboard.writeText(link);
                this._showToast('Invite link copied! 📋');
            }
        }
        catch (err) {
            if (err.name !== 'AbortError') {
                try {
                    await navigator.clipboard.writeText(link);
                    this._showToast('Invite link copied! 📋');
                }
                catch {
                    this._showToast('Could not share — try again');
                }
            }
        }
    }
    // ── Add friend modal ───────────────────────────────────────────────────────
    _showAddFriendModal(prefillName, prefillSub) {
        document.getElementById('addFriendModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'addFriendModal';
        modal.className = 'af-modal';
        modal.innerHTML = `
      <div class="af-modal__sheet">
        <div class="af-modal__handle"></div>
        <h2 class="af-modal__title">Add Friend</h2>

        ${prefillName ? `
          <div class="af-modal__prefill">
            <span class="af-modal__prefill-icon">👤</span>
            <span>Adding <strong>${prefillName}</strong> via invite link</span>
          </div>` : `
          <p class="af-modal__hint">Paste their invite link below:</p>
          <input class="af-modal__input" id="afLinkInput"
            type="text" placeholder="https://..." autocomplete="off"/>
        `}

        <div class="af-modal__actions">
          <button class="af-modal__btn af-modal__btn--cancel" id="afCancel">Cancel</button>
          <button class="af-modal__btn af-modal__btn--add" id="afAdd">
            ${prefillName ? `Add ${prefillName}` : 'Add Friend'}
          </button>
        </div>
      </div>`;
        document.body.appendChild(modal);
        requestAnimationFrame(() => modal.classList.add('af-modal--visible'));
        modal.querySelector('#afCancel')?.addEventListener('click', () => {
            modal.classList.remove('af-modal--visible');
            setTimeout(() => modal.remove(), 300);
        });
        modal.querySelector('#afAdd')?.addEventListener('click', async () => {
            let name = prefillName;
            let sub = prefillSub;
            if (!prefillSub) {
                const input = modal.querySelector('#afLinkInput');
                const raw = input?.value.trim() ?? '';
                // Wyodrębnij kod z URL lub użyj bezpośrednio
                let code = raw;
                try {
                    const hash = new URL(raw).hash;
                    if (hash.startsWith('#invite='))
                        code = hash.replace('#invite=', '');
                }
                catch { /* raw nie jest pełnym URL — użyj jako kod */ }
                // Spróbuj pobrać z backendu (krótki kod)
                if (code.length <= 20) {
                    const inv = await fetchInviteByCode(code, BACKEND_URL);
                    if (inv) {
                        name = inv.name;
                        sub = inv.pushSub;
                    }
                    else {
                        alert('Invalid or expired invite link');
                        return;
                    }
                }
                else {
                    // Stary base64 format
                    const parsed = parseInviteLink(raw);
                    if (!parsed) {
                        alert('Invalid invite link');
                        return;
                    }
                    name = parsed.name;
                    sub = parsed.pushSub;
                }
            }
            if (!name || !sub)
                return;
            await addFriend({
                name,
                subscriptionId: sub.endpoint,
                pushSub: sub,
                liveToken: null,
                lastSeen: null,
                addedAt: Date.now(),
            });
            modal.classList.remove('af-modal--visible');
            setTimeout(() => modal.remove(), 300);
            void this.render();
            this._showToast(`${name} added! 🎉`);
        });
    }
    // ── QR scanner ────────────────────────────────────────────────────────────
    _scanQR() {
        // Używamy jsQR przez dynamiczny import — ładuj tylko gdy potrzebne
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = 'image/*';
        input.capture = 'environment';
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file)
                return;
            // Prosty fallback — poproś o wklejenie linku (jsQR wymaga dodatkowej biblioteki)
            this._showAddFriendModal();
        };
        input.click();
    }
    // ── Live view ──────────────────────────────────────────────────────────────
    _openLiveView(token, name) {
        const panel = document.getElementById('friendsLivePanel');
        const title = document.getElementById('friendsLiveName');
        if (!panel)
            return;
        panel.classList.remove('hidden');
        if (title)
            title.textContent = `${name}'s Route`;
        this._liveMap.watch(token);
        setTimeout(() => this._liveMap.invalidateSize(), 100);
    }
    _closeLiveView() {
        const panel = document.getElementById('friendsLivePanel');
        panel?.classList.add('hidden');
        this._liveMap.stop();
        this._watchingId = null;
    }
    _onLiveUpdate(data) {
        const statusEl = document.getElementById('friendsLiveStatus');
        if (!statusEl)
            return;
        const elapsed = data.startedAt
            ? Math.floor((Date.now() - data.startedAt) / 60000)
            : 0;
        const statusMap = {
            running: '🟢 Running',
            paused: '⏸ Paused',
            finished: '✅ Finished',
            not_found: '❌ Session not found',
        };
        const speed = data.current?.speed ?? 0;
        statusEl.innerHTML = `
      <span class="fls-status">${statusMap[data.session] ?? data.session}</span>
      <span class="fls-meta">${elapsed} min · ${speed} km/h</span>
    `;
        if (data.session === 'finished') {
            setTimeout(() => this._closeLiveView(), 3000);
        }
    }
    // ── Poll friends status ───────────────────────────────────────────────────
    async _pollFriendsStatus() {
        const friends = await getAllFriends();
        let changed = false;
        for (const f of friends) {
            if (!f.liveToken)
                continue;
            try {
                const res = await fetch(`${BACKEND_URL}/live/status/${f.liveToken}`);
                const data = await res.json();
                if (data.session === 'finished' || data.session === 'not_found') {
                    // Wyczyść token
                    const { updateFriendLiveToken } = await import('./FriendsDB.js');
                    await updateFriendLiveToken(f.subscriptionId, null);
                    changed = true;
                }
            }
            catch { /* ignoruj */ }
        }
        if (changed)
            void this.render();
    }
    // ── Handle live push URL ─────────────────────────────────────────────────
    async _handleLivePushUrl(url) {
        // Wyciągnij token z URL: #live=TOKEN
        let token = '';
        try {
            token = new URL(url).hash.replace('#live=', '');
        }
        catch {
            if (url.includes('#live='))
                token = url.split('#live=')[1];
        }
        if (!token)
            return;
        // Znajdź znajomego po tokenie lub zaktualizuj pierwszego bez tokenu
        const friends = await getAllFriends();
        let friend = friends.find(f => f.liveToken === token);
        if (!friend) {
            // Zaktualizuj znajomego który zaczął trening (heurystyka: ostatnio dodany)
            // lub zapisz token tymczasowo przy pierwszym znajomym
            friend = friends[0];
            if (friend) {
                await updateFriendLiveToken(friend.subscriptionId, token);
                void this.render();
            }
        }
        const name = friend?.name ?? 'Friend';
        // Przełącz na zakładkę Friends
        const friendsBtn = document.querySelector('.bottom-nav__item[data-tab="tabFriends"]');
        friendsBtn?.click();
        // Otwórz live mapę
        setTimeout(() => this._openLiveView(token, name), 300);
    }
    // ── Toast ──────────────────────────────────────────────────────────────────
    _showToast(msg) {
        const t = document.createElement('div');
        t.className = 'friends-toast';
        t.textContent = msg;
        document.body.appendChild(t);
        requestAnimationFrame(() => t.classList.add('friends-toast--visible'));
        setTimeout(() => {
            t.classList.remove('friends-toast--visible');
            setTimeout(() => t.remove(), 400);
        }, 2500);
    }
}
//# sourceMappingURL=FriendsView.js.map