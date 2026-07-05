// ─── LIVE WORKOUT NOTIFICATION (lock screen stats) ───────────────────────────
// Shows a persistent, silent notification with live distance / time / pace
// while a workout records — Strava style. Uses @capacitor/local-notifications
// (read from the global Capacitor.Plugins registry; no npm import — no bundler).
//
// This runs ALONGSIDE the background-geolocation foreground-service
// notification: that one keeps the process alive (fixed text), this one carries
// the live numbers. Updated at most every UPDATE_MS to stay battery-friendly.
// Re-posting on the same notification id updates it in place (no blink/sound —
// channel importance is LOW and we mark it ongoing).

interface LocalNotifPlugin {
  requestPermissions(): Promise<{ display: string }>;
  checkPermissions(): Promise<{ display: string }>;
  schedule(opts: { notifications: Array<Record<string, unknown>> }): Promise<unknown>;
  cancel(opts: { notifications: Array<{ id: number }> }): Promise<void>;
  createChannel?(channel: Record<string, unknown>): Promise<void>;
}

function lnPlugin(): LocalNotifPlugin | null {
  const cap = (globalThis as unknown as { Capacitor?: { Plugins?: Record<string, unknown>; isNativePlatform?: () => boolean } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.['LocalNotifications'] as LocalNotifPlugin | undefined) ?? null;
}

const NOTIF_ID = 4242;
const CHANNEL_ID = 'workout_live';
const UPDATE_MS = 3000;

class WorkoutNotification {
  private _active = false;
  private _lastPost = 0;
  private _channelReady = false;
  private _permOk: boolean | null = null;

  isAvailable(): boolean { return lnPlugin() !== null; }

  private async _ensureReady(p: LocalNotifPlugin): Promise<boolean> {
    if (this._permOk === null) {
      try {
        let st = await p.checkPermissions();
        if (st.display !== 'granted') st = await p.requestPermissions();
        this._permOk = st.display === 'granted';
      } catch { this._permOk = false; }
    }
    if (!this._permOk) return false;
    if (!this._channelReady && p.createChannel) {
      try {
        await p.createChannel({
          id: CHANNEL_ID,
          name: 'Live workout',
          description: 'Live stats while recording a workout',
          importance: 2,        // LOW → no sound, stays quiet on updates
          visibility: 1,        // public → full content on the lock screen
          vibration: false,
          sound: undefined,
        });
      } catch { /* older plugin — default channel will be used */ }
      this._channelReady = true;
    }
    return true;
  }

  /** Start (or refresh) the live notification. Safe to call every stats tick —
   *  it throttles itself to one post per UPDATE_MS. */
  async update(title: string, body: string): Promise<void> {
    const p = lnPlugin();
    if (!p) return;
    const now = Date.now();
    if (this._active && now - this._lastPost < UPDATE_MS) return;
    if (!(await this._ensureReady(p))) return;
    this._lastPost = now;
    this._active = true;
    try {
      await p.schedule({
        notifications: [{
          id: NOTIF_ID,
          channelId: CHANNEL_ID,
          title,
          body,
          ongoing: true,        // not swipeable while workout runs
          autoCancel: false,
          silent: true,
          smallIcon: 'ic_stat_icon_config_sample', // falls back to app icon if absent
        }],
      });
    } catch { /* non-critical */ }
  }

  /** Remove the notification (workout finished/discarded). */
  async clear(): Promise<void> {
    this._active = false;
    this._lastPost = 0;
    const p = lnPlugin();
    if (!p) return;
    try { await p.cancel({ notifications: [{ id: NOTIF_ID }] }); } catch { /* ignore */ }
  }

  get active(): boolean { return this._active; }
}

export const workoutNotification = new WorkoutNotification();
