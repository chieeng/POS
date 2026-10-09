import { FieldValue } from 'firebase-admin/firestore';

export type AuditAction =
  | 'auth.signIn'
  | 'user.create'
  | 'user.setRole'
  | 'user.deactivate'
  | 'user.signOutEverywhere'
  | 'user.passwordResetLink';

export interface AuditInput {
  action: AuditAction;
  actorId: string;
  branchId: string;
  targetType: 'user';
  targetId: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  reason?: string;
}

/**
 * Builds an auditLogs document (SYS-03, NFR-06). Append-only: clients can never write or
 * change these. deviceTag stays null until device tags (SYS-02) are built.
 */
export function auditEntry(input: AuditInput) {
  return {
    action: input.action,
    actorId: input.actorId,
    branchId: input.branchId,
    deviceTag: null,
    targetType: input.targetType,
    targetId: input.targetId,
    ...(input.before ? { before: input.before } : {}),
    ...(input.after ? { after: input.after } : {}),
    ...(input.reason ? { reason: input.reason } : {}),
    createdAt: FieldValue.serverTimestamp(),
  };
}
