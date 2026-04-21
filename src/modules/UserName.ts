// ─── USERNAME SETUP ───────────────────────────────────────────────────────────
// src/modules/UserName.ts
//
// Obsługuje modal pierwszego uruchomienia „Jak masz na imię?"
// oraz zmianę imienia w ustawieniach.

const LS_KEY       = 'mapyou_userName';
const LS_SETUP_KEY = 'mapyou_nameSet';

// ── Getters / setters ─────────────────────────────────────────────────────────

export function getUserName(): string {
  return localStorage.getItem(LS_KEY) ?? 'Athlete';
}

export function setUserName(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  localStorage.setItem(LS_KEY, trimmed);
  localStorage.setItem(LS_SETUP_KEY, '1');
  // Zaktualizuj greeting wszędzie gdzie jest wyświetlane
  document.querySelectorAll<HTMLElement>('[data-username]').forEach(el => {
    el.textContent = trimmed;
  });
}

export function isNameSet(): boolean {
  return !!localStorage.getItem(LS_SETUP_KEY);
}

// ── First-run modal ───────────────────────────────────────────────────────────

/**
 * Pokazuje modal „Jak masz na imię?" jeśli imię nie zostało jeszcze ustawione.
 * Zwraca Promise który resolves po zamknięciu modalu.
 */
export function showNameModalIfNeeded(): Promise<void> {
  if (isNameSet()) return Promise.resolve();
  return showNameModal();
}

export function showNameModal(prefill?: string): Promise<void> {
  return new Promise(resolve => {
    document.getElementById('nameSetupModal')?.remove();

    const modal = document.createElement('div');
    modal.id    = 'nameSetupModal';
    modal.className = 'name-modal';
    modal.innerHTML = `
      <div class="name-modal__card">
        <div class="name-modal__icon">👋</div>
        <h2 class="name-modal__title">What's your name?</h2>
        <p class="name-modal__sub">
          Your name is shown to friends when you start a workout
          and in live tracking notifications.
        </p>
        <input
          class="name-modal__input"
          id="nameModalInput"
          type="text"
          placeholder="Your name..."
          maxlength="32"
          value="${prefill ?? ''}"
          autocomplete="off"
        />
        <button class="name-modal__btn" id="nameModalSave">Let's go! 🏃</button>
      </div>`;

    document.body.appendChild(modal);

    const input = modal.querySelector<HTMLInputElement>('#nameModalInput')!;
    input.focus();

    // Zapisz po kliknięciu przycisku
    modal.querySelector('#nameModalSave')?.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        input.style.borderColor = '#ef4444';
        input.placeholder = 'Please enter your name';
        return;
      }
      setUserName(name);
      modal.style.opacity = '0';
      modal.style.transition = 'opacity 0.3s';
      setTimeout(() => { modal.remove(); resolve(); }, 300);
    });

    // Enter = zapisz
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') modal.querySelector<HTMLButtonElement>('#nameModalSave')?.click();
    });
  });
}

// ── Settings integration ──────────────────────────────────────────────────────

/**
 * Otwiera modal zmiany imienia.
 * Podpnij do przycisku „Change name" w Settings.
 */
export function openChangeNameModal(): void {
  void showNameModal(getUserName());
}
