// ─── PROSBY O OBSERWOWANIE ───────────────────────────────────────────────────
// src/modules/followRequests.ts
//
// PROBLEM, KTORY TO ROZWIAZUJE
// ────────────────────────────
// Prosba o obserwowanie zyla WYLACZNIE w powiadomieniu. Skasowanie
// powiadomienia („Clear all") odcinalo jedyna droge do akceptacji — mimo ze
// sama prosba nadal lezala na serwerze w `pendingFollowers`.
//
// Profile prywatne byly przez to praktycznie bezuzyteczne: ktos prosil,
// Ty czyscilas powiadomienia, i nikt juz nie mogl tego domknac.
//
// SEDNO BLEDU
// Powiadomienie to SYGNAL O ZDARZENIU — ulotny z natury, znika po przeczytaniu.
// Prosba o obserwowanie to TRWALY STAN, ktory czeka na decyzje.
// Zbudowanie interfejsu na sygnale zamiast na stanie musialo sie zle skonczyc.
//
// Teraz ekran czyta stan z serwera (`GET /users/:id/follow-requests`),
// a powiadomienie jest tylko skrotem do niego.
//
// UKLAD — wzorowany na Instagramie i X
// W panelu powiadomien pojawia sie JEDEN WIERSZ z licznikiem, a pelna lista
// otwiera sie w osobnym arkuszu. Trzy powody, dla ktorych nie rozwijamy listy
// wprost w panelu:
//   • przy dziesieciu prosbach lista zepchnelaby powiadomienia poza ekran,
//   • powiadomienia i prosby maja INNA NATURE („co sie stalo" kontra „co czeka
//     na decyzje") i warto to pokazac wizualnie,
//   • osobny ekran ma miejsce na kontekst, ktorego w wierszu nie ma.
import { BACKEND_URL } from '../config.js';
import { getUserId } from './UserProfile.js';
import { esc, safeUrl } from '../utils/dom.js';
import { odczytaj as cacheOdczytaj, zapisz as cacheZapisz } from './viewCache.js';
const STYLE_ID = 'mapyouFrStyle';
function zapewnijStyl() {
    if (document.getElementById(STYLE_ID))
        return;
    const st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent = `
.mapyou-fr__wiersz {
  display: flex; align-items: center; gap: 12px;
  width: 100%; padding: 13px 16px; border: none; background: none;
  font-family: inherit; text-align: left; cursor: pointer;
  border-bottom: 1px solid rgba(128,128,128,0.12);
}
.mapyou-fr__wiersz:active { background: rgba(128,128,128,0.10); }
.mapyou-fr__stos { display: flex; flex-shrink: 0; }
.mapyou-fr__stos > * {
  width: 34px; height: 34px; border-radius: 50%;
  border: 2px solid var(--app-surface-1, #1c1f24);
  background: rgba(128,128,128,0.22); object-fit: cover;
}
.mapyou-fr__stos > *:not(:first-child) { margin-left: -12px; }
.mapyou-fr__tytul {
  flex: 1; font-size: 1.35rem; font-weight: 600;
  color: var(--app-text, #fff);
}
.mapyou-fr__licznik {
  min-width: 22px; height: 22px; padding: 0 7px; border-radius: 11px;
  background: #00c46a; color: #fff;
  font-size: 1.1rem; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.mapyou-fr__tlo {
  position: fixed; inset: 0; z-index: 100000;
  background: rgba(0,0,0,0.55);
  display: flex; align-items: flex-end; justify-content: center;
}
.mapyou-fr__panel {
  width: 100%; max-width: 520px;
  background: var(--app-surface-1, #1c1f24);
  border-radius: 18px 18px 0 0;
  padding: 8px 0 calc(env(safe-area-inset-bottom, 0px) + 12px);
  animation: mapyouFrIn .22s ease both;
}
@keyframes mapyouFrIn { from { transform: translateY(100%); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { .mapyou-fr__panel { animation: none; } }
.mapyou-fr__uchwyt {
  width: 38px; height: 4px; border-radius: 2px; margin: 6px auto 12px;
  background: rgba(128,128,128,0.4);
}
.mapyou-fr__naglowek {
  padding: 2px 20px 12px; font-size: 1.5rem; font-weight: 700;
  color: var(--app-text, #fff);
}
.mapyou-fr__osoba {
  display: flex; align-items: center; gap: 12px; padding: 11px 20px;
}
.mapyou-fr__avatar {
  width: 44px; height: 44px; border-radius: 50%; flex-shrink: 0;
  background: rgba(128,128,128,0.2); object-fit: cover;
}
.mapyou-fr__info { flex: 1; min-width: 0; }
.mapyou-fr__imie {
  font-size: 1.35rem; font-weight: 600; color: var(--app-text, #fff);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mapyou-fr__bio {
  font-size: 1.15rem; color: var(--app-text-secondary, #9aa0a6);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mapyou-fr__btn {
  border: none; border-radius: 999px; padding: 8px 16px;
  font-size: 1.2rem; font-weight: 600; font-family: inherit; cursor: pointer;
  flex-shrink: 0;
}
.mapyou-fr__btn--ok  { background: #00c46a; color: #fff; }
.mapyou-fr__btn--nie {
  background: rgba(128,128,128,0.16); color: var(--app-text-secondary, #9aa0a6);
  margin-left: 6px;
}
.mapyou-fr__pusto {
  padding: 30px 20px; text-align: center;
  color: var(--app-text-secondary, #9aa0a6); font-size: 1.25rem;
}
.mapyou-fr__zamknij {
  width: 100%; padding: 14px; margin-top: 6px; border: none; background: none;
  border-top: 1px solid rgba(128,128,128,0.14);
  color: var(--app-text-secondary, #9aa0a6);
  font-size: 1.25rem; font-family: inherit; cursor: pointer;
}`;
    document.head.appendChild(st);
}
// ─── POBIERANIE ──────────────────────────────────────────────────────────────
const KLUCZ = (uid) => `followreq:${uid}`;
/** Pobierz prosby. Przy braku sieci oddaje ostatnia znana liste z cache,
 *  zeby wiersz nie znikal z panelu tylko dlatego, ze akurat nie ma zasiegu. */
export async function pobierzProsby() {
    const uid = getUserId();
    if (!uid)
        return [];
    try {
        const r = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(uid)}/follow-requests`);
        if (!r.ok)
            throw new Error(String(r.status));
        const d = await r.json();
        const lista = d.data ?? [];
        void cacheZapisz(KLUCZ(uid), lista);
        return lista;
    }
    catch {
        const z = await cacheOdczytaj(KLUCZ(uid));
        return z?.value ?? [];
    }
}
/** Usun jedna pozycje z cache po podjeciu decyzji — inaczej po powrocie
 *  na ekran bez sieci osoba pojawilaby sie ponownie. */
async function usunZCache(userId) {
    const uid = getUserId();
    if (!uid)
        return;
    const z = await cacheOdczytaj(KLUCZ(uid));
    if (!z)
        return;
    void cacheZapisz(KLUCZ(uid), z.value.filter(p => p.userId !== userId));
}
async function decyzja(requesterId, akceptuj) {
    const uid = getUserId();
    if (!uid)
        return false;
    const akcja = akceptuj ? 'follow-approve' : 'follow-reject';
    try {
        const r = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(uid)}/${akcja}/${encodeURIComponent(requesterId)}`, { method: 'POST' });
        if (!r.ok)
            return false;
        await usunZCache(requesterId);
        return true;
    }
    catch {
        return false;
    }
}
// ─── WIERSZ W PANELU POWIADOMIEN ─────────────────────────────────────────────
/** Wstaw wiersz „Prośby o obserwowanie" na gorze kontenera.
 *
 *  Wiersz pojawia sie TYLKO gdy sa prosby — pusty naglowek bylby szumem.
 *  Dotkniecie otwiera pelny arkusz. */
export async function wstawWierszProsb(kontener) {
    if (!kontener)
        return;
    kontener.querySelector('#mapyouFrRow')?.remove();
    const prosby = await pobierzProsby();
    if (!prosby.length)
        return;
    zapewnijStyl();
    // Nalozone awatary — do trzech, jak w Instagramie.
    const stos = prosby.slice(0, 3).map(p => p.avatarB64
        ? `<img src="${safeUrl(p.avatarB64)}" alt=""/>`
        : '<div></div>').join('');
    const wiersz = document.createElement('button');
    wiersz.type = 'button';
    wiersz.id = 'mapyouFrRow';
    wiersz.className = 'mapyou-fr__wiersz';
    wiersz.innerHTML = `
    <span class="mapyou-fr__stos">${stos}</span>
    <span class="mapyou-fr__tytul">Follow requests</span>
    <span class="mapyou-fr__licznik">${prosby.length}</span>
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" style="color:var(--app-text-secondary);flex-shrink:0">
      <path d="M9 18l6-6-6-6"/></svg>`;
    wiersz.addEventListener('click', () => void pokazProsby(kontener));
    kontener.insertBefore(wiersz, kontener.firstChild);
}
// ─── PELNY ARKUSZ ────────────────────────────────────────────────────────────
/** Otworz liste prosb z przyciskami decyzji.
 *
 *  `odswiezPo` — kontener panelu powiadomien, w ktorym po zamknieciu trzeba
 *  przerysowac wiersz (moze zniknac, gdy obsluzysz wszystkie prosby). */
export async function pokazProsby(odswiezPo) {
    zapewnijStyl();
    const tlo = document.createElement('div');
    tlo.className = 'mapyou-fr__tlo';
    tlo.setAttribute('role', 'dialog');
    tlo.setAttribute('aria-modal', 'true');
    tlo.innerHTML = `
    <div class="mapyou-fr__panel">
      <div class="mapyou-fr__uchwyt"></div>
      <div class="mapyou-fr__naglowek">Follow requests</div>
      <div id="mapyouFrList" style="max-height:56vh;overflow-y:auto">
        <div class="mapyou-fr__pusto">Loading…</div>
      </div>
      <button class="mapyou-fr__zamknij" data-zamknij="1">Close</button>
    </div>`;
    const zamknij = () => {
        tlo.remove();
        // Wiersz w panelu moze byc juz nieaktualny — przerysowujemy.
        if (odswiezPo)
            void wstawWierszProsb(odswiezPo);
    };
    tlo.addEventListener('click', e => {
        if (e.target === tlo || e.target.dataset.zamknij)
            zamknij();
    });
    document.body.appendChild(tlo);
    const lista = tlo.querySelector('#mapyouFrList');
    const prosby = await pobierzProsby();
    const pusto = () => {
        lista.innerHTML = '<div class="mapyou-fr__pusto">No pending requests.</div>';
    };
    if (!prosby.length) {
        pusto();
        return;
    }
    lista.innerHTML = prosby.map(p => `
    <div class="mapyou-fr__osoba" data-wiersz="${esc(p.userId)}">
      ${p.avatarB64
        ? `<img class="mapyou-fr__avatar" src="${safeUrl(p.avatarB64)}" alt=""/>`
        : '<div class="mapyou-fr__avatar"></div>'}
      <div class="mapyou-fr__info">
        <div class="mapyou-fr__imie">${esc(p.name || 'User')}</div>
        ${p.bio ? `<div class="mapyou-fr__bio">${esc(p.bio)}</div>` : ''}
      </div>
      <button class="mapyou-fr__btn mapyou-fr__btn--ok"  data-ok="${esc(p.userId)}">Confirm</button>
      <button class="mapyou-fr__btn mapyou-fr__btn--nie" data-nie="${esc(p.userId)}">Delete</button>
    </div>`).join('');
    lista.querySelectorAll('[data-ok],[data-nie]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const id = btn.dataset.ok ?? btn.dataset.nie;
            const akceptuj = !!btn.dataset.ok;
            const wiersz = lista.querySelector(`[data-wiersz="${id}"]`);
            // Blokujemy oba przyciski, zeby podwojne stukniecie nie wyslalo
            // sprzecznych decyzji.
            wiersz?.querySelectorAll('button').forEach(b => { b.disabled = true; });
            btn.textContent = '…';
            if (await decyzja(id, akceptuj)) {
                wiersz?.remove();
                if (!lista.querySelector('[data-wiersz]'))
                    pusto();
            }
            else {
                // Nie udalo sie — przywracamy przyciski, zeby dalo sie sprobowac.
                wiersz?.querySelectorAll('button').forEach(b => { b.disabled = false; });
                btn.textContent = akceptuj ? 'Confirm' : 'Delete';
            }
        });
    });
}
/** Ile prosb czeka — do licznika na dzwonku. Bezpieczne przy braku sieci. */
export async function liczbaProsb() {
    return (await pobierzProsby()).length;
}
//# sourceMappingURL=followRequests.js.map