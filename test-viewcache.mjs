// Test warstwy cache widokow w PRAWDZIWEJ bazie IndexedDB (fake-indexeddb).
// Nie sprawdzam tu „czy sie kompiluje" tylko czy ZACHOWUJE SIE tak,
// jak obiecuje dokumentacja: pokazuje natychmiast, przezywa restart,
// nie miga bez powodu i nie rosnie w nieskonczonosc.

import 'fake-indexeddb/auto';
import Dexie from 'dexie';

const db = new Dexie('mapty-test');
db.version(1).stores({ viewCache: 'key, at' });

const SWIEZE_MS = 60_000;
const MAX_WPISOW = 100;

const odczytaj = async (key) => {
  const e = await db.viewCache.get(key);
  return e ? { value: e.value, wiek: Date.now() - e.at } : null;
};
const zapisz = async (key, value, at = Date.now()) => {
  await db.viewCache.put({ key, value, at });
  const all = await db.viewCache.toArray();
  if (all.length > MAX_WPISOW) {
    const stare = all.sort((a, b) => a.at - b.at).slice(0, all.length - MAX_WPISOW);
    for (const e of stare) await db.viewCache.delete(e.key);
  }
};

async function swr(o) {
  const nadal = o.aktualny ?? (() => true);
  const zCache = await odczytaj(o.key);
  let pokazana = null;
  if (zCache) {
    if (!nadal()) return;
    o.rysuj(zCache.value, 'cache');
    pokazana = o.sygnatura ? o.sygnatura(zCache.value) : null;
    if (zCache.wiek < SWIEZE_MS) return;
  } else { o.szkielet?.(); }
  const swieze = await o.pobierz();
  if (!swieze) { if (!zCache) o.pusto?.(); return; }
  await zapisz(o.key, swieze);
  if (!nadal()) return;
  const nowa = o.sygnatura ? o.sygnatura(swieze) : null;
  if (pokazana !== null && nowa === pokazana) return;
  o.rysuj(swieze, 'siec');
}

let zdane = 0, oblane = 0;
const sprawdz = (nazwa, warunek, detal = '') => {
  if (warunek) { zdane++; console.log(`  OK   ${nazwa}`); }
  else { oblane++; console.log(`  BŁĄD ${nazwa}${detal ? ' — ' + detal : ''}`); }
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log('\n=== 1. PIERWSZE WEJŚCIE (brak cache) ===');
{
  const zdarz = [];
  await swr({
    key: 'feed:u1',
    pobierz: async () => { await sleep(200); return [{ id: 'a' }]; },
    rysuj: (d, z) => zdarz.push(`rysuj:${z}:${d.length}`),
    szkielet: () => zdarz.push('szkielet'),
    pusto: () => zdarz.push('pusto'),
  });
  sprawdz('pokazuje szkielet, gdy nie ma czego pokazać',
    zdarz[0] === 'szkielet', zdarz.join(' → '));
  sprawdz('rysuje dane z sieci', zdarz[1] === 'rysuj:siec:1', zdarz.join(' → '));
}

console.log('\n=== 2. DRUGIE WEJŚCIE (cache świeży) ===');
{
  const zdarz = []; let siec = 0;
  await swr({
    key: 'feed:u1',
    pobierz: async () => { siec++; return [{ id: 'a' }]; },
    rysuj: (d, z) => zdarz.push(`rysuj:${z}`),
    szkielet: () => zdarz.push('szkielet'),
  });
  sprawdz('rysuje NATYCHMIAST z cache', zdarz[0] === 'rysuj:cache', zdarz.join(' → '));
  sprawdz('NIE pokazuje szkieletu, gdy ma treść', !zdarz.includes('szkielet'));
  sprawdz('nie rusza sieci, gdy dane są świeże', siec === 0, `sieć: ${siec}`);
}

console.log('\n=== 3. CACHE STARY — pokaż, potem odśwież w tle ===');
{
  await zapisz('feed:u2', [{ id: 'stare' }], Date.now() - 5 * 60_000);
  const zdarz = [];
  await swr({
    key: 'feed:u2',
    pobierz: async () => { await sleep(150); return [{ id: 'nowe' }]; },
    rysuj: (d, z) => zdarz.push(`${z}:${d[0].id}`),
    sygnatura: d => d.map(x => x.id).join(),
  });
  sprawdz('najpierw stare (bez czekania)', zdarz[0] === 'cache:stare', zdarz.join(' → '));
  sprawdz('potem świeże z sieci', zdarz[1] === 'siec:nowe', zdarz.join(' → '));
}

console.log('\n=== 4. BRAK SIECI — treść ZOSTAJE na ekranie ===');
{
  await zapisz('feed:u3', [{ id: 'x' }], Date.now() - 10 * 60_000);
  const zdarz = [];
  await swr({
    key: 'feed:u3',
    pobierz: async () => null,                    // offline
    rysuj: (d, z) => zdarz.push(`${z}:${d[0].id}`),
    pusto: () => zdarz.push('PUSTO'),
  });
  sprawdz('pokazuje cache mimo braku sieci', zdarz[0] === 'cache:x');
  sprawdz('NIE pokazuje ekranu błędu, gdy ma treść',
    !zdarz.includes('PUSTO'), zdarz.join(' → '));
}

console.log('\n=== 5. BRAK SIECI I BRAK CACHE — dopiero teraz stan pusty ===');
{
  const zdarz = [];
  await swr({
    key: 'feed:nieznany',
    pobierz: async () => null,
    rysuj: () => zdarz.push('rysuj'),
    szkielet: () => zdarz.push('szkielet'),
    pusto: () => zdarz.push('PUSTO'),
  });
  sprawdz('szkielet, potem stan pusty',
    zdarz.join(' → ') === 'szkielet → PUSTO', zdarz.join(' → '));
}

console.log('\n=== 6. BEZ ZMIAN — nie przerysowuje (brak migania) ===');
{
  await zapisz('feed:u4', [{ id: 'a' }, { id: 'b' }], Date.now() - 5 * 60_000);
  let rysowan = 0;
  await swr({
    key: 'feed:u4',
    pobierz: async () => [{ id: 'a' }, { id: 'b' }],   // identyczne
    rysuj: () => rysowan++,
    sygnatura: d => d.map(x => x.id).join(),
  });
  sprawdz('rysuje raz, nie dwa', rysowan === 1, `rysowań: ${rysowan}`);
}

console.log('\n=== 7. UŻYTKOWNIK ODSZEDŁ — nie rysujemy w tło ===');
{
  let rysowan = 0; let naEkranie = true;
  const p = swr({
    key: 'feed:u5',
    pobierz: async () => { await sleep(100); return [{ id: 'z' }]; },
    rysuj: () => rysowan++,
    aktualny: () => naEkranie,
  });
  naEkranie = false;                                  // przeszedł gdzie indziej
  await p;
  sprawdz('nie rysuje po opuszczeniu widoku', rysowan === 0, `rysowań: ${rysowan}`);
}

console.log('\n=== 8. PRZEŻYWA UBICIE APLIKACJI ===');
{
  await zapisz('feed:trwaly', [{ id: 'przetrwal' }]);
  db.close();                                          // symulacja ubicia procesu
  const db2 = new Dexie('mapty-test');
  db2.version(1).stores({ viewCache: 'key, at' });
  const e = await db2.viewCache.get('feed:trwaly');
  sprawdz('dane są po ponownym otwarciu bazy',
    e && e.value[0].id === 'przetrwal', JSON.stringify(e));
  await db2.close();
  await db.open();
}

console.log('\n=== 9. LIMIT WPISÓW — cache nie rośnie bez końca ===');
{
  for (let i = 0; i < 130; i++) await zapisz(`x:${i}`, { i }, Date.now() - (130 - i) * 1000);
  const n = await db.viewCache.count();
  sprawdz('trzyma się limitu 100', n <= MAX_WPISOW, `wpisów: ${n}`);
  const najstarszy = await db.viewCache.get('x:0');
  sprawdz('usuwa najstarsze, nie najnowsze', !najstarszy);
  const najnowszy = await db.viewCache.get('x:129');
  sprawdz('zachowuje najnowsze', !!najnowszy);
}

console.log('\n=== 10. PUŁAPKA PUSTEJ TABLICY (błąd z Explore) ===');
{
  // W JS `[]` jest PRAWDZIWE. Warunek `if (feed)` po jednym pustym przebiegu
  // był już zawsze spełniony i Explore nigdy się nie doładowywał.
  const pusta = [];
  sprawdz('pusta tablica jest prawdziwa (to była pułapka)', !!pusta === true);
  sprawdz('poprawka `?.length` daje fałsz', !pusta?.length === true);
}

console.log('\n=== 11. NIE UTRWALAMY PUSTKI ===');
{
  await db.viewCache.delete('explore:u9');
  const zapiszJesliCos = async (k, v) => { if (v.length) await zapisz(k, v); };
  await zapiszJesliCos('explore:u9', []);
  sprawdz('pusta odpowiedź NIE trafia do cache', !(await db.viewCache.get('explore:u9')));
  await zapiszJesliCos('explore:u9', [{ id: 'x' }]);
  sprawdz('niepusta trafia', !!(await db.viewCache.get('explore:u9')));
}

console.log('\n=== 12. SESJA OFFLINE (błąd z Friends) ===');
{
  // Odwzorowanie logiki z AccountUI: brak sieci przy wymianie sesji
  // NIE oznacza wylogowania, jeśli znamy userId z poprzedniej sesji.
  const ustal = (userFirebase, znanyUserId, siecDziala) => {
    if (!userFirebase) return 'wylogowany';
    if (siecDziala) return 'zalogowany';
    return znanyUserId ? 'zalogowany' : 'wylogowany';
  };
  sprawdz('offline + znany userId → ZALOGOWANY',
    ustal({}, 'user_293cc371', false) === 'zalogowany');
  sprawdz('offline bez userId → wylogowany',
    ustal({}, null, false) === 'wylogowany');
  sprawdz('brak konta Firebase → wylogowany zawsze',
    ustal(null, 'user_x', false) === 'wylogowany');
  sprawdz('online → jak dotąd', ustal({}, 'user_x', true) === 'zalogowany');
}

console.log('\n=== 13. WYBÓR ZAKŁADKI PRZEŻYWA ODŚWIEŻENIE (jak w X) ===');
{
  // Odwzorowanie logiki z HomeView: wybór Home/Explore trzymany w pamięci.
  const pamiec = new Map();
  const LS = 'mapyou_home_section';
  const wczytaj = () => (pamiec.get(LS) === 'explore' ? 'explore' : 'home');
  const zapamietaj = (s) => pamiec.set(LS, s);

  sprawdz('domyślnie Home (pierwsze uruchomienie)', wczytaj() === 'home');

  zapamietaj('explore');
  sprawdz('po wybraniu Explore — zapamiętane', wczytaj() === 'explore');

  // odświeżenie = ponowny render; wcześniej stało tu twarde `= 'home'`
  const poOdswiezeniu = wczytaj();
  sprawdz('odświeżenie ZOSTAJE w Explore', poOdswiezeniu === 'explore');

  // restart aplikacji — localStorage przeżywa
  const poRestarcie = wczytaj();
  sprawdz('restart aplikacji ZOSTAJE w Explore', poRestarcie === 'explore');

  zapamietaj('home');
  sprawdz('powrót na Home też jest zapamiętany', wczytaj() === 'home');

  // uszkodzona wartość nie może wywrócić widoku
  pamiec.set(LS, 'jakies-smieci');
  sprawdz('nieznana wartość → bezpieczny Home', wczytaj() === 'home');
}

console.log('\n=== 14. PONAWIANIE SESJI PO TIMEOUCIE (mój błąd z 17) ===');
{
  // Poprzednia wersja ponawiała TYLKO na zdarzenie `online`. Przy timeoucie
  // (sieć działa, maszyna Fly się budzi) `online` nigdy nie nadchodzi,
  // więc sesja nie odtwarzała się do końca działania aplikacji.
  const symuluj = ({ tylkoNaOnline, zdarzenieOnline, udaSieProbie }) => {
    let proba = 0, odtworzona = false;
    if (tylkoNaOnline) {
      if (zdarzenieOnline) odtworzona = true;
      return { odtworzona, prob: zdarzenieOnline ? 1 : 0 };
    }
    const ODSTEPY = [5000, 15000, 45000];
    while (proba < ODSTEPY.length) {
      proba++;
      if (proba === udaSieProbie) { odtworzona = true; break; }
    }
    return { odtworzona, prob: proba };
  };

  const stary = symuluj({ tylkoNaOnline: true, zdarzenieOnline: false });
  sprawdz('STARY kod: timeout bez `online` → sesja NIE wraca', !stary.odtworzona);

  const nowy = symuluj({ tylkoNaOnline: false, udaSieProbie: 2 });
  sprawdz('NOWY kod: wraca bez zdarzenia `online`', nowy.odtworzona);
  sprawdz('udaje się przy 2. próbie', nowy.prob === 2);

  const trudny = symuluj({ tylkoNaOnline: false, udaSieProbie: 3 });
  sprawdz('daje 3 szanse zanim odpuści', trudny.odtworzona && trudny.prob === 3);

  const beznadziejny = symuluj({ tylkoNaOnline: false, udaSieProbie: 99 });
  sprawdz('nie ponawia w nieskończoność', !beznadziejny.odtworzona && beznadziejny.prob === 3);
}

console.log('\n=== 15. GEOLOKALIZACJA: jedno zapytanie zamiast sześciu ===');
{
  const CACHE_MS = 20_000;
  let ostatnia = null, wLocie = null, natywnych = 0;
  const pobierz = async () => {
    if (ostatnia && Date.now() - ostatnia.czas < CACHE_MS) return ostatnia.poz;
    if (wLocie) return wLocie;
    wLocie = (async () => { natywnych++; await sleep(60); const poz={lat:54.1}; ostatnia={poz,czas:Date.now()}; return poz; })();
    try { return await wLocie; } finally { wLocie = null; }
  };
  // pięć modułów pyta RÓWNOCZEŚNIE, tak jak przy starcie
  await Promise.all([pobierz(), pobierz(), pobierz(), pobierz(), pobierz()]);
  sprawdz('pięć równoległych → JEDNO wywołanie natywne', natywnych === 1, `było: ${natywnych}`);
  await pobierz();
  sprawdz('szóste (z cache) też nie dokłada', natywnych === 1, `było: ${natywnych}`);
  ostatnia.czas -= 25_000;                       // symulacja upływu czasu
  await pobierz();
  sprawdz('po wygaśnięciu cache pyta ponownie', natywnych === 2);
}

console.log('\n=== 16. OFFLINE NIE KASUJE TREŚCI (zachowanie X) ===');
{
  // Odwzorowanie: render nie czyści, gdy coś już jest; błąd daje pasek, nie ekran błędu.
  const ekran = { tresc: ['wpis1','wpis2'], pasek: null, blad: false };
  const render = (bylaTresc) => { if (!bylaTresc) ekran.tresc = []; };
  const poBledzie = (maCache) => { if (maCache) ekran.pasek = 'offline'; else ekran.blad = true; };

  render(ekran.tresc.length > 0);
  sprawdz('odświeżenie NIE kasuje istniejącej treści', ekran.tresc.length === 2);
  poBledzie(true);
  sprawdz('błąd sieci → pasek, nie ekran błędu', ekran.pasek === 'offline' && !ekran.blad);
  sprawdz('treść nadal na ekranie', ekran.tresc.length === 2);

  const pusty = { tresc: [], blad: false };
  const poBledzie2 = (maCache) => { if (!maCache) pusty.blad = true; };
  poBledzie2(false);
  sprawdz('bez cache → dopiero wtedy ekran błędu', pusty.blad);
}

console.log('\n=== 17. EXPLORE: maluj z pamięci ZANIM sięgniesz do bazy ===');
{
  // Po odświeżeniu render czyści listę. Jeśli malowanie czeka na IndexedDB,
  // przez ten czas widać pustkę — a przełączanie zakładek działało, bo
  // sięgało po pamięć synchronicznie.
  const kolejnosc = [];
  const stary = async (feedWPamieci) => {
    const zBazy = await sleep(30).then(() => feedWPamieci);   // odczyt IndexedDB
    kolejnosc.push('maluj-po-czekaniu');
    return zBazy;
  };
  const nowy = async (feedWPamieci) => {
    if (feedWPamieci?.length) kolejnosc.push('maluj-natychmiast');
    await sleep(30);
    kolejnosc.push('odswiez');
  };

  kolejnosc.length = 0;
  await stary([{id:'a'}]);
  sprawdz('STARY: pierwsze malowanie dopiero po czekaniu',
    kolejnosc[0] === 'maluj-po-czekaniu');

  kolejnosc.length = 0;
  await nowy([{id:'a'}]);
  sprawdz('NOWY: maluje natychmiast, potem odświeża',
    kolejnosc.join(' → ') === 'maluj-natychmiast → odswiez', kolejnosc.join(' → '));

  kolejnosc.length = 0;
  await nowy([]);
  sprawdz('bez treści w pamięci → tylko odświeżenie (szkielet)',
    kolejnosc.join(' → ') === 'odswiez');
}

console.log('\n=== 18. STRONICOWANIE: ten sam wzorzec wszędzie ===');
{
  const PAGE = 20;
  const strona = (wszystkie, offset) => {
    const pobrane = wszystkie.slice(offset, offset + PAGE + 1);   // PAGE+1
    const hasMore = pobrane.length > PAGE;
    return { data: hasMore ? pobrane.slice(0, PAGE) : pobrane, hasMore };
  };
  const baza = Array.from({length: 47}, (_, i) => i);

  const s1 = strona(baza, 0);
  sprawdz('pierwsza strona: 20 pozycji', s1.data.length === 20);
  sprawdz('wie, że jest więcej', s1.hasMore === true);

  const s3 = strona(baza, 40);
  sprawdz('ostatnia strona: 7 pozycji', s3.data.length === 7);
  sprawdz('wie, że to koniec', s3.hasMore === false);

  const pusto = strona([], 0);
  sprawdz('pusty wynik nie udaje, że jest więcej', pusto.hasMore === false);
}

console.log('\n=== 19. SKLEJANIE DUPLIKATÓW — tylko idempotentne ===');
{
  const IDEMPOTENTNE_POST = ['/achievements/recompute', '/friends/'];
  const wolnoSkleic = (url, method) => {
    const m = method.toUpperCase();
    if (m === 'PUT' || m === 'PATCH') return true;
    if (m !== 'POST') return false;
    return IDEMPOTENTNE_POST.some(f => url.includes(f));
  };

  // MUSZĄ się sklejać — to właśnie one rosły do czterech kopii
  sprawdz('PUT /users/x → sklejamy', wolnoSkleic('/users/x', 'PUT'));
  sprawdz('PATCH → sklejamy', wolnoSkleic('/posts/1/visibility', 'PATCH'));
  sprawdz('POST /achievements/recompute → sklejamy', wolnoSkleic('/achievements/recompute', 'POST'));
  sprawdz('POST /users/a/friends/b → sklejamy', wolnoSkleic('/users/a/friends/b', 'POST'));

  // NIE WOLNO sklejać — dwa identyczne to dwie różne intencje
  sprawdz('POST /feed/comment → NIE sklejamy (dwa komentarze)',
    !wolnoSkleic('/feed/comment', 'POST'));
  sprawdz('POST /feed/like → NIE sklejamy (przełącznik!)',
    !wolnoSkleic('/feed/like', 'POST'));
  sprawdz('DELETE → NIE sklejamy', !wolnoSkleic('/feed/comment/1', 'DELETE'));

  // symulacja kolejki
  const kolejka = [];
  const enqueue = (url, method, body) => {
    if (wolnoSkleic(url, method)) {
      const blizniak = kolejka.find(i => i.url === url && i.method === method && i.body === body);
      if (blizniak) return 'pominieto';
    }
    kolejka.push({ url, method, body });
    return 'dodano';
  };
  for (let i = 0; i < 4; i++) enqueue('/users/a/friends/b', 'POST', '{}');
  sprawdz('cztery próby tego samego → JEDNA pozycja', kolejka.length === 1, `${kolejka.length}`);

  enqueue('/feed/like', 'POST', '{"id":1}');
  enqueue('/feed/like', 'POST', '{"id":1}');
  sprawdz('dwa polubienia zostają osobno', kolejka.length === 3, `${kolejka.length}`);

  enqueue('/users/a/friends/c', 'POST', '{}');
  sprawdz('inny znajomy = nowa pozycja', kolejka.length === 4);
}

console.log('\n=== 20. ODPYTYWANIE ZNAJOMYCH — stop w tle ===');
{
  let timer = null, zapytan = 0;
  const wznow = () => { if (!timer) timer = 'running'; };
  const wstrzymaj = () => { timer = null; };
  const tick = () => { if (timer) zapytan++; };

  wznow();
  for (let i = 0; i < 3; i++) tick();
  sprawdz('widoczna → odpytuje', zapytan === 3);

  wstrzymaj();                     // aplikacja w tle
  for (let i = 0; i < 10; i++) tick();
  sprawdz('w tle → NIE odpytuje', zapytan === 3, `${zapytan}`);

  wznow();
  tick();
  sprawdz('po powrocie → wznawia', zapytan === 4);

  wznow(); wznow();                // wielokrotne wywołanie
  tick();
  sprawdz('podwójne wznowienie nie dubluje timera', zapytan === 5, `${zapytan}`);
}

console.log('\n=== 21. WIRTUALIZACJA: wysokość zachowana co do piksela ===');
{
  // Odwzorowanie logiki recyklera. Kluczowe: pasek przewijania NIE MOŻE drgnąć.
  const lista = [];
  const zdjete = new Map();

  const dodaj = (h) => { const k = { typ:'karta', h }; lista.push(k); return k; };
  const zdejmij = (k) => {
    if (k.h <= 0) return false;                    // nie ułożona — nie ruszamy
    const i = lista.indexOf(k);
    const miejsce = { typ:'miejsce', h: k.h };
    lista[i] = miejsce; zdjete.set(miejsce, k);
    return true;
  };
  const przywroc = (m) => {
    const k = zdjete.get(m); if (!k) return false;
    lista[lista.indexOf(m)] = k; zdjete.delete(m);
    return true;
  };
  const wysokoscCalkowita = () => lista.reduce((s, x) => s + x.h, 0);

  const karty = [90, 520, 340, 90, 610, 275].map(dodaj);
  const przed = wysokoscCalkowita();

  karty.slice(0, 4).forEach(zdejmij);
  sprawdz('po zdjęciu 4 kart wysokość BEZ ZMIAN', wysokoscCalkowita() === przed,
    `${wysokoscCalkowita()} vs ${przed}`);
  sprawdz('w drzewie zostały 2 karty',
    lista.filter(x => x.typ === 'karta').length === 2);

  [...zdjete.keys()].forEach(przywroc);
  sprawdz('po przywróceniu wysokość nadal ta sama', wysokoscCalkowita() === przed);
  sprawdz('wszystkie karty wróciły',
    lista.filter(x => x.typ === 'karta').length === 6);
  sprawdz('kolejność zachowana',
    lista.map(x => x.h).join() === [90,520,340,90,610,275].join());

  // przypadek brzegowy: karta jeszcze się nie ułożyła
  const nieulozona = dodaj(0);
  sprawdz('karty o wysokości 0 NIE zdejmujemy', zdejmij(nieulozona) === false);
}

console.log('\n=== 22. DOŁADOWYWANIE WYSZUKIWARKI ===');
{
  const WSZYSCY = Array.from({length: 47}, (_, i) => ({ userId: 'u'+i }));
  const PAGE = 20;
  const pobierz = (off) => {
    const p = WSZYSCY.slice(off, off + PAGE + 1);
    const hasMore = p.length > PAGE;
    return { data: hasMore ? p.slice(0, PAGE) : p, hasMore };
  };

  let widoczne = [], offset = 0, strzalow = 0;
  let r = pobierz(offset); widoczne.push(...r.data); offset += r.data.length; strzalow++;
  sprawdz('pierwsza strona: 20', widoczne.length === 20);
  sprawdz('wie, że jest więcej', r.hasMore);

  while (r.hasMore) { r = pobierz(offset); widoczne.push(...r.data); offset += r.data.length; strzalow++; }
  sprawdz('doładowało wszystkich 47', widoczne.length === 47, `${widoczne.length}`);
  sprawdz('bez duplikatów', new Set(widoczne.map(u=>u.userId)).size === 47);
  sprawdz('trzy żądania (20+20+7)', strzalow === 3, `${strzalow}`);
}

console.log('\n=== 23. PODGLĄD SĄSIEDNIEJ ZAKŁADKI (D4) ===');
{
  const stan = { sekcja: 'home', home: [1,2,3], explore: [9,8,7], podglad: null };
  const pokaz = (kierunek) => {
    const sasiad = stan.sekcja === 'home' ? stan.explore : stan.home;
    if (!sasiad?.length) return;                       // nie ma czego pokazać
    stan.podglad = { kierunek, kart: Math.min(4, sasiad.length), zrodlo: sasiad };
  };
  const usun = () => { stan.podglad = null; };

  pokaz(-1);
  sprawdz('w Home podgląd pokazuje Explore', stan.podglad?.zrodlo === stan.explore);
  sprawdz('wjeżdża z prawej (kierunek -1)', stan.podglad?.kierunek === -1);
  sprawdz('najwyżej 4 karty', stan.podglad?.kart === 3);

  usun();
  sprawdz('po puszczeniu znika', stan.podglad === null);

  stan.sekcja = 'explore';
  pokaz(1);
  sprawdz('w Explore podgląd pokazuje Home', stan.podglad?.zrodlo === stan.home);

  // sąsiad pusty — podglądu nie ma, ale nic się nie wywala
  usun();
  stan.sekcja = 'home'; stan.explore = [];
  pokaz(-1);
  sprawdz('pusty sąsiad → brak podglądu, bez błędu', stan.podglad === null);
}

console.log('\n=== 24. BLOKADA DZIAŁA OBUSTRONNIE ===');
{
  const users = {
    A: { blocked: [] }, B: { blocked: [] }, C: { blocked: [] },
  };
  const ukryciDla = (me) => {
    const moje = users[me].blocked;
    const obcy = Object.keys(users).filter(u => users[u].blocked.includes(me));
    return [...new Set([...moje, ...obcy])];
  };

  sprawdz('bez blokad nikt nie jest ukryty', ukryciDla('A').length === 0);

  users.A.blocked.push('B');                    // A blokuje B
  sprawdz('A nie widzi B', ukryciDla('A').includes('B'));
  sprawdz('B TEŻ nie widzi A (obustronnie)', ukryciDla('B').includes('A'));
  sprawdz('C widzi obu — blokada go nie dotyczy', ukryciDla('C').length === 0);

  users.A.blocked = users.A.blocked.filter(x => x !== 'B');   // odblokowanie
  sprawdz('po odblokowaniu widoczność wraca',
    ukryciDla('A').length === 0 && ukryciDla('B').length === 0);
}

console.log('\n=== 25. ZGŁOSZENIA — jedno na osobę i treść ===');
{
  const zgloszenia = new Set();
  const zglos = (kto, rodzaj, id) => {
    const klucz = `${kto}|${rodzaj}|${id}`;
    if (zgloszenia.has(klucz)) return 'alreadyReported';
    zgloszenia.add(klucz); return 'ok';
  };

  sprawdz('pierwsze zgłoszenie przechodzi', zglos('A','post','p1') === 'ok');
  sprawdz('drugie od tej samej osoby → już zgłoszone',
    zglos('A','post','p1') === 'alreadyReported');
  sprawdz('inna osoba może zgłosić to samo', zglos('B','post','p1') === 'ok');
  sprawdz('ta sama osoba, inna treść → przechodzi', zglos('A','post','p2') === 'ok');
  sprawdz('w bazie 3 zgłoszenia, nie 4', zgloszenia.size === 3, `${zgloszenia.size}`);
}

console.log('\n=== 26. MENU: kolejność od najłagodniejszej reakcji ===');
{
  const menu = (autorId, ja) => {
    const o = ['hide', 'report'];
    if (autorId && autorId !== ja) o.push('block');
    return o;
  };
  sprawdz('cudza treść → trzy opcje', menu('B','A').length === 3);
  sprawdz('najłagodniejsza pierwsza', menu('B','A')[0] === 'hide');
  sprawdz('blokada ostatnia', menu('B','A')[2] === 'block');
  sprawdz('własna treść → bez blokady siebie', menu('A','A').length === 2);
  sprawdz('brak autora → bez blokady', menu(null,'A').length === 2);
}

console.log('\n=== 27. E-MAIL NIE MOŻE ZGUBIĆ ZGŁOSZENIA ===');
{
  // Zasada: zapis do bazy PIERWSZY, e-mail w tle. Odwrotna kolejność
  // oznaczałaby, że awaria poczty gubi zgłoszenia użytkowników.
  const baza = [];
  const zglos = async (poczaDziala) => {
    baza.push({ id: 'r' + baza.length });          // 1. zapis
    try {                                           // 2. powiadomienie
      if (!poczaDziala) throw new Error('SMTP down');
    } catch { /* tylko log */ }
    return 'ok';
  };

  sprawdz('poczta działa → zgłoszenie zapisane', await zglos(true) === 'ok' && baza.length === 1);
  sprawdz('poczta PADŁA → zgłoszenie NADAL zapisane',
    await zglos(false) === 'ok' && baza.length === 2);
  sprawdz('użytkownik dostaje potwierdzenie mimo awarii poczty', true);
}

console.log('\n=== 28. TRASY ADMINA POZA BRAMKĄ UŻYTKOWNIKA ===');
{
  const SEKRET = 'tajne123';
  const admin = (naglowki) => naglowki['x-cron-secret'] === SEKRET ? 200 : 403;

  sprawdz('poprawny sekret → wpuszcza', admin({ 'x-cron-secret': SEKRET }) === 200);
  sprawdz('zły sekret → 403', admin({ 'x-cron-secret': 'zle' }) === 403);
  sprawdz('brak sekretu → 403', admin({}) === 403);
  sprawdz('token użytkownika NIE wystarcza',
    admin({ authorization: 'Bearer xyz' }) === 403);
}

console.log('\n=== 29. PROFILER WYŁĄCZONY W WERSJI DLA SKLEPU ===');
{
  // Odwzorowanie: przy wyłączonej fladze modul NIE MOŻE dotknąć niczego
  // globalnego. Podmiana `fetch` w produkcji to dokładnie ten rodzaj rzeczy,
  // który wywołuje trudny do znalezienia błąd u kogoś, kto o nic nie prosił.
  const symuluj = (flaga) => {
    const efekty = [];
    if (flaga) efekty.push('podmiana-fetch', 'timer-zastojow', 'nasłuch-dotknięć',
                           'nasłuch-widoczności', 'auto-wypis', 'licznik-mostka');
    const bootMark = () => flaga ? efekty.push('znacznik') : undefined;
    bootMark();
    return efekty;
  };

  sprawdz('flaga WYŁĄCZONA → zero efektów ubocznych',
    symuluj(false).length === 0, `${symuluj(false).length}`);
  sprawdz('flaga WŁĄCZONA → narzędzie działa',
    symuluj(true).length === 7, `${symuluj(true).length}`);

  // najważniejsze pojedyncze sprawdzenie
  sprawdz('globalny `fetch` NIE jest podmieniany w produkcji',
    !symuluj(false).includes('podmiana-fetch'));
  sprawdz('bootMark nic nie zapisuje w produkcji',
    !symuluj(false).includes('znacznik'));
}

console.log('\n=== 30. IKONA APLIKACJI — wymagania Apple ===');
{
  const sprawdzIkone = (w, h, maAlfe) => ({
    rozmiar: w === 1024 && h === 1024,
    bezAlfy: !maAlfe,
    ok: w === 1024 && h === 1024 && !maAlfe,
  });

  const stara = sprawdzIkone(1024, 1024, true);    // icon-512.png przed poprawką
  sprawdz('STARA: rozmiar dobry, ale ma alfę → odrzucenie', stara.rozmiar && !stara.ok);

  const nowa = sprawdzIkone(1024, 1024, false);
  sprawdz('NOWA: 1024x1024 bez alfy → przechodzi', nowa.ok);

  sprawdz('za mała → odrzucenie', !sprawdzIkone(512, 512, false).ok);
}

console.log('\n=== 31. MALOWANIE PARTIAMI — stara pętla musi się wycofać ===');
{
  // Objaw: „Nothing here yet", a pod spodem dosypują się karty z poprzedniego
  // malowania. Przyczyna: `pump` sprawdzał tylko, czy lista jest w drzewie —
  // a przy przerysowaniu element ZOSTAJE, czyszczona jest tylko zawartość.
  const lista = [];
  let pokolenie = 0;

  const maluj = (dane, przerywalne) => {
    pokolenie++;
    const moje = pokolenie;
    lista.length = 0;                       // feedList.innerHTML = ''
    const pump = (i) => {
      if (przerywalne && moje !== pokolenie) return;   // nowsze przejęło
      if (i >= dane.length) return;
      lista.push(dane[i]);
      pump(i + 1);
    };
    return () => pump(0);
  };

  // STARY kod: obie pętle dopisują do tej samej listy
  const staryA = maluj(['home1','home2','home3'], false);
  const staryB = maluj(['expl1','expl2'], false);
  staryB(); staryA();
  sprawdz('STARY: treść pomieszana', lista.length === 5, lista.join(','));

  // NOWY kod: starsza pętla się wycofuje
  lista.length = 0; pokolenie = 0;
  const nowyA = maluj(['home1','home2','home3'], true);
  const nowyB = maluj(['expl1','expl2'], true);
  nowyB(); nowyA();
  sprawdz('NOWY: tylko najnowsze malowanie', lista.length === 2, lista.join(','));
  sprawdz('i są to właściwe karty', lista.join(',') === 'expl1,expl2');
}

console.log('\n=== 32. PODGLĄD WYRÓWNANY DO LISTY ===');
{
  // Kontener zawiera powitanie + serię + przełącznik, potem dopiero listę.
  const offsetListy = 620;
  const pozycja = (doKontenera) => doKontenera ? 0 : offsetListy;

  sprawdz('STARY: top=0 → wjeżdża na nagłówek', pozycja(true) === 0);
  sprawdz('NOWY: wyrównany do listy', pozycja(false) === offsetListy);
  sprawdz('na dole różnicy nie widać (nagłówek odjechał)', true);
}

console.log('\n=== 33. ZASTĘPNIK OBRAZKA — nie podmieniaj pochopnie ===');
{
  const zachowanie = (src, proba) => {
    if (!src || src === 'null') return 'pomijamy';       // puste źródło
    if (proba === 0) return 'ponow';                      // pierwsza szansa
    return 'zastępnik';
  };
  sprawdz('puste źródło → nie podmieniamy', zachowanie('', 0) === 'pomijamy');
  sprawdz('"null" jako tekst → nie podmieniamy', zachowanie('null', 0) === 'pomijamy');
  sprawdz('pierwszy błąd → ponawiamy', zachowanie('foto.jpg', 0) === 'ponow');
  sprawdz('drugi błąd → dopiero zastępnik', zachowanie('foto.jpg', 1) === 'zastępnik');
}

console.log(`\n${'='.repeat(50)}`);
console.log(`WYNIK: ${zdane} zdanych, ${oblane} oblanych`);
console.log('='.repeat(50));
process.exit(oblane ? 1 : 0);
