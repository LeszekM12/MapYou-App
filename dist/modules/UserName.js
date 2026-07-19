import { BACKEND_URL } from '../config.js';
// ─── USERNAME SETUP ───────────────────────────────────────────────────────────
// src/modules/UserName.ts
//
// Obsługuje modal pierwszego uruchomienia „Jak masz na imię?"
// oraz zmianę imienia w ustawieniach.
const LS_KEY = 'mapyou_userName';
const LS_SETUP_KEY = 'mapyou_nameSet';
// ── Recovery code ─────────────────────────────────────────────────────────────
const LS_RECOVERY_KEY = 'mapyou_recovery_code';
/** Pobierz lub wygeneruj kod odzyskiwania dla userId */
export async function ensureRecoveryCode(userId) {
    // Sprawdź cache lokalny
    const cached = localStorage.getItem(LS_RECOVERY_KEY);
    if (cached)
        return cached;
    try {
        const res = await fetch(`${BACKEND_URL}/recover/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId }),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        // Backend zwraca kod tylko przy pierwszym utworzeniu. Jeśli kod już istnieje,
        // przychodzi code:null (nie ujawniamy istniejącego kodu po publicznym userId).
        if (data.status === 'ok' && data.code) {
            localStorage.setItem(LS_RECOVERY_KEY, data.code);
            return data.code;
        }
        return null;
    }
    catch {
        return null;
    }
}
/** Recover account przez kod — zwraca userId lub null */
export async function restoreAccountByCode(code) {
    try {
        const res = await fetch(`${BACKEND_URL}/recover/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ code: code.trim() }),
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok)
            return null;
        const data = await res.json();
        if (data.status !== 'ok')
            return null;
        // Zapisz profil z backendu
        if (data.name)
            localStorage.setItem('mapyou_userName', data.name);
        if (data.bio)
            localStorage.setItem('mapyou_bio', data.bio);
        if (data.avatarB64)
            localStorage.setItem('mapyou_avatar', data.avatarB64);
        if (data.city)
            localStorage.setItem('mapyou_city', data.city);
        if (data.region)
            localStorage.setItem('mapyou_region', data.region);
        return data.userId;
    }
    catch {
        return null;
    }
}
/** Pokaż modal z kodem odzyskiwania */
export async function showRecoveryCodeModal(userId) {
    const code = await ensureRecoveryCode(userId);
    document.getElementById('recoveryCodeModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'recoveryCodeModal';
    modal.className = 'name-modal';
    modal.innerHTML = `
    <div class="name-modal__card">
      <div class="name-modal__icon">🔑</div>
      <h2 class="name-modal__title">Your recovery code</h2>
      <p class="name-modal__sub">
        Save this code somewhere safe.<br/>
        Use it to recover your data on a new device.
      </p>
      <div class="recovery-code__display" id="recoveryCodeDisplay">
        ${code ? `<span class="recovery-code__digits">${code}</span>` : '<span style="color:#888">No server connection</span>'}
      </div>
      ${code ? `
      <button class="name-modal__btn name-modal__btn--secondary" id="recoveryCodeCopy">
        📋 Copy code
      </button>` : ''}
      <button class="name-modal__btn" id="recoveryCodeClose" style="margin-top:8px">
        Close
      </button>
    </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#recoveryCodeCopy')?.addEventListener('click', async () => {
        if (!code)
            return;
        try {
            await navigator.clipboard.writeText(code);
            const btn = modal.querySelector('#recoveryCodeCopy');
            btn.textContent = '✅ Copied!';
            setTimeout(() => { btn.textContent = '📋 Copy code'; }, 2000);
        }
        catch { }
    });
    modal.querySelector('#recoveryCodeClose')?.addEventListener('click', () => {
        modal.style.opacity = '0';
        modal.style.transition = 'opacity 0.3s';
        setTimeout(() => modal.remove(), 300);
    });
}
// ── Getters / setters ─────────────────────────────────────────────────────────
export function getUserName() {
    return localStorage.getItem(LS_KEY) ?? 'Athlete';
}
export function setUserName(name) {
    const trimmed = name.trim();
    if (!trimmed)
        return;
    localStorage.setItem(LS_KEY, trimmed);
    localStorage.setItem(LS_SETUP_KEY, '1');
    // Zaktualizuj greeting wszędzie gdzie jest wyświetlane
    document.querySelectorAll('[data-username]').forEach(el => {
        el.textContent = trimmed;
    });
}
export function isNameSet() {
    return !!localStorage.getItem(LS_SETUP_KEY);
}
// ── First-run modal ───────────────────────────────────────────────────────────
export function showNameModalIfNeeded() {
    if (isNameSet())
        return Promise.resolve();
    return showNameModal();
}
export function showNameModal(prefill) {
    return new Promise(resolve => {
        document.getElementById('nameSetupModal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'nameSetupModal';
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
        <button class="name-modal__recover-link" id="nameModalRecover">
          🔑 Recover account
        </button>
      </div>`;
        document.body.appendChild(modal);
        const input = modal.querySelector('#nameModalInput');
        input.focus();
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
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter')
                modal.querySelector('#nameModalSave')?.click();
        });
        modal.querySelector('#nameModalRecover')?.addEventListener('click', () => {
            _showRestorePanel(modal, resolve);
        });
    });
}
// ── Restore panel ─────────────────────────────────────────────────────────────
function _showRestorePanel(modal, resolve, backToNameSetup = true) {
    const card = modal.querySelector('.name-modal__card');
    card.innerHTML = `
    <div class="name-modal__icon">🔑</div>
    <h2 class="name-modal__title">Recover account</h2>
    <p class="name-modal__sub">
      Enter the 6-digit recovery code you saved earlier.
    </p>
    <input
      class="name-modal__input"
      id="restoreCodeInput"
      type="number"
      placeholder="e.g. 847291"
      maxlength="6"
      autocomplete="off"
      inputmode="numeric"
    />
    <div class="name-modal__restore-status" id="restoreStatus" style="color:#ef4444;font-size:13px;min-height:20px;margin-bottom:8px"></div>
    <button class="name-modal__btn" id="restoreSubmit">Restore account 🔑</button>
    <button class="name-modal__recover-link" id="restoreBack">${backToNameSetup ? '← Back' : 'Cancel'}</button>`;
    const input = card.querySelector('#restoreCodeInput');
    const status = card.querySelector('#restoreStatus');
    input.focus();
    card.querySelector('#restoreBack')?.addEventListener('click', () => {
        modal.remove();
        if (backToNameSetup)
            void showNameModal();
        else
            resolve();
    });
    const doRestore = async () => {
        const code = input.value.trim();
        if (code.length !== 6) {
            status.textContent = 'Code must be 6 digits';
            return;
        }
        const btn = card.querySelector('#restoreSubmit');
        btn.disabled = true;
        btn.textContent = 'Searching…';
        status.textContent = '';
        const userId = await restoreAccountByCode(code);
        if (!userId) {
            status.textContent = 'Invalid code. Please try again.';
            btn.disabled = false;
            btn.textContent = 'Restore account 🔑';
            return;
        }
        // Zapisz userId i kod
        localStorage.setItem('mapyou_userId_profile', userId);
        localStorage.setItem('mapty_userId', userId);
        localStorage.setItem('mapyou_recovery_code', code);
        // Wyczyść flagę syncu żeby hydratacja pobrała dane
        localStorage.removeItem('mapyou_mongo_synced');
        localStorage.removeItem('mapyou_hydrated_at');
        // Wymuś ponowną rejestrację push pod NOWYM userId (web push i FCM)
        localStorage.removeItem('mapyou_fcm_token');
        // Ustaw flagę że imię jest ustawione (zostało przywrócone)
        localStorage.setItem('mapyou_nameSet', '1');
        status.style.color = '#4ade80';
        status.textContent = '✅ Account restored! Loading data…';
        btn.textContent = 'Done!';
        setTimeout(() => {
            modal.remove();
            resolve();
            window.location.reload();
        }, 1500);
    };
    card.querySelector('#restoreSubmit')?.addEventListener('click', doRestore);
    input.addEventListener('keydown', e => { if (e.key === 'Enter')
        void doRestore(); });
}
// ── Settings integration ──────────────────────────────────────────────────────
/** Restore-account modal opened from Settings (switch this device to an
 *  existing account by entering its 6-digit recovery code). Reuses the same
 *  panel as the first-run flow; "Cancel" just closes instead of returning to
 *  name setup. On success the panel swaps both identity keys, resets sync
 *  flags and push-token cache, then reloads the app. */
export function showRestoreAccountModal() {
    document.getElementById('restoreAccountModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'restoreAccountModal';
    modal.className = 'name-modal';
    modal.innerHTML = `<div class="name-modal__card"></div>`;
    document.body.appendChild(modal);
    _showRestorePanel(modal, () => { }, /* backToNameSetup */ false);
}
export function openChangeNameModal() {
    void showNameModal(getUserName());
}
//# sourceMappingURL=UserName.js.map