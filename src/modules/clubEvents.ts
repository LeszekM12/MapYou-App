// ─── CLUB EVENTS / CHALLENGES — UI ───────────────────────────────────────────
// Talks to the events API (routes/clubEvents.ts). All progress numbers come
// from the server — the client never computes or reports a score, so a device
// cannot claim a result it didn't earn. See the anti-cheat gate there:
// Track workouts always count; watch/Health imports count only with a GPS
// track; manual entries and archive imports never do.

import { BACKEND_URL } from '../config.js';
import { getUserId }   from './UserProfile.js';

// ── Types (mirror the API payloads) ──────────────────────────────────────────

export type EventGoalType = 'distance' | 'duration' | 'count';

export interface EventSummary {
  eventId: string; title: string; description: string;
  goalType: EventGoalType; goalValue: number; sport: string | null;
  startAt: number; endAt: number;
  participantCount: number; creatorId: string;
}

interface Standing {
  userId: string; name: string; avatarB64: string | null;
  progress: number; done: boolean; completedAt: number | null;
}

interface EventDetail extends EventSummary {
  participants: string[];
  standings: Standing[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));

/** Goal formatting — one place, so the list, the card and the detail agree. */
export function goalLabel(t: EventGoalType, v: number): string {
  if (t === 'distance') return `${v} km`;
  if (t === 'duration') return v >= 60 ? `${Math.round(v / 60 * 10) / 10} h` : `${v} min`;
  return `${v} ${v === 1 ? 'workout' : 'workouts'}`;
}

export function progressLabel(t: EventGoalType, v: number): string {
  if (t === 'distance') return `${v.toFixed(1)} km`;
  if (t === 'duration') return v >= 60 ? `${Math.floor(v / 60)}h ${Math.round(v % 60)}m` : `${Math.round(v)} min`;
  return String(Math.round(v));
}

/** "3 days left" · "Ends today" · "Ended 12 Jul" */
function timeLeft(endAt: number): string {
  const ms = endAt - Date.now();
  if (ms < 0) return `Ended ${new Date(endAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`;
  const days = Math.floor(ms / 86400000);
  if (days === 0) return 'Ends today';
  if (days === 1) return '1 day left';
  return `${days} days left`;
}

const SPORTS = ['', 'running', 'walking', 'cycling', 'hiking', 'fitness', 'swimming'];

// ── API ──────────────────────────────────────────────────────────────────────

export async function fetchEvents(clubId: string, scope: 'active'|'past' = 'active'): Promise<EventSummary[]> {
  try {
    const r = await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(clubId)}/events?scope=${scope}`, { cache: 'no-store' });
    const j = await r.json() as { status: string; data: EventSummary[] };
    return j.status === 'ok' ? j.data : [];
  } catch { return []; }
}

async function fetchEventDetail(eventId: string): Promise<EventDetail | null> {
  try {
    const r = await fetch(`${BACKEND_URL}/events/${encodeURIComponent(eventId)}`, { cache: 'no-store' });
    const j = await r.json() as { status: string; data: EventDetail };
    return j.status === 'ok' ? j.data : null;
  } catch { return null; }
}

async function joinEvent(eventId: string, leave = false): Promise<boolean> {
  try {
    const r = await fetch(`${BACKEND_URL}/events/${encodeURIComponent(eventId)}/${leave ? 'leave' : 'join'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: getUserId() }),
    });
    return r.ok;
  } catch { return false; }
}

// ── Create event modal ───────────────────────────────────────────────────────

export function openCreateEventModal(clubId: string, onCreated: () => void): void {
  document.getElementById('evCreateModal')?.remove();
  const m = document.createElement('div');
  m.id = 'evCreateModal';
  m.className = 'ev-modal';

  // Default window: today 00:00 → +30 days. Day-granular on purpose — people
  // read "July challenge" as the whole of July, not "from the minute I hit
  // Create", so we never clip a participant's morning workout.
  const today = new Date();
  const end   = new Date(today.getTime() + 30 * 86400000);
  const iso   = (d: Date) => d.toISOString().slice(0, 10);

  m.innerHTML = `
    <div class="ev-modal__card">
      <h2 class="ev-modal__title">New challenge</h2>

      <label class="ev-field">
        <span>Title</span>
        <input id="evTitle" type="text" maxlength="60" placeholder="e.g. July 200 km"/>
      </label>

      <label class="ev-field">
        <span>Description</span>
        <textarea id="evDesc" rows="2" maxlength="240" placeholder="What is this challenge about?"></textarea>
      </label>

      <div class="ev-row">
        <label class="ev-field">
          <span>Goal</span>
          <select id="evGoalType">
            <option value="distance">Distance (km)</option>
            <option value="duration">Time (minutes)</option>
            <option value="count">Workouts</option>
          </select>
        </label>
        <label class="ev-field ev-field--sm">
          <span>Target</span>
          <input id="evGoalValue" type="number" min="1" step="1" value="100"/>
        </label>
      </div>

      <div class="ev-row">
        <label class="ev-field">
          <span>Sport</span>
          <select id="evSport">
            ${SPORTS.map(s => `<option value="${s}">${s ? s[0].toUpperCase() + s.slice(1) : 'Any sport'}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="ev-row">
        <label class="ev-field"><span>Starts</span><input id="evStart" type="date" value="${iso(today)}"/></label>
        <label class="ev-field"><span>Ends</span><input id="evEnd" type="date" value="${iso(end)}"/></label>
      </div>

      <p class="ev-note">
        Only workouts recorded in <b>Track</b> count — plus watch imports that
        include a GPS route. Manually added workouts never count toward a
        challenge.
      </p>

      <div id="evCreateErr" class="ev-err"></div>
      <button class="ev-btn ev-btn--primary" id="evCreate">Create challenge</button>
      <button class="ev-btn ev-btn--ghost" id="evCancel">Cancel</button>
    </div>`;
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('ev-modal--visible'));

  const close = () => { m.classList.remove('ev-modal--visible'); setTimeout(() => m.remove(), 220); };
  m.querySelector('#evCancel')?.addEventListener('click', close);
  m.addEventListener('click', e => { if (e.target === m) close(); });

  m.querySelector('#evCreate')?.addEventListener('click', async () => {
    const err   = m.querySelector<HTMLElement>('#evCreateErr')!;
    const title = m.querySelector<HTMLInputElement>('#evTitle')!.value.trim();
    const goalValue = Number(m.querySelector<HTMLInputElement>('#evGoalValue')!.value);
    const startStr  = m.querySelector<HTMLInputElement>('#evStart')!.value;
    const endStr    = m.querySelector<HTMLInputElement>('#evEnd')!.value;
    if (!title)             { err.textContent = 'Give the challenge a title.'; return; }
    if (!(goalValue > 0))   { err.textContent = 'Target must be greater than 0.'; return; }
    if (!startStr || !endStr) { err.textContent = 'Pick both dates.'; return; }

    // Whole days: start at 00:00, end at 23:59:59 — see the comment above.
    const startAt = new Date(`${startStr}T00:00:00`).getTime();
    const endAt   = new Date(`${endStr}T23:59:59`).getTime();
    if (endAt <= startAt) { err.textContent = 'The end date must be after the start date.'; return; }

    const btn = m.querySelector<HTMLButtonElement>('#evCreate')!;
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const r = await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(clubId)}/events`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          creatorId:   getUserId(),
          title,
          description: m.querySelector<HTMLTextAreaElement>('#evDesc')!.value.trim(),
          goalType:    m.querySelector<HTMLSelectElement>('#evGoalType')!.value,
          goalValue,
          sport:       m.querySelector<HTMLSelectElement>('#evSport')!.value || null,
          startAt, endAt,
        }),
      });
      if (!r.ok) throw new Error(String(r.status));
      close();
      onCreated();
    } catch {
      err.textContent = 'Could not create the challenge. Check your connection.';
      btn.disabled = false; btn.textContent = 'Create challenge';
    }
  });
}

// ── Events list (club tab) ───────────────────────────────────────────────────

export async function renderEventsSection(host: HTMLElement, clubId: string, isMember: boolean): Promise<void> {
  host.innerHTML = `<div class="ev-loading">Loading challenges…</div>`;
  const [active, past] = await Promise.all([fetchEvents(clubId, 'active'), fetchEvents(clubId, 'past')]);

  const card = (e: EventSummary, isPast: boolean) => `
    <button class="ev-card${isPast ? ' ev-card--past' : ''}" data-ev="${e.eventId}">
      <div class="ev-card__head">
        <span class="ev-card__title">${esc(e.title)}</span>
        <span class="ev-card__time">${timeLeft(e.endAt)}</span>
      </div>
      <div class="ev-card__meta">
        <span class="ev-chip">🎯 ${goalLabel(e.goalType, e.goalValue)}</span>
        ${e.sport ? `<span class="ev-chip">${esc(e.sport)}</span>` : '<span class="ev-chip">Any sport</span>'}
        <span class="ev-chip">👥 ${e.participantCount}</span>
      </div>
    </button>`;

  host.innerHTML = `
    ${isMember ? `<button class="ev-btn ev-btn--ghost ev-new" id="evNewBtn">+ New challenge</button>` : ''}
    ${active.length ? active.map(e => card(e, false)).join('') : `
      <div class="ev-empty"><span>🏁</span><p>No active challenges</p></div>`}
    ${past.length ? `<div class="ev-past-title">HISTORY</div>${past.map(e => card(e, true)).join('')}` : ''}`;

  host.querySelector('#evNewBtn')?.addEventListener('click', () => {
    openCreateEventModal(clubId, () => void renderEventsSection(host, clubId, isMember));
  });
  host.querySelectorAll<HTMLElement>('.ev-card').forEach(el => {
    el.addEventListener('click', () => openEventDetail(el.dataset.ev!, () => void renderEventsSection(host, clubId, isMember)));
  });
}

// ── Event detail + standings ─────────────────────────────────────────────────

export function openEventDetail(eventId: string, onChange?: () => void): void {
  document.getElementById('evDetailModal')?.remove();
  const m = document.createElement('div');
  m.id = 'evDetailModal';
  m.className = 'ev-modal';
  m.innerHTML = `<div class="ev-modal__card"><div class="ev-loading">Loading…</div></div>`;
  document.body.appendChild(m);
  requestAnimationFrame(() => m.classList.add('ev-modal--visible'));

  const close = () => { m.classList.remove('ev-modal--visible'); setTimeout(() => m.remove(), 220); };
  m.addEventListener('click', e => { if (e.target === m) close(); });

  const render = async () => {
    const ev = await fetchEventDetail(eventId);
    const card = m.querySelector<HTMLElement>('.ev-modal__card')!;
    if (!ev) { card.innerHTML = `<div class="ev-empty"><span>📡</span><p>Could not load</p></div>`; return; }

    const me     = getUserId();
    const joined = ev.participants.includes(me);
    const ended  = ev.endAt < Date.now();
    const mine   = ev.standings.find(s => s.userId === me);

    const row = (s: Standing, i: number) => {
      const pct = Math.min(100, (s.progress / ev.goalValue) * 100);
      return `
        <div class="ev-stand${s.userId === me ? ' ev-stand--me' : ''}">
          <span class="ev-stand__rank">${s.done ? '✓' : i + 1}</span>
          <span class="ev-stand__avatar">${s.avatarB64
            ? `<img src="${s.avatarB64}" alt=""/>` : '👤'}</span>
          <div class="ev-stand__body">
            <div class="ev-stand__top">
              <span class="ev-stand__name">${esc(s.name)}</span>
              <span class="ev-stand__val${s.done ? ' ev-stand__val--done' : ''}">
                ${progressLabel(ev.goalType, s.progress)}
              </span>
            </div>
            <div class="ev-bar"><div class="ev-bar__fill${s.done ? ' ev-bar__fill--done' : ''}" style="width:${pct}%"></div></div>
          </div>
        </div>`;
    };

    card.innerHTML = `
      <div class="ev-detail__head">
        <h2 class="ev-modal__title">${esc(ev.title)}</h2>
        <span class="ev-card__time">${timeLeft(ev.endAt)}</span>
      </div>
      ${ev.description ? `<p class="ev-detail__desc">${esc(ev.description)}</p>` : ''}
      <div class="ev-card__meta">
        <span class="ev-chip">🎯 ${goalLabel(ev.goalType, ev.goalValue)}</span>
        <span class="ev-chip">${ev.sport ? esc(ev.sport) : 'Any sport'}</span>
        <span class="ev-chip">📅 ${new Date(ev.startAt).toLocaleDateString('en-GB', { day:'numeric', month:'short' })} – ${new Date(ev.endAt).toLocaleDateString('en-GB', { day:'numeric', month:'short' })}</span>
      </div>

      ${mine ? `
        <div class="ev-mine">
          <span>Your progress</span>
          <b class="${mine.done ? 'ev-stand__val--done' : ''}">
            ${progressLabel(ev.goalType, mine.progress)} / ${goalLabel(ev.goalType, ev.goalValue)}
            ${mine.done ? ' · completed 🎉' : ''}
          </b>
        </div>` : ''}

      ${!ended ? `
        <button class="ev-btn ${joined ? 'ev-btn--ghost' : 'ev-btn--primary'}" id="evJoin">
          ${joined ? 'Leave challenge' : 'Join challenge'}
        </button>` : ''}

      <div class="ev-past-title">PARTICIPANTS (${ev.standings.length})</div>
      <div class="ev-stands">
        ${ev.standings.length ? ev.standings.map(row).join('')
          : `<div class="ev-empty"><span>👋</span><p>Nobody joined yet</p></div>`}
      </div>

      <p class="ev-note">Only Track workouts (and watch imports with a GPS route) count here.</p>
      <button class="ev-btn ev-btn--ghost" id="evClose">Close</button>`;

    card.querySelector('#evClose')?.addEventListener('click', close);
    card.querySelector('#evJoin')?.addEventListener('click', async () => {
      const b = card.querySelector<HTMLButtonElement>('#evJoin')!;
      b.disabled = true;
      if (await joinEvent(eventId, joined)) { await render(); onChange?.(); }
      else b.disabled = false;
    });
  };
  void render();
}
