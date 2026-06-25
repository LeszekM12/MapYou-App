// ─── FRIENDS VIEW ────────────────────────────────────────────────────────────
// src/modules/FriendsView.ts
//
// Zarządza zakładką Friends:
//   - lista znajomych z przyciskiem "Watch live"
//   - dodawanie znajomych przez link lub QR
//   - live mapa wbudowana w zakładkę
//   - polling statusu znajomych co 30s

import {
  getAllFriends, addFriend, deleteFriend, updateFriendLiveToken, updateFriendUserId,
  generateInviteLink, fetchInviteByCode, parseInviteLink, checkInviteInUrl,
  type Friend,
} from './FriendsDB.js';
import { LiveMap, type LiveData } from './LiveMap.js';
import { getIcon as _ffIcon, getSportLabel as _ffLabel } from './Tracker.js';
import { BACKEND_URL } from '../config.js';
import { getUserName } from './LiveTracker.js';
import { getUserId } from './UserProfile.js';
import { loadProfileFromLocal } from './UserProfile.js';

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
      setTimeout(() => void this._processInviteCode(inviteCode), 500);
    }

    // Sprawdź czy URL zawiera #live= (oglądanie trasy)
    const hash = window.location.hash;
    if (hash.startsWith('#live=')) {
      const token = hash.replace('#live=', '');
      setTimeout(() => this._openLiveView(token, 'Live Tracking'), 500);
      history.replaceState(null, '', window.location.pathname);
    }

    // Global hook so a tapped live notification (in-app bell) can open the live map
    (window as unknown as Record<string, unknown>).__openLive = (token: string, name: string) =>
      this._openLiveView(token, name);

    // Inicjalizuj mapę w kontenerze
    const mapContainer = document.getElementById('friendsLiveMapContainer');
    if (mapContainer) {
      this._liveMap.init(mapContainer, (data) => this._onLiveUpdate(data));
    }

    // Podpnij przyciski
    document.getElementById('btnShareMyLink')?.addEventListener('click', () => this._showMyLinkModal());
    // Pre-generate invite link in background so it's ready when user taps
    void this._precacheInviteLink();
    document.getElementById('btnAddFriend')?.addEventListener('click',  () => this._showAddFriendModal());
    document.getElementById('btnScanQR')?.addEventListener('click',     () => this._scanQR());
    document.getElementById('btnCloseLiveView')?.addEventListener('click', () => this._closeLiveView());

    // Napraw znajomych bez friendUserId
    void this._fixMissingFriendUserIds();

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
          void this._saveLiveTokenFromUrl(e.data.url as string);
        } else {
          void this._handleLivePushUrl(e.data.url as string);
        }
      }
      if (e.data?.type === 'OPEN_REELS') {
        const url    = e.data.url as string;
        const match  = url.match(/reels=([^&]+)/);
        const userId = match ? decodeURIComponent(match[1]) : null;
        if (userId) {
          void (async () => {
            const { openReelViewer } = await import('./HomeView.js') as unknown as { openReelViewer?: (g: unknown, cb: () => void) => void };
            if (!openReelViewer) return;
            const BACKEND_URL = (await import('../config.js')).BACKEND_URL;
            const res   = await fetch(`${BACKEND_URL}/reels/feed?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
            const d     = await res.json() as { data: { userId: string; authorName: string; avatarB64: string | null; reels: unknown[]; hasUnseen: boolean }[] };
            const group = d.data?.find(g => g.userId === userId);
            if (group) openReelViewer(group, () => {});
          })();
        }
      }
    });
  }

  private async _fixMissingFriendUserIds(): Promise<void> {
    const friends = await getAllFriends();
    const myUserId = getUserId();
    for (const f of friends) {
      let friendUserId = f.friendUserId;

      // Znajdź friendUserId jeśli brakuje
      if (!friendUserId && f.subscriptionId && !f.subscriptionId.startsWith('local:')) {
        try {
          const res = await fetch(`${BACKEND_URL}/users/lookup-by-endpoint`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ endpoint: f.subscriptionId }),
          });
          if (res.ok) {
            const d = await res.json() as { userId: string };
            if (d.userId) {
              friendUserId = d.userId;
              await updateFriendUserId(f.subscriptionId, d.userId);
              console.log(`[Friends] Fixed friendUserId for ${f.name}: ${d.userId}`);
            }
          }
        } catch {}
      }

      // Zarejestruj znajomego w Atlas jeśli mamy jego userId
      if (friendUserId) {
        void fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/friends/${encodeURIComponent(friendUserId)}`, {
          method: 'POST',
        }).catch(() => {});
      }
    }
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
    } else {
      list.innerHTML = friends.map(f => this._buildFriendCard(f)).join('');

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


  }

  // ── Friends Feed ─────────────────────────────────────────────────────────────

  private async _renderFeed(): Promise<void> {
    const feedEl = document.getElementById('friendsFeed');
    if (!feedEl) return;

    const userId = getUserId();
    if (!userId) return;

    feedEl.innerHTML = '<div class="friends-feed__loading">Loading feed…</div>';

    try {
      const res  = await fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(userId)}`);
      if (!res.ok) { feedEl.innerHTML = ''; return; }
      const data = await res.json() as { status: string; data: Array<{ kind: string; date: number; data: Record<string, unknown> }> };

      if (!data.data.length) {
        feedEl.innerHTML = '<div class="friends-feed__empty">No activity from friends yet 🏃</div>';
        return;
      }

      feedEl.innerHTML = '';
      for (const item of data.data) {
        const card = await this._buildFeedCard(item.kind, item.data);
        feedEl.appendChild(card);
      }
    } catch {
      feedEl.innerHTML = '';
    }
  }

  private async _buildFeedCard(kind: string, data: Record<string, unknown>): Promise<HTMLElement> {
    const card = document.createElement('div');
    card.className = 'ff-card';

    const itemId   = (data.activityId ?? data.postId ?? data.id) as string;
    const itemType = kind === 'activity' ? 'activity' : 'post';
    const userId   = getUserId();
    const profile  = loadProfileFromLocal();

    // Fetch likes
    let likeCount = 0;
    let liked     = false;
    try {
      const lr = await fetch(`${BACKEND_URL}/feed/likes/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`);
      if (lr.ok) {
        const ld = await lr.json() as { count: number; liked: boolean };
        likeCount = ld.count;
        liked     = ld.liked;
      }
    } catch {}

    // Fetch comments
    let comments: Array<{ commentId: string; authorName: string; text: string; createdAt: string }> = [];
    try {
      const cr = await fetch(`${BACKEND_URL}/feed/comments/${encodeURIComponent(itemId)}`);
      if (cr.ok) {
        const cd = await cr.json() as { data: typeof comments };
        comments = cd.data;
      }
    } catch {}

    const date     = new Date(data.date as number);
    const dateStr  = date.toLocaleDateString('en', { month: 'short', day: 'numeric' });
    const photoHtml = data.photoUrl
      ? `<img class="ff-card__photo" src="${data.photoUrl}" alt="" loading="lazy"/>`
      : '';
    const authorName = (data.authorName ?? data.name ?? 'Friend') as string;
    const title      = (data.title ?? data.description ?? data.name ?? '') as string;
    const body       = (data.body ?? '') as string;

    // Stats for activity
    const statsHtml = kind === 'activity' ? `
      <div class="ff-card__stats">
        <span>${(+(data.distanceKm ?? 0)).toFixed(2)} km</span>
        <span>${Math.floor((+(data.durationSec ?? 0)) / 60)} min</span>
        <span>${data.sport ? `${_ffIcon(data.sport as string)} ${_ffLabel(data.sport as string)}` : ''}</span>
      </div>` : '';

    card.innerHTML = `
      <div class="ff-card__header">
        <div class="ff-card__avatar">${authorName.charAt(0).toUpperCase()}</div>
        <div class="ff-card__meta">
          <span class="ff-card__author">${authorName}</span>
          <span class="ff-card__date">${dateStr}</span>
        </div>
        <span class="ff-card__type">${kind === 'activity' ? '🏃' : '📝'}</span>
      </div>
      ${title ? `<div class="ff-card__title">${title}</div>` : ''}
      ${body ? `<div class="ff-card__body">${body}</div>` : ''}
      ${photoHtml}
      ${statsHtml}
      <div class="ff-card__actions">
        <button class="ff-card__like ${liked ? 'ff-card__like--liked' : ''}" data-item="${itemId}" data-type="${itemType}">
          ❤️ <span class="ff-like-count">${likeCount}</span>
        </button>
        <button class="ff-card__comment-btn" data-item="${itemId}">
          💬 <span class="ff-comment-count">${comments.length}</span>
        </button>
      </div>
      <div class="ff-card__comments" id="ffc-${itemId}" style="display:none">
        <div class="ff-comments__list">
          ${comments.map(c => `
            <div class="ff-comment">
              <span class="ff-comment__author">${c.authorName}</span>
              <span class="ff-comment__text">${c.text}</span>
            </div>`).join('')}
        </div>
        <div class="ff-comment__input-row">
          <input class="ff-comment__input" placeholder="Add a comment…" maxlength="200" data-item="${itemId}" data-type="${itemType}"/>
          <button class="ff-comment__send" data-item="${itemId}" data-type="${itemType}">Send</button>
        </div>
      </div>`;

    // Like handler
    card.querySelector('.ff-card__like')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget as HTMLElement;
      const res = await fetch(`${BACKEND_URL}/feed/like`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ userId, itemId, itemType }),
      });
      if (res.ok) {
        const d = await res.json() as { liked: boolean; count: number };
        btn.classList.toggle('ff-card__like--liked', d.liked);
        const countEl = btn.querySelector('.ff-like-count');
        if (countEl) countEl.textContent = String(d.count);
      }
    });

    // Comment toggle
    card.querySelector('.ff-card__comment-btn')?.addEventListener('click', () => {
      const panel = card.querySelector(`#ffc-${itemId}`) as HTMLElement;
      if (panel) panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
    });

    // Send comment
    card.querySelector('.ff-comment__send')?.addEventListener('click', async () => {
      const input = card.querySelector('.ff-comment__input') as HTMLInputElement;
      const text  = input?.value.trim();
      if (!text) return;

      const res = await fetch(`${BACKEND_URL}/feed/comment`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          userId,
          authorName: profile.name,
          itemId,
          itemType,
          text,
        }),
      });

      if (res.ok) {
        const d = await res.json() as { data: { authorName: string; text: string } };
        const list = card.querySelector('.ff-comments__list');
        if (list) {
          const div = document.createElement('div');
          div.className = 'ff-comment';
          div.innerHTML = `<span class="ff-comment__author">${d.data.authorName}</span><span class="ff-comment__text">${d.data.text}</span>`;
          list.appendChild(div);
        }
        input.value = '';
        const countEl = card.querySelector('.ff-comment-count');
        if (countEl) countEl.textContent = String(parseInt(countEl.textContent ?? '0') + 1);
      }
    });

    // Enter to send
    card.querySelector('.ff-comment__input')?.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter') {
        (card.querySelector('.ff-comment__send') as HTMLButtonElement)?.click();
      }
    });

    return card;
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

  private _cachedInviteLink: string | null = null;
  private _cachingLink = false;

  /** Pre-generuj link w tle — wywołaj przy wejściu w zakładkę Friends */
  async _precacheInviteLink(): Promise<void> {
    if (this._cachingLink) return;
    this._cachingLink = true;
    const name = getUserName();

    // 1. Znajdź push sub (opcjonalnie — krótki link powstaje też bez niego)
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

    // 2. ZAWSZE próbuj krótkiego kodu z backendu (z push sub lub bez).
    //    To jedyny naprawdę krótki format; base64 zostaje tylko na offline.
    try {
      const subJson = sub ? (sub.toJSON() as Friend['pushSub']) : undefined;
      const short = await Promise.race([
        generateInviteLink(name, subJson, BACKEND_URL, getUserId()),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
      ]);
      this._cachedInviteLink = short;
      this._cachingLink = false;
      return;
    } catch {}

    // 3. Backend niedostępny (offline) — awaryjny base64 (długi, ale działa bez sieci)
    const base = window.location.href.split('#')[0];
    this._cachedInviteLink = `${base}#invite=${btoa(JSON.stringify({
      name,
      pushSub: sub ? sub.toJSON() : null,
    }))}`;

    this._cachingLink = false;
  }

  private _shareMyLink(): void {
    // navigator.share() MUSI być wywołany synchronicznie w handlerze kliknięcia (wymóg iOS)
    const name = getUserName();
    const link = this._cachedInviteLink;

    if (!link) {
      // Link nie gotowy — pokaż toast i przygotuj na następne kliknięcie
      this._showToast('Preparing link... tap again in a moment ⏳');
      void this._precacheInviteLink();
      return;
    }

    if (typeof navigator.share === 'function') {
      navigator.share({
        title: `Add ${name} on MapYou`,
        text:  `${name} invited you to track their workouts live! 🏃`,
        url:   link,
      }).catch((err: Error) => {
        if (err.name !== 'AbortError') {
          navigator.clipboard?.writeText(link)
            .then(() => this._showToast('Invite link copied! 📋'))
            .catch(() => this._showToast('Could not share — try again'));
        }
      });
    } else {
      navigator.clipboard?.writeText(link)
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
      let invFriendId: string | null = null;

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
          if (inv) {
            name         = inv.name;
            sub          = inv.pushSub;
            invFriendId  = inv.friendUserId ?? null;
          } else { alert('Invalid or expired invite link'); return; }
        } else {
          // Stary base64 format
          const parsed = parseInviteLink(raw);
          if (!parsed) { alert('Invalid invite link'); return; }
          name = parsed.name;
          sub  = parsed.pushSub;
        }
      }

      if (!name) return;

      // sub może być null gdy link wygenerowano bez push sub (np. laptop bez powiadomień)
      const endpoint = sub?.endpoint ?? `local:${name}:${Date.now()}`;
      await addFriend({
        name,
        friendUserId:   invFriendId,
        subscriptionId: endpoint,
        pushSub:        sub ?? { endpoint, expirationTime: null, keys: { p256dh: '', auth: '' } },
        liveToken:      null,
        lastSeen:       null,
        addedAt:        Date.now(),
      });

      // Spróbuj znaleźć friendUserId po endpoint jeśli nie mamy go z linku
      let resolvedFriendId = invFriendId;
      if (!resolvedFriendId && endpoint && !endpoint.startsWith('local:')) {
        try {
          const lr = await fetch(`${BACKEND_URL}/users/lookup-by-endpoint`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ endpoint }),
          });
          if (lr.ok) {
            const ld = await lr.json() as { userId: string };
            if (ld.userId) {
              resolvedFriendId = ld.userId;
              await updateFriendUserId(endpoint, ld.userId);
            }
          }
        } catch {}
      }

      // Zapisz znajomego w Atlas (żeby feed działał)
      if (resolvedFriendId) {
        const myUserId = getUserId();
        void fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/friends/${encodeURIComponent(resolvedFriendId)}`, {
          method: 'POST',
        });
      }

      modal.classList.remove('af-modal--visible');
      setTimeout(() => modal.remove(), 300);
      void this.render();
      this._showToast(`${name} added! 🎉`);
    });
  }

  // ── QR: external lib loader (CDN <script>, cached) ──────────────────────────

  private _scriptPromises: Record<string, Promise<void> | undefined> = {};
  private _loadExternalScript(src: string): Promise<void> {
    const existing = this._scriptPromises[src];
    if (existing) return existing;
    const p = new Promise<void>((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error('script load failed: ' + src));
      document.head.appendChild(s);
    });
    this._scriptPromises[src] = p;
    return p;
  }

  // ── Telegram-style dotted/rounded QR (SVG from module matrix) ───────────────

  private _buildDottedQR(count: number, isDark: (r: number, c: number) => boolean): string {
    const green = '#0a7d46';                 // deep brand green — good contrast for scanning
    const cell  = 10;                        // viewBox units per module
    const size  = count * cell;
    const r     = cell * 0.46;               // dot radius
    const cen   = count / 2;
    const logoHalf = count * 0.15;           // skip dots under the centered logo

    const inFinder = (row: number, col: number): boolean => {
      const box = (r0: number, c0: number): boolean =>
        row >= r0 && row < r0 + 7 && col >= c0 && col < c0 + 7;
      return box(0, 0) || box(0, count - 7) || box(count - 7, 0);
    };
    const inLogo = (row: number, col: number): boolean =>
      Math.abs(row + 0.5 - cen) < logoHalf && Math.abs(col + 0.5 - cen) < logoHalf;

    let dots = '';
    for (let row = 0; row < count; row++) {
      for (let col = 0; col < count; col++) {
        if (!isDark(row, col) || inFinder(row, col) || inLogo(row, col)) continue;
        dots += `<circle cx="${col * cell + cell / 2}" cy="${row * cell + cell / 2}" r="${r}"/>`;
      }
    }

    const eye = (r0: number, c0: number): string => {
      const x = c0 * cell, y = r0 * cell;
      return `<rect x="${x}" y="${y}" width="${7 * cell}" height="${7 * cell}" rx="${cell * 2.2}" fill="${green}"/>`
        + `<rect x="${x + cell}" y="${y + cell}" width="${5 * cell}" height="${5 * cell}" rx="${cell * 1.5}" fill="#fff"/>`
        + `<rect x="${x + 2 * cell}" y="${y + 2 * cell}" width="${3 * cell}" height="${3 * cell}" rx="${cell}" fill="${green}"/>`;
    };

    return `<svg class="mlink-qr__svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="100%" height="100%" shape-rendering="geometricPrecision">`
      + `<g fill="${green}">${dots}</g>`
      + eye(0, 0) + eye(0, count - 7) + eye(count - 7, 0)
      + `</svg>`;
  }

  // ── My link modal (in-app QR + copy + share — works on iOS too) ─────────────

  private async _showMyLinkModal(): Promise<void> {
    document.getElementById('myLinkModal')?.remove();
    if (!this._cachedInviteLink) void this._precacheInviteLink();
    const link = this._cachedInviteLink ?? '';

    const modal = document.createElement('div');
    modal.id = 'myLinkModal';
    modal.className = 'mlink-overlay';
    modal.innerHTML = `
      <div class="mlink-sheet">
        <button class="mlink-close" id="mlinkClose" aria-label="Close">✕</button>
        <h2 class="mlink-title">Add me on MapYou</h2>
        <p class="mlink-sub">Have a friend scan this in their app — or share the link.</p>
        <div class="mlink-qr" id="mlinkQR"><div class="mlink-qr__msg">${link ? 'Generating…' : 'Preparing link… reopen in a moment'}</div></div>
        <div class="mlink-actions">
          <button class="mlink-btn" id="mlinkCopy">📋 Copy link</button>
          <button class="mlink-btn mlink-btn--primary" id="mlinkShare">↗ Share</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#mlinkClose')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
    modal.querySelector('#mlinkCopy')?.addEventListener('click', () => {
      if (!link) return;
      navigator.clipboard?.writeText(link)
        .then(() => this._showToast('Link copied! 📋'))
        .catch(() => this._showToast('Could not copy'));
    });
    modal.querySelector('#mlinkShare')?.addEventListener('click', () => this._shareMyLink());

    if (link) {
      try {
        await this._loadExternalScript('https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js');
        const qrFn = (window as unknown as Record<string, unknown>).qrcode as
          ((t: number, e: string) => {
            addData: (s: string) => void; make: () => void;
            createDataURL: (c: number, m: number) => string;
            getModuleCount: () => number; isDark: (r: number, c: number) => boolean;
          }) | undefined;
        const box = modal.querySelector('#mlinkQR');
        if (qrFn && box) {
          const qr = qrFn(0, 'H'); qr.addData(link); qr.make();
          const logo = '<span class="mlink-qr__logo"><img src="public/icon-192.png" alt="" /></span>';
          let inner: string;
          try {
            inner = this._buildDottedQR(qr.getModuleCount(), (r, c) => qr.isDark(r, c));
          } catch {
            inner = `<img class="mlink-qr__img" alt="QR code" src="${qr.createDataURL(6, 8)}" />`;
          }
          box.innerHTML = `<div class="mlink-qr__inner">${inner}${logo}</div>`;
        }
      } catch {
        const box = modal.querySelector('#mlinkQR');
        if (box) box.innerHTML = '<div class="mlink-qr__msg">QR unavailable offline — use Share</div>';
      }
    }
  }

  // ── Process a scanned / pasted invite (short code or old base64) ────────────

  private async _processInviteCode(raw: string): Promise<void> {
    let code = (raw ?? '').trim();
    const m = code.match(/[#&?]invite=([^&\s]+)/);
    if (m) code = m[1];
    code = code.replace(/^#?invite=/, '');
    if (!code) { this._showToast('No invite found'); return; }
    const inv = await fetchInviteByCode(code, BACKEND_URL);
    if (inv) { this._showAddFriendModal(inv.name, inv.pushSub); return; }
    const parsed = parseInviteLink(`#invite=${code}`);
    if (parsed) { this._showAddFriendModal(parsed.name, parsed.pushSub); return; }
    this._showToast('Invite not found or expired');
  }

  // ── QR scanner (live camera via jsQR, photo fallback) ───────────────────────

  private async _scanQR(): Promise<void> {
    document.getElementById('qrScanModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'qrScanModal';
    modal.className = 'qrscan-overlay';
    modal.innerHTML = `
      <div class="qrscan-sheet">
        <button class="qrscan-close" id="qrScanClose" aria-label="Close">✕</button>
        <h2 class="qrscan-title">Scan friend's QR</h2>
        <div class="qrscan-viewport"><video id="qrScanVideo" playsinline muted></video><div class="qrscan-frame"></div></div>
        <p class="qrscan-hint" id="qrScanHint">Point the camera at the QR code</p>
        <button class="mlink-btn" id="qrScanPhoto">📷 Use a photo instead</button>
      </div>`;
    document.body.appendChild(modal);

    let stream: MediaStream | null = null;
    let raf = 0;
    const cleanup = (): void => {
      if (raf) cancelAnimationFrame(raf);
      if (stream) stream.getTracks().forEach(t => t.stop());
      modal.remove();
    };
    const onFound = (text: string): void => { cleanup(); void this._processInviteCode(text); };
    modal.querySelector('#qrScanClose')?.addEventListener('click', cleanup);

    const jsqrUrl = 'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js';
    const getJsQR = (): ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | undefined =>
      (window as unknown as Record<string, unknown>).jsQR as never;

    // Photo fallback (works even if live camera is blocked)
    modal.querySelector('#qrScanPhoto')?.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file'; input.accept = 'image/*';
      (input as HTMLInputElement & { capture?: string }).capture = 'environment';
      input.onchange = async () => {
        const file = input.files?.[0]; if (!file) return;
        try {
          await this._loadExternalScript(jsqrUrl);
          const img = new Image(); img.src = URL.createObjectURL(file); await img.decode();
          const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
          const ctx = c.getContext('2d'); if (!ctx) return;
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(0, 0, c.width, c.height);
          const r = getJsQR()?.(px.data, c.width, c.height);
          if (r?.data) onFound(r.data); else this._showToast('No QR found in photo');
        } catch { this._showToast('Could not read photo'); }
      };
      input.click();
    });

    // Live camera scan
    try {
      await this._loadExternalScript(jsqrUrl);
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = modal.querySelector('#qrScanVideo') as HTMLVideoElement;
      video.srcObject = stream; await video.play();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const tick = (): void => {
        if (!document.body.contains(modal) || !ctx) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const px = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const r = getJsQR()?.(px.data, canvas.width, canvas.height);
          if (r?.data) { onFound(r.data); return; }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } catch {
      const hint = modal.querySelector('#qrScanHint');
      if (hint) hint.textContent = 'Camera unavailable — tap “Use a photo instead”.';
    }
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

    const stateDot: Record<string, string> = {
      running:   '🟢',
      paused:    '⏸',
      finished:  '✅',
      not_found: '❌',
    };
    const sportTxt = data.sport
      ? `${_ffIcon(data.sport)} ${_ffLabel(data.sport)}`
      : '';
    const stateTxt = data.session === 'paused' ? ' (paused)'
      : data.session === 'finished' ? ' (finished)'
      : data.session === 'not_found' ? 'Session not found'
      : '';

    const speed = data.current?.speed ?? 0;
    statusEl.innerHTML = `
      <span class="fls-status">${stateDot[data.session] ?? ''} ${sportTxt || 'Live'}${stateTxt}</span>
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

        // Brak tokenu — sprawdź czy znajomy właśnie zaczął trening.
        // Pytamy po TOŻSAMOŚCI WŁAŚCICIELA (userId, a w razie braku jego endpoint),
        // nie po naszym/obserwującego endpoincie — inaczej sesja jednego znajomego
        // pokazywała się pod innym.
        const ownerKey = f.friendUserId ?? f.subscriptionId;
        if (!ownerKey) continue;
        const ep   = encodeURIComponent(ownerKey);
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
      // Resolve the session OWNER so we attach the token to the RIGHT friend
      // (never blindly to friends[0] — that cross-wired sessions).
      let ownerId: string | null = null;
      try {
        const res  = await fetch(`${BACKEND_URL}/live/status/${token}`);
        const data = await res.json() as { userId?: string | null; session?: string };
        if (res.ok && data.session !== 'finished' && data.session !== 'not_found') {
          ownerId = data.userId ?? null;
        }
      } catch { /* offline */ }

      if (ownerId) friend = friends.find(f => f.friendUserId === ownerId);
      if (friend) {
        await updateFriendLiveToken(friend.subscriptionId, token);
        void this.render();
      }
      // If we can't identify the owner, do NOT guess — the poller will pick it up.
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

    // Znajdź znajomego po tokenie lub po WŁAŚCICIELU sesji
    const friends = await getAllFriends();
    let friend = friends.find(f => f.liveToken === token);

    if (!friend) {
      let ownerId: string | null = null;
      try {
        const res  = await fetch(`${BACKEND_URL}/live/status/${token}`);
        const data = await res.json() as { userId?: string | null; session?: string };
        if (res.ok && data.session !== 'finished' && data.session !== 'not_found') {
          ownerId = data.userId ?? null;
        }
      } catch { /* offline */ }
      if (ownerId) friend = friends.find(f => f.friendUserId === ownerId);
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
