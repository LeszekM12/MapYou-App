// ─── WEATHER MODAL ────────────────────────────────────────────────────────────
// Bottom-sheet modal with full weather data.
// Inject styles via WeatherStyles.ts or import weather.css.
import { uvLabel } from './WeatherService.js';
import { sunriseIcon, sunsetIcon } from './nightIcons.js';
const MODAL_ID = 'weatherModal';
// ── Build HTML ────────────────────────────────────────────────────────────────
function buildModal(data) {
    const { current: c, sun, hourly, daily, advice, location } = data;
    // UV bar — gradient green→yellow→orange→red, dot position
    const uvPct = Math.min(Math.round((c.uvIndex / 11) * 100), 100);
    // Wind compass needle rotation (approximate from speed — no direction in free tier)
    // Just show a static compass with speed
    const windLabel = c.windSpeed < 6 ? 'Calm' : c.windSpeed < 20 ? 'Light breeze' : c.windSpeed < 40 ? 'Moderate' : 'Strong wind';
    const humidityPct = c.humidity;
    const tilesHTML = `
    <div class="wm-tiles">

      <div class="wm-tile wm-tile--uv">
        <div class="wm-tile__header"><span class="wm-tile__icon">🔆</span><span class="wm-tile__label">UV INDEX</span></div>
        <div class="wm-tile__main">${c.uvIndex}</div>
        <div class="wm-tile__sub">${uvLabel(c.uvIndex)}</div>
        <div class="wm-tile__uv-bar">
          <div class="wm-tile__uv-track">
            <div class="wm-tile__uv-dot" style="left:${uvPct}%"></div>
          </div>
        </div>
      </div>

      <div class="wm-tile wm-tile--humidity">
        <div class="wm-tile__header"><span class="wm-tile__icon">💧</span><span class="wm-tile__label">HUMIDITY</span></div>
        <div class="wm-tile__main">${c.humidity}<span class="wm-tile__unit">%</span></div>
        <div class="wm-tile__sub">${c.humidity < 30 ? 'Dry air' : c.humidity < 60 ? 'Comfortable' : 'Humid'}</div>
        <div class="wm-tile__bar-wrap">
          <div class="wm-tile__bar-track">
            <div class="wm-tile__bar-fill wm-tile__bar-fill--blue" style="width:${humidityPct}%"></div>
          </div>
        </div>
      </div>

      <div class="wm-tile wm-tile--wind">
        <div class="wm-tile__header"><span class="wm-tile__icon">💨</span><span class="wm-tile__label">WIND</span></div>
        <div class="wm-tile__sub">${windLabel}</div>
        <div class="wm-tile__compass">
          <div class="wm-tile__compass-ring">
            <span class="wm-tile__compass-n">N</span>
            <span class="wm-tile__compass-s">S</span>
            <span class="wm-tile__compass-e">E</span>
            <span class="wm-tile__compass-w">W</span>
            <div class="wm-tile__compass-center">
              <span class="wm-tile__compass-val">${c.windSpeed}</span>
              <span class="wm-tile__compass-unit">km/h</span>
            </div>
          </div>
        </div>
      </div>

      <div class="wm-tile wm-tile--dew">
        <div class="wm-tile__header"><span class="wm-tile__icon">🌡️</span><span class="wm-tile__label">DEW POINT</span></div>
        <div class="wm-tile__main">${c.dewPoint}<span class="wm-tile__unit">°</span></div>
        <div class="wm-tile__sub">${c.dewPoint < 0 ? 'Very dry air' : c.dewPoint < 10 ? 'Dry air' : c.dewPoint < 16 ? 'Comfortable' : 'Humid'}</div>
      </div>

      <div class="wm-tile wm-tile--pressure">
        <div class="wm-tile__header"><span class="wm-tile__icon">📉</span><span class="wm-tile__label">PRESSURE</span></div>
        <div class="wm-tile__pressure-arc">
          <svg viewBox="0 0 100 60" fill="none" xmlns="http://www.w3.org/2000/svg">
            <!-- Track arc: half circle, circumference ≈ 110 -->
            <path d="M10 55 A40 40 0 0 1 90 55"
              stroke="rgba(255,255,255,0.08)" stroke-width="7" stroke-linecap="round"/>
            <!-- Filled arc: clamp pressure 980–1040 → 0–110 -->
            <path d="M10 55 A40 40 0 0 1 90 55"
              stroke="#4ade80" stroke-width="7" stroke-linecap="round"
              stroke-dasharray="126"
              stroke-dashoffset="${Math.round(126 - Math.min(Math.max((c.pressure - 980) / 60, 0), 1) * 126)}"/>
            <!-- Center value -->
            <text x="50" y="46" text-anchor="middle" font-size="13" font-weight="bold" fill="#f0f4f8">${c.pressure}</text>
            <text x="50" y="57" text-anchor="middle" font-size="8" fill="rgba(255,255,255,0.4)">hPa · ${c.pressure < 1010 ? 'Low' : c.pressure < 1025 ? 'Normal' : 'High'}</text>
          </svg>
        </div>
      </div>

      <div class="wm-tile wm-tile--visibility">
        <div class="wm-tile__header"><span class="wm-tile__icon">👁️</span><span class="wm-tile__label">VISIBILITY</span></div>
        <div class="wm-tile__main wm-tile__main--sm">${c.visibility}</div>
        <div class="wm-tile__sub">km${c.visibility >= 10 ? ' — Clear' : c.visibility >= 5 ? ' — Good' : ' — Poor'}</div>
      </div>

    </div>`;
    // icon can be emoji OR an <img> SVG tag — use innerHTML-safe span
    const hourlyHTML = hourly.map(h => {
        if (h.isSunset)
            return `
    <div class="wm-hourly__item wm-hourly__item--sunset">
      <span class="wm-hourly__time">${h.time}</span>
      <span class="wm-hourly__icon">${sunsetIcon()}</span>
      <span class="wm-hourly__sun-lbl wm-hourly__sun-lbl--sunset">Sunset</span>
    </div>`;
        if (h.isSunrise)
            return `
    <div class="wm-hourly__item wm-hourly__item--sunrise">
      <span class="wm-hourly__time">${h.time}</span>
      <span class="wm-hourly__icon">${sunriseIcon()}</span>
      <span class="wm-hourly__sun-lbl wm-hourly__sun-lbl--sunrise">Sunrise</span>
    </div>`;
        // icon is emoji string OR <img> SVG tag — both work in innerHTML
        const isImgIcon = h.icon.startsWith('<img');
        return `
    <div class="wm-hourly__item">
      <span class="wm-hourly__time">${h.time}</span>
      <span class="wm-hourly__icon${isImgIcon ? ' wm-hourly__icon--img' : ''}">${h.icon}</span>
      <span class="wm-hourly__temp">${h.temp}°</span>
    </div>`;
    }).join('');
    const dailyHTML = daily.map(d => `
    <div class="wm-daily__row">
      <span class="wm-daily__day">${d.label}</span>
      <span class="wm-daily__icon">${d.icon}</span>
      <span class="wm-daily__range">
        <span class="wm-daily__max">${d.tempMax}°</span>
        <span class="wm-daily__sep">/</span>
        <span class="wm-daily__min">${d.tempMin}°</span>
      </span>
    </div>`).join('');
    const pct = Math.round(sun.progress * 100);
    const advClass = advice.ideal ? 'wm-advice--ideal' : 'wm-advice--warn';
    return `
  <div class="wm-overlay" id="${MODAL_ID}Overlay" role="dialog" aria-modal="true" aria-label="Weather details">
    <div class="wm-sheet" id="${MODAL_ID}Sheet">

      <!-- Handle -->
      <div class="wm-handle" id="${MODAL_ID}Handle"></div>

      <!-- Header -->
      <div class="wm-header">
        <div class="wm-header__location">
          <span class="wm-header__pin">📍</span>
          <span class="wm-header__city">${location}</span>
        </div>
        <div class="wm-header__logo" aria-label="MapYou">
          <svg viewBox="0 0 60 60" width="28" height="28" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M30 2C19 2 10 11 10 22C10 37 30 58 30 58C30 58 50 37 50 22C50 11 41 2 30 2Z" fill="url(#wg1)"/>
            <circle cx="30" cy="18" r="5" fill="white"/>
            <line x1="30" y1="24" x2="19" y2="17" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
            <line x1="30" y1="24" x2="41" y2="17" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
            <line x1="30" y1="24" x2="30" y2="38" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
            <defs>
              <linearGradient id="wg1" x1="10" y1="2" x2="50" y2="58" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#4ade80"/>
                <stop offset="100%" stop-color="#16a34a"/>
              </linearGradient>
            </defs>
          </svg>
          <span class="wm-header__brand">MapYou</span>
        </div>
        <div class="wm-header__weather">
          <span class="wm-header__wicon wm-icon--svg">${c.icon}</span>
          <span class="wm-header__temp">${c.temp}°C</span>
          <span class="wm-header__desc">${c.description} · Feels ${c.feelsLike}°</span>
        </div>
        <button class="wm-close" id="${MODAL_ID}Close" aria-label="Close weather">✕</button>
      </div>

      <!-- Scrollable body -->
      <div class="wm-body">

        <!-- Stats tiles -->
        <section class="wm-section">
          ${tilesHTML}
        </section>

        <!-- Hourly forecast -->
        <section class="wm-section">
          <h3 class="wm-section__title">Hourly Forecast</h3>
          <div class="wm-hourly">
            ${hourlyHTML}
          </div>
        </section>

        <!-- 3-day forecast -->
        <section class="wm-section">
          <h3 class="wm-section__title">3-Day Forecast</h3>
          <div class="wm-daily">
            ${dailyHTML}
          </div>
        </section>

        <!-- Sunrise / Sunset -->
        <section class="wm-section">
          <h3 class="wm-section__title">Sunrise & Sunset</h3>
          <div class="wm-sun">
            <span class="wm-sun__time wm-sun__time--rise">${sunriseIcon()} ${sun.sunrise}</span>
            <div class="wm-sun__bar">
              <div class="wm-sun__track">
                <div class="wm-sun__dot" style="left:${pct}%"></div>
              </div>
            </div>
            <span class="wm-sun__time wm-sun__time--set">${sunsetIcon()} ${sun.sunset}</span>
          </div>
        </section>

        <!-- Run advice -->
        <section class="wm-section">
          <div class="wm-advice ${advClass}">
            <p class="wm-advice__title">${advice.message}</p>
            <p class="wm-advice__detail">${advice.detail}</p>
          </div>
        </section>

      </div><!-- /wm-body -->
    </div><!-- /wm-sheet -->
  </div><!-- /wm-overlay -->`;
}
// ── WeatherModal class ────────────────────────────────────────────────────────
export class WeatherModal {
    constructor() {
        Object.defineProperty(this, "_data", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_el", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_open", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        // Touch swipe-to-close state
        Object.defineProperty(this, "_touchStartY", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "_sheetStartY", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
    }
    /** Render + inject modal into DOM (call once) */
    mount(data) {
        this._data = data;
        document.getElementById(MODAL_ID + 'Overlay')?.remove();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildModal(data);
        const el = wrapper.firstElementChild;
        document.body.appendChild(el);
        this._el = el;
        this._bindEvents();
    }
    /** Update with new data (re-renders content) */
    update(data) {
        this._data = data;
        this.mount(data);
    }
    open() {
        if (!this._el)
            return;
        this._open = true;
        this._el.classList.add('wm-overlay--visible');
        document.body.style.overflow = 'hidden';
        // Animate sheet up
        requestAnimationFrame(() => {
            const sheet = this._el.querySelector('.wm-sheet');
            if (sheet)
                sheet.classList.add('wm-sheet--open');
        });
    }
    close() {
        if (!this._el || !this._open)
            return;
        this._open = false;
        const sheet = this._el.querySelector('.wm-sheet');
        if (sheet) {
            sheet.classList.remove('wm-sheet--open');
            sheet.style.transform = '';
        }
        setTimeout(() => {
            if (this._el)
                this._el.classList.remove('wm-overlay--visible');
            document.body.style.overflow = '';
        }, 320);
    }
    get isOpen() { return this._open; }
    _bindEvents() {
        const el = this._el;
        const sheet = el.querySelector('.wm-sheet');
        const handle = el.querySelector(`#${MODAL_ID}Handle`);
        // Close button
        el.querySelector(`#${MODAL_ID}Close`)?.addEventListener('click', () => this.close());
        // Click overlay backdrop to close
        el.addEventListener('click', e => {
            if (e.target === el)
                this.close();
        });
        // Escape key
        const onKey = (e) => { if (e.key === 'Escape')
            this.close(); };
        document.addEventListener('keydown', onKey);
        // Swipe down to close (on handle + sheet header)
        const startSwipe = (clientY) => {
            this._touchStartY = clientY;
            this._sheetStartY = 0;
        };
        const moveSwipe = (clientY) => {
            const delta = clientY - this._touchStartY;
            if (delta > 0) {
                sheet.style.transform = `translateY(${delta}px)`;
                sheet.style.transition = 'none';
            }
        };
        const endSwipe = (clientY) => {
            sheet.style.transition = '';
            const delta = clientY - this._touchStartY;
            if (delta > 100) {
                this.close();
            }
            else {
                sheet.style.transform = '';
            }
        };
        handle.addEventListener('touchstart', e => startSwipe(e.touches[0].clientY), { passive: true });
        handle.addEventListener('touchmove', e => moveSwipe(e.touches[0].clientY), { passive: true });
        handle.addEventListener('touchend', e => endSwipe(e.changedTouches[0].clientY));
        // Mouse drag on handle (desktop)
        handle.addEventListener('mousedown', e => {
            startSwipe(e.clientY);
            const onMove = (ev) => moveSwipe(ev.clientY);
            const onUp = (ev) => { endSwipe(ev.clientY); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
            document.addEventListener('mousemove', onMove);
            document.addEventListener('mouseup', onUp);
        });
    }
}
//# sourceMappingURL=WeatherModal.js.map