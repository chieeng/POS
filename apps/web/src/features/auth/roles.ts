export const ROLES = ['owner', 'specialSales', 'sales'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  specialSales: 'Special Sales',
  sales: 'Sales',
};

export const ROLE_HOME: Record<Role, string> = {
  owner: '/owner',
  specialSales: '/special-sales',
  sales: '/sales',
};

export interface AccessClaims {
  role: Role;
  branchId: string;
  /** True when this sign-in passed the authenticator-app step (SEC-05). */
  secondFactor: boolean;
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Reads the access claims from an ID token (AUTH-03, SEC-02). Returns null unless the token
 * has a valid role, a branch and active === true. This only decides what the UI shows:
 * Security Rules and Cloud Functions make the same checks on the server.
 */
export function parseAccessClaims(claims: Record<string, unknown>): AccessClaims | null {
  if (!isRole(claims.role)) return null;
  if (claims.active !== true) return null;
  if (typeof claims.branchId !== 'string' || claims.branchId === '') return null;
  const firebase = claims.firebase as { sign_in_second_factor?: unknown } | undefined;
  return {
    role: claims.role,
    branchId: claims.branchId,
    secondFactor: firebase?.sign_in_second_factor === 'totp',
  };
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}
