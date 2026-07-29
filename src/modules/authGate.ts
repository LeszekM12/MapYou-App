// ─── AUTH GATE (Faza 3) ──────────────────────────────────────────────────────
// src/modules/authGate.ts
//
// Jedna funkcja wołana przy starcie apki:
//  1. Podpina źródło tokenów do authFetch.
//  2. Czeka, aż Firebase odtworzy zapisaną sesję.
//  3. Sesja jest → cicha wymiana /auth/session (odświeża userId, dopina
//     stare konto jeśli trzeba). Sesji nie ma → blokujący ekran logowania.
//  4. Zwraca userId — apka rusza dalej dopiero po tym.
//
// Dodatkowo: gdy w trakcie działania token przestanie być honorowany (401),
// pokazujemy login ponownie.

import { initAuthTokenProvider, getSignedInUser, exchangeSession } from './authService.js';
import { setOnUnauthorized } from './authFetch.js';
import { showLoginScreen } from './LoginScreen.js';

let _showingLogin = false;

export async function ensureAuthenticated(): Promise<string> {
  initAuthTokenProvider();

  setOnUnauthorized(() => {
    if (_showingLogin) return;
    _showingLogin = true;
    void showLoginScreen().finally(() => { _showingLogin = false; });
  });

  const user = await getSignedInUser();

  if (user) {
    try {
      const session = await exchangeSession();
      return session.userId;
    } catch {
      // Sesja Firebase jest, ale wymiana padła (np. konto niedowiązane,
      // brak sieci przy pierwszym dopięciu) → pełny flow logowania.
    }
  }

  _showingLogin = true;
  try {
    return await showLoginScreen();
  } finally {
    _showingLogin = false;
  }
}
