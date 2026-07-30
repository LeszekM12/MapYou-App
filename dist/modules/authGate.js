// ─── AUTH GATE (Faza 3) ──────────────────────────────────────────────────────
// src/modules/authGate.ts
//
// Jedna funkcja wołana przy starcie apki:
//  1. Podpina źródło tokenów do authFetch.
//  2. Czeka, aż Firebase odtworzy zapisaną sesję (z limitem czasu).
//  3. Sesja jest → cicha wymiana /auth/session. Sesji nie ma → ekran logowania.
//  4. Zwraca userId.
//
// Każdy krok loguje — dzięki temu log z Xcode/Android Studio pokazuje dokładnie,
// na czym start się zatrzymał. Bez tego awaria bramki była niewidoczna.
import { initAuthTokenProvider, getSignedInUser, exchangeSession } from './authService.js';
import { setOnUnauthorized } from './authFetch.js';
import { showLoginScreen } from './LoginScreen.js';
let _showingLogin = false;
export async function ensureAuthenticated() {
    console.log('[AuthGate] start');
    initAuthTokenProvider();
    setOnUnauthorized(() => {
        if (_showingLogin)
            return;
        console.warn('[AuthGate] backend odrzucil token (401) - pokazuje logowanie');
        _showingLogin = true;
        void showLoginScreen().finally(() => { _showingLogin = false; });
    });
    let user = null;
    try {
        user = await getSignedInUser();
    }
    catch (e) {
        console.warn('[AuthGate] getSignedInUser blad:', e);
    }
    if (user) {
        console.log('[AuthGate] mam sesje Firebase - wymieniam na sesje MapYou');
        try {
            const session = await exchangeSession();
            console.log(`[AuthGate] sesja OK (${session.mode}) userId=${session.userId}`);
            return session.userId;
        }
        catch (e) {
            // Sesja Firebase jest, ale wymiana padla (konto niedowiazane, brak sieci)
            // -> pelny flow logowania.
            console.warn('[AuthGate] wymiana sesji nie powiodla sie:', e instanceof Error ? e.message : e);
        }
    }
    else {
        console.log('[AuthGate] brak sesji - pokazuje ekran logowania');
    }
    _showingLogin = true;
    try {
        const userId = await showLoginScreen();
        console.log(`[AuthGate] zalogowano, userId=${userId}`);
        return userId;
    }
    finally {
        _showingLogin = false;
    }
}
//# sourceMappingURL=authGate.js.map