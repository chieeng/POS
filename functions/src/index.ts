import { setGlobalOptions } from 'firebase-functions/v2';
import { onCall, type CallableOptions } from 'firebase-functions/v2/https';
import { beforeUserSignedIn } from 'firebase-functions/v2/identity';
import { recordSignInHandler } from './auth/recordSignIn.js';
import {
  createPasswordResetLinkHandler,
  createUserHandler,
  deactivateUserHandler,
  setUserRoleHandler,
  signOutEverywhereHandler,
  updateUserHandler,
} from './users/handlers.js';

// SRS section 2: every function runs in Singapore.
setGlobalOptions({ region: 'asia-southeast1', maxInstances: 10 });

// SEC-06, SEC-08: requests without a valid App Check token never reach the handler. Each
// handler then checks auth, role, active flag and input itself (see lib/guard.ts).
const callable: CallableOptions = { enforceAppCheck: true };

export const createUser = onCall(callable, createUserHandler);
export const updateUser = onCall(callable, updateUserHandler);
export const setUserRole = onCall(callable, setUserRoleHandler);
export const deactivateUser = onCall(callable, deactivateUserHandler);
export const signOutEverywhere = onCall(callable, signOutEverywhereHandler);
export const createPasswordResetLink = onCall(callable, createPasswordResetLinkHandler);

export const recordSignIn = beforeUserSignedIn(recordSignInHandler);
