// ─── MAGAZYN STANU SPOŁECZNEGO ───────────────────────────────────────────────
// src/modules/socialStore.ts
//
// DLACZEGO POWSTAL
// ────────────────
// Polubienia i komentarze byly rozproszone po calej apce:
//   • serwer jako jedyne zrodlo prawdy, pobierany OSOBNYM zadaniem juz po
//     narysowaniu karty — offline wracaly zera, online migotanie
//   • cztery niezalezne obslugi klikniecia (karta posta, karta aktywnosci,
//     szczegoly, reels), kazda z wlasna logika i wlasnym zapisem
//   • klucze w localStorage nadawane doraznie: `hc_likes_X`, `hc_likes_p_X`
//   • jeden wpis feedu miewa TRZY identyfikatory (`activityId`, `postId`,
//     `id`) i rozne czesci kodu uzywaly roznych — odpowiedz serwera trafiala
//     w selektor, ktorego nie ma
//
// Kazda proba naprawy jednego objawu odslaniala kolejna sciezke. Dlatego
// zamiast latac — jedno miejsce, ktore wie wszystko.
//
// JAK DZIALA
// ──────────
//   1. Stan trzymany w JEDNYM obiekcie, utrwalanym pod JEDNYM kluczem.
//   2. Identyfikatory sprowadzane do postaci kanonicznej (mapa aliasow),
//      wiec `activityId`, `postId` i `id` tego samego wpisu to jeden rekord.
//   3. `paint()` przechodzi po DOM i ustawia liczniki oraz serca. Nie wie,
//      kto narysowal karte ani ktory widok jest aktywny.
//   4. `MutationObserver` wywoluje `paint()` przy kazdej nowej karcie, wiec
//      widoki nie musza o niczym pamietac.
//
// Efekt: dodanie nowego widoku z polubieniami nie wymaga ANI JEDNEJ linii
// kodu synchronizujacego — wystarczy `data-like-count="<id>"` w znaczniku.

import { dlog } from '../utils/log.js';

const STORE_KEY = 'mapyou_social_v1';
const ALIAS_KEY = 'mapyou_social_alias_v1';

export interface SocialEntry {
  likes:    number;
  liked:    boolean;
  comments: number;
  /** Czy stan pochodzi z serwera, czy z optymistycznej zmiany offline.
   *  Dane z serwera maja pierwszenstwo przy scalaniu. */
  fromServer: boolean;
}

type Store = Record<string, SocialEntry>;
type Alias = Record<string, string>;

let store: Store = {};
let alias: Alias = {};
let loaded = false;

// ── Trwałość ─────────────────────────────────────────────────────────────────

function load(): void {
  if (loaded) return;
  loaded = true;
  try { store = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}') as Store; } catch { store = {}; }
  try { alias = JSON.parse(localStorage.getItem(ALIAS_KEY) ?? '{}') as Alias; } catch { alias = {}; }
}

let saveTimer = 0;
function save(): void {
  // Zapis zbiorczy. Pojedyncze polubienie potrafi wywolac kilka aktualizacji
  // pod rzad — nie ma powodu pisac na dysk przy kazdej.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      localStorage.setItem(ALIAS_KEY, JSON.stringify(alias));
    } catch { /* brak miejsca — stan zostaje w pamieci */ }
  }, 250);
}

// ── Identyfikatory ───────────────────────────────────────────────────────────

/** Powiaz warianty identyfikatora jednego wpisu.
 *
 *  Pierwszy z listy staje sie postacia kanoniczna. Wolane przy budowaniu
 *  feedu, gdy jeszcze wiadomo, ktore identyfikatory naleza do tego samego
 *  obiektu — pozniej ta wiedza juz nie istnieje. */
export function linkIds(ids: (string | undefined | null)[]): string {
  load();
  const clean = ids.filter(Boolean) as string[];
  if (!clean.length) return '';
  const canon = alias[clean[0]] ?? clean[0];
  for (const id of clean) alias[id] = canon;
  save();
  return canon;
}

/** Sprowadz dowolny identyfikator do postaci kanonicznej. */
export function resolve(id: string): string {
  load();
  // `p_` to prefiks uzywany w znacznikach kart postow.
  const bare = id.startsWith('p_') ? id.slice(2) : id;
  return alias[bare] ?? bare;
}

// ── Odczyt i zapis ───────────────────────────────────────────────────────────

const EMPTY: SocialEntry = { likes: 0, liked: false, comments: 0, fromServer: false };

export function get(id: string): SocialEntry {
  load();
  return store[resolve(id)] ?? EMPTY;
}

/** Zapisz stan. `fromServer` decyduje o pierwszenstwie przy scalaniu. */
export function set(id: string, patch: Partial<SocialEntry>): void {
  load();
  const key = resolve(id);
  const cur = store[key] ?? { ...EMPTY };

  // Dane z serwera nie moga nadpisac swiezszej zmiany zrobionej offline,
  // ktora czeka jeszcze w kolejce. Rozpoznajemy ja po `fromServer: false`.
  if (patch.fromServer && !cur.fromServer && cur.likes !== 0) {
    // Zachowaj lokalna decyzje o polubieniu, przyjmij liczbe z serwera
    // skorygowana o nasza nieprzeslana zmiane.
    const delta = cur.liked ? 1 : 0;
    store[key] = {
      likes:    Math.max(0, (patch.likes ?? cur.likes) + delta),
      liked:    cur.liked,
      comments: patch.comments ?? cur.comments,
      fromServer: false,
    };
  } else {
    store[key] = { ...cur, ...patch };
  }
  save();
  paint();
}

/** Przelacz polubienie lokalnie i zwroc nowy stan.
 *
 *  Uzywane, gdy zadanie idzie do kolejki offline — wtedy to MY jestesmy
 *  chwilowo zrodlem prawdy. */
export function toggleLike(id: string): { liked: boolean; count: number } {
  const cur = get(id);
  const liked = !cur.liked;
  const count = Math.max(0, cur.likes + (liked ? 1 : -1));
  set(id, { liked, likes: count, fromServer: false });
  return { liked, count };
}

// ── Malowanie ────────────────────────────────────────────────────────────────

let paintScheduled = false;

/** Ustaw liczniki i serca wszedzie, gdzie sa w DOM.
 *
 *  Nie wie, ktory widok jest aktywny ani kto narysowal karte — szuka po
 *  atrybutach. Dzieki temu nowy widok dziala bez zadnej dodatkowej logiki. */
export function paint(): void {
  if (paintScheduled) return;
  paintScheduled = true;
  requestAnimationFrame(() => {
    paintScheduled = false;
    load();
    try {
      document.querySelectorAll<HTMLElement>('[data-like-count]').forEach(el => {
        const raw = el.dataset.likeCount;
        if (!raw) return;
        const e = get(raw);
        el.textContent = String(e.likes);
        el.closest('.home-card__action')?.classList.toggle('home-card__action--liked', e.liked);
      });
      document.querySelectorAll<HTMLElement>('[data-comment-count]').forEach(el => {
        const raw = el.dataset.commentCount;
        if (!raw) return;
        const e = get(raw);
        // Zero z serwera jest prawda; zero „bo nie wiemy" nie powinno kasowac
        // wartosci, ktora juz jest na ekranie.
        if (e.comments > 0 || e.fromServer) el.textContent = String(e.comments);
      });
    } catch { /* DOM w trakcie przerysowania */ }
  });
}

// ── Uruchomienie ─────────────────────────────────────────────────────────────

let started = false;

/** Wlacz automatyczne malowanie. Wolane raz, przy starcie apki. */
export function startSocialStore(): void {
  if (started) return;
  started = true;
  load();

  // Kazda nowa karta dostaje wlasciwe liczby bez udzialu widoku, ktory ja
  // narysowal. To jest sedno tej przebudowy: widoki nie synchronizuja niczego.
  const obs = new MutationObserver(() => paint());
  obs.observe(document.body, { childList: true, subtree: true });

  paint();
  dlog(`[Social] magazyn uruchomiony (${Object.keys(store).length} wpisow)`);
}

/** Podglad z konsoli:  mapyouSocial() */
(window as unknown as Record<string, unknown>).mapyouSocial = (): unknown => {
  load();
  return { wpisy: Object.keys(store).length, aliasy: Object.keys(alias).length, store, alias };
};
