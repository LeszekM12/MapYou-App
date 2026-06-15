// ─── SAVE ACTIVITY MODAL ─────────────────────────────────────────────────────
// src/modules/SaveActivityModal.ts
//
// Bottom-sheet modal shown after clicking Finish.
// User fills in name, description, photo, intensity, notes.
// On save → writes EnrichedActivity to IndexedDB → triggers Home refresh.
import { SPORT_COLORS, SPORT_ICONS, getIcon, getColor, getSportLabel, getAllSports, saveCustomSport, deleteCustomSport, getCustomSports } from './Tracker.js';
import { CS, uploadMediaFile } from './cloudSync.js';
import { getJoinedClubs } from './SearchView.js';
// ── Helpers ───────────────────────────────────────────────────────────────────
function blobToDataUrl(blob) {
    return new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(r.result);
        r.onerror = rej;
        r.readAsDataURL(blob);
    });
}
async function captureMapPreview(coords, sport) {
    if (coords.length < 2)
        return null;
    try {
        const container = document.createElement('div');
        container.style.cssText = 'width:600px;height:300px;position:absolute;left:-9999px;top:-9999px;';
        document.body.appendChild(container);
        const color = SPORT_COLORS[sport] ?? '#00c46a';
        const map = L.map(container, {
            zoomControl: false, dragging: false, scrollWheelZoom: false,
            attributionControl: false, touchZoom: false,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(map);
        const line = L.polyline(coords.map(c => L.latLng(c[0], c[1])), {
            color, weight: 5, opacity: 0.95,
        }).addTo(map);
        map.fitBounds(line.getBounds(), { padding: [30, 30] });
        // Wait for tiles to load
        await new Promise(r => setTimeout(r, 1500));
        map.remove();
        document.body.removeChild(container);
        return null; // canvas capture not available without leaflet-image plugin
    }
    catch {
        return null;
    }
}
// ── Modal HTML builder ────────────────────────────────────────────────────────
function buildModalHtml(activity, isManual) {
    const color = SPORT_COLORS[activity.sport] ?? '#00c46a';
    const icon = SPORT_ICONS[activity.sport] ?? '🏅';
    return `
  <div class="sam-overlay" id="saveActivityOverlay" role="dialog" aria-modal="true" aria-label="Save Activity">
    <div class="sam-sheet" id="saveActivitySheet">

      <div class="sam-handle" id="saveActivityHandle"></div>

      <!-- Header -->
      <div class="sam-header" style="--act-color:${color}">
        <div class="sam-header__icon">${icon}</div>
        <div class="sam-header__info">
          <span class="sam-header__type">${activity.sport.charAt(0).toUpperCase() + activity.sport.slice(1)}</span>
          <span class="sam-header__hint">Save your activity</span>
        </div>
        <button class="sam-close" id="saveActivityClose" aria-label="Close">✕</button>
      </div>

      <!-- Body -->
      <div class="sam-body">

        <!-- Name -->
        <div class="sam-field">
          <label class="sam-label" for="samName">Activity Name</label>
          <input
            class="sam-input" id="samName" type="text"
            placeholder="${icon} ${activity.sport.charAt(0).toUpperCase() + activity.sport.slice(1)} on ${new Date(activity.date).toLocaleDateString('en', { month: 'short', day: 'numeric' })}"
            maxlength="20" autocomplete="off"
          />
        </div>

        <!-- Description -->
        <div class="sam-field">
          <label class="sam-label" for="samDesc">
            Description
            <span class="sam-char-count" id="samDescCount">0/300</span>
          </label>
          <textarea class="sam-textarea" id="samDesc" placeholder="How did it go? Share your story..." rows="3" maxlength="300"></textarea>
        </div>

        <!-- Photo / video upload -->
        <div class="sam-field">
          <label class="sam-label">Photo / Video</label>
          <label class="sam-photo-zone" id="samPhotoZone" for="samPhotoInput">
            <input type="file" accept="image/*,video/*" id="samPhotoInput" class="sam-photo-input"/>
            <div class="sam-photo-placeholder" id="samPhotoPlaceholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21,15 16,10 5,21"/></svg>
              <span>Tap to add photo or video</span>
            </div>
            <img class="sam-photo-preview hidden" id="samPhotoPreview" alt="Preview"/>
            <video class="sam-photo-preview hidden" id="samVideoPreview" playsinline muted controls preload="metadata"></video>
          </label>
          <span class="sam-media-hint">Max 10 MB for photos · 500 MB for videos</span>
        </div>

        <!-- Activity type -->
        <div class="sam-field">
          <label class="sam-label">Activity Type</label>
          <div class="sam-sport-btns" id="samSportBtns">
            ${['running', 'walking', 'cycling'].map(s => `
              <button class="sam-sport-btn${s === activity.sport ? ' sam-sport-btn--active' : ''}"
                data-sport="${s}"
                style="${s === activity.sport ? `--sb-color:${SPORT_COLORS[s]}` : ''}">
                ${SPORT_ICONS[s]} ${s.charAt(0).toUpperCase() + s.slice(1)}
              </button>`).join('')}
            <button class="sam-sport-btn sam-sport-btn--more" id="samSportMore">••• More</button>
          </div>
        </div>

        <!-- Activity Stats — only for manual (no GPS data) -->
        ${isManual ? `
        <div class="sam-field">
          <label class="sam-label">Activity Stats</label>
          <div class="sam-stats-grid">
            <div class="sam-stats-row">
              <label class="sam-stats-label">📅 Date</label>
              <input class="sam-stats-input" id="samStatDate" type="date"
                value="${new Date().toISOString().slice(0, 10)}"/>
            </div>
            <div class="sam-stats-row">
              <label class="sam-stats-label">🕐 Start time</label>
              <input class="sam-stats-input" id="samStatTime" type="time"
                value="${new Date().toTimeString().slice(0, 5)}"/>
            </div>
            <div class="sam-stats-row">
              <label class="sam-stats-label">⏱ Duration</label>
              <div class="sam-stats-duration">
                <input class="sam-stats-input sam-stats-input--sm" id="samStatDurH" type="number" min="0" max="23" placeholder="0" value="0"/>
                <span class="sam-stats-sep">h</span>
                <input class="sam-stats-input sam-stats-input--sm" id="samStatDurM" type="number" min="0" max="59" placeholder="0" value="0"/>
                <span class="sam-stats-sep">min</span>
              </div>
            </div>
            <div class="sam-stats-row">
              <label class="sam-stats-label">📏 Distance</label>
              <div class="sam-stats-dist">
                <input class="sam-stats-input sam-stats-input--md" id="samStatDist" type="number" min="0" step="0.01" placeholder="0.00"/>
                <span class="sam-stats-sep">km</span>
              </div>
            </div>
            <div class="sam-stats-row">
              <label class="sam-stats-label">⚡ Pace</label>
              <div class="sam-stats-pace" id="samPaceDisplay">—:— min/km</div>
            </div>
          </div>
        </div>` : ''}

        <!-- Intensity -->
        <div class="sam-field">
          <label class="sam-label">Intensity <span class="sam-intensity-label" id="samIntensityLabel">Moderate</span></label>
          <div class="sam-intensity-track">
            <input type="range" class="sam-intensity-slider" id="samIntensity" min="1" max="5" value="3"/>
            <div class="sam-intensity-dots">
              ${[1, 2, 3, 4, 5].map(i => `<span class="sam-idot" data-i="${i}"></span>`).join('')}
            </div>
          </div>
          <div class="sam-intensity-labels">
            <span>Easy</span><span>Max</span>
          </div>
        </div>

        <!-- Visibility -->
        <div class="sam-field">
          <label class="sam-label">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Visibility
          </label>
          <div class="sam-vis-btns" id="samVisBtns">
            <button class="sam-vis-btn sam-vis-btn--active" data-vis="everyone">🌐 Everyone</button>
            <button class="sam-vis-btn" data-vis="friends">👥 Friends</button>
            <button class="sam-vis-btn" data-vis="only_me">🔒 Only you</button>
          </div>
        </div>

        <!-- Mute activity -->
        <div class="sam-field">
          <label class="sam-mute-row" for="samMute">
            <input type="checkbox" id="samMute" class="sam-mute-check"/>
            <span class="sam-mute-text">
              <span class="sam-mute-title">🔕 Mute activity</span>
              <span class="sam-mute-sub">Don't publish in the main feed or club feeds (still saved to your stats &amp; history)</span>
            </span>
          </label>
        </div>

        <!-- Private notes -->
        <div class="sam-field">
          <label class="sam-label" for="samNotes">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            Private Notes
          </label>
          <textarea class="sam-textarea sam-textarea--sm" id="samNotes" placeholder="Personal thoughts, pain, weather notes... (only you can see this)" rows="2" maxlength="500"></textarea>
        </div>

        <!-- Mini map preview -->
        <div class="sam-field">
          <label class="sam-label">Route Preview</label>
          <div class="sam-map-preview" id="samMapPreview"></div>
        </div>

      </div><!-- /sam-body -->

      <div id="samShareClubs"></div>

      <!-- Footer -->
      <div class="sam-footer">
        <button class="sam-btn sam-btn--cancel" id="samBtnCancel">Cancel</button>
        <button class="sam-btn sam-btn--save" id="samBtnSave" style="background:${color}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="16" height="16"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
          Save Activity
        </button>
      </div>

    </div>
  </div>`;
}
// ── SaveActivityModal class ───────────────────────────────────────────────────
export class SaveActivityModal {
    _openSportPicker(onSelect) {
        document.getElementById('samSportPickerOverlay')?.remove();
        const overlay = document.createElement('div');
        overlay.id = 'samSportPickerOverlay';
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9999;display:flex;align-items:flex-end;justify-content:center';
        const renderPicker = () => {
            const customs = getCustomSports();
            const all = getAllSports();
            overlay.innerHTML = '<div style="background:#1a1d24;border-radius:20px 20px 0 0;width:100%;max-width:480px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">'
                + '<div style="display:flex;align-items:center;justify-content:space-between;padding:16px 20px;border-bottom:1px solid rgba(255,255,255,0.08)">'
                + '<span style="color:#fff;font-size:1.6rem;font-weight:700">Choose sport</span>'
                + '<button id="samPickerClose" style="background:none;border:none;color:rgba(255,255,255,0.5);font-size:2rem;cursor:pointer;line-height:1">✕</button>'
                + '</div>'
                + '<div style="overflow-y:auto;padding:12px 16px 24px;display:grid;grid-template-columns:repeat(3,1fr);gap:10px">'
                + all.map(s => '<button data-pick="' + s.key + '" style="background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1);border-radius:12px;padding:12px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px;position:relative">'
                    + '<span style="font-size:2rem">' + s.icon + '</span>'
                    + '<span style="color:#fff;font-size:1.2rem;font-weight:600;text-align:center">' + s.label + '</span>'
                    + (customs.find(c => c.key === s.key) ? '<button data-delete-sport="' + s.key + '" style="position:absolute;top:4px;right:4px;background:none;border:none;color:rgba(255,255,255,0.25);font-size:1rem;cursor:pointer;padding:2px">×</button>' : '')
                    + '</button>').join('')
                + '<button id="samAddCustomSport" style="background:rgba(255,255,255,0.04);border:1.5px dashed rgba(255,255,255,0.15);border-radius:12px;padding:12px 8px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px">'
                + '<span style="font-size:2rem">➕</span>'
                + '<span style="color:rgba(255,255,255,0.5);font-size:1.2rem;font-weight:600">Add custom</span>'
                + '</button>'
                + '</div></div>';
            overlay.querySelector('#samPickerClose')?.addEventListener('click', () => overlay.remove());
            overlay.addEventListener('click', e => { if (e.target === overlay)
                overlay.remove(); });
            overlay.querySelectorAll('[data-pick]').forEach(btn => {
                btn.addEventListener('click', e => {
                    if (e.target.hasAttribute('data-delete-sport'))
                        return;
                    overlay.remove();
                    onSelect(btn.dataset.pick);
                });
            });
            overlay.querySelectorAll('[data-delete-sport]').forEach(btn => {
                btn.addEventListener('click', e => {
                    e.stopPropagation();
                    deleteCustomSport(btn.dataset.deleteSport);
                    renderPicker();
                });
            });
            overlay.querySelector('#samAddCustomSport')?.addEventListener('click', () => {
                const name = prompt('Enter sport name:')?.trim();
                if (!name)
                    return;
                const sport = saveCustomSport(name);
                overlay.remove();
                onSelect(sport.key);
            });
        };
        renderPicker();
        document.body.appendChild(overlay);
    }
    constructor(_activity, _onSave, _onCancel) {
        Object.defineProperty(this, "_activity", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: _activity
        });
        Object.defineProperty(this, "_onSave", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: _onSave
        });
        Object.defineProperty(this, "_onCancel", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: _onCancel
        });
        Object.defineProperty(this, "_el", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_touchStartY", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "_selectedSport", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "_photoBlob", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_photoIsVideo", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_photoUrl", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_pickedCoords", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        this._selectedSport = _activity.sport;
    }
    open() {
        document.getElementById('saveActivityOverlay')?.remove();
        const wrapper = document.createElement('div');
        const isManual = this._activity.coords.length === 0;
        wrapper.innerHTML = buildModalHtml(this._activity, isManual);
        const el = wrapper.firstElementChild;
        document.body.appendChild(el);
        this._el = el;
        requestAnimationFrame(() => {
            el.classList.add('sam-overlay--visible');
            setTimeout(() => el.querySelector('.sam-sheet')?.classList.add('sam-sheet--open'), 10);
        });
        this._bindEvents();
        this._initMiniMap();
        this._renderShareClubs();
    }
    _renderShareClubs() {
        const wrap = document.getElementById('samShareClubs');
        if (!wrap)
            return;
        const clubs = getJoinedClubs();
        if (clubs.length === 0)
            return;
        wrap.innerHTML = `
      <div class="sam-share-clubs__inner">
        <div class="sam-share-clubs__title">Share to club</div>
        ${clubs.map(c => `
          <label class="sam-share-clubs__item">
            <input type="checkbox" class="sam-club-check" data-club-id="${c.id}" data-club-name="${c.name}"/>
            <span class="sam-share-clubs__check-icon"></span>
            <span class="sam-share-clubs__name">${c.name}</span>
          </label>`).join('')}
      </div>`;
    }
    close(saved = false) {
        if (!this._el)
            return;
        const sheet = this._el.querySelector('.sam-sheet');
        sheet?.classList.remove('sam-sheet--open');
        this._el.classList.remove('sam-overlay--visible');
        setTimeout(() => { this._el?.remove(); this._el = null; }, 350);
        if (!saved)
            this._onCancel?.();
    }
    _initMiniMap() {
        const container = document.getElementById('samMapPreview');
        if (!container)
            return;
        const coords = this._activity.coords;
        const isManual = coords.length === 0;
        const color = SPORT_COLORS[this._activity.sport] ?? '#00c46a';
        setTimeout(() => {
            if (isManual) {
                // Interactive map — user clicks to place a pin
                container.style.cursor = 'crosshair';
                const hint = document.createElement('div');
                hint.className = 'sam-map-hint';
                hint.textContent = '📍 Tap map to set location';
                container.appendChild(hint);
                // Get last known coords for initial view
                let initCoords = [52.237, 21.017];
                try {
                    const raw = localStorage.getItem('mapty_last_coords') ?? localStorage.getItem('mapty_ip_coords');
                    if (raw) {
                        const parsed = JSON.parse(raw);
                        if (Array.isArray(parsed) && parsed.length === 2)
                            initCoords = parsed;
                        else if (parsed?.coords)
                            initCoords = parsed.coords;
                    }
                }
                catch { }
                const map = L.map(container, {
                    zoomControl: true, dragging: true, touchZoom: true,
                    scrollWheelZoom: true, doubleClickZoom: false,
                    attributionControl: false,
                });
                L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(map);
                map.setView(initCoords, 13);
                let marker = null;
                const pinIcon = L.divIcon({
                    className: '',
                    html: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="28" height="42">
            <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 24 12 24s12-15 12-24C24 5.4 18.6 0 12 0z"
              fill="${color}" stroke="white" stroke-width="1.5"/>
            <circle cx="12" cy="12" r="5" fill="white"/>
          </svg>`,
                    iconSize: [28, 42],
                    iconAnchor: [14, 42],
                });
                map.on('click', (e) => {
                    const { lat, lng } = e.latlng;
                    this._pickedCoords = [lat, lng];
                    if (marker)
                        marker.setLatLng([lat, lng]);
                    else
                        marker = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
                    hint.style.display = 'none';
                });
            }
            else if (coords.length >= 2) {
                // GPS route — static map
                const map = L.map(container, {
                    zoomControl: false, dragging: false, touchZoom: false,
                    scrollWheelZoom: false, doubleClickZoom: false,
                    boxZoom: false, keyboard: false, attributionControl: false,
                });
                L.tileLayer('https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png').addTo(map);
                const line = L.polyline(coords.map(c => L.latLng(c[0], c[1])), {
                    color, weight: 4, opacity: 0.95,
                }).addTo(map);
                map.fitBounds(line.getBounds(), { padding: [20, 20] });
                const first = coords[0], last = coords[coords.length - 1];
                L.circleMarker([first[0], first[1]], { radius: 5, color: '#fff', fillColor: color, fillOpacity: 1, weight: 2 }).addTo(map);
                L.circleMarker([last[0], last[1]], { radius: 5, color: '#fff', fillColor: '#e74c3c', fillOpacity: 1, weight: 2 }).addTo(map);
            }
        }, 200);
    }
    _bindEvents() {
        const el = this._el;
        // Close
        el.querySelector('#saveActivityClose')?.addEventListener('click', () => this.close());
        el.querySelector('#samBtnCancel')?.addEventListener('click', () => this.close());
        el.addEventListener('click', e => { if (e.target === el)
            this.close(); });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape')
            this.close(); }, { once: true });
        // Sport buttons
        const updateSportBtn = (sport) => {
            el.querySelectorAll('.sam-sport-btn').forEach(b => {
                b.classList.remove('sam-sport-btn--active');
                b.style.removeProperty('--sb-color');
            });
            this._selectedSport = sport;
            // Find existing btn or update "More" btn
            const existing = el.querySelector(`[data-sport="${sport}"]`);
            if (existing) {
                existing.classList.add('sam-sport-btn--active');
                existing.style.setProperty('--sb-color', getColor(sport));
            }
            else {
                const moreBtn = el.querySelector('#samSportMore');
                if (moreBtn) {
                    moreBtn.classList.add('sam-sport-btn--active');
                    moreBtn.style.setProperty('--sb-color', '#ffffff');
                    moreBtn.textContent = getIcon(sport) + ' ' + getSportLabel(sport);
                }
            }
        };
        el.querySelectorAll('.sam-sport-btn:not(#samSportMore)').forEach(btn => {
            btn.addEventListener('click', () => updateSportBtn(btn.dataset.sport));
        });
        // Visibility buttons — single select
        el.querySelectorAll('.sam-vis-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                el.querySelectorAll('.sam-vis-btn').forEach(b => b.classList.remove('sam-vis-btn--active'));
                btn.classList.add('sam-vis-btn--active');
            });
        });
        el.querySelector('#samSportMore')?.addEventListener('click', () => {
            this._openSportPicker(sport => updateSportBtn(sport));
        });
        // Intensity slider
        const slider = el.querySelector('#samIntensity');
        const label = el.querySelector('#samIntensityLabel');
        const dots = el.querySelectorAll('.sam-idot');
        const labels = ['', 'Easy', 'Moderate', 'Hard', 'Very Hard', 'Max Effort'];
        const colors = ['', '#4ade80', '#facc15', '#fb923c', '#f87171', '#ef4444'];
        const updateIntensity = () => {
            const v = Number(slider?.value ?? 3);
            if (label) {
                label.textContent = labels[v];
                label.style.color = colors[v];
            }
            dots.forEach((d, i) => {
                d.style.background = i < v ? colors[v] : 'rgba(255,255,255,0.15)';
            });
        };
        slider?.addEventListener('input', updateIntensity);
        updateIntensity();
        // Photo upload
        const photoInput = el.querySelector('#samPhotoInput');
        const photoZone = el.querySelector('#samPhotoZone');
        const preview = el.querySelector('#samPhotoPreview');
        const placeholder = el.querySelector('#samPhotoPlaceholder');
        const videoPreview = el.querySelector('#samVideoPreview');
        photoInput?.addEventListener('change', () => {
            const file = photoInput.files?.[0];
            if (!file)
                return;
            const isVid = file.type.startsWith('video/');
            const MAX_IMAGE = 10 * 1024 * 1024; // 10 MB
            const MAX_VIDEO = 500 * 1024 * 1024; // 500 MB
            if (!isVid && file.size > MAX_IMAGE) {
                alert(`Photo too large. Max 10 MB (your file: ${(file.size / 1024 / 1024).toFixed(1)} MB)`);
                photoInput.value = '';
                return;
            }
            if (isVid && file.size > MAX_VIDEO) {
                alert(`Video too large. Max 500 MB (your file: ${(file.size / 1024 / 1024).toFixed(0)} MB)`);
                photoInput.value = '';
                return;
            }
            this._photoBlob = file;
            this._photoIsVideo = isVid;
            const url = URL.createObjectURL(file);
            this._photoUrl = url;
            if (isVid) {
                preview?.classList.add('hidden');
                if (videoPreview) {
                    videoPreview.src = url;
                    videoPreview.classList.remove('hidden');
                }
            }
            else {
                videoPreview?.classList.add('hidden');
                if (preview) {
                    preview.src = url;
                    preview.classList.remove('hidden');
                }
            }
            if (placeholder)
                placeholder.classList.add('hidden');
            photoZone?.classList.add('sam-photo-zone--filled');
        });
        // Desc char counter
        const samDescEl = el.querySelector('#samDesc');
        const samDescCount = el.querySelector('#samDescCount');
        samDescEl?.addEventListener('input', () => {
            if (samDescCount)
                samDescCount.textContent = `${samDescEl.value.length}/300`;
        });
        // Save
        el.querySelector('#samBtnSave')?.addEventListener('click', () => void this._save());
        // Activity Stats — auto-calculate pace when duration or distance changes
        const updatePace = () => {
            const durH = parseFloat((el.querySelector('#samStatDurH')?.value ?? '0')) || 0;
            const durM = parseFloat((el.querySelector('#samStatDurM')?.value ?? '0')) || 0;
            const dist = parseFloat((el.querySelector('#samStatDist')?.value ?? '0')) || 0;
            const paceEl = el.querySelector('#samPaceDisplay');
            if (!paceEl)
                return;
            const totalMin = durH * 60 + durM;
            if (dist > 0 && totalMin > 0) {
                const pace = totalMin / dist;
                const pm = Math.floor(pace);
                const ps = Math.round((pace - pm) * 60);
                paceEl.textContent = `${pm}:${String(ps).padStart(2, '0')} min/km`;
                paceEl.style.color = '#00c46a';
            }
            else {
                paceEl.textContent = '—:— min/km';
                paceEl.style.color = '';
            }
        };
        el.querySelector('#samStatDurH')?.addEventListener('input', updatePace);
        el.querySelector('#samStatDurM')?.addEventListener('input', updatePace);
        el.querySelector('#samStatDist')?.addEventListener('input', updatePace);
        // Swipe to close
        const handle = el.querySelector('#saveActivityHandle');
        const sheet = el.querySelector('.sam-sheet');
        handle.addEventListener('touchstart', e => { this._touchStartY = e.touches[0].clientY; }, { passive: true });
        handle.addEventListener('touchmove', e => {
            const d = e.touches[0].clientY - this._touchStartY;
            if (d > 0) {
                sheet.style.transition = 'none';
                sheet.style.transform = `translateY(${d}px)`;
            }
        }, { passive: true });
        handle.addEventListener('touchend', e => {
            sheet.style.transition = '';
            if (e.changedTouches[0].clientY - this._touchStartY > 100)
                this.close();
            else
                sheet.style.transform = '';
        });
    }
    async _save() {
        const el = this._el;
        if (!el)
            return;
        const btn = el.querySelector('#samBtnSave');
        btn.disabled = true;
        btn.innerHTML = `
      <span style="display:flex;align-items:center;justify-content:center;gap:8px">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="animation:pm-spin 0.8s linear infinite">
          <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
          <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
        </svg>
        <span>${this._photoBlob && this._photoIsVideo ? 'Compressing…' : 'Saving…'}</span>
      </span>`;
        if (!document.querySelector('#pm-spin-style')) {
            const s = document.createElement('style');
            s.id = 'pm-spin-style';
            s.textContent = '@keyframes pm-spin{to{transform:rotate(360deg)}}';
            document.head.appendChild(s);
        }
        const nameInput = el.querySelector('#samName');
        const descInput = el.querySelector('#samDesc');
        const notesInput = el.querySelector('#samNotes');
        const slider = el.querySelector('#samIntensity');
        const name = nameInput?.value.trim() || this._activity.description;
        const description = descInput?.value.trim() || '';
        const notes = notesInput?.value.trim() || '';
        const intensity = Number(slider?.value ?? 3);
        // Visibility + mute
        const visBtn = el.querySelector('.sam-vis-btn--active');
        const visibility = visBtn?.dataset.vis || 'everyone';
        const muted = el.querySelector('#samMute')?.checked ?? false;
        // Manual activity stats
        const isManual = this._activity.coords.length === 0;
        let manualDate = this._activity.date;
        let manualDistKm = this._activity.distanceKm;
        let manualDurSec = this._activity.durationSec;
        let manualPaceMinKm = this._activity.paceMinKm;
        if (isManual) {
            const dateVal = el.querySelector('#samStatDate')?.value ?? '';
            const timeVal = el.querySelector('#samStatTime')?.value ?? '00:00';
            const durH = parseFloat(el.querySelector('#samStatDurH')?.value ?? '0') || 0;
            const durM = parseFloat(el.querySelector('#samStatDurM')?.value ?? '0') || 0;
            const dist = parseFloat(el.querySelector('#samStatDist')?.value ?? '0') || 0;
            if (dateVal)
                manualDate = new Date(`${dateVal}T${timeVal}:00`).toISOString();
            manualDistKm = dist;
            manualDurSec = Math.round((durH * 60 + durM) * 60);
            manualPaceMinKm = dist > 0 && manualDurSec > 0 ? (manualDurSec / 60) / dist : 0;
        }
        let photoUrl = null;
        let mediaType = null;
        let photoPublicId = null;
        if (this._photoBlob) {
            const userId = localStorage.getItem('mapyou_userId_profile') ?? '';
            const isVid = this._photoIsVideo;
            try {
                const up = await uploadMediaFile(this._photoBlob, userId, 'activities', undefined, (pct, phase) => {
                    if (phase === 'uploading') {
                        btn.innerHTML = `
                <span style="display:flex;align-items:center;justify-content:center;gap:8px">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="animation:pm-spin 0.8s linear infinite">
                    <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
                    <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
                  </svg>
                  <span>Uploading ${pct}%</span>
                </span>`;
                    }
                    else {
                        btn.innerHTML = `
                <span style="display:flex;align-items:center;justify-content:center;gap:8px">
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style="animation:pm-spin 0.8s linear infinite">
                    <circle cx="8" cy="8" r="6" stroke="rgba(255,255,255,0.3)" stroke-width="2.5"/>
                    <path d="M8 2a6 6 0 0 1 6 6" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/>
                  </svg>
                  <span>${isVid ? 'Compressing…' : 'Processing…'}</span>
                </span>`;
                    }
                });
                if (up) {
                    photoUrl = up.url;
                    mediaType = up.mediaType;
                    photoPublicId = up.publicId;
                }
                else {
                    photoUrl = await blobToDataUrl(this._photoBlob);
                }
            }
            catch {
                photoUrl = await blobToDataUrl(this._photoBlob);
            }
        }
        const enriched = {
            id: this._activity.id,
            sport: this._selectedSport,
            date: new Date(manualDate).getTime(),
            name,
            description,
            photoUrl,
            photoPublicId: photoPublicId ?? undefined,
            mediaType: mediaType ?? undefined,
            distanceKm: manualDistKm,
            durationSec: manualDurSec,
            paceMinKm: manualPaceMinKm,
            speedKmH: manualDurSec > 0 ? manualDistKm / (manualDurSec / 3600) : 0,
            intensity,
            notes,
            visibility,
            muted,
            // Use picked map point for manual, GPS coords for tracked
            coords: this._pickedCoords
                ? [this._pickedCoords]
                : this._activity.coords,
        };
        // Share to selected clubs — set clubIds BEFORE saving
        const checkedClubs = this._el?.querySelectorAll('.sam-club-check:checked') ?? [];
        if (checkedClubs.length > 0) {
            enriched.clubIds = [...checkedClubs].map(cb => cb.dataset.clubId);
        }
        await CS.saveEnrichedActivity(enriched);
        this._onSave(enriched); // render first, then close
        this.close(true); // saved=true → skip onCancel
    }
}
// ── Factory ───────────────────────────────────────────────────────────────────
export function openSaveActivityModal(activity, onSave, onCancel) {
    const modal = new SaveActivityModal(activity, onSave, onCancel);
    modal.open();
}
//# sourceMappingURL=SaveActivityModal.js.map