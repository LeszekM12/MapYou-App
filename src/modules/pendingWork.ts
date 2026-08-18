// ─── PENDING WORK THAT MUST SURVIVE THE APP BEING KILLED ─────────────────────
// src/modules/pendingWork.ts
//
// THE BUG THIS EXISTS TO FIX
// --------------------------
// Pressing Finish did two things in this order:
//
//   1. `Tracker.stop()` called `clearSession()` — the workout was wiped from
//      IndexedDB, because as far as the tracker was concerned it was done.
//   2. The save modal opened, holding the only remaining copy of the workout
//      in a JavaScript variable.
//
// Between those two moments the workout existed *only in memory*. Swipe the app
// away from the task switcher and an hour of running was gone for good, with no
// warning and nothing to recover.
//
// THE RULE THIS MODULE ENFORCES
// -----------------------------
// If something is waiting on a decision from the user, and losing it would mean
// losing their data, then it gets written to durable storage the moment it
// appears — and it gets restored before anything else when the app comes back.
//
// WHY localStorage AND NOT IndexedDB
// ----------------------------------
// `localStorage.setItem` is synchronous: it has finished by the time the next
// statement runs. IndexedDB writes are asynchronous and can be lost if the
// process dies mid-transaction — which is exactly the scenario we are guarding
// against. Slower, but it cannot half-write.
//
// Size is not a concern in practice: a 20 km run is roughly 4000 GPS points,
// about 100 KB of JSON, against a 5 MB budget.

import { dlog } from '../utils/log.js';

/** One kind of pending work. Add a member when a new screen needs the same
 *  protection — for example an unsaved activity edit. */
export type PendingKind = 'save-activity';

const KEY = (kind: PendingKind): string => `mapyou_pending_${kind}`;

/**
 * Store work that is waiting on the user.
 *
 * Call this *before* showing the UI that owns the decision, never after — the
 * gap between the two is precisely the window where data goes missing.
 */
export function storePending<T>(kind: PendingKind, payload: T): void {
  try {
    localStorage.setItem(KEY(kind), JSON.stringify({ at: Date.now(), payload }));
    dlog(`[Pending] stored: ${kind}`);
  } catch (e) {
    // Quota exceeded, or private mode. Nothing sensible to do beyond making
    // the failure visible — silently carrying on would recreate the very bug
    // this module exists to prevent.
    console.warn(`[Pending] could not store ${kind}:`, e);
  }
}

/** Anything older than this is treated as debris from a crash, not as work. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Read back pending work, or `null` if there is none.
 *
 * Entries older than a day are discarded: an unfinished workout from last week
 * is not something the user wants shoved in their face on launch.
 */
export function loadPending<T>(kind: PendingKind): T | null {
  try {
    const raw = localStorage.getItem(KEY(kind));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as { at?: number; payload?: T };
    if (!parsed?.payload) { clearPending(kind); return null; }

    if (typeof parsed.at === 'number' && Date.now() - parsed.at > MAX_AGE_MS) {
      dlog(`[Pending] discarding stale entry: ${kind}`);
      clearPending(kind);
      return null;
    }
    return parsed.payload;
  } catch {
    // Corrupt entry — drop it rather than crashing on every launch.
    clearPending(kind);
    return null;
  }
}

/** Call once the user has actually decided: saved, discarded, whatever. */
export function clearPending(kind: PendingKind): void {
  try {
    localStorage.removeItem(KEY(kind));
    dlog(`[Pending] cleared: ${kind}`);
  } catch { /* nothing to do */ }
}

/** Whether anything is waiting. Cheap enough to call on startup. */
export function hasPending(kind: PendingKind): boolean {
  try { return localStorage.getItem(KEY(kind)) !== null; } catch { return false; }
}
