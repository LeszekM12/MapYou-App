// ─── PUBLIC PROFILE ──────────────────────────────────────────────────────────
// src/modules/PublicProfile.ts
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
const SPORT_ICONS = { running: '🏃', walking: '🚶', cycling: '🚴' };
const SPORT_COLORS = { running: '#00c46a', walking: '#5badea', cycling: '#ffb545' };
function _relDate(ts) {
    return new Date(typeof ts === 'number' ? ts : ts).toLocaleDateString('en', { month: 'short', day: 'numeric', year: 'numeric' });
}
function _fmtDur(sec) {
    const m = Math.floor(sec / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}
export async function openPublicProfile(targetUserId) {
    const myUserId = getUserId();
    if (targetUserId === myUserId)
        return;
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
        setTimeout(() => overlay.querySelector('.pv-sheet')?.classList.add('pv-sheet--open'), 10);
    });
    overlay.querySelector('#ppBack')?.addEventListener('click', closePublicProfile);
    overlay.addEventListener('click', e => { if (e.target === overlay)
        closePublicProfile(); });
    const sheet = overlay.querySelector('.pv-sheet');
    _bindSwipe(sheet);
    try {
        const [profileRes, feedRes] = await Promise.all([
            fetch(`${BACKEND_URL}/users/public/${encodeURIComponent(targetUserId)}?viewerId=${encodeURIComponent(myUserId)}`, { cache: 'no-store' }),
            fetch(`${BACKEND_URL}/feed?userId=${encodeURIComponent(targetUserId)}`, { cache: 'no-store' }),
        ]);
        const profile = profileRes.ok
            ? (await profileRes.json()).data
            : { userId: targetUserId, name: 'MapYou User', bio: '', avatarB64: null, followersCount: 0, followingCount: 0, isFollowing: false, weeklyWins: 0, bestStreak: 0 };
        const feedData = feedRes.ok
            ? (await feedRes.json()).data ?? []
            : [];
        const userItems = feedData.filter(f => f.data.userId === targetUserId);
        const activities = userItems.filter(f => f.kind === 'activity');
        const posts = userItems.filter(f => f.kind === 'post');
        _renderFull(overlay, sheet, profile, activities, posts, myUserId);
    }
    catch {
        closePublicProfile();
    }
}
function _bindSwipe(sheet) {
    const handle = sheet.querySelector('.pv-handle');
    if (!handle)
        return;
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
            closePublicProfile();
        else
            sheet.style.transform = '';
    });
}
function _renderFull(overlay, sheet, profile, activities, posts, myUserId) {
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
      <button class="pv-subtab" data-pp="stats">Stats</button>
      <button class="pv-subtab" data-pp="efforts">Best Efforts</button>
      <button class="pv-subtab" data-pp="trophies">Trophies</button>
      <button class="pv-subtab" data-pp="posts">Posts</button>
    </div>
    <div class="pv-content" id="ppContent"></div>`;
    sheet.innerHTML = '';
    while (tmp.firstChild)
        sheet.appendChild(tmp.firstChild);
    sheet.querySelector('#ppBack')?.addEventListener('click', closePublicProfile);
    _bindSwipe(sheet);
    // Follow
    const followBtn = sheet.querySelector('#ppFollowBtn');
    let isFollowing = profile.isFollowing;
    followBtn.addEventListener('click', async () => {
        followBtn.disabled = true;
        try {
            const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(myUserId)}/follow/${encodeURIComponent(profile.userId)}`, { method: isFollowing ? 'DELETE' : 'POST' });
            if (res.ok) {
                isFollowing = !isFollowing;
                followBtn.textContent = isFollowing ? '✓ Following' : 'Follow';
                followBtn.classList.toggle('pv-header__btn--follow', !isFollowing);
                const el = sheet.querySelector('#ppFollowersCount');
                if (el)
                    el.textContent = String(Math.max(0, parseInt(el.textContent ?? '0', 10) + (isFollowing ? 1 : -1)));
            }
        }
        catch { }
        followBtn.disabled = false;
    });
    // Sub-tabs
    const content = sheet.querySelector('#ppContent');
    _renderActivitiesTab(content, activities);
    sheet.querySelectorAll('.pv-subtab').forEach(btn => {
        btn.addEventListener('click', () => {
            sheet.querySelectorAll('.pv-subtab').forEach(b => b.classList.remove('pv-subtab--active'));
            btn.classList.add('pv-subtab--active');
            const tab = btn.dataset.pp;
            if (tab === 'activities')
                _renderActivitiesTab(content, activities);
            else if (tab === 'stats')
                _renderStatsTab(content, activities);
            else if (tab === 'efforts')
                _renderEffortsTab(content, activities);
            else if (tab === 'trophies')
                _renderTrophiesTab(content, activities, profile.weeklyWins ?? 0, profile.bestStreak ?? 0);
            else
                _renderPostsTab(content, posts);
        });
    });
}
function _nth(n) {
    if (n === 1)
        return 'st';
    if (n === 2)
        return 'nd';
    if (n === 3)
        return 'rd';
    return 'th';
}
function _activityTrophies(count) {
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
function _streakTrophies(best) {
    if (best < 7)
        return [{
                id: 'streak_7', label: '7-day streak', desc: 'Train 7 days in a row',
                unlocked: false, count: 7, color: '#374151', icon: '🔒',
            }];
    const trophies = [];
    for (let d = 7; d <= best; d++) {
        trophies.push({
            id: `streak_${d}`, label: `${d}-day streak`,
            desc: `Trained ${d} days in a row! 🔥`, unlocked: true, count: d,
            color: d >= 30 ? '#eab308' : d >= 14 ? '#f97316' : '#00c46a', icon: '🔥',
        });
    }
    trophies.push({
        id: `streak_${best + 1}`, label: `${best + 1}-day streak`,
        desc: `Train ${best + 1} days in a row`, unlocked: false,
        count: best + 1, color: '#374151', icon: '🔒',
    });
    return trophies;
}
function _weeklyTrophies(wins) {
    const milestones = [1, 4, 8, 12, 26, 52];
    const labels = ['First week goal', '1 month streak', '2 month streak', '3 month streak', 'Half year', '1 year!'];
    return milestones.map((m, i) => ({
        id: `wk_${m}`, label: labels[i],
        desc: wins >= m ? `${wins} weekly goals reached!` : `Reach your weekly goal ${m} time${m > 1 ? 's' : ''}`,
        unlocked: wins >= m, count: m,
        color: wins >= m ? '#eab308' : '#374151',
        icon: wins >= m ? '🏆' : '🔒',
    }));
}
function _buildTrophySVG(trophy) {
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
function _fmtTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}
function _bestEffortsFromFeed(activities) {
    const distances = [
        { label: '400 m', m: 400 }, { label: '1 km', m: 1000 },
        { label: '1 mile', m: 1609 }, { label: '5 km', m: 5000 }, { label: '10 km', m: 10000 },
    ];
    return distances.map(({ label, m }) => {
        let bestSec = null;
        let bestDate = null;
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
function _heatmap(activities) {
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    activities.forEach(a => {
        const d = new Date(a.date);
        grid[d.getDay()][d.getHours()]++;
    });
    return grid;
}
function _renderStatsTab(el, activities) {
    const heatmap = _heatmap(activities);
    const maxHeat = Math.max(...heatmap.flat(), 1);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}`);
    const typeCounts = {};
    activities.forEach(a => {
        const t = (a.data.sport ?? 'running');
        typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    });
    el.innerHTML = `
    <div class="pv-section-title">Activity Heatmap</div>
    <div class="pv-heatmap-wrap">
      <div class="pv-heatmap">
        <div class="pv-heatmap__hour-labels">
          <span></span>
          ${hours.map(h => `<span>${h}</span>`).join('')}
        </div>
        ${heatmap.map((row, di) => `
          <div class="pv-heatmap__row">
            <span class="pv-heatmap__day">${days[di]}</span>
            ${row.map(v => `<div class="pv-heatmap__cell" style="background:rgba(0,196,106,${v > 0 ? 0.15 + (v / maxHeat) * 0.85 : 0})"></div>`).join('')}
          </div>`).join('')}
      </div>
    </div>
    <div class="pv-section-title" style="margin-top:16px">Sport breakdown</div>
    <div style="padding:0 16px">
      ${Object.entries(typeCounts).map(([type, count]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
          <span style="color:#fff;font-size:1.3rem">${SPORT_ICONS[type] ?? '🏅'} ${type}</span>
          <span style="color:${SPORT_COLORS[type] ?? '#00c46a'};font-weight:700">${count}</span>
        </div>`).join('')}
    </div>`;
}
function _renderEffortsTab(el, activities) {
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
function _renderTrophiesTab(el, activities, weeklyWins, bestStreak) {
    const actTrophies = _activityTrophies(activities.length);
    const wkTrophies = _weeklyTrophies(weeklyWins);
    const streakTrophies = _streakTrophies(bestStreak);
    const totalUnlocked = [...actTrophies, ...wkTrophies, ...streakTrophies].filter(t => t.unlocked).length;
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
function _renderActivitiesTab(el, activities) {
    if (!activities.length) {
        el.innerHTML = `<div class="pv-empty"><div class="pv-empty__icon">🏁</div><p>No activities yet</p></div>`;
        return;
    }
    el.innerHTML = `<div class="pv-act-list">${activities.slice(0, 20).map(a => {
        const d = a.data;
        const sport = (d.sport ?? 'running');
        return `<div class="pv-act-item">
      <span class="pv-act-item__icon">${SPORT_ICONS[sport] ?? '🏅'}</span>
      <div class="pv-act-item__info">
        <span class="pv-act-item__name">${(d.name ?? d.description ?? sport)}</span>
        <span class="pv-act-item__date">${_relDate(a.date)}</span>
      </div>
      <div class="pv-act-item__stats">
        <span style="color:${SPORT_COLORS[sport] ?? '#00c46a'}">${(+(d.distanceKm ?? 0)).toFixed(2)} km</span>
        <span class="pv-act-item__time">${_fmtDur(+(d.durationSec ?? 0))}</span>
      </div>
    </div>`;
    }).join('')}</div>`;
}
function _renderPostsTab(el, posts) {
    if (!posts.length) {
        el.innerHTML = `<div class="pv-empty"><div class="pv-empty__icon">📝</div><p>No posts yet</p></div>`;
        return;
    }
    el.innerHTML = `<div class="pv-posts-list">${posts.map(p => {
        const d = p.data;
        return `<div class="pv-post-item">
      ${d.photoUrl ? `<div class="pv-post-item__photo"><img src="${d.photoUrl}" loading="lazy"/></div>` : ''}
      <div class="pv-post-item__body">
        <span class="pv-post-item__title">${(d.title ?? '')}</span>
        <span class="pv-post-item__date">${_relDate(p.date)}</span>
        ${d.body ? `<p class="pv-post-item__text">${d.body.slice(0, 120)}${d.body.length > 120 ? '…' : ''}</p>` : ''}
      </div>
    </div>`;
    }).join('')}</div>`;
}
export function closePublicProfile() {
    const overlay = document.getElementById('publicProfileOverlay');
    if (!overlay)
        return;
    overlay.querySelector('.pv-sheet')?.classList.remove('pv-sheet--open');
    overlay.classList.remove('pv-overlay--visible');
    setTimeout(() => overlay.remove(), 360);
}
//# sourceMappingURL=PublicProfile.js.map