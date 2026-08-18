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

export interface Prosba {
  userId:    string;
  name:      string;
  avatarB64: string | null;
  bio?:      string;
}

const STYLE_ID = 'mapyouFrStyle';

function zapewnijStyl(): void {
  if (document.getElementById(STYLE_ID)) return;
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
  /* Panel powiadomien NIE uzywa zmiennych motywu — ma zakodowane kolory
     i nadpisania przez body.light-mode. Zmienna --app-text w jasnym motywie
     spadala na biel, czyli bialy tekst na bialym tle. Stad wiersz wygladal
     na pusty: widac bylo awatary, licznik i strzalke, ale napisu nie.
     Trzymamy sie wiec tej samej konwencji co reszta panelu.
     (BEZ BACKTICKOW — caly arkusz jest literalem szablonowym.) */
  color: #fff;
}
body.light-mode .mapyou-fr__tytul { color: #1a1a1a; }
body.light-mode .mapyou-fr__wiersz { border-bottom-color: rgba(0,0,0,0.07); }
body.light-mode .mapyou-fr__panel { background: #fff; }
body.light-mode .mapyou-fr__naglowek,
body.light-mode .mapyou-fr__imie { color: #1a1a1a; }
body.light-mode .mapyou-fr__stos > * { border-color: #fff; }
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

const KLUCZ = (uid: string): string => `followreq:${uid}`;

/** Pobierz prosby. Przy braku sieci oddaje ostatnia znana liste z cache,
 *  zeby wiersz nie znikal z panelu tylko dlatego, ze akurat nie ma zasiegu. */
export async function pobierzProsby(): Promise<Prosba[]> {
  const uid = getUserId();
  if (!uid) return [];
  try {
    const r = await fetch(`${BACKEND_URL}/users/${encodeURIComponent(uid)}/follow-requests`);
    if (!r.ok) throw new Error(String(r.status));
    const d = await r.json() as { data?: Prosba[] };
    const lista = d.data ?? [];
    void cacheZapisz(KLUCZ(uid), lista);
    return lista;
  } catch {
    const z = await cacheOdczytaj<Prosba[]>(KLUCZ(uid));
    return z?.value ?? [];
  }
}

/** Usun jedna pozycje z cache po podjeciu decyzji — inaczej po powrocie
 *  na ekran bez sieci osoba pojawilaby sie ponownie. */
async function usunZCache(userId: string): Promise<void> {
  const uid = getUserId();
  if (!uid) return;
  const z = await cacheOdczytaj<Prosba[]>(KLUCZ(uid));
  if (!z) return;
  void cacheZapisz(KLUCZ(uid), z.value.filter(p => p.userId !== userId));
}

/** Zaakceptuj albo odrzuc prosbe. Eksportowane, bo decyzje da sie podjac
 *  w dwoch miejscach: z listy prosb i wprost z profilu proszacego. */
export async function decyzjaProsby(requesterId: string, akceptuj: boolean): Promise<boolean> {
  const uid = getUserId();
  if (!uid) return false;
  const akcja = akceptuj ? 'follow-approve' : 'follow-reject';
  try {
    const r = await fetch(
      `${BACKEND_URL}/users/${encodeURIComponent(uid)}/${akcja}/${encodeURIComponent(requesterId)}`,
      { method: 'POST' });
    if (!r.ok) return false;
    await usunZCache(requesterId);
    return true;
  } catch { return false; }
}

// ─── WIERSZ W PANELU POWIADOMIEN ─────────────────────────────────────────────

/** Wstaw wiersz „Prośby o obserwowanie" na gorze kontenera.
 *
 *  Wiersz pojawia sie TYLKO gdy sa prosby — pusty naglowek bylby szumem.
 *  Dotkniecie otwiera pelny arkusz. */
export async function wstawWierszProsb(kontener: HTMLElement | null): Promise<void> {
  if (!kontener) return;

  const prosby = await pobierzProsby();

  // ── USUWAMY PO CZEKANIU, NIE PRZED ──────────────────────────────────────
  //
  // Wczesniej usuniecie bylo PRZED `await`. Panel wola te funkcje dwa razy:
  // raz od razu po otwarciu, drugi raz po synchronizacji z backendem. Obie
  // sprawdzaly „czy jest wiersz" ZANIM ktorakolwiek zdazyla go wstawic,
  // wiec obie widzialy pustke i obie dokladaly swoj — stad DWA wiersze.
  //
  // Po przesunieciu usuwania za `await` ta, ktora konczy pozniej, zdejmuje
  // wiersz poprzedniczki. Zostaje dokladnie jeden.
  kontener.querySelector('#mapyouFrRow')?.remove();

  if (!prosby.length) return;

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
export async function pokazProsby(odswiezPo?: HTMLElement | null): Promise<void> {
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

  const zamknij = (): void => {
    tlo.remove();
    // Wiersz w panelu moze byc juz nieaktualny — przerysowujemy.
    if (odswiezPo) void wstawWierszProsb(odswiezPo);
  };
  tlo.addEventListener('click', e => {
    if (e.target === tlo || (e.target as HTMLElement).dataset.zamknij) zamknij();
  });
  document.body.appendChild(tlo);

  const lista = tlo.querySelector<HTMLElement>('#mapyouFrList')!;
  const prosby = await pobierzProsby();

  const pusto = (): void => {
    lista.innerHTML = '<div class="mapyou-fr__pusto">No pending requests.</div>';
  };

  if (!prosby.length) { pusto(); return; }

  lista.innerHTML = prosby.map(p => `
    <div class="mapyou-fr__osoba" data-wiersz="${esc(p.userId)}">
      ${p.avatarB64
        ? `<img class="mapyou-fr__avatar" src="${safeUrl(p.avatarB64)}" alt=""/>`
        : '<div class="mapyou-fr__avatar"></div>'}
      <div class="mapyou-fr__info" data-profil="${esc(p.userId)}" style="cursor:pointer">
        <div class="mapyou-fr__imie">${esc(p.name || 'User')}</div>
        ${p.bio ? `<div class="mapyou-fr__bio">${esc(p.bio)}</div>` : ''}
      </div>
      <button class="mapyou-fr__btn mapyou-fr__btn--ok"  data-ok="${esc(p.userId)}">Confirm</button>
      <button class="mapyou-fr__btn mapyou-fr__btn--nie" data-nie="${esc(p.userId)}">Delete</button>
    </div>`).join('');

  // Dotkniecie imienia otwiera profil. Bez tego nie dalo sie sprawdzic,
  // KOGO sie wpuszcza — a to najwazniejsza informacja przy tej decyzji.
  lista.querySelectorAll<HTMLElement>('[data-profil]').forEach(el => {
    el.addEventListener('click', async () => {
      const id = el.dataset.profil!;
      zamknij();
      const { openPublicProfile } = await import('./PublicProfile.js');
      void openPublicProfile(id);
    });
  });

  lista.querySelectorAll<HTMLElement>('[data-ok],[data-nie]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.ok ?? btn.dataset.nie!;
      const akceptuj = !!btn.dataset.ok;
      const wiersz = lista.querySelector<HTMLElement>(`[data-wiersz="${id}"]`);
      // Blokujemy oba przyciski, zeby podwojne stukniecie nie wyslalo
      // sprzecznych decyzji.
      wiersz?.querySelectorAll('button').forEach(b => { (b as HTMLButtonElement).disabled = true; });
      btn.textContent = '…';

      if (await decyzjaProsby(id, akceptuj)) {
        wiersz?.remove();
        if (!lista.querySelector('[data-wiersz]')) pusto();
      } else {
        // Nie udalo sie — przywracamy przyciski, zeby dalo sie sprobowac.
        wiersz?.querySelectorAll('button').forEach(b => { (b as HTMLButtonElement).disabled = false; });
        btn.textContent = akceptuj ? 'Confirm' : 'Delete';
      }
    });
  });
}

/** Ile prosb czeka — do licznika na dzwonku. Bezpieczne przy braku sieci. */
export async function liczbaProsb(): Promise<number> {
  return (await pobierzProsby()).length;
}
