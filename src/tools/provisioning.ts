/**
 * High-level user provisioning tools (2 tools) — the app-portal cascade-up.
 *
 *   zitadel_provision_user  — atomic, idempotent: create human user + assign the
 *                             Admin|Standard project role (v2 authorization) +
 *                             (for Admins) grant ORG_USER_MANAGER. Returns
 *                             { zitadelUserId, role, authorizationId, ... }.
 *   zitadel_offboard_user   — deactivate + remove role assignment + revoke
 *                             manager grant, with guards: can't remove the last
 *                             Admin, can't self-demote, can't remove last owner.
 *
 * Background: zitadel-background.md §6 (provisioning cascade) and §7 (no-super-admin,
 * guardrails). These compose the lower-level user/role/org-member helpers so the
 * whole flow is one idempotent call.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, HandlerContext } from '../types/tools.js';
import { textResponse, errorResponse, zitadelId } from '../types/tools.js';
import type { GetUserResponse, UserGrant, ZitadelUserDetails } from '../types/zitadel.js';
import {
  RBAC_PROJECT_ROLES,
  rbacProjectRoleSchema,
  DEFAULT_ADMIN_MANAGER_ROLE,
  ORG_OWNER_ROLE,
} from '../utils/rbac.js';
import { findUserByEmail, createHumanUser } from './users.js';
import {
  resolveProjectId,
  getProjectRoleKeys,
  assignProjectRole,
  listUserProjectGrants,
  listRoleHolders,
  removeProjectGrant,
} from './roles.js';
import { addOrgManager, getOrgMember, guardLastOwner, removeOrgManager } from './org-members.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const PROVISIONING_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_provision_user',
    description:
      'Atomically provision a user for the core SSO apps (the app-portal cascade-up). Creates the human user (idempotent by email or supplied userId), assigns the Admin|Standard project role via the v2 AuthorizationService, and — for Admins — grants ORG_USER_MANAGER so they can manage any user (no-super-admin pattern). Returns { zitadelUserId, role, authorizationId }. Safe to re-run.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address for the user' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
        role: { type: 'string', enum: [...RBAC_PROJECT_ROLES], description: 'Business role: "admin" or "standard" (the only two)' },
        userId: { type: 'string', description: 'Optional client-supplied user ID for idempotent retries' },
        grantOrgManager: {
          type: 'boolean',
          description: 'Grant the org-manager role. Default: true for role=admin, false for role=standard. Set explicitly to override.',
        },
        projectId: { type: 'string', description: 'Project ID for the role assignment (uses default project if omitted)' },
      },
      required: ['email', 'firstName', 'lastName', 'role'],
    },
    _meta: { readOnly: false, domain: 'provisioning' },
    annotations: { title: 'Provision User', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_offboard_user',
    description:
      'Offboard a user: remove their Admin|Standard project role assignment, revoke any org-manager grant, and deactivate the account. Guards: cannot remove the last Admin, cannot self-demote (pass actingUserId), cannot remove the last ORG_OWNER. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The Zitadel user ID to offboard (or provide email)' },
        email: { type: 'string', description: 'Email of the user to offboard (used if userId omitted)' },
        actingUserId: { type: 'string', description: 'The user performing the action — blocks self-demotion if it equals the target' },
        deactivate: { type: 'boolean', description: 'Deactivate the account (default: true)' },
        removeManager: { type: 'boolean', description: 'Revoke org-manager grant (default: true)' },
        projectId: { type: 'string', description: 'Project ID (uses default project if omitted)' },
        confirm: { type: 'boolean', description: 'Must be true to execute. Omit to preview the action.' },
      },
    },
    _meta: { readOnly: false, domain: 'provisioning' },
    annotations: { title: 'Offboard User', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getUserById(ctx: HandlerContext, userId: string): Promise<ZitadelUserDetails | null> {
  try {
    const resp = await ctx.client.request<GetUserResponse>(`/v2/users/${userId}`);
    return resp.user;
  } catch {
    return null;
  }
}

/** Active grants for this user on the project whose roleKeys intersect the RBAC vocabulary. */
function rbacGrants(grants: UserGrant[]): UserGrant[] {
  return grants.filter(
    (g) =>
      g.state !== 'USER_GRANT_STATE_INACTIVE' &&
      (g.roleKeys || []).some((k) => (RBAC_PROJECT_ROLES as readonly string[]).includes(k))
  );
}

// ─── provision_user ───────────────────────────────────────────────────────────

const provisionUserHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    email: z.string().email().max(320),
    firstName: z.string().min(1).max(200),
    lastName: z.string().min(1).max(200),
    role: rbacProjectRoleSchema,
    userId: zitadelId('userId').optional(),
    grantOrgManager: z.boolean().optional(),
  }).parse(params);
  const projectId = resolveProjectId(params, ctx);

  // 1. The target project must actually define the requested role.
  const projectRoles = await getProjectRoleKeys(projectId, ctx);
  if (!projectRoles.includes(input.role)) {
    return errorResponse(
      `Role "${input.role}" is not defined in project ${projectId}. Available: ${projectRoles.join(', ') || 'none'}.\n` +
      `Create it first with zitadel_create_project_role (roleKey "${input.role}").`
    );
  }

  // 2. Resolve or create the user (idempotent by supplied userId, then by email).
  let user: ZitadelUserDetails | null = null;
  if (input.userId) user = await getUserById(ctx, input.userId);
  if (!user) user = await findUserByEmail(ctx, input.email);

  let createdUser = false;
  let zitadelUserId: string;
  if (user) {
    zitadelUserId = user.userId;
  } else {
    zitadelUserId = await createHumanUser(ctx, {
      email: input.email,
      firstName: input.firstName,
      lastName: input.lastName,
      userId: input.userId,
    });
    createdUser = true;
  }

  // 3. Ensure the project-role authorization (idempotent: reuse an existing grant that already has the role).
  const existingGrants = await listUserProjectGrants(ctx, zitadelUserId, projectId);
  const already = rbacGrants(existingGrants).find((g) => (g.roleKeys || []).includes(input.role));
  let authorizationId: string;
  let createdAuthorization = false;
  if (already) {
    authorizationId = already.id;
  } else {
    const { id } = await assignProjectRole(ctx, { userId: zitadelUserId, projectId, roleKeys: [input.role] });
    authorizationId = id;
    createdAuthorization = true;
  }

  // Note any pre-existing OTHER rbac role (we don't auto-remove it here — that's a role change / offboard concern).
  const otherRoles = rbacGrants(existingGrants)
    .flatMap((g) => g.roleKeys || [])
    .filter((k) => (RBAC_PROJECT_ROLES as readonly string[]).includes(k) && k !== input.role);

  // 4. Org-manager grant — default true for admins, false for standard.
  // Granting a manager role requires org-member write (ORG_OWNER); an
  // ORG_USER_MANAGER service account will get 403 here. Degrade gracefully: the
  // user + project role are already in place, so report the gap rather than fail.
  const wantManager = input.grantOrgManager ?? input.role === 'admin';
  let orgManagerRoles: string[] = [];
  let managerChanged = false;
  let managerError: string | null = null;
  if (wantManager) {
    try {
      const result = await addOrgManager(ctx, zitadelUserId, [DEFAULT_ADMIN_MANAGER_ROLE]);
      orgManagerRoles = result.roles;
      managerChanged = result.changed;
    } catch (e) {
      if ((e as { status?: number }).status === 403) {
        managerError =
          `${DEFAULT_ADMIN_MANAGER_ROLE} NOT granted — this service account lacks org-member write ` +
          `(needs ORG_OWNER). Apply it via an ORG_OWNER credential or the Console so this Admin can manage users.`;
      } else {
        throw e;
      }
    }
  }

  logger.info('Provisioned user', { createdUser, createdAuthorization, role: input.role });

  const out = {
    zitadelUserId,
    role: input.role,
    authorizationId,
    orgManagerRoles,
    createdUser,
    createdAuthorization,
    managerChanged,
  };

  const notes: string[] = [];
  if (!createdUser) notes.push(`Reused existing user (${input.email}).`);
  if (!createdAuthorization) notes.push(`Role "${input.role}" was already assigned.`);
  if (otherRoles.length) notes.push(`⚠ User also holds other project role(s): ${otherRoles.join(', ')} (not removed).`);
  if (managerError) notes.push(`⚠ ${managerError}`);
  else if (wantManager && !managerChanged) notes.push(`Org-manager role already present.`);
  if (createdUser) notes.push(`An invitation/MFA-enrollment email was sent to ${input.email}.`);

  return textResponse(
    `User provisioned.\n\n` +
    JSON.stringify(out, null, 2) +
    (notes.length ? `\n\n${notes.join('\n')}` : '')
  );
};

// ─── offboard_user ────────────────────────────────────────────────────────────

const offboardUserHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    userId: zitadelId('userId').optional(),
    email: z.string().email().max(320).optional(),
    actingUserId: zitadelId('actingUserId').optional(),
    deactivate: z.boolean().default(true),
    removeManager: z.boolean().default(true),
    confirm: z.boolean().optional(),
  }).parse(params);
  const projectId = resolveProjectId(params, ctx);

  if (!input.userId && !input.email) {
    return errorResponse('Provide either userId or email to identify the user to offboard.');
  }

  // Resolve the target user.
  let user: ZitadelUserDetails | null = null;
  if (input.userId) user = await getUserById(ctx, input.userId);
  if (!user && input.email) user = await findUserByEmail(ctx, input.email);
  if (!user) return errorResponse(`User not found (${input.userId || input.email}).`);
  const targetId = user.userId;

  // Guard: self-demotion.
  if (input.actingUserId && input.actingUserId === targetId) {
    return errorResponse(`Refusing to self-offboard: actingUserId equals the target (${targetId}). Have another Admin perform this.`);
  }

  // Inspect current state.
  const grants = rbacGrants(await listUserProjectGrants(ctx, targetId, projectId));
  const holdsAdmin = grants.some((g) => (g.roleKeys || []).includes('admin'));
  // Reading org-member state needs org-member read (ORG_OWNER); an
  // ORG_USER_MANAGER service account gets 403. Degrade: we can still remove the
  // project role and deactivate; we just can't see/revoke manager roles.
  let managerRoles: string[] = [];
  let managerReadFailed = false;
  try {
    const member = await getOrgMember(ctx, targetId);
    managerRoles = member?.roles || [];
  } catch (e) {
    if ((e as { status?: number }).status === 403) managerReadFailed = true;
    else throw e;
  }

  // Guard: last Admin.
  if (holdsAdmin) {
    const adminHolders = await listRoleHolders(ctx, projectId, 'admin');
    const otherAdmins = new Set(adminHolders.map((g) => g.userId));
    otherAdmins.delete(targetId);
    if (otherAdmins.size === 0) {
      return errorResponse(
        `Refusing to offboard the last Admin (user ${targetId}). Promote another user to Admin first ` +
        `(zitadel_provision_user role=admin) so the org is never left without one.`
      );
    }
  }

  // Guard: last ORG_OWNER (only relevant if we'd remove the manager membership).
  if (input.removeManager && managerRoles.includes(ORG_OWNER_ROLE)) {
    const ownerGuard = await guardLastOwner(ctx, targetId, managerRoles);
    if (ownerGuard) return errorResponse(ownerGuard);
  }

  // Preview.
  if (!input.confirm) {
    const who = user.human?.profile
      ? `${user.human.profile.givenName} ${user.human.profile.familyName}`.trim()
      : user.username;
    const actions: string[] = [];
    if (grants.length) actions.push(`remove project role grant(s): ${grants.map((g) => (g.roleKeys || []).join('/')).join(', ')}`);
    if (input.removeManager && managerRoles.length) actions.push(`revoke org-manager role(s): ${managerRoles.join(', ')}`);
    if (input.removeManager && managerReadFailed) actions.push(`(manager roles could not be read — needs ORG_OWNER; will attempt revoke)`);
    if (input.deactivate) actions.push(`deactivate the account`);
    return textResponse(
      `⚠ CONFIRM: Offboard "${who}" (${targetId})?\n` +
      (actions.length ? actions.map((a) => `  • ${a}`).join('\n') : '  • (no role/manager grants found)') +
      `\n\nTo proceed, call zitadel_offboard_user again with confirm: true.`
    );
  }

  // Execute.
  const done: string[] = [];
  for (const g of grants) {
    await removeProjectGrant(ctx, targetId, g.id);
    done.push(`removed grant ${g.id} [${(g.roleKeys || []).join(', ')}]`);
  }
  if (input.removeManager && (managerRoles.length || managerReadFailed)) {
    try {
      const r = await removeOrgManager(ctx, targetId);
      if (r.removedMember) done.push(`revoked all org-manager roles`);
      else if (r.remainingRoles.length) done.push(`reduced org-manager roles to [${r.remainingRoles.join(', ')}]`);
      else done.push(`no org-manager roles to revoke`);
    } catch (e) {
      if ((e as { status?: number }).status === 403) {
        done.push(`⚠ could not revoke manager roles — service account lacks org-member write (needs ORG_OWNER)`);
      } else {
        throw e;
      }
    }
  }
  if (input.deactivate) {
    await ctx.client.request(`/v2/users/${targetId}/deactivate`, { method: 'POST' });
    done.push(`deactivated account`);
  }

  return textResponse(
    `User ${targetId} offboarded.\n` + (done.length ? done.map((d) => `  • ${d}`).join('\n') : '  • nothing to do')
  );
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const PROVISIONING_HANDLERS: Record<string, ToolHandler> = {
  zitadel_provision_user: provisionUserHandler,
  zitadel_offboard_user: offboardUserHandler,
};
