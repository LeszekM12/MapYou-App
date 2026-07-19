// ─── SHARE IMAGE ─────────────────────────────────────────────────────────────
// src/modules/ShareImage.ts
//
// Generates a beautiful share image (canvas → PNG download) from an
// EnrichedActivity. Reuses all OSM-tile-rendering logic from ActivityView.ts.
// Adds photo support if the activity has one.
import { SPORT_COLORS, SPORT_ICONS, getSportLabel, formatDuration, formatPace, formatDistance } from './Tracker.js';
// ── OSM tile helpers (copied from ActivityView.ts) ────────────────────────────
function _lngToTileX(lng, zoom) {
    return Math.floor(((lng + 180) / 360) * Math.pow(2, zoom));
}
function _latToTileY(lat, zoom) {
    const r = Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * Math.pow(2, zoom));
}
export function _latLngToPixel(lat, lng, zoom) {
    const n = Math.pow(2, zoom);
    const x = ((lng + 180) / 360) * n * 256;
    const r = Math.PI / 180;
    const y = (1 - Math.log(Math.tan(lat * r) + 1 / Math.cos(lat * r)) / Math.PI) / 2 * n * 256;
    return { x, y };
}
async function _loadImage(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
    });
}
export async function _drawMapTiles(ctx, coords, canvasX, canvasY, canvasW, canvasH) {
    if (!coords.length)
        return null;
    const lats = coords.map(c => c[0]);
    const lngs = coords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    // Choose zoom so the route fills the frame tightly (Strava-like fitBounds)
    const cLat = (minLat + maxLat) / 2;
    const cLng = (minLng + maxLng) / 2;
    const margin = 0.82; // route spans ~82% of the frame
    let zoom = 16;
    for (let z = 18; z >= 3; z--) {
        const a = _latLngToPixel(maxLat, minLng, z);
        const b = _latLngToPixel(minLat, maxLng, z);
        if (Math.abs(b.x - a.x) <= canvasW * margin && Math.abs(b.y - a.y) <= canvasH * margin) {
            zoom = z;
            break;
        }
        if (z === 3)
            zoom = 3;
    }
    zoom = Math.max(3, Math.min(17, zoom));
    const centre = _latLngToPixel(cLat, cLng, zoom);
    const srcX = centre.x - canvasW / 2;
    const srcY = centre.y - canvasH / 2;
    // Tiles covering exactly the crop window
    const txMin = Math.floor(srcX / 256);
    const txMax = Math.floor((srcX + canvasW) / 256);
    const tyMin = Math.floor(srcY / 256);
    const tyMax = Math.floor((srcY + canvasH) / 256);
    const gridPixelX0 = txMin * 256;
    const gridPixelY0 = tyMin * 256;
    const cols = txMax - txMin + 1;
    const rows = tyMax - tyMin + 1;
    const tmp = document.createElement('canvas');
    tmp.width = cols * 256;
    tmp.height = rows * 256;
    const tctx = tmp.getContext('2d');
    tctx.fillStyle = '#e8eef0';
    tctx.fillRect(0, 0, tmp.width, tmp.height);
    const subs = ['a', 'b', 'c'];
    await Promise.all(Array.from({ length: cols * rows }, (_, idx) => {
        const tx = txMin + Math.floor(idx / rows);
        const ty = tyMin + (idx % rows);
        const sub = subs[(((tx + ty) % 3) + 3) % 3];
        const url = `https://${sub}.basemaps.cartocdn.com/rastertiles/voyager/${zoom}/${tx}/${ty}.png`;
        return _loadImage(url).then(img => {
            if (img)
                tctx.drawImage(img, (tx - txMin) * 256, (ty - tyMin) * 256, 256, 256);
        });
    }));
    ctx.save();
    ctx.beginPath();
    const rctx = ctx;
    if (rctx.roundRect)
        rctx.roundRect(canvasX, canvasY, canvasW, canvasH, 20);
    else
        ctx.rect(canvasX, canvasY, canvasW, canvasH);
    ctx.clip();
    ctx.drawImage(tmp, srcX - gridPixelX0, srcY - gridPixelY0, canvasW, canvasH, canvasX, canvasY, canvasW, canvasH);
    // Soft top-to-bottom darken for contrast with the route + dark card
    const vg = ctx.createLinearGradient(0, canvasY, 0, canvasY + canvasH);
    vg.addColorStop(0, 'rgba(0,0,0,0.08)');
    vg.addColorStop(1, 'rgba(0,0,0,0.30)');
    ctx.fillStyle = vg;
    ctx.fillRect(canvasX, canvasY, canvasW, canvasH);
    ctx.restore();
    return {
        toCanvasX: (lng) => canvasX + (_latLngToPixel(0, lng, zoom).x - srcX),
        toCanvasY: (lat) => canvasY + (_latLngToPixel(lat, 0, zoom).y - srcY),
    };
}
export function _drawRouteFallback(ctx, coords, color, mapX, mapY, mapW, mapH) {
    const lats = coords.map(c => c[0]);
    const lngs = coords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const pad = 40;
    const scaleX = (mapW - pad * 2) / (maxLng - minLng || 0.001);
    const scaleY = (mapH - pad * 2) / (maxLat - minLat || 0.001);
    const scale = Math.min(scaleX, scaleY);
    const offX = mapX + pad + ((mapW - pad * 2) - (maxLng - minLng) * scale) / 2;
    const offY = mapY + pad + ((mapH - pad * 2) - (maxLat - minLat) * scale) / 2;
    const toX = (lng) => offX + (lng - minLng) * scale;
    const toY = (lat) => offY + (mapH - pad * 2) - (lat - minLat) * scale;
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    coords.forEach((c, i) => i === 0 ? ctx.moveTo(toX(c[1]), toY(c[0])) : ctx.lineTo(toX(c[1]), toY(c[0])));
    ctx.stroke();
    ctx.shadowBlur = 0;
    const s0 = coords[0], s1 = coords[coords.length - 1];
    ctx.fillStyle = '#00c46a';
    ctx.beginPath();
    ctx.arc(toX(s0[1]), toY(s0[0]), 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e74c3c';
    ctx.beginPath();
    ctx.arc(toX(s1[1]), toY(s1[0]), 8, 0, Math.PI * 2);
    ctx.fill();
}
// ── Rounded rect helper ───────────────────────────────────────────────────────
export function roundRect(ctx, x, y, w, h, r) {
    const rctx = ctx;
    ctx.beginPath();
    if (rctx.roundRect)
        rctx.roundRect(x, y, w, h, r);
    else
        ctx.rect(x, y, w, h);
}
// ── Main export ───────────────────────────────────────────────────────────────
export async function generateShareImageFromEnriched(act) {
    const color = SPORT_COLORS[act.sport] ?? '#00c46a';
    const icon = SPORT_ICONS[act.sport] ?? '🏅';
    const hasPhoto = !!act.photoUrl;
    const canvasH = hasPhoto ? 1200 : 1000;
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d');
    // ── Background ──────────────────────────────────────────────────────────────
    ctx.fillStyle = '#171c20';
    ctx.fillRect(0, 0, 800, canvasH);
    // Gradient mesh background
    const mesh = ctx.createRadialGradient(400, 0, 0, 400, 0, 600);
    mesh.addColorStop(0, color + '18');
    mesh.addColorStop(1, 'transparent');
    ctx.fillStyle = mesh;
    ctx.fillRect(0, 0, 800, canvasH);
    // ── Top accent bar ──────────────────────────────────────────────────────────
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 800, 5);
    // ── Header ──────────────────────────────────────────────────────────────────
    // Sport badge
    roundRect(ctx, 40, 24, 60, 60, 16);
    ctx.fillStyle = color + '22';
    ctx.fill();
    ctx.font = '32px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(icon, 70, 63);
    ctx.textAlign = 'left';
    // Activity name
    ctx.font = 'bold 26px Manrope, system-ui, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(act.name || act.description, 116, 48, 644);
    // Description (if different from name)
    if (act.description && act.name && act.description !== act.name) {
        ctx.font = '16px Manrope, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText(act.description, 116, 70, 644);
    }
    // Date + sport type
    const d = new Date(act.date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    ctx.font = '15px Manrope, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText(`${months[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${act.sport}`, 116, 92);
    // ── Map area ─────────────────────────────────────────────────────────────────
    const mapX = 24, mapY = 108, mapW = 752, mapH = 420;
    // Map background
    roundRect(ctx, mapX, mapY, mapW, mapH, 20);
    ctx.fillStyle = '#242a30';
    ctx.fill();
    if (act.coords.length > 1) {
        const transform = await _drawMapTiles(ctx, act.coords, mapX, mapY, mapW, mapH);
        if (transform) {
            const { toCanvasX, toCanvasY } = transform;
            ctx.save();
            roundRect(ctx, mapX, mapY, mapW, mapH, 20);
            ctx.clip();
            // Route casing (white outline) + glow
            ctx.shadowColor = 'rgba(0,0,0,0.45)';
            ctx.shadowBlur = 10;
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 11;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            act.coords.forEach((c, i) => {
                const x = toCanvasX(c[1]), y = toCanvasY(c[0]);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.stroke();
            ctx.strokeStyle = color;
            ctx.lineWidth = 6;
            ctx.shadowBlur = 0;
            ctx.beginPath();
            act.coords.forEach((c, i) => {
                const x = toCanvasX(c[1]), y = toCanvasY(c[0]);
                i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
            });
            ctx.stroke();
            const drawDot = (lat, lng, fill) => {
                const x = toCanvasX(lng), y = toCanvasY(lat);
                ctx.beginPath();
                ctx.arc(x, y, 9, 0, Math.PI * 2);
                ctx.fillStyle = '#fff';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(x, y, 6, 0, Math.PI * 2);
                ctx.fillStyle = fill;
                ctx.fill();
            };
            drawDot(act.coords[0][0], act.coords[0][1], '#00c46a');
            drawDot(act.coords[act.coords.length - 1][0], act.coords[act.coords.length - 1][1], '#e74c3c');
            ctx.restore();
        }
        else {
            _drawRouteFallback(ctx, act.coords, color, mapX, mapY, mapW, mapH);
        }
    }
    else {
        ctx.font = '20px Manrope, system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.25)';
        ctx.textAlign = 'center';
        ctx.fillText('No GPS route recorded', 400, mapY + mapH / 2);
        ctx.textAlign = 'left';
    }
    let nextY = mapY + mapH + 24;
    // ── Photo (if any) ───────────────────────────────────────────────────────────
    if (hasPhoto && act.photoUrl) {
        const photoImg = await _loadImage(act.photoUrl);
        if (photoImg) {
            const ph = 220, py = nextY, px = 24, pw = 752;
            roundRect(ctx, px, py, pw, ph, 16);
            ctx.fillStyle = '#242a30';
            ctx.fill();
            ctx.save();
            roundRect(ctx, px, py, pw, ph, 16);
            ctx.clip();
            // Cover-fit the photo
            const scale = Math.max(pw / photoImg.width, ph / photoImg.height);
            const sw = photoImg.width * scale, sh = photoImg.height * scale;
            ctx.drawImage(photoImg, px + (pw - sw) / 2, py + (ph - sh) / 2, sw, sh);
            ctx.fillStyle = 'rgba(0,0,0,0.15)';
            ctx.fillRect(px, py, pw, ph);
            ctx.restore();
            nextY += ph + 24;
        }
    }
    // ── Stats ────────────────────────────────────────────────────────────────────
    const statsY = nextY;
    const statW = 800 / 3;
    const stats = [
        [formatDistance(act.distanceKm), 'km'],
        [formatDuration(act.durationSec), 'time'],
        [act.sport === 'cycling' ? act.speedKmH.toFixed(1) : formatPace(act.paceMinKm),
            act.sport === 'cycling' ? 'km/h' : 'min/km'],
    ];
    stats.forEach(([val, lbl], i) => {
        const x = i * statW + statW / 2;
        ctx.textAlign = 'center';
        ctx.font = 'bold 48px Manrope, system-ui, sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(val, x, statsY + 52);
        ctx.font = '15px Manrope, system-ui, sans-serif';
        ctx.fillStyle = color + 'cc';
        ctx.fillText(lbl.toUpperCase(), x, statsY + 75);
        // Separator
        if (i < 2) {
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.fillRect((i + 1) * statW - 1, statsY + 10, 1, 70);
        }
    });
    ctx.textAlign = 'left';
    nextY = statsY + 100;
    // ── Intensity badge ──────────────────────────────────────────────────────────
    if (act.intensity) {
        const intLabels = ['', 'Easy', 'Moderate', 'Hard', 'Very Hard', 'Max Effort'];
        const intColors = ['', '#4ade80', '#facc15', '#fb923c', '#f87171', '#ef4444'];
        const ic = intColors[act.intensity] ?? color;
        roundRect(ctx, 40, nextY, 140, 30, 8);
        ctx.fillStyle = ic + '22';
        ctx.fill();
        ctx.font = 'bold 14px Manrope, system-ui, sans-serif';
        ctx.fillStyle = ic;
        ctx.textAlign = 'center';
        ctx.fillText(intLabels[act.intensity] ?? '', 110, nextY + 20);
        ctx.textAlign = 'left';
        nextY += 50;
    }
    // ── Divider ──────────────────────────────────────────────────────────────────
    ctx.strokeStyle = color + '30';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(40, nextY);
    ctx.lineTo(760, nextY);
    ctx.stroke();
    nextY += 20;
    // ── Footer / branding ────────────────────────────────────────────────────────
    // MapYou logo text
    ctx.font = 'bold 20px Manrope, system-ui, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText('🗺 MapYou', 40, nextY + 20);
    // Horizontal rule at bottom
    const footerY = canvasH - 10;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(40, footerY);
    ctx.lineTo(760, footerY);
    ctx.stroke();
    // ── Download ──────────────────────────────────────────────────────────────────
    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = `mapyou-${act.sport}-${new Date(act.date).toISOString().slice(0, 10)}.png`;
    link.click();
}
// ── Activity Reel (9:16 professional card, light theme) ──────────────────────
// Renders a clean 1080×1920 reel image (map + stats) for an activity.
// Returned Blob is uploaded as the reel media; the reel keeps the activityId so
// the viewer can deep-link into the activity details.
function _tintToWhite(hex, amt) {
    const h = hex.replace('#', '');
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    const mix = (c) => Math.round(c + (255 - c) * (1 - amt));
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}
function _wrapText(ctx, text, x, y, maxW, lh, maxLines) {
    const words = text.split(/\s+/);
    let line = '', lines = 0;
    for (let i = 0; i < words.length; i++) {
        const test = line ? `${line} ${words[i]}` : words[i];
        if (ctx.measureText(test).width > maxW && line) {
            ctx.fillText(line, x, y);
            y += lh;
            lines++;
            line = words[i];
            if (lines >= maxLines - 1) {
                let last = line;
                while (ctx.measureText(`${last}…`).width > maxW && last.length > 1)
                    last = last.slice(0, -1);
                ctx.fillText(words.slice(i).join(' ').length > last.length ? `${last}…` : line, x, y);
                return y;
            }
        }
        else {
            line = test;
        }
    }
    ctx.fillText(line, x, y);
    return y;
}
export async function composeActivityReel(act, opts = {}) {
    const W = 1080, H = 1920;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx)
        return null;
    const color = SPORT_COLORS[act.sport] ?? '#00c46a';
    const icon = SPORT_ICONS[act.sport] ?? '🏃';
    // Light background, softly tinted by the sport colour
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(1, _tintToWhite(color, 0.12));
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const PAD = 80;
    let y = 150;
    // Header — avatar + name + date
    const avatar = opts.avatarUrl ? await _loadImage(opts.avatarUrl) : null;
    const acx = PAD + 50;
    if (avatar) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(acx, y, 50, 0, Math.PI * 2);
        ctx.clip();
        ctx.drawImage(avatar, acx - 50, y - 50, 100, 100);
        ctx.restore();
        ctx.lineWidth = 4;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(acx, y, 50, 0, Math.PI * 2);
        ctx.stroke();
    }
    else {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(acx, y, 50, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = '600 46px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText((opts.authorName?.[0] ?? '?').toUpperCase(), acx, y + 2);
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#16181c';
    ctx.font = '600 42px system-ui';
    ctx.fillText(opts.authorName ?? 'Athlete', acx + 78, y - 6);
    ctx.fillStyle = '#8a8d93';
    ctx.font = '400 30px system-ui';
    const dateStr = new Date(act.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    ctx.fillText(dateStr, acx + 78, y + 38);
    // Title
    y += 150;
    ctx.fillStyle = '#16181c';
    ctx.font = '700 80px system-ui';
    const title = (act.name || '').replace(/^(undefined|null)\s*/i, '').trim() || getSportLabel(act.sport);
    y = _wrapText(ctx, title, PAD, y, W - PAD * 2, 90, 2);
    // Sport chip
    y += 46;
    ctx.font = '600 34px system-ui';
    const chipText = `${icon} ${getSportLabel(act.sport)}`;
    const chipW = ctx.measureText(chipText).width + 56;
    roundRect(ctx, PAD, y - 44, chipW, 64, 32);
    ctx.fillStyle = _tintToWhite(color, 0.25);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.fillText(chipText, PAD + 28, y - 10);
    ctx.textBaseline = 'alphabetic';
    // Map panel
    y += 60;
    const mapX = PAD, mapY = y, mapW = W - PAD * 2, mapH = 720;
    ctx.save();
    roundRect(ctx, mapX, mapY, mapW, mapH, 40);
    ctx.fillStyle = '#e8eef0';
    ctx.fill();
    ctx.shadowColor = 'rgba(0,0,0,0.12)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 12;
    ctx.fill();
    ctx.restore();
    const coords = (Array.isArray(act.coords) ? act.coords : []);
    if (coords.length > 1) {
        const transform = await _drawMapTiles(ctx, coords, mapX, mapY, mapW, mapH);
        ctx.save();
        roundRect(ctx, mapX, mapY, mapW, mapH, 40);
        ctx.clip();
        if (transform) {
            const { toCanvasX, toCanvasY } = transform;
            ctx.shadowColor = 'rgba(0,0,0,0.4)';
            ctx.shadowBlur = 12;
            ctx.strokeStyle = 'rgba(255,255,255,0.95)';
            ctx.lineWidth = 13;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.beginPath();
            coords.forEach((c, i) => { const x = toCanvasX(c[1]), yy = toCanvasY(c[0]); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); });
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.strokeStyle = color;
            ctx.lineWidth = 7;
            ctx.beginPath();
            coords.forEach((c, i) => { const x = toCanvasX(c[1]), yy = toCanvasY(c[0]); i ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); });
            ctx.stroke();
            const dot = (lat, lng, fill) => { const x = toCanvasX(lng), yy = toCanvasY(lat); ctx.beginPath(); ctx.arc(x, yy, 11, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill(); ctx.beginPath(); ctx.arc(x, yy, 7, 0, Math.PI * 2); ctx.fillStyle = fill; ctx.fill(); };
            dot(coords[0][0], coords[0][1], '#00c46a');
            dot(coords[coords.length - 1][0], coords[coords.length - 1][1], '#e74c3c');
        }
        else {
            _drawRouteFallback(ctx, coords, color, mapX, mapY, mapW, mapH);
        }
        ctx.restore();
    }
    else {
        ctx.save();
        roundRect(ctx, mapX, mapY, mapW, mapH, 40);
        ctx.clip();
        const g = ctx.createLinearGradient(mapX, mapY, mapX, mapY + mapH);
        g.addColorStop(0, _tintToWhite(color, 0.35));
        g.addColorStop(1, _tintToWhite(color, 0.18));
        ctx.fillStyle = g;
        ctx.fillRect(mapX, mapY, mapW, mapH);
        ctx.font = '200px system-ui';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(icon, mapX + mapW / 2, mapY + mapH / 2);
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
    }
    // Stats row
    y = mapY + mapH + 110;
    const isCycle = act.sport === 'cycling';
    const stats = [
        { v: act.distanceKm.toFixed(2), l: 'Distance (km)' },
        { v: isCycle ? act.speedKmH.toFixed(1) : formatPace(act.paceMinKm), l: isCycle ? 'Speed (km/h)' : 'Pace (min/km)' },
        { v: formatDuration(act.durationSec), l: 'Time' },
    ];
    const colW = (W - PAD * 2) / 3;
    ctx.textAlign = 'center';
    stats.forEach((s, i) => {
        const sx = PAD + colW * i + colW / 2;
        ctx.fillStyle = '#16181c';
        ctx.font = '800 78px system-ui';
        ctx.fillText(s.v, sx, y);
        ctx.fillStyle = '#8a8d93';
        ctx.font = '500 30px system-ui';
        ctx.fillText(s.l, sx, y + 50);
    });
    ctx.textAlign = 'left';
    // Footer — brand + tap hint
    ctx.fillStyle = color;
    ctx.font = '700 38px system-ui';
    ctx.fillText('MapYou', PAD, H - 90);
    ctx.fillStyle = '#8a8d93';
    ctx.font = '500 30px system-ui';
    ctx.textAlign = 'right';
    ctx.fillText('Tap to view activity ›', W - PAD, H - 92);
    ctx.textAlign = 'left';
    return await new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/jpeg', 0.92));
}
//# sourceMappingURL=ShareImage.js.map