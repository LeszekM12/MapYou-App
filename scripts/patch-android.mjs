// Patches the generated android/ project for Health Connect.
// Run AFTER `npx cap add android`:  node scripts/patch-android.mjs
// Idempotent — safe to run multiple times (skips what's already there).
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const MANIFEST = 'android/app/src/main/AndroidManifest.xml';
const VARIABLES = 'android/variables.gradle';

if (!existsSync(MANIFEST)) {
  console.error('✗ Nie znaleziono ' + MANIFEST + ' — najpierw uruchom: npx cap add android');
  process.exit(1);
}

// ── 1. AndroidManifest.xml ───────────────────────────────────────────────────
let m = readFileSync(MANIFEST, 'utf8');
let changed = false;

// 1a. Health Connect visibility + read permissions (inside <manifest>, before <application>)
if (!m.includes('com.google.android.apps.healthdata')) {
  const block = `
    <!-- Health Connect: widoczność apki systemowej -->
    <queries>
        <package android:name="com.google.android.apps.healthdata" />
    </queries>
    <!-- Health Connect: uprawnienia odczytu (kroki teraz; reszta pod import treningów) -->
    <uses-permission android:name="android.permission.health.READ_STEPS" />
    <uses-permission android:name="android.permission.health.READ_EXERCISE" />
    <uses-permission android:name="android.permission.health.READ_HEART_RATE" />
    <uses-permission android:name="android.permission.health.READ_DISTANCE" />
    <uses-permission android:name="android.permission.health.READ_ACTIVE_CALORIES_BURNED" />
    <uses-permission android:name="android.permission.health.READ_EXERCISE_ROUTE" />
`;
  m = m.replace(/<application/, block + '\n    <application');
  changed = true;
  console.log('✓ Manifest: dodano queries + uprawnienia Health');
} else {
  console.log('• Manifest: uprawnienia już są');
}

// 1a-bis. Location permissions (web geolocation shim → native GPS)
if (!m.includes('ACCESS_FINE_LOCATION')) {
  const loc = `
    <!-- Lokalizacja: natywny GPS dla mapy/trackera (krok A); tło dojdzie w kroku B -->
    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
`;
  m = m.replace(/<application/, loc + '\n    <application');
  changed = true;
  console.log('✓ Manifest: dodano uprawnienia lokalizacji');
} else {
  console.log('• Manifest: uprawnienia lokalizacji już są');
}

// 1b. Permission-rationale activities (inside <application>, before its close)
if (!m.includes('PermissionsRationaleActivity')) {
  const acts = `
        <!-- Health Connect: ekran uzasadnienia zgód (Android ≤13) -->
        <activity android:name="com.fit_up.health.capacitor.PermissionsRationaleActivity"
                  android:exported="true">
            <intent-filter>
                <action android:name="androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" />
            </intent-filter>
        </activity>
        <!-- Health Connect: ekran uzasadnienia zgód (Android 14+) -->
        <activity-alias android:name="ViewPermissionUsageActivity"
            android:exported="true"
            android:targetActivity="com.fit_up.health.capacitor.PermissionsRationaleActivity"
            android:permission="android.permission.START_VIEW_PERMISSION_USAGE">
            <intent-filter>
                <action android:name="android.intent.action.VIEW_PERMISSION_USAGE" />
                <category android:name="android.intent.category.HEALTH_PERMISSIONS" />
            </intent-filter>
        </activity-alias>
`;
  m = m.replace(/<\/application>/, acts + '    </application>');
  changed = true;
  console.log('✓ Manifest: dodano activity uzasadnienia zgód');
} else {
  console.log('• Manifest: activity uzasadnienia już są');
}

if (changed) writeFileSync(MANIFEST, m);

// ── 2. variables.gradle → minSdkVersion 26 (Health Connect wymaga API 26+) ──
if (existsSync(VARIABLES)) {
  let v = readFileSync(VARIABLES, 'utf8');
  const mm = v.match(/minSdkVersion\s*=\s*(\d+)/);
  if (mm && Number(mm[1]) < 26) {
    v = v.replace(/minSdkVersion\s*=\s*\d+/, 'minSdkVersion = 26');
    writeFileSync(VARIABLES, v);
    console.log(`✓ variables.gradle: minSdkVersion ${mm[1]} → 26`);
  } else {
    console.log('• variables.gradle: minSdkVersion OK (' + (mm ? mm[1] : '?') + ')');
  }
} else {
  console.log('! Brak ' + VARIABLES + ' — sprawdź minSdkVersion ręcznie (ma być ≥26)');
}

console.log('\nGotowe. Teraz: npm i capacitor-health && npx cap sync android && npm run android');
