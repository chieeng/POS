export const ROLES = ['owner', 'specialSales', 'sales'] as const;
export type Role = (typeof ROLES)[number];

/** Custom claims carried by every active account (AUTH-03, SRS section 6). */
export interface AccessClaims {
  role: Role;
  branchId: string;
  active: true;
}

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

export function readAccessClaims(claims: Record<string, unknown> | undefined): AccessClaims | null {
  if (!claims) return null;
  if (!isRole(claims.role)) return null;
  if (claims.active !== true) return null;
  if (typeof claims.branchId !== 'string' || claims.branchId === '') return null;
  return { role: claims.role, branchId: claims.branchId, active: true };
}
