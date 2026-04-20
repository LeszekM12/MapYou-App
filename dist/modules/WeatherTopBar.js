// ─── WEATHER TOP BAR ─────────────────────────────────────────────────────────
// Slim top bar: location | logo | weather summary
// Clicking it opens the WeatherModal.
const BAR_ID = 'weatherTopBar';
function buildBar(data) {
    const { current: c, location } = data;
    return `
  <div class="wtb" id="${BAR_ID}" role="button" tabindex="0" aria-label="Open weather details">
    <div class="wtb__left">
      <span class="wtb__pin">📍</span>
      <span class="wtb__location">${location}</span>
    </div>

    <div class="wtb__center">
      <svg viewBox="0 0 60 60" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M30 2C19 2 10 11 10 22C10 37 30 58 30 58C30 58 50 37 50 22C50 11 41 2 30 2Z" fill="url(#tbg1)"/>
        <circle cx="30" cy="18" r="5" fill="white"/>
        <line x1="30" y1="24" x2="19" y2="17" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="30" y1="24" x2="41" y2="17" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <line x1="30" y1="24" x2="30" y2="38" stroke="white" stroke-width="3.5" stroke-linecap="round"/>
        <defs>
          <linearGradient id="tbg1" x1="10" y1="2" x2="50" y2="58" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#4ade80"/>
            <stop offset="100%" stop-color="#16a34a"/>
          </linearGradient>
        </defs>
      </svg>
      <span class="wtb__brand">MapYou</span>
    </div>

    <div class="wtb__right">
      <span class="wtb__wicon">${c.icon}</span>
      <span class="wtb__temp">${c.temp}°C</span>
      <span class="wtb__desc">${c.description} · Feels ${c.feelsLike}°</span>
    </div>
  </div>`;
}
export class WeatherTopBar {
    constructor(modal) {
        Object.defineProperty(this, "_el", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_modal", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this._modal = modal;
    }
    /**
     * Mount the top bar into a container element.
     * @param container — the element to inject the bar into
     * @param data      — initial weather data
     */
    mount(container, data) {
        document.getElementById(BAR_ID)?.remove();
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildBar(data);
        const el = wrapper.firstElementChild;
        container.prepend(el);
        this._el = el;
        this._bindEvents();
    }
    /** Update displayed data without re-binding events */
    update(data) {
        if (!this._el)
            return;
        const loc = this._el.querySelector('.wtb__location');
        const icon = this._el.querySelector('.wtb__wicon');
        const temp = this._el.querySelector('.wtb__temp');
        const desc = this._el.querySelector('.wtb__desc');
        if (loc)
            loc.textContent = data.location;
        if (icon)
            icon.textContent = data.current.icon;
        if (temp)
            temp.textContent = `${data.current.temp}°C`;
        if (desc)
            desc.textContent = `${data.current.description} · Feels ${data.current.feelsLike}°`;
    }
    _bindEvents() {
        if (!this._el)
            return;
        const open = () => {
            if (this._modal.isOpen) {
                this._modal.close();
            }
            else {
                this._modal.open();
            }
        };
        this._el.addEventListener('click', open);
        this._el.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
    }
}
//# sourceMappingURL=WeatherTopBar.js.map