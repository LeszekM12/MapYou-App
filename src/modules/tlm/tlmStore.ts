// ─── TLM GATEWAY STORAGE ─────────────────────────────────────────────────────
// src/modules/tlm/tlmStore.ts
//
// Lokalna historia czatow bramy (IndexedDB via Dexie - jak FriendsDB).
// Wiadomosci sa tu JUZ odszyfrowane; szyfrogram zyje tylko w drodze.

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Dexie: any;

export interface TlmMessage {
  id?: number;            // auto-increment
  msgId: string;          // id ramki TLM (statusy/deduplikacja)
  peerUserId: string;     // userId znajomego w MapYou (klucz rozmowy)
  peerTlmId: string;      // jego TLM-ID
  direction: 'in' | 'out';
  body: string;
  status: 'pending' | 'sent' | 'queued' | 'delivered' | 'read';
  ts: number;
}

/** Podsumowanie rozmowy - gotowe pod liste czatow w UI. */
export interface ChatSummary {
  peerUserId: string;
  lastBody: string;
  lastDirection: 'in' | 'out';
  lastTs: number;
  unread: number;
}

const gwDb = new Dexie('mapyou_tlm_gateway');
gwDb.version(1).stores({
  messages: '++id, msgId, peerUserId, ts',
  meta: 'key',
});

export async function saveGwMessage(m: TlmMessage): Promise<void> {
  const existing = await gwDb.messages.where('msgId').equals(m.msgId).first();
  if (existing) return; // deduplikacja (skrzynka moze dostarczyc ponownie)
  await gwDb.messages.add(m);
}

export async function setGwMessageStatus(msgId: string, status: TlmMessage['status']): Promise<void> {
  await gwDb.messages.where('msgId').equals(msgId).modify({ status });
}

export async function conversationWith(peerUserId: string): Promise<TlmMessage[]> {
  return gwDb.messages.where('peerUserId').equals(peerUserId).sortBy('ts');
}

/** Oznacz cala rozmowe jako przeczytana (wejscie w czat w UI). */
export async function markConversationRead(peerUserId: string): Promise<void> {
  await gwDb.messages
    .where('peerUserId').equals(peerUserId)
    .and((m: TlmMessage) => m.direction === 'in' && m.status !== 'read')
    .modify({ status: 'read' });
}

/** Liczba nieprzeczytanych od danego znajomego (badge przy jego nazwisku). */
export async function unreadCount(peerUserId: string): Promise<number> {
  return gwDb.messages
    .where('peerUserId').equals(peerUserId)
    .and((m: TlmMessage) => m.direction === 'in' && m.status !== 'read')
    .count();
}

/** Suma nieprzeczytanych (badge na ikonie czatu w bottom nav). */
export async function totalUnread(): Promise<number> {
  return gwDb.messages
    .filter((m: TlmMessage) => m.direction === 'in' && m.status !== 'read')
    .count();
}

/** Lista rozmow: ostatnia wiadomosc + licznik, posortowana po swiezosci. */
export async function chatSummaries(): Promise<ChatSummary[]> {
  const all: TlmMessage[] = await gwDb.messages.orderBy('ts').toArray();
  const map = new Map<string, ChatSummary>();
  for (const m of all) {
    const cur = map.get(m.peerUserId);
    const unread = (cur?.unread ?? 0) + (m.direction === 'in' && m.status !== 'read' ? 1 : 0);
    map.set(m.peerUserId, {
      peerUserId: m.peerUserId,
      lastBody: m.body,
      lastDirection: m.direction,
      lastTs: m.ts,
      unread,
    });
  }
  return [...map.values()].sort((a, b) => b.lastTs - a.lastTs);
}

// meta: mapowanie peerTlmId -> peerUserId (przypisanie przychodzacych
// wiadomosci od TLM-ID do znajomego z MapYou)
export async function rememberPeer(peerTlmId: string, peerUserId: string): Promise<void> {
  await gwDb.meta.put({ key: 'peer:' + peerTlmId, value: peerUserId });
}

export async function peerUserIdFor(peerTlmId: string): Promise<string | null> {
  const row = await gwDb.meta.get('peer:' + peerTlmId);
  return row?.value ?? null;
}
