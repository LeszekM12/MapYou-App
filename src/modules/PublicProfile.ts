// ─── PUBLIC PROFILE ──────────────────────────────────────────────────────────
// src/modules/PublicProfile.ts
//
// Modal pokazujący profil innego użytkownika z przyciskiem Follow.
// Kliknięcie avatara w feedzie → otwiera ten modal.

import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';

interface PublicProfileData {
  userId:         string;
  name:           string;
  bio:            string;
  avatarB64:      string | null;
  followersCount: number;
  followingCount: number;
  isFollowing:    boolean;
}

// ── Open public profile modal ─────────────────────────────────────────────────

export async function openPublicProfile(targetUserId: string): Promise<void> {
  const myUserId = getUserId();

  // Własny profil — nie otwieraj publicznego
  if (targetUserId === myUserId) return;

  document.getElementById('publicProfileModal')?.remove();

  // Loading skeleton
  const modal = document.createElement('div');
  modal.id = 'publicProfileModal';
  modal.className = 'pv-overlay';
  modal.innerHTML = `
    <div class="pv-sheet" id="ppSheet">
      <div class="pv-handle"></div>
      <div class="pv-empty">
        <div class="home-loading__spinner"></div>
      </div>
    </div>`;
  document.body.appendChild(modal);

  requestAnimationFrame(() => {
    modal.classList.add('pv-overlay--visible');
    setTimeout(() => modal.querySelector<HTMLElement>('.pv-sheet')?.classList.add('pv-sheet--open'), 10);
  });

  // Close on backdrop click
  modal.addEventListener('click', e => { if (e.target === modal) closePublicProfile(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closePublicProfile(); }, { once: true });

  // Fetch profile
  try {
    const res = await fetch(
      `${BACKEND_URL}/users/public/${encodeURIComponent(targetUserId)}?viewerId=${encodeURIComponent(myUserId)}`,
      { cache: 'no-store' }
    );
    if (!res.ok) {
      // User not in Atlas yet — show basic modal with just userId
      _renderProfile(modal, {
        userId: targetUserId,
        name: 'MapYou User',
        bio: '',
        avatarB64: null,
        followersCount: 0,
        followingCount: 0,
        isFollowing: false,
      }, myUserId);
      return;
    }
    const d = await res.json() as { status: string; data: PublicProfileData };
    if (d.status !== 'ok') { closePublicProfile(); return; }

    _renderProfile(modal, d.data, myUserId);
  } catch {
    closePublicProfile();
  }
}

function _renderProfile(modal: HTMLElement, profile: PublicProfileData, myUserId: string): void {
  const sheet = modal.querySelector<HTMLElement>('.pv-sheet')!;

  const avatarHtml = profile.avatarB64
    ? `<img src="${profile.avatarB64}" class="pv-avatar__img" alt="avatar"/>`
    : `<div style="width:100%;height:100%;background:rgba(74,222,128,0.15);display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:700;color:#4ade80">${profile.name.charAt(0).toUpperCase()}</div>`;

  const tmp = document.createElement('div');
  tmp.innerHTML = `
    <div class="pv-handle"></div>
    <div class="pv-header">
      <button class="pv-back" id="ppClose">‹</button>
      <div class="pv-header__actions">
        <button class="pv-header__btn ${profile.isFollowing ? 'pv-header__btn--active' : 'pv-header__btn--follow'}" id="ppFollowBtn">
          ${profile.isFollowing ? 'Following ✓' : 'Follow'}
        </button>
      </div>
    </div>
    <div class="pv-content">
      <div class="pv-hero">
        <div class="pv-avatar">${avatarHtml}</div>
        <div class="pv-hero__info">
          <h2 class="pv-name">${profile.name}</h2>
          ${profile.bio ? `<p class="pv-bio">${profile.bio}</p>` : ''}
        </div>
      </div>
      <div class="pv-stats-row">
        <div class="pv-stats-row__item">
          <span class="pv-stats-row__val" id="ppFollowersCount">${profile.followersCount}</span>
          <span class="pv-stats-row__lbl">Followers</span>
        </div>
        <div class="pv-stats-row__item">
          <span class="pv-stats-row__val">${profile.followingCount}</span>
          <span class="pv-stats-row__lbl">Following</span>
        </div>
      </div>
    </div>`;

  // Zachowaj pv-sheet--open — podmień tylko dzieci
  sheet.innerHTML = '';
  while (tmp.firstChild) sheet.appendChild(tmp.firstChild);

  sheet.querySelector('#ppClose')?.addEventListener('click', closePublicProfile);

  const followBtn = sheet.querySelector<HTMLButtonElement>('#ppFollowBtn')!;
  let isFollowing = profile.isFollowing;

  followBtn.addEventListener('click', async () => {
    followBtn.disabled = true;
    try {
      const method = isFollowing ? 'DELETE' : 'POST';
      const res = await fetch(
        `${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(profile.userId)}`,
        { method }
      );
      if (res.ok) {
        isFollowing = !isFollowing;
        followBtn.textContent = isFollowing ? 'Following ✓' : 'Follow';
        followBtn.classList.toggle('pv-header__btn--active', isFollowing);
        followBtn.classList.toggle('pv-header__btn--follow', !isFollowing);
        const followerEl = sheet.querySelector<HTMLElement>('#ppFollowersCount');
        if (followerEl) {
          const current = parseInt(followerEl.textContent ?? '0', 10);
          followerEl.textContent = String(isFollowing ? current + 1 : Math.max(0, current - 1));
        }
      }
    } catch {}
    followBtn.disabled = false;
  });

  const handle = sheet.querySelector<HTMLElement>('.pv-handle')!;
  let startY = 0;
  handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchmove', e => {
    const d = e.touches[0].clientY - startY;
    if (d > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${d}px)`; }
  }, { passive: true });
  handle.addEventListener('touchend', e => {
    sheet.style.transition = '';
    if (e.changedTouches[0].clientY - startY > 100) closePublicProfile();
    else sheet.style.transform = '';
  });
}


export function closePublicProfile(): void {
  const modal = document.getElementById('publicProfileModal');
  if (!modal) return;
  modal.querySelector<HTMLElement>('.pv-sheet')?.classList.remove('pv-sheet--open');
  modal.classList.remove('pv-overlay--visible');
  setTimeout(() => modal.remove(), 350);
}
