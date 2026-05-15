// ─── PROFILE VIEW ─────────────────────────────────────────────────────────────
// src/modules/ProfileView.ts
//
// Strava-style profile sheet with:
// - Avatar, name, bio, followers/following (placeholder)
// - Sub-tabs: Activities, Stats, Best Efforts, Posts
// - Trophies: activity milestones + weekly goal cups
// - Heatmap (day × hour) + activity type pie chart
import { loadUnifiedWorkouts, SPORT_ICONS_U, SPORT_COLORS_U, formatDurSec } from './UnifiedWorkout.js';
import { BACKEND_URL } from '../config.js';
import { loadProfileFromLocal, getUserId } from './UserProfile.js';
import { loadPosts } from './db.js';
// ── Constants ─────────────────────────────────────────────────────────────────
const LS_WEEKLY_WINS = 'mapyou_weekly_wins'; // number — count of weeks goal was hit
const LS_GOAL_WEEK = 'mapyou_last_goal_week'; // ISO week string — last week goal was checked
// ── Weekly goal win tracking (called from StatsView when goal reached) ─────────
function _syncStatsToAtlas() {
    const userId = localStorage.getItem('mapyou_userId_profile');
    const weeklyWins = parseInt(localStorage.getItem(LS_WEEKLY_WINS) ?? '0', 10);
    const bestStreak = parseInt(localStorage.getItem('mapyou_best_streak') ?? '0', 10);
    if (!userId)
        return;
    void fetch(`${BACKEND_URL}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, weeklyWins, bestStreak }),
    }).catch(() => { });
}
export function recordWeeklyGoalWin() {
    const now = new Date();
    const weekKey = `${now.getFullYear()}-W${_isoWeek(now)}`;
    if (localStorage.getItem(LS_GOAL_WEEK) === weekKey)
        return; // already counted this week
    localStorage.setItem(LS_GOAL_WEEK, weekKey);
    const prev = parseInt(localStorage.getItem(LS_WEEKLY_WINS) ?? '0', 10);
    localStorage.setItem(LS_WEEKLY_WINS, String(prev + 1));
}
function _isoWeek(d) {
    const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7));
    const year = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
    return Math.ceil((((tmp.getTime() - year.getTime()) / 86400000) + 1) / 7);
}
function _activityTrophies(workouts) {
    const cnt = workouts.length;
    const milestones = [1, 3, 5, 10, 25, 50, 100];
    return milestones.map(m => ({
        id: `act_${m}`,
        label: m === 1 ? 'First activity' : `${m}${_nth(m)} activity`,
        desc: m === 1 ? 'You started your journey!' : `Completed ${m} activities`,
        unlocked: cnt >= m,
        count: m,
        color: cnt >= m ? '#f97316' : '#374151',
        icon: cnt >= m ? '⚡' : '🔒',
    }));
}
const LS_BEST_STREAK = 'mapyou_best_streak';
export function updateBestStreak(currentStreak) {
    const prev = parseInt(localStorage.getItem(LS_BEST_STREAK) ?? '0', 10);
    if (currentStreak > prev)
        localStorage.setItem(LS_BEST_STREAK, String(currentStreak));
}
export function getBestStreak() {
    return parseInt(localStorage.getItem(LS_BEST_STREAK) ?? '0', 10);
}
function _streakTrophies() {
    const best = getBestStreak();
    // Every day from 7 onwards is its own trophy
    const trophies = [];
    if (best < 7) {
        // Not yet unlocked — show locked milestone
        trophies.push({
            id: 'streak_7', label: '7-day streak', desc: 'Train 7 days in a row',
            unlocked: false, count: 7, color: '#374151', icon: '🔒',
        });
        return trophies;
    }
    // Show unlocked from 7 up to best, then next locked one
    for (let d = 7; d <= best; d++) {
        trophies.push({
            id: `streak_${d}`,
            label: `${d}-day streak`,
            desc: `You trained ${d} days in a row! 🔥`,
            unlocked: true,
            count: d,
            color: d >= 30 ? '#eab308' : d >= 14 ? '#f97316' : '#00c46a',
            icon: '🔥',
        });
    }
    // Next locked milestone
    trophies.push({
        id: `streak_${best + 1}`, label: `${best + 1}-day streak`,
        desc: `Train ${best + 1} days in a row`, unlocked: false,
        count: best + 1, color: '#374151', icon: '🔒',
    });
    return trophies;
}
function _weeklyTrophies() {
    const wins = parseInt(localStorage.getItem(LS_WEEKLY_WINS) ?? '0', 10);
    const milestones = [1, 4, 8, 12, 26, 52];
    const labels = ['First week goal', '1 month streak', '2 month streak', '3 month streak', 'Half year', '1 year!'];
    return milestones.map((m, i) => ({
        id: `wk_${m}`,
        label: labels[i],
        desc: wins >= m ? `${wins} weekly goals reached!` : `Reach your weekly goal ${m} time${m > 1 ? 's' : ''}`,
        unlocked: wins >= m,
        count: m,
        color: wins >= m ? '#eab308' : '#374151',
        icon: wins >= m ? '🏆' : '🔒',
    }));
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
function _bestEfforts(workouts) {
    const distances = [
        { label: '400 m', m: 400 },
        { label: '1 km', m: 1000 },
        { label: '1 mile', m: 1609 },
        { label: '5 km', m: 5000 },
        { label: '10 km', m: 10000 },
    ];
    return distances.map(({ label, m }) => {
        let bestSec = null;
        let bestDate = null;
        workouts
            .filter(w => w.source === 'tracking' && w.coords.length > 1 && w.distanceKm * 1000 >= m)
            .forEach(w => {
            // Estimate split time from pace
            if (w.paceMinKm > 0 && w.paceMinKm < 30) {
                const sec = Math.round(w.paceMinKm * 60 * (m / 1000));
                if (bestSec === null || sec < bestSec) {
                    bestSec = sec;
                    bestDate = w.date;
                }
            }
        });
        return {
            label,
            distM: m,
            timeStr: bestSec !== null ? _fmtTime(bestSec) : null,
            date: bestDate,
        };
    });
}
function _fmtTime(sec) {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0)
        return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}
// ── Heatmap data ──────────────────────────────────────────────────────────────
function _heatmapData(workouts) {
    // [day 0-6][hour 0-23]
    const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
    workouts.forEach(w => {
        const d = new Date(w.date);
        grid[d.getDay()][d.getHours()]++;
    });
    return grid;
}
// ── Profile HTML builder ──────────────────────────────────────────────────────
function _relDate(iso) {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const days = Math.floor(diff / 86400000);
    if (days === 0)
        return 'Today';
    if (days === 1)
        return 'Yesterday';
    if (days < 7)
        return `${days}d ago`;
    return d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
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
// ── Main class ────────────────────────────────────────────────────────────────
let _pieChart = null;
export class ProfileView {
    constructor() {
        Object.defineProperty(this, "_workouts", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "_posts", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "_subTab", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'activities'
        });
    }
    async open() {
        document.getElementById('profileViewOverlay')?.remove();
        _pieChart = null;
        const [workouts, posts] = await Promise.all([
            loadUnifiedWorkouts(),
            loadPosts(),
        ]);
        this._workouts = workouts;
        this._posts = posts;
        const profile = loadProfileFromLocal();
        const el = this._buildShell(profile);
        document.body.appendChild(el);
        requestAnimationFrame(() => {
            el.classList.add('pv-overlay--visible');
            setTimeout(() => el.querySelector('.pv-sheet')?.classList.add('pv-sheet--open'), 10);
        });
        this._bindEvents(el);
        this._renderSubTab('activities', el);
        // Pobierz followers/following z Atlas w tle
        const userId = profile.userId;
        if (userId) {
            fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}`, { cache: 'no-store' })
                .then(r => r.json())
                .then((d) => {
                if (d.status !== 'ok')
                    return;
                const followersEl = el.querySelector('.pv-stats-row__item:nth-child(1) .pv-stats-row__val');
                const followingEl = el.querySelector('.pv-stats-row__item:nth-child(2) .pv-stats-row__val');
                const followers = d.data.followers ?? [];
                const following = d.data.following ?? [];
                if (followersEl)
                    followersEl.textContent = String(followers.length);
                if (followingEl)
                    followingEl.textContent = String(following.length);
                const myUserId = getUserId();
                el.querySelector('#pvFollowersBtn')?.addEventListener('click', () => {
                    _showFollowList(el, 'Followers', followers, myUserId);
                });
                el.querySelector('#pvFollowingBtn')?.addEventListener('click', () => {
                    _showFollowList(el, 'Following', following, myUserId);
                });
            }).catch(() => { });
        }
        return;
    }
    close() {
        const el = document.getElementById('profileViewOverlay');
        if (!el)
            return;
        el.querySelector('.pv-sheet')?.classList.remove('pv-sheet--open');
        el.classList.remove('pv-overlay--visible');
        if (_pieChart) {
            _pieChart.destroy();
            _pieChart = null;
        }
        setTimeout(() => el.remove(), 360);
    }
    _buildShell(profile) {
        const wrapper = document.createElement('div');
        const totalKm = this._workouts.reduce((s, w) => s + w.distanceKm, 0);
        const weeklyWins = parseInt(localStorage.getItem(LS_WEEKLY_WINS) ?? '0', 10);
        const avatarHtml = profile.avatarB64
            ? `<img src="${profile.avatarB64}" class="pv-avatar__img" alt="avatar"/>`
            : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="44" height="44">
           <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
         </svg>`;
        wrapper.innerHTML = `
    <div class="pv-overlay" id="profileViewOverlay">
      <div class="pv-sheet">
        <div class="pv-handle"></div>

        <!-- Header -->
        <div class="pv-header">
          <button class="pv-back" id="pvBack">←</button>
          <div class="pv-header__actions">
            <button class="pv-header__btn" id="pvEditBtn">✏️ Edit</button>
            <button class="pv-header__btn pv-header__btn--icon" id="pvSettingsBtn" aria-label="Settings" style="padding:8px 10px;font-size:1.6rem">⚙️</button>
          </div>
        </div>

        <!-- Hero -->
        <div class="pv-hero">
          <div class="pv-avatar">${avatarHtml}</div>
          <div class="pv-hero__info">
            <h2 class="pv-name">${profile.name}</h2>
            ${profile.bio ? `<p class="pv-bio">${profile.bio}</p>` : ''}
          </div>
        </div>

        <!-- Stats row -->
        <div class="pv-stats-row">
          <div class="pv-stats-row__item" id="pvFollowersBtn" style="cursor:pointer">
            <span class="pv-stats-row__val">0</span>
            <span class="pv-stats-row__lbl">Followers</span>
          </div>
          <div class="pv-stats-row__item" id="pvFollowingBtn" style="cursor:pointer">
            <span class="pv-stats-row__val">0</span>
            <span class="pv-stats-row__lbl">Following</span>
          </div>
          <div class="pv-stats-row__item">
            <span class="pv-stats-row__val">${this._workouts.length}</span>
            <span class="pv-stats-row__lbl">Activities</span>
          </div>
          <div class="pv-stats-row__item">
            <span class="pv-stats-row__val">${totalKm.toFixed(0)}</span>
            <span class="pv-stats-row__lbl">km total</span>
          </div>
        </div>



        <!-- Sub-tabs -->
        <div class="pv-subtabs" id="pvSubtabs">
          <button class="pv-subtab pv-subtab--active" data-pv="activities">Activities</button>
          <button class="pv-subtab" data-pv="stats">Stats</button>
          <button class="pv-subtab" data-pv="efforts">Best Efforts</button>
          <button class="pv-subtab" data-pv="trophies">Trophies</button>
          <button class="pv-subtab" data-pv="posts">Posts</button>
        </div>

        <!-- Content -->
        <div class="pv-content" id="pvContent"></div>
      </div>
    </div>`;
        return wrapper.firstElementChild;
    }
    _bindEvents(el) {
        // Close
        el.querySelector('#pvBack')?.addEventListener('click', () => this.close());
        el.addEventListener('click', e => { if (e.target === el)
            this.close(); });
        // Settings
        el.querySelector('#pvSettingsBtn')?.addEventListener('click', () => {
            const settingsUserId = localStorage.getItem('mapyou_userId_profile') ?? '';
            _openSettingsModal(el, settingsUserId);
        });
        // Edit
        el.querySelector('#pvEditBtn')?.addEventListener('click', () => {
            this.close();
            import('./UserProfile.js').then(m => m.openProfileModal());
        });
        // Sub-tabs
        el.querySelectorAll('.pv-subtab').forEach(btn => {
            btn.addEventListener('click', () => {
                el.querySelectorAll('.pv-subtab').forEach(b => b.classList.remove('pv-subtab--active'));
                btn.classList.add('pv-subtab--active');
                this._subTab = btn.dataset.pv;
                this._renderSubTab(this._subTab, el);
            });
        });
        // Swipe handle
        const sheet = el.querySelector('.pv-sheet');
        const handle = el.querySelector('.pv-handle');
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
                this.close();
            else
                sheet.style.transform = '';
        });
    }
    _renderSubTab(tab, el) {
        const content = el.querySelector('#pvContent');
        if (_pieChart) {
            _pieChart.destroy();
            _pieChart = null;
        }
        switch (tab) {
            case 'activities':
                this._renderActivities(content);
                break;
            case 'stats':
                this._renderStats(content);
                break;
            case 'efforts':
                this._renderEfforts(content);
                break;
            case 'trophies':
                this._renderTrophies(content);
                break;
            case 'posts':
                this._renderPosts(content);
                break;
        }
    }
    // ── Activities ──────────────────────────────────────────────────────────────
    _renderActivities(el) {
        if (this._workouts.length === 0) {
            el.innerHTML = `<div class="pv-empty"><div class="pv-empty__icon">🏁</div><p>No activities yet</p></div>`;
            return;
        }
        el.innerHTML = `<div class="pv-act-list">${this._workouts.slice(0, 20).map(w => `
      <div class="pv-act-item">
        <span class="pv-act-item__icon">${SPORT_ICONS_U[w.type] ?? '🏅'}</span>
        <div class="pv-act-item__info">
          <span class="pv-act-item__name">${w.name || w.description || w.type}</span>
          <span class="pv-act-item__date">${_relDate(w.date)}</span>
        </div>
        <div class="pv-act-item__stats">
          <span style="color:${SPORT_COLORS_U[w.type] ?? '#00c46a'}">${w.distanceKm.toFixed(2)} km</span>
          <span class="pv-act-item__time">${formatDurSec(w.durationSec)}</span>
        </div>
      </div>`).join('')}</div>`;
    }
    // ── Stats ───────────────────────────────────────────────────────────────────
    _renderStats(el) {
        const heatmap = _heatmapData(this._workouts);
        const maxHeat = Math.max(...heatmap.flat(), 1);
        const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}`);
        // Pie data
        const typeCounts = {};
        this._workouts.forEach(w => { typeCounts[w.type] = (typeCounts[w.type] ?? 0) + 1; });
        el.innerHTML = `
      <!-- Heatmap -->
      <div class="pv-section-title">Activity Heatmap</div>
      <div class="pv-heatmap-wrap">
        <div class="pv-heatmap">
          <div class="pv-heatmap__hour-labels">
            ${[0, 6, 12, 18, 23].map(h => `<span style="grid-column:${h + 2}">${String(h).padStart(2, '0')}</span>`).join('')}
          </div>
          ${days.map((day, di) => `
            <div class="pv-heatmap__row">
              <span class="pv-heatmap__day">${day}</span>
              ${hours.map((_, hi) => {
            const v = heatmap[di][hi];
            const a = v > 0 ? Math.max(0.15, v / maxHeat) : 0;
            return `<div class="pv-heatmap__cell" style="opacity:${a};background:${v > 0 ? '#00c46a' : 'rgba(255,255,255,0.05)'}"
                  title="${v} workout${v !== 1 ? 's' : ''} at ${String(hi).padStart(2, '0')}:00 on ${day}"></div>`;
        }).join('')}
            </div>`).join('')}
        </div>
      </div>

      <!-- Pie chart -->
      <div class="pv-section-title" style="margin-top:20px">Activity Types</div>
      <div class="pv-pie-wrap">
        ${Object.keys(typeCounts).length === 0
            ? '<p class="pv-empty-sub">No data yet</p>'
            : `<div class="pv-pie-container"><canvas id="pvPieChart" width="180" height="180"></canvas></div>
             <div class="pv-pie-legend">
               ${Object.entries(typeCounts).map(([type, cnt]) => `
                 <div class="pv-pie-legend__item">
                   <span class="pv-pie-legend__dot" style="background:${SPORT_COLORS_U[type] ?? '#00c46a'}"></span>
                   <span>${SPORT_ICONS_U[type] ?? '🏅'} ${type} — ${cnt}</span>
                 </div>`).join('')}
             </div>`}
      </div>`;
        // Render pie
        if (Object.keys(typeCounts).length > 0) {
            setTimeout(() => {
                const canvas = document.getElementById('pvPieChart');
                if (!canvas || typeof Chart === 'undefined')
                    return;
                _pieChart = new Chart(canvas, {
                    type: 'doughnut',
                    data: {
                        labels: Object.keys(typeCounts),
                        datasets: [{
                                data: Object.values(typeCounts),
                                backgroundColor: Object.keys(typeCounts).map(t => SPORT_COLORS_U[t] ?? '#00c46a'),
                                borderWidth: 0,
                                hoverOffset: 6,
                            }],
                    },
                    options: {
                        responsive: false,
                        cutout: '65%',
                        plugins: { legend: { display: false } },
                    },
                });
            }, 100);
        }
    }
    // ── Best efforts ────────────────────────────────────────────────────────────
    _renderEfforts(el) {
        const efforts = _bestEfforts(this._workouts);
        el.innerHTML = `
      <div class="pv-section-title">Personal Bests (Running)</div>
      <div class="pv-efforts">
        ${efforts.map(e => `
          <div class="pv-effort ${e.timeStr ? 'pv-effort--set' : ''}">
            <span class="pv-effort__dist">${e.label}</span>
            <div class="pv-effort__right">
              ${e.timeStr
            ? `<span class="pv-effort__time">${e.timeStr}</span>
                   <span class="pv-effort__date">${e.date ? _relDate(e.date) : ''}</span>`
            : `<span class="pv-effort__empty">—</span>`}
            </div>
          </div>`).join('')}
      </div>
      <p class="pv-efforts__note">Calculated from GPS-tracked running activities only.</p>`;
    }
    // ── Trophies ────────────────────────────────────────────────────────────────
    _renderTrophies(el) {
        const actTrophies = _activityTrophies(this._workouts);
        const wkTrophies = _weeklyTrophies();
        const streakTrophies = _streakTrophies();
        const totalUnlocked = [...actTrophies, ...wkTrophies, ...streakTrophies].filter(t => t.unlocked).length;
        const weeklyWins = parseInt(localStorage.getItem(LS_WEEKLY_WINS) ?? '0', 10);
        const bestStreak = getBestStreak();
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
    // ── Posts ───────────────────────────────────────────────────────────────────
    _renderPosts(el) {
        if (this._posts.length === 0) {
            el.innerHTML = `<div class="pv-empty"><div class="pv-empty__icon">📝</div><p>No posts yet</p><p class="pv-empty__sub">Create a post from the Home tab</p></div>`;
            return;
        }
        el.innerHTML = `<div class="pv-posts-list">${this._posts.map(p => `
        <div class="pv-post-item">
          ${p.photoUrl ? `<div class="pv-post-item__photo"><img src="${p.photoUrl}" alt=""/></div>` : ''}
          <div class="pv-post-item__body">
            <span class="pv-post-item__title">${p.title}</span>
            <span class="pv-post-item__date">${_relDate(String(p.date))}</span>
            ${p.body ? `<p class="pv-post-item__text">${p.body}</p>` : ''}
          </div>
        </div>`).join('')}</div>`;
    }
}
export const profileView = new ProfileView();
// ── Settings modal ────────────────────────────────────────────────────────────
const PUSH_SETTINGS_KEY = 'mapyou_push_settings';
function _getPushSettings() {
    try {
        return JSON.parse(localStorage.getItem(PUSH_SETTINGS_KEY) ?? '{}');
    }
    catch {
        return {};
    }
}
function _savePushSettings(s) {
    localStorage.setItem(PUSH_SETTINGS_KEY, JSON.stringify(s));
}
const PUSH_TOGGLES = [
    { key: 'like', label: 'Lajki', desc: 'Gdy ktoś polubi Twój post lub aktywność' },
    { key: 'comment', label: 'Komentarze', desc: 'Gdy ktoś skomentuje Twój post lub aktywność' },
    { key: 'follow', label: 'Nowy obserwujący', desc: 'Gdy ktoś zacznie Cię obserwować' },
    { key: 'follow_request', label: 'Prośba o obserwowanie', desc: 'Gdy ktoś wyśle request do Twojego profilu' },
    { key: 'friend_activity', label: 'Aktywność znajomego', desc: 'Gdy ktoś kogo obserwujesz zapisze aktywność' },
    { key: 'friend_post', label: 'Post znajomego', desc: 'Gdy ktoś kogo obserwujesz doda post' },
    { key: 'club_post', label: 'Post w klubie', desc: 'Gdy ktoś doda post w Twoim klubie' },
    { key: 'activity_saved', label: 'Trening zapisany', desc: 'Potwierdzenie po zapisaniu treningu' },
    { key: 'break_reminder', label: 'Przypomnienie o treningu', desc: 'Po 3h i 24h przerwy od aplikacji' },
];
async function _showFollowList(parent, title, userIds, myUserId) {
    document.getElementById('pvFollowListModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'pvFollowListModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9600;background:rgba(0,0,0,0.7);display:flex;align-items:flex-end';
    modal.innerHTML = `
    <div style="width:100%;max-height:75vh;background:#1a1f23;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden">
      <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07)">
        <span style="font-size:1.7rem;font-weight:700;color:#fff">${title}</span>
        <button id="pvFlClose" style="background:rgba(255,255,255,0.08);border:none;color:#aaa;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.3rem">✕</button>
      </div>
      <div id="pvFlBody" style="overflow-y:auto;padding:8px 0 32px">
        <div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">Loading…</div>
      </div>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#pvFlClose')?.addEventListener('click', () => modal.remove());
    modal.addEventListener('click', e => { if (e.target === modal)
        modal.remove(); });
    const body = modal.querySelector('#pvFlBody');
    if (!userIds.length) {
        body.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">No users yet</div>';
        return;
    }
    const users = await Promise.all(userIds.slice(0, 50).map(uid => fetch(`${BACKEND_URL}/users/${encodeURIComponent(uid)}`)
        .then(r => r.json())
        .then((d) => d.status === 'ok' ? d.data : { userId: uid, name: uid.slice(0, 10) + '…', avatarB64: null })
        .catch(() => ({ userId: uid, name: uid.slice(0, 10) + '…', avatarB64: null }))));
    body.innerHTML = users.map(u => '<div data-uid="' + u.userId + '" style="display:flex;align-items:center;gap:12px;padding:12px 20px;cursor:pointer">'
        + '<div style="width:44px;height:44px;border-radius:50%;overflow:hidden;background:#333;flex-shrink:0">'
        + (u.avatarB64 ? '<img src="' + u.avatarB64 + '" style="width:100%;height:100%;object-fit:cover"/>' : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff">' + u.name[0] + '</div>')
        + '</div>'
        + '<span style="font-size:1.4rem;font-weight:600;color:#fff;flex:1">' + u.name + '</span>'
        + (u.userId === myUserId ? '<span style="font-size:1.1rem;color:rgba(255,255,255,0.3)">You</span>' : '')
        + '</div>').join('');
    body.querySelectorAll('[data-uid]').forEach(el => {
        el.addEventListener('click', () => {
            const uid = el.dataset.uid;
            modal.remove();
            if (uid !== myUserId) {
                import('./PublicProfile.js').then(m => m.openPublicProfile(uid));
            }
        });
    });
}
function _buildPushTogglesHtml(settings, togId) {
    return PUSH_TOGGLES.map(t => {
        const on = settings[t.key] !== false;
        const bg = on ? '#00c46a' : 'rgba(255,255,255,0.15)';
        const lft = on ? '23px' : '3px';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06)">'
            + '<div style="flex:1;margin-right:12px">'
            + '<div style="font-weight:600;color:#fff;font-size:1.4rem">' + t.label + '</div>'
            + '<div style="color:rgba(255,255,255,0.4);font-size:1.2rem;margin-top:2px">' + t.desc + '</div>'
            + '</div>'
            + '<label style="position:relative;width:48px;height:28px;flex-shrink:0">'
            + '<input type="checkbox" id="' + togId(t.key) + '" ' + (on ? 'checked' : '') + ' style="opacity:0;width:0;height:0;position:absolute"/>'
            + '<span class="pvPushSlider" data-key="' + t.key + '" style="position:absolute;inset:0;border-radius:28px;background:' + bg + ';cursor:pointer;transition:background 0.2s">'
            + '<span style="position:absolute;top:3px;left:' + lft + ';width:22px;height:22px;border-radius:50%;background:#fff;transition:left 0.2s"></span>'
            + '</span></label></div>';
    }).join('');
}
async function _openSettingsModal(parent, userId) {
    document.getElementById('pvSettingsModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'pvSettingsModal';
    modal.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,0.7);display:flex;align-items:flex-end';
    // Fetch current isPrivate from backend
    let isPrivate = false;
    try {
        const res = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}`, { cache: 'no-store' });
        const data = await res.json();
        if (data.status === 'ok')
            isPrivate = data.data.isPrivate ?? false;
    }
    catch { }
    const settings = _getPushSettings();
    const togId = (k) => `pvPush_${k}`;
    let activeTab = 'profile';
    const renderModal = () => {
        modal.innerHTML = `
      <div style="width:100%;max-height:90vh;background:#1a1f23;border-radius:24px 24px 0 0;display:flex;flex-direction:column;overflow:hidden">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.07)">
          <span style="font-size:1.7rem;font-weight:700;color:#fff">Ustawienia</span>
          <button id="pvSetClose" style="background:rgba(255,255,255,0.08);border:none;color:#aaa;width:32px;height:32px;border-radius:50%;cursor:pointer;font-size:1.3rem">✕</button>
        </div>
        <!-- Tabs -->
        <div style="display:flex;border-bottom:1px solid rgba(255,255,255,0.07)">
          <button id="pvTabProfile" style="flex:1;padding:12px;border:none;background:none;font-size:1.35rem;font-weight:${activeTab === 'profile' ? 700 : 500};color:${activeTab === 'profile' ? '#fff' : 'rgba(255,255,255,0.4)'};border-bottom:${activeTab === 'profile' ? '2px solid #00c46a' : '2px solid transparent'};cursor:pointer;font-family:inherit;transition:all 0.15s">Profil</button>
          <button id="pvTabNotif" style="flex:1;padding:12px;border:none;background:none;font-size:1.35rem;font-weight:${activeTab === 'notifications' ? 700 : 500};color:${activeTab === 'notifications' ? '#fff' : 'rgba(255,255,255,0.4)'};border-bottom:${activeTab === 'notifications' ? '2px solid #00c46a' : '2px solid transparent'};cursor:pointer;font-family:inherit;transition:all 0.15s">Powiadomienia</button>
        </div>
        <div style="overflow-y:auto;padding:16px 20px 40px">
          ${activeTab === 'profile' ? `
          <!-- Privacy -->
          <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
            <div>
              <div style="font-weight:600;color:#fff;font-size:1.4rem">Profil prywatny</div>
              <div style="color:rgba(255,255,255,0.4);font-size:1.2rem;margin-top:2px">Tylko zaakceptowani mogą widzieć Twoje aktywności</div>
            </div>
            <label style="position:relative;width:48px;height:28px;flex-shrink:0;margin-left:12px">
              <input type="checkbox" id="pvPrivateToggle" ${isPrivate ? 'checked' : ''} style="opacity:0;width:0;height:0;position:absolute"/>
              <span id="pvPrivateSlider" style="position:absolute;inset:0;border-radius:28px;background:${isPrivate ? '#00c46a' : 'rgba(255,255,255,0.15)'};cursor:pointer;transition:background 0.2s">
                <span style="position:absolute;top:3px;left:${isPrivate ? '23px' : '3px'};width:22px;height:22px;border-radius:50%;background:#fff;transition:left 0.2s" id="pvPrivateThumb"></span>
              </span>
            </label>
          </div>` : `
          <!-- Push notifications -->
          ${_buildPushTogglesHtml(settings, togId)}`}
        </div>
      </div>`;
        modal.querySelector('#pvSetClose')?.addEventListener('click', () => modal.remove());
        modal.addEventListener('click', e => { if (e.target === modal)
            modal.remove(); });
        modal.querySelector('#pvTabProfile')?.addEventListener('click', () => { activeTab = 'profile'; renderModal(); });
        modal.querySelector('#pvTabNotif')?.addEventListener('click', () => { activeTab = 'notifications'; renderModal(); });
        // Private toggle
        const privCb = modal.querySelector('#pvPrivateToggle');
        const privSlider = modal.querySelector('#pvPrivateSlider');
        const privThumb = modal.querySelector('#pvPrivateThumb');
        if (privCb && privSlider && privThumb) {
            privCb.addEventListener('change', async () => {
                const val = privCb.checked;
                privSlider.style.background = val ? '#00c46a' : 'rgba(255,255,255,0.15)';
                privThumb.style.left = val ? '23px' : '3px';
                isPrivate = val;
                await fetch(`${BACKEND_URL}/users/${encodeURIComponent(userId)}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ isPrivate: val }),
                });
            });
        }
        // Push toggles
        modal.querySelectorAll('.pvPushSlider').forEach(slider => {
            const key = slider.dataset.key;
            const cb = modal.querySelector(`#${togId(key)}`);
            const thumb = slider.querySelector('span');
            if (!cb || !thumb)
                return;
            cb.addEventListener('change', () => {
                const val = cb.checked;
                slider.style.background = val ? '#00c46a' : 'rgba(255,255,255,0.15)';
                thumb.style.left = val ? '23px' : '3px';
                const s = _getPushSettings();
                s[key] = val;
                _savePushSettings(s);
            });
        });
    };
    renderModal();
    document.body.appendChild(modal);
}
//# sourceMappingURL=ProfileView.js.map