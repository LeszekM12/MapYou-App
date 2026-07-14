// ─── STRAVA ARCHIVE IMPORT ───────────────────────────────────────────────────
// Migrates a full Strava account into MapYou from the official GDPR export
// (Settings → My Account → "Download or Request Your Archive"). Everything is
// parsed CLIENT-SIDE — the archive never leaves the device; only the resulting
// workouts sync to the user's own cloud like any other activity.
//
// Design notes:
// • activities.csv headers are LOCALISED to the account language, but the
//   column ORDER is stable — so we read by position (id=0, date=1, name=2,
//   type=3, desc=4, elapsed=5) and detect the Filename column by value shape.
// • The activity FILES are the source of truth for track/HR/elevation:
//   GPX, TCX and FIT are supported, each optionally gzipped (.gz — inflated
//   with the native DecompressionStream, no extra lib).
// • Dedupe: deterministic id `strava_<activityId>` checked against the
//   existing unified table — re-importing the same archive is a no-op.
// • Imported workouts are saved as visibility 'only_me' + muted, so a
//   300-activity history doesn't flood friends' feeds; they still count in
//   stats, history and the profile.
// • JSZip is loaded from CDN in index.html (global JSZip) — no bundler.
import { CS } from './cloudSync.js';
import { loadUnifiedWorkouts } from './UnifiedWorkout.js';
// ── Sport mapping (Strava → MapYou keys) ─────────────────────────────────────
// Keys: English CSV values + common Polish localisations + TCX/FIT hints.
const SPORT_MAP = {
    // EN (Strava CSV)
    'run': 'running', 'trail run': 'trail_run', 'walk': 'walking', 'hike': 'hiking',
    'ride': 'cycling', 'mountain bike ride': 'mtb', 'gravel ride': 'gravel',
    'e-bike ride': 'ebike', 'e-mountain bike ride': 'emtb', 'velomobile': 'velomobile',
    'handcycle': 'handcycle', 'virtual ride': 'cycling', 'virtual run': 'running',
    'skateboard': 'skateboard', 'inline skate': 'inline_skate', 'roller ski': 'roller_ski',
    'wheelchair': 'wheelchair', 'rowing': 'rowing', 'canoe': 'canoe', 'kayaking': 'kayak',
    'stand up paddling': 'sup', 'surf': 'surf', 'kitesurf': 'kitesurf', 'windsurf': 'windsurf',
    'swim': 'swimming', 'alpine ski': 'skiing', 'backcountry ski': 'backcountry_ski',
    'nordic ski': 'nordic_ski', 'snowboard': 'snowboard', 'snowshoe': 'snowshoe',
    'ice skate': 'ice_skate', 'tennis': 'tennis', 'badminton': 'badminton',
    'table tennis': 'table_tennis', 'pickleball': 'pickleball', 'padel': 'padel',
    'squash': 'squash', 'weight training': 'gym', 'workout': 'gym', 'crossfit': 'gym',
    'yoga': 'yoga', 'golf': 'golf', 'soccer': 'football', 'football': 'football',
    // PL (localised CSV)
    'bieg': 'running', 'bieg terenowy': 'trail_run', 'spacer': 'walking',
    'wędrówka': 'hiking', 'jazda na rowerze': 'cycling', 'kolarstwo górskie': 'mtb',
    'jazda gravelem': 'gravel', 'jazda na rowerze elektrycznym': 'ebike',
    'pływanie': 'swimming', 'narciarstwo alpejskie': 'skiing',
    'trening siłowy': 'gym', 'trening': 'gym', 'joga': 'yoga',
    // TCX Sport attr
    'running': 'running', 'biking': 'cycling', 'cycling': 'cycling',
    'walking': 'walking', 'hiking': 'hiking', 'swimming': 'swimming', 'other': '',
};
const CYCLE_SPORTS = new Set(['cycling', 'mtb', 'gravel', 'ebike', 'emtb', 'velomobile', 'handcycle']);
function mapSport(raw) {
    const key = (raw ?? '').trim().toLowerCase();
    return SPORT_MAP[key] || '';
}
function unifiedType(sport) {
    if (CYCLE_SPORTS.has(sport))
        return 'cycling';
    if (sport === 'walking' || sport === 'hiking' || sport === 'snowshoe')
        return 'walking';
    return 'running';
}
// FIT sport enum (subset)
const FIT_SPORT = {
    1: 'running', 2: 'cycling', 5: 'swimming', 11: 'walking', 17: 'hiking',
};
// ── CSV parsing (position-based, quote-aware) ─────────────────────────────────
function parseCsv(text) {
    const rows = [];
    let row = [], field = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQ) {
            if (c === '"') {
                if (text[i + 1] === '"') {
                    field += '"';
                    i++;
                }
                else
                    inQ = false;
            }
            else
                field += c;
        }
        else if (c === '"')
            inQ = true;
        else if (c === ',') {
            row.push(field);
            field = '';
        }
        else if (c === '\n' || c === '\r') {
            if (c === '\r' && text[i + 1] === '\n')
                i++;
            row.push(field);
            field = '';
            if (row.length > 1 || row[0] !== '')
                rows.push(row);
            row = [];
        }
        else
            field += c;
    }
    if (field !== '' || row.length) {
        row.push(field);
        rows.push(row);
    }
    return rows;
}
function parseActivitiesCsv(text) {
    const rows = parseCsv(text);
    if (rows.length < 2)
        return [];
    const body = rows.slice(1);
    // Detect the Filename column by value shape (headers are localised).
    let fileCol = -1;
    for (const r of body) {
        const idx = r.findIndex(v => /^activities\/.+\.(gpx|tcx|fit)(\.gz)?$/i.test(v.trim()));
        if (idx >= 0) {
            fileCol = idx;
            break;
        }
    }
    // Heuristic: Moving Time usually sits 4 columns after Filename; validate later.
    const movingCol = fileCol >= 0 ? fileCol + 4 : -1;
    return body
        .filter(r => r.length >= 6 && r[0].trim() !== '')
        .map(r => {
        const elapsed = Math.round(Number(r[5]?.replace(',', '.')) || 0);
        let moving = null;
        if (movingCol >= 0 && r[movingCol] != null) {
            const m = Math.round(Number(String(r[movingCol]).replace(',', '.')));
            if (Number.isFinite(m) && m > 0 && m <= elapsed * 1.05)
                moving = m;
        }
        return {
            stravaId: r[0].trim(),
            dateStr: r[1]?.trim() ?? '',
            name: r[2]?.trim() ?? '',
            typeStr: r[3]?.trim() ?? '',
            desc: r[4]?.trim() ?? '',
            elapsedSec: elapsed,
            movingSec: moving,
            filename: fileCol >= 0 && r[fileCol]?.trim() ? r[fileCol].trim() : null,
        };
    });
}
// ── GZip via native DecompressionStream ───────────────────────────────────────
async function gunzip(data) {
    const ds = new DecompressionStream('gzip');
    const stream = new Blob([data]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
}
// ── GPX / TCX (DOMParser) ─────────────────────────────────────────────────────
function parseGpx(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const pts = [];
    const trkpts = doc.getElementsByTagName('trkpt');
    for (let i = 0; i < trkpts.length; i++) {
        const p = trkpts[i];
        const lat = Number(p.getAttribute('lat')), lng = Number(p.getAttribute('lon'));
        if (!Number.isFinite(lat) || !Number.isFinite(lng))
            continue;
        const timeEl = p.getElementsByTagName('time')[0];
        const eleEl = p.getElementsByTagName('ele')[0];
        // gpxtpx:hr lives in <extensions>; match by localName, namespace-agnostic
        let hr = null;
        const all = p.getElementsByTagName('*');
        for (let j = 0; j < all.length; j++) {
            if (all[j].localName === 'hr') {
                hr = Number(all[j].textContent) || null;
                break;
            }
        }
        pts.push({
            lat, lng,
            t: timeEl?.textContent ? Date.parse(timeEl.textContent) : null,
            ele: eleEl?.textContent ? Number(eleEl.textContent) : null,
            hr,
            distM: null,
        });
    }
    return { points: pts, sportHint: null, totalDistM: null, totalTimerSec: null,
        startMs: pts.find(p => p.t != null)?.t ?? null };
}
function parseTcx(xml) {
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const act = doc.getElementsByTagName('Activity')[0];
    const sportHint = act?.getAttribute('Sport') ?? null;
    const pts = [];
    const tps = doc.getElementsByTagName('Trackpoint');
    let lastDist = null;
    for (let i = 0; i < tps.length; i++) {
        const tp = tps[i];
        const latEl = tp.getElementsByTagName('LatitudeDegrees')[0];
        const lngEl = tp.getElementsByTagName('LongitudeDegrees')[0];
        const tEl = tp.getElementsByTagName('Time')[0];
        const eleEl = tp.getElementsByTagName('AltitudeMeters')[0];
        const dEl = tp.getElementsByTagName('DistanceMeters')[0];
        const hrEl = tp.getElementsByTagName('HeartRateBpm')[0]?.getElementsByTagName('Value')[0];
        if (dEl?.textContent)
            lastDist = Number(dEl.textContent) || lastDist;
        const lat = latEl ? Number(latEl.textContent) : NaN;
        const lng = lngEl ? Number(lngEl.textContent) : NaN;
        if (!Number.isFinite(lat) || !Number.isFinite(lng))
            continue;
        pts.push({
            lat, lng,
            t: tEl?.textContent ? Date.parse(tEl.textContent) : null,
            ele: eleEl?.textContent ? Number(eleEl.textContent) : null,
            hr: hrEl?.textContent ? Number(hrEl.textContent) || null : null,
            distM: lastDist,
        });
    }
    return { points: pts, sportHint, totalDistM: lastDist, totalTimerSec: null,
        startMs: pts.find(p => p.t != null)?.t ?? null };
}
// ── FIT (minimal binary parser: record + session messages) ────────────────────
const FIT_EPOCH_MS = Date.UTC(1989, 11, 31); // FIT timestamps count from 1989-12-31
function parseFit(buf) {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const headerSize = dv.getUint8(0);
    const dataSize = dv.getUint32(4, true);
    let off = headerSize;
    const end = Math.min(headerSize + dataSize, buf.byteLength);
    const defs = new Map();
    const pts = [];
    let sportHint = null;
    let totalDistM = null;
    let totalTimerSec = null;
    let lastTs = null; // for compressed-timestamp headers
    const SC = 180 / 2 ** 31; // semicircles → degrees
    const readField = (little, size, base) => {
        const t = base & 0x1f;
        let v;
        switch (t) {
            case 0x00:
            case 0x02:
                v = dv.getUint8(off);
                if (v === 0xff)
                    return null;
                break; // enum/uint8
            case 0x01:
                v = dv.getInt8(off);
                if (v === 0x7f)
                    return null;
                break; // sint8
            case 0x03:
                v = dv.getInt16(off, little);
                if (v === 0x7fff)
                    return null;
                break; // sint16
            case 0x04:
                v = dv.getUint16(off, little);
                if (v === 0xffff)
                    return null;
                break; // uint16
            case 0x05:
                v = dv.getInt32(off, little);
                if (v === 0x7fffffff)
                    return null;
                break; // sint32
            case 0x06:
            case 0x0c:
                v = dv.getUint32(off, little);
                if (v === 0xffffffff)
                    return null;
                break; // uint32
            default: return null; // strings/floats/64-bit — not needed for our fields
        }
        return v;
    };
    while (off < end) {
        const hdr = dv.getUint8(off);
        off++;
        if (hdr & 0x80) {
            // Compressed-timestamp data message
            const local = (hdr >> 5) & 0x3;
            const def = defs.get(local);
            if (!def)
                break;
            const tsOffset = hdr & 0x1f;
            if (lastTs != null)
                lastTs = (lastTs & ~0x1f) + tsOffset + (tsOffset < (lastTs & 0x1f) ? 0x20 : 0);
            readDataMsg(def, lastTs);
        }
        else if (hdr & 0x40) {
            // Definition message
            const local = hdr & 0x0f;
            off++; // reserved
            const little = dv.getUint8(off) === 0;
            off++;
            const global = little ? dv.getUint16(off, true) : dv.getUint16(off, false);
            off += 2;
            const n = dv.getUint8(off);
            off++;
            const fields = [];
            for (let i = 0; i < n; i++) {
                fields.push({ num: dv.getUint8(off), size: dv.getUint8(off + 1), base: dv.getUint8(off + 2) });
                off += 3;
            }
            let devBytes = 0;
            if (hdr & 0x20) { // developer fields present
                const dn = dv.getUint8(off);
                off++;
                for (let i = 0; i < dn; i++) {
                    devBytes += dv.getUint8(off + 1);
                    off += 3;
                }
            }
            defs.set(local, { global, little, fields, devBytes });
        }
        else {
            // Normal data message
            const def = defs.get(hdr & 0x0f);
            if (!def)
                break;
            readDataMsg(def, null);
        }
    }
    function readDataMsg(def, compressedTs) {
        let lat = null, lng = null, ele = null;
        let hr = null, dist = null, ts = compressedTs;
        for (const f of def.fields) {
            const isTarget = def.global === 20 || def.global === 18;
            const v = isTarget ? readField(def.little, f.size, f.base) : null;
            if (def.global === 20) { // record
                if (f.num === 253 && v != null)
                    ts = v;
                else if (f.num === 0 && v != null)
                    lat = v * SC;
                else if (f.num === 1 && v != null)
                    lng = v * SC;
                else if (f.num === 2 && v != null)
                    ele = v / 5 - 500;
                else if (f.num === 78 && v != null)
                    ele = v / 5 - 500;
                else if (f.num === 3 && v != null)
                    hr = v;
                else if (f.num === 5 && v != null)
                    dist = v / 100;
            }
            else if (def.global === 18) { // session
                if (f.num === 5 && v != null)
                    sportHint = FIT_SPORT[v] ?? sportHint;
                else if (f.num === 8 && v != null)
                    totalTimerSec = v / 1000;
                else if (f.num === 9 && v != null)
                    totalDistM = v / 100;
            }
            off += f.size;
        }
        off += def.devBytes;
        if (def.global === 20) {
            if (ts != null)
                lastTs = ts;
            if (lat != null && lng != null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
                pts.push({ lat, lng, t: ts != null ? FIT_EPOCH_MS + ts * 1000 : null, ele, hr, distM: dist });
            }
        }
    }
    return { points: pts, sportHint, totalDistM, totalTimerSec,
        startMs: pts.find(p => p.t != null)?.t ?? null };
}
// ── Track → metrics ───────────────────────────────────────────────────────────
function haversineM(a, b) {
    const R = 6371000, dLat = (b.lat - a.lat) * Math.PI / 180, dLng = (b.lng - a.lng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 +
        Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}
function trackMetrics(t) {
    const pts = t.points;
    let distM = t.totalDistM ?? 0;
    if (!distM && pts.length > 1) {
        for (let i = 1; i < pts.length; i++) {
            const d = haversineM(pts[i - 1], pts[i]);
            if (d < 100)
                distM += d; // GPS-jump guard
        }
    }
    // Elevation gain: positive deltas over a small noise floor
    let elevGain = 0;
    let lastEle = null;
    const elevSeries = [];
    let cumM = 0;
    for (let i = 0; i < pts.length; i++) {
        if (i > 0)
            cumM += Math.min(haversineM(pts[i - 1], pts[i]), 100);
        const e = pts[i].ele;
        if (e == null)
            continue;
        if (lastEle != null && e - lastEle > 0.5)
            elevGain += e - lastEle;
        lastEle = e;
        if (elevSeries.length === 0 || cumM - elevSeries[elevSeries.length - 1][0] >= Math.max(50, distM / 200)) {
            elevSeries.push([Math.round(cumM), Math.round(e)]);
        }
    }
    // HR: downsampled [secOffset, bpm]
    const start = t.startMs;
    const hrRaw = pts.filter(p => p.hr != null && p.t != null);
    let hrSeries = null;
    let avgHr = null, maxHr = null;
    if (hrRaw.length > 3 && start != null) {
        let sum = 0;
        maxHr = 0;
        hrSeries = [];
        const span = (hrRaw[hrRaw.length - 1].t - start) / 1000;
        const step = Math.max(5, Math.floor(span / 360));
        let nextAt = 0;
        for (const p of hrRaw) {
            const sec = Math.round((p.t - start) / 1000);
            sum += p.hr;
            if (p.hr > maxHr)
                maxHr = p.hr;
            if (sec >= nextAt) {
                hrSeries.push([sec, p.hr]);
                nextAt = sec + step;
            }
        }
        avgHr = Math.round(sum / hrRaw.length);
    }
    return {
        distanceKm: distM / 1000,
        elevGain: Math.round(elevGain),
        hrSeries, avgHr, maxHr,
        elevSeries: elevSeries.length > 2 ? elevSeries : null,
    };
}
// ── Localised CSV date fallback (only for file-less entries) ─────────────────
const PL_MONTHS = {
    'sty': 0, 'lut': 1, 'mar': 2, 'kwi': 3, 'maj': 4, 'cze': 5,
    'lip': 6, 'sie': 7, 'wrz': 8, 'paź': 9, 'paz': 9, 'lis': 10, 'gru': 11,
};
function parseCsvDate(s) {
    const direct = Date.parse(s);
    if (!Number.isNaN(direct))
        return direct;
    // e.g. "22 cze 2026, 17:14:33"
    const m = s.toLowerCase().match(/(\d{1,2})\s+([a-ząćęłńóśźż]{3})[a-ząćęłńóśźż]*\s+(\d{4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (m && PL_MONTHS[m[2]] != null) {
        return new Date(Number(m[3]), PL_MONTHS[m[2]], Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)).getTime();
    }
    return null;
}
async function parseActivityFile(zip, path) {
    // Archives sometimes reference "foo.gpx" while containing "foo.gpx.gz" (or vice versa)
    const entry = zip.file(path) ?? zip.file(path + '.gz') ?? zip.file(path.replace(/\.gz$/i, ''));
    if (!entry)
        return null;
    const isGz = /\.gz$/i.test(path) || (!zip.file(path) && !!zip.file(path + '.gz'));
    let bytes = await entry.async('uint8array');
    if (isGz)
        bytes = await gunzip(bytes);
    const lower = path.replace(/\.gz$/i, '').toLowerCase();
    if (lower.endsWith('.gpx'))
        return parseGpx(new TextDecoder().decode(bytes));
    if (lower.endsWith('.tcx'))
        return parseTcx(new TextDecoder().decode(bytes));
    if (lower.endsWith('.fit'))
        return parseFit(bytes);
    return null;
}
export async function importStravaArchive(zipData, onProgress) {
    const zip = await JSZip.loadAsync(zipData);
    const csvEntry = zip.file('activities.csv');
    if (!csvEntry)
        throw new Error('W archiwum nie znaleziono activities.csv — czy to na pewno eksport ze Stravy?');
    const activities = parseActivitiesCsv(await csvEntry.async('string'));
    // Existing ids → duplicates are skipped silently
    const existing = new Set((await loadUnifiedWorkouts()).map(w => w.id));
    const summary = { total: activities.length, imported: 0, duplicates: 0, failed: 0, failedNames: [] };
    let done = 0;
    for (const a of activities) {
        done++;
        onProgress(done, activities.length, a.name || a.typeStr || a.stravaId);
        const id = `strava_${a.stravaId}`;
        if (existing.has(id)) {
            summary.duplicates++;
            continue;
        }
        try {
            let track = null;
            if (a.filename)
                track = await parseActivityFile(zip, a.filename);
            const sport = mapSport(a.typeStr) || mapSport(track?.sportHint) || 'running';
            const startMs = track?.startMs ?? parseCsvDate(a.dateStr) ?? Date.now();
            const metrics = track ? trackMetrics(track) : {
                distanceKm: 0, elevGain: 0, hrSeries: null, avgHr: null, maxHr: null, elevSeries: null,
            };
            const durationSec = a.movingSec
                ?? (track?.totalTimerSec != null ? Math.round(track.totalTimerSec) : null)
                ?? a.elapsedSec;
            const distanceKm = metrics.distanceKm;
            const durMin = durationSec / 60;
            const isCycle = CYCLE_SPORTS.has(sport);
            const coords = (track?.points ?? []).map(p => [p.lat, p.lng]);
            const enriched = {
                id,
                sport,
                date: startMs,
                name: a.name || '',
                description: a.desc || '',
                photoUrl: null,
                distanceKm,
                durationSec,
                paceMinKm: !isCycle && distanceKm > 0.01 ? durMin / distanceKm : 0,
                speedKmH: durMin > 0 ? distanceKm / (durMin / 60) : 0,
                intensity: 3,
                notes: '',
                visibility: 'only_me', // migrated history stays private…
                muted: true, // …and out of friends' feeds
                coords,
                avgHr: metrics.avgHr, maxHr: metrics.maxHr,
                hrSeries: metrics.hrSeries,
                calories: null,
                elevGain: metrics.elevGain,
                elevSeries: metrics.elevSeries,
                source: 'manual',
                sourceId: id,
                sourceName: 'Strava',
            };
            await CS.saveEnrichedActivity(enriched);
            await CS.saveUnifiedWorkout({
                id,
                type: unifiedType(sport),
                sport,
                source: 'manual',
                date: new Date(startMs).toISOString(),
                distanceKm,
                durationSec,
                paceMinKm: enriched.paceMinKm,
                speedKmH: enriched.speedKmH,
                elevGain: metrics.elevGain,
                coords,
                name: enriched.name,
                description: enriched.description,
                notes: '',
                intensity: 3,
                photoUrl: null,
            });
            existing.add(id);
            summary.imported++;
        }
        catch (e) {
            summary.failed++;
            if (summary.failedNames.length < 10)
                summary.failedNames.push(a.name || a.stravaId);
            console.warn('[StravaImport] failed:', a.stravaId, e);
        }
        // Yield to the UI thread between activities
        await new Promise(r => setTimeout(r, 0));
    }
    return summary;
}
// ── UI: modal with instructions, picker, progress and summary ─────────────────
export function showStravaImportModal() {
    document.getElementById('stravaImportModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'stravaImportModal';
    modal.className = 'name-modal';
    modal.innerHTML = `
    <div class="name-modal__card">
      <div class="name-modal__icon">🧳</div>
      <h2 class="name-modal__title">Import ze Stravy</h2>
      <p class="name-modal__sub" style="text-align:left">
        1. Na stravie: <b>Settings → My Account → Download or Request Your Archive</b>.<br>
        2. Strava wyśle Ci e-mail z linkiem do pliku ZIP (do kilku godzin).<br>
        3. Wybierz ten ZIP poniżej — wszystkie treningi (trasy, tętno, przewyższenia)
        trafią do MapYou. Import jest prywatny: nic nie pojawi się w feedzie znajomych.
      </p>
      <input type="file" id="stravaZipInput" accept=".zip,application/zip"
             style="margin:10px 0;width:100%" />
      <div id="stravaImportStatus" style="font-size:13px;min-height:38px;margin:6px 0"></div>
      <div id="stravaImportBar" style="height:6px;background:rgba(128,128,128,.25);border-radius:3px;overflow:hidden;display:none">
        <div id="stravaImportBarFill" style="height:100%;width:0%;background:#00c46a;transition:width .2s"></div>
      </div>
      <button class="name-modal__btn" id="stravaImportStart" disabled>Importuj 🧳</button>
      <button class="name-modal__recover-link" id="stravaImportClose">Zamknij</button>
    </div>`;
    document.body.appendChild(modal);
    const input = modal.querySelector('#stravaZipInput');
    const status = modal.querySelector('#stravaImportStatus');
    const bar = modal.querySelector('#stravaImportBar');
    const fill = modal.querySelector('#stravaImportBarFill');
    const startBtn = modal.querySelector('#stravaImportStart');
    const closeBtn = modal.querySelector('#stravaImportClose');
    closeBtn.addEventListener('click', () => modal.remove());
    input.addEventListener('change', () => { startBtn.disabled = !input.files?.length; });
    startBtn.addEventListener('click', async () => {
        const file = input.files?.[0];
        if (!file)
            return;
        if (typeof JSZip === 'undefined') {
            status.textContent = '❌ Brak biblioteki ZIP (JSZip) — sprawdź połączenie i odśwież aplikację.';
            return;
        }
        startBtn.disabled = true;
        input.disabled = true;
        closeBtn.textContent = 'Przerwij i zamknij';
        bar.style.display = 'block';
        status.textContent = 'Otwieram archiwum…';
        try {
            const data = await file.arrayBuffer();
            const summary = await importStravaArchive(data, (d, t, label) => {
                fill.style.width = `${Math.round((d / t) * 100)}%`;
                status.textContent = `Importuję ${d}/${t}: ${label}`;
            });
            fill.style.width = '100%';
            status.innerHTML =
                `✅ Zaimportowano: <b>${summary.imported}</b>` +
                    (summary.duplicates ? ` · pominięte duplikaty: ${summary.duplicates}` : '') +
                    (summary.failed ? ` · ⚠️ nieudane: ${summary.failed} (${summary.failedNames.join(', ')}${summary.failed > 10 ? '…' : ''})` : '') +
                    `<br>Odśwież aplikację, aby zobaczyć treningi.`;
            closeBtn.textContent = 'Odśwież aplikację';
            closeBtn.onclick = () => location.reload();
        }
        catch (e) {
            status.textContent = `❌ ${e instanceof Error ? e.message : 'Import nie powiódł się.'}`;
            startBtn.disabled = false;
            input.disabled = false;
        }
    });
}
//# sourceMappingURL=stravaImport.js.map