// ─── WIRTUALIZACJA FEEDU ─────────────────────────────────────────────────────
// src/modules/feedRecycler.ts
//
// PROBLEM
// ───────
// DOM nie odzyskuje elementow tak, jak robia to natywne listy (`UITableView`
// na iOS, `RecyclerView` na Androidzie). Tam dziesiec tysiecy wierszy kosztuje
// tyle co dziesiec, bo widoczne sa tylko te na ekranie, a reszta nie istnieje.
//
// W przegladarce KAZDA karta feedu zyje w drzewie od chwili narysowania az do
// przerysowania calej listy. Kazda z nich to kilkadziesiat wezlow, zdjecie
// i — przy treningach — plotno z minimapa. Po kilku doladowaniach mamy setki
// takich kart i przegladarka liczy uklad calej tej masy przy kazdym przewinieciu.
//
// JAK TO ROZWIAZUJEMY
// ───────────────────
// Karta, ktora oddali sie od ekranu, zostaje ZDJETA z drzewa i zastapiona
// pustym miejscem o DOKLADNIE tej samej wysokosci. Gdy uzytkownik wraca —
// wstawiamy ja z powrotem.
//
// Kluczowe jest to, ze wysokosc mierzymy PRZED zdjeciem. Dzieki temu pasek
// przewijania nie drgnie ani o piksel, a pozycja nie ucieknie — a to wlasnie
// psuje sie w wiekszosci naiwnych implementacji wirtualizacji.
//
// DLACZEGO NIE PELNE PRZELICZANIE OKNA
// Klasyczna wirtualizacja (licz, ktore pozycje sa widoczne, i rysuj tylko je)
// wymaga znajomosci wysokosci WSZYSTKICH pozycji z gory. Karty feedu roznia sie
// drastycznie: post tekstowy ma 90 px, trening ze zdjeciem i mapa ponad 500 px.
// Szacowanie prowadzi do skakania paska przewijania — objawu gorszego niz sam
// problem, ktory mielismy naprawic.
//
// Tutaj nic nie szacujemy: mierzymy rzeczywista wysokosc tuz przed zdjeciem.
//
// UCZCIWIE O OGRANICZENIU
// Zdjeta karta nadal zajmuje PAMIEC — trzymamy do niej odwolanie, zeby moc ja
// wstawic z powrotem bez odbudowywania. Oszczedzamy koszt UKLADU I RYSOWANIA,
// ktory przy przewijaniu jest dominujacy, ale nie pamiec. Pelne zwolnienie
// wymagaloby przebudowy karty od zera przy powrocie, czyli dostepu do danych
// i funkcji budujacej — a to juz przebudowa calego potoku malowania.

import { dlog } from '../utils/log.js';

/** Jak daleko poza ekranem karta moze pozostac w drzewie.
 *
 *  Dwa ekrany w kazda strone. Mniej — i przy szybkim przewijaniu widac puste
 *  miejsca, zanim karta zdazy wrocic. Wiecej — i oszczednosc topnieje. */
const MARGINES = '200% 0px 200% 0px';

interface Zdjeta {
  karta:     HTMLElement;
  wysokosc:  number;
}

export class FeedRecycler {
  private obs: IntersectionObserver | null = null;
  private zdjete = new Map<HTMLElement, Zdjeta>();   // miejsce → karta
  private liczbaZdjetych = 0;

  /** Zacznij pilnowac kontenera. Wolac po kazdym przerysowaniu listy —
   *  poprzedni obserwator jest wtedy odpinany, zeby nie zostal wiszacy. */
  start(): void {
    this.stop();
    this.obs = new IntersectionObserver(wpisy => {
      for (const w of wpisy) {
        const el = w.target as HTMLElement;
        if (w.isIntersecting) this.przywroc(el);
        else                  this.zdejmij(el);
      }
    }, { rootMargin: MARGINES });
  }

  stop(): void {
    this.obs?.disconnect();
    this.obs = null;
    this.zdjete.clear();
    this.liczbaZdjetych = 0;
  }

  /** Zglos karte do pilnowania. Wolane raz, przy jej wstawieniu do listy. */
  pilnuj(karta: HTMLElement): void {
    this.obs?.observe(karta);
  }

  /** Zdejmij karte z drzewa, zostawiajac puste miejsce tej samej wysokosci. */
  private zdejmij(karta: HTMLElement): void {
    // Juz zdjeta albo to jest miejsce po karcie — nic nie robimy.
    if (karta.dataset.recyklerMiejsce === '1') return;
    if (!karta.isConnected || !karta.parentElement) return;

    const wysokosc = karta.offsetHeight;
    // Zerowa wysokosc znaczy, ze karta jeszcze sie nie ulozyla (np. czeka na
    // zdjecie). Zdjecie jej teraz zapisaloby bledna wysokosc i uklad by skoczyl.
    if (wysokosc <= 0) return;

    const miejsce = document.createElement('div');
    miejsce.dataset.recyklerMiejsce = '1';
    miejsce.style.height = `${wysokosc}px`;
    // `contain` mowi przegladarce, ze wnetrze nie wplywa na otoczenie —
    // dzieki temu puste miejsce nie kosztuje nic przy przeliczaniu ukladu.
    miejsce.style.contain = 'strict';

    karta.parentElement.replaceChild(miejsce, karta);
    this.zdjete.set(miejsce, { karta, wysokosc });
    this.obs?.unobserve(karta);
    this.obs?.observe(miejsce);
    this.liczbaZdjetych++;
    if (this.liczbaZdjetych % 20 === 0) {
      dlog(`[Recycler] zdjetych z drzewa: ${this.zdjete.size}`);
    }
  }

  /** Wstaw karte z powrotem w miejsce zastepcze. */
  private przywroc(miejsce: HTMLElement): void {
    if (miejsce.dataset.recyklerMiejsce !== '1') return;
    const wpis = this.zdjete.get(miejsce);
    if (!wpis || !miejsce.parentElement) return;

    miejsce.parentElement.replaceChild(wpis.karta, miejsce);
    this.zdjete.delete(miejsce);
    this.obs?.unobserve(miejsce);
    this.obs?.observe(wpis.karta);
  }

  /** Ile kart jest w tej chwili poza drzewem. Do diagnostyki. */
  get zdjetych(): number { return this.zdjete.size; }
}

/** Jedna instancja na feed Home. Eksportowana, zeby narzedzie diagnostyczne
 *  mialo do czego siegnac. */
export const feedRecycler = new FeedRecycler();

(window as unknown as Record<string, unknown>).mapyouRecycler = (): unknown => ({
  zdjetych_z_drzewa: feedRecycler.zdjetych,
  kart_w_drzewie: document.querySelectorAll('#homeFeedList > *').length,
  miejsc_zastepczych: document.querySelectorAll('[data-recykler-miejsce]').length,
});
