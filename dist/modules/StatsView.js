// ─── STATS VIEW ───────────────────────────────────────────────────────────────
// src/modules/StatsView.ts
//
// Two sub-tabs: Progress (charts, records, trends) + History (filterable list)
// Uses Chart.js (loaded from CDN in index.html) and UnifiedWorkout model.
/// <reference types="leaflet" />
import { loadUnifiedWorkouts, deleteUnifiedWorkout, markWorkoutDeleted, formatDurSec, formatPaceSec, SPORT_ICONS_U, } from './UnifiedWorkout.js';
import { getColor as _svColor, getIcon as _svIcon, getSportLabel as _svLabel } from './Tracker.js';
import { CS } from './cloudSync.js';
import { recordWeeklyGoalWin, getBestStreak } from './ProfileView.js';
import { verifiedOnly } from './UnifiedWorkout.js';
import { notifyWeeklyGoal } from './NotificationsService.js';
import { esc, safeUrl } from '../utils/dom.js';
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
// homeView imported lazily to avoid circular deps
// ── Constants ─────────────────────────────────────────────────────────────────
const WEEK_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BRAND = '#00c46a';
const BRAND_DIM = 'rgba(0,196,106,0.18)';
// ── Helpers ───────────────────────────────────────────────────────────────────
function startOfWeek(d = new Date()) {
    const r = new Date(d);
    const day = r.getDay() || 7;
    r.setHours(0, 0, 0, 0);
    r.setDate(r.getDate() - day + 1);
    return r;
}
function relDate(iso) {
    // Czesc starszych rekordow ma date pusta albo w innym formacie
    // (`String(a.date)` przy migracji). Bez tej bramki `MONTHS[NaN]` dawalo
    // doslowne „undefined NaN" na ekranie.
    const t = Date.parse(iso);
    if (!Number.isFinite(t))
        return '';
    const diff = Date.now() - t;
    const days = Math.floor(diff / 86400000);
    if (days === 0)
        return 'Today';
    if (days === 1)
        return 'Yesterday';
    if (days < 7)
        return `${days}d ago`;
    const d = new Date(iso);
    return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function set(id, val) {
    const el = document.getElementById(id);
    if (el)
        el.textContent = String(val);
}
// ── Chart registry (destroy on re-render) ─────────────────────────────────────
const _charts = {};
function destroyChart(id) {
    if (_charts[id]) {
        _charts[id].destroy();
        delete _charts[id];
    }
}
function makeChart(id, cfg) {
    destroyChart(id);
    const el = document.getElementById(id);
    if (!el)
        return;
    // Ensure responsive config is correct
    if (!cfg.options)
        cfg.options = {};
    cfg.options.responsive = true;
    cfg.options.maintainAspectRatio = false;
    _charts[id] = new Chart(el, cfg);
}
export class StatsView {
    constructor() {
        Object.defineProperty(this, "_workouts", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "_inited", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_subTab", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'progress'
        });
        Object.defineProperty(this, "_filter", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'all'
        });
        Object.defineProperty(this, "_sort", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'newest'
        });
        Object.defineProperty(this, "_detailMap", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        // ════════════════════════════════════════════════════════════════════════════
        // CHALLENGES TAB
        // ════════════════════════════════════════════════════════════════════════════
        //
        // Wyzwania oferuje aplikacja i obowiazuja automatycznie — nie ma czego
        // „dolaczac". Postep liczy backend z historii treningow, wiec klient
        // niczego tu nie sumuje ani nie zapamietuje.
        Object.defineProperty(this, "_chMonth", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_weekOffset", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
    }
    async init() {
        if (this._inited)
            return;
        this._inited = true;
        try {
            await this.render();
        }
        catch (e) {
            this._inited = false; // allow retry on next tab tap
            console.error('[StatsView] init failed:', e);
        }
    }
    async render() {
        try {
            this._workouts = await loadUnifiedWorkouts();
        }
        catch (e) {
            console.error('[StatsView] loadUnifiedWorkouts failed:', e);
            this._workouts = []; // render empty state instead of nothing
        }
        this._renderShell();
        this._bindSubTabs();
        this._showSubTab(this._subTab);
    }
    // ── Shell (sub-tab nav) ───────────────────────────────────────────────────
    _renderShell() {
        const scroll = document.querySelector('#tabStats .tab-scroll');
        if (!scroll)
            return;
        scroll.innerHTML = `
      <div class="sv2-tabs">
        ${[['progress', 'Progress', 'M3 17l6-6 4 4 8-8'],
            ['history', 'History', 'M12 8v4l3 2M3 12a9 9 0 1 0 9-9 9 9 0 0 0-9 9z'],
            ['challenges', 'Challenges', 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3']]
            .map(([id, label, path]) => `
          <button class="sv2-tab${this._subTab === id ? ' sv2-tab--active' : ''}" data-sv="${id}">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
              stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="${path}"/>
            </svg>${label}
          </button>`).join('')}
      </div>
      <div id="svContent"></div>`;
    }
    _bindSubTabs() {
        document.querySelectorAll('.sv2-tab').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('.sv2-tab').forEach(b => b.classList.remove('sv2-tab--active'));
                btn.classList.add('sv2-tab--active');
                this._subTab = btn.dataset.sv;
                this._showSubTab(this._subTab);
            });
        });
    }
    _showSubTab(tab) {
        const el = document.getElementById('svContent');
        if (!el)
            return;
        if (tab === 'progress')
            this._renderProgress(el);
        else if (tab === 'challenges')
            void this._renderChallenges(el);
        else
            this._renderHistory(el);
    }
    async _renderChallenges(el) {
        el.innerHTML = `<div class="sv2-section-title">Loading…</div>`;
        const userId = getUserId();
        if (!userId) {
            el.innerHTML = this._chEmpty('Sign in to see challenges');
            return;
        }
        let data = [];
        let label = '';
        try {
            const q = this._chMonth ? `&month=${this._chMonth}` : '';
            const r = await fetch(`${BACKEND_URL}/challenges/monthly?userId=${encodeURIComponent(userId)}${q}`);
            // 404 = backend nie ma jeszcze tej trasy. Bez tego sprawdzenia pusta
            // odpowiedz bledu wygladala identycznie jak „brak wyzwan" i nie bylo
            // wiadomo, ze problemem jest niewdrozony serwer.
            if (r.status === 404) {
                el.innerHTML = this._chEmpty('Update the server to enable challenges');
                return;
            }
            if (!r.ok) {
                el.innerHTML = this._chEmpty(`Challenges unavailable (${r.status})`);
                return;
            }
            const d = await r.json();
            data = d.data ?? [];
            label = d.label ?? '';
            this._chMonth = d.month ?? null;
        }
        catch {
            el.innerHTML = this._chEmpty('Challenges unavailable — check your connection');
            return;
        }
        if (!data.length) {
            el.innerHTML = this._chEmpty('No challenges this month');
            return;
        }
        const daysLeft = Math.max(0, Math.ceil((data[0].endAt - Date.now()) / 86400000));
        const doneCnt = data.filter(c => c.done).length;
        // Ukonczone na gore — to nagroda, ma byc widoczna od razu.
        const sorted = [...data].sort((a, b) => Number(b.done) - Number(a.done) || b.pct - a.pct);
        el.innerHTML = `
      <div class="sv2-section-title" style="display:flex;justify-content:space-between;align-items:baseline">
        <span>${esc(label)}</span>
        <span style="text-transform:none;letter-spacing:0;font-weight:600">
          ${doneCnt}/${data.length} · ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left</span>
      </div>
      <div style="padding:0 16px 32px;display:flex;flex-direction:column;gap:10px">
        ${sorted.map(c => this._chCard(c)).join('')}
      </div>`;
    }
    _chEmpty(msg) {
        return `<div style="padding:56px 24px;text-align:center;color:var(--app-text-muted)">
      <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor"
        stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
        style="opacity:.45;margin-bottom:10px"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/></svg>
      <div style="font-size:1.25rem">${esc(msg)}</div></div>`;
    }
    _chCard(c) {
        const unit = c.goalType === 'duration' ? 'min'
            : c.goalType === 'elevation' ? 'm'
                : c.goalType === 'daysActive' ? 'days'
                    : c.goalType === 'count' ? '×' : 'km';
        return `
      <div style="background:var(--app-surface-2,rgba(255,255,255,0.04));border-radius:14px;padding:14px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <div style="width:46px;height:46px;flex-shrink:0;border-radius:50%;
               background:${c.done ? c.color : `${c.color}22`};color:${c.done ? '#fff' : c.color};
               display:flex;align-items:center;justify-content:center;font-size:1.4rem">${esc(c.icon)}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:1.4rem;font-weight:700;color:var(--app-text)">${esc(c.title)}</div>
            <div style="font-size:1.2rem;color:var(--app-text-secondary);margin-top:3px;
                 line-height:1.35">${esc(c.description)}</div>
          </div>
        </div>
        <div style="margin-top:12px;height:6px;background:rgba(128,128,128,0.18);
             border-radius:3px;overflow:hidden">
          <div style="width:${c.pct}%;height:100%;background:${c.color};transition:width .4s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:1.15rem">
          <span style="color:var(--app-text-secondary)">${c.progress} / ${c.goalValue} ${unit}</span>
          <span style="color:${c.color};font-weight:700">${c.done ? 'Completed' : `${c.pct}%`}</span>
        </div>
      </div>`;
    }
    // ════════════════════════════════════════════════════════════════════════════
    // PROGRESS TAB
    // ════════════════════════════════════════════════════════════════════════════
    _renderProgress(el) {
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

      <!-- All time -->
      <section class="sv-section">
        <div class="sv-section__title">All time</div>
        <div id="svAllTime" style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px"></div>
      </section>

      <!-- Sport split -->
      <section class="sv-section">
        <div class="sv-section__title">Sport breakdown</div>
        <div id="svSportSplit"></div>
      </section>

      <!-- Activity map -->
      <section class="sv-section">
        <div class="sv-section__title">Activity map</div>
        <div id="svHeatmap"></div>
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
        this._renderAllTime();
        this._renderSportSplit();
        this._renderHeatmap();
        this._renderRecords();
        this._renderTrends();
        this._bindProgressEvents();
    }
    _weekRingsHTML() {
        // Ikony wektorowe zamiast emoji: emoji renderuja sie inaczej na kazdym
        // systemie i rozjezdzaja wyrownanie wewnatrz SVG.
        // Pierscien czasu mial kolor '#aaa' — szary pierscien wyglada jak wylaczony,
        // a nie jak wskaznik. Dostal wlasny akcent.
        const rings = [
            ['svRingKm', '#00c46a', 'M13 4v6h6M4 13a8 8 0 1 0 8-8', 'KM'],
            ['svRingTime', '#5B8DEF', 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'TIME'],
            ['svRingCnt', '#ffb545', 'M4 6h16M4 12h16M4 18h10', 'COUNT'],
        ];
        return rings.map(([id, col, icon, lbl]) => `
      <div class="sv-ring-wrap">
        <svg viewBox="0 0 90 90">
          <circle cx="45" cy="45" r="36" fill="none" stroke="#3a4147" stroke-width="7"/>
          <circle id="${id}" cx="45" cy="45" r="36" fill="none"
            stroke="${col}" stroke-width="7" stroke-dasharray="226.2" stroke-dashoffset="226.2"
            stroke-linecap="round" transform="rotate(-90 45 45)"
            style="transition:stroke-dashoffset 0.9s cubic-bezier(0.4,0,0.2,1)"/>
          <g transform="translate(38.5 17) scale(0.55)" fill="none" stroke="${col}"
             stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" opacity="0.85">
            <path d="${icon}"/>
          </g>
          <text x="45" y="42" text-anchor="middle" class="sv-ring-val" font-size="12" font-weight="800"
            font-family="Manrope,sans-serif" id="${id}Val">—</text>
          <text x="45" y="53" text-anchor="middle" class="sv-ring-lbl" font-size="8"
            font-family="Manrope,sans-serif">${lbl}</text>
        </svg>
      </div>`).join('');
    }
    /** Zastap wykres komunikatem, gdy nie ma czego rysowac.
     *
     *  Pusty wykres pokazywal sama os „1,0 0,8 0,6…" i nic wiecej — to wyglada
     *  na awarie, nie na brak danych. Zwraca `true`, gdy przejal kontrole. */
    _emptyChart(canvasId, msg, data) {
        if (data.some(v => v > 0))
            return false; // sa dane — rysuj normalnie
        const wrap = document.getElementById(canvasId)?.parentElement;
        if (!wrap)
            return true;
        wrap.innerHTML = `<div style="height:100%;display:flex;flex-direction:column;
      align-items:center;justify-content:center;gap:6px;color:var(--app-text-muted);
      text-align:center;padding:0 16px">
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor"
        stroke-width="1.6" stroke-linecap="round" opacity="0.5">
        <path d="M3 3v18h18M7 15l4-4 3 3 5-6"/></svg>
      <span style="font-size:1.2rem">${esc(msg)}</span></div>`;
        return true;
    }
    _renderWeek() {
        const now = new Date();
        const mon = startOfWeek(now);
        mon.setDate(mon.getDate() + this._weekOffset * 7);
        const sun = new Date(mon);
        sun.setDate(mon.getDate() + 6);
        sun.setHours(23, 59, 59, 999);
        const week = this._workouts.filter(w => {
            const d = new Date(w.date);
            return d >= mon && d <= sun;
        });
        // Cel tygodniowy = OSIĄGNIĘCIE, więc liczą się tylko treningi z Track.
        // Ręcznie dodany trening przyjmuje dowolne liczby (klasyczna dziura, którą
        // ma też Strava: „800 km w 10 minut"), a nagroda możliwa do zdobycia
        // wpisaniem liczby nic nie znaczy. Import (Strava/Health) też nie liczy —
        // dane mogą być uczciwe, ale MapYou nie ma jak ich zweryfikować.
        // Historia i statystyki nadal pokazują wszystko — patrz `week` niżej.
        const weekVerified = verifiedOnly(week);
        const wKm = weekVerified.reduce((s, w) => s + w.distanceKm, 0);
        const wSec = weekVerified.reduce((s, w) => s + w.durationSec, 0);
        const wCnt = weekVerified.length;
        const goalKm = +(localStorage.getItem('goalKm') ?? 35);
        const goalMin = +(localStorage.getItem('goalTime') ?? 300);
        const goalCnt = +(localStorage.getItem('goalCount') ?? 7);
        const CIRC = 226.2;
        const setRing = (id, pct, valStr) => {
            const arc = document.getElementById(id);
            if (arc)
                arc.setAttribute('stroke-dashoffset', String(Math.max(0, CIRC - Math.min(pct, 1) * CIRC)));
            set(`${id}Val`, valStr);
        };
        setRing('svRingKm', wKm / goalKm, wKm.toFixed(1));
        setRing('svRingTime', (wSec / 60) / goalMin, wSec >= 3600 ? `${Math.floor(wSec / 3600)}h${Math.floor((wSec % 3600) / 60)}m` : `${Math.floor(wSec / 60)}m`);
        setRing('svRingCnt', wCnt / goalCnt, String(wCnt));
        const pct = Math.min(Math.round((wKm / goalKm) * 100), 100);
        set('svGoalPct', `${pct}%`);
        const fill = document.getElementById('svGoalFill');
        if (fill)
            fill.style.width = `${pct}%`;
        // Cel tygodniowy — powiadamiamy WYLACZNIE przy pierwszym zdobyciu.
        //
        // `pct >= 100` pozostaje prawdziwe do konca tygodnia, wiec sam warunek
        // nie wystarcza: statystyki przeliczaja sie przy kazdym wejsciu na ekran
        // i uzytkownik dostawal to samo powiadomienie w kolko.
        // O tym, czy cos sie NAPRAWDE wydarzylo, decyduje `recordWeeklyGoalWin`.
        if (pct >= 100 && this._weekOffset === 0) {
            const isNewWin = recordWeeklyGoalWin();
            if (isNewWin) {
                const wins = parseInt(localStorage.getItem('mapyou_weekly_wins') ?? '0', 10);
                notifyWeeklyGoal(wins);
            }
        }
        // Week label
        if (this._weekOffset === 0) {
            set('svWeekLabel', 'This week');
            document.getElementById('svWeekNext')?.setAttribute('disabled', '');
        }
        else {
            const fmt = (d) => d.toLocaleDateString('en', { month: 'short', day: 'numeric' });
            set('svWeekLabel', `${fmt(mon)}–${fmt(sun)}`);
            document.getElementById('svWeekNext')?.removeAttribute('disabled');
        }
        // Bar chart for days
        const dayKm = Array(7).fill(0);
        const dayColors = Array(7).fill(BRAND_DIM);
        week.forEach(w => {
            const i = Math.floor((new Date(w.date).getTime() - mon.getTime()) / 86400000);
            if (i >= 0 && i < 7) {
                dayKm[i] += w.distanceKm;
                dayColors[i] = BRAND;
            }
        });
        makeChart('svWeekChart', {
            type: 'bar',
            data: {
                labels: WEEK_DAYS.map((d, i) => {
                    const dd = new Date(mon);
                    dd.setDate(mon.getDate() + i);
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
    _renderMonthChart(mode) {
        const now = new Date();
        const year = now.getFullYear();
        const month = now.getMonth();
        const days = new Date(year, month + 1, 0).getDate();
        const byDay = Array(days).fill(0);
        this._workouts.forEach(w => {
            const d = new Date(w.date);
            if (d.getFullYear() === year && d.getMonth() === month) {
                byDay[d.getDate() - 1] += mode === 'dist' ? w.distanceKm : w.durationSec / 60;
            }
        });
        if (this._emptyChart('svMonthChart', 'No activities this month', byDay))
            return;
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
    _renderYearChart() {
        const year = new Date().getFullYear();
        const byMonth = Array(12).fill(0);
        this._workouts.forEach(w => {
            const d = new Date(w.date);
            if (d.getFullYear() === year)
                byMonth[d.getMonth()] += w.distanceKm;
        });
        if (this._emptyChart('svYearChart', 'No activities this year', byMonth))
            return;
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
    /** Dorobek od poczatku — czego Progress do tej pory w ogole nie pokazywal.
     *
     *  Zakladka miala wykresy tygodnia, miesiaca i roku, ale nigdzie nie bylo
     *  odpowiedzi na najprostsze pytanie: „ile w sumie?". Przy aplikacji, ktora
     *  zbiera dane od miesiecy, to najbardziej satysfakcjonujaca liczba. */
    _renderAllTime() {
        const el = document.getElementById('svAllTime');
        if (!el)
            return;
        const ws = this._workouts;
        if (!ws.length) {
            el.innerHTML = '<p class="sv-empty">No workouts yet</p>';
            return;
        }
        const km = ws.reduce((s, w) => s + w.distanceKm, 0);
        const sec = ws.reduce((s, w) => s + w.durationSec, 0);
        const elev = ws.reduce((s, w) => s + (w.elevGain || 0), 0);
        const days = new Set(ws.map(w => String(w.date).slice(0, 10))).size;
        // Najstarszy trening wybieramy po ZNACZNIKU CZASU, nie po porownaniu
        // tekstow. Wystarczyl jeden rekord z pusta data, zeby wygral leksykalnie
        // i kafel pokazywal „undefined NaN".
        const czasy = ws.map(w => Date.parse(String(w.date))).filter(t => Number.isFinite(t));
        const first = czasy.length ? new Date(Math.min(...czasy)).toISOString() : null;
        const tiles = [
            [km.toFixed(0), 'km', 'Total distance'],
            [String(Math.round(sec / 3600)), 'h', 'Time moving'],
            [String(ws.length), '', 'Workouts'],
            [String(days), '', 'Active days'],
        ];
        if (elev > 0)
            tiles.push([String(Math.round(elev)), 'm', 'Elevation gained']);
        // Kafel tylko wtedy, gdy data jest sensowna — pusty wyglada jak awaria.
        if (first)
            tiles.push([relDate(first), '', 'First workout']);
        el.innerHTML = tiles.map(([val, unit, lbl]) => `
      <div style="background:rgba(128,128,128,0.10);border-radius:12px;padding:12px 14px">
        <div style="font-size:1.9rem;font-weight:800;color:var(--app-text);line-height:1.1">
          ${esc(val)}<span style="font-size:1.1rem;font-weight:700;opacity:.55"> ${unit}</span></div>
        <div style="font-size:1.1rem;color:var(--app-text-secondary);margin-top:3px">${lbl}</div>
      </div>`).join('');
    }
    /** Udzial poszczegolnych sportow w dorobku.
     *
     *  Profil pokazuje jeden wykres tygodniowy — tu chodzi o cos innego:
     *  z czego SKLADA sie caly Twoj kilometraz. Same dane, ktore juz masz. */
    _renderSportSplit() {
        const el = document.getElementById('svSportSplit');
        if (!el)
            return;
        const ws = this._workouts;
        if (!ws.length) {
            el.innerHTML = '<p class="sv-empty">No workouts yet</p>';
            return;
        }
        const agg = new Map();
        for (const w of ws) {
            const k = w.sport || w.type || 'other';
            const a = agg.get(k) ?? { km: 0, n: 0 };
            a.km += w.distanceKm;
            a.n += 1;
            agg.set(k, a);
        }
        const rows = [...agg.entries()].sort((a, b) => b[1].km - a[1].km || b[1].n - a[1].n);
        const maxKm = Math.max(...rows.map(r => r[1].km), 1);
        const total = rows.reduce((s, r) => s + r[1].km, 0);
        el.innerHTML = rows.map(([sport, v]) => {
            const pct = total > 0 ? Math.round((v.km / total) * 100) : 0;
            return `
      <div style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;font-size:1.2rem;margin-bottom:5px">
          <span style="color:var(--app-text);font-weight:600">${esc(_svLabel(sport))}</span>
          <span style="color:var(--app-text-secondary)">
            ${v.km >= 1 ? `${v.km.toFixed(0)} km · ` : ''}${v.n}×${total > 0 ? ` · ${pct}%` : ''}</span>
        </div>
        <div style="height:7px;background:rgba(128,128,128,0.15);border-radius:4px;overflow:hidden">
          <div style="width:${Math.max(3, (v.km / maxKm) * 100)}%;height:100%;
               background:${_svColor(sport)};border-radius:4px"></div>
        </div>
      </div>`;
        }).join('');
    }
    /** Mapa aktywnosci — kwadrat na kazdy dzien ostatnich 26 tygodni.
     *
     *  Jedno spojrzenie mowi o regularnosci wiecej niz slupki: widac przerwy,
     *  serie i to, czy trenujesz w te same dni tygodnia. */
    _renderHeatmap() {
        const el = document.getElementById('svHeatmap');
        if (!el)
            return;
        const WEEKS = 26;
        const byDay = new Map();
        for (const w of this._workouts) {
            const t = Date.parse(String(w.date));
            if (!Number.isFinite(t))
                continue;
            const k = new Date(t).toISOString().slice(0, 10);
            byDay.set(k, (byDay.get(k) ?? 0) + Math.max(w.distanceKm, w.durationSec / 3600));
        }
        if (!byDay.size) {
            el.innerHTML = '<p class="sv-empty">No workouts yet</p>';
            return;
        }
        const koniec = startOfWeek(new Date());
        koniec.setDate(koniec.getDate() + 7);
        const start = new Date(koniec);
        start.setDate(start.getDate() - WEEKS * 7);
        const max = Math.max(...byDay.values(), 1);
        let kolumny = '';
        for (let w = 0; w < WEEKS; w++) {
            let kom = '';
            for (let d = 0; d < 7; d++) {
                const day = new Date(start);
                day.setDate(start.getDate() + w * 7 + d);
                const k = day.toISOString().slice(0, 10);
                const v = byDay.get(k) ?? 0;
                const przyszlosc = day.getTime() > Date.now();
                // Cztery poziomy nasycenia — wiecej i tak nie da sie rozroznic okiem.
                const alpha = v === 0 ? 0 : v / max > 0.66 ? 1 : v / max > 0.33 ? 0.68 : 0.38;
                const bg = przyszlosc ? 'transparent'
                    : alpha === 0 ? 'rgba(128,128,128,0.14)'
                        : `rgba(0,196,106,${alpha})`;
                kom += `<div title="${k}${v ? ` — ${v.toFixed(1)}` : ''}"
          style="width:100%;aspect-ratio:1;border-radius:2px;background:${bg}"></div>`;
            }
            kolumny += `<div style="display:grid;grid-template-rows:repeat(7,1fr);gap:2px">${kom}</div>`;
        }
        el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(${WEEKS},1fr);gap:2px">${kolumny}</div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:10px;
           font-size:1.05rem;color:var(--app-text-secondary)">
        <span>Less</span>
        ${[0.14, 0.38, 0.68, 1].map(a => `<div style="width:10px;height:10px;border-radius:2px;
          background:rgba(${a === 0.14 ? '128,128,128,0.14' : `0,196,106,${a}`})"></div>`).join('')}
        <span>More</span>
      </div>`;
    }
    _renderRecords() {
        const el = document.getElementById('svRecords');
        if (!el || !this._workouts.length) {
            if (el)
                el.innerHTML = '<p class="sv-empty">No workouts yet</p>';
            return;
        }
        const ws = this._workouts;
        const byDist = [...ws].sort((a, b) => b.distanceKm - a.distanceKm)[0];
        const byDur = [...ws].sort((a, b) => b.durationSec - a.durationSec)[0];
        const byPace = ws.filter(w => w.type !== 'cycling' && w.paceMinKm > 0).sort((a, b) => a.paceMinKm - b.paceMinKm)[0];
        const byElev = [...ws].sort((a, b) => b.elevGain - a.elevGain)[0];
        const bestStreak = getBestStreak();
        // Ikony wektorowe zamiast emoji — te renderowaly sie inaczej na kazdym
        // systemie, mialy rozne szerokosci i rozjezdzaly wyrownanie kolumny.
        const I = {
            dist: 'M13 4v6h6M4 13a8 8 0 1 0 8-8',
            time: 'M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
            pace: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
            elev: 'M3 20l6-11 4 6 2-3 6 8H3z',
            fire: 'M12 3c1 4 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-3-1-5 1-8z',
        };
        const records = [
            [I.dist, 'Longest run', byDist ? `${byDist.distanceKm.toFixed(1)} km` : '—', byDist ? relDate(byDist.date) : ''],
            [I.time, 'Longest time', byDur ? formatDurSec(byDur.durationSec) : '—', byDur ? relDate(byDur.date) : ''],
            [I.pace, 'Best pace', byPace ? `${formatPaceSec(byPace.paceMinKm)}/km` : '—', byPace ? relDate(byPace.date) : ''],
            [I.elev, 'Most elevation', byElev && byElev.elevGain > 0 ? `${Math.round(byElev.elevGain)} m` : '—', byElev && byElev.elevGain > 0 ? relDate(byElev.date) : ''],
            [I.fire, 'Best streak', bestStreak >= 1 ? `${bestStreak} days` : '—', bestStreak >= 1 ? 'All time' : ''],
        ];
        el.innerHTML = records.map(([path, lbl, val, date]) => `
      <div class="sv-record">
        <span class="sv-record__icon">
          <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor"
            stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg>
        </span>
        <div class="sv-record__info">
          <span class="sv-record__label">${lbl}</span>
          <span class="sv-record__date">${date}</span>
        </div>
        <span class="sv-record__val">${val}</span>
      </div>`).join('');
    }
    _renderTrends() {
        const el = document.getElementById('svTrendsContent');
        if (!el)
            return;
        const now = new Date();
        const thisMon = startOfWeek(now);
        const lastMon = new Date(thisMon);
        lastMon.setDate(lastMon.getDate() - 7);
        const lastSun = new Date(thisMon);
        lastSun.setSeconds(-1);
        const thisMonth = now.getMonth();
        const lastMonth = thisMonth === 0 ? 11 : thisMonth - 1;
        const lastMonthYear = thisMonth === 0 ? now.getFullYear() - 1 : now.getFullYear();
        const thisWeekW = this._workouts.filter(w => new Date(w.date) >= thisMon);
        const lastWeekW = this._workouts.filter(w => { const d = new Date(w.date); return d >= lastMon && d < thisMon; });
        const thisMonW = this._workouts.filter(w => { const d = new Date(w.date); return d.getMonth() === thisMonth && d.getFullYear() === now.getFullYear(); });
        const lastMonW = this._workouts.filter(w => { const d = new Date(w.date); return d.getMonth() === lastMonth && d.getFullYear() === lastMonthYear; });
        const km = (arr) => arr.reduce((s, w) => s + w.distanceKm, 0);
        const cnt = (arr) => arr.length;
        const trend = (curr, prev) => {
            if (prev === 0)
                return curr > 0 ? '<span class="sv-trend--up">New</span>' : '—';
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
    _bindProgressEvents() {
        document.getElementById('svWeekPrev')?.addEventListener('click', () => {
            this._weekOffset--;
            this._renderWeek();
        });
        document.getElementById('svWeekNext')?.addEventListener('click', () => {
            if (this._weekOffset >= 0)
                return;
            this._weekOffset++;
            this._renderWeek();
        });
        // Month chart toggle
        document.getElementById('svMonthSeg')?.querySelectorAll('.sv-seg__btn').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#svMonthSeg .sv-seg__btn').forEach(b => b.classList.remove('sv-seg__btn--active'));
                btn.classList.add('sv-seg__btn--active');
                this._renderMonthChart(btn.dataset.seg);
            });
        });
        // Goal inputs
        const bind = (id, key) => {
            document.getElementById(id)?.addEventListener('change', e => {
                const val = Math.max(1, +e.target.value || 1);
                localStorage.setItem(key, String(val));
                this._renderWeek();
            });
        };
        bind('svGoalKm', 'goalKm');
        bind('svGoalTime', 'goalTime');
        bind('svGoalCount', 'goalCount');
    }
    // ════════════════════════════════════════════════════════════════════════════
    // HISTORY TAB
    // ════════════════════════════════════════════════════════════════════════════
    _renderHistory(el) {
        el.innerHTML = `
      <!-- Filters + Sort -->
      <div class="sv-toolbar">
        <div class="sv-filters" id="svFilters">
          ${['all', 'running', 'walking', 'cycling'].map(f => `
            <button class="sv-filter${this._filter === f ? ' sv-filter--active' : ''}" data-f="${f}">
              ${f === 'all' ? 'All' : SPORT_ICONS_U[f] + ' ' + f.charAt(0).toUpperCase() + f.slice(1)}
            </button>`).join('')}
        </div>
        <select class="sv-sort" id="svSort">
          <option value="newest"  ${this._sort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="oldest"  ${this._sort === 'oldest' ? 'selected' : ''}>Oldest</option>
          <option value="longest" ${this._sort === 'longest' ? 'selected' : ''}>Longest distance</option>
          <option value="fastest" ${this._sort === 'fastest' ? 'selected' : ''}>Fastest pace</option>
          <option value="duration"${this._sort === 'duration' ? 'selected' : ''}>Longest time</option>
        </select>
      </div>

      <!-- List -->
      <div id="svHistoryList"></div>`;
        this._renderHistoryList();
        this._bindHistoryEvents();
    }
    _filteredSorted() {
        let ws = this._filter === 'all'
            ? [...this._workouts]
            : this._workouts.filter(w => w.type === this._filter);
        switch (this._sort) {
            case 'oldest':
                ws.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
                break;
            case 'longest':
                ws.sort((a, b) => b.distanceKm - a.distanceKm);
                break;
            case 'fastest':
                ws = ws.filter(w => w.paceMinKm > 0);
                ws.sort((a, b) => a.paceMinKm - b.paceMinKm);
                break;
            case 'duration':
                ws.sort((a, b) => b.durationSec - a.durationSec);
                break;
            default: ws.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        }
        return ws;
    }
    _renderHistoryList() {
        const el = document.getElementById('svHistoryList');
        if (!el)
            return;
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
            const sportKey = w.sport ?? w.type;
            const color = _svColor(sportKey);
            const third = w.type === 'cycling'
                ? `${w.speedKmH.toFixed(1)} km/h`
                : formatPaceSec(w.paceMinKm) + '/km';
            const hasMap = w.coords.length >= 1;
            return `
        <div class="sv-item" data-id="${w.id}" data-source="${w.source}">
          <div class="sv-item__color-bar" style="background:${color}"></div>
          <div class="sv-item__body">
            <div class="sv-item__top">
              <span class="sv-item__icon">${_svIcon(sportKey)}</span>
              <span class="sv-item__name">${esc(w.name || w.description || _svLabel(sportKey))}</span>
              <span class="sv-item__date">${relDate(w.date)}</span>
            </div>
            <div class="sv-item__stats">
              <span>${w.distanceKm.toFixed(2)} km</span>
              <span>${formatDurSec(w.durationSec)}</span>
              <span>${third}</span>
              ${hasMap ? `<span class="sv-item__has-map">${w.coords.length === 1 ? '📍 point' : '📍 GPS'}</span>` : ''}
              <span class="sv-item__src sv-item__src--${w.source}">${w.source}</span>
            </div>
          </div>
          <button class="sv-item__del" data-del="${w.id}" title="Delete">✕</button>
        </div>`;
        }).join('');
        // Bind click events
        el.querySelectorAll('.sv-item').forEach(item => {
            item.addEventListener('click', e => {
                if (e.target.closest('.sv-item__del'))
                    return;
                const id = item.dataset.id;
                const w = this._workouts.find(x => x.id === id);
                if (w)
                    this._openDetail(w);
            });
        });
        el.querySelectorAll('[data-del]').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (!confirm('Delete this workout?'))
                    return;
                const id = btn.dataset.del;
                // 1. Mark deleted so migration never restores it
                markWorkoutDeleted(id);
                // 2. Delete from ALL tables
                await Promise.all([
                    deleteUnifiedWorkout(id).catch(() => { }),
                    CS.deleteEnrichedActivity(id).catch(() => { }),
                    CS.deleteActivity(id).catch(() => { }),
                    CS.deleteWorkout(id).catch(() => { }),
                ]);
                // 3. Update local list + re-render
                this._workouts = this._workouts.filter(w => w.id !== id);
                this._renderHistoryList();
                // 4. Refresh Home feed
                void import('./HomeView.js').then(m => m.homeView.render());
            });
        });
    }
    _bindHistoryEvents() {
        document.getElementById('svFilters')?.querySelectorAll('.sv-filter').forEach(btn => {
            btn.addEventListener('click', () => {
                document.querySelectorAll('#svFilters .sv-filter').forEach(b => b.classList.remove('sv-filter--active'));
                btn.classList.add('sv-filter--active');
                this._filter = btn.dataset.f;
                this._renderHistoryList();
            });
        });
        document.getElementById('svSort')?.addEventListener('change', e => {
            this._sort = e.target.value;
            this._renderHistoryList();
        });
    }
    // ── Activity detail sheet ─────────────────────────────────────────────────
    _openDetail(w) {
        document.getElementById('svDetailSheet')?.remove();
        const sportKey = w.sport ?? w.type;
        const color = _svColor(sportKey);
        const third = w.type === 'cycling'
            ? `${w.speedKmH.toFixed(1)}<span class="sv-detail__unit">km/h</span>`
            : `${formatPaceSec(w.paceMinKm)}<span class="sv-detail__unit">/km</span>`;
        const sheet = document.createElement('div');
        sheet.id = 'svDetailSheet';
        sheet.className = 'sv-detail-sheet';
        sheet.innerHTML = `
      <div class="sv-detail-overlay" id="svDetailOverlay"></div>
      <div class="sv-detail-panel" id="svDetailPanel">
        <div class="sv-detail-handle"></div>
        <div class="sv-detail-header" style="--wcolor:${color}">
          <span class="sv-detail-header__icon">${_svIcon(sportKey)}</span>
          <div>
            <div class="sv-detail-header__name">${esc(w.name || w.description || _svLabel(sportKey))}</div>
            <div class="sv-detail-header__date">${new Date(w.date).toLocaleDateString('en', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</div>
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

        ${w.coords.length >= 1 ? `<div class="sv-detail-map" id="svDetailMap"></div>` : ''}

        ${w.notes ? `<div class="sv-detail-notes">🔒 ${esc(w.notes)}</div>` : ''}
        ${w.photoUrl ? `<div class="sv-detail-photo"><img src="${safeUrl(w.photoUrl)}" alt=""/></div>` : ''}
        ${w.intensity ? `<div class="sv-detail-intensity">Intensity: ${'●'.repeat(w.intensity)}${'○'.repeat(5 - w.intensity)}</div>` : ''}
        <div class="sv-detail-src">Source: <strong>${w.source}</strong></div>
      </div>`;
        document.body.appendChild(sheet);
        requestAnimationFrame(() => {
            sheet.classList.add('sv-detail-sheet--open');
            setTimeout(() => sheet.querySelector('.sv-detail-panel')?.classList.add('sv-detail-panel--open'), 10);
        });
        const close = () => {
            sheet.querySelector('.sv-detail-panel')?.classList.remove('sv-detail-panel--open');
            sheet.classList.remove('sv-detail-sheet--open');
            if (this._detailMap) {
                this._detailMap.remove();
                this._detailMap = null;
            }
            setTimeout(() => sheet.remove(), 360);
        };
        document.getElementById('svDetailClose')?.addEventListener('click', close);
        document.getElementById('svDetailOverlay')?.addEventListener('click', close);
        // Swipe to close
        const panel = sheet.querySelector('.sv-detail-panel');
        const handle = sheet.querySelector('.sv-detail-handle');
        let startY = 0;
        handle.addEventListener('touchstart', e => { startY = e.touches[0].clientY; }, { passive: true });
        handle.addEventListener('touchmove', e => {
            const d = e.touches[0].clientY - startY;
            if (d > 0) {
                panel.style.transition = 'none';
                panel.style.transform = `translateY(${d}px)`;
            }
        }, { passive: true });
        handle.addEventListener('touchend', e => {
            panel.style.transition = '';
            if (e.changedTouches[0].clientY - startY > 120)
                close();
            else
                panel.style.transform = '';
        });
        // Render map
        if (w.coords.length >= 1) {
            setTimeout(() => {
                const mapEl = document.getElementById('svDetailMap');
                if (!mapEl)
                    return;
                this._detailMap = L.map(mapEl, {
                    zoomControl: false, dragging: true, attributionControl: false,
                });
                L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(this._detailMap);
                if (w.coords.length === 1) {
                    // Single point — pin marker, zoom 15
                    const [lat, lng] = w.coords[0];
                    this._detailMap.setView([lat, lng], 15);
                    L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: '',
                            html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="32" height="48">
                <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"
                  fill="${color}" stroke="white" stroke-width="1.5"/>
                <circle cx="12" cy="12" r="5" fill="white"/>
              </svg>`,
                            iconSize: [32, 48],
                            iconAnchor: [16, 48],
                        }),
                    }).addTo(this._detailMap);
                }
                else {
                    // Route — polyline with start/end markers
                    const line = L.polyline(w.coords.map(c => L.latLng(c[0], c[1])), {
                        color, weight: 4, opacity: 0.95,
                    }).addTo(this._detailMap);
                    this._detailMap.fitBounds(line.getBounds(), { padding: [24, 24] });
                    const first = w.coords[0], last = w.coords[w.coords.length - 1];
                    L.circleMarker([first[0], first[1]], { radius: 6, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(this._detailMap);
                    L.circleMarker([last[0], last[1]], { radius: 6, color: '#fff', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).addTo(this._detailMap);
                }
            }, 200);
        }
    }
}
export const statsView = new StatsView();
//# sourceMappingURL=StatsView.js.map