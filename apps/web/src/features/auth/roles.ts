export const ROLES = ['owner', 'special_sales', 'sales'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  special_sales: 'Special Sales',
  sales: 'Sales',
};

export const ROLE_HOME: Record<Role, string> = {
  owner: '/owner',
  special_sales: '/special-sales',
  sales: '/sales',
};

export interface Access {
  role: Role;
  branchId: string;
}

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}

/**
 * Reads the access a `profiles` row gives (AUTH-03, SEC-02). Returns null unless the row
 * has a valid role, a branch and active === true. This only decides what the UI shows:
 * Row Level Security and the server functions make the same checks on the server.
 */
export function parseProfileAccess(
  profile: Record<string, unknown> | null | undefined,
): Access | null {
  if (!profile) return null;
  if (!isRole(profile.role)) return null;
  if (profile.active !== true) return null;
  if (typeof profile.branch_id !== 'string' || profile.branch_id === '') return null;
  return { role: profile.role, branchId: profile.branch_id };
}

export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase())
    .slice(0, 2)
    .join('');
}
