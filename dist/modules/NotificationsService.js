// ─── NOTIFICATIONS SERVICE ────────────────────────────────────────────────────
// src/modules/NotificationsService.ts
//
// Local in-app notification system (NOT push).
// Stored in localStorage. Future: sync with backend for friends' activity.
const LS_KEY = 'mapyou_notifications';
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
export function addNotification(type, title, body, icon = '🔔') {
    const notifs = _load();
    const n = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        type,
        title,
        body,
        timestamp: Date.now(),
        read: false,
        icon,
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
    _save([]);
    _notifyListeners();
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
export function notifyActivityAdded(name, distKm, sport) {
    const icons = { running: '🏃', walking: '🚶', cycling: '🚴' };
    addNotification('activity_added', `${icons[sport] ?? '🏅'} Activity saved!`, `${name} — ${distKm.toFixed(2)} km. Check your stats!`, icons[sport] ?? '🏅');
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