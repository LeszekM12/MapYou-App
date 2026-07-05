import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.leszekm12.mapyou',
  appName: 'MapYou',
  webDir: 'www',
  // For fast dev you can point the native shell at your live PWA instead of a
  // bundled copy. Comment out `server` to ship the bundled www/.
  server: { url: 'https://leszekm12.github.io/Mapty-App', cleartext: false },
};

export default config;
