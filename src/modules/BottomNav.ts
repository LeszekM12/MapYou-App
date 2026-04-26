// ─── BOTTOM NAV — 3-tab system ───────────────────────────────────────────────
import { qidSafe } from '../utils/dom.js';

export type TabId = 'tabHome' | 'tabMap' | 'tabTracker' | 'tabStats' | 'tabFriends';

type OnTabChange = (tab: TabId) => void;

export class BottomNav {
  private activeTab:   TabId   = 'tabMap';
  private routeActive: boolean = false;
  private searchBar:   HTMLElement | null;
  private onTabChange: OnTabChange;

  constructor(onTabChange: OnTabChange) {
    this.searchBar  = qidSafe('mapSearchBar');
    this.onTabChange = onTabChange;
  }

  getActiveTab(): TabId { return this.activeTab; }

  switchTab(tabId: TabId): void {
    if (tabId === this.activeTab) {
      // Collapse / expand same tab
      const scroll = document.querySelector<HTMLElement>(`#${tabId} .tab-scroll`);
      if (scroll) scroll.classList.toggle('tab-scroll--collapsed');
      return;
    }

    // Deactivate old
    qidSafe(this.activeTab)?.classList.remove('tab-panel--active');
    document.querySelector<HTMLElement>(`.bottom-nav__item[data-tab="${this.activeTab}"]`)
      ?.classList.remove('bottom-nav__item--active');

    this.activeTab = tabId;

    // Activate new
    qidSafe(this.activeTab)?.classList.add('tab-panel--active');
    document.querySelector<HTMLElement>(`.bottom-nav__item[data-tab="${this.activeTab}"]`)
      ?.classList.add('bottom-nav__item--active');

    // Reset collapse
    document.querySelector<HTMLElement>(`#${this.activeTab} .tab-scroll`)
      ?.classList.remove('tab-scroll--collapsed');

    // Search bar
    if (this.activeTab === 'tabMap') {
      if (!this.routeActive) this.showSearch();
    } else {
      this.hideSearchTab();
    }

    this.onTabChange(tabId);
  }

  onRoutingStart(): void {
    this.routeActive = true;
    this.hideSearchRoute();
    if (this.activeTab !== 'tabMap') this.switchTab('tabMap');
  }

  onRoutingCancel(): void {
    this.routeActive = false;
    if (this.activeTab === 'tabMap') this.showSearch();
  }

  private showSearch(): void {
    if (!this.searchBar) return;
    this.searchBar.classList.remove('msb--hidden-tab', 'msb--hidden-route');
    this.searchBar.classList.add('msb--visible');
  }
  private hideSearchTab(): void {
    if (!this.searchBar) return;
    this.searchBar.classList.add('msb--hidden-tab');
    this.searchBar.classList.remove('msb--visible', 'msb--hidden-route');
  }
  private hideSearchRoute(): void {
    if (!this.searchBar) return;
    this.searchBar.classList.add('msb--hidden-route');
    this.searchBar.classList.remove('msb--visible');
  }

  /** Wire up nav buttons */
  init(): void {
    document.querySelectorAll<HTMLElement>('.bottom-nav__item').forEach(btn => {
      btn.addEventListener('click', () => this.switchTab(btn.dataset.tab as TabId));
    });
    this.hideSearchTab(); // initial state
  }
}
