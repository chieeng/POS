import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

const firebaseConfigSchema = z.object({
  apiKey: nonEmpty,
  authDomain: nonEmpty,
  projectId: nonEmpty,
  storageBucket: nonEmpty,
  messagingSenderId: nonEmpty,
  appId: nonEmpty,
});

export type FirebaseWebConfig = z.infer<typeof firebaseConfigSchema>;

/** Placeholder config for the Emulator Suite. `demo-` projects never reach real services. */
const EMULATOR_CONFIG: FirebaseWebConfig = {
  apiKey: 'demo-api-key',
  authDomain: 'demo-pos.firebaseapp.com',
  projectId: 'demo-pos',
  storageBucket: 'demo-pos.appspot.com',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

export interface AppEnv {
  firebase: FirebaseWebConfig;
  useEmulators: boolean;
  recaptchaSiteKey: string | undefined;
  appCheckDebugToken: string | undefined;
  storeName: string | undefined;
  storeAddress: string | undefined;
}

type RawEnv = Record<string, string | boolean | undefined>;

function optional(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Reads and validates the VITE_* variables. Emulators are used only by the dev server, and
 * only unless VITE_USE_EMULATORS=false; a production build can never point at them.
 */
export function readEnv(raw: RawEnv): AppEnv {
  const isDev = raw.DEV === true;
  const useEmulators = isDev && raw.VITE_USE_EMULATORS !== 'false';
  const recaptchaSiteKey = optional(raw.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY);

  let firebase: FirebaseWebConfig;
  if (useEmulators) {
    firebase = EMULATOR_CONFIG;
  } else {
    const parsed = firebaseConfigSchema.safeParse({
      apiKey: raw.VITE_FIREBASE_API_KEY,
      authDomain: raw.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: raw.VITE_FIREBASE_PROJECT_ID,
      storageBucket: raw.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: raw.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: raw.VITE_FIREBASE_APP_ID,
    });
    if (!parsed.success) {
      const missing = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
      throw new Error(`Missing Firebase config (${missing}). See apps/web/.env.example.`);
    }
    firebase = parsed.data;
    // SEC-06: a build that talks to a real project must run App Check.
    if (!isDev && !recaptchaSiteKey) {
      throw new Error('VITE_RECAPTCHA_ENTERPRISE_SITE_KEY is required outside development.');
    }
  }

  return {
    firebase,
    useEmulators,
    recaptchaSiteKey,
    // Only honoured by the dev server, for running against staging from a developer machine.
    appCheckDebugToken: isDev ? optional(raw.VITE_APPCHECK_DEBUG_TOKEN) : undefined,
    storeName: optional(raw.VITE_STORE_NAME),
    storeAddress: optional(raw.VITE_STORE_ADDRESS),
  };
}
