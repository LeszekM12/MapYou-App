// ─── NOTIFICATIONS SERVICE ────────────────────────────────────────────────────
// src/modules/NotificationsService.ts
//
// Local in-app notification system + backend sync for friends' activity.
// Stored in localStorage; backend notifications are merged in via syncFromBackend().
import { BACKEND_URL } from '../config.js';
const LS_KEY = 'mapyou_notifications';
const LS_CLEARED_AT = 'mapyou_notifs_cleared_at';
const LS_SEEN = 'mapyou_notifications_seen';
// ── Storage ───────────────────────────────────────────────────────────────────
function _load() {
    try {
        return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]');
    }
    catch {
        return [];
    }
}
function _save(notifs) {
    // Keep max 50
    localStorage.setItem(LS_KEY, JSON.stringify(notifs.slice(0, 50)));
}
// ── Public API ─────────────────────────────────────────────────────────────────
export function addNotification(type, title, body, icon = '🔔', target) {
    const notifs = _load();
    const n = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type,
        title,
        body,
        timestamp: Date.now(),
        read: false,
        icon,
        target,
    };
    notifs.unshift(n);
    _save(notifs);
    _notifyListeners();
    return n;
}
export function getNotifications() {
    return _load();
}
export function getUnreadCount() {
    return _load().filter(n => !n.read).length;
}
export function markAllRead() {
    const notifs = _load().map(n => ({ ...n, read: true }));
    _save(notifs);
    _notifyListeners();
}
export function markRead(id) {
    const notifs = _load().map(n => n.id === id ? { ...n, read: true } : n);
    _save(notifs);
    _notifyListeners();
}
export function clearAll() {
    // Zapamiętaj MOMENT czyszczenia. Backend nadal trzyma te powiadomienia
    // (kolekcja serwerowa jest współdzielona i nie kasujemy jej stąd), a
    // syncFromBackend() zaciągał je z powrotem od razu po wyjściu i wejściu
    // w dzwoneczek. Znacznik działa jak "przeczytane do tego momentu".
    localStorage.setItem(LS_CLEARED_AT, String(Date.now()));
    _save([]);
    _notifyListeners();
}
/** Build a deep-link target from a backend notification's type + meta string. */
function _targetFromBackend(type, meta) {
    if (!meta)
        return undefined;
    if (meta.startsWith('reel|')) {
        const author = meta.slice(5);
        return author ? { kind: 'reel', id: author, userId: author } : undefined;
    }
    if (meta.startsWith('live|')) {
        const [, token, author] = meta.split('|');
        return token ? { kind: 'live', id: token, userId: author } : undefined;
    }
    if (type === 'friend_activity' && meta.includes('|')) {
        const [actId, author] = meta.split('|');
        if (actId)
            return { kind: 'activity', id: actId, userId: author };
    }
    if (type === 'follow' || type === 'follow_request' || type === 'follow_accepted') {
        const uid = meta.split('|')[0];
        if (uid)
            return { kind: 'profile', id: uid, userId: uid };
    }
    return undefined;
}
/** Fetch the user's backend notifications and merge them into the local bell. */
export async function syncFromBackend(userId) {
    if (!userId)
        return;
    try {
        const res = await fetch(`${BACKEND_URL}/notifications?userId=${encodeURIComponent(userId)}`, { cache: 'no-store' });
        const j = await res.json();
        if (j.status !== 'ok' || !Array.isArray(j.data))
            return;
        const local = _load();
        const localIds = new Set(local.map(n => n.id));
        // Nie wskrzeszaj powiadomień skasowanych przez użytkownika (patrz clearAll)
        const clearedAt = Number(localStorage.getItem(LS_CLEARED_AT) ?? 0);
        const incoming = j.data
            .filter(b => b.notifId && !localIds.has(b.notifId) && b.timestamp > clearedAt)
            .map(b => ({
            id: b.notifId,
            type: b.type,
            title: b.title,
            body: b.body,
            timestamp: b.timestamp,
            read: b.read,
            icon: b.icon ?? '🔔',
            target: _targetFromBackend(b.type, b.meta),
        }));
        if (incoming.length === 0)
            return;
        const merged = [...incoming, ...local].sort((a, b) => b.timestamp - a.timestamp);
        _save(merged);
        _notifyListeners();
    }
    catch { /* offline: ignore */ }
}
/** Mark all backend notifications read (mirrors local markAllRead). */
export async function markAllReadRemote(userId) {
    if (!userId)
        return;
    try {
        await fetch(`${BACKEND_URL}/notifications/read-all?userId=${encodeURIComponent(userId)}`, { method: 'PUT' });
    }
    catch { /* ignore */ }
}
const _listeners = [];
export function onNotificationsChange(cb) {
    _listeners.push(cb);
    return () => { const i = _listeners.indexOf(cb); if (i >= 0)
        _listeners.splice(i, 1); };
}
function _notifyListeners() {
    const count = getUnreadCount();
    _listeners.forEach(cb => cb(count));
}
// ── Pre-built triggers ────────────────────────────────────────────────────────
export function notifyActivityAdded(name, distKm, sport, activityId) {
    const icons = { running: '🏃', walking: '🚶', cycling: '🚴' };
    addNotification('activity_added', `${icons[sport] ?? '🏅'} Activity saved!`, `${name} — ${distKm.toFixed(2)} km. Check your stats!`, icons[sport] ?? '🏅', activityId ? { kind: 'activity', id: activityId } : undefined);
}
/** Friend posted an activity — taps through to its detail screen. */
export function notifyFriendActivity(friendName, activityId, userId, icon = '🏃') {
    addNotification('friend_activity', `${friendName} shared an activity`, 'Tap to view their workout.', icon, { kind: 'activity', id: activityId, userId });
}
/** Friend posted a reel — taps through to the reel viewer. */
export function notifyFriendReel(friendName, userId, icon = '🎬') {
    addNotification('friend_activity', `${friendName} posted a reel`, 'Tap to watch.', icon, { kind: 'reel', id: userId, userId });
}
/** Friend started live tracking — taps through to the live map. */
export function notifyFriendLive(friendName, token, userId, icon = '📍') {
    addNotification('friend_activity', `${friendName} is live`, 'Tap to follow their route in real time.', icon, { kind: 'live', id: token, userId, name: `${friendName} — Live` });
}
export function notifyAchievement(title, desc) {
    addNotification('achievement', `🏆 ${title}`, desc, '🏆');
}
export function notifyWeeklyGoal(weeksCount) {
    addNotification('weekly_goal', '🎯 Weekly goal reached!', `Amazing — you crushed it! That's ${weeksCount} week${weeksCount > 1 ? 's' : ''} in a row.`, '🎯');
}
export function notifyStreak(weeks) {
    addNotification('streak', `🔥 ${weeks}-week streak!`, `Consistency is key. Keep the momentum going!`, '🔥');
}
//# sourceMappingURL=NotificationsService.js.map