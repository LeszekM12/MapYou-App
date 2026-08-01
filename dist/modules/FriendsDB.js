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
import { PUBLIC_BASE_URL } from '../config.js';
import { dlog } from '../utils/log.js';
// ── Dexie setup ───────────────────────────────────────────────────────────────
const friendsDb = new Dexie('mapyou_friends');
friendsDb.version(1).stores({
    friends: '++id, subscriptionId, name',
});
// ── CRUD ──────────────────────────────────────────────────────────────────────
/** Pobierz wszystkich znajomych (posortowanych po imieniu) */
export async function getAllFriends() {
    return await friendsDb.friends.orderBy('name').toArray();
}
/** Zaktualizuj friendUserId znajomego */
export async function updateFriendUserId(subscriptionId, friendUserId) {
    await friendsDb.friends
        .where('subscriptionId')
        .equals(subscriptionId)
        .modify({ friendUserId });
}
/** Dodaj znajomego (ignoruj jeśli już istnieje ten sam subscriptionId) */
export async function addFriend(friend) {
    const existing = await friendsDb.friends
        .where('subscriptionId')
        .equals(friend.subscriptionId)
        .first();
    if (existing) {
        dlog(`[FriendsDB] Friend already exists: ${friend.name}`);
        return existing.id;
    }
    return await friendsDb.friends.add(friend);
}
/** Zaktualizuj liveToken znajomego */
export async function updateFriendLiveToken(subscriptionId, liveToken) {
    await friendsDb.friends
        .where('subscriptionId')
        .equals(subscriptionId)
        .modify({ liveToken, lastSeen: Date.now() });
}
/** Usuń znajomego */
export async function deleteFriend(id) {
    await friendsDb.friends.delete(id);
}
/** Zaktualizuj lastSeen znajomego */
export async function updateFriendLastSeen(subscriptionId) {
    await friendsDb.friends
        .where('subscriptionId')
        .equals(subscriptionId)
        .modify({ lastSeen: Date.now() });
}
// ── Invite link helpers ───────────────────────────────────────────────────────
/**
 * Generuje krótki link zaproszenia przez backend.
 * Format: https://domain/#invite=ABC12345 (8 znaków zamiast 500)
 */
export async function generateInviteLink(name, pushSub, backendUrl, userId) {
    const res = await fetch(`${backendUrl}/live/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, pushSub: pushSub ?? undefined, userId }),
    });
    const data = await res.json();
    if (data.status !== 'ok')
        throw new Error('Failed to create invite');
    return `${PUBLIC_BASE_URL}/#invite=${data.code}`;
}
/**
 * Pobiera dane zaproszenia z backendu na podstawie krótkiego kodu.
 */
export async function fetchInviteByCode(code, backendUrl) {
    try {
        const res = await fetch(`${backendUrl}/live/invite/${code}`);
        if (!res.ok)
            return null;
        const data = await res.json();
        return { name: data.name, pushSub: data.pushSub, friendUserId: data.friendUserId ?? null };
    }
    catch {
        return null;
    }
}
/**
 * Parsuje stary base64 link (fallback dla kompatybilności).
 */
export function parseInviteLink(url) {
    try {
        const hash = new URL(url).hash;
        if (!hash.startsWith('#invite='))
            return null;
        const code = hash.replace('#invite=', '');
        // Stary format — base64 (długi string)
        if (code.length > 20) {
            return JSON.parse(atob(code));
        }
        // Nowy format — krótki kod, wymaga fetch (zwróć null, obsłuż async w FriendsView)
        return null;
    }
    catch {
        return null;
    }
}
/**
 * Sprawdza URL przy starcie — zwraca kod lub null.
 */
export function checkInviteInUrl() {
    try {
        const hash = window.location.hash;
        if (!hash.startsWith('#invite='))
            return null;
        return hash.replace('#invite=', '');
    }
    catch {
        return null;
    }
}
/** Odtworz liste znajomych z serwera (Faza 4 — poza planem).
 *
 *  Znajomi zyli WYLACZNIE w Dexie na telefonie. Serwer ma ich od dawna
 *  (`User.friends[]`, dopisywane przez POST /users/:id/friends/:friendId),
 *  ale zaden kod ich stamtad nie odczytywal — wiec kazda reinstalacja albo
 *  nowy telefon zaczynal z pusta lista i trzeba bylo zapraszac od nowa.
 *
 *  Dociagamy tylko BRAKUJACYCH — istniejacych wpisow nie ruszamy, zeby nie
 *  nadpisac zapamietanego `pushSub` ani `liveToken`.
 *
 *  `subscriptionId` ustawiamy na `local:<userId>`, bo endpointu push znajomego
 *  klient nie zna i znac nie powinien. Nie szkodzi: odpytywanie sesji live
 *  uzywa `friendUserId`, a powiadomienia rozsyla serwer po swojej stronie.
 */
export async function hydrateFriendsFromServer(backendUrl) {
    try {
        const meRes = await fetch(`${backendUrl}/auth/me`, { cache: 'no-store' });
        if (!meRes.ok)
            return 0;
        const me = await meRes.json();
        const ids = me.data?.friends ?? [];
        if (!ids.length)
            return 0;
        const known = new Set((await getAllFriends()).map(f => f.friendUserId).filter(Boolean));
        const missing = ids.filter(id => !known.has(id));
        if (!missing.length)
            return 0;
        let added = 0;
        for (const uid of missing) {
            try {
                const r = await fetch(`${backendUrl}/users/${encodeURIComponent(uid)}`, { cache: 'no-store' });
                if (!r.ok)
                    continue;
                const d = await r.json();
                if (d.status !== 'ok')
                    continue;
                await addFriend({
                    name: d.data?.name ?? 'MapYou User',
                    friendUserId: uid,
                    subscriptionId: `local:${uid}`,
                    pushSub: { endpoint: `local:${uid}`, expirationTime: null, keys: { p256dh: '', auth: '' } },
                    liveToken: null,
                    lastSeen: null,
                    addedAt: Date.now(),
                });
                added++;
            }
            catch { /* pojedynczy znajomy — nie przerywamy reszty */ }
        }
        if (added)
            dlog(`[FriendsDB] odtworzono ${added} znajomych z serwera`);
        return added;
    }
    catch (err) {
        console.warn('[FriendsDB] nie udalo sie odtworzyc znajomych:', err instanceof Error ? err.message : err);
        return 0;
    }
}
/** Usun wszystkich znajomych z urzadzenia (wylogowanie).
 *  `mapyou_friends` to OSOBNA baza Dexie, wiec czyszczenie glownej bazy
 *  jej nie obejmuje — bez tego znajomi poprzedniego uzytkownika zostawali. */
export async function clearFriendsLocally() {
    try {
        await friendsDb.friends.clear();
        dlog('[FriendsDB] wyczyszczono liste znajomych');
    }
    catch (err) {
        console.warn('[FriendsDB] blad czyszczenia:', err);
    }
}
//# sourceMappingURL=FriendsDB.js.map