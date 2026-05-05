// ─── PUBLIC PROFILE ──────────────────────────────────────────────────────────
// src/modules/PublicProfile.ts

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

interface FeedItem {
  kind: string;
  date: number;
  data: Record<string, unknown>;
}

const SPORT_ICONS: Record<string, string> = { running: '🏃', walking: '🚶', cycling: '🚴' };
const SPORT_COLORS: Record<string, string> = { running: '#00c46a', walking: '#5badea', cycling: '#ffb545' };

function _relDate(ts: number | string): string {
  return new Date(typeof ts === 'number' ? ts : ts).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}
function _fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
}

export async function openPublicProfile(targetUserId: string): Promise<void> {
  const myUserId = getUserId();
  if (targetUserId === myUserId) return;

  document.getElementById('publicProfileOverlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'publicProfileOverlay';
  overlay.className = 'pv-overlay';
  overlay.innerHTML = `
    <div class="pv-sheet" id="ppSheet">
      <div class="pv-handle"></div>
      <div class="pv-header">
        <button class="pv-back" id="ppBack">←</button>
        <div class="pv-header__actions">
          <button class="pv-header__btn pv-header__btn--follow" id="ppFollowBtn" disabled>Follow</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;justify-content:center;padding:60px">
        <div class="home-loading__spinner"></div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.classList.add('pv-overlay--visible');
    setTimeout(() => overlay.querySelector<HTMLElement>('.pv-sheet')?.classList.add('pv-sheet--open'), 10);
  });

  overlay.querySelector('#ppBack')?.addEventListener('click', closePublicProfile);
  overlay.addEventListener('click', e => { if (e.target === overlay) closePublicProfile(); });

  const sheet = overlay.querySelector<HTMLElement>('.pv-sheet')!;
  _bindSwipe(sheet);

  try {
    const [profileRes, feedRes] = await Promise.all([
      fetch(`${BACKEND_URL}/users/public/${encodeURIComponent(targetUserId)}?viewerId=${encodeURIComponent(myUserId)}`, { cache: 'no-store' }),
      fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(targetUserId)}`, { cache: 'no-store' }),
    ]);

    const profile: PublicProfileData = profileRes.ok
      ? (await profileRes.json() as { status: string; data: PublicProfileData }).data
      : { userId: targetUserId, name: 'MapYou User', bio: '', avatarB64: null, followersCount: 0, followingCount: 0, isFollowing: false };

    const feedData: FeedItem[] = feedRes.ok
      ? (await feedRes.json() as { data: FeedItem[] }).data ?? []
      : [];

    const userItems  = feedData.filter(f => f.data.userId === targetUserId);
    const activities = userItems.filter(f => f.kind === 'activity');
    const posts      = userItems.filter(f => f.kind === 'post');

    _renderFull(overlay, sheet, profile, activities, posts, myUserId);
  } catch {
    closePublicProfile();
  }
}

function _bindSwipe(sheet: HTMLElement): void {
  const handle = sheet.querySelector<HTMLElement>('.pv-handle');
  if (!handle) return;
  let startY = 0;
  handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchmove', e => {
    const d = e.touches[0].clientY - startY;
    if (d > 0) { sheet.style.transition = 'none'; sheet.style.transform = `translateY(${d}px)`; }
  }, { passive: true });
  handle.addEventListener('touchend', e => {
    sheet.style.transition = '';
    if (e.changedTouches[0].clientY - startY > 120) closePublicProfile();
    else sheet.style.transform = '';
  });
}

function _renderFull(
  overlay:    HTMLElement,
  sheet:      HTMLElement,
  profile:    PublicProfileData,
  activities: FeedItem[],
  posts:      FeedItem[],
  myUserId:   string,
): void {
  const totalKm = activities.reduce((s, a) => s + (+(a.data.distanceKm ?? 0)), 0);
  const avatarHtml = profile.avatarB64
    ? `<img src="${profile.avatarB64}" class="pv-avatar__img" alt="avatar"/>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="44" height="44"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;

  const tmp = document.createElement('div');
  tmp.innerHTML = `
    <div class="pv-handle"></div>
    <div class="pv-header">
      <button class="pv-back" id="ppBack">←</button>
      <div class="pv-header__actions">
        <button class="pv-header__btn ${profile.isFollowing ? '' : 'pv-header__btn--follow'}" id="ppFollowBtn">
          ${profile.isFollowing ? '✓ Following' : 'Follow'}
        </button>
      </div>
    </div>
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
      <div class="pv-stats-row__item">
        <span class="pv-stats-row__val">${activities.length}</span>
        <span class="pv-stats-row__lbl">Activities</span>
      </div>
      <div class="pv-stats-row__item">
        <span class="pv-stats-row__val">${totalKm.toFixed(0)}</span>
        <span class="pv-stats-row__lbl">km total</span>
      </div>
    </div>
    <div class="pv-subtabs">
      <button class="pv-subtab pv-subtab--active" data-pp="activities">Activities</button>
      <button class="pv-subtab" data-pp="posts">Posts</button>
    </div>
    <div class="pv-content" id="ppContent"></div>`;

  sheet.innerHTML = '';
  while (tmp.firstChild) sheet.appendChild(tmp.firstChild);

  sheet.querySelector('#ppBack')?.addEventListener('click', closePublicProfile);
  _bindSwipe(sheet);

  // Follow
  const followBtn = sheet.querySelector<HTMLButtonElement>('#ppFollowBtn')!;
  let isFollowing = profile.isFollowing;
  followBtn.addEventListener('click', async () => {
    followBtn.disabled = true;
    try {
      const res = await fetch(
        `${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(profile.userId)}`,
        { method: isFollowing ? 'DELETE' : 'POST' }
      );
      if (res.ok) {
        isFollowing = !isFollowing;
        followBtn.textContent = isFollowing ? '✓ Following' : 'Follow';
        followBtn.classList.toggle('pv-header__btn--follow', !isFollowing);
        const el = sheet.querySelector<HTMLElement>('#ppFollowersCount');
        if (el) el.textContent = String(Math.max(0, parseInt(el.textContent ?? '0', 10) + (isFollowing ? 1 : -1)));
      }
    } catch {}
    followBtn.disabled = false;
  });

  // Sub-tabs
  const content = sheet.querySelector<HTMLElement>('#ppContent')!;
  _renderActivitiesTab(content, activities);
  sheet.querySelectorAll<HTMLElement>('.pv-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      sheet.querySelectorAll('.pv-subtab').forEach(b => b.classList.remove('pv-subtab--active'));
      btn.classList.add('pv-subtab--active');
      if (btn.dataset.pp === 'activities') _renderActivitiesTab(content, activities);
      else _renderPostsTab(content, posts);
    });
  });
}

function _renderActivitiesTab(el: HTMLElement, activities: FeedItem[]): void {
  if (!activities.length) {
    el.innerHTML = `<div class="pv-empty"><div class="pv-empty__icon">🏁</div><p>No activities yet</p></div>`;
    return;
  }
  el.innerHTML = `<div class="pv-act-list">${activities.slice(0, 20).map(a => {
    const d = a.data;
    const sport = (d.sport ?? 'running') as string;
    return `<div class="pv-act-item">
      <span class="pv-act-item__icon">${SPORT_ICONS[sport] ?? '🏅'}</span>
      <div class="pv-act-item__info">
        <span class="pv-act-item__name">${(d.name ?? d.description ?? sport) as string}</span>
        <span class="pv-act-item__date">${_relDate(a.date)}</span>
      </div>
      <div class="pv-act-item__stats">
        <span style="color:${SPORT_COLORS[sport] ?? '#00c46a'}">${(+(d.distanceKm ?? 0)).toFixed(2)} km</span>
        <span class="pv-act-item__time">${_fmtDur(+(d.durationSec ?? 0))}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

function _renderPostsTab(el: HTMLElement, posts: FeedItem[]): void {
  if (!posts.length) {
    el.innerHTML = `<div class="pv-empty"><div class="pv-empty__icon">📝</div><p>No posts yet</p></div>`;
    return;
  }
  el.innerHTML = `<div class="pv-posts-list">${posts.map(p => {
    const d = p.data;
    return `<div class="pv-post-item">
      ${d.photoUrl ? `<div class="pv-post-item__photo"><img src="${d.photoUrl}" loading="lazy"/></div>` : ''}
      <div class="pv-post-item__body">
        <span class="pv-post-item__title">${(d.title ?? '') as string}</span>
        <span class="pv-post-item__date">${_relDate(p.date)}</span>
        ${d.body ? `<p class="pv-post-item__text">${(d.body as string).slice(0, 120)}${(d.body as string).length > 120 ? '…' : ''}</p>` : ''}
      </div>
    </div>`;
  }).join('')}</div>`;
}

export function closePublicProfile(): void {
  const overlay = document.getElementById('publicProfileOverlay');
  if (!overlay) return;
  overlay.querySelector<HTMLElement>('.pv-sheet')?.classList.remove('pv-sheet--open');
  overlay.classList.remove('pv-overlay--visible');
  setTimeout(() => overlay.remove(), 360);
}
