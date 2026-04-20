// ─── WEATHER MODAL ────────────────────────────────────────────────────────────
// Bottom-sheet modal with full weather data.
// Inject styles via WeatherStyles.ts or import weather.css.
import { uvLabel } from './WeatherService.js';
const MODAL_ID = 'weatherModal';
// ── Build HTML ────────────────────────────────────────────────────────────────
function buildModal(data) {
    const { current: c, sun, hourly, daily, advice, location } = data;
    const statsRows = [
        ['💨', 'Wind', `${c.windSpeed} km/h`],
        ['💧', 'Humidity', `${c.humidity}%`],
        ['🌫️', 'Visibility', `${c.visibility} km`],
        ['📉', 'Pressure', `${c.pressure} hPa`],
        ['🔆', 'UV Index', `${c.uvIndex} — ${uvLabel(c.uvIndex)}`],
        ['🌡️', 'Dew Point', `${c.dewPoint}°C`],
    ];
    const hourlyHTML = hourly.map(h => `
    <div class="wm-hourly__item">
      <span class="wm-hourly__time">${h.time}</span>
      <span class="wm-hourly__icon">${h.icon}</span>
      <span class="wm-hourly__temp">${h.temp}°</span>
    </div>`).join('');
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
          <span class="wm-header__wicon">${c.icon}</span>
          <span class="wm-header__temp">${c.temp}°C</span>
          <span class="wm-header__desc">${c.description} · Feels ${c.feelsLike}°</span>
        </div>
        <button class="wm-close" id="${MODAL_ID}Close" aria-label="Close weather">✕</button>
      </div>

      <!-- Scrollable body -->
      <div class="wm-body">

        <!-- Stats grid -->
        <section class="wm-section">
          <div class="wm-stats">
            ${statsRows.map(([icon, label, val]) => `
            <div class="wm-stats__row">
              <span class="wm-stats__icon">${icon}</span>
              <span class="wm-stats__label">${label}</span>
              <span class="wm-stats__value">${val}</span>
            </div>`).join('')}
          </div>
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
            <span class="wm-sun__time wm-sun__time--rise">🌅 ${sun.sunrise}</span>
            <div class="wm-sun__bar">
              <div class="wm-sun__track">
                <div class="wm-sun__dot" style="left:${pct}%"></div>
              </div>
            </div>
            <span class="wm-sun__time wm-sun__time--set">🌇 ${sun.sunset}</span>
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