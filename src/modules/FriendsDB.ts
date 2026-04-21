// ─── FRIENDS DATABASE (IndexedDB via Dexie) ──────────────────────────────────
// src/modules/FriendsDB.ts
//
// Przechowuje lokalnie listę znajomych.
// Każdy znajomy ma:
//   - name            — imię
//   - subscriptionId  — endpoint push subskrypcji (do wysyłania powiadomień)
//   - pushSub         — pełna subskrypcja push (endpoint + keys)
//   - liveToken       — ostatni token live-trackingu (do oglądania trasy)
//   - lastSeen        — timestamp ostatniej aktywności
//
// Znajomi są dodawani przez:
//   1. Wklejenie linku zaproszenia
//   2. Skanowanie QR kodu

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Dexie: any;

// ── Typy ─────────────────────────────────────────────────────────────────────

export interface Friend {
  id?:            number;           // auto-increment
  name:           string;
  subscriptionId: string;           // endpoint URL (unikalny klucz)
  pushSub:        {                 // pełna subskrypcja push do wysyłania notyfikacji
    endpoint:       string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  };
  liveToken:      string | null;    // aktywny token live-trackingu
  lastSeen:       number | null;    // timestamp ostatniej aktywności
  addedAt:        number;           // kiedy dodano znajomego
}

export interface InvitePayload {
  name:   string;
  pushSub: {
    endpoint:       string;
    expirationTime: number | null;
    keys: { p256dh: string; auth: string };
  };
}

// ── Dexie setup ───────────────────────────────────────────────────────────────

const friendsDb = new Dexie('mapyou_friends');
friendsDb.version(1).stores({
  friends: '++id, subscriptionId, name',
});

// ── CRUD ──────────────────────────────────────────────────────────────────────

/** Pobierz wszystkich znajomych (posortowanych po imieniu) */
export async function getAllFriends(): Promise<Friend[]> {
  return await friendsDb.friends.orderBy('name').toArray();
}

/** Dodaj znajomego (ignoruj jeśli już istnieje ten sam subscriptionId) */
export async function addFriend(friend: Omit<Friend, 'id'>): Promise<number> {
  const existing = await friendsDb.friends
    .where('subscriptionId')
    .equals(friend.subscriptionId)
    .first();
  if (existing) {
    console.log(`[FriendsDB] Friend already exists: ${friend.name}`);
    return existing.id;
  }
  return await friendsDb.friends.add(friend);
}

/** Zaktualizuj liveToken znajomego */
export async function updateFriendLiveToken(
  subscriptionId: string,
  liveToken: string | null,
): Promise<void> {
  await friendsDb.friends
    .where('subscriptionId')
    .equals(subscriptionId)
    .modify({ liveToken, lastSeen: Date.now() });
}

/** Usuń znajomego */
export async function deleteFriend(id: number): Promise<void> {
  await friendsDb.friends.delete(id);
}

/** Zaktualizuj lastSeen znajomego */
export async function updateFriendLastSeen(subscriptionId: string): Promise<void> {
  await friendsDb.friends
    .where('subscriptionId')
    .equals(subscriptionId)
    .modify({ lastSeen: Date.now() });
}

// ── Invite link helpers ───────────────────────────────────────────────────────

/**
 * Generuje link zaproszenia zawierający imię i push subskrypcję.
 * Format: https://domain/#invite=<base64>
 */
export function generateInviteLink(name: string, pushSub: Friend['pushSub']): string {
  const payload: InvitePayload = { name, pushSub };
  const encoded = btoa(JSON.stringify(payload));
  const base = window.location.href.split('#')[0];
  return `${base}#invite=${encoded}`;
}

/**
 * Parsuje link zaproszenia.
 * Zwraca null jeśli link jest nieprawidłowy.
 */
export function parseInviteLink(url: string): InvitePayload | null {
  try {
    const hash = new URL(url).hash;
    if (!hash.startsWith('#invite=')) return null;
    const encoded = hash.replace('#invite=', '');
    return JSON.parse(atob(encoded)) as InvitePayload;
  } catch {
    return null;
  }
}

/**
 * Sprawdza URL przy starcie aplikacji — jeśli jest #invite=...,
 * automatycznie otwiera modal dodania znajomego.
 */
export function checkInviteInUrl(): InvitePayload | null {
  return parseInviteLink(window.location.href);
}
