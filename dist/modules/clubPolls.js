// ─── CLUB POLLS — UI ─────────────────────────────────────────────────────────
// Three types, chosen because they cover what a sports club actually decides:
//   single   — pick one   ("Where do we ride on Saturday?")
//   multiple — pick many  ("Which days suit you?")
//   yesno    — one tap    ("Anyone up for a morning run?")
//
// Result visibility is decided by the SERVER (see routes/clubPolls.ts): with
// "hide results" on, counts simply aren't in the response until you vote, so
// there is nothing to peek at in devtools.
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
import { loadProfileFromLocal } from './UserProfile.js';
const esc = (s) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TYPE_META = {
    single: { icon: '⚪', label: 'Single choice', hint: 'Voters pick one option' },
    multiple: { icon: '☑️', label: 'Multiple choice', hint: 'Voters can pick several' },
    yesno: { icon: '👍', label: 'Yes / No', hint: 'One tap, two answers' },
};
// ── API ──────────────────────────────────────────────────────────────────────
export async function fetchPolls(clubId) {
    try {
        const r = await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(clubId)}/polls?userId=${encodeURIComponent(getUserId())}`, { cache: 'no-store' });
        const j = await r.json();
        return j.status === 'ok' ? j.data : [];
    }
    catch {
        return [];
    }
}
async function vote(pollId, optionIds) {
    try {
        const r = await fetch(`${BACKEND_URL}/polls/${encodeURIComponent(pollId)}/vote`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: getUserId(), optionIds }),
        });
        const j = await r.json();
        return j.status === 'ok' ? j.data : null;
    }
    catch {
        return null;
    }
}
async function deletePoll(pollId) {
    try {
        const r = await fetch(`${BACKEND_URL}/polls/${encodeURIComponent(pollId)}`, {
            method: 'DELETE', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: getUserId() }),
        });
        return r.ok;
    }
    catch {
        return false;
    }
}
// ── Poll card (feed) ─────────────────────────────────────────────────────────
function pollCardHtml(p) {
    const me = getUserId();
    const total = p.totalVotes ?? 0;
    const multi = p.type === 'multiple';
    const opt = (o) => {
        const mine = p.myVotes.includes(o.id);
        const pct = p.reveal && total > 0 ? Math.round(((o.count ?? 0) / total) * 100) : 0;
        return `
      <button class="pl-opt${mine ? ' pl-opt--mine' : ''}${p.closed ? ' pl-opt--closed' : ''}"
              data-opt="${o.id}" ${p.closed ? 'disabled' : ''}>
        <span class="pl-opt__mark">${mine ? (multi ? '☑' : '●') : (multi ? '☐' : '○')}</span>
        <span class="pl-opt__label">${esc(o.label)}</span>
        ${p.reveal ? `<span class="pl-opt__pct">${pct}%</span>` : ''}
        ${p.reveal ? `<span class="pl-opt__bar" style="width:${pct}%"></span>` : ''}
      </button>`;
    };
    const foot = p.reveal
        ? `${total} ${total === 1 ? 'vote' : 'votes'}${p.anonymous ? ' · anonymous' : ''}`
        : 'Results appear after you vote';
    return `
    <div class="pl-card" data-poll="${p.pollId}">
      <div class="pl-card__head">
        <span class="pl-card__type">${TYPE_META[p.type].icon} ${p.type === 'yesno' ? 'Poll' : TYPE_META[p.type].label}</span>
        ${p.closed ? '<span class="pl-card__closed">Closed</span>' : ''}
      </div>
      <div class="pl-card__q">${esc(p.question)}</div>
      <div class="pl-opts">${p.options.map(opt).join('')}</div>
      <div class="pl-card__foot">
        <span>${foot}</span>
        ${p.creatorId === me ? '<button class="pl-del" data-del>Delete</button>' : ''}
      </div>
    </div>`;
}
function bindPollCard(el, p, onChange) {
    el.querySelectorAll('[data-opt]').forEach(b => {
        b.addEventListener('click', async () => {
            if (p.closed)
                return;
            const id = b.dataset.opt;
            let picks;
            if (p.type === 'multiple') {
                picks = p.myVotes.includes(id) ? p.myVotes.filter(v => v !== id) : [...p.myVotes, id];
            }
            else {
                // Tapping your current answer again clears the vote — no way to unvote otherwise.
                picks = p.myVotes[0] === id ? [] : [id];
            }
            el.classList.add('pl-card--busy');
            const fresh = await vote(p.pollId, picks);
            el.classList.remove('pl-card--busy');
            if (fresh) {
                el.outerHTML = pollCardHtml(fresh);
                onChange();
            }
        });
    });
    el.querySelector('[data-del]')?.addEventListener('click', async () => {
        if (!confirm('Delete this poll?\n\nVotes will be lost.'))
            return;
        if (await deletePoll(p.pollId))
            onChange();
    });
}
/** Render polls into a host element. Re-binds after every vote. */
export async function renderPolls(host, clubId) {
    const polls = await fetchPolls(clubId);
    if (!polls.length) {
        host.innerHTML = '';
        return;
    }
    const paint = () => {
        host.innerHTML = polls.map(pollCardHtml).join('');
        host.querySelectorAll('.pl-card').forEach(el => {
            const p = polls.find(x => x.pollId === el.dataset.poll);
            if (p)
                bindPollCard(el, p, () => void renderPolls(host, clubId));
        });
    };
    paint();
}
// ── Create poll modal ────────────────────────────────────────────────────────
export function openCreatePollModal(clubId, onCreated) {
    document.getElementById('plCreateModal')?.remove();
    const m = document.createElement('div');
    m.id = 'plCreateModal';
    m.className = 'ev-modal';
    let type = 'single';
    m.innerHTML = `
    <div class="ev-modal__card">
      <h2 class="ev-modal__title">New poll</h2>

      <div class="pl-types" id="plTypes">
        ${Object.keys(TYPE_META).map(t => `
          <button class="pl-type${t === 'single' ? ' pl-type--on' : ''}" data-type="${t}">
            <span class="pl-type__ico">${TYPE_META[t].icon}</span>
            <span class="pl-type__lbl">${TYPE_META[t].label}</span>
            <span class="pl-type__hint">${TYPE_META[t].hint}</span>
          </button>`).join('')}
      </div>

      <label class="ev-field">
        <span>Question</span>
        <input id="plQ" type="text" maxlength="200" placeholder="e.g. Where do we ride on Saturday?"/>
      </label>

      <div id="plOptsWrap">
        <span class="pl-opts-title">Options</span>
        <div id="plOpts">
          <input class="pl-opt-in" type="text" maxlength="60" placeholder="Option A"/>
          <input class="pl-opt-in" type="text" maxlength="60" placeholder="Option B"/>
        </div>
        <button class="pl-add-opt" id="plAddOpt">+ Add option</button>
      </div>

      <label class="ev-field">
        <span>Closes (optional)</span>
        <input id="plEnd" type="datetime-local"/>
      </label>

      <label class="pl-check"><input type="checkbox" id="plHide"/>
        <span>Hide results until someone votes<em>Stops early votes from steering the rest</em></span></label>
      <label class="pl-check"><input type="checkbox" id="plAnon"/>
        <span>Anonymous<em>Names of voters are never sent to anyone</em></span></label>

      <div id="plErr" class="ev-err"></div>
      <button class="ev-btn ev-btn--primary" id="plCreate">Create poll</button>
      <button class="ev-btn ev-btn--ghost" id="plCancel">Cancel</button>
    </div>`;
    document.body.appendChild(m);
    requestAnimationFrame(() => m.classList.add('ev-modal--visible'));
    const close = () => { m.classList.remove('ev-modal--visible'); setTimeout(() => m.remove(), 220); };
    m.querySelector('#plCancel')?.addEventListener('click', close);
    m.addEventListener('click', e => { if (e.target === m)
        close(); });
    const optsWrap = m.querySelector('#plOptsWrap');
    const optsBox = m.querySelector('#plOpts');
    m.querySelectorAll('[data-type]').forEach(b => {
        b.addEventListener('click', () => {
            type = b.dataset.type;
            m.querySelectorAll('.pl-type').forEach(x => x.classList.remove('pl-type--on'));
            b.classList.add('pl-type--on');
            // Yes/No writes its own options — hide the editor rather than pretend.
            optsWrap.style.display = type === 'yesno' ? 'none' : '';
        });
    });
    m.querySelector('#plAddOpt')?.addEventListener('click', () => {
        if (optsBox.children.length >= 6)
            return; // 6 = server-side cap
        const i = optsBox.children.length;
        const inp = document.createElement('input');
        inp.className = 'pl-opt-in';
        inp.type = 'text';
        inp.maxLength = 60;
        inp.placeholder = `Option ${String.fromCharCode(65 + i)}`;
        optsBox.appendChild(inp);
    });
    m.querySelector('#plCreate')?.addEventListener('click', async () => {
        const err = m.querySelector('#plErr');
        const question = m.querySelector('#plQ').value.trim();
        if (!question) {
            err.textContent = 'Write the question first.';
            return;
        }
        const options = type === 'yesno' ? [] :
            [...optsBox.querySelectorAll('.pl-opt-in')].map(i => i.value.trim()).filter(Boolean);
        if (type !== 'yesno' && options.length < 2) {
            err.textContent = 'Give at least 2 options.';
            return;
        }
        const endStr = m.querySelector('#plEnd').value;
        const btn = m.querySelector('#plCreate');
        btn.disabled = true;
        btn.textContent = 'Creating…';
        try {
            const r = await fetch(`${BACKEND_URL}/clubs/${encodeURIComponent(clubId)}/polls`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    creatorId: getUserId(),
                    creatorName: loadProfileFromLocal()?.name ?? 'Someone',
                    question, type, options,
                    anonymous: m.querySelector('#plAnon').checked,
                    hideResults: m.querySelector('#plHide').checked,
                    endAt: endStr ? new Date(endStr).getTime() : null,
                }),
            });
            if (!r.ok)
                throw new Error();
            close();
            onCreated();
        }
        catch {
            err.textContent = 'Could not create the poll. Check your connection.';
            btn.disabled = false;
            btn.textContent = 'Create poll';
        }
    });
}
//# sourceMappingURL=clubPolls.js.map