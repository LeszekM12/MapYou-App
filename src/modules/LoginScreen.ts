// ─── LOGIN SCREEN (Faza 3) ───────────────────────────────────────────────────
// src/modules/LoginScreen.ts
//
// Blokujący modal logowania w stylu istniejących name-modali (friends.css).
// Scenariusze:
//  A. Zwykłe logowanie (konto dowiązane) → Google/Apple → mode 'login'.
//  B. Ten telefon ma stare konto (userId w localStorage):
//     - kod recovery w cache → dopięcie w tle, user nic nie wpisuje (mode 'linked')
//     - kodu brak → prosimy o kod PRZED utworzeniem czegokolwiek
//       (żeby nie osierocić starego konta); opcja „Załóż nowe konto" świadomie.
//  C. Świeży telefon, ale user MA konto na starym → link „Przenoszę konto",
//     wpisuje kod, potem Google/Apple → mode 'linked'.
//
// Zwraca Promise<userId> — apka czeka, aż logowanie się dokończy.

// Bez importów npm — projekt nie ma bundlera (patrz authService.ts).
import {
  signInWithGoogle, signInWithApple, exchangeSession,
  getDeviceLegacyState, getPlatform,
} from './authService.js';
import { ensureRecoveryCode } from './UserName.js';

export function showLoginScreen(): Promise<string> {
  return new Promise(resolve => {
    document.getElementById('loginModal')?.remove();

    const isIOS = getPlatform() === 'ios';
    const modal = document.createElement('div');
    modal.id = 'loginModal';
    modal.className = 'name-modal';
    modal.innerHTML = `
      <div class="name-modal__card">
        <div class="name-modal__icon">🏃</div>
        <h2 class="name-modal__title">Witaj w MapYou</h2>
        <p class="name-modal__sub" id="loginSub">
          Zaloguj się, aby Twoje treningi, znajomi i statystyki
          były bezpieczne i dostępne na każdym telefonie.
        </p>
        <button class="name-modal__btn" id="loginGoogle" style="display:flex;align-items:center;justify-content:center;gap:10px;">
          <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41.4 34.9 44 30 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
          Zaloguj przez Google
        </button>
        ${isIOS ? `
        <button class="name-modal__btn" id="loginApple" style="margin-top:10px;background:#000;color:#fff;display:flex;align-items:center;justify-content:center;gap:10px;">
           Zaloguj przez Apple
        </button>` : ''}
        <button class="name-modal__recover-link" id="loginTransfer" style="margin-top:14px;">
          📲 Przenoszę konto z innego telefonu
        </button>
        <p id="loginError" style="display:none;color:#ef4444;font-size:13px;margin:10px 0 0;"></p>
      </div>`;

    document.body.appendChild(modal);

    const errEl = modal.querySelector<HTMLElement>('#loginError')!;
    const showError = (msg: string) => { errEl.textContent = msg; errEl.style.display = 'block'; };
    const busy = (b: boolean) => {
      modal.querySelectorAll<HTMLButtonElement>('button').forEach(x => (x.disabled = b));
    };

    /** Kod wpisany przez „Przenoszę konto" — użyty przy najbliższym logowaniu. */
    let transferCode: string | null = null;

    const finish = (userId: string) => {
      modal.style.opacity = '0';
      modal.style.transition = 'opacity 0.3s';
      setTimeout(() => { modal.remove(); resolve(userId); }, 300);
    };

    /** Po udanym sign-in u providera: dopnij/zaloguj/utwórz konto. */
    const afterProviderSignIn = async (): Promise<void> => {
      const { deviceUserId, cachedCode } = getDeviceLegacyState();

      let code = transferCode ?? cachedCode ?? undefined;

      // Telefon ze starym kontem, ale bez kodu w cache — spróbuj pobrać
      // (Faza 0: serwer odda kod tylko, jeśli nigdy nie istniał).
      if (deviceUserId && !code) {
        code = (await ensureRecoveryCode(deviceUserId)) ?? undefined;
      }

      // Wciąż brak kodu, a na telefonie jest stare konto → NIE twórz nowego
      // po cichu. Poproś o kod albo o świadomą decyzję „nowe konto".
      if (deviceUserId && !code) {
        showCodePanel(
          'Na tym telefonie jest już konto MapYou. Wpisz jego kod odzyskiwania, ' +
          'żeby połączyć je z Twoim logowaniem — albo świadomie załóż nowe.',
          /*allowNewAccount*/ true,
        );
        return;
      }

      const session = await exchangeSession(code);
      finish(session.userId);
    };

    const providerFlow = async (provider: 'google' | 'apple'): Promise<void> => {
      errEl.style.display = 'none';
      busy(true);
      try {
        if (provider === 'google') await signInWithGoogle();
        else await signInWithApple();
        await afterProviderSignIn();
      } catch (e) {
        showError(e instanceof Error ? e.message : 'Logowanie nie powiodło się. Spróbuj ponownie.');
      } finally {
        busy(false);
      }
    };

    modal.querySelector('#loginGoogle')?.addEventListener('click', () => void providerFlow('google'));
    modal.querySelector('#loginApple') ?.addEventListener('click', () => void providerFlow('apple'));

    // „Przenoszę konto z innego telefonu" — kod wpisywany PRZED logowaniem
    modal.querySelector('#loginTransfer')?.addEventListener('click', () => {
      showCodePanel(
        'Wpisz kod odzyskiwania ze starego telefonu (Profil → Kod odzyskiwania). ' +
        'Po zalogowaniu Twoje konto zostanie przeniesione.',
        /*allowNewAccount*/ false,
      );
    });

    /** Panel wpisywania kodu (współdzielony przez scenariusze B i C). */
    function showCodePanel(message: string, allowNewAccount: boolean): void {
      const card = modal.querySelector<HTMLElement>('.name-modal__card')!;
      const prevHtml = card.innerHTML;
      card.innerHTML = `
        <div class="name-modal__icon">🔑</div>
        <h2 class="name-modal__title">Kod odzyskiwania</h2>
        <p class="name-modal__sub">${message}</p>
        <input class="name-modal__input" id="loginCodeInput" type="text"
               inputmode="numeric" placeholder="123456" maxlength="6" autocomplete="off"/>
        <button class="name-modal__btn" id="loginCodeOk">Dalej</button>
        ${allowNewAccount ? `
        <button class="name-modal__recover-link" id="loginCodeNew" style="margin-top:10px;">
          Nie mam kodu — załóż nowe, puste konto
        </button>` : ''}
        <button class="name-modal__recover-link" id="loginCodeBack" style="margin-top:6px;">← Wróć</button>
        <p id="loginCodeErr" style="display:none;color:#ef4444;font-size:13px;margin:10px 0 0;"></p>`;

      const input = card.querySelector<HTMLInputElement>('#loginCodeInput')!;
      input.focus();
      const codeErr = card.querySelector<HTMLElement>('#loginCodeErr')!;

      card.querySelector('#loginCodeOk')?.addEventListener('click', () => {
        const v = input.value.trim();
        if (v.length < 6) {
          codeErr.textContent = 'Kod ma 6 cyfr.';
          codeErr.style.display = 'block';
          return;
        }
        transferCode = v;
        // Jeżeli user jest już po sign-in (scenariusz B) — dokończ wymianę.
        // Jeżeli nie (scenariusz C) — wróć do wyboru providera.
        void (async () => {
          try {
            const session = await exchangeSession(transferCode ?? undefined);
            finish(session.userId);
          } catch (e) {
            const notSignedIn = e instanceof Error && e.message === 'Not signed in';
            if (notSignedIn) {
              card.innerHTML = prevHtml;
              rebind();
            } else {
              codeErr.textContent = e instanceof Error ? e.message : 'Kod nieprawidłowy.';
              codeErr.style.display = 'block';
            }
          }
        })();
      });

      card.querySelector('#loginCodeNew')?.addEventListener('click', () => {
        // Świadoma decyzja: porzuć stare, niedowiązane konto na tym urządzeniu.
        localStorage.removeItem('mapyou_userId_profile');
        localStorage.removeItem('mapyou_recovery_code');
        transferCode = null;
        void (async () => {
          try {
            const session = await exchangeSession();
            finish(session.userId);
          } catch (e) {
            codeErr.textContent = e instanceof Error ? e.message : 'Nie udało się utworzyć konta.';
            codeErr.style.display = 'block';
          }
        })();
      });

      card.querySelector('#loginCodeBack')?.addEventListener('click', () => {
        card.innerHTML = prevHtml;
        rebind();
      });
    }

    /** Ponowne podpięcie handlerów po przywróceniu HTML karty. */
    function rebind(): void {
      modal.querySelector('#loginGoogle')?.addEventListener('click', () => void providerFlow('google'));
      modal.querySelector('#loginApple') ?.addEventListener('click', () => void providerFlow('apple'));
      modal.querySelector('#loginTransfer')?.addEventListener('click', () => {
        showCodePanel(
          'Wpisz kod odzyskiwania ze starego telefonu (Profil → Kod odzyskiwania). ' +
          'Po zalogowaniu Twoje konto zostanie przeniesione.',
          false,
        );
      });
    }
  });
}
