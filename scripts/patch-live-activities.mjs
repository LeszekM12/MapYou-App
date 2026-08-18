#!/usr/bin/env node
// ─── ŁATKA NA capacitor-live-activities ──────────────────────────────────────
// scripts/patch-live-activities.mjs
//
// PO CO TO ISTNIEJE
// ─────────────────
// Wtyczka kończy Live Activity tak:
//
//     await activity.end(finalContent, dismissalPolicy: .default)
//
// `.default` znaczy dla iOS: „zostaw kartę na ekranie blokady, aż użytkownik
// ją zmiecie — albo przez CZTERY GODZINY".
//
// A ponieważ czas na karcie tyka NATYWNIE (`Text(timerInterval:)` liczy po
// stronie urządzenia i nie potrzebuje aplikacji), przez te cztery godziny
// leciał licznik nieistniejącego treningu. Jedynym wyjściem było ręczne
// zmiecenie karty.
//
// `.immediate` mówi: „zamknij teraz". Tak robi Strava.
//
// DLACZEGO SKRYPT, A NIE ZWYKŁA EDYCJA
// Plik leży w `node_modules`, więc każde `npm install` cofnęłoby zmianę —
// i błąd wracałby po cichu, zwykle w najgorszym momencie. Skrypt wpięty
// w `postinstall` nakłada łatkę automatycznie po każdej instalacji.
//
// Jest idempotentny: uruchomiony dwa razy nie zrobi nic złego.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const PLIK = 'node_modules/capacitor-live-activities/ios/Plugin/LiveActivities.swift';
const SZUKAJ  = 'dismissalPolicy: .default';
const ZAMIEN  = 'dismissalPolicy: .immediate';

if (!existsSync(PLIK)) {
  console.log('[patch-la] pomijam — wtyczki nie ma (to normalne przy instalacji bez iOS)');
  process.exit(0);
}

const tresc = readFileSync(PLIK, 'utf8');

if (tresc.includes(ZAMIEN)) {
  console.log('[patch-la] łatka już nałożona');
  process.exit(0);
}

if (!tresc.includes(SZUKAJ)) {
  // Wtyczka się zmieniła — lepiej głośno ostrzec niż po cichu nic nie zrobić.
  console.warn(`[patch-la] UWAGA: nie znalazłem "${SZUKAJ}" w ${PLIK}.`);
  console.warn('[patch-la] Wtyczka mogła się zmienić — sprawdź, czy Live Activity');
  console.warn('[patch-la] nadal zostaje na ekranie blokady po zakończeniu treningu.');
  process.exit(0);   // nie przerywamy instalacji
}

writeFileSync(PLIK, tresc.replace(SZUKAJ, ZAMIEN), 'utf8');
console.log('[patch-la] OK — Live Activity zamyka się natychmiast po zakończeniu');
