# Push Notifications — Integracja

## Struktura plików do dodania

```
/                          ← root repo (GitHub Pages)
├── push-sw.js             ← nowy SW dla push
├── src/
│   └── modules/
│       └── PushNotifications.ts   ← nowy moduł
└── src/
    └── main.ts            ← dodaj import + wywołanie
```

---

## Krok 1 — Skopiuj pliki

1. `push-sw.js` → do **root projektu** (obok `index.html` i `sw.js`)
2. `src/modules/PushNotifications.ts` → do `src/modules/`

---

## Krok 2 — Dodaj import w main.ts

Na górze `main.ts` dodaj:

```typescript
import { initPushNotifications, testPushNotification } from './modules/PushNotifications.js';
```

W konstruktorze klasy `App`, po inicjalizacji mapy (gdzieś na końcu `_loadMap` lub po `onTileLoad`):

```typescript
// Inicjalizuj push notifications po załadowaniu mapy
void initPushNotifications();
```

---

## Krok 3 — Zbuduj i wrzuć na GitHub

```bash
npm run build
git add .
git commit -m "feat: add push notifications"
git push
```

---

## Krok 4 — Zmienne na Render

Upewnij się że na Render masz ustawione:

| Zmienna | Wartość |
|---------|---------|
| `VAPID_PUBLIC_KEY` | klucz z logów przy pierwszym uruchomieniu |
| `VAPID_PRIVATE_KEY` | klucz z logów przy pierwszym uruchomieniu |
| `VAPID_EMAIL` | Twój email |

Render → Dashboard → `mapty-backend` → **Environment** → Add environment variable

---

## Krok 5 — Test po wdrożeniu

1. Otwórz `https://leszekm12.github.io/Mapty-App/`
2. Przeglądarka zapyta o zgodę na powiadomienia → **Zezwól**
3. Otwórz DevTools → Console
4. Wpisz:

```javascript
testPush('Trening gotowy!', 'Świetna robota! 🏃 +5km')
```

5. Powinno pojawić się powiadomienie push na Twoim urządzeniu.

---

## Jak działa flow

```
Frontend                          Backend
   │                                 │
   ├─ GET /push/vapid-public-key ───►│
   │◄─ { publicKey: "..." } ─────────┤
   │                                 │
   ├─ pushManager.subscribe() ───────┤ (przeglądarka ↔ Google/Mozilla)
   │◄─ PushSubscription ─────────────┤
   │                                 │
   ├─ POST /push/subscribe ─────────►│
   │  { endpoint, keys } ────────────┤ (backend zapisuje w memoryDB)
   │                                 │
   ├─ POST /push/send ──────────────►│
   │  { title, body } ───────────────┤ (backend wysyła do wszystkich sub)
   │                   web-push ─────┤──► Google/Mozilla Push Server
   │                                 │                    │
   │◄─ push event ───────────────────┼────────────────────┘
   │  push-sw.js pokazuje notification
```

---

## Uwagi

- `push-sw.js` jest osobnym SW od głównego `sw.js` — nie kolidują
- Subskrypcja jest przypisana do przeglądarki/urządzenia
- Po odinstalowaniu i reinstalacji PWA subskrypcja może się zmienić
- MemoryDB na Render resetuje się przy każdym restarcie serwera — docelowo zamień na MongoDB
