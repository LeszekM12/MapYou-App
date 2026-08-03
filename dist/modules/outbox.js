// ─── KOLEJKA ZAPISÓW OFFLINE (Etap 2) ────────────────────────────────────────
// src/modules/outbox.ts
//
// ZASADA
// ──────
// Zapis, ktory nie dotarl do serwera, nie ginie — trafia do IndexedDB i czeka
// na siec. Przezywa ubicie apki i restart telefonu. Wysylka rusza sama, gdy
// polaczenie wroci.
//
// KAZDY REKORD NIESIE WLASNY `idemKey`
// Klucz powstaje RAZ, przy pierwszej probie, i nie zmienia sie przy zadnym
// ponowieniu. Backend (middleware/idempotency.ts) rozpoznaje po nim powtorke
// i oddaje zapamietana odpowiedz zamiast wykonac operacje drugi raz.
// Bez tego jedno ponowienie tworzyloby drugi trening albo drugi post.
//
// KOLEJKUJEMY TYLKO TRWALE DANE UZYTKOWNIKA
// Nie wszystko wolno odlozyc na pozniej:
//   - trening, post, zdjecie, profil  → TAK, to dane, ktorych nie da sie odtworzyc
//   - polubienie, obserwowanie        → TAK, ale bez gwarancji kolejnosci
//   - `/feed/impressions`             → NIE, licznik wyswietlen sprzed godziny
//                                        jest bezwartosciowy
//   - `/live/update`, `/live/start`   → NIE, transmisja na zywo ma sens
//                                        wylacznie na zywo
//   - `/auth/session`                 → NIE, logowanie wymaga sieci z definicji
import { db } from './db.js';
import { dlog } from '../utils/log.js';
/* eslint-disable @typescript-eslint/no-explicit-any */
const tbl = () => db.outbox;
/** Maksymalna liczba prob dla jednego zapisu. Po jej przekroczeniu rekord
 *  ZOSTAJE w bazie (to dane uzytkownika), ale przestajemy go probowac
 *  i nie liczymy go jako „czekajacy". */
const MAX_ATTEMPTS = 8;
// ── Co wolno kolejkowac ──────────────────────────────────────────────────────
/** Sciezki, ktorych NIE odkladamy. Dopasowanie po fragmencie adresu. */
const NEVER_QUEUE = [
    '/auth/session', // logowanie — wymaga sieci
    '/auth/me',
    '/live/', // transmisja na zywo ma sens tylko na zywo
    '/feed/impressions', // licznik wyswietlen sprzed godziny jest bezwartosciowy
    '/push/', // rejestracja tokena — bez sieci i tak bezcelowa
    '/upload/tile', // proxy kafelkow
    '/directions', // planowanie trasy — wynik potrzebny natychmiast
    '/loop',
    '/sync/manifest',
    // Polubienia NIE ida do kolejki.
    //
    // Wolajacy odczytuje z odpowiedzi nowa liczbe polubien. Odpowiedz zastepcza
    // („queued") tej liczby nie ma, wiec pod sercem pojawialo sie `undefined`.
    // Polubienie offline jest malo warte, a widoczny smiec w interfejsie duzo
    // kosztuje — wiec pozwalamy mu po prostu nie przejsc.
    '/feed/like',
];
export function isQueueable(url, method) {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase()))
        return false;
    return !NEVER_QUEUE.some(p => url.includes(p));
}
// ── Klucz idempotencji ───────────────────────────────────────────────────────
function newKey() {
    try {
        if (crypto?.randomUUID)
            return crypto.randomUUID();
    }
    catch { /* starsze WebView */ }
    return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
// ── Operacje na kolejce ──────────────────────────────────────────────────────
/** Odloz zapis na pozniej. Zwraca klucz idempotencji nadany temu zadaniu. */
export async function enqueue(url, method, headers, body) {
    const idemKey = newKey();
    // Token NIE trafia do kolejki. Zapis moze poczekac godziny, a token wygasa
    // po ~60 minutach — zapisany bylby bezuzyteczny. Swiezy dolozy `authFetch`
    // przy ponownej probie.
    delete headers['Authorization'];
    delete headers['authorization'];
    await tbl().add({
        idemKey, url, method, headers, body,
        createdAt: Date.now(), attempts: 0, lastError: null,
    });
    dlog(`[Outbox] odlozono ${method} ${url}`);
    notifyChange();
    return idemKey;
}
/** Ile zapisow czeka na wyslanie. */
/** Ile zapisow CZEKA NA WYSLANIE.
 *
 *  Nie liczymy tych, ktore wyczerpaly limit prob — sa pomijane w petli
 *  wysylkowej, wiec wliczanie ich oznaczaloby licznik, ktory nigdy nie
 *  schodzi do zera. Dokladnie to widac bylo jako „Syncing… (2)" wiszace
 *  w nieskonczonosc, mimo ze wszystko juz doszlo. */
export async function pendingCount() {
    try {
        const all = await tbl().toArray();
        return all.filter(i => i.attempts < MAX_ATTEMPTS).length;
    }
    catch {
        return 0;
    }
}
/** Wszystkie oczekujace, od najstarszego — kolejnosc zapisu ma znaczenie. */
export async function listPending() {
    try {
        return await tbl().orderBy('createdAt').toArray();
    }
    catch {
        return [];
    }
}
const listeners = new Set();
/** Nasluchuj zmian w kolejce (pasek „Tryb offline"). */
export function onOutboxChange(fn) {
    listeners.add(fn);
    void pendingCount().then(fn);
    return () => listeners.delete(fn);
}
function notifyChange() {
    void pendingCount().then(n => listeners.forEach(fn => { try {
        fn(n);
    }
    catch { /* noop */ } }));
}
// ── Wysylka ──────────────────────────────────────────────────────────────────
let flushing = false;
/** Maksymalna liczba prob dla jednego zapisu.
 *
 *  Po jej przekroczeniu rekord ZOSTAJE w kolejce, ale przestajemy go probowac
 *  w tym cyklu. Nie kasujemy go — to dane uzytkownika i lepiej, zeby czekaly,
 *  niz zeby zniknely po cichu. */
/** Wyslij wszystko, co czeka. Bezpieczne do wolania wielokrotnie —
 *  rownolegle wywolania sa pomijane. */
export async function flush() {
    if (flushing)
        return;
    if (!navigator.onLine)
        return;
    flushing = true;
    try {
        const items = await listPending();
        if (!items.length)
            return;
        dlog(`[Outbox] wysylam ${items.length} zaleglych zapisow`);
        for (const item of items) {
            if (item.attempts >= MAX_ATTEMPTS)
                continue;
            try {
                // `X-Outbox-Replay` mowi `authFetch`, ze to JUZ jest ponowienie
                // z kolejki. Bez tego przechwytywacz zlapalby blad sieci i dolozyl
                // to samo zadanie DRUGI RAZ — kolejka nigdy by sie nie oproznila,
                // tylko rosla przy kazdej nieudanej probie.
                const res = await fetch(item.url, {
                    method: item.method,
                    headers: { ...item.headers, 'Idempotency-Key': item.idemKey, 'X-Outbox-Replay': '1' },
                    body: item.body,
                });
                if (res.ok || res.status === 409) {
                    // 409 traktujemy jak sukces — zasob juz istnieje, czyli poprzednia
                    // proba jednak doszla, tylko odpowiedz do nas nie wrocila.
                    await tbl().delete(item.id);
                    dlog(`[Outbox] wyslano ${item.method} ${item.url}`);
                    notifyChange(); // licznik ma spadac na biezaco, nie dopiero na koncu
                    continue;
                }
                if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
                    // Blad klienta (400, 403, 404...) nie naprawi sie sam. Ponawianie
                    // go w nieskonczonosc tylko obciaza serwer. Usuwamy, ale GLOSNO —
                    // to znaczy, ze zapis przepadl i uzytkownik powinien wiedziec.
                    console.error(`[Outbox] zapis odrzucony na stale (${res.status}): ${item.method} ${item.url}`);
                    await tbl().delete(item.id);
                    notifyChange();
                    continue;
                }
                // 5xx / 408 / 429 — problem po stronie serwera, ma prawo minac.
                await tbl().update(item.id, {
                    attempts: item.attempts + 1,
                    lastError: `HTTP ${res.status}`,
                });
            }
            catch (e) {
                // Blad sieci — zostawiamy w kolejce i probujemy pozniej.
                await tbl().update(item.id, {
                    attempts: item.attempts + 1,
                    lastError: e instanceof Error ? e.message : String(e),
                });
                // Skoro siec padla, nie ma sensu meczyc reszty w tym cyklu.
                break;
            }
        }
    }
    finally {
        flushing = false;
        notifyChange();
    }
}
// ── Automatyczna wysylka ─────────────────────────────────────────────────────
let started = false;
/** Uruchom nasluch. Wysylka rusza przy powrocie sieci, przy powrocie
 *  do apki i cyklicznie — bo zdarzenie `online` bywa niewiarygodne
 *  w natywnym WebView. */
export function startOutbox() {
    if (started)
        return;
    started = true;
    window.addEventListener('online', () => { void flush(); });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible')
            void flush();
    });
    setInterval(() => { void flush(); }, 60000);
    void flush();
    dlog('[Outbox] nasluch uruchomiony');
}
// ── Pasek statusu ────────────────────────────────────────────────────────────
/** Podepnij pasek „Tryb offline" pod stan sieci i kolejki.
 *
 *  Trzy stany, bo uzytkownik potrzebuje rozroznic sytuacje:
 *    brak sieci                → „Tryb offline — zmiany wysla sie automatycznie"
 *    siec wrocila, kolejka pusta → pasek znika
 *    siec wrocila, cos czeka   → „Wysylanie… (N)" na zielono
 *
 *  Bez trzeciego stanu uzytkownik nie wiedzialby, czy jego trening juz
 *  poszedl, czy nadal wisi.
 */
export function mountOfflineBar() {
    const bar = document.getElementById('offlineBar');
    const text = document.getElementById('offlineBarText');
    if (!bar || !text)
        return;
    // Minimalny czas pokazania stanu „Wysylanie…".
    //
    // Wysylka trwa zwykle kilkaset milisekund, wiec pasek pojawialby sie
    // i znikal w tym samym mgnieniu — uzytkownik nie wiedzialby, czy jego
    // trening w ogole poszedl. Trzymamy go przez chwile, zeby komunikat
    // dalo sie przeczytac.
    const MIN_SYNC_MS = 1400;
    let syncShownAt = 0;
    let hideTimer = 0;
    // Pasek liczy TAKZE zalegle zdjecia. Uzytkownik nie odroznia „zapis czeka"
    // od „zdjecie czeka" — dla niego to jedna rzecz: cos jeszcze nie poszlo.
    const render = async (queued) => {
        const { pendingMediaCount } = await import('./mediaQueue.js');
        const pending = queued + await pendingMediaCount();
        renderCount(pending);
    };
    const renderCount = (pending) => {
        const offline = !navigator.onLine;
        // Jesli wlasnie pokazalismy „Wysylanie…", nie chowaj od razu.
        if (!offline && pending === 0 && syncShownAt) {
            const left = MIN_SYNC_MS - (Date.now() - syncShownAt);
            if (left > 0) {
                setTimeout(() => renderCount(0), left);
                return;
            }
            syncShownAt = 0;
            text.textContent = 'Synced \u2713';
            setTimeout(() => renderCount(0), 900);
            return;
        }
        if (!offline && pending === 0) {
            bar.classList.remove('offline-bar--visible', 'offline-bar--syncing');
            // `hidden` dopiero po animacji zjazdu, zeby nie ucinac przejscia.
            setTimeout(() => { if (!bar.classList.contains('offline-bar--visible'))
                bar.hidden = true; }, 300);
            return;
        }
        bar.hidden = false;
        // Wymuszenie przeliczenia stylu — bez tego przejscie nie odpali,
        // gdy element dopiero co przestal byc `hidden`.
        void bar.offsetHeight;
        bar.classList.add('offline-bar--visible');
        // Sam sie chowa po chwili.
        //
        // Pasek wisial przez CALY czas bez sieci — a to bywaja godziny. Informacja
        // jest wazna raz, w momencie zmiany stanu; potem tylko zabiera miejsce.
        // Pokazujemy go na ~4,5 s i chowamy. Wroci przy kazdej kolejnej zmianie
        // (nowy zapis w kolejce, powrot sieci, koniec wysylki).
        if (hideTimer)
            clearTimeout(hideTimer);
        hideTimer = window.setTimeout(() => {
            bar.classList.remove('offline-bar--visible');
            setTimeout(() => {
                if (!bar.classList.contains('offline-bar--visible'))
                    bar.hidden = true;
            }, 350);
        }, 4500);
        if (offline) {
            bar.classList.remove('offline-bar--syncing');
            text.textContent = pending > 0
                ? `Offline — ${pending} ${pending === 1 ? 'change' : 'changes'} pending`
                : 'Offline — changes will sync automatically';
        }
        else {
            bar.classList.add('offline-bar--syncing');
            text.textContent = `Syncing… (${pending})`;
            if (!syncShownAt)
                syncShownAt = Date.now();
        }
    };
    onOutboxChange(n => { void render(n); });
    window.addEventListener('online', () => { void pendingCount().then(n => render(n)); });
    window.addEventListener('offline', () => { void pendingCount().then(n => render(n)); });
    // Zdjecia wysylaja sie wlasnym cyklem — odswiezamy licznik co 5 s,
    // zeby pasek nie zostal na starej liczbie po wyslaniu pliku.
    setInterval(() => { void pendingCount().then(n => render(n)); }, 5000);
}
// ── Diagnostyka ──────────────────────────────────────────────────────────────
/** Podglad kolejki z konsoli:  mapyouOutbox()
 *
 *  Pokazuje, co dokladnie czeka, ile razy probowano i na czym padlo.
 *  `mapyouOutbox(true)` czysci kolejke — uzywac tylko swiadomie,
 *  bo kasuje dane uzytkownika, ktore nigdy nie doszly na serwer. */
window.mapyouOutbox =
    async (purge = false) => {
        if (purge) {
            const n = await pendingCount();
            await tbl().clear();
            notifyChange();
            return `Wyczyszczono kolejke (${n} pozycji BEZPOWROTNIE utraconych).`;
        }
        const items = await listPending();
        if (!items.length)
            return 'Kolejka pusta.';
        return items.map(i => ({
            id: i.id,
            zadanie: `${i.method} ${i.url.replace(/^https?:\/\/[^/]+/, '')}`,
            prob: i.attempts,
            blad: i.lastError ?? '—',
            czeka: `${Math.round((Date.now() - i.createdAt) / 1000)} s`,
        }));
    };
//# sourceMappingURL=outbox.js.map