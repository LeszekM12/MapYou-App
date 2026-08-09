// ─── SZKIELETY LADOWANIA I ZASTEPNIKI ────────────────────────────────────────
// src/modules/skeleton.ts
//
// PO CO
// Gdy nie ma jeszcze czego pokazac, uzytkownik musi widziec, ze cos SIE DZIEJE.
// Do tej pory widzial albo pusty ekran, albo komunikat „nic tu nie ma" — a to
// dwie zupelnie rozne informacje, ktore wygladaly identycznie:
//
//   „jeszcze sie laduje"        → poczekaj
//   „naprawde nic tu nie ma"    → nie czekaj, zrob cos innego
//
// Mylenie ich jest jednym z najbardziej frustrujacych bledow w interfejsach.
//
// ZASADA — kiedy co pokazac:
//   mam cache               → TRESC (nigdy szkielet; uzytkownik juz to widzial)
//   brak cache, siec trwa   → SZKIELET
//   brak cache, siec padla  → STAN PUSTY z mozliwoscia ponowienia
//
// Szkielet ma ODWZOROWYWAC uklad tresci, ktora sie pojawi — inaczej ekran
// „przeskakuje", gdy dane dojda. Dlatego karta szkieletu ma te same wymiary
// co karta feedu.
//
// Style wstrzykujemy z kodu, wiec modul nie wymaga zadnego arkusza CSS
// ani osobnego pliku do wdrozenia.

const STYLE_ID = 'mapyouSkelStyle';

function zapewnijStyl(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
@keyframes mapyouShimmer { 0% { background-position: -420px 0; } 100% { background-position: 420px 0; } }
.mapyou-skel {
  background: linear-gradient(90deg,
    rgba(128,128,128,0.10) 25%,
    rgba(128,128,128,0.20) 50%,
    rgba(128,128,128,0.10) 75%);
  background-size: 420px 100%;
  animation: mapyouShimmer 1.3s linear infinite;
  border-radius: 8px;
}
/* Szanujemy ustawienie systemowe. Migotanie potrafi byc mecz\u0105ce, a dla
   niektorych osob wrecz szkodliwe — wtedy zostaje samo statyczne tlo. */
@media (prefers-reduced-motion: reduce) {
  .mapyou-skel { animation: none; }
}
.mapyou-skel-card {
  background: var(--app-surface-1, rgba(255,255,255,0.04));
  border-radius: 16px; padding: 14px; margin-bottom: 12px;
}
/* Zastepnik obrazka, ktory sie nie wczytal. Neutralny prostokat z ikona —
   nigdy polamana ikona przegladarki ani pusta dziura psujaca uklad. */
.mapyou-img-fallback {
  display: flex; align-items: center; justify-content: center;
  background: rgba(128,128,128,0.12);
  color: rgba(128,128,128,0.55);
  border-radius: 12px; min-height: 120px;
}`;
  document.head.appendChild(st);
}

/** Jedna karta szkieletu — odwzorowuje uklad karty feedu:
 *  awatar + dwie linie naglowka, pasek tresci, prostokat zdjecia. */
export function kartaSzkieletu(zeZdjeciem = true): string {
  return `
  <div class="mapyou-skel-card" aria-hidden="true">
    <div style="display:flex;gap:10px;align-items:center">
      <div class="mapyou-skel" style="width:40px;height:40px;border-radius:50%"></div>
      <div style="flex:1">
        <div class="mapyou-skel" style="width:42%;height:12px;margin-bottom:7px"></div>
        <div class="mapyou-skel" style="width:26%;height:10px"></div>
      </div>
    </div>
    <div class="mapyou-skel" style="width:72%;height:12px;margin:14px 0 10px"></div>
    ${zeZdjeciem ? '<div class="mapyou-skel" style="width:100%;height:150px;border-radius:12px"></div>' : ''}
    <div style="display:flex;gap:18px;margin-top:12px">
      <div class="mapyou-skel" style="width:44px;height:12px"></div>
      <div class="mapyou-skel" style="width:44px;height:12px"></div>
    </div>
  </div>`;
}

/** Wstaw szkielet feedu do kontenera.
 *
 *  `aria-busy` mowi czytnikom ekranu, ze trwa ladowanie — bez tego osoba
 *  niewidoma uslyszalaby pusta liste i uznala, ze nic tu nie ma. */
export function pokazSzkieletFeedu(el: HTMLElement | null, ile = 3): void {
  if (!el) return;
  zapewnijStyl();
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = Array.from({ length: ile }, (_, i) => kartaSzkieletu(i !== 1)).join('');
}

/** Szkielet listy osob — dla zakladki znajomych i wynikow wyszukiwania. */
export function pokazSzkieletListy(el: HTMLElement | null, ile = 5): void {
  if (!el) return;
  zapewnijStyl();
  el.setAttribute('aria-busy', 'true');
  el.innerHTML = Array.from({ length: ile }, () => `
    <div style="display:flex;gap:12px;align-items:center;padding:12px 4px" aria-hidden="true">
      <div class="mapyou-skel" style="width:44px;height:44px;border-radius:50%"></div>
      <div style="flex:1">
        <div class="mapyou-skel" style="width:38%;height:12px;margin-bottom:7px"></div>
        <div class="mapyou-skel" style="width:24%;height:10px"></div>
      </div>
      <div class="mapyou-skel" style="width:72px;height:30px;border-radius:999px"></div>
    </div>`).join('');
}

/** Zdejmij oznaczenie ladowania. Wolac po wstawieniu prawdziwej tresci. */
export function koniecSzkieletu(el: HTMLElement | null): void {
  el?.removeAttribute('aria-busy');
}

// ─── ZASTEPNIKI OBRAZKOW ─────────────────────────────────────────────────────
//
// W logach widac bylo powtarzajace sie:
//     Failed to load resource: 404 (pmz7xxyy1kktmputp2cc.mp4)
//     [Media] missing asset hidden
//
// Plik zniknal z Cloudinary, a karta zostawala z dziura w ukladzie. Zamiast
// tego pokazujemy neutralny kafelek — tak robi X, gdy zdjecie nie dochodzi.

let podpiete = false;

/** Podepnij globalna obsluge niewczytanych obrazkow.
 *
 *  Nasluch jest w fazie PRZECHWYTYWANIA, bo zdarzenie `error` z `<img>`
 *  nie bakluje — bez `true` nigdy by tu nie dotarlo. Jeden nasluch obsluguje
 *  cala aplikacje, takze tresc dodana pozniej. */
export function podepnijZastepnikiObrazkow(): void {
  if (podpiete) return;
  podpiete = true;
  zapewnijStyl();

  document.addEventListener('error', (e) => {
    const el = e.target as HTMLElement | null;
    if (!el || el.tagName !== 'IMG') return;
    const img = el as HTMLImageElement;
    if (img.dataset.fallbackDone === '1') return;
    img.dataset.fallbackDone = '1';

    const box = document.createElement('div');
    box.className = 'mapyou-img-fallback';
    // Przejmujemy WYMIARY obrazka, zeby uklad nie drgnal.
    box.style.width  = img.width  ? `${img.width}px`  : '100%';
    box.style.height = img.height ? `${img.height}px` : '';
    box.style.aspectRatio = img.width && img.height ? `${img.width}/${img.height}` : '';
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', img.alt || 'Zdjęcie niedostępne');
    box.innerHTML = `<svg viewBox="0 0 24 24" width="26" height="26" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
      <path d="M21 15l-5-5L5 21"/></svg>`;
    img.replaceWith(box);
  }, true);
}
