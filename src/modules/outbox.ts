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
const tbl = (): any => (db as any).outbox;

/** Maksymalna liczba prob dla jednego zapisu. Po jej przekroczeniu rekord
 *  ZOSTAJE w bazie (to dane uzytkownika), ale przestajemy go probowac
 *  i nie liczymy go jako „czekajacy". */
const MAX_ATTEMPTS = 8;

/** Odstep miedzy probami PO przekroczeniu `MAX_ATTEMPTS`.
 *  Zapis nie jest juz porzucany — tylko ponawiany rzadko. */
const SLOW_RETRY_MS = 6 * 60 * 60_000;

export interface OutboxItem {
  id?:        number;
  idemKey:    string;
  url:        string;
  method:     string;
  headers:    Record<string, string>;
  body:       string | null;
  createdAt:  number;
  attempts:   number;
  lastError:  string | null;
  /** Nie probuj przed tym momentem (ms epoch). Odstep rosnie wykladniczo
   *  po kazdym bledzie SERWERA — patrz `flush()`. */
  nextTryAt?: number;
}

// ── Co wolno kolejkowac ──────────────────────────────────────────────────────

/** Sciezki, ktorych NIE odkladamy. Dopasowanie po fragmencie adresu. */
const NEVER_QUEUE = [
  '/auth/session',      // logowanie — wymaga sieci
  '/auth/me',
  '/live/',             // transmisja na zywo ma sens tylko na zywo
  '/feed/impressions',  // licznik wyswietlen sprzed godziny jest bezwartosciowy
  '/push/',             // rejestracja tokena — bez sieci i tak bezcelowa
  '/upload/tile',       // proxy kafelkow
  '/directions',        // planowanie trasy — wynik potrzebny natychmiast
  '/loop',
  '/sync/manifest',
];

export function isQueueable(url: string, method: string): boolean {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method.toUpperCase())) return false;
  return !NEVER_QUEUE.some(p => url.includes(p));
}

// ── Klucz idempotencji ───────────────────────────────────────────────────────

function newKey(): string {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* starsze WebView */ }
  return `k_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── Operacje na kolejce ──────────────────────────────────────────────────────

/** Odloz zapis na pozniej. Zwraca klucz idempotencji nadany temu zadaniu. */
export async function enqueue(
  url: string, method: string, headers: Record<string, string>, body: string | null,
): Promise<string> {
  const idemKey = newKey();
  // Token NIE trafia do kolejki. Zapis moze poczekac godziny, a token wygasa
  // po ~60 minutach — zapisany bylby bezuzyteczny. Swiezy dolozy `authFetch`
  // przy ponownej probie.
  delete headers['Authorization'];
  delete headers['authorization'];
  await tbl().add({
    idemKey, url, method, headers, body,
    createdAt: Date.now(), attempts: 0, lastError: null,
  } as OutboxItem);
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
export async function pendingCount(): Promise<number> {
  try {
    const all = await tbl().toArray() as OutboxItem[];
    return all.filter(i => i.attempts < MAX_ATTEMPTS).length;
  } catch { return 0; }
}

/** Wszystkie oczekujace, od najstarszego — kolejnosc zapisu ma znaczenie. */
export async function listPending(): Promise<OutboxItem[]> {
  try { return await tbl().orderBy('createdAt').toArray(); } catch { return []; }
}

// ── Powiadamianie interfejsu ─────────────────────────────────────────────────

type Listener = (pending: number) => void;
const listeners = new Set<Listener>();

/** Nasluchuj zmian w kolejce (pasek „Tryb offline"). */
export function onOutboxChange(fn: Listener): () => void {
  listeners.add(fn);
  void pendingCount().then(fn);
  return () => listeners.delete(fn);
}

function notifyChange(): void {
  void pendingCount().then(n => listeners.forEach(fn => { try { fn(n); } catch { /* noop */ } }));
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
export async function flush(): Promise<void> {
  if (flushing) return;
  if (!navigator.onLine) return;

  // Bez gotowej sesji KAZDE zadanie wraca z 401.
  //
  // Kolejka rusza przy zdarzeniu `online`, ktore w WebView potrafi przyjsc
  // zanim Firebase odswiezy token. Wysylalismy wiec bez autoryzacji, serwer
  // odrzucal, a galaz „blad klienta" kasowala zadanie NA ZAWSZE — polubienie
  // przepadalo po cichu i po odswiezeniu stan sie cofal.
  try {
    const { isSessionReady, onSessionReady } = await import('./authFetch.js');
    if (!isSessionReady()) {
      dlog('[Outbox] sesja niegotowa — wysle, gdy bedzie');
      onSessionReady(() => { void flush(); });
      return;
    }
  } catch { /* brak funkcji — probujemy mimo to */ }

  flushing = true;

  try {
    const items = await listPending();
    if (!items.length) return;
    // Liczymy tylko te, ktore FAKTYCZNIE pojda — inaczej log mowil
    // „wysylam 16", podczas gdy dziewiec z nich bylo pominietych przez limit
    // prob albo karencje, i nie bylo wiadomo, czemu nic sie nie dzieje.
    // Licznik bledow sieci Z RZEDU — patrz galaz `catch` nizej.
    let awaria = 0;
    const now = Date.now();
    const gotowe = items.filter(i =>
      i.attempts < MAX_ATTEMPTS && (!i.nextTryAt || now >= i.nextTryAt));
    const wstrzymane = items.length - gotowe.length;
    if (!gotowe.length) {
      console.warn(`[Outbox] ${items.length} zapisow czeka, ale zaden nie jest gotowy` +
        ` (limit prob lub karencja). Odblokuj: mapyouOutbox('retry')`);
      return;
    }
    console.warn(`[Outbox] wysylam ${gotowe.length} zaleglych zapisow` +
      (wstrzymane ? ` (${wstrzymane} wstrzymanych — mapyouOutbox('retry'))` : ''));

    for (const item of items) {
      // Jedyny powod pominiecia: karencja jeszcze trwa.
      //
      // Wczesniej bylo tu takze `if (item.attempts >= MAX_ATTEMPTS) continue;`,
      // czyli zapis po osmiu nieudanych probach PARKOWAL SIE NA ZAWSZE.
      // Zostawal w bazie (dobrze — to dane uzytkownika), ale nikt go juz nigdy
      // nie ponawial. Gdy przyczyna znikala — bo poprawilismy serwer albo
      // dolozylismy metode do CORS — zapis i tak nie ruszal. Trzeba bylo
      // recznie wolac `mapyouOutbox('retry')` z konsoli, czego zwykly
      // uzytkownik nigdy nie zrobi.
      //
      // Teraz limit nie zatrzymuje ponowien, tylko je ZWALNIA (patrz `backoff`
      // nizej): po przekroczeniu progu odstep siega szesciu godzin. Zapis
      // wraca sam, gdy tylko serwer zacznie odpowiadac — bez zadnej akcji
      // ze strony uzytkownika.
      if (item.nextTryAt && Date.now() < item.nextTryAt) continue;
      try {
        // `X-Outbox-Replay` mowi `authFetch`, ze to JUZ jest ponowienie
        // z kolejki. Bez tego przechwytywacz zlapalby blad sieci i dolozyl
        // to samo zadanie DRUGI RAZ — kolejka nigdy by sie nie oproznila,
        // tylko rosla przy kazdej nieudanej probie.
        const res = await fetch(item.url, {
          method:  item.method,
          headers: { ...item.headers, 'Idempotency-Key': item.idemKey, 'X-Outbox-Replay': '1' },
          body:    item.body,
        });

        // Raport z KAZDEJ proby — bez wzgledu na tryb diagnostyczny.
        //
        // Bez tego nieudana wysylka byla niewidoczna: uzytkownik widzial
        // lajka lokalnie, serwer o nim nie wiedzial, a po odswiezeniu stan
        // sie cofal bez zadnego sladu w logach.
        console.warn(`[Outbox] ${item.method} ${item.url.replace(/^https?:\/\/[^/]+/, '')} -> ${res.status}`);

        awaria = 0;   // cokolwiek odpowiedzialo = siec dziala

        if (res.ok || res.status === 409) {
          // 409 traktujemy jak sukces — zasob juz istnieje, czyli poprzednia
          // proba jednak doszla, tylko odpowiedz do nas nie wrocila.
          await tbl().delete(item.id);
          dlog(`[Outbox] wyslano ${item.method} ${item.url}`);
          notifyChange();   // licznik ma spadac na biezaco, nie dopiero na koncu
          continue;
        }

        // 401 i 403 NIE sa trwale — znaczą „nie teraz", nie „nigdy".
        //
        // Token wygasa co godzine, a zadanie moze czekac w kolejce dluzej.
        // Kasowanie go w takiej sytuacji to cicha utrata danych uzytkownika,
        // a dokladnie tego ta kolejka ma zapobiegac.
        if (res.status === 401 || res.status === 403) {
          await tbl().update(item.id, { lastError: `HTTP ${res.status} (czekam na sesje)` });
          try {
            const { onSessionReady } = await import('./authFetch.js');
            onSessionReady(() => { void flush(); });
          } catch { /* noop */ }
          break;   // reszta i tak dostanie to samo
        }

        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          // Blad klienta (400, 403, 404...) nie naprawi sie sam. Ponawianie
          // go w nieskonczonosc tylko obciaza serwer. Usuwamy, ale GLOSNO —
          // to znaczy, ze zapis przepadl i uzytkownik powinien wiedziec.
          const detail = await res.text().catch(() => '');
          console.error(`[Outbox] ODRZUCONY NA STALE ${res.status}: ${item.method} ${item.url}`,
            `\n  cialo zadania: ${item.body?.slice(0, 200) ?? '(brak)'}`,
            `\n  odpowiedz: ${detail.slice(0, 200)}`);
          await tbl().delete(item.id);
          notifyChange();
          continue;
        }

        // ── 5xx / 408 / 429 — serwer odpowiedzial, ale bledem ───────────────
        //
        // TO ZUZYWA PROBE. Wczesniej nie zuzywalo jej NIC: zadna galaz nie
        // zwiekszala `attempts`, wiec `MAX_ATTEMPTS` bylo martwe, a zapis
        // trwale odrzucany przez serwer wracal co 20 sekund w nieskonczonosc.
        //
        // Rozroznienie zostaje takie, jak bylo zamierzone:
        //   brak sieci  -> NIE zuzywa proby (to nie wina zapisu),
        //   blad serwera-> zuzywa, bo powtarzanie go w kolko nic nie da.
        //
        // Karencja rosnie wykladniczo (20 s, 40 s, 80 s... do godziny), wiec
        // osiem prob rozklada sie na kilka godzin, a nie na trzy minuty.
        // To zostawia zapas na zimny start maszyny Fly, ktory bywa 5xx.
        const attempts = item.attempts + 1;
        // Do progu: 20 s, 40 s, 80 s... (do godziny) — szybkie nadrabianie
        // po zimnym starcie Fly. Po progu: staly odstep szesciu godzin, zeby
        // trwale chory zapis nie meczyl serwera, ale TEZ nie umieral.
        const backoff = attempts >= MAX_ATTEMPTS
          ? SLOW_RETRY_MS
          : Math.min(60 * 60_000, 20_000 * 2 ** (attempts - 1));
        await tbl().update(item.id, {
          attempts,
          nextTryAt: Date.now() + backoff,
          lastError: `HTTP ${res.status} (proba ${attempts}/${MAX_ATTEMPTS})`,
        });
        if (attempts === MAX_ATTEMPTS) {
          console.warn(
            `[Outbox] ${MAX_ATTEMPTS} nieudanych prob: ${item.method} ${item.url}` +
            `\n  Przechodze na wolne ponawianie (co 6 h) — zapis NIE jest porzucony` +
            `\n  i wroci sam, gdy serwer zacznie odpowiadac. Recznie: mapyouOutbox('retry')`,
          );
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(
          `[Outbox] blad sieci: ${item.method} ${item.url.replace(/^https?:\/\/[^/]+/, '')}` +
          ` | proba ${item.attempts + 1}/${MAX_ATTEMPTS} | ${msg}`,
        );
        // Blad sieci NIE zuzywa limitu prob.
        //
        // Limit ma chronic przed zadaniem, ktore serwer trwale odrzuca —
        // nie przed slabym zasiegiem. Fly usypia maszyny, wiec pierwsze
        // zadanie po przerwie potrafi paść z bledem sieci; osiem takich
        // i zapis uzytkownika umieral, mimo ze nic z nim nie bylo nie tak.
        await tbl().update(item.id, { lastError: `siec: ${msg}` });

        // ── DLACZEGO NIE PRZERYWAMY OD RAZU ────────────────────────────────
        //
        // Wczesniej bylo tu bezwarunkowe `break` z uzasadnieniem „skoro siec
        // padla, nie ma sensu meczyc reszty". Zalozenie jest bledne: `fetch`
        // rzuca wyjatkiem takze wtedy, gdy siec dziala doskonale, a odrzucone
        // zostalo JEDNO konkretne zadanie — np. przez CORS.
        //
        // Skutek byl powazny: pozycja, ktora zawsze pada, blokowala CALA
        // kolejke za soba. Petla przerywala na niej za kazdym razem, wiec
        // zapisy stojace dalej nie byly proboWane ANI RAZU — takze te nowe,
        // dodane pozniej. Kolejka rosla, pasek pokazywal „7 syncing" bez konca,
        // a zmiany zrobione bez zasiegu nie wysylaly sie po powrocie online.
        // Zadna z nich nie byla zepsuta — po prostu nigdy nie dostaly szansy.
        //
        // Teraz przerywamy dopiero, gdy padnie KILKA pozycji z rzedu albo gdy
        // system jawnie mowi, ze jest offline. Pojedyncza chora pozycja
        // zostaje z boku, a reszta idzie dalej.
        awaria++;
        if (!navigator.onLine || awaria >= 3) {
          console.warn('[Outbox] siec niedostepna — przerywam cykl, wroce automatycznie');
          break;
        }
        continue;
      }
    }
  } finally {
    flushing = false;
    notifyChange();
  }
}

// ── Automatyczna wysylka ─────────────────────────────────────────────────────

/** Skasuj karencje WSZYSTKIM zapisom — kazdy dostaje jedna natychmiastowa probe.
 *
 *  Wolane przy starcie apki i przy powrocie sieci. Po co, skoro karencja i tak
 *  kiedys minie? Bo najczestszy powod dlugiej karencji to awaria, ktora zostala
 *  w miedzyczasie USUNIETA — poprawiony serwer, dolozona metoda w CORS, wygasly
 *  problem u operatora. Czekanie wtedy szesciu godzin nie ma sensu.
 *
 *  Licznika prob NIE zerujemy. Gdyby zapis byl faktycznie chory, po nieudanej
 *  probie wroci do wolnego trybu — a nie zacznie znowu dobijac sie co 20 sekund.
 *  Jedna proba na uruchomienie apki to obciazenie, ktore mozna zignorowac. */
async function reviveAll(): Promise<void> {
  try {
    const all = await tbl().toArray() as OutboxItem[];
    const wstrzymane = all.filter(i => i.nextTryAt);
    if (!wstrzymane.length) return;
    for (const i of wstrzymane) await tbl().update(i.id, { nextTryAt: undefined });
    dlog(`[Outbox] odblokowano ${wstrzymane.length} zapisow po karencji`);
  } catch { /* brak bazy — flush i tak sprobuje */ }
}

let started = false;

/** Uruchom nasluch. Wysylka rusza przy powrocie sieci, przy powrocie
 *  do apki i cyklicznie — bo zdarzenie `online` bywa niewiarygodne
 *  w natywnym WebView. */
export function startOutbox(): void {
  if (started) return;
  started = true;

  // Powrot sieci = najlepszy moment, zeby dac szanse WSZYSTKIM zapisom,
  // takze tym w wolnym trybie. Dlatego najpierw `reviveAll`, potem `flush`.
  window.addEventListener('online', () => { void reviveAll().then(() => flush()); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flush();
  });
  setInterval(() => { void flush(); }, 20_000);
  // Fly usypia maszyny — pierwsze zadanie po przerwie czesto pada.
  // Trzy proby w pierwszych sekundach po powrocie sieci zalatwiaja to bez
  // czekania na kolejny cykl.
  window.addEventListener('online', () => {
    setTimeout(() => { void flush(); }, 2_000);
    setTimeout(() => { void flush(); }, 6_000);
  });
  // Start apki tez zeruje karencje — jesli przyczyna awarii zniknela miedzy
  // sesjami, uzytkownik nie czeka na uplyniecie odstepu. To wlasnie sprawia,
  // ze zaleglosci rozchodza sie SAME, bez `mapyouOutbox('retry')` z konsoli.
  void reviveAll().then(() => flush());
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
export function mountOfflineBar(): void {
  const bar  = document.getElementById('offlineBar');
  const text = document.getElementById('offlineBarText');
  if (!bar || !text) return;

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
  const render = async (queued: number): Promise<void> => {
    const { pendingMediaCount } = await import('./mediaQueue.js');
    const pending = queued + await pendingMediaCount();
    renderCount(pending);
  };

  // Ostatnio pokazany stan. Bez tego pasek wracal przy KAZDYM odpytaniu
  // licznika (co 5 s) — chowal sie po 4,5 s i natychmiast wjezdzal z powrotem,
  // w nieskonczonej petli. Pokazujemy go wylacznie, gdy cos sie ZMIENILO.
  let lastKey = '';

  const renderCount = (pending: number): void => {
    const offline = !navigator.onLine;
    const key = `${offline ? 'off' : 'on'}:${pending}`;
    const changed = key !== lastKey;
    lastKey = key;

    // Jesli wlasnie pokazalismy „Wysylanie…", nie chowaj od razu.
    if (!offline && pending === 0 && syncShownAt) {
      const left = MIN_SYNC_MS - (Date.now() - syncShownAt);
      if (left > 0) { setTimeout(() => renderCount(0), left); return; }
      syncShownAt = 0;
      text.textContent = 'Synced \u2713';
      setTimeout(() => renderCount(0), 900);
      return;
    }

    if (!offline && pending === 0) {
      bar.classList.remove('offline-bar--visible', 'offline-bar--syncing');
      // `hidden` dopiero po animacji zjazdu, zeby nie ucinac przejscia.
      setTimeout(() => { if (!bar.classList.contains('offline-bar--visible')) bar.hidden = true; }, 300);
      return;
    }

    // Stan sie nie zmienil — nie budzimy paska ponownie.
    if (!changed) return;

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
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = window.setTimeout(() => {
      bar.classList.remove('offline-bar--visible');
      setTimeout(() => {
        if (!bar.classList.contains('offline-bar--visible')) bar.hidden = true;
      }, 350);
    }, 4_500);

    if (offline) {
      bar.classList.remove('offline-bar--syncing');
      text.textContent = pending > 0
        ? `Offline — ${pending} ${pending === 1 ? 'change' : 'changes'} pending`
        : 'Offline — changes will sync automatically';
    } else {
      bar.classList.add('offline-bar--syncing');
      text.textContent = `Syncing… (${pending})`;
      if (!syncShownAt) syncShownAt = Date.now();
    }
  };

  onOutboxChange(n => { void render(n); });
  window.addEventListener('online',  () => { void pendingCount().then(n => render(n)); });
  window.addEventListener('offline', () => { void pendingCount().then(n => render(n)); });
  // Zdjecia wysylaja sie wlasnym cyklem — odswiezamy licznik co 5 s,
  // zeby pasek nie zostal na starej liczbie po wyslaniu pliku.
  setInterval(() => { void pendingCount().then(n => render(n)); }, 5_000);
}


// ── Diagnostyka ──────────────────────────────────────────────────────────────

/** Podglad kolejki z konsoli:  mapyouOutbox()
 *
 *  mapyouOutbox()         — co czeka, ile prob, na czym padlo
 *  mapyouOutbox('retry')  — zeruje licznik prob i karencje, wysyla od nowa
 *  mapyouOutbox(true)     — czysci kolejke BEZPOWROTNIE
 *
 *  Tryb 'retry' jest potrzebny, bo rekord po wyczerpaniu limitu prob zostaje
 *  w bazie, ale nie jest juz nigdy ponawiany. To celowe — dane uzytkownika
 *  nie znikaja po cichu — ale gdy przyczyna zostanie usunieta (np. brakujaca
 *  metoda w CORS albo naprawiony serwer), trzeba go moc odblokowac.
 *  Bez tego jedynym wyjsciem bylo kasowanie, czyli utrata zapisow. */
(window as unknown as Record<string, unknown>).mapyouOutbox =
  async (purge: boolean | string = false): Promise<unknown> => {
    if (purge === 'retry') {
      const all = await listPending();
      const stuck = all.filter(i =>
        i.attempts > 0 || (i.nextTryAt && Date.now() < i.nextTryAt));
      for (const i of stuck) {
        await tbl().update(i.id, { attempts: 0, nextTryAt: undefined, lastError: null });
      }
      notifyChange();
      void flush();
      return `Odblokowano ${stuck.length} z ${all.length} zapisow — wysylam od nowa.`;
    }
    if (purge === true) {
      const n = await pendingCount();
      await tbl().clear();
      notifyChange();
      return `Wyczyszczono kolejke (${n} pozycji BEZPOWROTNIE utraconych).`;
    }
    const items = await listPending();
    if (!items.length) return 'Kolejka pusta.';
    return items.map(i => ({
      id: i.id,
      zadanie: `${i.method} ${i.url.replace(/^https?:\/\/[^/]+/, '')}`,
      prob: i.attempts,
      blad: i.lastError ?? '—',
      czeka: `${Math.round((Date.now() - i.createdAt) / 1000)} s`,
    }));
  };
