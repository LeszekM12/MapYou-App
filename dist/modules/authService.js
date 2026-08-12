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
import { dlog } from '../utils/log.js';
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
// ─── CACHE TOKENU ────────────────────────────────────────────────────────────
//
// PROBLEM, KTORY TO ROZWIAZUJE
// Kazde zadanie do backendu wolalo `getIdToken()` OD NOWA. Na urzadzeniu
// natywnym to nie jest odczyt zmiennej, tylko PRZESKOK PRZEZ MOSTEK Capacitora
// do kodu natywnego. Mostek jest szeregowany na glownym watku, wiec kilkanascie
// takich wywolan pod rzad — a tyle wlasnie leci przy starcie apki (feed,
// profil, powiadomienia, kluby, osiagniecia, wyzwania, polubienia) — potrafi
// zablokowac interfejs na kilka sekund. Objaw: apka jest juz narysowana,
// ale przyciski nie reaguja.
//
// Token Firebase to JWT wazny GODZINE. Nie ma zadnego powodu, zeby pytac
// o niego przy kazdym zadaniu.
//
// Trzymamy go wiec w pamieci do czasu wygasniecia (minus zapas), a rownolegle
// zadania wspoldziela JEDNO zapytanie zamiast ustawiac sie w kolejce.
let _tok = null;
let _tokInflight = null;
/** Data wygasniecia z ladunku JWT. Gdy sie nie uda — zakladamy krotka waznosc,
 *  zeby w najgorszym razie odpytac czesciej, a nie uzywac martwego tokenu. */
function tokenExpiry(jwt) {
    try {
        const part = jwt.split('.')[1];
        if (!part)
            return Date.now() + 60000;
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
        const exp = JSON.parse(json).exp;
        return typeof exp === 'number' ? exp * 1000 : Date.now() + 60000;
    }
    catch {
        return Date.now() + 60000;
    }
}
/** Wyrzuc token z pamieci. Wolac przy wylogowaniu i zmianie konta —
 *  inaczej apka wysylalaby token poprzedniego uzytkownika az do wygasniecia. */
export function invalidateIdToken() {
    _tok = null;
    _tokInflight = null;
}
async function fetchIdToken() {
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
}
export function initAuthTokenProvider() {
    setTokenProvider(async () => {
        // Zapas 5 minut — zadanie wyslane tuz przed wygasnieciem ma zdazyc dojsc.
        if (_tok && _tok.expMs - Date.now() > 5 * 60000)
            return _tok.token;
        // Rownolegle zadania czekaja na TO SAMO zapytanie, zamiast wywolywac
        // kilkanascie osobnych przeskokow przez mostek.
        if (_tokInflight)
            return _tokInflight;
        _tokInflight = (async () => {
            const t = await fetchIdToken();
            _tok = t ? { token: t, expMs: tokenExpiry(t) } : null;
            return t;
        })();
        try {
            return await _tokInflight;
        }
        finally {
            _tokInflight = null;
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
                dlog('[Auth] native: no signed-in user');
                return null;
            }
            dlog('[Auth] natywnie: zalogowany', user.uid);
            return {
                uid: user.uid,
                email: user.email ?? null,
                displayName: user.displayName ?? null,
                photoUrl: user.photoUrl ?? null,
                providers: (user.providerData ?? [])
                    .map(p => p.providerId ?? '')
                    .filter(Boolean),
            };
        }
        catch (e) {
            console.warn('[Auth] getCurrentUser failed:', e instanceof Error ? e.message : e);
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
                finish(u ? {
                    uid: u.uid, email: u.email, displayName: u.displayName,
                    photoUrl: u.photoURL,
                    providers: u.providerData.map(p => p.providerId),
                } : null);
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
/** Dopnij kolejnego dostawce do JUZ zalogowanego konta.
 *
 *  Firebase zachowuje przy tym ten sam `uid`, wiec po polaczeniu logowanie
 *  Google i Apple prowadzi do tego samego konta MapYou — backend nie wymaga
 *  zadnych zmian, bo nadal widzi jeden `firebaseUid`.
 *
 *  Typowe bledy, ktore warto pokazac uzytkownikowi wprost:
 *   • credential-already-in-use — ta tozsamosc nalezy juz do INNEGO konta,
 *   • provider-already-linked   — jest juz podpieta tutaj.
 */
export async function linkProvider(provider) {
    const p = plugin();
    if (!useNative() || !p) {
        throw new Error('Laczenie kont dziala tylko w aplikacji mobilnej.');
    }
    const res = provider === 'apple'
        ? await p.linkWithApple()
        : await p.linkWithGoogle();
    if (!res.user)
        throw new Error('Laczenie anulowane.');
}
export async function signOutEverywhere() {
    // Najpierw cache — inaczej apka wysylalaby token poprzedniego uzytkownika
    // az do jego wygasniecia, nawet po wylogowaniu.
    invalidateIdToken();
    // Cache widokow tez musi zniknac. Feed, Explore i profile sa teraz trwale
    // (IndexedDB), wiec BEZ TEGO nastepny zalogowany zobaczylby tresci
    // poprzedniego — i to natychmiast, bo po to ten cache jest.
    try {
        const { wyczysc } = await import('./viewCache.js');
        await wyczysc();
    }
    catch { /* baza niedostepna — trudno */ }
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
        // Limit konfigurowalny. Przy CICHYM starcie skracamy go: aplikacja i tak
        // dziala na znanej sesji, wiec nie ma po co trzymac uzytkownika w
        // zawieszeniu, gdy maszyna Fly dopiero sie budzi. Ponowienie w tle
        // dostaje pelne 15 s.
        signal: AbortSignal.timeout(opts?.timeoutMs ?? 15000),
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