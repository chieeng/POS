import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

// Uses the function's own service identity. No key files anywhere (SEC-10).
if (getApps().length === 0) initializeApp();

export const adminAuth = () => getAuth();
export const db = () => getFirestore();
