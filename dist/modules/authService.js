// ─── AUTH SERVICE (Faza 3) ───────────────────────────────────────────────────
// src/modules/authService.ts
//
// Tożsamość MapYou oparta o Firebase Authentication.
//
//  - Na iOS/Android logowanie idzie przez NATYWNY plugin
//    @capacitor-firebase/authentication (systemowe okno Google/Apple),
//    a uzyskany credential jest wstrzykiwany do webowego SDK Firebase,
//    żeby JS miał dostęp do getIdToken() dla authFetch.
//  - Na webie (dev) — signInWithPopup.
//
// Po zalogowaniu wołamy POST /auth/session (wymiana tokena na sesję MapYou):
//  - konto dowiązane → mode 'login'  → dostajemy nasze userId
//  - stare konto + kod recovery → mode 'linked' → dopięcie i to samo userId
//  - świeży użytkownik → mode 'created' → nowe userId z serwera
//
// userId ląduje w localStorage pod TYM SAMYM kluczem co dotychczas
// ('mapyou_userId_profile'), więc reszta apki działa bez zmian.
// UWAGA: ten projekt nie ma bundlera (build = czysty `tsc`), więc NIE wolno
// tu importować pakietów npm po nazwie — WebView by ich nie rozwiązał.
// Capacitor i jego pluginy bierzemy z globala (tak jak nativeGeo.ts),
// a Firebase SDK z CDN przez <script type="importmap"> w index.html.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, browserPopupRedirectResolver, GoogleAuthProvider, OAuthProvider, signInWithCredential, signInWithPopup, onAuthStateChanged, signOut as webSignOut, } from 'firebase/auth';
import { BACKEND_URL, FIREBASE_CONFIG } from '../config.js';
import { setTokenProvider } from './authFetch.js';
const LS_USER_ID = 'mapyou_userId_profile';
const LS_RECOVERY_KEY = 'mapyou_recovery_code';
function cap() {
    return globalThis.Capacitor;
}
export function isNativePlatform() {
    return cap()?.isNativePlatform?.() === true;
}
export function getPlatform() {
    return cap()?.getPlatform?.() ?? 'web';
}
function nativeAuthPlugin() {
    return cap()?.Plugins?.FirebaseAuthentication;
}
// ── Init ──────────────────────────────────────────────────────────────────────
function app() {
    return getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
}
let _auth = null;
/** Auth z JAWNIE ustawioną pamięcią sesji.
 *
 *  Dlaczego nie samo getAuth(): w WKWebView pod pochodzeniem
 *  `capacitor://localhost` domyślna pamięć Firebase potrafi się nie
 *  zainicjalizować — wtedy onAuthStateChanged NIGDY nie odpala, a bramka
 *  logowania wisi bez błędu (ekran się nie pokazuje). Lista kolejnych
 *  wariantów: IndexedDB → localStorage → pamięć ulotna. Ostatni zawsze
 *  działa, choć sesja nie przetrwa restartu apki. */
function auth() {
    if (_auth)
        return _auth;
    try {
        _auth = initializeAuth(app(), {
            persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
            popupRedirectResolver: browserPopupRedirectResolver,
        });
        console.log('[Auth] initializeAuth OK');
    }
    catch (e) {
        // Już zainicjalizowane (np. drugie wywołanie) — pobierz istniejącą instancję.
        console.warn('[Auth] initializeAuth fallback -> getAuth:', e instanceof Error ? e.message : e);
        _auth = getAuth(app());
    }
    return _auth;
}
/** Poczekaj, aż Firebase odtworzy zapisaną sesję.
 *  Z twardym limitem czasu — bez niego awaria pamięci sesji zawiesza
 *  cały start apki i nic się nie wyświetla. */
function waitForAuthReady(timeoutMs = 6000) {
    return new Promise(resolve => {
        let settled = false;
        const finish = (u, why) => {
            if (settled)
                return;
            settled = true;
            console.log(`[Auth] stan sesji ustalony (${why}):`, u ? u.uid : 'brak użytkownika');
            resolve(u);
        };
        const timer = setTimeout(() => finish(null, 'timeout'), timeoutMs);
        try {
            const off = onAuthStateChanged(auth(), user => { clearTimeout(timer); off(); finish(user, 'onAuthStateChanged'); }, err => {
                clearTimeout(timer);
                console.warn('[Auth] onAuthStateChanged błąd:', err);
                finish(null, 'błąd obserwatora');
            });
        }
        catch (e) {
            clearTimeout(timer);
            console.warn('[Auth] onAuthStateChanged rzucił wyjątek:', e);
            finish(null, 'wyjątek');
        }
    });
}
/** Podłącz źródło tokenów do authFetch. Wywołaj raz, jak najwcześniej. */
export function initAuthTokenProvider() {
    setTokenProvider(async () => {
        const u = auth().currentUser;
        if (!u)
            return null;
        try {
            return await u.getIdToken();
        }
        catch {
            return null;
        }
    });
}
// ── Providers ─────────────────────────────────────────────────────────────────
export async function signInWithGoogle() {
    const plugin = nativeAuthPlugin();
    if (isNativePlatform() && plugin) {
        const result = await plugin.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken)
            throw new Error('Brak credential z natywnego logowania Google');
        await signInWithCredential(auth(), GoogleAuthProvider.credential(idToken));
    }
    else {
        await signInWithPopup(auth(), new GoogleAuthProvider());
    }
}
export async function signInWithApple() {
    const plugin = nativeAuthPlugin();
    if (isNativePlatform() && plugin) {
        const result = await plugin.signInWithApple({ skipNativeAuth: false });
        const idToken = result.credential?.idToken;
        const rawNonce = result.credential?.nonce;
        if (!idToken)
            throw new Error('Brak credential z natywnego logowania Apple');
        const provider = new OAuthProvider('apple.com');
        await signInWithCredential(auth(), provider.credential({ idToken, rawNonce }));
    }
    else {
        await signInWithPopup(auth(), new OAuthProvider('apple.com'));
    }
}
export async function signOutEverywhere() {
    try {
        await nativeAuthPlugin()?.signOut();
    }
    catch { /* ignore */ }
    await webSignOut(auth());
}
/** Wymień Firebase ID token na sesję MapYou.
 *  extraRecoveryCode — kod wpisany ręcznie (świeży telefon / brak cache). */
export async function exchangeSession(extraRecoveryCode) {
    const user = auth().currentUser;
    if (!user)
        throw new Error('Not signed in');
    const idToken = await user.getIdToken();
    const deviceUserId = localStorage.getItem(LS_USER_ID) ?? undefined;
    const recoveryCode = extraRecoveryCode
        ?? localStorage.getItem(LS_RECOVERY_KEY)
        ?? undefined;
    const res = await fetch(`${BACKEND_URL}/auth/session`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({ deviceUserId, recoveryCode }),
        signal: AbortSignal.timeout(10000),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') {
        throw new Error(data.message ?? `Session exchange failed (${res.status})`);
    }
    // Zapisz tożsamość pod dotychczasowym kluczem — reszta apki bez zmian
    localStorage.setItem(LS_USER_ID, data.userId);
    if (data.name && !localStorage.getItem('mapyou_userName')) {
        localStorage.setItem('mapyou_userName', data.name);
    }
    return { mode: data.mode, userId: data.userId, name: data.name };
}
// ── Stan sesji ────────────────────────────────────────────────────────────────
/** Czy urządzenie ma zalogowaną sesję Firebase (po restore z persist). */
export async function getSignedInUser() {
    return waitForAuthReady();
}
/** Czy to urządzenie ma „stare" konto sprzed migracji (userId bez pewności,
 *  że jest dowiązane) — używane przez LoginScreen do pomostu migracyjnego. */
export function getDeviceLegacyState() {
    return {
        deviceUserId: localStorage.getItem(LS_USER_ID),
        cachedCode: localStorage.getItem(LS_RECOVERY_KEY),
    };
}
//# sourceMappingURL=authService.js.map