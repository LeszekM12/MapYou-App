// ─── CLUB MEMBERS — leaderboard ──────────────────────────────────────────────
// Stats come from GET /clubs/:id/members, aggregated server-side over each
// member's WHOLE account (not just activities shared to this club).
//
// Deliberately NOT gated by the anti-cheat rule: this is a member card ("how
// much have they done, ever"), not a contest — a Strava archive or a watch
// import is real history and belongs here. The gate applies where something is
// WON: challenges, weekly goals, trophies.

import { BACKEND_URL } from '../config.js';
import { getUserId }   from './UserProfile.js';
import { openPublicProfile } from './PublicProfile.js';

interface MemberRow {
  userId: string; name: string; avatarB64: string | null;
  km: number; count: number; sec: number;
}

const esc = (s: string): string =>
  s.replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));

const hours = (sec: number): string =>
  sec >= 3600 ? `${Math.floor(sec / 3600)}h` : `${Math.round(sec / 60)}m`;

export async function renderMembersSection(host: HTMLElement, clubId: string): Promise<void> {
  host.innerHTML = `<div class="ev-loading">Loading members…</div>`;
  let rows: MemberRow[] = [];
  let ownerId = '';
  try {
    const r = await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(clubId)}/members`, { cache: 'no-store' });
    const j = await r.json() as { status: string; ownerId: string; data: MemberRow[] };
    if (j.status !== 'ok') throw new Error();
    rows = j.data; ownerId = j.ownerId;
  } catch {
    host.innerHTML = `<div class="ev-empty"><span>📡</span><p>Could not load members</p></div>`;
    return;
  }

  const me   = getUserId();
  const top  = rows[0]?.km ?? 0;
  const medal = (i: number): string => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1));

  host.innerHTML = rows.map((m, i) => {
    const pct = top > 0 ? Math.min(100, (m.km / top) * 100) : 0;
    return `
      <div class="cm-row${m.userId === me ? ' cm-row--me' : ''}">
        <span class="cm-row__rank">${medal(i)}</span>
        <button class="cm-row__avatar" data-uid="${m.userId}" aria-label="Open profile">
          ${m.avatarB64 ? `<img src="${esc(m.avatarB64)}" alt=""/>` : '👤'}
        </button>
        <div class="cm-row__body">
          <div class="cm-row__top">
            <button class="cm-row__name" data-uid="${m.userId}">
              ${esc(m.name)}${m.userId === ownerId ? ' <span class="cm-owner">owner</span>' : ''}
            </button>
            <span class="cm-row__km">${m.km.toFixed(1)} km</span>
          </div>
          <div class="cm-bar"><div class="cm-bar__fill" style="width:${pct}%"></div></div>
          <div class="cm-row__sub">${m.count} ${m.count === 1 ? 'activity' : 'activities'} · ${hours(m.sec)}</div>
        </div>
      </div>`;
  }).join('') || `<div class="ev-empty"><span>👥</span><p>No members yet</p></div>`;

  // Awatar i nazwa otwierają profil publiczny.
  host.querySelectorAll<HTMLElement>('[data-uid]').forEach(el => {
    el.addEventListener('click', e => {
      e.stopPropagation();
      openPublicProfile(el.dataset.uid!);
    });
  });

  const note = document.createElement('p');
  note.className = 'ev-note';
  note.style.padding = '0 4px';
  note.textContent = 'Lifetime totals across all workouts — tracked, imported and manual.';
  host.appendChild(note);
}
