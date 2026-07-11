// ─── LIVE ACTIVITY (iOS 16.2+: lock screen card + Dynamic Island) ───────────
// Strava-style live workout stats rendered natively by ActivityKit.
// Uses the `capacitor-live-activities` plugin, read from the global
// Capacitor.Plugins registry (no npm import — no bundler, same pattern as
// workoutNotification.ts). iOS-only by design: laPlugin() returns null
// everywhere else, so every call is a safe no-op on Android/web.
//
// The layout (lock screen + island) is plain JSON sent at start — so the
// DESIGN can be iterated from Windows with a normal Pages push; no Xcode.
// Updates push only the data fields ({{placeholders}} in the layout).
function laPlugin() {
    const cap = globalThis.Capacitor;
    if (cap?.getPlatform?.() !== 'ios')
        return null;
    return cap.Plugins?.['LiveActivities'] ?? null;
}
// Sport key → SF Symbol (native iOS icon set). Fixed per workout, set at start.
const SF_ICONS = {
    running: 'figure.run', trail_run: 'figure.run',
    walking: 'figure.walk', hiking: 'figure.hiking',
    cycling: 'figure.outdoor.cycle', mtb: 'figure.outdoor.cycle',
    gravel: 'figure.outdoor.cycle', ebike: 'figure.outdoor.cycle',
    emtb: 'figure.outdoor.cycle', velomobile: 'figure.outdoor.cycle',
    handcycle: 'figure.outdoor.cycle',
    inline_skate: 'figure.skating', skateboard: 'figure.skating',
    rowing: 'figure.rower', canoe: 'figure.rower', kayak: 'figure.rower',
    swimming: 'figure.pool.swim',
};
function sfIcon(sport) { return SF_ICONS[sport] ?? 'figure.run'; }
const DARK_P = { bg: '#141417', text: '#ffffff', muted: '#9ca3af', accent: '#4ade80', warn: '#fbbf24' };
const LIGHT_P = { bg: '#ffffff', text: '#111114', muted: '#6b7280', accent: '#16a34a', warn: '#d97706' };
function systemPalette() {
    try {
        return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK_P : LIGHT_P;
    }
    catch {
        return DARK_P;
    }
}
// Island palette (fixed — the island pill is always dark)
const ISLAND_ACCENT = '#4ade80';
const ISLAND_TEXT = '#ffffff';
const ISLAND_MUTED = '#9ca3af';
function laData(s, pal) {
    const paused = s.paused;
    return {
        time: s.time, dist: s.dist, third: s.third, thirdLabel: s.thirdLabel,
        state: s.state, timerRef: s.timerRef,
        // Visibility — TWO independent mechanisms (belt & braces, both data-bound):
        // 1) opacity as STRINGS "1"/"0" (numeric 0/1 can be mis-decoded as Bool
        //    by the widget's JSON layer and then silently ignored),
        // 2) color swapped to the parser's 'clear' keyword when hidden.
        runOp: paused ? '0' : '1',
        pauseOp: paused ? '1' : '0',
        lockT: paused ? 'clear' : pal.text, lockF: paused ? pal.text : 'clear',
        cmpT: paused ? 'clear' : ISLAND_ACCENT, cmpF: paused ? ISLAND_ACCENT : 'clear',
        expT: paused ? 'clear' : ISLAND_TEXT, expF: paused ? ISLAND_TEXT : 'clear',
    };
}
/** TIME cell: native self-ticking timer overlaid (stack) with a frozen text.
 *  Data-bound opacity AND color decide which is visible — running vs paused.
 *  Apple's Text(.timer) is width-greedy and left-aligned, which shoved the
 *  lock-screen value sideways and inflated the Dynamic Island pill — hence
 *  the FIXED width + centered alignment on both layers. */
function timeStack(fontSize, colorKey, width) {
    const base = [
        { fontSize }, { fontWeight: 'bold' }, { monospacedDigit: true },
        { width }, { alignment: 'center' },
    ];
    return {
        type: 'container',
        properties: [{ direction: 'stack' }],
        children: [
            { type: 'timer', properties: [{ endTime: '{{timerRef}}' }, { style: 'timer' }, ...base, { color: `{{${colorKey}T}}` }, { opacity: '{{runOp}}' }] },
            { type: 'text', properties: [{ text: '{{time}}' }, ...base, { color: `{{${colorKey}F}}` }, { opacity: '{{pauseOp}}' }] },
        ],
    };
}
const UPDATE_MS = 1000; // tracker ticks at 1 s — push every tick, no faster
function statCol(valueKey, label, valueColor, p) {
    return {
        type: 'container',
        properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
        children: [
            { type: 'text', properties: [{ text: `{{${valueKey}}}` }, { fontSize: 22 }, { fontWeight: 'bold' }, { color: valueColor }, { monospacedDigit: true }] },
            { type: 'text', properties: [{ text: label }, { fontSize: 11 }, { color: p.muted }] },
        ],
    };
}
function lockLayout(sport, sportLabel, p) {
    return {
        type: 'container',
        properties: [
            { direction: 'vertical' }, { spacing: 10 }, { padding: 14 },
            { backgroundColor: p.bg }, { cornerRadius: 16 },
        ],
        children: [
            {
                type: 'container',
                properties: [{ direction: 'horizontal' }, { spacing: 8 }],
                children: [
                    { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: p.accent }, { width: 18 }, { height: 18 }] },
                    { type: 'text', properties: [{ text: `MapYou · ${sportLabel}` }, { fontSize: 14 }, { fontWeight: 'semibold' }, { color: p.text }] },
                    { type: 'text', properties: [{ text: '{{state}}' }, { fontSize: 12 }, { color: p.warn }] },
                ],
            },
            {
                type: 'container',
                properties: [{ direction: 'horizontal' }, { spacing: 24 }],
                children: [
                    { type: 'container',
                        properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
                        children: [
                            timeStack(22, 'lock', 96),
                            { type: 'text', properties: [{ text: 'TIME' }, { fontSize: 11 }, { color: p.muted }] },
                        ] },
                    statCol('dist', 'DISTANCE', p.accent, p),
                    { type: 'container',
                        properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
                        children: [
                            { type: 'text', properties: [{ text: '{{third}}' }, { fontSize: 22 }, { fontWeight: 'bold' }, { color: p.text }, { monospacedDigit: true }] },
                            { type: 'text', properties: [{ text: '{{thirdLabel}}' }, { fontSize: 11 }, { color: p.muted }] },
                        ] },
                ],
            },
        ],
    };
}
function islandLayout(sport, sportLabel) {
    const icon = { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: ISLAND_ACCENT }] };
    return {
        compactLeading: icon,
        compactTrailing: timeStack(13, 'cmp', 50),
        minimal: icon,
        expanded: {
            leading: { type: 'text', properties: [{ text: '{{dist}}' }, { fontSize: 16 }, { fontWeight: 'bold' }, { color: ISLAND_ACCENT }] },
            trailing: timeStack(16, 'exp', 64),
            bottom: { type: 'text', properties: [{ text: `${sportLabel} · {{third}} {{state}}` }, { fontSize: 13 }, { color: ISLAND_MUTED }] },
        },
    };
}
class WorkoutLiveActivity {
    constructor() {
        Object.defineProperty(this, "_id", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "_starting", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "_lastPush", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "_pal", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: DARK_P
        }); // chosen at start(), reused by update/end
    }
    isAvailable() { return laPlugin() !== null; }
    get active() { return this._id !== null; }
    /** Begin the Live Activity for a new workout. Safe no-op off-iOS. */
    async start(sportKey, sportLabel) {
        const p = laPlugin();
        if (!p || this._id || this._starting)
            return;
        this._starting = true;
        try {
            const pal = systemPalette();
            this._pal = pal;
            const res = await p.startActivity({
                layout: lockLayout(sportKey, sportLabel, pal),
                dynamicIslandLayout: islandLayout(sportKey, sportLabel),
                data: laData({ time: '0:00', dist: '0.00 km', third: '--:--', thirdLabel: 'PACE', state: '', timerRef: Date.now(), paused: false }, pal),
                behavior: { systemActionForegroundColor: pal.accent, keyLineTint: pal.accent },
            });
            this._id = res?.activityId ?? null;
        }
        catch (e) {
            console.warn('[LiveActivity] start failed:', e);
        }
        this._starting = false;
    }
    /** Push fresh stats. Throttled to UPDATE_MS unless force=true
     *  (force is used for instant Pause/Resume state flips). */
    async update(s, force = false) {
        const p = laPlugin();
        if (!p || !this._id)
            return;
        const now = Date.now();
        if (!force && now - this._lastPush < UPDATE_MS)
            return;
        this._lastPush = now;
        try {
            await p.updateActivity({ activityId: this._id, data: laData(s, this._pal) });
        }
        catch { /* non-critical */ }
    }
    /** End the activity. Pass final stats to leave a "Finished" card briefly;
     *  omit them (discard/reset) to just dismiss. */
    async end(final) {
        const p = laPlugin();
        const id = this._id;
        this._id = null;
        this._lastPush = 0;
        if (!p || !id)
            return;
        try {
            await p.endActivity({
                activityId: id,
                ...(final ? { data: laData({ ...final, state: 'Finished', paused: true }, this._pal) } : {}),
            });
        }
        catch { /* non-critical */ }
    }
}
export const workoutLiveActivity = new WorkoutLiveActivity();
//# sourceMappingURL=liveActivity.js.map