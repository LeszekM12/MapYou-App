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
// Theme (MapYou dark)
const BG = '#141417';
const ACCENT = '#4ade80';
const TEXT = '#ffffff';
const MUTED = '#9ca3af';
const WARN = '#fbbf24';
const UPDATE_MS = 1000; // tracker ticks at 1 s — push every tick, no faster
function statCol(valueKey, label, valueColor) {
    return {
        type: 'container',
        properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
        children: [
            { type: 'text', properties: [{ text: `{{${valueKey}}}` }, { fontSize: 22 }, { fontWeight: 'bold' }, { color: valueColor }, { monospacedDigit: true }] },
            { type: 'text', properties: [{ text: label }, { fontSize: 11 }, { color: MUTED }] },
        ],
    };
}
function lockLayout(sport, sportLabel) {
    return {
        type: 'container',
        properties: [
            { direction: 'vertical' }, { spacing: 10 }, { padding: 14 },
            { backgroundColor: BG }, { cornerRadius: 16 },
        ],
        children: [
            {
                type: 'container',
                properties: [{ direction: 'horizontal' }, { spacing: 8 }],
                children: [
                    { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: ACCENT }, { width: 18 }, { height: 18 }] },
                    { type: 'text', properties: [{ text: `MapYou · ${sportLabel}` }, { fontSize: 14 }, { fontWeight: 'semibold' }, { color: TEXT }] },
                    { type: 'text', properties: [{ text: '{{state}}' }, { fontSize: 12 }, { color: WARN }] },
                ],
            },
            {
                type: 'container',
                properties: [{ direction: 'horizontal' }, { spacing: 24 }],
                children: [
                    statCol('time', 'TIME', TEXT),
                    statCol('dist', 'DISTANCE', ACCENT),
                    { type: 'container',
                        properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
                        children: [
                            { type: 'text', properties: [{ text: '{{third}}' }, { fontSize: 22 }, { fontWeight: 'bold' }, { color: TEXT }, { monospacedDigit: true }] },
                            { type: 'text', properties: [{ text: '{{thirdLabel}}' }, { fontSize: 11 }, { color: MUTED }] },
                        ] },
                ],
            },
        ],
    };
}
function islandLayout(sport, sportLabel) {
    const icon = { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: ACCENT }] };
    return {
        compactLeading: icon,
        compactTrailing: { type: 'text', properties: [{ text: '{{time}}' }, { color: ACCENT }, { monospacedDigit: true }] },
        minimal: icon,
        expanded: {
            leading: { type: 'text', properties: [{ text: '{{dist}}' }, { fontSize: 16 }, { fontWeight: 'bold' }, { color: ACCENT }] },
            trailing: { type: 'text', properties: [{ text: '{{time}}' }, { fontSize: 16 }, { fontWeight: 'bold' }, { color: TEXT }, { monospacedDigit: true }] },
            bottom: { type: 'text', properties: [{ text: `${sportLabel} · {{third}} {{state}}` }, { fontSize: 13 }, { color: MUTED }] },
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
            const res = await p.startActivity({
                layout: lockLayout(sportKey, sportLabel),
                dynamicIslandLayout: islandLayout(sportKey, sportLabel),
                data: { time: '0:00', dist: '0.00 km', third: '--:--', thirdLabel: 'PACE', state: '' },
                behavior: { systemActionForegroundColor: ACCENT, keyLineTint: ACCENT },
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
            await p.updateActivity({ activityId: this._id, data: { ...s } });
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
                ...(final ? { data: { ...final, state: 'Finished' } } : {}),
            });
        }
        catch { /* non-critical */ }
    }
}
export const workoutLiveActivity = new WorkoutLiveActivity();
//# sourceMappingURL=liveActivity.js.map