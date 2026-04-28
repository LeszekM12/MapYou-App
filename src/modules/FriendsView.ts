// ─── FRIENDS VIEW ────────────────────────────────────────────────────────────
// src/modules/FriendsView.ts
//
// Zarządza zakładką Friends:
//   - lista znajomych z przyciskiem "Watch live"
//   - dodawanie znajomych przez link lub QR
//   - live mapa wbudowana w zakładkę
//   - polling statusu znajomych co 30s

import {
  getAllFriends, addFriend, deleteFriend, updateFriendLiveToken,
  generateInviteLink, fetchInviteByCode, parseInviteLink, checkInviteInUrl,
  type Friend,
} from './FriendsDB.js';
import { LiveMap, type LiveData } from './LiveMap.js';
import { BACKEND_URL } from '../config.js';
import { getUserName } from './LiveTracker.js';

// ── Stałe ─────────────────────────────────────────────────────────────────────

const STATUS_POLL_MS = 10_000;   // sprawdzaj status znajomych co 10s

// ── FriendsView class ─────────────────────────────────────────────────────────

export class FriendsView {
  private _liveMap:      LiveMap     = new LiveMap();
  private _pollTimer:    ReturnType<typeof setInterval> | null = null;
  private _clockTimer:   ReturnType<typeof setInterval> | null = null;
  private _watchingId:   number | null = null;
  private _lastLiveData: LiveData | null = null;

  // ── Init ───────────────────────────────────────────────────────────────────

  init(): void {
    // Sprawdź czy URL zawiera #invite= (ktoś wysłał link zaproszenia)
    const inviteCode = checkInviteInUrl();
    if (inviteCode) {
      history.replaceState(null, '', window.location.pathname);
      setTimeout(async () => {
        // Spróbuj pobrać z backendu (krótki kod)
        const inv = await fetchInviteByCode(inviteCode, BACKEND_URL);
        if (inv) {
          this._showAddFriendModal(inv.name, inv.pushSub);
        } else {
          // Fallback — stary base64 format
          const parsed = parseInviteLink(`#invite=${inviteCode}`);
          if (parsed) this._showAddFriendModal(parsed.name, parsed.pushSub);
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
    // Pre-generate invite link in background so it's ready when user taps
    void this._precacheInviteLink();
    document.getElementById('btnAddFriend')?.addEventListener('click',  () => this._showAddFriendModal());
    document.getElementById('btnScanQR')?.addEventListener('click',     () => this._scanQR());
    document.getElementById('btnCloseLiveView')?.addEventListener('click', () => this._closeLiveView());

    // Renderuj listę
    void this.render();

    // Od razu zweryfikuj statusy — nie czekaj 30s
    void this._pollFriendsStatus();

    // Polling statusu znajomych co 30s
    this._pollTimer = setInterval(() => void this._pollFriendsStatus(), STATUS_POLL_MS);

    // Odbieraj wiadomości z Service Workera
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === 'OPEN_LIVE') {
        if (e.data.silent) {
          // Cicha aktualizacja — tylko zapisz token i odśwież listę (bez otwierania live)
          void this._saveLiveTokenFromUrl(e.data.url as string);
        } else {
          // Kliknięcie powiadomienia — otwórz live panel
          void this._handleLivePushUrl(e.data.url as string);
        }
      }
    });
  }

  destroy(): void {
    if (this._pollTimer) clearInterval(this._pollTimer);
    this._liveMap.stop();
  }

  // ── Render friends list ────────────────────────────────────────────────────

  async render(): Promise<void> {
    const friends = await getAllFriends();
    const list    = document.getElementById('friendsList');
    if (!list) return;

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
    list.querySelectorAll<HTMLElement>('[data-watch]').forEach(btn => {
      btn.addEventListener('click', () => {
        const token = btn.dataset.watch!;
        const name  = btn.dataset.name!;
        this._openLiveView(token, name);
      });
    });

    list.querySelectorAll<HTMLElement>('[data-delete]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = Number(btn.dataset.delete);
        if (confirm('Remove this friend?')) {
          await deleteFriend(id);
          void this.render();
        }
      });
    });
  }

  private _buildFriendCard(f: Friend): string {
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

  /** Pre-generate the invite link in background — called on Friends tab open */
  private _cachedInviteLink: string | null = null;
  private _cachingLink = false;

  async _precacheInviteLink(): Promise<void> {
    if (this._cachingLink) return;
    this._cachingLink = true;
    const name = getUserName();

    // Ustaw base64 link NATYCHMIAST — zawsze dostępny gdy user kliknie
    this._cachedInviteLink = this._buildFallbackLink(name);

    // Znajdź push sub z krótkim timeoutem
    let sub: PushSubscription | null = null;
    try {
      const regs = await Promise.race([
        navigator.serviceWorker.getRegistrations(),
        new Promise<ServiceWorkerRegistration[]>(r => setTimeout(() => r([]), 800)),
      ]);
      for (const reg of regs) {
        sub = await reg.pushManager.getSubscription();
        if (sub) break;
      }
    } catch {}

    // Zaktualizuj base64 z push sub jeśli dostępny
    if (sub) {
      const base = window.location.href.split('#')[0];
      this._cachedInviteLink = `${base}#invite=${btoa(JSON.stringify({
        name,
        pushSub: sub.toJSON(),
      }))}`;
    }

    this._cachingLink = false;

    // Spróbuj zastąpić krótkim linkiem z backendu w tle (bez blokowania)
    if (sub) {
      void (async () => {
        try {
          const subJson = sub!.toJSON() as Friend['pushSub'];
          const short = await Promise.race([
            generateInviteLink(name, subJson, BACKEND_URL),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
          ]);
          this._cachedInviteLink = short; // nadpisz krótkim jeśli backend odpowiedział
        } catch { /* zostaje base64 */ }
      })();
    }
  }

  /** Builds a fallback base64 invite link synchronously — always available instantly */
  private _buildFallbackLink(name: string): string {
    const base   = window.location.href.split('#')[0];
    const userId = localStorage.getItem('mapyou_userId_profile') ?? String(Date.now());
    return `${base}#invite=${btoa(JSON.stringify({
      name,
      pushSub: {
        endpoint:       `local:${userId}`,
        expirationTime: null,
        keys:           { p256dh: '', auth: '' },
      },
    }))}`;
  }

  private _shareMyLink(): void {
    const name = getUserName();

    // FIX: Always use cached link or build fallback synchronously.
    // Never defer with setTimeout — iOS/Safari requires navigator.share()
    // to be called synchronously within the user gesture handler.
    const link = this._cachedInviteLink ?? this._buildFallbackLink(name);

    if (navigator.share) {
      void navigator.share({
        title: `Add ${name} on MapYou`,
        text:  `${name} invited you to track their workouts live! 🏃`,
        url:   link,
      }).catch(err => {
        if ((err as Error).name !== 'AbortError') {
          void navigator.clipboard.writeText(link)
            .then(() => this._showToast('Invite link copied! 📋'))
            .catch(() => this._showToast('Could not share — try again'));
        }
      });
    } else {
      void navigator.clipboard.writeText(link)
        .then(() => this._showToast('Invite link copied! 📋'))
        .catch(() => this._showToast('Could not share — try again'));
    }
  }

  // ── Add friend modal ───────────────────────────────────────────────────────

  private _showAddFriendModal(
    prefillName?: string,
    prefillSub?: Friend['pushSub'],
  ): void {
    document.getElementById('addFriendModal')?.remove();

    const modal = document.createElement('div');
    modal.id    = 'addFriendModal';
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
      let sub  = prefillSub;

      if (!prefillSub) {
        const input = modal.querySelector<HTMLInputElement>('#afLinkInput');
        const raw   = input?.value.trim() ?? '';

        // Wyodrębnij kod z URL lub użyj bezpośrednio
        let code = raw;
        try {
          const hash = new URL(raw).hash;
          if (hash.startsWith('#invite=')) code = hash.replace('#invite=', '');
        } catch { /* raw nie jest pełnym URL — użyj jako kod */ }

        // Spróbuj pobrać z backendu (krótki kod)
        if (code.length <= 20) {
          const inv = await fetchInviteByCode(code, BACKEND_URL);
          if (inv) { name = inv.name; sub = inv.pushSub; }
          else { alert('Invalid or expired invite link'); return; }
        } else {
          // Stary base64 format
          const parsed = parseInviteLink(raw);
          if (!parsed) { alert('Invalid invite link'); return; }
          name = parsed.name;
          sub  = parsed.pushSub;
        }
      }

      if (!name || !sub) return;

      await addFriend({
        name,
        subscriptionId: sub.endpoint,
        pushSub:        sub,
        liveToken:      null,
        lastSeen:       null,
        addedAt:        Date.now(),
      });

      modal.classList.remove('af-modal--visible');
      setTimeout(() => modal.remove(), 300);
      void this.render();
      this._showToast(`${name} added! 🎉`);
    });
  }

  // ── QR scanner ────────────────────────────────────────────────────────────

  private _scanQR(): void {
    // Używamy jsQR przez dynamiczny import — ładuj tylko gdy potrzebne
    const input = document.createElement('input');
    input.type   = 'file';
    input.accept = 'image/*';
    input.capture = 'environment';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;

      // Prosty fallback — poproś o wklejenie linku (jsQR wymaga dodatkowej biblioteki)
      this._showAddFriendModal();
    };
    input.click();
  }

  // ── Live view ──────────────────────────────────────────────────────────────

  private _openLiveView(token: string, name: string): void {
    const panel = document.getElementById('friendsLivePanel');
    const title = document.getElementById('friendsLiveName');
    if (!panel) return;

    panel.classList.remove('hidden');
    if (title) title.textContent = `${name}'s Route`;

    this._liveMap.watch(token);
    // Invalidate twice — once immediately, once after CSS transition settles
    this._liveMap.invalidateSize();
    setTimeout(() => this._liveMap.invalidateSize(), 300);
  }

  private _closeLiveView(): void {
    const panel = document.getElementById('friendsLivePanel');
    panel?.classList.add('hidden');
    this._liveMap.stop();
    this._watchingId = null;
    this._lastLiveData = null;
    this._stopClock();
  }

  private _onLiveUpdate(data: LiveData): void {
    this._lastLiveData = data;
    this._renderStatus(data);

    if (data.session === 'finished') {
      this._stopClock();
      setTimeout(() => this._closeLiveView(), 3000);
    } else if (data.session === 'running' && !this._clockTimer) {
      // Tykaj co sekundę żeby czas był na bieżąco
      this._clockTimer = setInterval(() => {
        if (this._lastLiveData) this._renderStatus(this._lastLiveData);
      }, 1000);
    } else if (data.session === 'paused') {
      this._stopClock();
    }
  }

  private _stopClock(): void {
    if (this._clockTimer) { clearInterval(this._clockTimer); this._clockTimer = null; }
  }

  private _renderStatus(data: LiveData): void {
    const statusEl = document.getElementById('friendsLiveStatus');
    if (!statusEl) return;

    const elapsed = data.startedAt
      ? Math.floor((Date.now() - data.startedAt) / 60000)
      : 0;

    const statusMap: Record<string, string> = {
      running:   '🟢 Running',
      paused:    '⏸ Paused',
      finished:  '✅ Finished',
      not_found: '❌ Session not found',
    };

    const speed = data.current?.speed ?? 0;
    statusEl.innerHTML = `
      <span class="fls-status">${statusMap[data.session] ?? data.session}</span>
      <span class="fls-meta">${elapsed} min · ${speed} km/h</span>
    `;
  }

  // ── Poll friends status ───────────────────────────────────────────────────

  private async _pollFriendsStatus(): Promise<void> {
    const friends = await getAllFriends();
    let changed   = false;

    for (const f of friends) {
      try {
        // Jeśli znajomy ma już zapisany token — weryfikuj przez /live/status/:token
        if (f.liveToken) {
          const res  = await fetch(`${BACKEND_URL}/live/status/${f.liveToken}`);
          const data = await res.json() as { session?: string };
          if (!res.ok || data.session === 'finished' || data.session === 'not_found' || !data.session) {
            await updateFriendLiveToken(f.subscriptionId, null);
            changed = true;
          }
          // Token nadal aktywny — nic nie rób, przycisk Watch zostaje
          continue;
        }

        // Brak tokenu — sprawdź czy znajomy właśnie zaczął trening przez /live/active/:endpoint
        const ep   = encodeURIComponent(f.subscriptionId);
        const res  = await fetch(`${BACKEND_URL}/live/active/${ep}`);
        const data = await res.json() as { active: boolean; token: string | null };

        if (data.active && data.token) {
          await updateFriendLiveToken(f.subscriptionId, data.token);
          changed = true;
        }
      } catch { /* ignoruj */ }
    }

    if (changed) void this.render();
  }

  // ── Handle live push URL ─────────────────────────────────────────────────

  /** Cicha aktualizacja — tylko zapisz token i odśwież przycisk Watch, bez otwierania live */
  private async _saveLiveTokenFromUrl(url: string): Promise<void> {
    let token = '';
    try {
      token = new URL(url).hash.replace('#live=', '');
    } catch {
      if (url.includes('#live=')) token = url.split('#live=')[1];
    }
    if (!token) return;

    const friends = await getAllFriends();
    let friend = friends.find(f => f.liveToken === token);
    if (!friend) {
      friend = friends[0];
      if (friend) {
        await updateFriendLiveToken(friend.subscriptionId, token);
        void this.render();
      }
    }
  }

  private async _handleLivePushUrl(url: string): Promise<void> {
    // Wyciągnij token z URL: #live=TOKEN
    let token = '';
    try {
      token = new URL(url).hash.replace('#live=', '');
    } catch {
      if (url.includes('#live=')) token = url.split('#live=')[1];
    }
    if (!token) return;

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
    const friendsBtn = document.querySelector<HTMLElement>('.bottom-nav__item[data-tab="tabFriends"]');
    friendsBtn?.click();

    // Otwórz live mapę
    setTimeout(() => this._openLiveView(token, name), 300);
  }

  // ── Toast ──────────────────────────────────────────────────────────────────

  private _copyOrShareLink(link: string, name: string): void {
    if (navigator.share) {
      void navigator.share({ title: `Add ${name} on MapYou`, url: link });
    } else {
      void navigator.clipboard.writeText(link).then(() => {
        this._showToast('Link copied! 📋');
      }).catch(() => {
        this._showToast(link);
      });
    }
  }

  private _showToast(msg: string): void {
    const t = document.createElement('div');
    t.className  = 'friends-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('friends-toast--visible'));
    setTimeout(() => {
      t.classList.remove('friends-toast--visible');
      setTimeout(() => t.remove(), 400);
    }, 2500);
  }
}
