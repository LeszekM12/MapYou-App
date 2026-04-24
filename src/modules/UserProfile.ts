// ─── USER PROFILE ─────────────────────────────────────────────────────────────
// src/modules/UserProfile.ts
//
// 100% local — no backend, no fetch.
// Stores: localStorage (primary) + IndexedDB via db.ts (backup).
// userId generated once, hidden from UI, used for friend invite link.

import { saveProfileToDB, loadProfileFromDB, type ProfileRecord } from './db.js';

// ── Keys ──────────────────────────────────────────────────────────────────────

const LS_USER_ID    = 'mapyou_userId_profile';
const LS_USERNAME   = 'mapyou_userName';
const LS_BIO        = 'mapyou_bio';
const LS_AVATAR     = 'mapyou_avatar';           // base64
const FRIEND_BASE   = 'https://mapyou.app/add-friend';

// ── userId ────────────────────────────────────────────────────────────────────

export function generateUserId(): string {
  const existing = localStorage.getItem(LS_USER_ID);
  if (existing) return existing;
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const id = `user_${rand}`;
  localStorage.setItem(LS_USER_ID, id);
  return id;
}

export function getUserId(): string {
  return localStorage.getItem(LS_USER_ID) ?? generateUserId();
}

// ── Save / Load ───────────────────────────────────────────────────────────────

export interface ProfileData {
  userId:   string;
  name:     string;
  bio:      string;
  avatarB64: string | null;
}

export function saveProfileToLocal(data: Partial<ProfileData>): void {
  if (data.name    !== undefined) {
    localStorage.setItem(LS_USERNAME, data.name);
    // Keep UserName.ts in sync
    document.querySelectorAll<HTMLElement>('[data-username]').forEach(el => {
      el.textContent = data.name!;
    });
  }
  if (data.bio       !== undefined) localStorage.setItem(LS_BIO,    data.bio);
  if (data.avatarB64 !== undefined) {
    if (data.avatarB64) localStorage.setItem(LS_AVATAR, data.avatarB64);
    else                localStorage.removeItem(LS_AVATAR);
  }
  // Async backup to IndexedDB
  void saveProfileToDB(loadProfileFromLocal());
}

export function loadProfileFromLocal(): ProfileRecord {
  return {
    userId:    getUserId(),
    name:      localStorage.getItem(LS_USERNAME)  ?? 'Athlete',
    bio:       localStorage.getItem(LS_BIO)       ?? '',
    avatarB64: localStorage.getItem(LS_AVATAR)    ?? null,
  };
}

// ── Image → base64 ────────────────────────────────────────────────────────────

export function convertImageToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Friend link ───────────────────────────────────────────────────────────────

export function getFriendInviteLink(): string {
  return `${FRIEND_BASE}?userId=${getUserId()}`;
}

// ── Update profile avatar in UI wherever it appears ──────────────────────────

export function updateProfileUI(data?: ProfileRecord): void {
  const profile = data ?? loadProfileFromLocal();

  // Avatar in nav button
  const navAvatar = document.getElementById('profileNavAvatar');
  if (navAvatar) {
    navAvatar.innerHTML = profile.avatarB64
      ? `<img src="${profile.avatarB64}" alt="avatar" class="profile-nav__img"/>`
      : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" width="22" height="22">
           <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
         </svg>`;
  }

  // Greeting greeting in HomeView — refresh without full re-render
  const greetName = document.querySelector<HTMLElement>('.home-greeting__text strong');
  if (greetName) greetName.textContent = profile.name;
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function buildModalHTML(profile: ProfileRecord): string {
  const avatarInner = profile.avatarB64
    ? `<img src="${profile.avatarB64}" class="up-avatar__img" alt="Profile photo"/>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="48" height="48" class="up-avatar__placeholder">
         <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
       </svg>`;

  return `
  <div class="up-overlay" id="userProfileOverlay" role="dialog" aria-modal="true" aria-label="User Profile">
    <div class="up-sheet" id="userProfileSheet">
      <div class="up-handle" id="userProfileHandle"></div>

      <!-- Header -->
      <div class="up-header">
        <h2 class="up-header__title">Profile</h2>
        <button class="up-close" id="upClose" aria-label="Close">✕</button>
      </div>

      <!-- Avatar -->
      <div class="up-avatar-wrap">
        <div class="up-avatar" id="upAvatarPreview">${avatarInner}</div>
        <input type="file" accept="image/*" id="upAvatarInput" class="up-avatar__input"/>
        <button class="up-avatar__btn" id="upAvatarBtn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>
          Change photo
        </button>
      </div>

      <!-- Fields -->
      <div class="up-body">

        <div class="up-field">
          <label class="up-label" for="upName">Name</label>
          <input class="up-input" id="upName" type="text"
            value="${profile.name}" maxlength="32" autocomplete="off" placeholder="Your name…"/>
        </div>

        <div class="up-field">
          <label class="up-label" for="upBio">
            About me
            <span class="up-char-count" id="upBioCount">${profile.bio.length}/120</span>
          </label>
          <textarea class="up-textarea" id="upBio"
            maxlength="120" rows="3"
            placeholder="A short bio…">${profile.bio}</textarea>
        </div>

        <!-- Friend link -->
        <div class="up-field">
          <label class="up-label">Add-friend link</label>
          <div class="up-link-box">
            <span class="up-link-url" id="upLinkUrl">${getFriendInviteLink()}</span>
            <button class="up-link-copy" id="upLinkCopy">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
          <button class="up-share-btn" id="upShareLink">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
            </svg>
            Share invite link
          </button>
        </div>

      </div><!-- /up-body -->

      <!-- Save -->
      <div class="up-footer">
        <button class="up-save-btn" id="upSave">Save profile</button>
      </div>

    </div>
  </div>`;
}

// ── Open / Close ──────────────────────────────────────────────────────────────

let _modalEl: HTMLElement | null = null;
let _touchStartY = 0;

export function openProfileModal(): void {
  document.getElementById('userProfileOverlay')?.remove();

  const profile = loadProfileFromLocal();
  const wrapper = document.createElement('div');
  wrapper.innerHTML = buildModalHTML(profile);
  const el = wrapper.firstElementChild as HTMLElement;
  document.body.appendChild(el);
  _modalEl = el;

  requestAnimationFrame(() => {
    el.classList.add('up-overlay--visible');
    setTimeout(() => el.querySelector<HTMLElement>('.up-sheet')?.classList.add('up-sheet--open'), 10);
  });

  _bindModalEvents(el, profile);
}

export function closeProfileModal(): void {
  if (!_modalEl) return;
  const sheet = _modalEl.querySelector<HTMLElement>('.up-sheet');
  sheet?.classList.remove('up-sheet--open');
  _modalEl.classList.remove('up-overlay--visible');
  setTimeout(() => { _modalEl?.remove(); _modalEl = null; }, 350);
}

function _bindModalEvents(el: HTMLElement, _profile: ProfileRecord): void {
  // Close
  el.querySelector('#upClose')?.addEventListener('click', closeProfileModal);
  el.addEventListener('click', e => { if (e.target === el) closeProfileModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeProfileModal(); }, { once: true });

  // Swipe-down handle
  const handle = el.querySelector<HTMLElement>('#userProfileHandle')!;
  const sheet  = el.querySelector<HTMLElement>('.up-sheet')!;
  handle.addEventListener('touchstart', e => { _touchStartY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchmove',  e => {
    const d = e.touches[0].clientY - _touchStartY;
    if (d > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${d}px)`; }
  }, { passive: true });
  handle.addEventListener('touchend', e => {
    sheet.style.transition = '';
    if (e.changedTouches[0].clientY - _touchStartY > 100) closeProfileModal();
    else sheet.style.transform = '';
  });

  // Avatar
  const avatarBtn   = el.querySelector<HTMLElement>('#upAvatarBtn')!;
  const avatarInput = el.querySelector<HTMLInputElement>('#upAvatarInput')!;
  const avatarPreview = el.querySelector<HTMLElement>('#upAvatarPreview')!;
  avatarBtn.addEventListener('click', () => avatarInput.click());
  avatarInput.addEventListener('change', async () => {
    const file = avatarInput.files?.[0];
    if (!file) return;
    const b64 = await convertImageToBase64(file);
    avatarPreview.innerHTML = `<img src="${b64}" class="up-avatar__img" alt="avatar"/>`;
    avatarPreview.dataset.pending = b64;
  });

  // Bio char count
  const bioEl    = el.querySelector<HTMLTextAreaElement>('#upBio')!;
  const countEl  = el.querySelector<HTMLElement>('#upBioCount')!;
  bioEl.addEventListener('input', () => {
    countEl.textContent = `${bioEl.value.length}/120`;
  });

  // Copy link
  el.querySelector('#upLinkCopy')?.addEventListener('click', async () => {
    const btn = el.querySelector<HTMLButtonElement>('#upLinkCopy')!;
    try {
      await navigator.clipboard.writeText(getFriendInviteLink());
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5" width="16" height="16"><polyline points="20 6 9 17 4 12"/></svg>`;
      setTimeout(() => {
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`;
      }, 2000);
    } catch {}
  });

  // Share link
  el.querySelector('#upShareLink')?.addEventListener('click', async () => {
    const link = getFriendInviteLink();
    const name = el.querySelector<HTMLInputElement>('#upName')?.value.trim()
      ?? loadProfileFromLocal().name;
    if (navigator.share) {
      try {
        await navigator.share({ title: `Add ${name} on MapYou`, url: link });
      } catch {}
    } else {
      try {
        await navigator.clipboard.writeText(link);
        const btn = el.querySelector<HTMLButtonElement>('#upShareLink')!;
        const orig = btn.textContent;
        btn.textContent = 'Copied! ✓';
        setTimeout(() => { btn.textContent = orig; }, 2000);
      } catch {}
    }
  });

  // Save
  el.querySelector('#upSave')?.addEventListener('click', () => {
    const name      = el.querySelector<HTMLInputElement>('#upName')?.value.trim()    ?? '';
    const bio       = el.querySelector<HTMLTextAreaElement>('#upBio')?.value.trim()  ?? '';
    const avatarB64 = (avatarPreview.dataset.pending ?? null) as string | null;

    if (!name) {
      el.querySelector<HTMLInputElement>('#upName')?.focus();
      el.querySelector<HTMLInputElement>('#upName')?.classList.add('up-input--error');
      return;
    }

    saveProfileToLocal({ name, bio, avatarB64: avatarB64 ?? undefined });
    updateProfileUI();

    // Visual feedback
    const btn = el.querySelector<HTMLButtonElement>('#upSave')!;
    btn.textContent = 'Saved ✓';
    btn.style.background = '#4ade80';
    setTimeout(() => closeProfileModal(), 800);
  });
}

// ── Init ──────────────────────────────────────────────────────────────────────

export function initUserProfile(): void {
  generateUserId();  // ensure userId exists
  updateProfileUI(); // set initial avatar in nav
}
