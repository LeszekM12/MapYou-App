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

// Dwie osobne łatki. Obie idempotentne.
const LATKI = [
  {
    nazwa:  'natychmiastowe zamknięcie karty',
    szukaj: 'dismissalPolicy: .default',
    zamien: 'dismissalPolicy: .immediate',
    // `.default` trzyma kartę na ekranie blokady nawet cztery godziny.
    // Ponieważ czas tyka natywnie, przez ten czas leciał licznik
    // nieistniejącego treningu.
  },
  {
    nazwa:  'pierwsza aktualizacja po odzyskaniu aktywności',
    szukaj: `                Logger.viewCycle.error("📊 Available activities: \\(self.activities.keys)")
                throw LiveActivitiesError.activityNotFound
            }
            
            return`,
    zamien: `                Logger.viewCycle.error("📊 Available activities: \\(self.activities.keys)")
                throw LiveActivitiesError.activityNotFound
            }
            // BYŁO: `+ '`return`' + ` — wtyczka odnajdywała aktywność w systemie,
            // po czym wychodziła BEZ jej zaktualizowania. Pierwsza aktualizacja
            // po ponownym uruchomieniu aplikacji ginęła po cichu.`,
  },
];

if (!existsSync(PLIK)) {
  console.log('[patch-la] pomijam — wtyczki nie ma (to normalne przy instalacji bez iOS)');
  process.exit(0);
}

let tresc = readFileSync(PLIK, 'utf8');
let nalozone = 0;

for (const l of LATKI) {
  if (tresc.includes(l.zamien)) continue;          // już nałożona
  if (!tresc.includes(l.szukaj)) {
    // Wtyczka się zmieniła — lepiej głośno ostrzec niż po cichu nic nie zrobić.
    console.warn(`[patch-la] UWAGA: nie znalazłem wzorca dla łatki "${l.nazwa}".`);
    console.warn('[patch-la] Wtyczka mogła się zmienić — sprawdź zachowanie Live Activity.');
    continue;
  }
  tresc = tresc.replace(l.szukaj, l.zamien);
  nalozone++;
}

if (nalozone) {
  writeFileSync(PLIK, tresc, 'utf8');
  console.log(`[patch-la] OK — nałożono ${nalozone} z ${LATKI.length} łatek`);
} else {
  console.log('[patch-la] łatki już nałożone');
}
