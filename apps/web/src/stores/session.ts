import { create } from 'zustand';
import type { Role } from '@/features/auth/roles';

export interface SessionUser {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  branchId: string;
  secondFactor: boolean;
}

/** Why the last session ended, shown once on the sign-in screen. */
export type SignInNotice = 'no-access' | 'two-step-ready' | null;

interface SessionState {
  status: 'loading' | 'signedOut' | 'signedIn';
  user: SessionUser | null;
  notice: SignInNotice;
  locked: boolean;
  setSignedIn: (user: SessionUser) => void;
  setSignedOut: () => void;
  setNotice: (notice: SignInNotice) => void;
  setLocked: (locked: boolean) => void;
}

export const useSession = create<SessionState>((set) => ({
  status: 'loading',
  user: null,
  notice: null,
  locked: false,
  setSignedIn: (user) => set({ status: 'signedIn', user }),
  setSignedOut: () => set({ status: 'signedOut', user: null, locked: false }),
  setNotice: (notice) => set({ notice }),
  setLocked: (locked) => set({ locked }),
}));
