// ─── PUBLIC PROFILE ──────────────────────────────────────────────────────────
// src/modules/PublicProfile.ts
//
// Modal pokazujący profil innego użytkownika z przyciskiem Follow.
// Kliknięcie avatara w feedzie → otwiera ten modal.
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
// ── Open public profile modal ─────────────────────────────────────────────────
export async function openPublicProfile(targetUserId) {
    const myUserId = getUserId();
    // Własny profil — nie otwieraj publicznego
    if (targetUserId === myUserId)
        return;
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
        setTimeout(() => modal.querySelector('.pp-sheet')?.classList.add('pv-sheet--open'), 10);
    });
    // Close on backdrop click
    modal.addEventListener('click', e => { if (e.target === modal)
        closePublicProfile(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape')
        closePublicProfile(); }, { once: true });
    // Fetch profile
    try {
        const res = await fetch(`${BACKEND_URL}/users/public/${encodeURIComponent(targetUserId)}?viewerId=${encodeURIComponent(myUserId)}`);
        if (!res.ok) {
            closePublicProfile();
            return;
        }
        const d = await res.json();
        if (d.status !== 'ok') {
            closePublicProfile();
            return;
        }
        _renderProfile(modal, d.data, myUserId);
    }
    catch {
        closePublicProfile();
    }
}
function _renderProfile(modal, profile, myUserId) {
    const sheet = modal.querySelector('.pp-sheet');
    const avatarHtml = profile.avatarB64
        ? `<img src="${profile.avatarB64}" class="pv-avatar__img" alt="avatar"/>`
        : `<div class="pv-avatar">${profile.name.charAt(0).toUpperCase()}</div>`;
    sheet.innerHTML = `
    <div class="pv-handle"></div>

    <div class="pv-header">
      <button class="pv-back" id="ppClose">✕</button>
    </div>

    <div class="pv-content">
      <div class="pv-avatar">${avatarHtml}</div>
      <h2 class="pv-name">${profile.name}</h2>
      ${profile.bio ? `<p class="pv-bio">${profile.bio}</p>` : ''}

      <div class="pv-stats-row">
        <div class="pv-stats-row__item">
          <span class="pv-stats-row__val">${profile.followersCount}</span>
          <span class="pv-stats-row__lbl">Followers</span>
        </div>
        <div class="pv-stats-row__item">
          <span class="pv-stats-row__val">${profile.followingCount}</span>
          <span class="pv-stats-row__lbl">Following</span>
        </div>
      </div>

      <button class="pp-follow-btn ${profile.isFollowing ? 'pv-header__btn pv-header__btn--following' : ''}" id="ppFollowBtn">
        ${profile.isFollowing ? 'Following ✓' : 'Follow'}
      </button>
    </div>`;
    // Close
    sheet.querySelector('#ppClose')?.addEventListener('click', closePublicProfile);
    // Follow / Unfollow
    const followBtn = sheet.querySelector('#ppFollowBtn');
    let isFollowing = profile.isFollowing;
    followBtn.addEventListener('click', async () => {
        followBtn.disabled = true;
        try {
            const method = isFollowing ? 'DELETE' : 'POST';
            const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(profile.userId)}`, { method });
            if (res.ok) {
                isFollowing = !isFollowing;
                followBtn.textContent = isFollowing ? 'Following ✓' : 'Follow';
                followBtn.classList.toggle('pv-header__btn pv-header__btn--following', isFollowing);
                // Update followers count
                const followerEl = sheet.querySelector('.pp-stat__val');
                if (followerEl) {
                    const current = parseInt(followerEl.textContent ?? '0', 10);
                    followerEl.textContent = String(isFollowing ? current + 1 : Math.max(0, current - 1));
                }
            }
        }
        catch { }
        followBtn.disabled = false;
    });
    // Swipe to close
    const handle = sheet.querySelector('.pp-handle');
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
            closePublicProfile();
        else
            sheet.style.transform = '';
    });
}
export function closePublicProfile() {
    const modal = document.getElementById('publicProfileModal');
    if (!modal)
        return;
    modal.querySelector('.pp-sheet')?.classList.remove('pv-sheet--open');
    modal.classList.remove('pv-overlay--visible');
    setTimeout(() => modal.remove(), 350);
}
//# sourceMappingURL=PublicProfile.js.map