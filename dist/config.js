// ─── APP CONFIGURATION ───────────────────────────────────────────────────────
// Tokeny publiczne (pk.) — bezpieczne po stronie klienta.
// Zabezpieczenie: ogranicz token do domeny w panelu Mapbox:
// https://account.mapbox.com → Tokens → Allowed URLs → leszekm12.github.io
export const BACKEND_URL = 'https://mapty-backend.fly.dev';
// ─── PUBLICZNY ADRES APLIKACJI (Faza 4 / D1) ─────────────────────────────────
// Linki zapraszajace (znajomi, kluby, trening na zywo) oraz dokumenty prawne
// MUSZA wskazywac na adres osiagalny z zewnatrz. Wczesniej budowaly sie
// z `window.location.href`, co w natywnej apce daje pochodzenie WebView:
//   iOS     → capacitor://localhost
//   Android → https://localhost
// Takie linki sa martwe wszedzie poza telefonem nadawcy — wysylales
// zaproszenie, ktorego nikt nie mogl otworzyc.
//
// BEZ konczacego ukosnika. Miejsca uzycia dokladaja go same:
//   `${PUBLIC_BASE_URL}/#invite=KOD`   `${PUBLIC_BASE_URL}/privacy.html`
//
// Domena wlasna (D1). Ten adres jest zapisany na stale w `assetlinks.json`
// i `apple-app-site-association`, wiec jego zmiana wymaga rownoczesnej
// aktualizacji obu tych plikow ORAZ nowego wydania apki.
export const PUBLIC_BASE_URL = 'https://mapyou.leszekmikrut.com';
// ─── FIREBASE (Phase 3) ───────────────────────────────────────────────────────
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBoLI-FyqEn2dcJwMGPgGIL4m0Fu0_RNO8",
    authDomain: "mapyou-158e4.firebaseapp.com",
    projectId: "mapyou-158e4",
    storageBucket: "mapyou-158e4.firebasestorage.app",
    messagingSenderId: "27744182842",
    appId: "1:27744182842:web:d1cb5532debfcad83a4b03"
};
//# sourceMappingURL=config.js.map