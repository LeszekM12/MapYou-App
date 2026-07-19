// ─── TLM GATEWAY ─────────────────────────────────────────────────────────────
// src/modules/tlm/tlmGateway.ts
//
// KOMPLETNE API czatu MapYou<->MapYou (zamkniety ekosystem, prostota = mniej
// powierzchni ataku). E2E przez infrastrukture TLM - serwer widzi tylko szum.
// Przyszly UI to CZYSTE renderowanie - cala logika jest tutaj:
//
//   await tlmGateway.ensureReady();                       // start (raz)
//   tlmGateway.onUpdate(() => renderujWidok());           // kazda zmiana danych
//   await tlmGateway.friendChatStatus(userId);            // 'ready' | 'no_tlm'
//   await tlmGateway.sendToFriend(userId, 'Czesc!');      // wysylka E2E
//   await tlmGateway.conversation(userId);                // historia rozmowy
//   await tlmGateway.openConversation(userId);            // wejscie w czat (read)
//   await tlmGateway.chatList();                          // lista rozmow + badge
//   await tlmGateway.totalUnread();                       // badge w bottom nav
import { ensureTlmIdentity, resolveMapyouUser, encryptFor, decryptFrom, TlmGatewaySocket, } from './tlmClient.js';
import { saveGwMessage, setGwMessageStatus, conversationWith, markConversationRead, unreadCount, totalUnread, chatSummaries, rememberPeer, peerUserIdFor, } from './tlmStore.js';
function packText(text) {
    const nick = localStorage.getItem('mapyou_userName') ?? 'MapYou';
    return JSON.stringify({ t: 'card', card: { nick, avatar: null }, msg: text });
}
function unpackText(plain) {
    try {
        const o = JSON.parse(plain);
        if (o && o.t === 'card' && typeof o.msg === 'string')
            return o.msg;
        if (o && o.t === 'eph' && typeof o.body === 'string')
            return o.body;
    }
    catch { }
    return plain;
}
class TlmGateway {
    constructor() {
        Object.defineProperty(this, "identity", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "socket", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "peerKeys", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        }); // tlmId -> publicKey
        Object.defineProperty(this, "peerIds", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        }); // userId -> tlmId
        Object.defineProperty(this, "statusCache", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "updateCbs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "messageCbs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "readyPromise", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
    }
    /** Jednorazowa inicjalizacja: tozsamosc + socket + link + reconnect przy powrocie. */
    ensureReady() {
        if (this.readyPromise)
            return this.readyPromise;
        this.readyPromise = this.init();
        return this.readyPromise;
    }
    async init() {
        this.identity = await ensureTlmIdentity();
        this.socket = new TlmGatewaySocket(this.identity);
        this.socket.on((frame) => { void this.handleFrame(frame); });
        this.socket.connect();
        const myUserId = localStorage.getItem('mapyou_userId_profile');
        if (myUserId) {
            this.socket.send({ type: 'link', app: 'mapyou', externalId: myUserId });
        }
        else {
            console.warn('[TLM-GW] brak mapyou_userId_profile - link przy nastepnym starcie');
        }
        // ZYWOTNOSC: powrot do apki (karta/apka znow widoczna) = swiezy socket.
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible')
                this.socket?.connect();
        });
    }
    /** Kazda zmiana danych (nowa wiadomosc, status, read) - UI przerysowuje. */
    onUpdate(cb) { this.updateCbs.push(cb); }
    /** Konkretnie nowa wiadomosc przychodzaca (np. dzwiek/toast). */
    onMessage(cb) { this.messageCbs.push(cb); }
    emitUpdate() { for (const cb of this.updateCbs)
        cb(); }
    // ── API dla UI ─────────────────────────────────────────────────────────────
    /** Czy znajomy aktywowal czat? Cache w pamieci (odswieza sie przy 'no_tlm'). */
    async friendChatStatus(friendUserId) {
        const cached = this.statusCache.get(friendUserId);
        if (cached === 'ready')
            return 'ready'; // ready nie cofa sie w no_tlm
        const resolved = await resolveMapyouUser(friendUserId);
        const status = resolved ? 'ready' : 'no_tlm';
        this.statusCache.set(friendUserId, status);
        return status;
    }
    async sendToFriend(friendUserId, text) {
        await this.ensureReady();
        const trimmed = text.trim();
        if (!trimmed)
            return;
        const peer = await this.resolvePeer(friendUserId);
        if (!peer)
            throw new Error('Znajomy nie aktywowal jeszcze czatu');
        const msgId = this.randomHex(16);
        const payload = encryptFor(packText(trimmed), peer.publicKey, this.identity.privateKey);
        await saveGwMessage({
            msgId, peerUserId: friendUserId, peerTlmId: peer.tlmId,
            direction: 'out', body: trimmed, status: 'pending', ts: Date.now(),
        });
        this.socket.send({ type: 'msg', id: msgId, to: peer.tlmId, payload });
        this.emitUpdate();
    }
    conversation(friendUserId) {
        return conversationWith(friendUserId);
    }
    /** Wejscie w czat: oznacza przychodzace jako przeczytane. */
    async openConversation(friendUserId) {
        await markConversationRead(friendUserId);
        this.emitUpdate();
        return conversationWith(friendUserId);
    }
    chatList() { return chatSummaries(); }
    unreadFor(friendUserId) { return unreadCount(friendUserId); }
    totalUnread() { return totalUnread(); }
    /** Moj TLM-ID (np. do sekcji "O czacie" w ustawieniach MapYou). */
    myTlmId() { return this.identity?.tlmId ?? null; }
    // ── wewnetrzne ─────────────────────────────────────────────────────────────
    async resolvePeer(friendUserId) {
        let tlmId = this.peerIds.get(friendUserId);
        if (!tlmId) {
            const resolved = await resolveMapyouUser(friendUserId);
            if (!resolved)
                return null;
            tlmId = resolved.tlmId;
            this.peerIds.set(friendUserId, tlmId);
            this.peerKeys.set(tlmId, sodium.from_base64(resolved.publicKey, sodium.base64_variants.URLSAFE_NO_PADDING));
            this.statusCache.set(friendUserId, 'ready');
            await rememberPeer(tlmId, friendUserId);
        }
        return { tlmId, publicKey: this.peerKeys.get(tlmId) };
    }
    async handleFrame(frame) {
        if (frame.type === 'msg') {
            let peerPk = this.peerKeys.get(frame.from);
            if (!peerPk) {
                const res = await fetch('https://tlm.natours-mikrut.com/keys/' + encodeURIComponent(frame.from));
                if (!res.ok)
                    return;
                const { publicKey } = await res.json();
                peerPk = sodium.from_base64(publicKey, sodium.base64_variants.URLSAFE_NO_PADDING);
                this.peerKeys.set(frame.from, peerPk);
            }
            let text;
            try {
                text = unpackText(decryptFrom(frame.payload, peerPk, this.identity.privateKey));
            }
            catch {
                return; // uszkodzony/nie-dla-nas szyfrogram
            }
            const peerUserId = (await peerUserIdFor(frame.from)) ?? frame.from;
            const message = {
                msgId: frame.id, peerUserId, peerTlmId: frame.from,
                direction: 'in', body: text, status: 'delivered', ts: frame.ts ?? Date.now(),
            };
            await saveGwMessage(message);
            this.socket.send({ type: 'received', id: frame.id, to: frame.from });
            for (const cb of this.messageCbs)
                cb(peerUserId, message);
            this.emitUpdate();
            return;
        }
        if (frame.type === 'ack') {
            await setGwMessageStatus(frame.id, frame.status);
            this.emitUpdate();
        }
        if (frame.type === 'receipt') {
            await setGwMessageStatus(frame.id, 'delivered');
            this.emitUpdate();
        }
    }
    randomHex(bytes) {
        const buf = sodium.randombytes_buf(bytes);
        return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
}
/** Jedna instancja na cala aplikacje. */
export const tlmGateway = new TlmGateway();
//# sourceMappingURL=tlmGateway.js.map