// ─── FIREBASE APP CHECK — KLIENT (Faza 4 / B2) ───────────────────────────────
// src/modules/appCheck.ts
//
// Backend juz weryfikuje naglowek `X-Firebase-AppCheck` (middleware/appCheck.ts),
// na razie w trybie audytu. Ten modul dostarcza token po stronie apki.
//
// CO TO ZALATWIA
// ──────────────
// Klucz API Firebase jest publiczny — siedzi w kazdej zainstalowanej apce
// i nie da sie tego zmienic. App Check odpowiada na inne pytanie: czy zadanie
// pochodzi z PRAWDZIWEJ instalacji MapYou, czy ze skryptu, ktory ten klucz
// przepisal. Dowod wystawia system operacyjny, nie apka:
//   iOS     → App Attest    (Apple potwierdza integralnosc instalacji)
//   Android → Play Integrity (Google potwierdza, ze to apka z Play)
//
// WTYCZKA JEST OPCJONALNA
// Gdy `@capacitor-firebase/app-check` nie jest zainstalowana albo apka dziala
// w przegladarce, `getAppCheckToken()` zwraca null i naglowek po prostu nie
// leci. Backend w trybie audytu to przepusci — dlatego wdrozenie klienta
// i wlaczenie egzekwowania to DWA OSOBNE kroki, w tej kolejnosci.
//
// INSTALACJA (po stronie Leszka):
//   npm install @capacitor-firebase/app-check
//   npx cap sync
// oraz rejestracja apek w Firebase Console → App Check (App Attest / Play Integrity).
import { dlog } from '../utils/log.js';
function plugin() {
    const cap = window.Capacitor;
    return cap?.Plugins?.FirebaseAppCheck ?? null;
}
let _ready = false;
let _token = null;
let _expiresAt = 0;
let _failures = 0;
let _retryAfter = 0;
/** Uruchom App Check. Bezpieczne do wolania zawsze — bez wtyczki nic nie robi. */
export async function initAppCheck() {
    const p = plugin();
    if (!p) {
        dlog('[AppCheck] wtyczka niedostepna — pomijam');
        return;
    }
    // ── Tryb debug ────────────────────────────────────────────────────────────
    // Play Integrity (Android) i App Attest (iOS) ufaja wylacznie instalacjom
    // pochodzacym ze sklepu. APK wgrany przez `adb install` nie przejdzie
    // weryfikacji — `getToken()` rzuci bledem i token nigdy nie poleci.
    //
    // Dostawca debug omija ten problem: przy pierwszym starcie wypisuje do
    // logcata sekret, ktory rejestrujesz w Firebase Console
    // (App Check → apka → menu ⋮ → Manage debug tokens).
    //
    // WLACZA SIE TYLKO JAWNIE, osobnym kluczem — nie przez `mapyouDebug()`,
    // zeby nie dalo sie go zostawic wlaczonego przez przypadek razem z logami:
    //   localStorage.setItem('mapyou_appcheck_debug', '1')   → potem restart apki
    //
    // NIE zostawiaj tego wlaczonego w wydaniu do sklepu — token debug obchodzi
    // cala ochrone, ktora App Check ma zapewniac.
    let debug = false;
    try {
        debug = localStorage.getItem('mapyou_appcheck_debug') === '1';
    }
    catch { /* noop */ }
    try {
        await p.initialize({ debug });
        _ready = true;
        dlog(`[AppCheck] zainicjalizowany${debug ? ' (TRYB DEBUG)' : ''}`);
    }
    catch (e) {
        console.warn('[AppCheck] inicjalizacja nieudana:', e instanceof Error ? e.message : e);
    }
}
/** Token do naglowka `X-Firebase-AppCheck`, albo null gdy niedostepny.
 *
 *  Token trzymamy w pamieci do wygasniecia minus minuta zapasu. Bez tego
 *  KAZDE zadanie do backendu odpalaloby natywna weryfikacje (App Attest
 *  potrafi mielic sekundy i ma limity po stronie Apple). */
export async function getAppCheckToken() {
    if (!_ready)
        return null;
    if (_token && Date.now() < _expiresAt)
        return _token;
    // Karencja po serii niepowodzen — patrz komentarz nizej.
    if (Date.now() < _retryAfter)
        return null;
    const p = plugin();
    if (!p)
        return null;
    try {
        const res = await p.getToken();
        _token = res.token ?? null;
        _failures = 0;
        _retryAfter = 0;
        _expiresAt = res.expireTimeMillis
            ? res.expireTimeMillis - 60000
            : Date.now() + 30 * 60000; // brak daty → zachowawczo pol godziny
        return _token;
    }
    catch (e) {
        // ODCZEKAJ po niepowodzeniu — nie probuj przy kazdym zadaniu.
        //
        // Apple limituje App Attest. Kazda nieudana proba zaostrzala limit,
        // a my ponawialismy przy KAZDYM zadaniu do backendu — czyli kilkanascie
        // razy na sekunde. Efekt: „Too many attempts", a w slad za tym
        // rozsypujaca sie siec i kolejka, ktora nie moze sie oproznic.
        //
        // Przerwa rosnie wykladniczo do 30 minut. App Check jest opcjonalny —
        // jego brak nie moze psuc dzialania apki.
        _failures += 1;
        _retryAfter = Date.now() + Math.min(30 * 60000, 5000 * 2 ** Math.min(_failures, 9));
        console.warn(`[AppCheck] token niedostepny (${_failures}. raz) — kolejna proba za ` +
            `${Math.round((_retryAfter - Date.now()) / 1000)} s:`, e instanceof Error ? e.message : e);
        _token = null;
        return null;
    }
}
//# sourceMappingURL=appCheck.js.map