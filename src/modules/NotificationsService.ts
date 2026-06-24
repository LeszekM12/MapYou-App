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

/** Deep-link target: tapping a notification jumps straight to this content. */
export interface NotifTarget {
  kind:    'activity' | 'reel' | 'live' | 'profile';
  id:      string;    // activityId | live token | userId (profile)
  userId?: string;    // whose content (reel / live / profile)
  name?:   string;    // optional display name (e.g. live tracking title)
}

export interface AppNotification {
  id:        string;
  type:      NotifType;
  title:     string;
  body:      string;
  timestamp: number;
  read:      boolean;
  icon?:     string;   // emoji or avatar URL
  target?:   NotifTarget; // deep-link destination
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
  target?: NotifTarget,
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
    target,
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

export function notifyActivityAdded(name: string, distKm: number, sport: string, activityId?: string): void {
  const icons: Record<string, string> = { running: '🏃', walking: '🚶', cycling: '🚴' };
  addNotification(
    'activity_added',
    `${icons[sport] ?? '🏅'} Activity saved!`,
    `${name} — ${distKm.toFixed(2)} km. Check your stats!`,
    icons[sport] ?? '🏅',
    activityId ? { kind: 'activity', id: activityId } : undefined,
  );
}

/** Friend posted an activity — taps through to its detail screen. */
export function notifyFriendActivity(friendName: string, activityId: string, userId: string, icon = '🏃'): void {
  addNotification('friend_activity', `${friendName} shared an activity`, 'Tap to view their workout.', icon,
    { kind: 'activity', id: activityId, userId });
}

/** Friend posted a reel — taps through to the reel viewer. */
export function notifyFriendReel(friendName: string, userId: string, icon = '🎬'): void {
  addNotification('friend_activity', `${friendName} posted a reel`, 'Tap to watch.', icon,
    { kind: 'reel', id: userId, userId });
}

/** Friend started live tracking — taps through to the live map. */
export function notifyFriendLive(friendName: string, token: string, userId: string, icon = '📍'): void {
  addNotification('friend_activity', `${friendName} is live`, 'Tap to follow their route in real time.', icon,
    { kind: 'live', id: token, userId, name: `${friendName} — Live` });
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
