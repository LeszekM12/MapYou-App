// ─── HEALTH DATA (Apple Health / Android Health Connect) ─────────────────────
// Platform-agnostic layer. The rest of the app talks ONLY to this module, so
// iOS (HealthKit) and Android (Health Connect) are just interchangeable adapters
// behind the same interface. Milestone 1 covers daily STEPS; workouts, heart
// rate, route etc. slot into the same interface later.

export interface HealthProvider {
  /** Is a real health source usable on this device/build? */
  isAvailable(): Promise<boolean>;
  /** Ask the OS for read permission (steps). Returns true if granted. */
  requestPermissions(): Promise<boolean>;
  /** Total steps in [startMs, endMs). */
  getSteps(startMs: number, endMs: number): Promise<number>;
}

const DAY = 86_400_000;
const dayKey = (ms: number): string => new Date(ms).toISOString().slice(0, 10); // YYYY-MM-DD
const startOfDay = (ms: number): number => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ─── Mock provider (web / PWA dev — no native bridge) ────────────────────────
// Gives plausible, stable step counts so the whole flow is testable in the
// browser before the native build exists.
class MockHealthProvider implements HealthProvider {
  async isAvailable(): Promise<boolean> { return true; }
  async requestPermissions(): Promise<boolean> { return true; }
  async getSteps(startMs: number, endMs: number): Promise<number> {
    let total = 0;
    for (let t = startOfDay(startMs); t < endMs; t += DAY) {
      const d = new Date(t);
      const seed = (d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate());
      const base = 3000 + ((seed * 2654435761) % 9000);       // 3k–12k, stable per date
      const future = t > Date.now();
      total += future ? 0 : Math.round(base);
    }
    return total;
  }
}

// ─── Native provider (Capacitor: Health Connect on Android, HealthKit on iOS) ─
// Capacitor plugins register themselves NATIVELY and are exposed on the global
// `Capacitor.Plugins` registry. We read the plugin from there instead of doing
// an npm-package import — this app has no bundler (plain tsc + native ES
// modules, often loaded from GitHub Pages via server.url), so a package
// specifier import would fail at runtime.

interface NativeHealthPlugin {
  isHealthAvailable(): Promise<{ available: boolean }>;
  requestHealthPermissions(opts: { permissions: string[] }): Promise<{ granted?: boolean } | void>;
  queryAggregated(opts: { startDate: string; endDate: string; dataType: string; bucket: string }): Promise<{ aggregatedData?: Array<{ value: number }> }>;
}

function getCapacitorPlugin(): NativeHealthPlugin | null {
  const cap = (globalThis as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown>; isPluginAvailable?: (n: string) => boolean };
  }).Capacitor;
  if (!cap?.Plugins) return null;
  // capacitor-health registers as "HealthPlugin"; check likely names defensively.
  const p = (cap.Plugins['HealthPlugin'] ?? cap.Plugins['Health'] ?? cap.Plugins['CapacitorHealth']) as NativeHealthPlugin | undefined;
  return p ?? null;
}

class NativeHealthProvider implements HealthProvider {
  private plugin(): NativeHealthPlugin | null {
    return getCapacitorPlugin();
  }

  async isAvailable(): Promise<boolean> {
    const p = this.plugin();
    if (!p) return false;
    try { return (await p.isHealthAvailable()).available; } catch { return false; }
  }

  async requestPermissions(): Promise<boolean> {
    const p = this.plugin();
    if (!p) return false;
    try {
      const r = await p.requestHealthPermissions({ permissions: ['READ_STEPS'] });
      return r ? (r.granted ?? true) : true;
    } catch { return false; }
  }

  async getSteps(startMs: number, endMs: number): Promise<number> {
    const p = this.plugin();
    if (!p) return 0;
    try {
      const r = await p.queryAggregated({
        startDate: new Date(startMs).toISOString(),
        endDate:   new Date(endMs).toISOString(),
        dataType:  'steps',
        bucket:    'day',
      });
      return (r.aggregatedData ?? []).reduce((s, x) => s + (x.value || 0), 0);
    } catch { return 0; }
  }
}

// ─── Provider selection ──────────────────────────────────────────────────────
function isNativePlatform(): boolean {
  const cap = (globalThis as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return !!cap?.isNativePlatform?.();
}

let _provider: HealthProvider | null = null;
let _providerKind: 'native' | 'mock' = 'mock';
export async function getHealthProvider(): Promise<HealthProvider> {
  if (_provider) return _provider;
  if (isNativePlatform()) {
    const native = new NativeHealthProvider();
    if (await native.isAvailable()) {
      // Ask the OS for read permission before the first real read. The system
      // sheet shows once; afterwards this resolves silently.
      await native.requestPermissions().catch(() => false);
      _provider = native; _providerKind = 'native';
      return native;
    }
  }
  _provider = new MockHealthProvider(); _providerKind = 'mock';
  return _provider;
}
/** 'native' = real Health Connect / HealthKit; 'mock' = demo numbers (web dev). */
export function getHealthProviderKind(): 'native' | 'mock' { return _providerKind; }

// ─── Permission gate (ask once, remember the answer) ─────────────────────────
const PERM_KEY = 'mapyou_health_perm';
export async function ensureStepPermission(): Promise<boolean> {
  if (localStorage.getItem(PERM_KEY) === 'granted') return true;
  const p = await getHealthProvider();
  const ok = await p.requestPermissions();
  if (ok) localStorage.setItem(PERM_KEY, 'granted');
  return ok;
}
export function hasAskedHealthPermission(): boolean {
  return localStorage.getItem(PERM_KEY) === 'granted';
}

// ─── Daily-steps cache + convenience reads ───────────────────────────────────
const CACHE_KEY = 'mapyou_daily_steps';
type StepCache = Record<string, number>;
function readCache(): StepCache {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as StepCache; } catch { return {}; }
}
function writeCache(c: StepCache): void {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(c)); } catch { /* ignore */ }
}

/** Steps for a single calendar day. Reads cache instantly, refreshes in bg. */
export async function getDaySteps(dayMs: number): Promise<number | null> {
  const p = await getHealthProvider();
  const start = startOfDay(dayMs);
  try {
    const steps = await p.getSteps(start, start + DAY);
    const c = readCache(); c[dayKey(start)] = steps; writeCache(c);
    return steps;
  } catch {
    const c = readCache();
    return c[dayKey(start)] ?? null;
  }
}

/** Steps for a 7-day window starting at weekStartMs. */
export async function getWeekSteps(weekStartMs: number): Promise<number | null> {
  const p = await getHealthProvider();
  const start = startOfDay(weekStartMs);
  try {
    const total = await p.getSteps(start, start + 7 * DAY);
    return total;
  } catch {
    return null;
  }
}

/** Cached value without hitting the provider (for instant first paint). */
export function getCachedDaySteps(dayMs: number): number | null {
  const c = readCache();
  return c[dayKey(startOfDay(dayMs))] ?? null;
}
