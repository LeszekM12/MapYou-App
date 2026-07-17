// ─── CLUB MEMBERS — leaderboard ──────────────────────────────────────────────
// Stats come from GET /clubs/:id/members, aggregated server-side over each
// member's WHOLE account (not just activities shared to this club) and gated
// exactly like challenges: Track workouts always count, watch/Health imports
// only with a GPS route, manual entries and archive imports never. A club
// leaderboard is a competition, so it has to obey the same rules — otherwise
// the top spot is a text field.
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
import { openPublicProfile } from './PublicProfile.js';
const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hours = (sec) => sec >= 3600 ? `${Math.floor(sec / 3600)}h` : `${Math.round(sec / 60)}m`;
export async function renderMembersSection(host, clubId) {
    host.innerHTML = `<div class="ev-loading">Loading members…</div>`;
    let rows = [];
    let ownerId = '';
    try {
        const r = await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(clubId)}/members`, { cache: 'no-store' });
        const j = await r.json();
        if (j.status !== 'ok')
            throw new Error();
        rows = j.data;
        ownerId = j.ownerId;
    }
    catch {
        host.innerHTML = `<div class="ev-empty"><span>📡</span><p>Could not load members</p></div>`;
        return;
    }
    const me = getUserId();
    const top = rows[0]?.km ?? 0;
    const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1));
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
    host.querySelectorAll('[data-uid]').forEach(el => {
        el.addEventListener('click', e => {
            e.stopPropagation();
            openPublicProfile(el.dataset.uid);
        });
    });
    const note = document.createElement('p');
    note.className = 'ev-note';
    note.style.padding = '0 4px';
    note.textContent = 'Totals count Track workouts and watch imports with a GPS route.';
    host.appendChild(note);
}
//# sourceMappingURL=clubMembers.js.map