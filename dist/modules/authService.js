// ─── AUTH SERVICE (Faza 3) ───────────────────────────────────────────────────
// src/modules/authService.ts
//
// ARCHITEKTURA: na iOS/Androidzie źródłem prawdy jest NATYWNA wtyczka
// @capacitor-firebase/authentication — logowanie, token, stan sesji, wylogowanie.
// Webowe SDK Firebase jest używane WYŁĄCZNIE w przeglądarce (dev).
//
// Dlaczego tak, a nie „wtyczka do logowania + web SDK do tokenów":
// pod pochodzeniem `capacitor://localhost` webowe SDK Firebase Auth zachowuje
// się zawodnie — znane i udokumentowane problemy:
//   • signInWithCredential() nigdy nie rozwiązuje obietnicy (wisi bez błędu),
//   • onAuthStateChanged() nie odpala (u nas: „stan sesji ustalony (timeout)"),
//   • żądania wewnętrzne SDK wpadają na CORS.
// Wtyczka natywna nie ma tych problemów, bo działa poza WebView.
//
// Wtyczkę i Capacitora bierzemy z globala (globalThis.Capacitor) — projekt nie
// ma bundlera dla warstwy natywnej, tak samo robi nativeGeo.ts.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence, browserPopupRedirectResolver, GoogleAuthProvider, OAuthProvider, signInWithPopup, onAuthStateChanged, signOut as webSignOut, } from 'firebase/auth';
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
function plugin() {
    return cap()?.Plugins?.FirebaseAuthentication;
}
/** Czy działamy na natywnej wtyczce (iOS/Android z zainstalowanym pluginem). */
function useNative() {
    return isNativePlatform() && !!plugin();
}
// ── Webowe SDK (tylko przeglądarka) ───────────────────────────────────────────
function app() {
    return getApps().length ? getApps()[0] : initializeApp(FIREBASE_CONFIG);
}
let _auth = null;
function auth() {
    if (_auth)
        return _auth;
    try {
        _auth = initializeAuth(app(), {
            persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence],
            popupRedirectResolver: browserPopupRedirectResolver,
        });
    }
    catch {
        _auth = getAuth(app());
    }
    return _auth;
}
// ── Token dla authFetch ───────────────────────────────────────────────────────
export function initAuthTokenProvider() {
    setTokenProvider(async () => {
        if (useNative()) {
            try {
                const { token } = await plugin().getIdToken();
                return token || null;
            }
            catch {
                return null; // nikt nie jest zalogowany
            }
        }
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
// ── Stan sesji ────────────────────────────────────────────────────────────────
/** Kto jest zalogowany (null = nikt). Na natywnym pyta wtyczkę — bez czekania
 *  na obserwatora webowego SDK, który pod capacitor:// nie odpala. */
export async function getSignedInUser() {
    if (useNative()) {
        try {
            const { user } = await plugin().getCurrentUser();
            if (!user) {
                console.log('[Auth] natywnie: brak zalogowanego użytkownika');
                return null;
            }
            console.log('[Auth] natywnie: zalogowany', user.uid);
            return {
                uid: user.uid,
                email: user.email ?? null,
                displayName: user.displayName ?? null,
                photoUrl: user.photoUrl ?? null,
            };
        }
        catch (e) {
            console.warn('[Auth] getCurrentUser błąd:', e instanceof Error ? e.message : e);
            return null;
        }
    }
    // Przeglądarka: obserwator z limitem czasu (na wypadek awarii pamięci sesji)
    return new Promise(resolve => {
        let settled = false;
        const finish = (u) => { if (!settled) {
            settled = true;
            resolve(u);
        } };
        const timer = setTimeout(() => finish(null), 6000);
        try {
            const off = onAuthStateChanged(auth(), u => {
                clearTimeout(timer);
                off();
                finish(u ? { uid: u.uid, email: u.email, displayName: u.displayName, photoUrl: u.photoURL } : null);
            }, () => { clearTimeout(timer); finish(null); });
        }
        catch {
            clearTimeout(timer);
            finish(null);
        }
    });
}
// ── Logowanie ─────────────────────────────────────────────────────────────────
export async function signInWithGoogle() {
    if (useNative()) {
        // Natywne okno systemowe. NIE wstrzykujemy credentiala do webowego SDK —
        // signInWithCredential() pod capacitor:// potrafi nigdy nie zwrócić.
        const res = await plugin().signInWithGoogle();
        if (!res.user)
            throw new Error('Logowanie Google anulowane');
        return;
    }
    await signInWithPopup(auth(), new GoogleAuthProvider());
}
export async function signInWithApple() {
    if (useNative()) {
        const res = await plugin().signInWithApple();
        if (!res.user)
            throw new Error('Logowanie Apple anulowane');
        return;
    }
    await signInWithPopup(auth(), new OAuthProvider('apple.com'));
}
export async function signOutEverywhere() {
    if (useNative()) {
        try {
            await plugin().signOut();
        }
        catch { /* noop */ }
        return;
    }
    await webSignOut(auth());
}
/** Wymień token tożsamości na sesję MapYou.
 *  extraRecoveryCode — kod wpisany ręcznie (migracja starego konta). */
export async function exchangeSession(extraRecoveryCode, opts) {
    let idToken;
    if (useNative()) {
        const r = await plugin().getIdToken();
        idToken = r.token;
    }
    else {
        const u = auth().currentUser;
        if (!u)
            throw new Error('Not signed in');
        idToken = await u.getIdToken();
    }
    if (!idToken)
        throw new Error('Not signed in');
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
        body: JSON.stringify({ deviceUserId, recoveryCode, silentOnly: opts?.silentOnly === true }),
        signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    if (!res.ok || data.status !== 'ok') {
        // Zachowujemy kod błędu w treści — AccountUI rozpoznaje NEEDS_RECOVERY_CODE
        throw new Error(data.code ? `${data.code}: ${data.message ?? ''}` : (data.message ?? `Blad ${res.status}`));
    }
    localStorage.setItem(LS_USER_ID, data.userId);
    if (data.name && !localStorage.getItem('mapyou_userName')) {
        localStorage.setItem('mapyou_userName', data.name);
    }
    return { mode: data.mode, userId: data.userId, name: data.name };
}
// ── Pomocnicze ────────────────────────────────────────────────────────────────
export function getDeviceLegacyState() {
    return {
        deviceUserId: localStorage.getItem(LS_USER_ID),
        cachedCode: localStorage.getItem(LS_RECOVERY_KEY),
    };
}
//# sourceMappingURL=authService.js.map