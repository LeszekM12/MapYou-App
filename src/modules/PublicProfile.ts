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
  isPending?:     boolean;
  isPrivate?:     boolean;
  weeklyWins:     number;
  bestStreak:     number;
}

interface FeedItem {
  kind: string;
  date: number;
  data: Record<string, unknown>;
}

import { getIcon as _getIcon, getColor as _getColor, getSportLabel as _getSportLabel } from './Tracker.js';

function _relDate(ts: number | string): string {
  return new Date(typeof ts === 'number' ? ts : ts).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}
function _fmtDur(sec: number): string {
  const m = Math.floor(sec / 60);
  return m >= 60 ? `${Math.floor(m/60)}h ${m%60}m` : `${m}m`;
}

async function _showFollowList(title: string, userIds: string[], myUserId: string, parent: HTMLElement): Promise<void> {
  document.getElementById('ppFollowListModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'ppFollowListModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(0,0,0,0.7);display:flex;align-items:flex-end';
  modal.innerHTML = `
    <div style="width:100%;max-height:75vh;background:#1a1f23;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <span style="font-size:1.7rem;font-weight:700;color:#fff">${title}</span>
        <button id="ppFlClose" style="background:rgba(255,255,255,0.08);border:none;color:#aaa;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.3rem">✕</button>
      </div>
      <div id="ppFlBody" style="overflow-y:auto;padding:8px 0 32px">
        <div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">Loading…</div>
      </div>
    </div>`;
  parent.appendChild(modal);
  modal.querySelector('#ppFlClose')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  const body = modal.querySelector<HTMLElement>('#ppFlBody')!;
  if (!userIds.length) { body.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">No users yet</div>'; return; }
  const users = await Promise.all(userIds.slice(0,50).map(uid =>
    fetch(`${BACKEND_URL}/users/${encodeURIComponent(uid)}`)
      .then(r => r.json())
      .then((d: {status:string;data:{userId:string;name:string;avatarB64:string|null}}) =>
        d.status === 'ok' ? d.data : { userId: uid, name: uid.slice(0,10)+'…', avatarB64: null })
      .catch(() => ({ userId: uid, name: uid.slice(0,10)+'…', avatarB64: null }))
  ));
  body.innerHTML = users.map(u => `
    <div data-uid="${u.userId}" style="display:flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer">
      <div style="width:44px;height:44px;border-radius:50%;overflow:hidden;background:#333;flex-shrink:0">
        ${u.avatarB64 ? `<img src="${u.avatarB64}" style="width:100%;height:100%;object-fit:cover"/>` : `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff">${u.name[0]}</div>`}
      </div>
      <span style="font-size:1.4rem;font-weight:600;color:#fff;flex:1">${u.name}</span>
      ${u.userId === myUserId ? '<span style="font-size:1.1rem;color:rgba(255,255,255,0.3)">You</span>' : ''}
    </div>`).join('');
  body.querySelectorAll<HTMLElement>('[data-uid]').forEach(el => {
    el.addEventListener('click', () => {
      const uid = el.dataset.uid!;
      modal.remove();
      if (uid !== myUserId) openPublicProfile(uid);
    });
  });
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
    const [profileRes, feedRes, reelRes] = await Promise.all([
      fetch(`${BACKEND_URL}/users/public/${encodeURIComponent(targetUserId)}?viewerId=${encodeURIComponent(myUserId)}`, { cache: 'no-store' }),
      fetch(`${BACKEND_URL}/users/${encodeURIComponent(targetUserId)}/feed?viewerId=${encodeURIComponent(myUserId)}`, { cache: 'no-store' }),
      fetch(`${BACKEND_URL}/reels/feed?userId=${encodeURIComponent(targetUserId)}`, { cache: 'no-store' }),
    ]);

    const profile: PublicProfileData = profileRes.ok
      ? (await profileRes.json() as { status: string; data: PublicProfileData }).data
      : { userId: targetUserId, name: 'MapYou User', bio: '', avatarB64: null, followersCount: 0, followingCount: 0, isFollowing: false, weeklyWins: 0, bestStreak: 0 };

    const feedData: FeedItem[] = feedRes.ok
      ? (await feedRes.json() as { data: FeedItem[] }).data ?? []
      : [];

    // Check if target user has reels and if viewer has seen them
    type ReelGroup = { userId: string; reels: { id: string; views: string[] }[]; hasUnseen: boolean };
    const reelGroups: ReelGroup[] = reelRes?.ok
      ? ((await reelRes.json() as { data: ReelGroup[] }).data ?? [])
      : [];
    const targetReelGroup = reelGroups.find(g => g.userId === targetUserId);
    const hasReels   = !!targetReelGroup && targetReelGroup.reels.length > 0;
    const hasUnseen  = hasReels && targetReelGroup!.reels.some(r => !r.views.includes(myUserId));

    // Inject avatar and name into all items
    feedData.forEach(f => {
      f.data.authorAvatarUrl = profile.avatarB64 ?? null;
      f.data.authorName      = f.data.authorName ?? profile.name;
    });

    const activities = feedData.filter(f => f.kind === 'activity');
    const posts      = feedData.filter(f => f.kind === 'post');

    _renderFull(overlay, sheet, profile, activities, posts, myUserId, hasReels, hasUnseen, targetReelGroup);
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
  overlay:         HTMLElement,
  sheet:           HTMLElement,
  profile:         PublicProfileData,
  activities:      FeedItem[],
  posts:           FeedItem[],
  myUserId:        string,
  hasReels:        boolean = false,
  hasUnseen:       boolean = false,
  targetReelGroup: unknown = null,
): void {
  const totalKm = activities.reduce((s, a) => s + (+(a.data.distanceKm ?? 0)), 0);
  const avatarHtml = profile.avatarB64
    ? `<img src="${profile.avatarB64}" class="pv-avatar__img" alt="avatar"/>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="44" height="44"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`;

  const reelRingClass = hasReels
    ? (hasUnseen ? 'pv-avatar--reel-active' : 'pv-avatar--reel-seen')
    : '';

  const tmp = document.createElement('div');
  tmp.innerHTML = `
    <div class="pv-handle"></div>
    <div class="pv-header">
      <button class="pv-back" id="ppBack">←</button>
      <div class="pv-header__actions">
        <button class="pv-header__btn ${profile.isFollowing ? '' : (profile.isPending ? 'pv-header__btn--pending' : 'pv-header__btn--follow')}" id="ppFollowBtn">
          ${profile.isFollowing ? '✓ Following' : profile.isPending ? '⏳ Pending' : profile.isPrivate ? 'Request' : 'Follow'}
        </button>
      </div>
    </div>
    <div class="pv-hero">
      <div class="pv-avatar ${reelRingClass}" id="ppAvatarReel" style="${hasReels ? 'cursor:pointer' : ''}">${avatarHtml}</div>
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
    <div id="ppPhotoStrip" class="pv-photo-strip"></div>
    <div id="ppPrivateSection"></div>
  `;

  sheet.innerHTML = '';
  while (tmp.firstChild) sheet.appendChild(tmp.firstChild);

  // Build private section or tabs
  const privSection = sheet.querySelector<HTMLElement>('#ppPrivateSection')!;
  if (profile.isPrivate && !profile.isFollowing) {
    privSection.innerHTML = '<div class="pv-private-box"><div class="pv-private-box__icon">🔒</div><div class="pv-private-box__title">This profile is private</div><div class="pv-private-box__desc">Follow to see activities and posts.</div></div>';
  } else {
    privSection.innerHTML = '<div class="pv-subtabs" id="ppSubtabs"><button class="pv-subtab pv-subtab--active" data-pp="activities">Activities</button><button class="pv-subtab" data-pp="stats">Stats</button><button class="pv-subtab" data-pp="efforts">Best Efforts</button><button class="pv-subtab" data-pp="trophies">Trophies</button><button class="pv-subtab" data-pp="posts">Posts</button></div><div class="pv-content" id="ppContent"></div>';
  }
  sheet.querySelector('#ppBack')?.addEventListener('click', closePublicProfile);
  _bindSwipe(sheet);

  // Reel avatar click
  if (hasReels && targetReelGroup) {
    sheet.querySelector('#ppAvatarReel')?.addEventListener('click', () => {
      import('./HomeView.js').then(m => {
        const mod = m as Record<string, unknown>;
        if (typeof mod.openReelViewer === 'function') {
          (mod.openReelViewer as (group: unknown, onClose: () => void) => void)(targetReelGroup, () => {
            // After viewing — update ring to seen
            const avatarEl = sheet.querySelector<HTMLElement>('#ppAvatarReel');
            if (avatarEl) {
              avatarEl.classList.remove('pv-avatar--reel-active');
              avatarEl.classList.add('pv-avatar--reel-seen');
            }
          });
        }
      });
    });
  }

  // Render photo strip — only when profile is public or user is following
  if (!profile.isPrivate || profile.isFollowing) {
    _renderPhotoStrip(sheet, activities, posts, overlay);
  }

  // Followers / Following lists — use profile.userId (in scope here)
  sheet.querySelector('#ppFollowersBtn')?.addEventListener('click', async () => {
    const res  = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(profile.userId)}`);
    const data = await res.json() as { status: string; data: { followers?: string[] } };
    if (data.status === 'ok') void _showFollowList('Followers', data.data.followers ?? [], myUserId, overlay);
  });
  sheet.querySelector('#ppFollowingBtn')?.addEventListener('click', async () => {
    const res  = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(profile.userId)}`);
    const data = await res.json() as { status: string; data: { following?: string[] } };
    if (data.status === 'ok') void _showFollowList('Following', data.data.following ?? [], myUserId, overlay);
  });

  // Follow
  const followBtn = sheet.querySelector<HTMLButtonElement>('#ppFollowBtn')!;
  let isFollowing = profile.isFollowing && !profile.isPending;
  let isPending   = profile.isPending ?? false;

  const updateFollowBtn = () => {
    if (isFollowing) {
      followBtn.textContent = '✓ Following';
      followBtn.className   = 'pv-header__btn';
    } else if (isPending) {
      followBtn.textContent = '⏳ Pending';
      followBtn.className   = 'pv-header__btn pv-header__btn--pending';
    } else {
      followBtn.textContent = profile.isPrivate ? 'Request' : 'Follow';
      followBtn.className   = 'pv-header__btn pv-header__btn--follow';
    }
  };
  updateFollowBtn();

  followBtn.addEventListener('click', async () => {
    followBtn.disabled = true;
    try {
      if (isFollowing) {
        // Unfollow
        const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(profile.userId)}`, { method: 'DELETE' });
        if (res.ok) { isFollowing = false; isPending = false; }
      } else if (isPending) {
        // Cancel request
        const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow-cancel/${encodeURIComponent(profile.userId)}`, { method: 'POST' });
        if (res.ok) { isPending = false; }
      } else if (profile.isPrivate) {
        // Send follow request — do NOT follow directly
        const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow-request/${encodeURIComponent(profile.userId)}`, { method: 'POST' });
        if (res.ok) { isPending = true; }
      } else {
        // Follow public profile directly
        const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(profile.userId)}`, { method: 'POST' });
        if (res.ok) { isFollowing = true; }
      }
      updateFollowBtn();
      const countEl = sheet.querySelector<HTMLElement>('#ppFollowersCount');
      if (countEl && isFollowing) countEl.textContent = String(parseInt(countEl.textContent ?? '0', 10) + 1);
    } catch {}
    followBtn.disabled = false;
  });

  // Sub-tabs
  const content = sheet.querySelector<HTMLElement>('#ppContent');
  if (!content) return; // private profile — no tabs
  _renderActivitiesTab(content, activities);
  sheet.querySelectorAll<HTMLElement>('.pv-subtab').forEach(btn => {
    btn.addEventListener('click', () => {
      sheet.querySelectorAll('.pv-subtab').forEach(b => b.classList.remove('pv-subtab--active'));
      btn.classList.add('pv-subtab--active');
      const tab = btn.dataset.pp!;
      if (tab === 'activities')   _renderActivitiesTab(content, activities);
      else if (tab === 'stats')   _renderStatsTab(content, activities);
      else if (tab === 'efforts') _renderEffortsTab(content, activities);
      else if (tab === 'trophies') _renderTrophiesTab(content, activities, profile.weeklyWins ?? 0, profile.bestStreak ?? 0);
      else _renderPostsTab(content, posts);
    });
  });
}



// ── Trophy helpers (identical to ProfileView) ─────────────────────────────────

interface Trophy {
  id: string; label: string; desc: string;
  unlocked: boolean; count?: number; color: string; icon: string;
}

function _nth(n: number): string {
  if (n === 1) return 'st'; if (n === 2) return 'nd'; if (n === 3) return 'rd'; return 'th';
}

function _activityTrophies(count: number): Trophy[] {
  const milestones = [1, 3, 5, 10, 25, 50, 100];
  return milestones.map(m => ({
    id: `act_${m}`,
    label: m === 1 ? 'First activity' : `${m}${_nth(m)} activity`,
    desc: m === 1 ? 'You started your journey!' : `Completed ${m} activities`,
    unlocked: count >= m, count: m,
    color: count >= m ? '#f97316' : '#374151',
    icon: count >= m ? '⚡' : '🔒',
  }));
}

function _streakTrophies(best: number): Trophy[] {
  if (best < 7) return [{
    id: 'streak_7', label: '7-day streak', desc: 'Train 7 days in a row',
    unlocked: false, count: 7, color: '#374151', icon: '🔒',
  }];
  const trophies: Trophy[] = [];
  for (let d = 7; d <= best; d++) {
    trophies.push({
      id: `streak_${d}`, label: `${d}-day streak`,
      desc: `Trained ${d} days in a row! 🔥`, unlocked: true, count: d,
      color: d >= 30 ? '#eab308' : d >= 14 ? '#f97316' : '#00c46a', icon: '🔥',
    });
  }
  trophies.push({
    id: `streak_${best+1}`, label: `${best+1}-day streak`,
    desc: `Train ${best+1} days in a row`, unlocked: false,
    count: best+1, color: '#374151', icon: '🔒',
  });
  return trophies;
}

function _weeklyTrophies(wins: number): Trophy[] {
  const milestones = [1, 4, 8, 12, 26, 52];
  const labels = ['First week goal', '1 month streak', '2 month streak', '3 month streak', 'Half year', '1 year!'];
  return milestones.map((m, i) => ({
    id: `wk_${m}`, label: labels[i],
    desc: wins >= m ? `${wins} weekly goals reached!` : `Reach your weekly goal ${m} time${m>1?'s':''}`,
    unlocked: wins >= m, count: m,
    color: wins >= m ? '#eab308' : '#374151',
    icon: wins >= m ? '🏆' : '🔒',
  }));
}

function _buildTrophySVG(trophy: Trophy): string {
  const fill = trophy.unlocked ? trophy.color : '#1f2937';
  const glow = trophy.unlocked ? `filter:drop-shadow(0 0 8px ${trophy.color}88)` : '';
  const count = trophy.count ?? '?';
  return `
  <div class="pv-trophy ${trophy.unlocked ? 'pv-trophy--unlocked' : ''}" title="${trophy.desc}">
    <div class="pv-trophy__gem" style="${glow}">
      <svg viewBox="0 0 80 90" width="64" height="72">
        <polygon points="40,2 78,22 78,68 40,88 2,68 2,22"
          fill="${fill}" stroke="${trophy.unlocked ? trophy.color : '#374151'}" stroke-width="2"/>
        ${trophy.unlocked
          ? `<polygon points="40,12 68,28 68,62 40,78 12,62 12,28" fill="${fill}cc"/>
             <text x="40" y="50" text-anchor="middle" font-size="22" font-weight="900"
               font-family="Manrope,sans-serif" fill="white">${count}</text>
             <text x="40" y="65" text-anchor="middle" font-size="11"
               font-family="Manrope,sans-serif" fill="rgba(255,255,255,0.7)">${trophy.icon === '🏆' ? '🏆' : '⚡'}</text>`
          : `<text x="40" y="52" text-anchor="middle" font-size="24" fill="#4b5563">🔒</text>`}
      </svg>
    </div>
    <span class="pv-trophy__label">${trophy.label}</span>
  </div>`;
}

interface BestEffort { label: string; distM: number; timeStr: string | null; date: string | null; }

function _fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function _bestEffortsFromFeed(activities: FeedItem[]): BestEffort[] {
  const distances = [
    { label: '400 m', m: 400 }, { label: '1 km', m: 1000 },
    { label: '1 mile', m: 1609 }, { label: '5 km', m: 5000 }, { label: '10 km', m: 10000 },
  ];
  return distances.map(({ label, m }) => {
    let bestSec: number | null = null;
    let bestDate: string | null = null;
    activities
      .filter(a => a.data.sport === 'running' && +(a.data.distanceKm ?? 0) * 1000 >= m)
      .forEach(a => {
        const pace = +(a.data.paceMinKm ?? 0);
        if (pace > 0 && pace < 30) {
          const sec = Math.round(pace * 60 * (m / 1000));
          if (bestSec === null || sec < bestSec) {
            bestSec = sec;
            bestDate = String(a.date);
          }
        }
      });
    return { label, distM: m, timeStr: bestSec !== null ? _fmtTime(bestSec) : null, date: bestDate };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

let _ppPieChart:   unknown = null;
let _ppStatsChart: unknown = null;
let _ppWeekOffset  = 0;
let _ppActiveSport = 'all';

function _renderStatsTab(el: HTMLElement, activities: FeedItem[]): void {
  const Chart = (window as unknown as Record<string,unknown>).Chart as new (el: HTMLCanvasElement, cfg: unknown) => unknown;

  const sportSet  = new Set(activities.map(a => (a.data.sport ?? 'running') as string));
  const sports    = ['all', ...Array.from(sportSet)];
  const pillsHtml = sports.map(s => {
    const icon  = s === 'all' ? '🏅' : _getIcon(s);
    const label = s === 'all' ? 'All' : _getSportLabel(s);
    return `<button class="pv-stats-sport-pill${s === _ppActiveSport ? ' pv-stats-sport-pill--active' : ''}" data-sport="${s}">${icon} ${label}</button>`;
  }).join('');

  el.style.padding = '0 0 32px';
  el.innerHTML = `
    <div class="pv-stats-pills">${pillsHtml}</div>
    <div class="pv-stats-summary">
      <div class="pv-stats-summary__item">
        <span class="pv-stats-summary__val" id="ppStatsKm">0.0</span>
        <span class="pv-stats-summary__unit">km</span>
      </div>
      <div class="pv-stats-summary__item">
        <span class="pv-stats-summary__val" id="ppStatsTime">0m</span>
        <span class="pv-stats-summary__unit">time</span>
      </div>
      <div class="pv-stats-summary__item">
        <span class="pv-stats-summary__val" id="ppStatsActs">0</span>
        <span class="pv-stats-summary__unit">activities</span>
      </div>
    </div>
    <div class="pv-stats-week-nav">
      <button class="pv-stats-nav-btn" id="ppStatsPrev">‹</button>
      <span class="pv-stats-week-label" id="ppStatsWeekLabel">This week</span>
      <button class="pv-stats-nav-btn" id="ppStatsNext" disabled>›</button>
    </div>
    <div class="pv-stats-chart-wrap">
      <canvas id="ppStatsChart" role="img" aria-label="Weekly activity chart"></canvas>
    </div>
    <div class="pv-section-title" style="padding:16px 16px 8px;margin-top:8px">Activity Types</div>
    <div class="pv-types-wrap">
      ${sportSet.size === 0
        ? '<p class="pv-empty-sub" style="padding:0 16px">No data yet</p>'
        : (() => {
            const counts = [...sportSet]
              .map(type => ({ type, cnt: activities.filter(a => (a.data.sport ?? 'running') === type).length }))
              .sort((a, b) => b.cnt - a.cnt);
            const max = Math.max(...counts.map(c => c.cnt), 1);
            return counts.map(({ type, cnt }) => `
              <div class="pv-type-row">
                <span class="pv-type-row__label">${_getIcon(type)} ${_getSportLabel(type)}</span>
                <div class="pv-type-row__track">
                  <div class="pv-type-row__bar" style="width:${Math.round((cnt / max) * 100)}%"></div>
                </div>
                <span class="pv-type-row__count">${cnt}</span>
              </div>`).join('');
          })()}
    </div>`;

  const renderWeek = () => {
    const now = new Date();
    const mon = new Date(now);
    const dow = mon.getDay() || 7;
    mon.setHours(0,0,0,0);
    mon.setDate(mon.getDate() - dow + 1 + _ppWeekOffset * 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
    const todayIdx = _ppWeekOffset === 0 ? ((now.getDay() + 6) % 7) : 6;
    const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

    const week = activities.filter(a => {
      const d = new Date(a.date);
      return d >= mon && d <= sun &&
        (_ppActiveSport === 'all' || (a.data.sport ?? 'running') === _ppActiveSport);
    });

    const wKm  = week.reduce((s,a) => s + ((a.data.distanceKm ?? 0) as number), 0);
    const wSec = week.reduce((s,a) => s + ((a.data.durationSec ?? 0) as number), 0);
    const wCnt = week.length;

    const kmEl   = document.getElementById('ppStatsKm');
    const timeEl = document.getElementById('ppStatsTime');
    const actsEl = document.getElementById('ppStatsActs');
    if (kmEl)   kmEl.textContent   = wKm.toFixed(1);
    if (timeEl) timeEl.textContent = wSec >= 3600 ? `${Math.floor(wSec/3600)}h ${Math.floor((wSec%3600)/60)}m` : `${Math.floor(wSec/60)}m`;
    if (actsEl) actsEl.textContent = String(wCnt);

    const lbl = document.getElementById('ppStatsWeekLabel');
    if (lbl) lbl.textContent = _ppWeekOffset === 0 ? 'This week'
      : `${mon.toLocaleDateString('en',{month:'short',day:'numeric'})} – ${sun.toLocaleDateString('en',{month:'short',day:'numeric'})}`;
    (document.getElementById('ppStatsNext') as HTMLButtonElement|null)
      ?.[_ppWeekOffset < 0 ? 'removeAttribute' : 'setAttribute']('disabled','');

    const isDark = document.body.classList.contains('night-mode');
    const sportColor = _ppActiveSport === 'all' ? '#00c46a' : _getColor(_ppActiveSport);
    const daySec: number[]    = Array(7).fill(0);
    const dayColors: string[] = Array(7).fill('rgba(0,196,106,0.12)');
    week.forEach(a => {
      const i = Math.floor((new Date(a.date).getTime() - mon.getTime()) / 86_400_000);
      if (i >= 0 && i < 7) { daySec[i] += (a.data.durationSec ?? 0) as number; dayColors[i] = i <= todayIdx ? sportColor : sportColor + '55'; }
    });

    const gridClr = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)';
    const tickClr = isDark ? '#6c7175' : '#999';
    const lblClr  = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.45)';
    const canvas  = document.getElementById('ppStatsChart') as HTMLCanvasElement | null;
    if (!canvas || !Chart) return;
    if (_ppStatsChart) (_ppStatsChart as Record<string,()=>void>).destroy?.();
    _ppStatsChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: DAYS.map((d,i) => { const dd = new Date(mon); dd.setDate(mon.getDate()+i); return `${d} ${dd.getDate()}`; }),
        datasets: [{ data: daySec, backgroundColor: dayColors, borderRadius: 6, borderSkipped: false }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: gridClr }, ticks: { color: tickClr, font: { size: 10 } } },
          y: { display: false, beginAtZero: true },
        },
        animation: { onComplete: function() {
          const ch = this as unknown as Record<string,unknown>;
          const ctx = ch.ctx as CanvasRenderingContext2D;
          const meta = (ch.getDatasetMeta as (i:number)=>{data:{x:number;y:number}[]})(0);
          ctx.save(); ctx.fillStyle = lblClr; ctx.font = '10px Manrope,sans-serif'; ctx.textAlign = 'center';
          meta.data.forEach((bar,i) => {
            const sec = daySec[i];
            if (sec > 0) {
              const h = Math.floor(sec / 3600);
              const m = Math.round((sec % 3600) / 60);
              ctx.fillText(h > 0 ? `${h}h ${m}min` : `${m}min`, bar.x, bar.y - 4);
            }
          });
          ctx.restore();
        }},
      },
    });
  };

  setTimeout(renderWeek, 50);

  // Events
  el.querySelectorAll<HTMLElement>('.pv-stats-sport-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      el.querySelectorAll('.pv-stats-sport-pill').forEach(p => p.classList.remove('pv-stats-sport-pill--active'));
      pill.classList.add('pv-stats-sport-pill--active');
      _ppActiveSport = pill.dataset.sport ?? 'all';
      renderWeek();
    });
  });
  document.getElementById('ppStatsPrev')?.addEventListener('click', () => { _ppWeekOffset--; renderWeek(); });
  document.getElementById('ppStatsNext')?.addEventListener('click', () => { if (_ppWeekOffset >= 0) return; _ppWeekOffset++; renderWeek(); });
}

function _renderEffortsTab(el: HTMLElement, activities: FeedItem[]): void {
  const efforts = _bestEffortsFromFeed(activities);
  el.innerHTML = `
    <div class="pv-section-title">Personal Bests (Running)</div>
    <div class="pv-efforts">
      ${efforts.map(e => `
        <div class="pv-effort ${e.timeStr ? 'pv-effort--set' : ''}">
          <span class="pv-effort__dist">${e.label}</span>
          <div class="pv-effort__right">
            ${e.timeStr
              ? `<span class="pv-effort__time">${e.timeStr}</span>
                 <span class="pv-effort__date">${e.date ? _relDate(Number(e.date)) : ''}</span>`
              : `<span class="pv-effort__empty">—</span>`}
          </div>
        </div>`).join('')}
    </div>
    <p class="pv-efforts__note">Calculated from GPS-tracked running activities only.</p>`;
}

function _renderTrophiesTab(el: HTMLElement, activities: FeedItem[], weeklyWins: number, bestStreak: number): void {
  const actTrophies    = _activityTrophies(activities.length);
  const wkTrophies     = _weeklyTrophies(weeklyWins);
  const streakTrophies = _streakTrophies(bestStreak);
  const totalUnlocked  = [...actTrophies, ...wkTrophies, ...streakTrophies].filter(t => t.unlocked).length;

  el.innerHTML = `
    <div class="pv-trophy-summary">
      <span class="pv-trophy-summary__count">${totalUnlocked}</span>
      <span class="pv-trophy-summary__label">trophies unlocked</span>
    </div>

    ${weeklyWins > 0 ? `
    <div class="pv-goal-cup">
      <span class="pv-goal-cup__icon">🏆</span>
      <div class="pv-goal-cup__info">
        <span class="pv-goal-cup__title">Weekly goal achieved <strong>${weeklyWins}×</strong></span>
        <span class="pv-goal-cup__sub">Keep crushing your goals!</span>
      </div>
    </div>` : ''}

    <div class="pv-section-title">⚡ Activity Milestones</div>
    <div class="pv-trophy-grid">${actTrophies.map(_buildTrophySVG).join('')}</div>

    <div class="pv-section-title" style="margin-top:24px">🏆 Weekly Goal Cups</div>
    <div class="pv-trophy-grid">${wkTrophies.map(_buildTrophySVG).join('')}</div>

    <div class="pv-section-title" style="margin-top:24px">🔥 Streak Records${bestStreak >= 7 ? ` <span style="color:#f97316;font-size:1.1rem">(Best: ${bestStreak} days)</span>` : ''}</div>
    <div class="pv-trophy-grid pv-trophy-grid--scroll">${streakTrophies.map(_buildTrophySVG).join('')}</div>`;
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
      <span class="pv-act-item__icon">${_getIcon(sport)}</span>
      <div class="pv-act-item__info">
        <span class="pv-act-item__name">${(d.name ?? d.description ?? sport) as string}</span>
        <span class="pv-act-item__date">${_relDate(a.date)}</span>
      </div>
      <div class="pv-act-item__stats">
        <span style="color:${_getColor(sport)}">${(+(d.distanceKm ?? 0)).toFixed(2)} km</span>
        <span class="pv-act-item__time">${_fmtDur(+(d.durationSec ?? 0))}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
}

// ── Like/Comment helper ──────────────────────────────────────────────────────

function _actionsHtml(itemId: string, itemType: 'post'|'activity', likeCount = 0, commentCount = 0): string {
  return `<div class="home-card__footer" style="border-top:1px solid rgba(255,255,255,0.06)">
    <button class="home-card__action home-card__action--like" data-item-id="${itemId}" data-item-type="${itemType}" aria-label="Like">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
      </svg>
      <span class="home-card__action-count" data-like-count="${itemId}">${likeCount}</span>
    </button>
    <button class="home-card__action home-card__action--comment" data-item-id="${itemId}" data-item-type="${itemType}" aria-label="Comment">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <span class="home-card__action-count" data-comment-count="${itemId}">${commentCount}</span>
    </button>
  </div>`;
}

function _attachLikeComment(card: HTMLElement, itemId: string, itemType: 'post'|'activity'): void {
  const userId   = localStorage.getItem('mapyou_userId_profile') ?? '';
  const userName = localStorage.getItem('mapyou_name') ?? '';

  // Like
  card.querySelector<HTMLElement>('.home-card__action--like')?.addEventListener('click', async e => {
    e.stopPropagation();
    const btn = e.currentTarget as HTMLElement;
    btn.classList.add('home-card__action--pulse');
    setTimeout(() => btn.classList.remove('home-card__action--pulse'), 400);
    const res  = await fetch(`${BACKEND_URL}/feed/like`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, itemId, itemType }),
    }).catch(() => null);
    if (res?.ok) {
      const d = await res.json() as { liked: boolean; count: number };
      btn.classList.toggle('home-card__action--liked', d.liked);
      const el = card.querySelector<HTMLElement>(`[data-like-count="${itemId}"]`);
      if (el) el.textContent = String(d.count);
    }
  });

  // Fetch initial like state
  void fetch(`${BACKEND_URL}/feed/likes/${encodeURIComponent(itemId)}?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' })
    .then(r => r.json())
    .then((d: { liked: boolean; count: number }) => {
      const btn = card.querySelector<HTMLElement>('.home-card__action--like');
      if (btn) btn.classList.toggle('home-card__action--liked', d.liked);
      const el = card.querySelector<HTMLElement>(`[data-like-count="${itemId}"]`);
      if (el) el.textContent = String(d.count);
    }).catch(() => {});

  // Comment
  card.querySelector<HTMLElement>('.home-card__action--comment')?.addEventListener('click', e => {
    e.stopPropagation();
    import('./HomeView.js').then((mod) => {
      const fn = (mod as unknown as Record<string,(c:HTMLElement,id:string)=>void>).openCommentPanel;
      if (fn) fn(card, itemId);
    });
  });
}

function _renderPostsTab(el: HTMLElement, posts: FeedItem[]): void {
  const visible = posts.filter(p => p.data.type !== 'club_event' && !p.data.clubOnly);
  if (!visible.length) {
    el.innerHTML = '<div class="pv-empty"><div class="pv-empty__icon">📝</div><p>No posts yet</p></div>';
    return;
  }
  el.innerHTML = '';
  el.style.padding = '12px 16px 32px';
  visible.forEach(p => {
    const d    = p.data;
    const card = document.createElement('div');
    card.className = 'feed-card';
    const avImg = d.authorAvatarUrl
      ? `<img src="${d.authorAvatarUrl as string}" loading="lazy" onerror="this.style.display='none'"/>`
      : ``;
    card.innerHTML = `
      <div class="feed-card__header">
        <div class="feed-card__avatar">${avImg || ((d.authorName as string)?.[0] ?? '?')}</div>
        <div class="feed-card__meta">
          <span class="feed-card__author">${(d.authorName ?? '') as string}</span>
          <span class="feed-card__date">${_relDate(p.date)}</span>
        </div>
      </div>
      ${d.photoUrl ? `<img class="feed-card__photo" src="${d.photoUrl as string}" loading="lazy"/>` : ''}
      <div class="feed-card__body">
        ${d.title ? `<div class="feed-card__title">${d.title as string}</div>` : ''}
        ${d.body  ? `<div class="feed-card__text">${d.body as string}</div>` : ''}
      </div>
      ${_actionsHtml((d.postId ?? d._id ?? '') as string, 'post', (d._likeCount ?? 0) as number, (d._commentCount ?? 0) as number)}`;
    const itemId = (d.postId ?? (d._id as Record<string,unknown>|undefined)?.toString?.() ?? '') as string;
    el.appendChild(card);
    _attachLikeComment(card, itemId, 'post');
  });
}

// ── Photo strip + viewer ──────────────────────────────────────────────────────

function _renderPhotoStrip(sheet: HTMLElement, activities: FeedItem[], posts: FeedItem[], overlay: HTMLElement): void {
  const strip = sheet.querySelector<HTMLElement>('#ppPhotoStrip');
  if (!strip) return;
  const photos: { url: string; title: string }[] = [];
  [...activities, ...posts.filter(p => !p.data.clubOnly && p.data.type !== 'club_event')].forEach(f => {
    if (f.data.photoUrl) photos.push({ url: f.data.photoUrl as string, title: (f.data.name ?? f.data.title ?? '') as string });
  });
  if (!photos.length) { strip.style.display = 'none'; return; }
  const MAX = 4;
  strip.innerHTML = photos.slice(0, MAX).map((ph, i) => `
    <div data-pi="${i}" class="pv-photo-strip__thumb">
      <img src="${ph.url}" loading="lazy"/>
      ${photos.length > MAX && i === MAX - 1 ? `<div class="pv-photo-strip__more">+${photos.length - MAX + 1}</div>` : ''}
    </div>`).join('');
  strip.querySelectorAll<HTMLElement>('[data-pi]').forEach(el => {
    el.addEventListener('click', () => _openPhotoViewer(photos, overlay));
  });
}

function _openPhotoViewer(photos: { url: string; title: string }[], parent: HTMLElement): void {
  document.getElementById('ppPhotoViewer')?.remove();
  const viewer = document.createElement('div');
  viewer.id        = 'ppPhotoViewer';
  viewer.className = 'pv-photo-viewer';
  let mode: 'grid' | 'list' = 'grid';
  const render = () => {
    viewer.innerHTML = `
      <div class="pv-photo-viewer__header">
        <button id="pvClose" class="pv-photo-viewer__close">✕</button>
        <div class="pv-photo-viewer__tabs">
          <button id="pvGrid" class="pv-photo-viewer__tab${mode==='grid'?' pv-photo-viewer__tab--active':''}">Grid</button>
          <button id="pvList" class="pv-photo-viewer__tab${mode==='list'?' pv-photo-viewer__tab--active':''}">List</button>
        </div>
        <div style="width:40px"></div>
      </div>
      <div id="pvBody" class="pv-photo-viewer__body">
        ${mode === 'grid'
          ? `<div class="pv-photo-viewer__grid">${photos.map((ph, i) => `<div data-vi="${i}" class="pv-photo-viewer__grid-item"><img src="${ph.url}" loading="lazy"/></div>`).join('')}</div>`
          : `<div>${photos.map((ph, i) => `<div data-vi="${i}" class="pv-photo-viewer__list-item">${ph.title ? `<div class="pv-photo-viewer__list-title">${ph.title}</div>` : ''}<img class="pv-photo-viewer__list-img" src="${ph.url}" loading="lazy"/></div>`).join('')}</div>`}
      </div>`;
    viewer.querySelector('#pvClose')?.addEventListener('click', () => viewer.remove());
    viewer.querySelector('#pvGrid')?.addEventListener('click', () => { mode = 'grid'; render(); });
    viewer.querySelector('#pvList')?.addEventListener('click', () => { mode = 'list'; render(); });
    viewer.querySelectorAll<HTMLElement>('[data-vi]').forEach(el => {
      el.addEventListener('click', () => {
        const src = (el.querySelector('img') as HTMLImageElement).src;
        const big = document.createElement('div');
        big.className = 'pv-photo-viewer__enlarge';
        big.innerHTML = `<img src="${src}"/>`;
        big.addEventListener('click', () => big.remove());
        document.body.appendChild(big);
      });
    });
  };
  render();
  document.body.appendChild(viewer);
}

export function closePublicProfile(): void {
  const overlay = document.getElementById('publicProfileOverlay');
  if (!overlay) return;
  overlay.querySelector<HTMLElement>('.pv-sheet')?.classList.remove('pv-sheet--open');
  overlay.classList.remove('pv-overlay--visible');
  setTimeout(() => overlay.remove(), 360);
}
