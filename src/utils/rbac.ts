/**
 * RBAC vocabulary — the single source of truth for the standardized two-role
 * model used across the Renewal Initiatives core apps.
 *
 * Background: zitadel-background.md §4 (two-role model), §7 (no-super-admin),
 * §8.1 (constrain role grants to admin|standard to prevent drift back to ad-hoc
 * app:* keys).
 *
 * Two distinct kinds of "role" (§7):
 *  - PROJECT (business) roles — appear in the OIDC token, gate what a user can do
 *    inside the apps. We standardize on exactly two: `admin` and `standard`.
 *  - ORG MANAGER roles — administer Zitadel itself (create users, assign roles).
 *    NOT in the token. The no-super-admin pattern gives every Admin an
 *    ORG_USER_MANAGER grant so any Admin can manage any user.
 */

import { z } from 'zod';

// ─── Project (business) roles — land in the OIDC token ───────────────────────

export const RBAC_PROJECT_ROLES = ['admin', 'standard'] as const;
export type RbacProjectRole = (typeof RBAC_PROJECT_ROLES)[number];

/** Zod enum for the two-role vocabulary. Rejects any drift (e.g. `app:finance`). */
export const rbacProjectRoleSchema = z.enum(RBAC_PROJECT_ROLES);

/** True if every key is part of the standardized two-role vocabulary. */
export function isRbacRoleSet(roleKeys: string[]): boolean {
  return roleKeys.every((k) => (RBAC_PROJECT_ROLES as readonly string[]).includes(k));
}

/** Keys that fall outside the two-role vocabulary (drift candidates). */
export function nonStandardRoles(roleKeys: string[]): string[] {
  return roleKeys.filter((k) => !(RBAC_PROJECT_ROLES as readonly string[]).includes(k));
}

// ─── Org manager (administrator) roles — administer Zitadel, NOT in token ─────

/**
 * The org-manager roles relevant to the SSO/RBAC pattern. ORG_USER_MANAGER is
 * the least-privilege role that still allows full user lifecycle + role-grant
 * management within the org (§7) — the default for flat, equal Admins.
 * ORG_USER_PERMISSION_EDITOR is included because Zitadel may require it
 * alongside ORG_USER_MANAGER to edit authorizations (to be confirmed live, §9).
 */
export const ORG_MANAGER_ROLES = [
  'ORG_USER_MANAGER',
  'ORG_OWNER',
  'ORG_USER_PERMISSION_EDITOR',
] as const;
export type OrgManagerRole = (typeof ORG_MANAGER_ROLES)[number];

/** The least-privilege manager role each Admin receives in the no-super-admin model. */
export const DEFAULT_ADMIN_MANAGER_ROLE: OrgManagerRole = 'ORG_USER_MANAGER';

/** The role that confers full org control — guarded against last-owner removal. */
export const ORG_OWNER_ROLE = 'ORG_OWNER';

export const orgManagerRoleSchema = z.enum(ORG_MANAGER_ROLES);
