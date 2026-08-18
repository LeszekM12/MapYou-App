// ─── LIVE ACTIVITY (iOS 16.2+: lock screen card + Dynamic Island) ───────────
// Strava-style live workout stats rendered natively by ActivityKit.
// Uses the `capacitor-live-activities` plugin, read from the global
// Capacitor.Plugins registry (no npm import — no bundler, same pattern as
// workoutNotification.ts). iOS-only by design: laPlugin() returns null
// everywhere else, so every call is a safe no-op on Android/web.
//
// The layout (lock screen + island) is plain JSON sent at start — so the
// DESIGN can be iterated from Windows with a normal Pages push; no Xcode.
// Updates push only the data fields ({{placeholders}} in the layout).

interface LAStartResult { activityId?: string }

interface LAPlugin {
  startActivity(opts: Record<string, unknown>): Promise<LAStartResult>;
  updateActivity(opts: Record<string, unknown>): Promise<unknown>;
  endActivity(opts: Record<string, unknown>): Promise<unknown>;
}

function laPlugin(): LAPlugin | null {
  const cap = (globalThis as unknown as {
    Capacitor?: { Plugins?: Record<string, unknown>; getPlatform?: () => string };
  }).Capacitor;
  if (cap?.getPlatform?.() !== 'ios') return null;
  return (cap.Plugins?.['LiveActivities'] as LAPlugin | undefined) ?? null;
}

// Sport key → SF Symbol (native iOS icon set). Fixed per workout, set at start.
const SF_ICONS: Record<string, string> = {
  running: 'figure.run',          trail_run: 'figure.run',
  walking: 'figure.walk',         hiking: 'figure.hiking',
  cycling: 'figure.outdoor.cycle', mtb: 'figure.outdoor.cycle',
  gravel: 'figure.outdoor.cycle', ebike: 'figure.outdoor.cycle',
  emtb: 'figure.outdoor.cycle',   velomobile: 'figure.outdoor.cycle',
  handcycle: 'figure.outdoor.cycle',
  inline_skate: 'figure.skating', skateboard: 'figure.skating',
  rowing: 'figure.rower',         canoe: 'figure.rower', kayak: 'figure.rower',
  swimming: 'figure.pool.swim',
};
function sfIcon(sport: string): string { return SF_ICONS[sport] ?? 'figure.run'; }

// Theme — resolved at activity start. The WebView's prefers-color-scheme
// mirrors the iOS system appearance, so the lock-screen card matches the
// phone's theme. (Layout ships at start, so a theme change applies from the
// next workout.) The Dynamic Island is always black glass — it keeps the
// dark palette regardless of theme.
interface Palette { bg: string; text: string; muted: string; accent: string; warn: string; }
const DARK_P:  Palette = { bg: '#141417', text: '#ffffff', muted: '#9ca3af', accent: '#4ade80', warn: '#fbbf24' };
const LIGHT_P: Palette = { bg: '#ffffff', text: '#111114', muted: '#6b7280', accent: '#16a34a', warn: '#d97706' };
function systemPalette(): Palette {
  try {
    return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? DARK_P : LIGHT_P;
  } catch { return DARK_P; }
}
// Island palette (fixed — the island pill is always dark)
const ISLAND_ACCENT = '#4ade80';
// Bursztyn dla stanu pauzy na wyspie — czytelny na czarnym tle i wyraznie
// odrozniony od zieleni „trening trwa". Strava uzywa w tym miejscu zoltego.
const ISLAND_PAUSE = '#FFB020';
const ISLAND_TEXT   = '#ffffff';
const ISLAND_MUTED  = '#9ca3af';

/** Live values pushed on every update. Formatted strings + native-timer refs. */
export interface LiveStats {
  time: string;        // "28:00" — frozen text shown while paused
  dist: string;        // "5.02 km"
  third: string;       // "5:36 /km"  or  "24.3 km/h"
  thirdLabel: string;  // "PACE" | "SPEED"
  state: string;       // "" | "Paused" | "Auto-paused" | "Finished"
  timerRef: number;    // epoch ms; the native timer renders (now − timerRef),
                       // i.e. active elapsed time, ticking every second ON-DEVICE
                       // — no JS updates needed, even when locked / AOD
  paused: boolean;     // true → swap ticking timer for the frozen {{time}} text
}

function laData(s: LiveStats, pal: Palette): Record<string, unknown> {
  const paused = s.paused;
  return {
    time: s.time, dist: s.dist, third: s.third, thirdLabel: s.thirdLabel,
    state: s.state, timerRef: s.timerRef,
    // Visibility — TWO independent mechanisms (belt & braces, both data-bound):
    // 1) opacity as STRINGS "1"/"0" (numeric 0/1 can be mis-decoded as Bool
    //    by the widget's JSON layer and then silently ignored),
    // 2) color swapped to the parser's 'clear' keyword when hidden.
    runOp:   paused ? '0' : '1',
    pauseOp: paused ? '1' : '0',
    lockT: paused ? 'clear' : pal.text,      lockF: paused ? pal.text      : 'clear',
    cmpT:  paused ? 'clear' : ISLAND_ACCENT, cmpF:  paused ? ISLAND_ACCENT : 'clear',
    expT:  paused ? 'clear' : ISLAND_TEXT,   expF:  paused ? ISLAND_TEXT   : 'clear',
  };
}

/** TIME cell: native self-ticking timer overlaid (stack) with a frozen text.
 *  Data-bound opacity AND color decide which is visible — running vs paused.
 *  Apple's Text(.timer) is width-greedy and left-aligned, which shoved the
 *  lock-screen value sideways and inflated the Dynamic Island pill — hence
 *  the FIXED width + centered alignment on both layers. */
// ─── KOMORKA CZASU ───────────────────────────────────────────────────────────
//
// DLACZEGO TO WYGLADA TERAZ INACZEJ
// ─────────────────────────────────
// Wczesniej bylo tu DWA elementy nalozone na siebie: natywny licznik i tekst
// z zamrozonym czasem, a o widocznosci decydowaly dane (`opacity`, `color`).
// Nie dzialalo — i teraz wiadomo dlaczego.
//
// Uklad Live Activity jest STATYCZNY: trafia do `ActivityAttributes.layoutJSON`
// przy `startActivity` i juz sie nie zmienia. `updateActivity` podmienia
// wylacznie DANE. Element `timer` tyka NATYWNIE, po stronie urzadzenia —
// zadna aktualizacja danych go nie zatrzyma, a proba ukrycia go przez
// przezroczystosc okazala sie zawodna.
//
// Nowe podejscie: gdy trening jest zapauzowany, w ukladzie NIE MA elementu
// `timer`. Jest zwykly tekst. Nie ma czego zatrzymywac, bo nie ma co tykac.
//
// Zmiana ukladu wymaga przebudowania aktywnosci — patrz `_przebuduj()`.
function timeStack(
  fontSize: number,
  colorKey: 'lock' | 'cmp' | 'exp',
  width: number,
  paused: boolean,
) {
  const base = [
    { fontSize }, { fontWeight: 'bold' }, { monospacedDigit: true },
    { width }, { alignment: 'center' },
  ];
  return paused
    // Pauza: sam tekst. Zero elementow tykajacych.
    ? { type: 'text',  properties: [{ text: '{{time}}' }, ...base, { color: `{{${colorKey}F}}` }] }
    // Bieg: sam licznik natywny. Tyka bez udzialu aplikacji, takze przy
    // zgaszonym ekranie — i o to chodzi.
    : { type: 'timer', properties: [{ endTime: '{{timerRef}}' }, { style: 'timer' }, ...base, { color: `{{${colorKey}T}}` }] };
}

// ── CZESTOTLIWOSC AKTUALIZACJI ───────────────────────────────────────────────
//
// Bylo 1000 ms, czyli 3600 aktualizacji na godzine treningu. iOS ma budzet na
// odswiezanie Live Activity i przy takim tempie zaczyna je ODRZUCAC — a wraz
// z nimi te WAZNE, niosace zmiane stanu (pauza, wznowienie, koniec).
//
// Stad objaw „ikonka pauzy czasami jest, czasami nie": binding dziala,
// tylko aktualizacja nie dociera.
//
// Czas na wyspie i tak tyka NATYWNIE z kotwicy `timerRef` — nie wymaga
// zadnych aktualizacji. Przez most ida wylacznie dystans i tempo, a te
// spokojnie moga sie odswiezac co pare sekund. Nikt nie zauwazy roznicy,
// za to budzet zostaje na zmiany stanu, ktore MUSZA dojsc.
const UPDATE_MS = 5000;

function statCol(valueKey: string, label: string, valueColor: string, p: Palette) {
  return {
    type: 'container',
    properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
    children: [
      { type: 'text', properties: [{ text: `{{${valueKey}}}` }, { fontSize: 22 }, { fontWeight: 'bold' }, { color: valueColor }, { monospacedDigit: true }] },
      { type: 'text', properties: [{ text: label }, { fontSize: 11 }, { color: p.muted }] },
    ],
  };
}

function lockLayout(sport: string, sportLabel: string, p: Palette, paused: boolean) {
  return {
    type: 'container',
    properties: [
      { direction: 'vertical' }, { spacing: 10 }, { padding: 14 },
      { backgroundColor: p.bg }, { cornerRadius: 16 },
    ],
    children: [
      { // header: icon · "MapYou · Running" · state (right)
        type: 'container',
        properties: [{ direction: 'horizontal' }, { spacing: 8 }],
        children: [
          { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: p.accent }, { width: 18 }, { height: 18 }] },
          { type: 'text',  properties: [{ text: `MapYou · ${sportLabel}` }, { fontSize: 14 }, { fontWeight: 'semibold' }, { color: p.text }] },
          { type: 'text',  properties: [{ text: '{{state}}' }, { fontSize: 12 }, { color: p.warn }] },
        ],
      },
      { // stats row: TIME · DISTANCE · PACE/SPEED
        type: 'container',
        properties: [{ direction: 'horizontal' }, { spacing: 24 }],
        children: [
          { type: 'container',
            properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
            children: [
              timeStack(22, 'lock', 96, paused),
              { type: 'text', properties: [{ text: 'TIME' }, { fontSize: 11 }, { color: p.muted }] },
            ] },
          statCol('dist',  'DISTANCE',        p.accent, p),
          { type: 'container',
            properties: [{ direction: 'vertical' }, { spacing: 2 }, { alignment: 'center' }],
            children: [
              { type: 'text', properties: [{ text: '{{third}}' }, { fontSize: 22 }, { fontWeight: 'bold' }, { color: p.text }, { monospacedDigit: true }] },
              { type: 'text', properties: [{ text: '{{thirdLabel}}' }, { fontSize: 11 }, { color: p.muted }] },
            ] },
        ],
      },
    ],
  };
}

function islandLayout(sport: string, sportLabel: string, paused: boolean) {
  const icon = { type: 'image', properties: [{ systemName: sfIcon(sport) }, { color: ISLAND_ACCENT }] };
  return {
    compactLeading:  icon,
    // Compact trailing: czas ORAZ ikona pauzy, nalozone na siebie.
    //
    // Widoczna jest zawsze dokladnie jedna — decyduja te same pola `runOp`
    // i `pauseOp`, ktore juz stereja reszta. Podczas pauzy czas znika,
    // a na jego miejscu pojawia sie natywny symbol `pause.fill`, tak jak
    // robi to Strava (u niej to zolte kolko z pauza po prawej stronie wyspy).
    //
    // `systemName` to SF Symbols — ikona jest natywna, wiec wyglada jak
    // czesc systemu, a nie jak znak wklejony w tekst.
    compactTrailing: {
      type: 'container',
      properties: [{ direction: 'stack' }],
      children: [
        // Przy pauzie — SAMA ikona, bez cyfr pod spodem.
        // Przy biegu — sam licznik. Nigdy oba naraz, bo uklad powstaje
        // od nowa przy kazdej zmianie stanu.
        ...(paused
          ? [{ type: 'image', properties: [
              { systemName: 'pause.fill' }, { color: ISLAND_PAUSE }, { fontSize: 13 },
            ] }]
          : [timeStack(13, 'cmp', 50, false)]),
      ],
    },
    minimal:         icon,
    expanded: {
      leading:  { type: 'text', properties: [{ text: '{{dist}}' }, { fontSize: 16 }, { fontWeight: 'bold' }, { color: ISLAND_ACCENT }] },
      trailing: timeStack(16, 'exp', 64, paused),
      bottom:   { type: 'text', properties: [{ text: `${sportLabel} · {{third}} {{state}}` }, { fontSize: 13 }, { color: ISLAND_MUTED }] },
    },
  };
}

class WorkoutLiveActivity {
  private _id: string | null = null;
  private _starting = false;
  private _lastPush = 0;
  private _pal: Palette = DARK_P;   // chosen at start(), reused by update/end
  // Zapamietane, zeby dalo sie odtworzyc aktywnosc z INNYM ukladem przy
  // zmianie stanu (bieg ↔ pauza). Uklad jest statyczny, wiec przelaczenie
  // wymaga zbudowania aktywnosci od nowa.
  private _sport = '';
  private _label = '';
  private _paused = false;

  isAvailable(): boolean { return laPlugin() !== null; }
  get active(): boolean  { return this._id !== null; }

  /** Begin the Live Activity for a new workout. Safe no-op off-iOS. */
  async start(sportKey: string, sportLabel: string): Promise<void> {
    const p = laPlugin();
    if (!p || this._id || this._starting) return;
    this._starting = true;
    try {
      const pal = systemPalette();
      this._pal = pal;
      this._sport = sportKey;
      this._label = sportLabel;
      this._paused = false;
      const res = await p.startActivity({
        layout: lockLayout(sportKey, sportLabel, pal, false),
        dynamicIslandLayout: islandLayout(sportKey, sportLabel, false),
        data: laData({ time: '0:00', dist: '0.00 km', third: '--:--', thirdLabel: 'PACE', state: '', timerRef: Date.now(), paused: false }, pal),
        behavior: { systemActionForegroundColor: pal.accent, keyLineTint: pal.accent },
      });
      this._id = res?.activityId ?? null;
    } catch (e) {
      console.warn('[LiveActivity] start failed:', e);
    }
    this._starting = false;
  }

  /** Przelacz miedzy biegiem a pauza.
   *
   *  Uklad Live Activity jest STATYCZNY — zapisany w atrybutach przy starcie
   *  i nie da sie go podmienic przez `updateActivity`. A skoro w ukladzie
   *  biegowym siedzi natywny licznik, ktory tyka po stronie urzadzenia,
   *  to zadna aktualizacja DANYCH go nie zatrzyma.
   *
   *  Dlatego przy zmianie stanu budujemy aktywnosc OD NOWA, z ukladem, w ktorym
   *  po prostu nie ma czego zatrzymywac: przy pauzie zamiast licznika jest
   *  zwykly tekst.
   *
   *  Koszt: krotkie mrugniecie karty. Warte tego, bo poprzednie podejscie
   *  (ukrywanie licznika przezroczystoscia) po prostu nie dzialalo — czas
   *  leciał dalej mimo pauzy, a po zakonczeniu treningu trzeba bylo recznie
   *  zmiatac karte z ekranu blokady. */
  async setPaused(paused: boolean, s: LiveStats): Promise<void> {
    const p = laPlugin();
    if (!p || !this._id || this._starting) return;
    if (paused === this._paused) { void this.update(s, true); return; }

    this._starting = true;
    const stary = this._id;
    this._id = null;
    try {
      // Zamykamy stara kartę. Z `dismissalPolicy: .immediate` (latka
      // `scripts/patch-live-activities.mjs`) znika od razu, bez czterogodzinnego
      // ogona, ktory wczesniej zostawal na ekranie blokady.
      await p.endActivity({ activityId: stary, data: laData({ ...s, paused }, this._pal) });

      const res = await p.startActivity({
        layout: lockLayout(this._sport, this._label, this._pal, paused),
        dynamicIslandLayout: islandLayout(this._sport, this._label, paused),
        data: laData({ ...s, paused }, this._pal),
        behavior: { systemActionForegroundColor: this._pal.accent, keyLineTint: this._pal.accent },
      });
      this._id = res?.activityId ?? null;
      this._paused = paused;
      this._lastPush = Date.now();
    } catch (e) {
      console.warn('[LiveActivity] przebudowa nieudana:', e);
    }
    this._starting = false;
  }

  /** Push fresh stats. Throttled to UPDATE_MS unless force=true
   *  (force is used for instant Pause/Resume state flips). */
  async update(s: LiveStats, force = false): Promise<void> {
    const p = laPlugin();
    if (!p || !this._id) return;
    const now = Date.now();
    if (!force && now - this._lastPush < UPDATE_MS) return;
    this._lastPush = now;
    try {
      await p.updateActivity({ activityId: this._id, data: laData(s, this._pal) });
    } catch { /* non-critical */ }
  }

  /** End the activity. Pass final stats to leave a "Finished" card briefly;
   *  omit them (discard/reset) to just dismiss. */
  async end(final?: LiveStats): Promise<void> {
    const p = laPlugin();
    const id = this._id;
    this._id = null;
    this._lastPush = 0;
    if (!p || !id) return;
    try {
      // `paused: true` ZAWSZE, takze gdy nie ma statystyk koncowych.
      //
      // iOS trzyma karte Live Activity jeszcze jakis czas po zakonczeniu —
      // to normalne zachowanie systemu. Problem w tym, ze bez zamrozonej
      // kotwicy natywny licznik TYKAL DALEJ i pokazywal nieistniejacy trening,
      // dopoki uzytkownik sam nie zmiotl karty z ekranu blokady.
      const finalData = final
        ? laData({ ...final, state: 'Finished', paused: true }, this._pal)
        : laData({
            time: '', dist: '', third: '', thirdLabel: '',
            state: 'Finished', timerRef: Date.now(), paused: true,
          }, this._pal);

      // ── ZAMROZ ZANIM ZAKONCZYSZ ────────────────────────────────────────────
      //
      // Wtyczka konczy aktywnosc z `dismissalPolicy: .default`, a to znaczy,
      // ze iOS trzyma karte na ekranie blokady nawet do CZTERECH GODZIN.
      // Natywny licznik tyka przez caly ten czas, bo dziala po stronie
      // urzadzenia i nie potrzebuje aplikacji.
      //
      // Stad objaw: po zakonczeniu treningu zegar leci dalej, a jedynym
      // wyjsciem jest recznie zmiecienie karty.
      //
      // `endActivity` DODATKOWO kasuje uklad ze wspoldzielonych ustawien
      // (`removeObject(_layout)`), wiec tresc koncowa moze sie nie narysowac.
      // Dlatego stan zamrozony wysylamy ZWYKLA aktualizacja — ta na pewno
      // trafia do widzetu — i dopiero potem konczymy.
      await p.updateActivity({ activityId: id, data: finalData });
      await new Promise(r => setTimeout(r, 350));   // daj iOS narysowac

      await p.endActivity({ activityId: id, data: finalData });
    } catch { /* non-critical */ }
  }
}

export const workoutLiveActivity = new WorkoutLiveActivity();
