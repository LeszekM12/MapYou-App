// ─── SHARED SPORT PICKER ──────────────────────────────────────────────────────
// Categorized + searchable sport picker used by both the Track tab and the
// Save Activity modal. Opens a bottom-sheet overlay and calls onSelect(key).

import { getAllSports, getCustomSports, saveCustomSport, deleteCustomSport, isTrackable } from './Tracker.js';

export function openSportPicker(onSelect: (sport: string) => void): void {
  document.getElementById('trkSportPickerOverlay')?.remove();
  const overlay = document.createElement('div');
  overlay.id = 'trkSportPickerOverlay';
  overlay.className = 'trk-picker-overlay';

  const render = (filter = ''): void => {
    const customs = getCustomSports();
    const all = getAllSports();
    const f = filter.trim().toLowerCase();
    const match = (label: string): boolean => !f || label.toLowerCase().includes(f);

    const cats: Record<string, { key: string; icon: string; label: string }[]> = {};
    all.forEach(s => {
      const cat = (s as { category?: string }).category ?? 'Custom';
      if (!match(s.label)) return;
      (cats[cat] ??= []).push(s);
    });

    let body = '';
    for (const [cat, sports] of Object.entries(cats)) {
      if (!sports.length) continue;
      body += `<div class="trk-picker__cat">${cat}</div>`;
      sports.forEach(s => {
        const isCustom = customs.find(c => c.key === s.key);
        body += `<button class="trk-picker__item" data-pick="${s.key}">
          <span class="trk-picker__item-icon">${s.icon}</span>
          <span class="trk-picker__item-label">${s.label}</span>
          ${isTrackable(s.key) ? '<span class="trk-picker__item-tag">📍</span>' : '<span class="trk-picker__item-tag">⏱</span>'}
          ${isCustom ? `<span class="trk-picker__item-del" data-del="${s.key}">×</span>` : ''}
        </button>`;
      });
    }
    if (!body) body = '<p class="trk-picker__empty">No sports found</p>';

    overlay.innerHTML = `<div class="trk-picker">
      <div class="trk-picker__head">
        <span class="trk-picker__title">Choose sport</span>
        <button class="trk-picker__close" id="trkPickClose">✕</button>
      </div>
      <div class="trk-picker__search-wrap">
        <input class="trk-picker__search" id="trkPickSearch" placeholder="🔍  Search" value="${filter}"/>
      </div>
      <div class="trk-picker__list">
        ${body}
        <button class="trk-picker__add" id="trkPickAdd">➕ Add custom sport</button>
      </div>
    </div>`;

    overlay.querySelector('#trkPickClose')?.addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    const search = overlay.querySelector<HTMLInputElement>('#trkPickSearch');
    search?.addEventListener('input', () => { const v = search.value; render(v); overlay.querySelector<HTMLInputElement>('#trkPickSearch')?.focus(); });

    overlay.querySelectorAll<HTMLElement>('.trk-picker__item').forEach(btn => {
      btn.addEventListener('click', e => {
        if ((e.target as HTMLElement).hasAttribute('data-del')) return;
        overlay.remove();
        onSelect(btn.dataset.pick!);
      });
    });
    overlay.querySelectorAll<HTMLElement>('[data-del]').forEach(del => {
      del.addEventListener('click', e => {
        e.stopPropagation();
        deleteCustomSport(del.dataset.del!);
        render(filter);
      });
    });
    overlay.querySelector('#trkPickAdd')?.addEventListener('click', () => {
      const name = prompt('Sport name:')?.trim();
      if (!name) return;
      const sport = saveCustomSport(name);
      overlay.remove();
      onSelect(sport.key);
    });
  };

  render();
  document.body.appendChild(overlay);
}
