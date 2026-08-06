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
let store = {};
let alias = {};
let loaded = false;
// ── Trwałość ─────────────────────────────────────────────────────────────────
function load() {
    if (loaded)
        return;
    loaded = true;
    try {
        store = JSON.parse(localStorage.getItem(STORE_KEY) ?? '{}');
    }
    catch {
        store = {};
    }
    try {
        alias = JSON.parse(localStorage.getItem(ALIAS_KEY) ?? '{}');
    }
    catch {
        alias = {};
    }
}
let saveTimer = 0;
function save() {
    // Zapis zbiorczy. Pojedyncze polubienie potrafi wywolac kilka aktualizacji
    // pod rzad — nie ma powodu pisac na dysk przy kazdej.
    if (saveTimer)
        clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(store));
            localStorage.setItem(ALIAS_KEY, JSON.stringify(alias));
        }
        catch { /* brak miejsca — stan zostaje w pamieci */ }
    }, 250);
}
// ── Identyfikatory ───────────────────────────────────────────────────────────
/** Powiaz warianty identyfikatora jednego wpisu.
 *
 *  Pierwszy z listy staje sie postacia kanoniczna. Wolane przy budowaniu
 *  feedu, gdy jeszcze wiadomo, ktore identyfikatory naleza do tego samego
 *  obiektu — pozniej ta wiedza juz nie istnieje. */
export function linkIds(ids) {
    load();
    const clean = ids.filter(Boolean);
    if (!clean.length)
        return '';
    const canon = alias[clean[0]] ?? clean[0];
    for (const id of clean)
        alias[id] = canon;
    save();
    return canon;
}
/** Sprowadz dowolny identyfikator do postaci kanonicznej. */
export function resolve(id) {
    load();
    // `p_` to prefiks uzywany w znacznikach kart postow.
    const bare = id.startsWith('p_') ? id.slice(2) : id;
    return alias[bare] ?? bare;
}
// ── Odczyt i zapis ───────────────────────────────────────────────────────────
const EMPTY = { likes: 0, liked: false, comments: 0, fromServer: false };
export function get(id) {
    load();
    return store[resolve(id)] ?? EMPTY;
}
/** Zapisz stan. `fromServer` decyduje o pierwszenstwie przy scalaniu. */
export function set(id, patch) {
    load();
    const key = resolve(id);
    const cur = store[key] ?? { ...EMPTY };
    // Scalanie jest CELOWO proste: patch wygrywa.
    //
    // Pierwsza wersja probowala byc madrzejsza — przy danych z serwera
    // doliczala „nieprzeslana zmiane lokalna" (`+delta`) i zachowywala stare
    // `liked`. Skutek byl taki, ze KAZDE klikniecie offline dodawalo lajka
    // dwa razy (raz `toggleLike`, raz doliczony delta), licznik rosl bez konca,
    // a serce nigdy nie gaslo, bo `liked` przepisywalo sie ze starego stanu.
    //
    // Ochrone przed nadpisaniem niewyslanej zmiany realizuje teraz `pending`
    // sprawdzane w `mergeFromServer` — i tylko tam, gdzie ma sens: przy
    // odswiezeniu ZBIORCZYM, ktore o naszej zmianie nie wie.
    store[key] = { ...cur, ...patch };
    save();
    paint();
}
/** Przelacz polubienie lokalnie i zwroc nowy stan.
 *
 *  Uzywane, gdy zadanie idzie do kolejki offline — wtedy to MY jestesmy
 *  chwilowo zrodlem prawdy. */
export function toggleLike(id) {
    const cur = get(id);
    const liked = !cur.liked;
    const count = Math.max(0, cur.likes + (liked ? 1 : -1));
    set(id, { liked, likes: count, fromServer: false, pending: true });
    return { liked, count };
}
/** Przyjmij stan z odswiezenia ZBIORCZEGO.
 *
 *  Rozni sie od `set` jednym: nie nadpisuje wpisu, ktory czeka jeszcze
 *  w kolejce offline. Zbiorcze zapytanie zwraca stan sprzed naszej zmiany,
 *  wiec przyjecie go cofneloby polubienie na oczach uzytkownika. */
export function mergeFromServer(id, likes, liked) {
    const cur = get(id);
    // Wpis czeka jeszcze w kolejce offline.
    //
    // Odswiezenie zbiorcze zwraca stan SPRZED naszej zmiany, wiec przyjecie go
    // cofneloby polubienie. Ale nie mozemy tez trzymac `pending` w nieskonczonosc,
    // bo wtedy prawdziwe zmiany z serwera nigdy by nie doszly.
    //
    // Rozstrzygamy tak: gdy serwer POTWIERDZA nasz stan, uznajemy zmiane za
    // dostarczona i zdejmujemy flage. Gdy sie nie zgadza — zostawiamy nasza
    // wersje i flage, bo znaczy to, ze zapis wciaz jest w drodze.
    if (cur.pending) {
        if (liked === cur.liked)
            set(id, { likes, liked, fromServer: true, pending: false });
        return;
    }
    set(id, { likes, liked, fromServer: true, pending: false });
}
/** Serwer potwierdzil nasza zmiane — wpis nie jest juz „w drodze". */
export function confirmFromServer(id, likes, liked) {
    set(id, { likes, liked, fromServer: true, pending: false });
}
// ── Malowanie ────────────────────────────────────────────────────────────────
let paintScheduled = false;
/** Ustaw liczniki i serca wszedzie, gdzie sa w DOM.
 *
 *  Nie wie, ktory widok jest aktywny ani kto narysowal karte — szuka po
 *  atrybutach. Dzieki temu nowy widok dziala bez zadnej dodatkowej logiki. */
export function paint() {
    if (paintScheduled)
        return;
    paintScheduled = true;
    requestAnimationFrame(() => {
        paintScheduled = false;
        load();
        try {
            document.querySelectorAll('[data-like-count]').forEach(el => {
                const raw = el.dataset.likeCount;
                if (!raw)
                    return;
                const e = get(raw);
                // ── PISZ TYLKO WTEDY, GDY COS SIE ZMIENILO ──────────────────────────
                //
                // To nie jest mikrooptymalizacja, tylko warunek zatrzymania petli.
                //
                // `startSocialStore()` obserwuje `document.body` z `childList: true`.
                // Przypisanie do `textContent` ZAWSZE podmienia wezel tekstowy — nawet
                // gdy nowa wartosc jest identyczna ze stara. To generuje wpis mutacji,
                // obserwator wola `paint()`, `paint()` znowu pisze do DOM... i tak
                // w kolko, klatka po klatce, przez caly czas dzialania apki.
                //
                // Efekt byl niewidoczny na ekranie, ale realny: stale ~60 przebiegow
                // na sekunde po wszystkich kartach feedu. Podczas treningu ta petla
                // konkurowala o procesor z GPS-em i zjadala baterie.
                const next = String(e.likes);
                if (el.textContent !== next)
                    el.textContent = next;
                el.closest('.home-card__action')?.classList.toggle('home-card__action--liked', e.liked);
            });
            document.querySelectorAll('[data-comment-count]').forEach(el => {
                const raw = el.dataset.commentCount;
                if (!raw)
                    return;
                const e = get(raw);
                // Zero z serwera jest prawda; zero „bo nie wiemy" nie powinno kasowac
                // wartosci, ktora juz jest na ekranie.
                if (e.comments > 0 || e.fromServer) {
                    const next = String(e.comments);
                    if (el.textContent !== next)
                        el.textContent = next;
                }
            });
        }
        catch { /* DOM w trakcie przerysowania */ }
    });
}
// ── Uruchomienie ─────────────────────────────────────────────────────────────
let started = false;
/** Wlacz automatyczne malowanie. Wolane raz, przy starcie apki. */
export function startSocialStore() {
    if (started)
        return;
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
window.mapyouSocial = () => {
    load();
    return { wpisy: Object.keys(store).length, aliasy: Object.keys(alias).length, store, alias };
};
//# sourceMappingURL=socialStore.js.map