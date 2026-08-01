// ─── DIAGNOSTYKA (Faza 4 / A5) ───────────────────────────────────────────────
// src/utils/log.ts
//
// Logi dodane w Fazie 3 do sledzenia sesji byly bezcenne przy debugowaniu
// i bezuzyteczne dla uzytkownika. Zamiast je kasowac, chowamy je za flaga:
// domyslnie cisza, a gdy cos znowu zacznie sie dziac — wracaja BEZ przebudowy
// i wgrywania apki na nowo. To ma znaczenie przy A3 (zapis profilu) i B1,
// gdzie za waskie ograniczenie klucza API psuje logowanie, a objaw jest mylacy.
//
// Wlaczenie z konsoli (Safari Web Inspector / chrome://inspect):
//   mapyouDebug(true)     — albo: localStorage.setItem('mapyou_debug','1')
// Wylaczenie:
//   mapyouDebug(false)
//
// Ostrzezenia (console.warn) i bledy (console.error) NIE przechodza przez ten
// modul — zostaja widoczne zawsze, bo niosa informacje, ze cos poszlo nie tak.
const KEY = 'mapyou_debug';
let _on = (() => {
    try {
        return localStorage.getItem(KEY) === '1';
    }
    catch {
        return false;
    }
})();
/** Log diagnostyczny — widoczny tylko przy wlaczonej fladze. */
export function dlog(...args) {
    if (_on)
        console.log(...args);
}
/** Ostrzezenie diagnostyczne — jw.
 *  Uzywac WYLACZNIE dla szumu, ktory przy normalnej pracy apki pojawia sie
 *  zawsze (np. ruch odciety w trybie goscia). Prawdziwe ostrzezenia
 *  zostawiamy na goly console.warn. */
export function dwarn(...args) {
    if (_on)
        console.warn(...args);
}
/** Czy diagnostyka jest wlaczona. */
export function isDebug() {
    return _on;
}
/** Przelacz diagnostyke w locie (bez przebudowy apki). */
export function setDebug(on) {
    _on = on;
    try {
        if (on)
            localStorage.setItem(KEY, '1');
        else
            localStorage.removeItem(KEY);
    }
    catch { /* prywatny tryb przegladarki — flaga zyje tylko do przeladowania */ }
    console.log(`[debug] diagnostyka ${on ? 'WLACZONA' : 'wylaczona'}`);
}
// Skrot dostepny z konsoli podpietego urzadzenia.
globalThis.mapyouDebug = setDebug;
//# sourceMappingURL=log.js.map