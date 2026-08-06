// ─── TYPED DOM HELPERS ───────────────────────────────────────────────────────
/** querySelector that throws if element not found */
export function qs(selector, parent = document) {
    const el = parent.querySelector(selector);
    if (!el)
        throw new Error(`Element not found: "${selector}"`);
    return el;
}
/** getElementById that throws if element not found */
export function qid(id) {
    const el = document.getElementById(id);
    if (!el)
        throw new Error(`#${id} not found`);
    return el;
}
/** Safe getElementById — returns null instead of throwing */
export function qidSafe(id) {
    return document.getElementById(id);
}
/** Show/hide via .hidden class */
export function show(el) { el?.classList.remove('hidden'); }
export function hide(el) { el?.classList.add('hidden'); }
export function toggle(el, visible) {
    el?.classList.toggle('hidden', !visible);
}
// ─── ESCAPOWANIE TRESCI UZYTKOWNIKA ──────────────────────────────────────────
//
// PO CO
// ─────
// Apka sklada widoki przez `innerHTML` z szablonow tekstowych. Kazda wartosc,
// ktora pochodzi od CZLOWIEKA — nazwa profilu, tresc komentarza, opis treningu,
// nazwa klubu, pytanie w ankiecie — wstawiana wprost jest wykonywalnym kodem.
//
// To nie jest teoretyczne. Wystarczylo ustawic nazwe profilu na:
//     <img src=x onerror="...">
// zeby kod uruchomil sie u KAZDEGO, kto zobaczy ten wpis w feedzie, komentarz
// albo karte znajomego.
//
// W zwyklej stronie to bylo by zle. Tutaj jest gorzej, bo apka chodzi
// w WebView Capacitora: skrypt ma dostep do mostka natywnego (GPS, powiadomienia,
// Health), do `localStorage` z profilem i tokenem oraz do calej historii
// treningow w IndexedDB.
//
// ZASADA
// Wszystko, co pochodzi z zewnatrz (serwer, inny uzytkownik, wpis wlasny),
// przechodzi przez `esc()` zanim trafi do szablonu. Liczby i wartosci
// wyliczone przez apke — nie musza.
//
// Kolejnosc podmian ma znaczenie: `&` MUSI byc pierwsze, inaczej podmienialoby
// ampersandy we wlasnych wynikach (`&lt;` -> `&amp;lt;`).
/** Zabezpiecz tekst do wstawienia w TRESC elementu HTML. */
export function esc(v) {
    if (v === null || v === undefined)
        return '';
    return String(v)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
/** Alias o pelnej nazwie — czytelniejszy w miejscach, gdzie `esc` bylby mylacy. */
export const escapeHtml = esc;
/** Zabezpiecz adres wstawiany w `src` / `href`.
 *
 *  Samo escapowanie cudzyslowow nie wystarcza: `href="javascript:..."` nie ma
 *  w sobie zadnego znaku specjalnego, a mimo to wykonuje kod. Przepuszczamy
 *  wylacznie schematy, ktore w tej apce maja sens.
 *
 *  `mapyou-pending://` jest adresem zastepczym kolejki mediow (mediaQueue.ts) —
 *  musi przejsc, inaczej zdjecia dodane bez zasiegu przestalyby sie pokazywac. */
export function safeUrl(v) {
    const s = String(v ?? '').trim();
    if (!s)
        return '';
    if (/^(https?:|data:image\/|blob:|mapyou-pending:|\.{0,2}\/)/i.test(s))
        return esc(s);
    return '';
}
//# sourceMappingURL=dom.js.map