// ─── MODERACJA PO STRONIE KLIENTA ────────────────────────────────────────────
// src/modules/moderation.ts
//
// Zglaszanie tresci i blokowanie uzytkownikow.
//
// DLACZEGO TO MUSI BYC
// Wytyczne App Store, punkt 1.2: aplikacja z trescia tworzona przez
// uzytkownikow musi udostepniac sposob zglaszania tresci obrazliwych oraz
// mozliwosc zablokowania natretnej osoby. Google Play wymaga tego samego.
//
// Bez tych dwoch funkcji MapYou nie przejdzie recenzji — niezaleznie od tego,
// jak dobrze dziala reszta.
//
// ALE NIE CHODZI TYLKO O RECENZJE
// Masz feed, komentarze, zdjecia i zakladke Explore pokazujaca obcych ludzi.
// Pierwsza nieprzyjemna sytuacja miedzy uzytkownikami wydarzy sie wczesniej,
// niz sie spodziewasz. Wtedy to musi juz dzialac, a nie dopiero powstawac.
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
import { esc } from '../utils/dom.js';
const POWODY = [
    ['spam', 'Spam or commercial content'],
    ['harassment', 'Harassment or abusive behaviour'],
    ['inappropriate', 'Inappropriate content'],
    ['violence', 'Violence or threats'],
    ['impersonation', 'Impersonation'],
    ['other', 'Something else'],
];
const STYLE_ID = 'mapyouModStyle';
function zapewnijStyl() {
    if (document.getElementById(STYLE_ID))
        return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.mapyou-mod__tlo {
  position: fixed; inset: 0; z-index: 100000;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: flex-end; justify-content: center;
}
.mapyou-mod__panel {
  width: 100%; max-width: 520px;
  background: var(--app-surface-1, #1c1f24);
  border-radius: 18px 18px 0 0;
  padding: 8px 0 calc(env(safe-area-inset-bottom, 0px) + 12px);
  animation: mapyouModIn .22s ease both;
}
@keyframes mapyouModIn { from { transform: translateY(100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { .mapyou-mod__panel { animation: none; } }
.mapyou-mod__uchwyt {
  width: 38px; height: 4px; border-radius: 2px; margin: 6px auto 10px;
  background: rgba(128,128,128,0.4);
}
.mapyou-mod__tytul {
  padding: 4px 20px 12px; font-size: 1.5rem; font-weight: 700;
  color: var(--app-text, #fff);
}
.mapyou-mod__poz {
  display: block; width: 100%; text-align: left;
  padding: 15px 20px; border: none; background: none;
  font-size: 1.35rem; font-family: inherit; cursor: pointer;
  color: var(--app-text, #fff);
}
.mapyou-mod__poz:active { background: rgba(128,128,128,0.14); }
.mapyou-mod__poz--gr { color: #ef4444; }
.mapyou-mod__anuluj {
  margin-top: 6px; border-top: 1px solid rgba(128,128,128,0.18);
  color: var(--app-text-secondary, #9aa0a6);
}`;
    document.head.appendChild(st);
}
/** Arkusz z listą opcji. Zwraca wybraną wartość albo `null` przy anulowaniu. */
function arkusz(tytul, opcje) {
    zapewnijStyl();
    return new Promise(resolve => {
        const tlo = document.createElement('div');
        tlo.className = 'mapyou-mod__tlo';
        tlo.setAttribute('role', 'dialog');
        tlo.setAttribute('aria-modal', 'true');
        tlo.innerHTML = `
      <div class="mapyou-mod__panel">
        <div class="mapyou-mod__uchwyt"></div>
        <div class="mapyou-mod__tytul">${esc(tytul)}</div>
        ${opcje.map(([v, t, gr]) => `
          <button class="mapyou-mod__poz${gr ? ' mapyou-mod__poz--gr' : ''}" data-v="${esc(v)}">${esc(t)}</button>`).join('')}
        <button class="mapyou-mod__poz mapyou-mod__anuluj" data-v="">Cancel</button>
      </div>`;
        const zamknij = (v) => { tlo.remove(); resolve(v); };
        tlo.addEventListener('click', e => {
            const btn = e.target.closest('[data-v]');
            if (btn) {
                zamknij(btn.dataset.v || null);
                return;
            }
            // Stukniecie w tlo poza panelem = anulowanie.
            if (e.target === tlo)
                zamknij(null);
        });
        document.body.appendChild(tlo);
    });
}
/** Krótki komunikat na dole ekranu. */
function komunikat(tekst) {
    const t = document.createElement('div');
    t.setAttribute('role', 'status');
    t.style.cssText = 'position:fixed;left:50%;bottom:96px;transform:translateX(-50%);'
        + 'z-index:100001;background:rgba(0,0,0,0.86);color:#fff;padding:11px 18px;'
        + 'border-radius:999px;font-size:1.25rem;max-width:86%;text-align:center';
    t.textContent = tekst;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
}
// ─── ZGLASZANIE ──────────────────────────────────────────────────────────────
/** Pokaz wybor powodu i wyslij zgloszenie.
 *
 *  Zgloszenie idzie przez `authFetch`, wiec bez zasiegu trafi do kolejki
 *  i wyjdzie automatycznie po powrocie sieci. Uzytkownik dostaje potwierdzenie
 *  od razu — czekanie na serwer przy zglaszaniu czegos przykrego byloby
 *  najgorszym momentem na kręcące się kółko. */
export async function zglosTresc(rodzaj, targetId, targetOwner) {
    const powod = await arkusz('Report content', POWODY.map(([v, t]) => [v, t]));
    if (!powod)
        return;
    komunikat('Thanks. Your report has been received.');
    try {
        await fetch(`${BACKEND_URL}/moderation/report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: getUserId(), targetKind: rodzaj, targetId,
                targetOwner: targetOwner ?? null, reason: powod,
            }),
        });
    }
    catch { /* kolejka wysle pozniej */ }
}
// ─── BLOKOWANIE ──────────────────────────────────────────────────────────────
/** Zablokuj uzytkownika po potwierdzeniu.
 *
 *  Zwraca `true`, gdy blokada zostala nalozona — wolajacy moze wtedy zamknac
 *  profil albo odswiezyc feed. */
export async function zablokujUzytkownika(targetUserId, nazwa) {
    const kto = nazwa ? `“${nazwa}”` : 'this person';
    const wybor = await arkusz(`Block ${kto}?`, [
        ['ok', 'Block — you won’t see each other', true],
    ]);
    if (wybor !== 'ok')
        return false;
    try {
        const r = await fetch(`${BACKEND_URL}/moderation/block`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: getUserId(), targetUserId }),
        });
        if (!r.ok) {
            komunikat('Could not block. Please try again.');
            return false;
        }
        komunikat('Blocked. You can undo this in Settings.');
        return true;
    }
    catch {
        komunikat('No connection. Please try again later.');
        return false;
    }
}
/** Menu przy cudzej tresci.
 *
 *  Uklad wzorowany na X, gdzie kolejnosc jest przemyslana: najlagodniejsza
 *  reakcja na gorze, najostrzejsza na dole. Uzytkownik, ktory chce tylko
 *  „mniej takich rzeczy", nie musi przechodzic obok przycisku blokady.
 *
 *    Nie interesuje mnie   → sygnal, bez konsekwencji dla nikogo
 *    Zgłoś treść           → trafia do moderacji
 *    Zablokuj autora       → zrywa widocznosc w obie strony
 *
 *  „Nie interesuje mnie" jest na razie tylko lokalne — ukrywa kartę do konca
 *  sesji. Zeby dzialalo trwale, silnik Explore musialby uwzgledniac
 *  preferencje, a to osobny temat. Ale sam przycisk ma sens juz teraz:
 *  daje ujscie bez eskalacji. */
export async function menuCudzejTresci(rodzaj, targetId, autorId, autorNazwa) {
    const opcje = [
        ['hide', 'Not interested in this'],
        ['report', 'Report content'],
    ];
    if (autorId && autorId !== getUserId()) {
        opcje.push(['block', `Block ${autorNazwa ? `“${autorNazwa}”` : 'author'}`, true]);
    }
    const wybor = await arkusz('Options', opcje);
    if (wybor === 'hide') {
        ukryteLokalnie.add(targetId);
        komunikat('Hidden. We’ll show less content like this.');
        return 'ukryto';
    }
    if (wybor === 'report') {
        await zglosTresc(rodzaj, targetId, autorId);
        return 'zgloszono';
    }
    if (wybor === 'block' && autorId) {
        return (await zablokujUzytkownika(autorId, autorNazwa)) ? 'zablokowano' : null;
    }
    return null;
}
/** Tresci ukryte przez „nie interesuje mnie" — na czas tej sesji. */
export const ukryteLokalnie = new Set();
// ─── LISTA ZABLOKOWANYCH ─────────────────────────────────────────────────────
/** Ekran zablokowanych osob z mozliwoscia odblokowania.
 *
 *  Apple sprawdza, czy blokade DA SIE COFNAC — lista bez tej mozliwosci jest
 *  tak samo zla jak jej brak. */
export async function pokazZablokowanych() {
    zapewnijStyl();
    const tlo = document.createElement('div');
    tlo.className = 'mapyou-mod__tlo';
    tlo.innerHTML = `
    <div class="mapyou-mod__panel">
      <div class="mapyou-mod__uchwyt"></div>
      <div class="mapyou-mod__tytul">Blocked people</div>
      <div id="modBlockedList" style="max-height:52vh;overflow-y:auto">
        <div style="padding:20px;text-align:center;color:var(--app-text-secondary)">Loading…</div>
      </div>
      <button class="mapyou-mod__poz mapyou-mod__anuluj" data-zamknij="1">Close</button>
    </div>`;
    tlo.addEventListener('click', e => {
        if (e.target === tlo || e.target.dataset.zamknij)
            tlo.remove();
    });
    document.body.appendChild(tlo);
    const lista = tlo.querySelector('#modBlockedList');
    try {
        const r = await fetch(`${BACKEND_URL}/moderation/blocked?userId=${encodeURIComponent(getUserId())}`);
        const d = await r.json();
        const osoby = d.data ?? [];
        if (!osoby.length) {
            lista.innerHTML = '<div style="padding:26px 20px;text-align:center;'
                + 'color:var(--app-text-secondary)">You haven’t blocked anyone.</div>';
            return;
        }
        lista.innerHTML = osoby.map(o => `
      <div style="display:flex;align-items:center;gap:12px;padding:11px 20px">
        <div style="width:38px;height:38px;border-radius:50%;background:rgba(128,128,128,0.2);
             overflow:hidden;flex-shrink:0"></div>
        <span style="flex:1;color:var(--app-text)">${esc(o.name || 'User')}</span>
        <button data-odblokuj="${esc(o.userId)}"
          style="background:rgba(0,196,106,0.14);color:#00c46a;border:none;border-radius:999px;
                 padding:7px 15px;font-size:1.2rem;font-family:inherit">Unblock</button>
      </div>`).join('');
        lista.querySelectorAll('[data-odblokuj]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.dataset.odblokuj;
                btn.textContent = '…';
                try {
                    await fetch(`${BACKEND_URL}/moderation/block/${encodeURIComponent(id)}`
                        + `?userId=${encodeURIComponent(getUserId())}`, { method: 'DELETE' });
                    btn.closest('div')?.remove();
                    if (!lista.querySelector('[data-odblokuj]')) {
                        lista.innerHTML = '<div style="padding:26px 20px;text-align:center;'
                            + 'color:var(--app-text-secondary)">You haven’t blocked anyone.</div>';
                    }
                }
                catch {
                    btn.textContent = 'Unblock';
                }
            });
        });
    }
    catch {
        lista.innerHTML = '<div style="padding:26px 20px;text-align:center;'
            + 'color:var(--app-text-secondary)">No connection.</div>';
    }
}
//# sourceMappingURL=moderation.js.map