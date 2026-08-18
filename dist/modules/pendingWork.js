// ─── WORK AWAITING A USER DECISION ───────────────────────────────────────────
// src/modules/pendingWork.ts
//
// THE BUG THIS EXISTS TO FIX
// --------------------------
// Pressing Finish did two things in this order:
//
//   1. `Tracker.stop()` called `clearSession()` — the workout was wiped from
//      IndexedDB, because as far as the tracker was concerned it was done.
//   2. The save sheet opened, holding the only remaining copy of the workout
//      in a JavaScript variable.
//
// Between those two moments the workout existed *only in memory*. Swipe the
// app away, or dismiss the sheet by accident, and an hour of running was gone.
//
// WHY THIS IS A QUEUE AND NOT A SINGLE SLOT
// -----------------------------------------
// The first version stored one record under a fixed key, so finishing a second
// workout silently overwrote the first. That breaks the case this app exists
// for: a triathlete finishes the swim, starts the bike, finishes that, starts
// the run — three workouts back to back, saved afterwards at leisure. Under a
// single-slot design the first two would simply vanish.
//
// Every finished workout now gets its own entry with its own id, and entries
// only leave when the user has actually decided what to do with them.
//
// WHY localStorage AND NOT IndexedDB
// ----------------------------------
// `localStorage.setItem` is synchronous: it has finished by the time the next
// statement runs. IndexedDB writes are asynchronous and can be lost if the
// process dies mid-transaction — exactly the scenario being guarded against.
// Slower, but it cannot half-write.
//
// Capacity is not a concern: a 20 km run is roughly 4000 GPS points, about
// 100 KB of JSON, against a 5 MB budget. A full triathlon is three of those.
import { dlog } from '../utils/log.js';
const KEY = (kind) => `mapyou_pending_${kind}`;
/** Anything older than this is treated as crash debris, not as work. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/**
 * How many entries we are willing to hold.
 *
 * A guard against a bug elsewhere filling storage, not a limit anyone should
 * reach: even an Ironman is three workouts. If it is ever hit, the oldest
 * entry is dropped — losing the stalest one beats failing to store the newest.
 */
const MAX_ITEMS = 20;
function readAll(kind) {
    try {
        const raw = localStorage.getItem(KEY(kind));
        if (!raw)
            return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed))
            return [];
        const now = Date.now();
        return parsed.filter(it => it && typeof it.id === 'string' && it.payload !== undefined
            && (typeof it.at !== 'number' || now - it.at <= MAX_AGE_MS));
    }
    catch {
        // Corrupt entry — drop it rather than crashing on every launch.
        try {
            localStorage.removeItem(KEY(kind));
        }
        catch { /* nothing to do */ }
        return [];
    }
}
function writeAll(kind, items) {
    try {
        localStorage.setItem(KEY(kind), JSON.stringify(items));
    }
    catch (e) {
        // Quota exceeded, or private browsing. Nothing sensible to do beyond
        // making the failure loud — carrying on silently would recreate the very
        // bug this module exists to prevent.
        console.warn(`[Pending] could not store ${kind}:`, e);
    }
}
/**
 * Queue work that is waiting on the user.
 *
 * Call this *before* showing the UI that owns the decision, never after — the
 * gap between the two is precisely where data goes missing.
 *
 * @returns the id of the new entry, so the caller can remove exactly this one
 *          once the user decides.
 */
export function addPending(kind, payload) {
    const items = readAll(kind);
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    items.push({ id, at: Date.now(), payload });
    while (items.length > MAX_ITEMS)
        items.shift();
    writeAll(kind, items);
    dlog(`[Pending] queued ${kind} (${items.length} waiting)`);
    return id;
}
/** Everything still waiting, oldest first. */
export function listPending(kind) {
    return readAll(kind);
}
/** A single entry, or `null` if it is already gone. */
export function getPending(kind, id) {
    return readAll(kind).find(it => it.id === id) ?? null;
}
/** Call once the user has decided about this one: saved, discarded, whatever. */
export function removePending(kind, id) {
    const items = readAll(kind);
    const left = items.filter(it => it.id !== id);
    if (left.length === items.length)
        return; // nothing to do
    writeAll(kind, left);
    dlog(`[Pending] resolved ${kind} (${left.length} left)`);
}
/** How many are waiting. Cheap enough to call on startup. */
export function countPending(kind) {
    return readAll(kind).length;
}
//# sourceMappingURL=pendingWork.js.map