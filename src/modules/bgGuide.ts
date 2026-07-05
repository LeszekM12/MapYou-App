// ─── BACKGROUND TRACKING GUIDE ───────────────────────────────────────────────
// A small in-app help sheet for users whose phone kills GPS tracking in the
// background (aggressive battery managers: Samsung, Xiaomi/MIUI, Huawei…).
// Explains WHY a workout may stop recording with the screen off and gives
// one-tap access to the OS settings that fix it. Native-only (Capacitor).

import { bgTracker } from './bgTracker.js';

function isNative(): boolean {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

/** Wire the settings entry; call once after DOM is ready. */
export function initBgTrackingGuide(): void {
  const item = document.getElementById('settingBgTracking');
  if (!item) return;
  if (!isNative()) return;            // web/PWA: keep hidden, not applicable
  item.style.display = '';
  item.addEventListener('click', openBgTrackingGuide);
}

export function openBgTrackingGuide(): void {
  document.getElementById('bgGuideOverlay')?.remove();
  const ov = document.createElement('div');
  ov.id = 'bgGuideOverlay';
  ov.className = 'bgg-overlay';
  ov.innerHTML = `
    <div class="bgg-sheet">
      <div class="bgg-bar"></div>
      <h3 class="bgg-title">🛰️ Background tracking</h3>
      <p class="bgg-p">MapYou records your route even with the screen off, using a
      system tracking service with a persistent notification. On most phones this
      works out of the box — but some battery savers can stop it mid-workout.</p>

      <div class="bgg-check">
        <p class="bgg-check__title">If your route has gaps or stops recording:</p>
        <ol class="bgg-list">
          <li><b>Battery</b> — set MapYou to <b>Unrestricted</b>:<br>
              <span class="bgg-path">Settings → Apps → MapYou → Battery → Unrestricted</span></li>
          <li><b>Location</b> — choose <b>Allow all the time</b>:<br>
              <span class="bgg-path">Settings → Apps → MapYou → Permissions → Location</span></li>
          <li><b>Samsung</b> — remove MapYou from sleeping apps:<br>
              <span class="bgg-path">Battery → Background usage limits → Never sleeping apps → add MapYou</span></li>
          <li><b>Xiaomi / MIUI</b> — enable <b>Autostart</b> and set Battery saver to <b>No restrictions</b>.</li>
        </ol>
      </div>

      <button class="bgg-btn" id="bggOpenSettings">Open app settings</button>
      <p class="bgg-note">Tip: keep the "MapYou · recording" notification visible during
      workouts — dismissing it may stop tracking on some phones.</p>
      <button class="bgg-close" id="bggClose">Close</button>
    </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click', e => { if (e.target === ov) ov.remove(); });
  ov.querySelector('#bggClose')?.addEventListener('click', () => ov.remove());
  ov.querySelector('#bggOpenSettings')?.addEventListener('click', () => { void bgTracker.openSettings(); });
}
