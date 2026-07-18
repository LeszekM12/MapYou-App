// ─── SHARE STUDIO ────────────────────────────────────────────────────────────
// Strava-style share sheet: swipe through several share-image templates, toggle
// which stats appear (like Samsung Health), then download / native-share / copy
// a deep link straight to the activity. This is a marketing surface — every
// exported image carries the route, the numbers and a MapYou mark, so a shared
// image sells the app.
//
// Templates render onto a 1080×1920 canvas (portrait, story-ratio) reusing the
// map-tile + route drawing already proven in ShareImage.ts. A separate low-res
// preview canvas keeps the swiping smooth; the full-res render happens only on
// export.

import { EnrichedActivity } from './db.js';
import { decodePolyline } from './cloudSync.js';
import {
  _drawMapTiles, _drawRouteFallback, roundRect,
} from './ShareImage.js';
import {
  SPORT_COLORS, SPORT_ICONS, getSportLabel,
  formatDuration, formatPace, formatDistance,
} from './Tracker.js';

type SportType = keyof typeof SPORT_COLORS;

// Which stats a user can put on the card. `key` is stable (persists selection).
interface StatDef { key: string; label: string; value: (a: EnrichedActivity) => string | null }

const STAT_DEFS: StatDef[] = [
  { key: 'distance', label: 'Distance', value: a => a.distanceKm ? formatDistance(a.distanceKm) : null },
  { key: 'time',     label: 'Time',     value: a => a.durationSec ? formatDuration(a.durationSec) : null },
  { key: 'pace',     label: 'Pace',     value: a => a.paceMinKm ? formatPace(a.paceMinKm) : null },
  { key: 'elev',     label: 'Elevation',value: a => (a.elevGain != null && a.elevGain > 0) ? `${Math.round(a.elevGain)} m` : null },
  { key: 'cal',      label: 'Calories', value: a => (a.calories != null && a.calories > 0) ? `${Math.round(a.calories)} kcal` : null },
  { key: 'hr',       label: 'Avg HR',   value: a => (a.avgHr != null && a.avgHr > 0) ? `${Math.round(a.avgHr)} bpm` : null },
];

// The template decides layout & background; stats + route are shared inputs.
type TemplateId = 'map' | 'photo' | 'minimal' | 'gradient' | 'transparent';
interface Template { id: TemplateId; name: string; needsPhoto?: boolean; transparent?: boolean }

const CANVAS_W = 1080, CANVAS_H = 1920;

// ── deep link ────────────────────────────────────────────────────────────────

function activityDeepLink(act: EnrichedActivity): string {
  const owner = localStorage.getItem('mapyou_userId_profile') ?? '';
  const base  = 'https://leszekm12.github.io/MapYou-App';
  return `${base}/#activity=${encodeURIComponent(act.id)}&u=${encodeURIComponent(owner)}`;
}

// ── image loading (photo templates) ──────────────────────────────────────────

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(res => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = url;
  });
}

// ── shared drawing bits ──────────────────────────────────────────────────────

function drawStatsBlock(
  ctx: CanvasRenderingContext2D, act: EnrichedActivity,
  keys: string[], x: number, y: number, w: number, color: string, onDark: boolean,
): void {
  const chosen = STAT_DEFS.filter(d => keys.includes(d.key))
    .map(d => ({ label: d.label, val: d.value(act) }))
    .filter(s => s.val) as { label: string; val: string }[];
  if (!chosen.length) return;

  // Up to 3 per row.
  const perRow = Math.min(3, chosen.length);
  const colW = w / perRow;
  const primary = onDark ? '#ffffff' : '#101418';
  const muted   = onDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)';

  chosen.forEach((s, i) => {
    const col = i % perRow, row = Math.floor(i / perRow);
    const cx = x + col * colW;
    const cy = y + row * 150;
    ctx.textAlign = 'left';
    ctx.font = '600 30px Manrope, system-ui, sans-serif';
    ctx.fillStyle = muted;
    ctx.fillText(s.label.toUpperCase(), cx, cy);
    ctx.font = '800 64px Manrope, system-ui, sans-serif';
    ctx.fillStyle = primary;
    ctx.fillText(s.val, cx, cy + 66);
  });

  // Accent underline on the first stat, brand touch.
  ctx.fillStyle = color;
  ctx.fillRect(x, y - 34, 56, 6);
}

function drawBrandMark(ctx: CanvasRenderingContext2D, x: number, y: number, onDark: boolean): void {
  ctx.textAlign = 'left';
  ctx.font = '800 40px Manrope, system-ui, sans-serif';
  ctx.fillStyle = onDark ? '#ffffff' : '#101418';
  ctx.fillText('Map', x, y);
  const mapW = ctx.measureText('Map').width;
  ctx.fillStyle = '#00c46a';
  ctx.fillText('You', x + mapW, y);
}

async function drawRoute(
  ctx: CanvasRenderingContext2D, act: EnrichedActivity,
  x: number, y: number, w: number, h: number, color: string, tiles: boolean,
): Promise<void> {
  const coords = (act.coords ?? []) as [number, number][];
  if (coords.length < 2) return;
  ctx.save();
  roundRect(ctx, x, y, w, h, 28); ctx.clip();
  // Backing colour in case tiles are missing / still loading.
  ctx.fillStyle = '#242a30'; ctx.fill();
  let drew = false;
  if (tiles) {
    const t = await _drawMapTiles(ctx, coords, x, y, w, h);
    if (t) {
      const { toCanvasX, toCanvasY } = t;
      // White casing under the coloured line — reads on any map.
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 11;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.beginPath();
      coords.forEach((c, i) => (i === 0 ? ctx.moveTo(toCanvasX(c[1]), toCanvasY(c[0])) : ctx.lineTo(toCanvasX(c[1]), toCanvasY(c[0]))));
      ctx.stroke();
      ctx.strokeStyle = color; ctx.lineWidth = 6;
      ctx.beginPath();
      coords.forEach((c, i) => (i === 0 ? ctx.moveTo(toCanvasX(c[1]), toCanvasY(c[0])) : ctx.lineTo(toCanvasX(c[1]), toCanvasY(c[0]))));
      ctx.stroke();
      drew = true;
    }
  }
  if (!drew) _drawRouteFallback(ctx, coords, color, x, y, w, h);
  ctx.restore();
}

// ── template renderers ───────────────────────────────────────────────────────
// Each fills the full canvas. `statKeys` chooses which numbers appear.

async function renderTemplate(
  ctx: CanvasRenderingContext2D, tpl: TemplateId, act: EnrichedActivity, statKeys: string[],
): Promise<void> {
  const color = (SPORT_COLORS as Record<string, string>)[act.sport] ?? '#00c46a';
  const icon  = (SPORT_ICONS as Record<string, string>)[act.sport] ?? '🏅';
  const title = act.name || act.description || getSportLabel(act.sport as SportType);
  const d = new Date(act.date);
  const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  if (tpl === 'transparent') {
    // Strava's transparent export: no background at all — just the route line,
    // the stats and the mark. Perfect for dropping onto an Instagram Story over
    // your own photo. The checkerboard the user sees is only a PREVIEW hint
    // (drawn by the UI layer), never baked into the PNG.
    ctx.textAlign = 'center';
    // Stats stacked, centred (Strava layout).
    const chosen = STAT_DEFS.filter(dd => statKeys.includes(dd.key))
      .map(dd => ({ label: dd.label, val: dd.value(act) }))
      .filter(sv => sv.val) as { label: string; val: string }[];
    let yy = 300;
    for (const sv of chosen) {
      ctx.font = '600 34px Manrope, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillText(sv.label.toUpperCase(), CANVAS_W / 2, yy);
      ctx.font = '800 88px Manrope, system-ui, sans-serif';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(sv.val, CANVAS_W / 2, yy + 90);
      yy += 190;
    }
    // Route centred below the stats.
    if ((act.coords?.length ?? 0) > 1) {
      const rW = 640, rH = 640, rX = (CANVAS_W - rW) / 2, rY = yy + 40;
      ctx.save();
      // White casing + colour, geometric (no map tiles → stays transparent).
      _drawRouteFallback(ctx, act.coords as [number, number][], '#ffffff', rX, rY, rW, rH);
      _drawRouteFallback(ctx, act.coords as [number, number][], color, rX + 3, rY + 3, rW - 6, rH - 6);
      ctx.restore();
    }
    drawBrandMark(ctx, CANVAS_W / 2 - 62, CANVAS_H - 120, true);
    ctx.textAlign = 'left';
    return;
  }

  if (tpl === 'photo' && act.photoUrl) {
    // Full-bleed photo, gradient scrim, route thumbnail + stats over it.
    const img = await loadImage(act.photoUrl);
    if (img) {
      const scale = Math.max(CANVAS_W / img.width, CANVAS_H / img.height);
      const iw = img.width * scale, ih = img.height * scale;
      ctx.drawImage(img, (CANVAS_W - iw) / 2, (CANVAS_H - ih) / 2, iw, ih);
    } else {
      ctx.fillStyle = '#171c20'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    }
    const scrim = ctx.createLinearGradient(0, CANVAS_H * 0.35, 0, CANVAS_H);
    scrim.addColorStop(0, 'rgba(0,0,0,0)');
    scrim.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = scrim; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Small route chip top-right if we have a track.
    if ((act.coords?.length ?? 0) > 1) {
      await drawRoute(ctx, act, CANVAS_W - 360, 80, 280, 280, color, false);
    }
    ctx.textAlign = 'left';
    ctx.font = '800 68px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(title, 80, CANVAS_H - 520, CANVAS_W - 160);
    ctx.font = '500 34px Manrope, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.fillText(`${icon} ${dateStr}`, 80, CANVAS_H - 470);
    drawStatsBlock(ctx, act, statKeys, 80, CANVAS_H - 340, CANVAS_W - 160, color, true);
    drawBrandMark(ctx, 80, CANVAS_H - 70, true);
    return;
  }

  if (tpl === 'minimal') {
    // Clean light card — numbers first, tiny route.
    ctx.fillStyle = '#f6f7f8'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = color; ctx.fillRect(0, 0, CANVAS_W, 12);
    ctx.textAlign = 'left';
    ctx.font = '800 76px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#101418';
    ctx.fillText(title, 90, 220, CANVAS_W - 180);
    ctx.font = '500 38px Manrope, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillText(`${icon} ${dateStr}`, 90, 280);
    if ((act.coords?.length ?? 0) > 1) {
      await drawRoute(ctx, act, 90, 360, CANVAS_W - 180, 760, color, true);
    }
    drawStatsBlock(ctx, act, statKeys, 90, 1320, CANVAS_W - 180, color, false);
    drawBrandMark(ctx, 90, CANVAS_H - 90, false);
    return;
  }

  if (tpl === 'gradient') {
    // Bold brand gradient, no map — stats hero. Works even without a route.
    const g = ctx.createLinearGradient(0, 0, CANVAS_W, CANVAS_H);
    g.addColorStop(0, color);
    g.addColorStop(1, '#06281a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.font = '900 520px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(icon, CANVAS_W / 2, CANVAS_H / 2 + 120);
    ctx.textAlign = 'left';
    ctx.font = '800 84px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#fff';
    ctx.fillText(title, 90, 260, CANVAS_W - 180);
    ctx.font = '500 40px Manrope, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.fillText(dateStr, 90, 320);
    drawStatsBlock(ctx, act, statKeys, 90, CANVAS_H - 420, CANVAS_W - 180, '#ffffff', true);
    drawBrandMark(ctx, 90, CANVAS_H - 90, true);
    return;
  }

  // default: 'map' — dark card, big map, stats below (the marketing default).
  ctx.fillStyle = '#12171b'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const mesh = ctx.createRadialGradient(CANVAS_W / 2, 0, 0, CANVAS_W / 2, 0, 900);
  mesh.addColorStop(0, color + '22'); mesh.addColorStop(1, 'transparent');
  ctx.fillStyle = mesh; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.fillStyle = color; ctx.fillRect(0, 0, CANVAS_W, 10);

  ctx.textAlign = 'left';
  ctx.font = '800 76px Manrope, system-ui, sans-serif';
  ctx.fillStyle = '#fff';
  ctx.fillText(title, 90, 200, CANVAS_W - 180);
  ctx.font = '500 38px Manrope, system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.fillText(`${icon} ${dateStr}`, 90, 258);

  if ((act.coords?.length ?? 0) > 1) {
    await drawRoute(ctx, act, 90, 340, CANVAS_W - 180, 900, color, true);
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, 90, 340, CANVAS_W - 180, 900, 28); ctx.fill();
    ctx.textAlign = 'center'; ctx.font = '120px sans-serif';
    ctx.fillText(icon, CANVAS_W / 2, 850); ctx.textAlign = 'left';
  }
  drawStatsBlock(ctx, act, statKeys, 90, 1440, CANVAS_W - 180, color, true);
  drawBrandMark(ctx, 90, CANVAS_H - 90, true);
}

// ── Studio UI ────────────────────────────────────────────────────────────────

export function openShareStudio(act: EnrichedActivity): void {
  document.getElementById('shareStudio')?.remove();

  // Route may live only as an encoded polyline (coordsEnc) — coords is often
  // emptied to save space. Decode it once here so every template has a track.
  if ((!act.coords || act.coords.length < 2)) {
    const enc = (act as unknown as Record<string, unknown>).coordsEnc as string | null
             ?? (act as unknown as Record<string, unknown>)._coordsEncResolved as string | null;
    if (enc) {
      try { act = { ...act, coords: decodePolyline(enc) }; } catch { /* leave empty */ }
    }
  }

  const templates: Template[] = [
    { id: 'map',      name: 'Route' },
    ...(act.photoUrl ? [{ id: 'photo' as const, name: 'Photo', needsPhoto: true }] : []),
    { id: 'transparent', name: 'Transparent', transparent: true },
    { id: 'minimal',  name: 'Minimal' },
    { id: 'gradient', name: 'Bold' },
  ];

  // Default stats: distance + time + pace, but only those with a value.
  const available = STAT_DEFS.filter(d => d.value(act)).map(d => d.key);
  let statKeys = available.filter(k => ['distance', 'time', 'pace'].includes(k));
  if (!statKeys.length) statKeys = available.slice(0, 3);
  let current = 0;

  const ov = document.createElement('div');
  ov.id = 'shareStudio';
  ov.className = 'ss-overlay';
  ov.innerHTML = `
    <div class="ss-sheet">
      <div class="ss-head">
        <button class="ss-close" id="ssClose">Close</button>
        <span class="ss-title">Share activity</span>
        <span style="width:56px"></span>
      </div>

      <div class="ss-stage" id="ssStage">
        <div class="ss-track" id="ssTrack"></div>
      </div>
      <div class="ss-dots" id="ssDots"></div>

      <div class="ss-stats">
        <div class="ss-stats__title">Show on card</div>
        <div class="ss-chips" id="ssChips"></div>
      </div>

      <div class="ss-actions">
        <button class="ss-act" id="ssDownload">
          <svg class="ss-act__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="m7 11 5 5 5-5"/><path d="M5 21h14"/></svg>
          <span>Save image</span>
        </button>
        <button class="ss-act" id="ssShare">
          <svg class="ss-act__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="m8 7 4-4 4 4"/><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/></svg>
          <span>Share</span>
        </button>
        <button class="ss-act" id="ssLink">
          <svg class="ss-act__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>
          <span>Copy link</span>
        </button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('ss-overlay--visible'));

  const close = () => { ov.classList.remove('ss-overlay--visible'); setTimeout(() => ov.remove(), 260); };
  ov.querySelector('#ssClose')?.addEventListener('click', close);

  const track = ov.querySelector<HTMLElement>('#ssTrack')!;
  const dots  = ov.querySelector<HTMLElement>('#ssDots')!;

  // One preview canvas per template. Rendered lazily & re-rendered on toggle.
  const canvases: HTMLCanvasElement[] = templates.map((tpl) => {
    const slide = document.createElement('div');
    slide.className = 'ss-slide';
    const c = document.createElement('canvas');
    c.className = 'ss-canvas' + (tpl.transparent ? ' ss-canvas--transparent' : '');
    c.width = CANVAS_W; c.height = CANVAS_H;
    slide.appendChild(c);
    if (tpl.transparent) {
      const tag = document.createElement('span');
      tag.className = 'ss-transparent-tag';
      tag.textContent = 'TRANSPARENT';
      slide.appendChild(tag);
    }
    track.appendChild(slide);
    return c;
  });

  dots.innerHTML = templates.map((_, i) => `<span class="ss-dot${i === 0 ? ' ss-dot--on' : ''}"></span>`).join('');

  const rendered = new Set<number>();
  const paint = async (i: number, force = false) => {
    if (rendered.has(i) && !force) return;
    const ctx = canvases[i].getContext('2d')!;
    await renderTemplate(ctx, templates[i].id, act, statKeys);
    rendered.add(i);
  };
  const repaintAll = () => { rendered.clear(); void paint(current, true); };

  const go = (i: number) => {
    current = Math.max(0, Math.min(templates.length - 1, i));
    track.style.transform = `translateX(-${current * 100}%)`;
    dots.querySelectorAll('.ss-dot').forEach((d, k) => d.classList.toggle('ss-dot--on', k === current));
    void paint(current);
    void paint(current + 1); void paint(current - 1);
  };

  // Swipe.
  let startX = 0, dx = 0, dragging = false;
  const stage = ov.querySelector<HTMLElement>('#ssStage')!;
  stage.addEventListener('touchstart', e => { startX = e.touches[0].clientX; dragging = true; dx = 0; }, { passive: true });
  stage.addEventListener('touchmove', e => {
    if (!dragging) return; dx = e.touches[0].clientX - startX;
    track.style.transform = `translateX(calc(-${current * 100}% + ${dx}px))`;
  }, { passive: true });
  stage.addEventListener('touchend', () => {
    dragging = false;
    if (Math.abs(dx) > 60) go(current + (dx < 0 ? 1 : -1)); else go(current);
  });

  // Stat chips.
  const chips = ov.querySelector<HTMLElement>('#ssChips')!;
  chips.innerHTML = STAT_DEFS.filter(d => d.value(act)).map(d =>
    `<button class="ss-chip${statKeys.includes(d.key) ? ' ss-chip--on' : ''}" data-k="${d.key}">${d.label}</button>`).join('');
  chips.querySelectorAll<HTMLElement>('.ss-chip').forEach(b => {
    b.addEventListener('click', () => {
      const k = b.dataset.k!;
      if (statKeys.includes(k)) {
        if (statKeys.length <= 1) return;            // keep at least one
        statKeys = statKeys.filter(x => x !== k);
      } else {
        if (statKeys.length >= 6) return;
        statKeys = [...statKeys, k];
      }
      b.classList.toggle('ss-chip--on');
      repaintAll();
    });
  });

  // Export at full resolution (paint fresh so preview scaling can't leak in).
  const exportBlob = async (): Promise<Blob | null> => {
    const c = document.createElement('canvas');
    c.width = CANVAS_W; c.height = CANVAS_H;
    await renderTemplate(c.getContext('2d')!, templates[current].id, act, statKeys);
    return new Promise(res => c.toBlob(b => res(b), 'image/png', 0.95));
  };

  // The Strava flow: hand the IMAGE to the OS share sheet. Critically, "Save
  // image" shares ONLY the file — no title/text/url. iOS shows "Save Image"
  // (→ Photos) for a lone image/png; add a url/text and it treats the payload
  // as a document (Copy/Print, no Save). That mismatch is why the earlier
  // version reached a sheet with nowhere to save.
  const saveImage = async (): Promise<void> => {
    const blob = await exportBlob();
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    if (blob) {
      const file = new File([blob], `MapYou-${act.sport}.png`, { type: 'image/png' });
      if (nav.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file] }); return; }
        catch (e) { if ((e as Error).name === 'AbortError') return; }
      }
      // Desktop fallback: direct download.
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `MapYou-${act.sport}-${act.id}.png`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  };

  ov.querySelector('#ssDownload')?.addEventListener('click', async () => {
    const lbl = ov.querySelector<HTMLElement>('#ssDownload span:last-child')!;
    lbl.textContent = 'Preparing…';
    await saveImage();
    lbl.textContent = 'Save image';
  });

  ov.querySelector('#ssShare')?.addEventListener('click', async () => {
    // Same image share, but if the platform can't do files, fall back to a
    // link-only share rather than a silent download.
    const blob = await exportBlob();
    const link = activityDeepLink(act);
    const text = `${act.name || getSportLabel(act.sport as SportType)} — ${formatDistance(act.distanceKm)} via MapYou`;
    const nav = navigator as Navigator & { canShare?: (d: unknown) => boolean };
    try {
      const file = blob ? new File([blob], 'mapyou.png', { type: 'image/png' }) : null;
      if (file && nav.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: 'MapYou', text, url: link });
      } else if (navigator.share) {
        await navigator.share({ title: 'MapYou', text, url: link });
      }
    } catch { /* cancelled */ }
  });

  ov.querySelector('#ssLink')?.addEventListener('click', async () => {
    const lbl = ov.querySelector<HTMLElement>('#ssLink span:last-child')!;
    try { await navigator.clipboard.writeText(activityDeepLink(act)); lbl.textContent = 'Copied ✓'; }
    catch { lbl.textContent = 'Error'; }
    setTimeout(() => { lbl.textContent = 'Copy link'; }, 2000);
  });

  go(0);
}

// ── Viewer share (someone else's activity): actions only, no studio ──────────

export function openShareActions(act: EnrichedActivity): void {
  document.getElementById('shareStudio')?.remove();
  const link = activityDeepLink(act);
  const ov = document.createElement('div');
  ov.id = 'shareStudio';
  ov.className = 'ss-overlay';
  ov.innerHTML = `
    <div class="ss-sheet ss-sheet--compact">
      <div class="ss-head">
        <button class="ss-close" id="ssClose">Close</button>
        <span class="ss-title">Share</span>
        <span style="width:56px"></span>
      </div>
      <div class="ss-actions ss-actions--wide">
        <button class="ss-act" id="ssShare"><svg class="ss-act__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v13"/><path d="m8 7 4-4 4 4"/><path d="M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7"/></svg><span>Share via…</span></button>
        <button class="ss-act" id="ssLink"><svg class="ss-act__ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg><span>Copy link</span></button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  requestAnimationFrame(() => ov.classList.add('ss-overlay--visible'));
  const close = () => { ov.classList.remove('ss-overlay--visible'); setTimeout(() => ov.remove(), 260); };
  ov.querySelector('#ssClose')?.addEventListener('click', close);

  ov.querySelector('#ssShare')?.addEventListener('click', async () => {
    try { if (navigator.share) await navigator.share({ title: 'MapYou', url: link }); } catch { /* cancelled */ }
  });
  ov.querySelector('#ssLink')?.addEventListener('click', async () => {
    const lbl = ov.querySelector<HTMLElement>('#ssLink span:last-child')!;
    try { await navigator.clipboard.writeText(link); lbl.textContent = 'Copied ✓'; } catch { lbl.textContent = 'Error'; }
    setTimeout(() => { lbl.textContent = 'Copy link'; }, 2000);
  });
}
