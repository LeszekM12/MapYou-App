// ─── ACCOUNT UI (Faza 3) ─────────────────────────────────────────────────────
// src/modules/AccountUI.ts
//
// Cała warstwa wizualna konta w jednym miejscu:
//   renderAccountCard()  → HTML karty konta (wstawiana do Profilu)
//   bindAccountCard()    → podpięcie klikow po wstawieniu HTML
//   showAuthModal()      → NIEBLOKUJĄCY modal logowania/rejestracji
//   signInPromptHtml()   → karta „Zaloguj się, aby..." dla Friends/Klubów
//   isSignedIn()         → czy jest zalogowana sesja
//
// Zmiana wobec pierwotnej Fazy 3: logowanie NIE blokuje startu apki.
// Gość korzysta normalnie (treningi lokalnie), a rejestruje się z Profilu,
// kiedy zechce — wtedy jego lokalne dane zostają przypisane do konta
// (backend: tryb 'claimed' w POST /auth/session).
import { signInWithGoogle, signInWithApple, signOutEverywhere, exchangeSession, getSignedInUser, getPlatform, getDeviceLegacyState, initAuthTokenProvider, linkProvider, } from './authService.js';
import { setSessionReady } from './authFetch.js';
import { BACKEND_URL } from '../config.js';
import { dlog } from '../utils/log.js';
// ── Stan ──────────────────────────────────────────────────────────────────────
let _signedIn = false;
let _email = null;
let _providers = [];
/** Czy ustalono juz stan konta. Do czasu zakonczenia initAccountSilent()
 *  NIE wiemy, czy uzytkownik jest zalogowany — i nie wolno zakladac, ze nie,
 *  bo karta mignie przyciskiem „Zaloguj" komus, kto jest zalogowany. */
let _resolved = false;
const _listeners = new Set();
export function isSignedIn() { return _signedIn; }
export function accountEmail() { return _email; }
/** Powiadom UI o zmianie stanu konta (Profil, Friends, Kluby się odświeżą). */
export function onAccountChange(fn) {
    _listeners.add(fn);
    return () => _listeners.delete(fn);
}
function emitChange() { _listeners.forEach(fn => { try {
    fn();
}
catch { /* noop */ } }); }
/** Ustal stan konta bez pokazywania czegokolwiek. Wołane raz przy starcie. */
export async function initAccountSilent() {
    // KRYTYCZNE i pierwsze: bez tego authFetch nie ma skad wziac tokena
    // i odcina KAZDE zadanie jako „gosc", mimo poprawnie zalogowanego konta.
    // (Wywolanie zylo wczesniej w authGate.ts, usunietym przy przebudowie
    //  na tryb goscia — i nie zostalo tu przeniesione.)
    initAuthTokenProvider();
    try {
        const user = await getSignedInUser();
        if (!user) {
            _signedIn = false;
            _email = null;
            setSessionReady(false);
            _resolved = true;
            emitChange();
            return;
        }
        _email = user.email ?? null;
        _providers = user.providers ?? [];
        // Sesja Firebase jest — wymień na sesję MapYou (ustawia userId lokalnie)
        // TRYB CICHY: przy starcie tylko PRZYWRACAMY istniejace powiazanie.
        // Nigdy nie zakladamy ani nie przejmujemy konta w tle — to decyzja
        // uzytkownika podejmowana swiadomie w oknie logowania.
        const session = await exchangeSession(undefined, { silentOnly: true });
        _signedIn = true;
        setSessionReady(true); // dopiero teraz wolno dokladac token do zadan
        dlog(`[Account] przywrócono sesję (${session.mode}) userId=${session.userId}`);
        // ZAWSZE synchronizuj po ustaleniu sesji — takze przy zwyklym 'login'.
        // Przy starcie apki hydratacja odpala sie ZANIM sesja jest gotowa, wiec
        // leci w trybie goscia i wraca pusta. To jest ten drugi, poprawny przebieg.
        void syncAfterSignIn(session.mode).then(() => fillProfileFromProvider(user));
    }
    catch (e) {
        _signedIn = false;
        setSessionReady(false);
        console.warn('[Account] brak sesji:', e instanceof Error ? e.message : e);
    }
    _resolved = true;
    emitChange();
}
// ── Karta konta w Profilu ─────────────────────────────────────────────────────
export function renderAccountCard() {
    if (!_resolved) {
        // Stan przejsciowy — bez przyciskow, zeby nie zachecac do logowania kogos,
        // kto juz jest zalogowany. Karta odswiezy sie sama (onAccountChange).
        return `
      <div id="accCard" style="padding:14px 0;border-bottom:1px solid rgba(128,128,128,0.18)">
        <div style="font-weight:600;color:var(--f-text,#fff);font-size:1.4rem">Konto</div>
        <div style="color:var(--f-muted,rgba(128,128,128,0.9));font-size:1.2rem;margin-top:2px">
          Sprawdzanie…
        </div>
      </div>`;
    }
    if (_signedIn) {
        return `
      <div id="accCard" style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
          <div style="min-width:0">
            <div style="font-weight:600;color:var(--f-text,#fff);font-size:1.4rem">Konto połączone</div>
            <div style="color:var(--f-muted,rgba(128,128,128,0.9));font-size:1.2rem;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
              ${_email ? escapeHtml(_email) : 'Zalogowano'}
            </div>
          </div>
          <button id="accSignOut" style="flex-shrink:0;padding:8px 14px;border-radius:10px;border:1px solid rgba(128,128,128,0.45);background:none;color:var(--f-text,#fff);font-size:1.2rem;font-weight:600;font-family:inherit;cursor:pointer">
            Wyloguj
          </button>
        </div>
        ${renderProviderRow()}
        <button id="accDelete"
          style="margin-top:16px;width:100%;padding:10px;border-radius:10px;
                 border:1px solid rgba(239,68,68,0.45);background:none;
                 color:#ef4444;font-size:1.15rem;font-weight:600;
                 font-family:inherit;cursor:pointer">
          Usuń konto
        </button>
      </div>`;
    }
    return `
    <div id="accCard" style="padding:14px 0;border-bottom:1px solid rgba(255,255,255,0.06)">
      <div style="font-weight:600;color:var(--f-text,#fff);font-size:1.4rem">Nie masz jeszcze konta</div>
      <div style="color:var(--f-muted,rgba(128,128,128,0.9));font-size:1.2rem;margin-top:2px;line-height:1.45">
        Twoje treningi są zapisane tylko na tym telefonie. Zarejestruj się, aby
        mieć je w chmurze, na każdym urządzeniu, razem ze znajomymi i klubami.
      </div>
      <button id="accSignIn" style="margin-top:12px;width:100%;padding:13px;border:none;border-radius:12px;background:#00c46a;color:#fff;font-size:1.35rem;font-weight:700;font-family:inherit;cursor:pointer">
        Zaloguj się / Zarejestruj
      </button>
    </div>`;
}
/** Czy blad oznacza, ze uzytkownik po prostu zamknal okno logowania.
 *
 *  Apple nie zwraca slowa „cancel" — podaje kod numeryczny:
 *    1001 = canceled, 1000 = unknown, 1004 = failed.
 *  Bez tego zamkniecie okna Apple wygladalo jak awaria
 *  („The operation couldn't be completed... error 1001").
 */
function isUserCancellation(raw) {
    return /AuthorizationError error 1001|ERROR_ABORTED|cancell?ed|anulowan|user_cancel|12501|SIGN_IN_CANCELLED/i.test(raw);
}
/** Zamien techniczny komunikat na zdanie zrozumiale dla uzytkownika. */
function humanAuthError(raw) {
    if (/credential-already-in-use|already in use/i.test(raw)) {
        return 'To konto jest juz powiazane z innym profilem MapYou.';
    }
    if (/provider-already-linked|already linked/i.test(raw)) {
        return 'To logowanie jest juz dodane.';
    }
    if (/AuthorizationError error 100[04]/i.test(raw)) {
        return 'Apple nie zdolalo dokonczyc logowania. Sprobuj ponownie.';
    }
    if (/network|timeout|Load failed/i.test(raw)) {
        return 'Brak polaczenia z siecia. Sprobuj ponownie.';
    }
    return raw || 'Nie udalo sie. Sprobuj ponownie.';
}
/** Sekcja „sposoby logowania" — pokazuje podpiete tozsamosci i pozwala dodac
 *  brakujaca. Po polaczeniu OBA logowania prowadza do TEGO SAMEGO konta,
 *  bo Firebase zachowuje wspolny `uid`. */
function renderProviderRow() {
    const hasGoogle = _providers.includes('google.com');
    const hasApple = _providers.includes('apple.com');
    const isIOS = getPlatform() === 'ios';
    const chip = (label, on) => `
    <span style="display:inline-flex;align-items:center;gap:5px;padding:4px 10px;
                 border-radius:999px;font-size:1.1rem;
                 border:1px solid rgba(128,128,128,0.35);
                 color:${on ? '#00c46a' : 'var(--f-muted,rgba(128,128,128,0.9))'}">
      ${on ? '\u2713' : '\u25CB'} ${label}
    </span>`;
    // Apple proponujemy wylacznie na iOS — na Androidzie wymagaloby to
    // konfiguracji Service ID po stronie Apple Developer i flow przegladarkowego.
    let missing = null;
    if (!hasGoogle)
        missing = 'google';
    else if (isIOS && !hasApple)
        missing = 'apple';
    const btn = missing ? `
    <button class="accLinkBtn" data-prov="${missing}"
      style="margin-top:10px;width:100%;padding:10px;border-radius:10px;
             border:1px solid rgba(128,128,128,0.45);background:none;
             color:var(--f-text,#fff);font-size:1.2rem;font-weight:600;
             font-family:inherit;cursor:pointer">
      + Dodaj logowanie ${missing === 'apple' ? 'Apple' : 'Google'}
    </button>` : '';
    return `
    <div style="margin-top:12px">
      <div style="color:var(--f-muted,rgba(128,128,128,0.9));font-size:1.1rem;margin-bottom:6px">
        Sposoby logowania
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        ${chip('Google', hasGoogle)}
        ${(isIOS || hasApple) ? chip('Apple', hasApple) : ''}
      </div>
      ${btn}
      <div class="accLinkMsg" style="display:none;font-size:1.1rem;margin-top:8px;line-height:1.4"></div>
    </div>`;
}
/** Podepnij zdarzenia karty. `onChanged` woła się po udanym logowaniu/wylogowaniu. */
export function bindAccountCard(root, onChanged) {
    // Gdy stan konta ustali sie JUZ PO otwarciu ustawien, przerysuj karte.
    // Bez tego uzytkownik widzi „Zaloguj sie" mimo dzialajacego konta,
    // dopoki nie zamknie i nie otworzy ustawien ponownie.
    if (!_resolved) {
        const off = onAccountChange(() => {
            off();
            // Modal moze byc juz zamkniety — wtedy nie ma czego odswiezac.
            const stillOpen = root.isConnected !== false;
            if (stillOpen)
                onChanged?.();
        });
    }
    root.querySelector('#accSignIn')?.addEventListener('click', () => {
        void showAuthModal().then(ok => { if (ok)
            onChanged?.(); });
    });
    root.querySelectorAll('.accLinkBtn').forEach(btn => {
        btn.addEventListener('click', () => {
            const prov = (btn.dataset.prov === 'apple' ? 'apple' : 'google');
            const msg = root.querySelector('.accLinkMsg');
            const say = (text, ok) => {
                if (!msg)
                    return;
                msg.textContent = text;
                msg.style.color = ok ? '#00c46a' : '#ef4444';
                msg.style.display = 'block';
            };
            void (async () => {
                const original = btn.textContent ?? '';
                btn.disabled = true;
                btn.textContent = 'Laczenie\u2026'; // Apple potrafi mielic kilka sekund
                if (msg)
                    msg.style.display = 'none';
                try {
                    await linkProvider(prov);
                    const u = await getSignedInUser();
                    _providers = u?.providers ?? _providers;
                    say('\u2713 Polaczono. Mozesz teraz logowac sie obiema metodami.', true);
                    emitChange();
                    setTimeout(() => onChanged?.(), 900);
                }
                catch (e) {
                    const raw = e instanceof Error ? e.message : String(e);
                    // Zamkniecie okna to nie awaria — nie strasz uzytkownika czerwonym tekstem.
                    if (isUserCancellation(raw)) {
                        if (msg)
                            msg.style.display = 'none';
                    }
                    else {
                        say(humanAuthError(raw), false);
                    }
                }
                finally {
                    btn.disabled = false;
                    btn.textContent = original;
                }
            })();
        });
    });
    root.querySelector('#accDelete')?.addEventListener('click', () => {
        void showDeleteAccountModal();
    });
    root.querySelector('#accSignOut')?.addEventListener('click', () => {
        void (async () => {
            if (!confirm('Wylogować?\n\n' +
                'Dane zostaną usunięte z tego telefonu i wrócą po ponownym zalogowaniu. ' +
                'Nic nie tracisz — wszystko jest bezpieczne w chmurze.'))
                return;
            try {
                await signOutEverywhere();
            }
            catch { /* noop */ }
            _signedIn = false;
            _email = null;
            _providers = [];
            setSessionReady(false);
            // Wyczysc dane konta z urzadzenia. Bez tego treningi, profil i znajomi
            // poprzedniego uzytkownika zostawali w Dexie — a gdy na tym telefonie
            // zalogowal sie ktos inny, widzialby cudze dane obok swoich.
            try {
                const [{ clearAccountDataLocally }, { clearFriendsLocally }] = await Promise.all([
                    import('./db.js'),
                    import('./FriendsDB.js'),
                ]);
                await clearAccountDataLocally();
                await clearFriendsLocally();
            }
            catch (e) {
                console.warn('[Account] czyszczenie danych nieudane:', e instanceof Error ? e.message : e);
            }
            emitChange();
            onChanged?.();
            // Przeladowanie: widoki trzymaja dane w pamieci, wiec bez tego pokazywalyby
            // treningi, ktorych juz nie ma w bazie.
            setTimeout(() => window.location.reload(), 200);
        })();
    });
}
// ── Usuwanie konta (Faza 4 / D0) ──────────────────────────────────────────────
//
// WYMOG APP STORE (Guideline 5.1.1(v)): skoro apka pozwala zalozyc konto,
// musi pozwolic je usunac z wlasnego wnetrza. Odeslanie na maila albo sam
// „wyloguj" nie wystarczy — Apple odrzuci build.
//
// Operacja jest nieodwracalna, wiec wymagamy przepisania slowa zamiast
// zwyklego „OK". Przy `confirm()` wystarczy jedno odruchowe tapniecie —
// przy koncie z 235 rekordami to za malo.
const DELETE_WORD = 'USUŃ';
export function showDeleteAccountModal() {
    return new Promise(resolve => {
        document.getElementById('delAccModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'delAccModal';
        modal.className = 'name-modal';
        modal.style.zIndex = '10001'; // ponad modalem logowania (10000)
        document.body.appendChild(modal);
        let done = false;
        const finish = (ok) => {
            if (done)
                return;
            done = true;
            modal.style.opacity = '0';
            modal.style.transition = 'opacity 0.25s';
            setTimeout(() => { modal.remove(); resolve(ok); }, 250);
        };
        modal.innerHTML = `
      <div class="name-modal__card" style="position:relative">
        <div class="name-modal__icon">⚠️</div>
        <h2 class="name-modal__title">Usunąć konto na zawsze?</h2>
        <p class="name-modal__sub" style="text-align:left">
          Bezpowrotnie znikną: treningi i trasy, zdjęcia i posty, rekordy
          i trofea, znajomi oraz członkostwo w klubach. Tego nie da się cofnąć
          — nie ma kosza ani kopii zapasowej.
        </p>
        <p class="name-modal__sub" style="text-align:left;margin-top:-4px">
          Jeśli chcesz tylko zejść z tego telefonu, użyj
          <strong>Wyloguj</strong> — dane zostaną w chmurze.
        </p>
        <p class="name-modal__sub" style="text-align:left;margin-top:-4px">
          Aby potwierdzić, wpisz <strong>${DELETE_WORD}</strong>:
        </p>
        <input id="delAccInput" type="text" autocomplete="off" autocapitalize="characters"
          spellcheck="false" placeholder="${DELETE_WORD}"
          style="width:100%;padding:12px;border-radius:10px;
                 border:1px solid rgba(128,128,128,0.45);background:rgba(128,128,128,0.12);
                 color:var(--f-text,#fff);font-size:1.3rem;font-family:inherit;
                 text-align:center;letter-spacing:2px;box-sizing:border-box">
        <button class="name-modal__btn" id="delAccGo" disabled
          style="margin-top:14px;background:#ef4444;color:#fff;opacity:0.45">
          Usuń konto na zawsze
        </button>
        <button class="name-modal__recover-link" id="delAccCancel" style="margin-top:12px">
          Anuluj
        </button>
        <p id="delAccErr" style="display:none;color:#ef4444;font-size:13px;margin:12px 0 0;line-height:1.4"></p>
      </div>`;
        const input = modal.querySelector('#delAccInput');
        const goBtn = modal.querySelector('#delAccGo');
        const errEl = modal.querySelector('#delAccErr');
        const normalize = (s) => s.trim().toUpperCase();
        input.addEventListener('input', () => {
            const ok = normalize(input.value) === DELETE_WORD;
            goBtn.disabled = !ok;
            goBtn.style.opacity = ok ? '1' : '0.45';
        });
        modal.querySelector('#delAccCancel')?.addEventListener('click', () => finish(false));
        // Tlo NIE zamyka tego modalu celowo — przypadkowe tapniecie obok nie
        // powinno przerwac swiadomej decyzji w polowie.
        goBtn.addEventListener('click', () => {
            void (async () => {
                goBtn.disabled = true;
                goBtn.textContent = 'Usuwanie…';
                errEl.style.display = 'none';
                input.disabled = true;
                try {
                    // Token dokladany automatycznie przez authFetch (sesja jest gotowa,
                    // bo przycisk widac tylko przy zalogowanym koncie).
                    const res = await fetch(`${BACKEND_URL}/auth/me`, {
                        method: 'DELETE',
                        signal: AbortSignal.timeout(30000),
                    });
                    const data = await res.json().catch(() => ({}));
                    if (!res.ok || data.status !== 'ok') {
                        throw new Error(data.message ?? `Błąd ${res.status}`);
                    }
                    // Konto po stronie serwera juz nie istnieje — sprzatamy telefon.
                    _signedIn = false;
                    _email = null;
                    _providers = [];
                    setSessionReady(false);
                    try {
                        await signOutEverywhere();
                    }
                    catch { /* konto Firebase moglo juz zniknac */ }
                    try {
                        const [{ clearAccountDataLocally }, { clearFriendsLocally }] = await Promise.all([
                            import('./db.js'),
                            import('./FriendsDB.js'),
                        ]);
                        await clearAccountDataLocally();
                        await clearFriendsLocally();
                    }
                    catch (e) {
                        console.warn('[Account] czyszczenie danych po usunieciu konta nieudane:', e instanceof Error ? e.message : e);
                    }
                    emitChange();
                    finish(true);
                    // Widoki trzymaja dane w pamieci — bez przeladowania pokazywalyby
                    // treningi, ktorych juz nie ma.
                    setTimeout(() => window.location.reload(), 300);
                }
                catch (e) {
                    const raw = e instanceof Error ? e.message : String(e);
                    errEl.textContent = /network|timeout|Load failed|aborted/i.test(raw)
                        ? 'Brak połączenia z siecią. Konto NIE zostało usunięte — spróbuj ponownie.'
                        : `Nie udało się usunąć konta: ${raw}`;
                    errEl.style.display = 'block';
                    goBtn.textContent = 'Usuń konto na zawsze';
                    goBtn.disabled = false;
                    input.disabled = false;
                }
            })();
        });
        setTimeout(() => input.focus(), 100);
    });
}
// ── Karta „zaloguj się" dla zakładek społecznościowych ────────────────────────
export function signInPromptHtml(what = 'tej funkcji') {
    return `
    <div class="acc-prompt" style="margin:24px 16px;padding:24px 20px;border-radius:16px;background:rgba(255,255,255,0.05);text-align:center">
      <div style="font-size:34px;margin-bottom:10px">🔒</div>
      <div style="font-weight:700;color:#fff;font-size:1.5rem;margin-bottom:6px">Zaloguj się, aby korzystać z ${escapeHtml(what)}</div>
      <div style="color:rgba(255,255,255,0.45);font-size:1.25rem;line-height:1.5;margin-bottom:18px">
        Twoje dotychczasowe treningi zostaną automatycznie przypisane do konta.
      </div>
      <button class="accPromptBtn" style="width:100%;padding:13px;border:none;border-radius:12px;background:#00c46a;color:#fff;font-size:1.35rem;font-weight:700;font-family:inherit;cursor:pointer">
        Zaloguj się / Zarejestruj
      </button>
    </div>`;
}
/** Podepnij przyciski z signInPromptHtml w danym kontenerze. */
export function bindSignInPrompts(root, onChanged) {
    root.querySelectorAll('.accPromptBtn').forEach(btn => {
        btn.addEventListener('click', () => {
            void showAuthModal().then(ok => { if (ok)
                onChanged?.(); });
        });
    });
}
// ── Modal logowania / rejestracji ─────────────────────────────────────────────
/** Pokaż modal. Zwraca true, jeśli użytkownik się zalogował. */
export function showAuthModal() {
    return new Promise(resolve => {
        document.getElementById('authModal')?.remove();
        const isIOS = getPlatform() === 'ios';
        const modal = document.createElement('div');
        modal.id = 'authModal';
        modal.className = 'name-modal';
        // .name-modal ma z-index 5000, a nakladka profilu 7500 i modal ustawien 9800 —
        // bez tego okno logowania schowaloby sie POD kartami profilu.
        modal.style.zIndex = '10000';
        // Klatki animacji spinnera — wstrzykiwane raz, bo modal korzysta ze stylow
        // inline i nie ma wlasnego arkusza.
        if (!document.getElementById('accSpinKeyframes')) {
            const st = document.createElement('style');
            st.id = 'accSpinKeyframes';
            st.textContent = '@keyframes accspin{to{transform:rotate(360deg)}}';
            document.head.appendChild(st);
        }
        document.body.appendChild(modal);
        let transferCode = null;
        let done = false;
        const finish = (ok) => {
            if (done)
                return;
            done = true;
            modal.style.opacity = '0';
            modal.style.transition = 'opacity 0.25s';
            setTimeout(() => { modal.remove(); resolve(ok); }, 250);
        };
        // Kliknięcie w ciemne tło poza kartą też zamyka — awaryjne wyjście.
        modal.addEventListener('click', e => { if (e.target === modal)
            finish(false); });
        // ---- widok główny ----
        const renderMain = () => {
            modal.innerHTML = `
        <div class="name-modal__card" style="position:relative">
          <button id="authClose" aria-label="Zamknij" style="position:absolute;top:4px;right:4px;width:44px;height:44px;display:flex;align-items:center;justify-content:center;background:none;border:none;color:rgba(150,150,150,0.9);font-size:30px;line-height:1;cursor:pointer;z-index:2">×</button>
          <div class="name-modal__icon">🏃</div>
          <h2 class="name-modal__title">Zaloguj się lub zarejestruj</h2>
          <p class="name-modal__sub">
            Twoje treningi z tego telefonu zostaną przypisane do konta.
            Będziesz mieć je na każdym urządzeniu.
          </p>

          <button class="name-modal__btn" id="authGoogle" style="display:flex;align-items:center;justify-content:center;gap:10px">
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
            Kontynuuj z Google
          </button>

          ${isIOS ? `
          <button class="name-modal__btn" id="authApple" style="margin-top:10px;background:#000;color:#fff;border:1px solid rgba(255,255,255,0.28);display:flex;align-items:center;justify-content:center;gap:8px">
            <svg width="17" height="20" viewBox="0 0 384 512" fill="#fff" aria-hidden="true"><path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-36.5-2.8-76.4 21.2-91 21.2-15.4 0-50.7-20.2-78.4-20.2C61.7 141.6 8 184.9 8 271.6c0 25.6 4.7 52 14.1 79.3 12.5 35.9 61.9 123.4 113.4 121.8 26.9-.6 45.9-19.1 80.9-19.1 34 0 51.6 19.1 81.6 19.1 52-1.5 96.7-81.3 108.6-117.3-69.6-32.8-87.9-95.4-87.9-86.7zM255.7 82.4c17.4-20.6 26.6-45.9 24.3-72.4-25.6 2.1-49.2 14.3-66.6 34.3-17.4 19.9-27.4 44.6-24.9 70.4 27.9 2.2 51.9-10.4 67.2-32.3z"/></svg>
            Kontynuuj z Apple
          </button>` : ''}

          <button class="name-modal__recover-link" id="authTransfer" style="margin-top:14px">
            📲 Mam już konto na innym telefonie
          </button>
          <p id="authError" style="display:none;color:#ef4444;font-size:13px;margin:12px 0 0;line-height:1.4"></p>
        </div>`;
            modal.querySelector('#authClose')?.addEventListener('click', () => finish(false));
            modal.querySelector('#authGoogle')?.addEventListener('click', () => void run('google'));
            modal.querySelector('#authApple')?.addEventListener('click', () => void run('apple'));
            modal.querySelector('#authTransfer')?.addEventListener('click', () => renderCode('Wpisz kod odzyskiwania ze starego telefonu (Profil → Kod odzyskiwania). Potem zaloguj się tym samym kontem Google lub Apple.'));
        };
        const showErr = (msg) => {
            const el = modal.querySelector('#authError');
            if (el) {
                el.textContent = msg;
                el.style.color = '#ef4444';
                el.style.display = 'block';
            }
        };
        /** Komunikat neutralny/pozytywny — NIE czerwony (kod zapisany itp.). */
        const showInfo = (msg) => {
            const el = modal.querySelector('#authError');
            if (el) {
                el.textContent = msg;
                el.style.color = '#00c46a';
                el.style.display = 'block';
            }
        };
        const busy = (b) => {
            modal.querySelectorAll('button').forEach(x => {
                // Przycisk zamkniecia zostaje AKTYWNY zawsze. Gdy natywne logowanie
                // zawiesi sie i nie zwroci ani wyniku, ani bledu, blok finally nigdy
                // sie nie wykona — a wtedy uzytkownik zostawal uwieziony w modalu.
                if (x.id === 'authClose')
                    return;
                x.disabled = b;
            });
        };
        // ---- logowanie u dostawcy + wymiana sesji ----
        const run = async (provider) => {
            // Wskaznik postepu na klikniętym przycisku. Logowanie Apple bywa
            // wyraznie wolniejsze od Google (kilka sekund), a bez informacji
            // zwrotnej wyglada, jakby apka zawisla — uzytkownik zamyka okno
            // w polowie procesu i widzi „blad", ktory jest tylko anulowaniem.
            const clicked = modal.querySelector(provider === 'google' ? '#authGoogle' : '#authApple');
            const originalHtml = clicked?.innerHTML ?? '';
            if (clicked) {
                clicked.innerHTML =
                    '<span style="display:inline-flex;align-items:center;gap:8px">' +
                        '<span class="accSpin" style="width:16px;height:16px;border:2px solid currentColor;' +
                        'border-top-color:transparent;border-radius:50%;display:inline-block;' +
                        'animation:accspin 0.8s linear infinite"></span>' +
                        'Logowanie\u2026</span>';
            }
            busy(true);
            try {
                // Limit czasu: natywne okno moze dzialac dlugo (uzytkownik wpisuje
                // haslo), ale nie w nieskonczonosc. Bez tego awaria wtyczki wiesza
                // caly przeplyw bez zadnego komunikatu.
                const withTimeout = (pr, ms) => Promise.race([
                    pr,
                    new Promise((_, rej) => setTimeout(() => rej(new Error('Logowanie nie odpowiada. Sprawdz konfiguracje natywna (Podfile / GoogleSignIn).')), ms)),
                ]);
                if (provider === 'google')
                    await withTimeout(signInWithGoogle(), 120000);
                else
                    await withTimeout(signInWithApple(), 120000);
                const { cachedCode } = getDeviceLegacyState();
                const code = transferCode ?? cachedCode ?? undefined;
                const session = await exchangeSession(code);
                _signedIn = true;
                setSessionReady(true);
                let provUser = null;
                try {
                    provUser = await getSignedInUser();
                    _email = provUser?.email ?? null;
                    _providers = provUser?.providers ?? [];
                }
                catch { /* noop */ }
                dlog(`[Account] zalogowano (${session.mode}) userId=${session.userId}`);
                emitChange();
                // Zaleznie od trybu: sciagnij konto z Atlasa albo wypchnij lokalne dane.
                await syncAfterSignIn(session.mode);
                // Dopiero PO hydratacji — zeby nie nadpisac wlasnego zdjecia z serwera.
                await fillProfileFromProvider(provUser);
                finish(true);
                // Przeladuj widok, zeby sciagniete treningi/znajomi pojawili sie od razu.
                // Bez tego dane sa w Dexie, ale ekran pokazuje stan sprzed logowania.
                setTimeout(() => window.location.reload(), 400);
            }
            catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                // Backend mówi: to userId ma już konto → potrzebny kod odzyskiwania
                if (/NEEDS_RECOVERY_CODE/i.test(msg) || /kod odzyskiwania/i.test(msg)) {
                    renderCode('To konto istnieje już na serwerze. Podaj kod odzyskiwania, aby połączyć je z tym logowaniem.');
                }
                else if (isUserCancellation(msg)) {
                    // Uzytkownik zamknal okno dostawcy — bez czerwonego komunikatu.
                }
                else {
                    showErr(humanAuthError(msg));
                }
            }
            finally {
                busy(false);
                if (clicked)
                    clicked.innerHTML = originalHtml;
            }
        };
        // ---- widok z kodem odzyskiwania ----
        const renderCode = (message) => {
            modal.innerHTML = `
        <div class="name-modal__card">
          <div class="name-modal__icon">🔑</div>
          <h2 class="name-modal__title">Kod odzyskiwania</h2>
          <p class="name-modal__sub">${escapeHtml(message)}</p>
          <input class="name-modal__input" id="authCode" type="text" inputmode="numeric"
                 placeholder="123456" maxlength="6" autocomplete="off"/>
          <button class="name-modal__btn" id="authCodeOk">Dalej</button>
          <button class="name-modal__recover-link" id="authCodeBack" style="margin-top:10px">← Wróć</button>
          <p id="authError" style="display:none;color:#ef4444;font-size:13px;margin:12px 0 0;line-height:1.4"></p>
        </div>`;
            const input = modal.querySelector('#authCode');
            input?.focus();
            modal.querySelector('#authCodeOk')?.addEventListener('click', () => {
                const v = (input?.value ?? '').trim();
                if (v.length < 6) {
                    showErr('Kod ma 6 cyfr.');
                    return;
                }
                transferCode = v;
                renderMain();
                showInfo('✓ Kod zapisany. Teraz kliknij „Kontynuuj z Google” lub „…z Apple”.');
            });
            modal.querySelector('#authCodeBack')?.addEventListener('click', () => renderMain());
        };
        renderMain();
    });
}
// ── Wypchnięcie lokalnych danych po zalogowaniu ───────────────────────────────
/** Po zalogowaniu trzeba zrobić DWIE różne rzeczy, w zależności od tego, co
 *  się właśnie stało — i pomylenie ich było błędem:
 *
 *   login / linked   → konto ISTNIEJE na serwerze (przywrócenie, migracja).
 *                      Trzeba ŚCIĄGNĄĆ dane z Atlasa do Dexie (hydrate).
 *                      syncToMongoIfNeeded() tu NIE pomoże: gdy Atlas ma już
 *                      rekordy, ta funkcja tylko stawia znacznik i wychodzi.
 *
 *   claimed / created → konto POWSTAJE z danych gościa.
 *                      Trzeba WYPCHNĄĆ lokalne treningi w górę.
 */
async function syncAfterSignIn(mode) {
    try {
        if (mode === 'login' || mode === 'linked') {
            // Zdejmij znacznik świeżej hydratacji — inaczej hydrate() uzna, że dane
            // są aktualne (apka hydratowała na starcie pod etykietą gościa) i pominie
            // ściąganie właśnie przywróconego konta.
            localStorage.removeItem('mapyou_hydrated_at');
            const { hydrate } = await import('./cloudSync.js');
            await hydrate();
            dlog('[Account] dane konta ściągnięte z Atlasa');
        }
        else {
            const { resetSyncFlag, syncToMongoIfNeeded } = await import('./syncToMongo.js');
            resetSyncFlag();
            await syncToMongoIfNeeded();
            dlog('[Account] lokalne treningi wysłane do chmury');
        }
    }
    catch (e) {
        console.warn('[Account] synchronizacja po zalogowaniu nieudana:', e instanceof Error ? e.message : e);
    }
}
// ── Profil z konta Google / Apple ─────────────────────────────────────────────
/** Uzupelnij imie i zdjecie z konta dostawcy — TYLKO gdy sa puste.
 *  Nigdy nie nadpisujemy tego, co uzytkownik ustawil sam: zdjecie i imie
 *  pozostaja w pelni edytowalne w Profilu, a ta funkcja jedynie daje
 *  sensowny punkt startowy zaraz po rejestracji (tak dziala Strava i spolka). */
async function fillProfileFromProvider(user) {
    if (!user)
        return;
    const { saveProfileToLocal } = await import('./UserProfile.js');
    const patch = {};
    const localName = (localStorage.getItem('mapyou_userName') ?? '').trim();
    const isPlaceholder = !localName || localName === 'MapYou User' || localName === 'Athlete';
    if (isPlaceholder && user.displayName)
        patch.name = user.displayName;
    const hasAvatar = !!localStorage.getItem('mapyou_avatar');
    if (!hasAvatar && user.photoUrl) {
        try {
            // Zdjecie zapisujemy jako base64, a nie URL — dzieki temu dziala offline
            // i pasuje do formatu, ktorego uzywa reszta apki (avatarB64).
            const res = await fetch(user.photoUrl.replace(/=s\d+-c$/, '=s256-c'));
            if (res.ok) {
                const blob = await res.blob();
                patch.avatarB64 = await new Promise((resolve, reject) => {
                    const r = new FileReader();
                    r.onload = () => resolve(String(r.result));
                    r.onerror = () => reject(new Error('read failed'));
                    r.readAsDataURL(blob);
                });
            }
        }
        catch (e) {
            console.warn('[Account] nie udalo sie pobrac zdjecia z Google:', e instanceof Error ? e.message : e);
        }
    }
    if (Object.keys(patch).length) {
        saveProfileToLocal(patch); // zapisuje lokalnie i wysyla na serwer
        dlog('[Account] profil uzupelniony z konta:', Object.keys(patch).join(', '));
        emitChange();
    }
}
// ── Util ──────────────────────────────────────────────────────────────────────
function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] ?? c));
}
//# sourceMappingURL=AccountUI.js.map