import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.leszekm12.mapyou',
  appName: 'MapYou',
  webDir: 'www',
  // For fast dev you can point the native shell at your live PWA instead of a
  // bundled copy. Comment out `server` to ship the bundled www/.
  server: { url: 'https://leszekm12.github.io/MapYou-App', cleartext: false },
  plugins: {
    FirebaseMessaging: {
      // Show pushes even while the app is in the foreground (iOS)
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    FirebaseAuthentication: {
      // Faza 3: natywne logowanie. skipNativeAuth=false → plugin sam loguje
      // do natywnego SDK; credential i tak wstrzykujemy też do web SDK
      // (authService.ts), żeby JS miał getIdToken() dla authFetch.
      skipNativeAuth: false,
      providers: ['google.com', 'apple.com'],
    },
  },
};

export default config;
