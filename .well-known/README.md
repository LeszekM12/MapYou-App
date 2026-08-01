# .well-known — App Links (Android) i Universal Links (iOS)

Te pliki sprawiaja, ze klikniecie linku `https://<domena>/#invite=...`
otwiera **apke**, a nie przegladarke. Do dzialania potrzebuja dwoch rzeczy,
ktorych nie da sie wpisac z gory — musisz je podstawic sam.

## 1. `assetlinks.json` — SHA-256 klucza RELEASE

Pochodzi z D2 (podpis release). Skad wziac:

* Play App Signing: Play Console -> Setup -> App integrity -> App signing
  key certificate -> SHA-256.
* Wlasny keystore:
  `keytool -list -v -keystore <plik>.jks -alias <alias>`

Wklej w miejsce `REPLACE_WITH_RELEASE_SHA256` (format: pary hex z dwukropkami).
Drugi wpis jest opcjonalny — dodaj SHA-256 klucza debug, jesli chcesz, zeby
linki dzialaly takze w buildzie testowym. Jak nie, po prostu usun ta linie.

## 2. `apple-app-site-association` — Team ID

Apple Developer -> Membership -> Team ID (10 znakow).
Zastap `REPLACE_WITH_TEAM_ID`. Efekt: `ABCDE12345.com.leszekm12.mapyou`.

**Uwaga:** ten plik nie ma rozszerzenia `.json` i tak ma zostac.
Musi byc serwowany jako `application/json` i **bez przekierowania** —
GitHub Pages robi to poprawnie z katalogu `.well-known/`.

## 3. Po podstawieniu

Android — dodaj do `android/app/src/main/AndroidManifest.xml` w `<activity>`
glownej aktywnosci:

```xml
<intent-filter android:autoVerify="true">
  <action android:name="android.intent.action.VIEW" />
  <category android:name="android.intent.category.DEFAULT" />
  <category android:name="android.intent.category.BROWSABLE" />
  <data android:scheme="https" android:host="TWOJA_DOMENA" />
</intent-filter>
```

iOS — Xcode -> Signing & Capabilities -> Associated Domains ->
`applinks:TWOJA_DOMENA`.

## Weryfikacja

    https://TWOJA_DOMENA/.well-known/assetlinks.json
    https://TWOJA_DOMENA/.well-known/apple-app-site-association

Oba musza zwrocic 200 i czysty JSON. Android sprawdza to przy instalacji,
wiec po zmianie pliku trzeba apke przeinstalowac, nie tylko zrestartowac.

---

## 4. `.nojekyll` — BEZ TEGO PLIKI NIE BEDA SERWOWANE

GitHub Pages przepuszcza repo przez Jekyll, a Jekyll **domyslnie pomija
katalogi zaczynajace sie od kropki**. Bez tego `.well-known/` zostanie
wyciety przy publikacji i oba pliki zwroca 404 — mimo ze widac je w repo.

Lekarstwo: pusty plik `.nojekyll` w korzeniu repo (jest w tej paczce).
Wylacza Jekyll calkowicie; strona serwowana jest 1:1 z plikow.

Sprawdzenie po wdrozeniu — oba adresy musza zwrocic 200 i czysty JSON:

    curl -i https://TWOJA_DOMENA/.well-known/assetlinks.json
    curl -i https://TWOJA_DOMENA/.well-known/apple-app-site-association

Jesli dostajesz 404, a pliki sa w repo — brakuje wlasnie `.nojekyll`.

## Czego te pliki NIE robia

Nie naleza do paczki apki. Weryfikacja polega na tym, ze system operacyjny
pobiera je **z Twojej domeny przez HTTPS** przy instalacji. Dlatego
`assemble-www.mjs` ich nie kopiuje do `www/` — w bundlu lezalyby bezuzytecznie.
