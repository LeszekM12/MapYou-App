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

console.log(`\n${'='.repeat(50)}`);
console.log(`WYNIK: ${zdane} zdanych, ${oblane} oblanych`);
console.log('='.repeat(50));
process.exit(oblane ? 1 : 0);
