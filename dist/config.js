// ─── APP CONFIGURATION ───────────────────────────────────────────────────────
// Tokeny publiczne (pk.) — bezpieczne po stronie klienta.
// Zabezpieczenie: ogranicz token do domeny w panelu Mapbox:
// https://account.mapbox.com → Tokens → Allowed URLs → leszekm12.github.io
export const BACKEND_URL = 'https://mapty-backend.fly.dev';
// ─── FIREBASE (Faza 3) ───────────────────────────────────────────────────────
// Konfiguracja KLIENCKA — to NIE są sekrety (są publiczne w każdej apce
// Firebase; bezpieczeństwo daje weryfikacja tokenów na backendzie).
// Wartości: Firebase Console → ⚙ Project settings → Your apps → Web app
// (jeśli nie masz jeszcze appki Web w projekcie — dodaj: </> Add app → Web).
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBoLI-FyqEn2dcJwMGPgGIL4m0Fu0_RNO8",
    authDomain: "mapyou-158e4.firebaseapp.com",
    projectId: "mapyou-158e4",
    storageBucket: "mapyou-158e4.firebasestorage.app",
    messagingSenderId: "27744182842",
    appId: "1:27744182842:web:d1cb5532debfcad83a4b03"
};
//# sourceMappingURL=config.js.map