import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'ru.siege.catapult',
  appName: 'Catapult Siege',
  webDir: 'dist',
  // Fully offline game: bundle assets locally, no live-reload in production.
  server: {
    androidScheme: 'https',
    allowNavigation: [],
  },
  backgroundColor: '#161310',
  plugins: {
    SplashScreen: {
      launchShowDuration: 900,
      launchAutoHide: true,
      backgroundColor: '#161310',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#161310',
      overlaysWebView: true,
    },
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,   // flip to true in debug builds only
    backgroundColor: '#161310',
  },
};

export default config;
