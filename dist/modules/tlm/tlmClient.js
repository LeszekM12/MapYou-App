// ─── TLM WEB CLIENT ──────────────────────────────────────────────────────────
// src/modules/tlm/tlmClient.ts
//
// Pelny klient TLM dla przegladarki/Capacitora (MapYou jest KLIENTEM
// produktu TLM przez jego publiczne API - WebSocket + REST).
//
// Krypto identyczne bajt-w-bajt z apka TLM (React Native):
//  - tozsamosc: para X25519 (crypto_box_keypair)
//  - TLM-ID: SHA-256(klucz publiczny) -> Base32 Crockford, 8 znakow, XXXX-XXXX
//  - handshake: challenge od serwera -> crypto_box(challenge) = dowod klucza
//  - wiadomosci: crypto_box, na drucie base64(nonce || szyfrogram)
//  - wariant base64: URLSAFE_NO_PADDING (jak react-native-libsodium)
//
// Wymaga libsodium zaladowanego globalnie (script tag - jak Dexie w MapYou).
const TLM_SERVER_URL = 'https://tlm.natours-mikrut.com';
const TLM_WS_URL = TLM_SERVER_URL.replace(/^http/, 'ws') + '/ws';
// Klucze w localStorage. Uczciwie: web nie ma Keystore jak Android;
// w Capacitorze localStorage jest w piaskownicy apki (akceptowalne MVP,
// docelowo: @capacitor/preferences albo secure storage plugin).
const LS_SK = 'tlm_gw_privateKey';
const LS_PK = 'tlm_gw_publicKey';
const LS_ID = 'tlm_gw_tlmId';
const B64 = () => sodium.base64_variants.URLSAFE_NO_PADDING;
// ── Tozsamosc ────────────────────────────────────────────────────────────────
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function base32(bytes, chars) {
    let bits = 0, value = 0, out = '';
    for (const b of bytes) {
        value = (value << 8) | b;
        bits += 8;
        while (bits >= 5 && out.length < chars) {
            out += CROCKFORD[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
        if (out.length >= chars)
            break;
    }
    return out;
}
export function deriveTlmId(publicKey) {
    const hash = sodium.crypto_hash_sha256(publicKey);
    const raw = base32(hash, 8);
    return raw.slice(0, 4) + '-' + raw.slice(4);
}
/** Wczytuje tozsamosc TLM albo tworzy nowa (pierwsze uzycie czatu). */
export async function ensureTlmIdentity() {
    await sodium.ready;
    const skB64 = localStorage.getItem(LS_SK);
    const pkB64 = localStorage.getItem(LS_PK);
    const tlmId = localStorage.getItem(LS_ID);
    if (skB64 && pkB64 && tlmId) {
        return {
            tlmId,
            publicKey: sodium.from_base64(pkB64, B64()),
            privateKey: sodium.from_base64(skB64, B64()),
        };
    }
    const kp = sodium.crypto_box_keypair();
    const id = deriveTlmId(kp.publicKey);
    localStorage.setItem(LS_SK, sodium.to_base64(kp.privateKey, B64()));
    localStorage.setItem(LS_PK, sodium.to_base64(kp.publicKey, B64()));
    localStorage.setItem(LS_ID, id);
    console.log('[TLM-GW] utworzono tozsamosc TLM:', id);
    return { tlmId: id, publicKey: kp.publicKey, privateKey: kp.privateKey };
}
// ── Szyfrowanie wiadomosci (format zgodny z apka TLM) ────────────────────────
export function encryptFor(plaintext, theirPk, mySk) {
    const nonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
    const cipher = sodium.crypto_box_easy(sodium.from_string(plaintext), nonce, theirPk, mySk);
    const packed = new Uint8Array(nonce.length + cipher.length);
    packed.set(nonce, 0);
    packed.set(cipher, nonce.length);
    return sodium.to_base64(packed, B64());
}
export function decryptFrom(payloadB64, theirPk, mySk) {
    const packed = sodium.from_base64(payloadB64, B64());
    const nonce = packed.slice(0, sodium.crypto_box_NONCEBYTES);
    const cipher = packed.slice(sodium.crypto_box_NONCEBYTES);
    return sodium.to_string(sodium.crypto_box_open_easy(cipher, nonce, theirPk, mySk));
}
// ── REST: resolve i klucze ───────────────────────────────────────────────────
/** userId znajomego z MapYou -> jego tozsamosc TLM (404 = nie aktywowal czatu). */
export async function resolveMapyouUser(userId) {
    const res = await fetch(`${TLM_SERVER_URL}/resolve?app=mapyou&userId=${encodeURIComponent(userId)}`);
    if (res.status === 404)
        return null;
    if (!res.ok)
        throw new Error('resolve: ' + res.status);
    return res.json();
}
export class TlmGatewaySocket {
    constructor(identity) {
        Object.defineProperty(this, "ws", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        });
        Object.defineProperty(this, "identity", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "listeners", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "queue", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "ready", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "closedByUs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        this.identity = identity;
    }
    on(cb) { this.listeners.push(cb); }
    connect() {
        this.closedByUs = false;
        this.ws = new WebSocket(TLM_WS_URL);
        this.ws.onmessage = (ev) => {
            let frame;
            try {
                frame = JSON.parse(String(ev.data));
            }
            catch {
                return;
            }
            if (frame.type === 'challenge') {
                // Dowod tozsamosci: crypto_box(challenge) do serwera.
                const challenge = sodium.from_base64(frame.nonce, B64());
                const serverPk = sodium.from_base64(frame.serverPk, B64());
                const boxNonce = sodium.randombytes_buf(sodium.crypto_box_NONCEBYTES);
                const proof = sodium.crypto_box_easy(challenge, boxNonce, serverPk, this.identity.privateKey);
                this.rawSend({
                    type: 'hello',
                    tlmId: this.identity.tlmId,
                    publicKey: sodium.to_base64(this.identity.publicKey, B64()),
                    boxNonce: sodium.to_base64(boxNonce, B64()),
                    proof: sodium.to_base64(proof, B64()),
                });
                return;
            }
            if (frame.type === 'ready') {
                this.ready = true;
                console.log('[TLM-GW] zalogowano jako', this.identity.tlmId);
                for (const f of this.queue)
                    this.rawSend(f);
                this.queue = [];
            }
            for (const cb of this.listeners)
                cb(frame);
        };
        this.ws.onclose = () => {
            this.ready = false;
            if (!this.closedByUs)
                setTimeout(() => this.connect(), 3000); // auto-reconnect
        };
        this.ws.onerror = () => { };
    }
    /** Wysyla ramke; przed 'ready' trafia do kolejki. */
    send(frame) {
        if (this.ready)
            this.rawSend(frame);
        else
            this.queue.push(frame);
    }
    rawSend(frame) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(frame));
        }
        else {
            this.queue.push(frame);
        }
    }
    close() {
        this.closedByUs = true;
        this.ws?.close();
    }
}
//# sourceMappingURL=tlmClient.js.map