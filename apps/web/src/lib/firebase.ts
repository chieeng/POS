import { initializeApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { readEnv } from './env';

export const env = readEnv(import.meta.env);

// The web config is public by design (SRS 6.3). Access is enforced by Security Rules,
// App Check and Cloud Functions, never by anything in this bundle.
export const app = initializeApp(env.firebase);

// SEC-06: App Check with reCAPTCHA Enterprise. The Emulator Suite does not need it.
if (!env.useEmulators && env.recaptchaSiteKey) {
  if (import.meta.env.DEV && env.appCheckDebugToken) {
    (globalThis as { FIREBASE_APPCHECK_DEBUG_TOKEN?: string }).FIREBASE_APPCHECK_DEBUG_TOKEN =
      env.appCheckDebugToken;
  }
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(env.recaptchaSiteKey),
    isTokenAutoRefreshEnabled: true,
  });
}

export const auth = getAuth(app);

// Offline queue and cache shared across tabs (SRS 7.1, NFR-02).
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});

export const functions = getFunctions(app, 'asia-southeast1');

if (env.useEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}
