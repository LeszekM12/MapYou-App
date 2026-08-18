#!/usr/bin/env node
// ─── ŁATKI NA capacitor-live-activities ──────────────────────────────────────
// scripts/patch-live-activities.mjs
//
// Dwie poprawki w kodzie Swift wtyczki. Obie idempotentne i samonaprawiające:
// skrypt rozpoznaje zarówno plik oryginalny, jak i wcześniejszą (błędną)
// wersję łatki i doprowadza go do stanu poprawnego.
//
// DLACZEGO SKRYPT, A NIE ZWYKŁA EDYCJA
// Plik leży w `node_modules`, więc każde `npm install` cofnęłoby zmianę —
// i błąd wracałby po cichu, zwykle w najgorszym momencie.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PLIK = 'node_modules/capacitor-live-activities/ios/Plugin/LiveActivities.swift';

// ── ŁATKA 1: natychmiastowe zamknięcie karty ─────────────────────────────────
//
// `.default` trzyma Live Activity na ekranie blokady nawet cztery godziny.
// Ponieważ czas tyka natywnie, przez ten czas leciał licznik nieistniejącego
// treningu, a jedynym wyjściem było ręczne zmiecenie karty.
const LATKA_DISMISS = {
  nazwa:  'natychmiastowe zamknięcie karty',
  z:      'dismissalPolicy: .default',
  na:     'dismissalPolicy: .immediate',
};

// ── ŁATKA 2: pierwsza aktualizacja po odzyskaniu aktywności ──────────────────
//
// Oryginał wygląda tak:
//
//     guard let activity = activities[activityId] else {
//         await syncExistingActivities()
//         guard activities[activityId] != nil else { throw ... }
//         return                     ← odnajduje aktywność i WYCHODZI
//     }
//
// Wtyczka odzyskuje aktywność z systemu, po czym wychodzi bez jej
// zaktualizowania. Pierwsza aktualizacja po ponownym uruchomieniu aplikacji
// ginęła po cichu — a to często właśnie ta niosąca pauzę.
//
// UWAGA NA PUŁAPKĘ: samo usunięcie `return` NIE DZIAŁA. Swift wymaga, by blok
// `guard … else` kończył się wyjściem ze scope'u (`return`, `throw`, `break`).
// Bez tego kompilator zgłasza:
//     'guard' body must not fall through
//
// Dlatego przebudowujemy całą konstrukcję: najpierw próba odzyskania, potem
// jeden `guard`, który albo daje aktywność, albo rzuca. Kod płynie dalej
// i aktualizacja faktycznie się wykonuje.
const NOWY_BLOK = `        // ŁATKA (patch-live-activities.mjs): oryginał odzyskiwał aktywność
        // z systemu, po czym wychodził BEZ jej zaktualizowania — pierwsza
        // aktualizacja po restarcie aplikacji ginęła po cichu.
        if activities[activityId] == nil {
            await syncExistingActivities()
        }
        guard let activity = activities[activityId] else {
            Logger.viewCycle.error("❌ Activity not found: \\(activityId)")
            Logger.viewCycle.error("📊 Available activities: \\(self.activities.keys)")
            throw LiveActivitiesError.activityNotFound
        }`;

/** Wytnij oryginalny (lub wcześniej błędnie załatany) blok `guard`.
 *
 *  Dopasowujemy od `guard let activity = activities[activityId] else {`
 *  do zamykającego nawiasu na tym samym poziomie wcięcia. Odporne na to,
 *  co jest w środku — a w środku bywa albo `return`, albo mój wcześniejszy
 *  komentarz bez `return`. */
function podmienBlokGuard(tresc) {
  const start = tresc.indexOf('guard let activity = activities[activityId] else {');
  if (start < 0) return null;

  // Cofamy się do początku wiersza, żeby zachować wcięcie.
  const poczatekWiersza = tresc.lastIndexOf('\n', start) + 1;

  // Szukamy zamykającego nawiasu przez zliczanie klamer.
  let poziom = 0;
  let i = start;
  for (; i < tresc.length; i++) {
    if (tresc[i] === '{') poziom++;
    else if (tresc[i] === '}') {
      poziom--;
      if (poziom === 0) { i++; break; }
    }
  }
  if (poziom !== 0) return null;   // niedomknięte — nie ruszamy

  return tresc.slice(0, poczatekWiersza) + NOWY_BLOK + tresc.slice(i);
}

// ─── WYKONANIE ───────────────────────────────────────────────────────────────

if (!existsSync(PLIK)) {
  console.log('[patch-la] pomijam — wtyczki nie ma (normalne przy instalacji bez iOS)');
  process.exit(0);
}

let tresc = readFileSync(PLIK, 'utf8');
const przed = tresc;
const wykonane = [];

// Łatka 1
if (tresc.includes(LATKA_DISMISS.na)) {
  // już nałożona
} else if (tresc.includes(LATKA_DISMISS.z)) {
  tresc = tresc.replace(LATKA_DISMISS.z, LATKA_DISMISS.na);
  wykonane.push(LATKA_DISMISS.nazwa);
} else {
  console.warn(`[patch-la] UWAGA: nie znalazłem wzorca dla łatki "${LATKA_DISMISS.nazwa}".`);
}

// Łatka 2 — pomijamy, jeśli już jest w poprawnej postaci
if (!tresc.includes('ŁATKA (patch-live-activities.mjs)')) {
  const wynik = podmienBlokGuard(tresc);
  if (wynik) {
    tresc = wynik;
    wykonane.push('pierwsza aktualizacja po odzyskaniu aktywności');
  } else {
    console.warn('[patch-la] UWAGA: nie znalazłem bloku guard do przebudowy.');
    console.warn('[patch-la] Wtyczka mogła się zmienić — sprawdź zachowanie Live Activity.');
  }
}

if (tresc !== przed) {
  writeFileSync(PLIK, tresc, 'utf8');
  console.log(`[patch-la] OK — nałożono: ${wykonane.join(', ')}`);
} else {
  console.log('[patch-la] łatki już nałożone');
}
