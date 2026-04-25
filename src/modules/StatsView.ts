// ─── STATS VIEW ───────────────────────────────────────────────────────────────
// src/modules/StatsView.ts
//
// Two sub-tabs: Progress (charts, records, trends) + History (filterable list)
// Uses Chart.js (loaded from CDN in index.html) and UnifiedWorkout model.

/// <reference types="leaflet" />
import {
  loadUnifiedWorkouts, deleteUnifiedWorkout,
  formatDurSec, formatPaceSec,
  SPORT_ICONS_U, SPORT_COLORS_U,
  type UnifiedWorkout, type WorkoutType,
} from './UnifiedWorkout.js';

declare const Chart: any;

// ── Constants ─────────────────────────────────────────────────────────────────

const WEEK_DAYS   = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const MONTHS      = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const BRAND       = '#00c46a';
const BRAND_DIM   = 'rgba(0,196,106,0.18)';

// ── Helpers ───────────────────────────────────────────────────────────────────

function startOfWeek(d = new Date()): Date {
  const r = new Date(d);
  const day = r.getDay() || 7;
  r.setHours(0,0,0,0);
  r.setDate(r.getDate() - day + 1);
  return r;
}

function relDate(iso: string): string {
  const diff  = Date.now() - new Date(iso).getTime();
  const days  = Math.floor(diff / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7)  return `${days}d ago`;
  const d = new Date(iso);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

function set(id: string, val: string | number): void {
  const el = document.getElementById(id);
  if (el) el.textContent = String(val);
}

// ── Chart registry (destroy on re-render) ─────────────────────────────────────

const _charts: Record<string, any> = {};
function destroyChart(id: string): void {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}
function makeChart(id: string, cfg: any): void {
  destroyChart(id);
  const el = document.getElementById(id) as HTMLCanvasElement | null;
  if (!el) return;
  // Ensure responsive config is correct
  if (!cfg.options) cfg.options = {};
  cfg.options.responsive = true;
  cfg.options.maintainAspectRatio = false;
  _charts[id] = new Chart(el, cfg);
}

// ── StatsView class ───────────────────────────────────────────────────────────

export class StatsView {
  private _workouts: UnifiedWorkout[] = [];
  private _inited   = false;
  private _subTab:  'progress' | 'history' = 'progress';
  private _filter:  WorkoutType | 'all' = 'all';
  private _sort:    'newest'|'oldest'|'longest'|'fastest'|'duration' = 'newest';
  private _detailMap: L.Map | null = null;

  async init(): Promise<void> {
    if (this._inited) return;
    this._inited = true;
    await this.render();
  }

  async render(): Promise<void> {
    this._workouts = await loadUnifiedWorkouts();
    this._renderShell();
    this._bindSubTabs();
    this._showSubTab(this._subTab);
  }

  // ── Shell (sub-tab nav) ───────────────────────────────────────────────────

  private _renderShell(): void {
    const scroll = document.querySelector<HTMLElement>('#tabStats .tab-scroll');
    if (!scroll) return;

    scroll.innerHTML = `
      <div class="sv-header">
        <div class="sv-subtabs">
          <button class="sv-subtab${this._subTab === 'progress' ? ' sv-subtab--active' : ''}"
            data-sv="progress">📈 Progress</button>
          <button class="sv-subtab${this._subTab === 'history' ? ' sv-subtab--active' : ''}"
            data-sv="history">📋 History</button>
        </div>
      </div>
      <div id="svContent"></div>`;
  }

  private _bindSubTabs(): void {
    document.querySelectorAll<HTMLElement>('.sv-subtab').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.sv-subtab').forEach(b => b.classList.remove('sv-subtab--active'));
        btn.classList.add('sv-subtab--active');
        this._subTab = btn.dataset.sv as 'progress' | 'history';
        this._showSubTab(this._subTab);
      });
    });
  }

  private _showSubTab(tab: 'progress' | 'history'): void {
    const el = document.getElementById('svContent');
    if (!el) return;
    if (tab === 'progress') this._renderProgress(el);
    else                    this._renderHistory(el);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // PROGRESS TAB
  // ════════════════════════════════════════════════════════════════════════════

  private _renderProgress(el: HTMLElement): void {
    Object.keys(_charts).forEach(destroyChart);

    el.innerHTML = `
      <!-- Weekly summary -->
      <section class="sv-section">
        <div class="sv-section__title">This Week</div>
        <div class="sv-week-rings">
          ${this._weekRingsHTML()}
        </div>
        <div class="sv-week-goal">
          <div class="sv-week-goal__header">
            <span>Weekly goal</span>
            <span id="svGoalPct">0%</span>
          </div>
          <div class="sv-week-goal__bar"><div class="sv-week-goal__fill" id="svGoalFill"></div></div>
        </div>
        <div class="sv-week-nav">
          <button class="sv-icon-btn" id="svWeekPrev">‹</button>
          <span class="sv-week-label" id="svWeekLabel">This week</span>
          <button class="sv-icon-btn" id="svWeekNext" disabled>›</button>
        </div>
        <div class="sv-chart-wrap"><canvas id="svWeekChart"></canvas></div>
      </section>

      <!-- Monthly chart -->
      <section class="sv-section">
        <div class="sv-section__title">
          Monthly
          <div class="sv-seg" id="svMonthSeg">
            <button class="sv-seg__btn sv-seg__btn--active" data-seg="dist">Distance</button>
            <button class="sv-seg__btn" data-seg="time">Time</button>
          </div>
        </div>
        <div class="sv-chart-wrap"><canvas id="svMonthChart"></canvas></div>
      </section>

      <!-- Yearly chart -->
      <section class="sv-section">
        <div class="sv-section__title">Yearly</div>
        <div class="sv-chart-wrap"><canvas id="svYearChart"></canvas></div>
      </section>

      <!-- Records -->
      <section class="sv-section">
        <div class="sv-section__title">Personal Records</div>
        <div class="sv-records" id="svRecords"></div>
      </section>

      <!-- Trends -->
      <section class="sv-section" id="svTrends">
        <div class="sv-section__title">Trends</div>
        <div class="sv-trends" id="svTrendsContent"></div>
      </section>

      <!-- Goal editor -->
      <section class="sv-section">
        <div class="sv-section__title">Weekly Goals</div>
        <div class="sv-goal-editor">
          <div class="sv-goal-row">
            <span>Distance</span>
            <input class="sv-goal-input" id="svGoalKm" type="number" min="1" max="500"
              value="${localStorage.getItem('goalKm') ?? 35}"/> km
          </div>
          <div class="sv-goal-row">
            <span>Time</span>
            <input class="sv-goal-input" id="svGoalTime" type="number" min="1" max="2000"
              value="${localStorage.getItem('goalTime') ?? 300}"/> min
          </div>
          <div class="sv-goal-row">
            <span>Workouts</span>
            <input class="sv-goal-input" id="svGoalCount" type="number" min="1" max="30"
              value="${localStorage.getItem('goalCount') ?? 7}"/>×
          </div>
        </div>
      </section>`;

    this._weekOffset = 0;
    this._renderWeek();
    this._renderMonthChart('dist');
    this._renderYearChart();
    this._renderRecords();
    this._renderTrends();
    this._bindProgressEvents();
  }

  private _weekOffset = 0;

  private _weekRingsHTML(): string {
    const rings: Array<[string, string, string, string]> = [
      ['svRingKm',   '#00c46a', '🏃', 'KM'],
      ['svRingTime', '#aaa',    '⏱',  'TIME'],
      ['svRingCnt',  '#ffb545', '🚴', 'COUNT'],
    ];
    return rings.map(([id, col, icon, lbl]) => `
      <div class="sv-ring-wrap">
        <svg viewBox="0 0 90 90">
          <circle cx="45" cy="45" r="36" fill="none" stroke="#3a4147" stroke-width="7"/>
          <circle id="${id}" cx="45" cy="45" r="36" fill="none"
            stroke="${col}" stroke-width="7" stroke-dasharray="226.2" stroke-dashoffset="226.2"
            stroke-linecap="round" transform="rotate(-90 45 45)"
            style="transition:stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)"/>
          <text x="45" y="25" text-anchor="middle" font-size="13">${icon}</text>
          <text x="45" y="42" text-anchor="middle" fill="#ececec" font-size="12" font-weight="800"
            font-family="Manrope,sans-serif" id="${id}Val">—</text>
          <text x="45" y="53" text-anchor="middle" fill="#aaa" font-size="8"
            font-family="Manrope,sans-serif">${lbl}</text>
        </svg>
      </div>`).join('');
  }

  private _renderWeek(): void {
    const now = new Date();
    const mon = startOfWeek(now);
    mon.setDate(mon.getDate() + this._weekOffset * 7);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);

    const week = this._workouts.filter(w => {
      const d = new Date(w.date);
      return d >= mon && d <= sun;
    });

    const wKm  = week.reduce((s, w) => s + w.distanceKm, 0);
    const wSec = week.reduce((s, w) => s + w.durationSec, 0);
    const wCnt = week.length;

    const goalKm  = +(localStorage.getItem('goalKm')  ?? 35);
    const goalMin = +(localStorage.getItem('goalTime') ?? 300);
    const goalCnt = +(localStorage.getItem('goalCount')  ?? 7);
    const CIRC    = 226.2;

    const setRing = (id: string, pct: number, valStr: string) => {
      const arc = document.getElementById(id);
      if (arc) arc.setAttribute('stroke-dashoffset', String(Math.max(0, CIRC - Math.min(pct,1) * CIRC)));
      set(`${id}Val`, valStr);
    };

    setRing('svRingKm',   wKm / goalKm,           wKm.toFixed(1));
    setRing('svRingTime', (wSec/60) / goalMin,     wSec >= 3600 ? `${Math.floor(wSec/3600)}h${Math.floor((wSec%3600)/60)}m` : `${Math.floor(wSec/60)}m`);
    setRing('svRingCnt',  wCnt / goalCnt,          String(wCnt));

    const pct = Math.min(Math.round((wKm / goalKm) * 100), 100);
    set('svGoalPct', `${pct}%`);
    const fill = document.getElementById('svGoalFill');
    if (fill) fill.style.width = `${pct}%`;

    // Week label
    if (this._weekOffset === 0) {
      set('svWeekLabel', 'This week');
      (document.getElementById('svWeekNext') as HTMLButtonElement | null)?.setAttribute('disabled', '');
    } else {
      const fmt = (d: Date) => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
      set('svWeekLabel', `${fmt(mon)}–${fmt(sun)}`);
      (document.getElementById('svWeekNext') as HTMLButtonElement | null)?.removeAttribute('disabled');
    }

    // Bar chart for days
    const dayKm: number[] = Array(7).fill(0);
    const dayColors: string[] = Array(7).fill(BRAND_DIM);
    week.forEach(w => {
      const i = Math.floor((new Date(w.date).getTime() - mon.getTime()) / 86_400_000);
      if (i >= 0 && i < 7) { dayKm[i] += w.distanceKm; dayColors[i] = BRAND; }
    });

    makeChart('svWeekChart', {
      type: 'bar',
      data: {
        labels: WEEK_DAYS.map((d, i) => {
          const dd = new Date(mon); dd.setDate(mon.getDate() + i);
          return `${d} ${dd.getDate()}`;
        }),
        datasets: [{ data: dayKm, backgroundColor: dayColors, borderRadius: 6, borderSkipped: false }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6c7175', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6c7175', font: { size: 11 } }, beginAtZero: true },
        },
      },
    });
  }

  private _renderMonthChart(mode: 'dist' | 'time'): void {
    const now   = new Date();
    const year  = now.getFullYear();
    const month = now.getMonth();
    const days  = new Date(year, month + 1, 0).getDate();

    const byDay: number[] = Array(days).fill(0);
    this._workouts.forEach(w => {
      const d = new Date(w.date);
      if (d.getFullYear() === year && d.getMonth() === month) {
        byDay[d.getDate() - 1] += mode === 'dist' ? w.distanceKm : w.durationSec / 60;
      }
    });

    makeChart('svMonthChart', {
      type: 'bar',
      data: {
        labels: Array.from({ length: days }, (_, i) => String(i + 1)),
        datasets: [{
          data: byDay,
          backgroundColor: byDay.map(v => v > 0 ? BRAND : BRAND_DIM),
          borderRadius: 4,
          borderSkipped: false,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#6c7175', font: { size: 10 }, maxTicksLimit: 10 } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6c7175', font: { size: 11 } }, beginAtZero: true },
        },
      },
    });
  }

  private _renderYearChart(): void {
    const year = new Date().getFullYear();
    const byMonth: number[] = Array(12).fill(0);
    this._workouts.forEach(w => {
      const d = new Date(w.date);
      if (d.getFullYear() === year) byMonth[d.getMonth()] += w.distanceKm;
    });

    makeChart('svYearChart', {
      type: 'line',
      data: {
        labels: MONTHS,
        datasets: [{
          data: byMonth, borderColor: BRAND, backgroundColor: BRAND_DIM,
          fill: true, tension: 0.4, pointRadius: 4,
          pointBackgroundColor: BRAND, pointBorderColor: '#1a1f23', pointBorderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6c7175', font: { size: 11 } } },
          y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#6c7175', font: { size: 11 } }, beginAtZero: true },
        },
      },
    });
  }

  private _renderRecords(): void {
    const el = document.getElementById('svRecords');
    if (!el || !this._workouts.length) {
      if (el) el.innerHTML = '<p class="sv-empty">No workouts yet</p>';
      return;
    }
    const ws = this._workouts;
    const byDist  = [...ws].sort((a, b) => b.distanceKm - a.distanceKm)[0];
    const byDur   = [...ws].sort((a, b) => b.durationSec - a.durationSec)[0];
    const byPace  = ws.filter(w => w.type !== 'cycling' && w.paceMinKm > 0).sort((a, b) => a.paceMinKm - b.paceMinKm)[0];
    const byElev  = [...ws].sort((a, b) => b.elevGain - a.elevGain)[0];

    const records: Array<[string, string, string, string]> = [
      ['🏅', 'Longest run',    byDist  ? `${byDist.distanceKm.toFixed(2)} km`    : '—', byDist  ? relDate(byDist.date)  : ''],
      ['⏱',  'Longest time',  byDur   ? formatDurSec(byDur.durationSec)           : '—', byDur   ? relDate(byDur.date)   : ''],
      ['⚡',  'Best pace',     byPace  ? `${formatPaceSec(byPace.paceMinKm)}/km`  : '—', byPace  ? relDate(byPace.date)  : ''],
      ['⛰',  'Most elevation',byElev && byElev.elevGain > 0 ? `${byElev.elevGain}m` : '—', byElev && byElev.elevGain > 0 ? relDate(byElev.date) : ''],
    ];

    el.innerHTML = records.map(([icon, lbl, val, date]) => `
      <div class="sv-record">
        <span class="sv-record__icon">${icon}</span>
        <div class="sv-record__info">
          <span class="sv-record__label">${lbl}</span>
          <span class="sv-record__date">${date}</span>
        </div>
        <span class="sv-record__val">${val}</span>
      </div>`).join('');
  }

  private _renderTrends(): void {
    const el = document.getElementById('svTrendsContent');
    if (!el) return;

    const now    = new Date();
    const thisMon = startOfWeek(now);
    const lastMon = new Date(thisMon); lastMon.setDate(lastMon.getDate() - 7);
    const lastSun = new Date(thisMon); lastSun.setSeconds(-1);

    const thisMonth = now.getMonth();
    const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
    const lastMonthYear = thisMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();

    const thisWeekW = this._workouts.filter(w => new Date(w.date) >= thisMon);
    const lastWeekW = this._workouts.filter(w => { const d = new Date(w.date); return d >= lastMon && d < thisMon; });
    const thisMonW  = this._workouts.filter(w => { const d = new Date(w.date); return d.getMonth() === thisMonth && d.getFullYear() === now.getFullYear(); });
    const lastMonW  = this._workouts.filter(w => { const d = new Date(w.date); return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear; });

    const km  = (arr: UnifiedWorkout[]) => arr.reduce((s, w) => s + w.distanceKm, 0);
    const cnt = (arr: UnifiedWorkout[]) => arr.length;

    const trend = (curr: number, prev: number): string => {
      if (prev === 0) return curr > 0 ? '🆕 New' : '—';
      const pct = Math.round(((curr - prev) / prev) * 100);
      return pct >= 0 ? `<span class="sv-trend--up">▲ ${pct}%</span>` : `<span class="sv-trend--down">▼ ${Math.abs(pct)}%</span>`;
    };

    el.innerHTML = `
      <div class="sv-trend-row">
        <span class="sv-trend-label">This week vs last week</span>
        <div class="sv-trend-vals">
          <span>${km(thisWeekW).toFixed(1)} km ${trend(km(thisWeekW), km(lastWeekW))}</span>
          <span>${cnt(thisWeekW)} workouts ${trend(cnt(thisWeekW), cnt(lastWeekW))}</span>
        </div>
      </div>
      <div class="sv-trend-row">
        <span class="sv-trend-label">This month vs last month</span>
        <div class="sv-trend-vals">
          <span>${km(thisMonW).toFixed(1)} km ${trend(km(thisMonW), km(lastMonW))}</span>
          <span>${cnt(thisMonW)} workouts ${trend(cnt(thisMonW), cnt(lastMonW))}</span>
        </div>
      </div>`;
  }

  private _bindProgressEvents(): void {
    document.getElementById('svWeekPrev')?.addEventListener('click', () => {
      this._weekOffset--; this._renderWeek();
    });
    document.getElementById('svWeekNext')?.addEventListener('click', () => {
      if (this._weekOffset >= 0) return;
      this._weekOffset++; this._renderWeek();
    });

    // Month chart toggle
    document.getElementById('svMonthSeg')?.querySelectorAll<HTMLElement>('.sv-seg__btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#svMonthSeg .sv-seg__btn').forEach(b => b.classList.remove('sv-seg__btn--active'));
        btn.classList.add('sv-seg__btn--active');
        this._renderMonthChart(btn.dataset.seg as 'dist' | 'time');
      });
    });

    // Goal inputs
    const bind = (id: string, key: string) => {
      document.getElementById(id)?.addEventListener('change', e => {
        const val = Math.max(1, +(e.target as HTMLInputElement).value || 1);
        localStorage.setItem(key, String(val));
        this._renderWeek();
      });
    };
    bind('svGoalKm', 'goalKm'); bind('svGoalTime', 'goalTime'); bind('svGoalCount', 'goalCount');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // HISTORY TAB
  // ════════════════════════════════════════════════════════════════════════════

  private _renderHistory(el: HTMLElement): void {
    el.innerHTML = `
      <!-- Filters + Sort -->
      <div class="sv-toolbar">
        <div class="sv-filters" id="svFilters">
          ${(['all','running','walking','cycling'] as const).map(f => `
            <button class="sv-filter${this._filter === f ? ' sv-filter--active' : ''}" data-f="${f}">
              ${f === 'all' ? 'All' : SPORT_ICONS_U[f as WorkoutType] + ' ' + f.charAt(0).toUpperCase() + f.slice(1)}
            </button>`).join('')}
        </div>
        <select class="sv-sort" id="svSort">
          <option value="newest"  ${this._sort==='newest'  ?'selected':''}>Newest</option>
          <option value="oldest"  ${this._sort==='oldest'  ?'selected':''}>Oldest</option>
          <option value="longest" ${this._sort==='longest' ?'selected':''}>Longest distance</option>
          <option value="fastest" ${this._sort==='fastest' ?'selected':''}>Fastest pace</option>
          <option value="duration"${this._sort==='duration'?'selected':''}>Longest time</option>
        </select>
      </div>

      <!-- List -->
      <div id="svHistoryList"></div>`;

    this._renderHistoryList();
    this._bindHistoryEvents();
  }

  private _filteredSorted(): UnifiedWorkout[] {
    let ws = this._filter === 'all'
      ? [...this._workouts]
      : this._workouts.filter(w => w.type === this._filter);

    switch (this._sort) {
      case 'oldest':   ws.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()); break;
      case 'longest':  ws.sort((a, b) => b.distanceKm - a.distanceKm); break;
      case 'fastest':  ws = ws.filter(w => w.paceMinKm > 0); ws.sort((a, b) => a.paceMinKm - b.paceMinKm); break;
      case 'duration': ws.sort((a, b) => b.durationSec - a.durationSec); break;
      default:         ws.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return ws;
  }

  private _renderHistoryList(): void {
    const el = document.getElementById('svHistoryList');
    if (!el) return;

    const ws = this._filteredSorted();
    if (ws.length === 0) {
      el.innerHTML = `<div class="sv-empty-history">
        <div class="sv-empty-history__icon">🏁</div>
        <p class="sv-empty-history__text">No workouts yet</p>
        <p class="sv-empty-history__sub">Complete a workout or add one manually</p>
      </div>`;
      return;
    }

    el.innerHTML = ws.map(w => {
      const color = SPORT_COLORS_U[w.type];
      const third = w.type === 'cycling'
        ? `${w.speedKmH.toFixed(1)} km/h`
        : formatPaceSec(w.paceMinKm) + '/km';
      const hasMap = w.coords.length > 1;
      return `
        <div class="sv-item" data-id="${w.id}" data-source="${w.source}">
          <div class="sv-item__color-bar" style="background:${color}"></div>
          <div class="sv-item__body">
            <div class="sv-item__top">
              <span class="sv-item__icon">${SPORT_ICONS_U[w.type]}</span>
              <span class="sv-item__name">${w.name || w.description || w.type}</span>
              <span class="sv-item__date">${relDate(w.date)}</span>
            </div>
            <div class="sv-item__stats">
              <span>${w.distanceKm.toFixed(2)} km</span>
              <span>${formatDurSec(w.durationSec)}</span>
              <span>${third}</span>
              ${hasMap ? '<span class="sv-item__has-map">📍 GPS</span>' : ''}
              <span class="sv-item__src sv-item__src--${w.source}">${w.source}</span>
            </div>
          </div>
          <button class="sv-item__del" data-del="${w.id}" title="Delete">✕</button>
        </div>`;
    }).join('');

    // Bind click events
    el.querySelectorAll<HTMLElement>('.sv-item').forEach(item => {
      item.addEventListener('click', e => {
        if ((e.target as HTMLElement).closest('.sv-item__del')) return;
        const id = item.dataset.id!;
        const w  = this._workouts.find(x => x.id === id);
        if (w) this._openDetail(w);
      });
    });

    el.querySelectorAll<HTMLElement>('[data-del]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!confirm('Delete this workout?')) return;
        const id = btn.dataset.del!;
        await deleteUnifiedWorkout(id);
        this._workouts = this._workouts.filter(w => w.id !== id);
        this._renderHistoryList();
      });
    });
  }

  private _bindHistoryEvents(): void {
    document.getElementById('svFilters')?.querySelectorAll<HTMLElement>('.sv-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('#svFilters .sv-filter').forEach(b => b.classList.remove('sv-filter--active'));
        btn.classList.add('sv-filter--active');
        this._filter = btn.dataset.f as typeof this._filter;
        this._renderHistoryList();
      });
    });

    document.getElementById('svSort')?.addEventListener('change', e => {
      this._sort = (e.target as HTMLSelectElement).value as typeof this._sort;
      this._renderHistoryList();
    });
  }

  // ── Activity detail sheet ─────────────────────────────────────────────────

  private _openDetail(w: UnifiedWorkout): void {
    document.getElementById('svDetailSheet')?.remove();

    const color = SPORT_COLORS_U[w.type];
    const third = w.type === 'cycling'
      ? `${w.speedKmH.toFixed(1)}<span class="sv-detail__unit">km/h</span>`
      : `${formatPaceSec(w.paceMinKm)}<span class="sv-detail__unit">/km</span>`;

    const sheet = document.createElement('div');
    sheet.id        = 'svDetailSheet';
    sheet.className = 'sv-detail-sheet';
    sheet.innerHTML = `
      <div class="sv-detail-overlay" id="svDetailOverlay"></div>
      <div class="sv-detail-panel" id="svDetailPanel">
        <div class="sv-detail-handle"></div>
        <div class="sv-detail-header" style="--wcolor:${color}">
          <span class="sv-detail-header__icon">${SPORT_ICONS_U[w.type]}</span>
          <div>
            <div class="sv-detail-header__name">${w.name || w.description || w.type}</div>
            <div class="sv-detail-header__date">${new Date(w.date).toLocaleDateString('en',{weekday:'short',month:'short',day:'numeric',year:'numeric'})}</div>
          </div>
          <button class="sv-detail-close" id="svDetailClose">✕</button>
        </div>

        <div class="sv-detail-stats" style="--wcolor:${color}">
          <div class="sv-detail-stat">
            <span class="sv-detail-stat__val">${w.distanceKm.toFixed(2)}</span>
            <span class="sv-detail-stat__lbl">km</span>
          </div>
          <div class="sv-detail-stat">
            <span class="sv-detail-stat__val">${formatDurSec(w.durationSec)}</span>
            <span class="sv-detail-stat__lbl">time</span>
          </div>
          <div class="sv-detail-stat">
            <span class="sv-detail-stat__val">${third}</span>
          </div>
          ${w.elevGain > 0 ? `<div class="sv-detail-stat"><span class="sv-detail-stat__val">${w.elevGain}m</span><span class="sv-detail-stat__lbl">elev</span></div>` : ''}
        </div>

        ${w.coords.length > 1 ? `<div class="sv-detail-map" id="svDetailMap"></div>` : ''}

        ${w.notes ? `<div class="sv-detail-notes">🔒 ${w.notes}</div>` : ''}
        ${w.photoUrl ? `<div class="sv-detail-photo"><img src="${w.photoUrl}" alt=""/></div>` : ''}
        ${w.intensity ? `<div class="sv-detail-intensity">Intensity: ${'●'.repeat(w.intensity)}${'○'.repeat(5-w.intensity)}</div>` : ''}
        <div class="sv-detail-src">Source: <strong>${w.source}</strong></div>
      </div>`;

    document.body.appendChild(sheet);

    requestAnimationFrame(() => {
      sheet.classList.add('sv-detail-sheet--open');
      setTimeout(() => sheet.querySelector<HTMLElement>('.sv-detail-panel')?.classList.add('sv-detail-panel--open'), 10);
    });

    const close = () => {
      sheet.querySelector<HTMLElement>('.sv-detail-panel')?.classList.remove('sv-detail-panel--open');
      sheet.classList.remove('sv-detail-sheet--open');
      if (this._detailMap) { this._detailMap.remove(); this._detailMap = null; }
      setTimeout(() => sheet.remove(), 360);
    };

    document.getElementById('svDetailClose')?.addEventListener('click', close);
    document.getElementById('svDetailOverlay')?.addEventListener('click', close);

    // Swipe to close
    const panel = sheet.querySelector<HTMLElement>('.sv-detail-panel')!;
    const handle= sheet.querySelector<HTMLElement>('.sv-detail-handle')!;
    let startY = 0;
    handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
    handle.addEventListener('touchmove', e => {
      const d = e.touches[0].clientY - startY;
      if (d > 0) { panel.style.transition = 'none'; panel.style.transform = `translateY(${d}px)`; }
    }, { passive: true });
    handle.addEventListener('touchend', e => {
      panel.style.transition = '';
      if (e.changedTouches[0].clientY - startY > 120) close();
      else panel.style.transform = '';
    });

    // Render map
    if (w.coords.length > 1) {
      setTimeout(() => {
        const mapEl = document.getElementById('svDetailMap');
        if (!mapEl) return;
        this._detailMap = L.map(mapEl, {
          zoomControl: false, dragging: true, attributionControl: false,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(this._detailMap!);
        const line = L.polyline(w.coords.map(c => L.latLng(c[0], c[1])), {
          color, weight: 4, opacity: 0.95,
        }).addTo(this._detailMap!);
        this._detailMap!.fitBounds(line.getBounds(), { padding: [24, 24] });
        const first = w.coords[0], last = w.coords[w.coords.length - 1];
        L.circleMarker([first[0], first[1]], { radius: 6, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(this._detailMap!);
        L.circleMarker([last[0], last[1]],   { radius: 6, color: '#fff', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).addTo(this._detailMap!);
      }, 200);
    }
  }
}

export const statsView = new StatsView();
