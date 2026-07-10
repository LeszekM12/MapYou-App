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

interface LAStartResult { activityId?: string }

interface LAPlugin {
  startActivity(opts: Record<string, unknown>): Promise<LAStartResult>;
  updateActivity(opts: Record<string, unknown>): Promise<unknown>;
  endActivity(opts: Record<string, unknown>): Promise<unknown>;
}

function laPlugin(): LAPlugin | null {
  const cap = (globalThis as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown>; getPlatform?: () => string };
  }).Capacitor;
  if (cap?.getPlatform?.() !== 'ios') return null;
  return (cap.Plugins?.['LiveActivities'] as LAPlugin | undefined) ?? null;
}

// Sport key → SF Symbol (native iOS icon set). Fixed per workout, set at start.
const SF_ICONS: Record<string, string> = {
  running: 'figure.run',          trail_run: 'figure.run',
  walking: 'figure.walk',         hiking: 'figure.hiking',
  cycling: 'figure.outdoor.cycle', mtb: 'figure.outdoor.cycle',
  gravel: 'figure.outdoor.cycle', ebike: 'figure.outdoor.cycle',
  emtb: 'figure.outdoor.cycle',   velomobile: 'figure.outdoor.cycle',
  handcycle: 'figure.outdoor.cycle',
  inline_skate: 'figure.skating', skateboard: 'figure.skating',
  rowing: 'figure.rower',         canoe: 'figure.rower', kayak: 'figure.rower',
  swimming: 'figure.pool.swim',
};
function sfIcon(sport: string): string { return SF_ICONS[sport] ?? 'figure.run'; }

// Theme — resolved at activity start. The WebView's prefers-color-scheme
// mirrors the iOS system appearance, so the lock-screen card matches the
// phone's theme. (Layout ships at start, so a theme change applies from the
// next workout.) The Dynamic Island is always black glass — it keeps the
// dark palette regardless of theme.
interface Palette { bg: string; text: string; muted: string; accent: string; warn: string; }
const DARK_P:  Palette = { bg: '#141417', text: '#ffffff', muted: '#9ca3af', accent: '#4ade80', warn: '#fbbf24' };
const LIGHT_P: Palette = { bg: '#ffffff', text: '#111114', muted: '#6b7280', accent: '#16a34a', warn: '#d97706' };
function systemPalette(): Palette {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK_P : LIGHT_P;
  } catch { return DARK_P; }
}
// Island palette (fixed — the island pill is always dark)
const ISLAND_ACCENT = '#4ade80';
const ISLAND_TEXT   = '#ffffff';
const ISLAND_MUTED  = '#9ca3af';

/** Live values pushed on every update. All pre-formatted strings. */
export interface LiveStats {
  time: string;        // "28:00" / "1:02:11"
  dist: string;        // "5.02 km"
  third: string;       // "5:36 /km"  or  "24.3 km/h"
  thirdLabel: string;  // "PACE" | "SPEED"
  state: string;       // "" | "Paused" | "Auto-paused" | "Finished"
}

const UPDATE_MS = 1000; // tracker ticks at 1 s — push every tick, no faster

function statCol(valueKey: string, label: string, valueColor: string, p: Palette) {
  return {
    type: 'container',
    properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
    children: [
      { type: 'text', properties: [{ text: `{{${valueKey}}}` }, { fontSize: 22 }, { fontWeight: 'bold' }, { color: valueColor }, { monospacedDigit: true }] },
      { type: 'text', properties: [{ text: label }, { fontSize: 11 }, { color: p.muted }] },
    ],
  };
}

function lockLayout(sport: string, sportLabel: string, p: Palette) {
  return {
    type: 'container',
    properties: [
      { direction: 'vertical' }, { spacing: 10 }, { padding: 14 },
      { backgroundColor: p.bg }, { cornerRadius: 16 },
    ],
    children: [
      { // header: icon · "MapYou · Running" · state (right)
        type: 'container',
        properties: [{ direction: 'horizontal' }, { spacing: 8 }],
        children: [
          { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: p.accent }, { width: 18 }, { height: 18 }] },
          { type: 'text',  properties: [{ text: `MapYou · ${sportLabel}` }, { fontSize: 14 }, { fontWeight: 'semibold' }, { color: p.text }] },
          { type: 'text',  properties: [{ text: '{{state}}' }, { fontSize: 12 }, { color: p.warn }] },
        ],
      },
      { // stats row: TIME · DISTANCE · PACE/SPEED
        type: 'container',
        properties: [{ direction: 'horizontal' }, { spacing: 24 }],
        children: [
          statCol('time',  'TIME',            p.text,   p),
          statCol('dist',  'DISTANCE',        p.accent, p),
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

function islandLayout(sport: string, sportLabel: string) {
  const icon = { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: ISLAND_ACCENT }] };
  return {
    compactLeading:  icon,
    compactTrailing: { type: 'text', properties: [{ text: '{{time}}' }, { color: ISLAND_ACCENT }, { monospacedDigit: true }] },
    minimal:         icon,
    expanded: {
      leading:  { type: 'text', properties: [{ text: '{{dist}}' }, { fontSize: 16 }, { fontWeight: 'bold' }, { color: ISLAND_ACCENT }] },
      trailing: { type: 'text', properties: [{ text: '{{time}}' }, { fontSize: 16 }, { fontWeight: 'bold' }, { color: ISLAND_TEXT }, { monospacedDigit: true }] },
      bottom:   { type: 'text', properties: [{ text: `${sportLabel} · {{third}} {{state}}` }, { fontSize: 13 }, { color: ISLAND_MUTED }] },
    },
  };
}

class WorkoutLiveActivity {
  private _id: string | null = null;
  private _starting = false;
  private _lastPush = 0;

  isAvailable(): boolean { return laPlugin() !== null; }
  get active(): boolean  { return this._id !== null; }

  /** Begin the Live Activity for a new workout. Safe no-op off-iOS. */
  async start(sportKey: string, sportLabel: string): Promise<void> {
    const p = laPlugin();
    if (!p || this._id || this._starting) return;
    this._starting = true;
    try {
      const pal = systemPalette();
      const res = await p.startActivity({
        layout: lockLayout(sportKey, sportLabel, pal),
        dynamicIslandLayout: islandLayout(sportKey, sportLabel),
        data: { time: '0:00', dist: '0.00 km', third: '--:--', thirdLabel: 'PACE', state: '' },
        behavior: { systemActionForegroundColor: pal.accent, keyLineTint: pal.accent },
      });
      this._id = res?.activityId ?? null;
    } catch (e) {
      console.warn('[LiveActivity] start failed:', e);
    }
    this._starting = false;
  }

  /** Push fresh stats. Throttled to UPDATE_MS unless force=true
   *  (force is used for instant Pause/Resume state flips). */
  async update(s: LiveStats, force = false): Promise<void> {
    const p = laPlugin();
    if (!p || !this._id) return;
    const now = Date.now();
    if (!force && now - this._lastPush < UPDATE_MS) return;
    this._lastPush = now;
    try {
      await p.updateActivity({ activityId: this._id, data: { ...s } });
    } catch { /* non-critical */ }
  }

  /** End the activity. Pass final stats to leave a "Finished" card briefly;
   *  omit them (discard/reset) to just dismiss. */
  async end(final?: LiveStats): Promise<void> {
    const p = laPlugin();
    const id = this._id;
    this._id = null;
    this._lastPush = 0;
    if (!p || !id) return;
    try {
      await p.endActivity({
        activityId: id,
        ...(final ? { data: { ...final, state: 'Finished' } } : {}),
      });
    } catch { /* non-critical */ }
  }
}

export const workoutLiveActivity = new WorkoutLiveActivity();
