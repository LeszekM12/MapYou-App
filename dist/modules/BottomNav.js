// ─── BOTTOM NAV — 3-tab system ───────────────────────────────────────────────
import { qidSafe } from '../utils/dom.js';
export class BottomNav {
    constructor(onTabChange) {
        Object.defineProperty(this, "activeTab", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 'tabMap'
        });
        Object.defineProperty(this, "routeActive", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "searchBar", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "onTabChange", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.searchBar = qidSafe('mapSearchBar');
        this.onTabChange = onTabChange;
    }
    getActiveTab() { return this.activeTab; }
    switchTab(tabId) {
        if (tabId === this.activeTab) {
            // Collapse / expand same tab
            const scroll = document.querySelector(`#${tabId} .tab-scroll`);
            if (scroll)
                scroll.classList.toggle('tab-scroll--collapsed');
            return;
        }
        // Deactivate old
        qidSafe(this.activeTab)?.classList.remove('tab-panel--active');
        document.querySelector(`.bottom-nav__item[data-tab="${this.activeTab}"]`)
            ?.classList.remove('bottom-nav__item--active');
        this.activeTab = tabId;
        // Activate new
        qidSafe(this.activeTab)?.classList.add('tab-panel--active');
        document.querySelector(`.bottom-nav__item[data-tab="${this.activeTab}"]`)
            ?.classList.add('bottom-nav__item--active');
        // Reset collapse
        document.querySelector(`#${this.activeTab} .tab-scroll`)
            ?.classList.remove('tab-scroll--collapsed');
        // Search bar
        if (this.activeTab === 'tabMap') {
            if (!this.routeActive)
                this.showSearch();
        }
        else {
            this.hideSearchTab();
        }
        this.onTabChange(tabId);
    }
    onRoutingStart() {
        this.routeActive = true;
        this.hideSearchRoute();
        if (this.activeTab !== 'tabMap')
            this.switchTab('tabMap');
    }
    onRoutingCancel() {
        this.routeActive = false;
        if (this.activeTab === 'tabMap')
            this.showSearch();
    }
    showSearch() {
        if (!this.searchBar)
            return;
        this.searchBar.classList.remove('msb--hidden-tab', 'msb--hidden-route');
        this.searchBar.classList.add('msb--visible');
    }
    hideSearchTab() {
        if (!this.searchBar)
            return;
        this.searchBar.classList.add('msb--hidden-tab');
        this.searchBar.classList.remove('msb--visible', 'msb--hidden-route');
    }
    hideSearchRoute() {
        if (!this.searchBar)
            return;
        this.searchBar.classList.add('msb--hidden-route');
        this.searchBar.classList.remove('msb--visible');
    }
    /** Wire up nav buttons */
    init() {
        document.querySelectorAll('.bottom-nav__item').forEach(btn => {
            btn.addEventListener('click', () => this.switchTab(btn.dataset.tab));
        });
        this.hideSearchTab(); // initial state
    }
}
//# sourceMappingURL=BottomNav.js.map