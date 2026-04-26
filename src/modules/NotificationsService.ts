// ─── NOTIFICATIONS SERVICE ────────────────────────────────────────────────────
// src/modules/NotificationsService.ts
//
// Local in-app notification system (NOT push).
// Stored in localStorage. Future: sync with backend for friends' activity.

const LS_KEY = 'mapyou_notifications';
const LS_SEEN = 'mapyou_notifications_seen';

// ── Types ─────────────────────────────────────────────────────────────────────

export type NotifType =
  | 'activity_added'
  | 'achievement'
  | 'weekly_goal'
  | 'streak'
  | 'friend_activity'; // future backend

export interface AppNotification {
  id:        string;
  type:      NotifType;
  title:     string;
  body:      string;
  timestamp: number;
  read:      boolean;
  icon?:     string;   // emoji or avatar URL
}

// ── Storage ───────────────────────────────────────────────────────────────────

function _load(): AppNotification[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) ?? '[]') as AppNotification[];
  } catch { return []; }
}

function _save(notifs: AppNotification[]): void {
  // Keep max 50
  localStorage.setItem(LS_KEY, JSON.stringify(notifs.slice(0, 50)));
}

// ── Public API ─────────────────────────────────────────────────────────────────

export function addNotification(
  type: NotifType,
  title: string,
  body: string,
  icon = '🔔',
): AppNotification {
  const notifs = _load();
  const n: AppNotification = {
    id:        `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    type,
    title,
    body,
    timestamp: Date.now(),
    read:      false,
    icon,
  };
  notifs.unshift(n);
  _save(notifs);
  _notifyListeners();
  return n;
}

export function getNotifications(): AppNotification[] {
  return _load();
}

export function getUnreadCount(): number {
  return _load().filter(n => !n.read).length;
}

export function markAllRead(): void {
  const notifs = _load().map(n => ({ ...n, read: true }));
  _save(notifs);
  _notifyListeners();
}

export function markRead(id: string): void {
  const notifs = _load().map(n => n.id === id ? { ...n, read: true } : n);
  _save(notifs);
  _notifyListeners();
}

export function clearAll(): void {
  _save([]);
  _notifyListeners();
}

// ── Listeners (for bell badge update) ────────────────────────────────────────

type Listener = (count: number) => void;
const _listeners: Listener[] = [];

export function onNotificationsChange(cb: Listener): () => void {
  _listeners.push(cb);
  return () => { const i = _listeners.indexOf(cb); if (i >= 0) _listeners.splice(i, 1); };
}

function _notifyListeners(): void {
  const count = getUnreadCount();
  _listeners.forEach(cb => cb(count));
}

// ── Pre-built triggers ────────────────────────────────────────────────────────

export function notifyActivityAdded(name: string, distKm: number, sport: string): void {
  const icons: Record<string, string> = { running: '🏃', walking: '🚶', cycling: '🚴' };
  addNotification(
    'activity_added',
    `${icons[sport] ?? '🏅'} Activity saved!`,
    `${name} — ${distKm.toFixed(2)} km. Check your stats!`,
    icons[sport] ?? '🏅',
  );
}

export function notifyAchievement(title: string, desc: string): void {
  addNotification('achievement', `🏆 ${title}`, desc, '🏆');
}

export function notifyWeeklyGoal(weeksCount: number): void {
  addNotification(
    'weekly_goal',
    '🎯 Weekly goal reached!',
    `Amazing — you crushed it! That's ${weeksCount} week${weeksCount > 1 ? 's' : ''} in a row.`,
    '🎯',
  );
}

export function notifyStreak(weeks: number): void {
  addNotification(
    'streak',
    `🔥 ${weeks}-week streak!`,
    `Consistency is key. Keep the momentum going!`,
    '🔥',
  );
}
