# MapYou 🏃🗺️

A social fitness tracker — record workouts with live GPS, share them with
friends, and keep your whole training history in one place. Built as a PWA
with native Android and iOS shells.

**Live app:** https://leszekm12.github.io/MapYou-App

## Features

- **Workout tracking** — 40+ sports, live GPS route, auto-pause, per-km splits,
  background tracking with the screen locked
- **iOS Live Activity & Dynamic Island** — live stats on the lock screen
- **Health integration** — steps and workout import from Health Connect
  (Android) and Apple Health (iOS): heart rate, calories, routes
- **Social** — friends, clubs, activity feed, reels with a built-in editor,
  live tracking you can share with chosen people
- **Stats** — weekly charts, history, weather with sunrise/sunset timeline
- **Strava import** — migrate your full Strava archive (GPX/TCX/FIT) in one tap
- **Native push notifications** (FCM) and offline-first storage (IndexedDB)
  with cloud sync

## Tech stack

| Layer     | Tech |
|-----------|------|
| Frontend  | TypeScript, Leaflet, Chart.js — no framework, no bundler (tsc + GitHub Pages) |
| Native    | Capacitor 8 (Android + iOS), Swift Live Activities, Health Connect / HealthKit |
| Backend   | Node.js + Express (TypeScript), Fly.io (Amsterdam) |
| Data      | IndexedDB (Dexie) on device · MongoDB Atlas in the cloud · Cloudinary for media |
| Push      | Firebase Cloud Messaging (APNs on iOS) + Web Push for the PWA |

## Development

```bash
npm install
npm run build:app     # tsc + assemble www/
# native shells
npx cap sync android && npx cap open android
npx cap sync ios && npx cap open ios        # macOS + Xcode
```

The native shells load the live PWA via `server.url` during development
(instant updates on push); production builds bundle `www/`.

## Privacy

MapYou has no ads and does not sell data. See the full
[Privacy Policy](https://leszekm12.github.io/MapYou-App/privacy.html).

## Author

Built by **Leszek Mikrut** — solo project.
