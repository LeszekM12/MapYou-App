// ─── USER PROFILE ─────────────────────────────────────────────────────────────
// src/modules/UserProfile.ts
//
// 100% local — no backend, no fetch.
// Stores: localStorage (primary) + IndexedDB via db.ts (backup).
// userId generated once, hidden from UI, used for friend invite link.

import { saveProfileToDB, loadProfileFromDB, type ProfileRecord } from './db.js';
import { CS } from './cloudSync.js';

// ── Keys ──────────────────────────────────────────────────────────────────────

const LS_USER_ID    = 'mapyou_userId_profile';
const LS_USERNAME   = 'mapyou_userName';
const LS_BIO        = 'mapyou_bio';
const LS_AVATAR     = 'mapyou_avatar';
const LS_CITY       = 'mapyou_city';
const LS_REGION     = 'mapyou_region';
const LS_BIRTHDATE  = 'mapyou_birthDate';
const LS_GENDER     = 'mapyou_gender';
const LS_WEIGHT     = 'mapyou_weightKg';

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
  userId:    string;
  name:      string;
  bio:       string;
  avatarB64: string | null;
  city:      string;
  region:    string;
  birthDate: string | null;
  gender:    'male' | 'female' | 'other' | null;
  weightKg:  number | null;
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
  if (data.city      !== undefined) localStorage.setItem(LS_CITY,   data.city ?? '');
  if (data.region    !== undefined) localStorage.setItem(LS_REGION, data.region ?? '');
  if (data.birthDate !== undefined) localStorage.setItem(LS_BIRTHDATE, data.birthDate ?? '');
  if (data.gender    !== undefined) localStorage.setItem(LS_GENDER, data.gender ?? '');
  if (data.weightKg  !== undefined) localStorage.setItem(LS_WEIGHT, String(data.weightKg ?? ''));
  if (data.avatarB64 !== undefined) {
    if (data.avatarB64) localStorage.setItem(LS_AVATAR, data.avatarB64);
    else                localStorage.removeItem(LS_AVATAR);
  }
  // Async backup to IndexedDB
  void CS.saveProfile(loadProfileFromLocal());
}

export function loadProfileFromLocal(): ProfileRecord {
  return {
    userId:    getUserId(),
    name:      localStorage.getItem(LS_USERNAME)  ?? 'Athlete',
    bio:       localStorage.getItem(LS_BIO)       ?? '',
    avatarB64: localStorage.getItem(LS_AVATAR)    ?? null,
    city:      localStorage.getItem(LS_CITY)      ?? '',
    region:    localStorage.getItem(LS_REGION)    ?? '',
    birthDate: localStorage.getItem(LS_BIRTHDATE) ?? null,
    gender:    (localStorage.getItem(LS_GENDER) as 'male'|'female'|'other'|null) ?? null,
    weightKg:  localStorage.getItem(LS_WEIGHT) ? Number(localStorage.getItem(LS_WEIGHT)) : null,
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
  return `https://mapyou.app/add-friend?userId=${getUserId()}`;
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

        <!-- Location -->
        <div class="up-field up-field--row">
          <div class="up-field__half">
            <label class="up-label" for="upCity">City</label>
            <input class="up-input" id="upCity" type="text"
              value="${profile.city ?? ''}" maxlength="64" placeholder="e.g. Warsaw"/>
          </div>
          <div class="up-field__half">
            <label class="up-label" for="upRegion">Region
              <span style="opacity:.4;font-size:0.9rem">(auto)</span>
            </label>
            <input class="up-input" id="upRegion" type="text"
              value="${profile.region ?? ''}" maxlength="64" placeholder="auto-filled" readonly style="opacity:.6"/>
          </div>
        </div>

        <!-- Personal -->
        <div class="up-field up-field--row">
          <div class="up-field__half">
            <label class="up-label" for="upGender">Gender</label>
            <select class="up-input up-select" id="upGender">
              <option value="">—</option>
              <option value="male"   ${profile.gender === 'male'   ? 'selected' : ''}>Male</option>
              <option value="female" ${profile.gender === 'female' ? 'selected' : ''}>Female</option>
              <option value="other"  ${profile.gender === 'other'  ? 'selected' : ''}>Other</option>
            </select>
          </div>
          <div class="up-field__half">
            <label class="up-label" for="upWeight">Weight (kg)</label>
            <input class="up-input" id="upWeight" type="number"
              value="${profile.weightKg ?? ''}" min="30" max="250" placeholder="70"/>
          </div>
        </div>

        <!-- Birth date -->
        <div class="up-field">
          <label class="up-label" for="upBirthDate">Date of birth</label>
          <input class="up-input" id="upBirthDate" type="date"
            value="${profile.birthDate ?? ''}"/>
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

  // Auto-fill region from city via Nominatim
  let _nomTimer: ReturnType<typeof setTimeout>;
  el.querySelector('#upCity')?.addEventListener('input', e => {
    const cityVal  = (e.target as HTMLInputElement).value.trim();
    const regionEl = el.querySelector<HTMLInputElement>('#upRegion')!;
    clearTimeout(_nomTimer);
    if (cityVal.length < 3) { regionEl.value = ''; return; }
    _nomTimer = setTimeout(async () => {
      try {
        const res  = await fetch(
          `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(cityVal)}&format=json&limit=1&addressdetails=1`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await res.json() as { address?: { state?: string; county?: string } }[];
        const addr = data[0]?.address;
        if (addr) regionEl.value = addr.state ?? addr.county ?? '';
      } catch { /* offline */ }
    }, 600);
  });

  // Save
  el.querySelector('#upSave')?.addEventListener('click', () => {
    const name      = el.querySelector<HTMLInputElement>('#upName')?.value.trim()      ?? '';
    const bio       = el.querySelector<HTMLTextAreaElement>('#upBio')?.value.trim()    ?? '';
    const city      = el.querySelector<HTMLInputElement>('#upCity')?.value.trim()      ?? '';
    const region    = el.querySelector<HTMLInputElement>('#upRegion')?.value.trim()    ?? '';
    const gender    = (el.querySelector<HTMLSelectElement>('#upGender')?.value || null) as 'male'|'female'|'other'|null;
    const weightVal = el.querySelector<HTMLInputElement>('#upWeight')?.value;
    const weightKg  = weightVal ? Number(weightVal) : null;
    const birthDate = el.querySelector<HTMLInputElement>('#upBirthDate')?.value || null;
    const avatarB64 = (avatarPreview.dataset.pending ?? null) as string | null;

    if (!name) {
      el.querySelector<HTMLInputElement>('#upName')?.focus();
      el.querySelector<HTMLInputElement>('#upName')?.classList.add('up-input--error');
      return;
    }

    saveProfileToLocal({ name, bio, city, region, gender, weightKg, birthDate, avatarB64: avatarB64 ?? undefined });
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
