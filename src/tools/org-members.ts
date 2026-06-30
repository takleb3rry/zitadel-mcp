/**
 * Org member (manager / administrator) tools (4 tools)
 *
 * Manager roles (ORG_OWNER, ORG_USER_MANAGER, …) administer Zitadel itself and
 * are DISTINCT from project (business) roles — they do NOT appear in the OIDC
 * token (zitadel-background.md §7). These are the missing tools the no-super-admin
 * pattern needs: every Admin gets an ORG_USER_MANAGER grant so any Admin can
 * manage any user — a flat, equal set of administrators with no Super Admin.
 *
 * Endpoints: Management API v1 org-member resources.
 *   ListOrgMemberRoles  POST /management/v1/orgs/members/roles/_search
 *   ListOrgMembers      POST /management/v1/orgs/me/members/_search
 *   AddOrgMember        POST /management/v1/orgs/me/members           {userId, roles}
 *   UpdateOrgMember     PUT  /management/v1/orgs/me/members/{userId}  {roles}
 *   RemoveOrgMember     DELETE /management/v1/orgs/me/members/{userId}
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, HandlerContext } from '../types/tools.js';
import { textResponse, errorResponse, zitadelId } from '../types/tools.js';
import type { ListOrgMembersResponse, ListOrgMemberRolesResponse, OrgMember } from '../types/zitadel.js';
import { ORG_MANAGER_ROLES, ORG_OWNER_ROLE, DEFAULT_ADMIN_MANAGER_ROLE } from '../utils/rbac.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const ORG_MEMBER_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_list_org_manager_roles',
    description: 'List the org-level manager (administrator) role keys this Zitadel org supports (e.g. ORG_OWNER, ORG_USER_MANAGER, ORG_USER_PERMISSION_EDITOR). Use to confirm the exact keys before granting.',
    inputSchema: { type: 'object', properties: {} },
    _meta: { readOnly: true, domain: 'organizations' },
    annotations: { title: 'List Org Manager Roles', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_list_org_managers',
    description: 'List users who hold org-level manager (administrator) grants, with their manager roles. Optionally filter to a single role key (e.g. ORG_OWNER) to see who holds it.',
    inputSchema: {
      type: 'object',
      properties: {
        role: { type: 'string', description: 'Optional manager role key to filter by (e.g. "ORG_OWNER", "ORG_USER_MANAGER")' },
      },
    },
    _meta: { readOnly: true, domain: 'organizations' },
    annotations: { title: 'List Org Managers', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_grant_org_manager',
    description: 'Grant org-level manager (administrator) role(s) to a user. For the no-super-admin pattern, grant ORG_USER_MANAGER to every Admin so they can manage any user. Idempotent: merges with any existing manager roles. Defaults to ["ORG_USER_MANAGER"].',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The Zitadel user ID to grant manager role(s) to' },
        roles: {
          type: 'array',
          items: { type: 'string', enum: [...ORG_MANAGER_ROLES] },
          description: 'Manager role keys. Default ["ORG_USER_MANAGER"] (least-privilege). ORG_OWNER = full org control.',
        },
      },
      required: ['userId'],
    },
    _meta: { readOnly: false, domain: 'organizations' },
    annotations: { title: 'Grant Org Manager', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_revoke_org_manager',
    description: 'Revoke org-level manager role(s) from a user. Omit roles to remove the entire manager membership. Guards against removing the last ORG_OWNER. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The Zitadel user ID to revoke manager role(s) from' },
        roles: {
          type: 'array',
          items: { type: 'string', enum: [...ORG_MANAGER_ROLES] },
          description: 'Specific manager role keys to remove. Omit to remove all of the user\'s manager roles.',
        },
        confirm: { type: 'boolean', description: 'Must be true to execute. Omit to preview the action.' },
      },
      required: ['userId'],
    },
    _meta: { readOnly: false, domain: 'organizations' },
    annotations: { title: 'Revoke Org Manager', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

// ─── Shared helpers (exported for provisioning tools) ────────────────────────

export async function listOrgManagers(
  ctx: HandlerContext,
  opts?: { userId?: string; role?: string }
): Promise<OrgMember[]> {
  const queries: unknown[] = [];
  if (opts?.userId) queries.push({ userIdQuery: { userId: opts.userId } });
  const resp = await ctx.client.request<ListOrgMembersResponse>(
    '/management/v1/orgs/me/members/_search',
    {
      method: 'POST',
      body: JSON.stringify({ query: { offset: '0', limit: '500' }, ...(queries.length ? { queries } : {}) }),
    }
  );
  let members = resp.result || [];
  if (opts?.role) members = members.filter((m) => (m.roles || []).includes(opts.role!));
  return members;
}

export async function getOrgMember(ctx: HandlerContext, userId: string): Promise<OrgMember | null> {
  const members = await listOrgManagers(ctx, { userId });
  return members.find((m) => m.userId === userId) || null;
}

/** Idempotently add manager roles; merges with any existing membership. */
export async function addOrgManager(
  ctx: HandlerContext,
  userId: string,
  roles: string[]
): Promise<{ changed: boolean; roles: string[] }> {
  const existing = await getOrgMember(ctx, userId);
  if (existing) {
    const union = Array.from(new Set([...(existing.roles || []), ...roles]));
    if (union.length === (existing.roles || []).length) {
      return { changed: false, roles: existing.roles || [] };
    }
    await ctx.client.request(`/management/v1/orgs/me/members/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ roles: union }),
    });
    return { changed: true, roles: union };
  }
  await ctx.client.request('/management/v1/orgs/me/members', {
    method: 'POST',
    body: JSON.stringify({ userId, roles }),
  });
  return { changed: true, roles };
}

/**
 * Guard: returns an error string if removing `rolesBeingRemoved` from `userId`
 * would drop the org's last ORG_OWNER. Pass empty/undefined rolesBeingRemoved to
 * mean "remove the whole membership". Returns null when the removal is safe.
 */
export async function guardLastOwner(
  ctx: HandlerContext,
  userId: string,
  rolesBeingRemoved?: string[]
): Promise<string | null> {
  const removesOwner = !rolesBeingRemoved || rolesBeingRemoved.length === 0 || rolesBeingRemoved.includes(ORG_OWNER_ROLE);
  if (!removesOwner) return null;
  const owners = await listOrgManagers(ctx, { role: ORG_OWNER_ROLE });
  const targetIsOwner = owners.some((o) => o.userId === userId);
  if (!targetIsOwner) return null;
  if (owners.length <= 1) {
    return (
      `Refusing to remove the last ORG_OWNER (user ${userId}). Zitadel does not document a built-in ` +
      `last-owner guard — keep ≥2 ORG_OWNER break-glass accounts (zitadel-background.md §7).`
    );
  }
  return null;
}

/** Remove specific manager roles (or the whole membership). Caller must run guardLastOwner first. */
export async function removeOrgManager(
  ctx: HandlerContext,
  userId: string,
  roles?: string[]
): Promise<{ removedMember: boolean; remainingRoles: string[] }> {
  const existing = await getOrgMember(ctx, userId);
  if (!existing) return { removedMember: false, remainingRoles: [] };
  const toRemove = roles && roles.length ? roles : existing.roles || [];
  const remaining = (existing.roles || []).filter((r) => !toRemove.includes(r));
  if (remaining.length === 0) {
    await ctx.client.request(`/management/v1/orgs/me/members/${userId}`, { method: 'DELETE' });
    return { removedMember: true, remainingRoles: [] };
  }
  await ctx.client.request(`/management/v1/orgs/me/members/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ roles: remaining }),
  });
  return { removedMember: false, remainingRoles: remaining };
}

function formatMember(m: OrgMember): string {
  const who = m.preferredLoginName || m.displayName || m.userId;
  return `- ${who} (${m.userId}): [${(m.roles || []).join(', ')}]`;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const listOrgManagerRolesHandler: ToolHandler = async (_params, ctx) => {
  const resp = await ctx.client.request<ListOrgMemberRolesResponse>(
    '/management/v1/orgs/members/roles/_search',
    { method: 'POST', body: '{}' }
  );
  const roles = resp.result || [];
  if (roles.length === 0) return textResponse('No org manager roles returned.');
  return textResponse(`Org manager roles supported by this org (${roles.length}):\n\n${roles.map((r) => `- ${r}`).join('\n')}`);
};

const listOrgManagersHandler: ToolHandler = async (params, ctx) => {
  const { role } = z.object({ role: z.string().max(100).optional() }).parse(params);
  const members = await listOrgManagers(ctx, role ? { role } : undefined);
  if (members.length === 0) {
    return textResponse(role ? `No users hold the manager role "${role}".` : 'No org managers found.');
  }
  const header = role ? `Users holding manager role "${role}" (${members.length}):` : `Org managers (${members.length}):`;
  return textResponse(`${header}\n\n${members.map(formatMember).join('\n')}`);
};

const grantOrgManagerHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    userId: zitadelId('userId'),
    roles: z.array(z.enum(ORG_MANAGER_ROLES)).min(1).max(10).optional(),
  }).parse(params);
  const roles = input.roles && input.roles.length ? input.roles : [DEFAULT_ADMIN_MANAGER_ROLE];

  logger.info('Granting org manager role(s)', { userId: input.userId });

  const result = await addOrgManager(ctx, input.userId, roles);
  if (!result.changed) {
    return textResponse(`User ${input.userId} already holds manager role(s) [${result.roles.join(', ')}]. No change.`);
  }
  return textResponse(
    `Org manager grant applied.\n` +
    `User: ${input.userId}\n` +
    `Manager roles now: [${result.roles.join(', ')}]`
  );
};

const revokeOrgManagerHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    userId: zitadelId('userId'),
    roles: z.array(z.enum(ORG_MANAGER_ROLES)).max(10).optional(),
    confirm: z.boolean().optional(),
  }).parse(params);

  const existing = await getOrgMember(ctx, input.userId);
  if (!existing) {
    return textResponse(`User ${input.userId} holds no org manager roles. Nothing to revoke.`);
  }

  // Last-owner guard (run before mutating).
  const guard = await guardLastOwner(ctx, input.userId, input.roles);
  if (guard) return errorResponse(guard);

  if (!input.confirm) {
    const scope = input.roles && input.roles.length ? `role(s) [${input.roles.join(', ')}]` : `ALL manager roles [${(existing.roles || []).join(', ')}]`;
    return textResponse(
      `⚠ CONFIRM: Revoke ${scope} from user ${input.userId}?\n` +
      `This removes their ability to administer Zitadel (not their app/project access).\n\n` +
      `To proceed, call zitadel_revoke_org_manager again with confirm: true.`
    );
  }

  const result = await removeOrgManager(ctx, input.userId, input.roles);
  return textResponse(
    result.removedMember
      ? `Removed org manager membership entirely from user ${input.userId}.`
      : `Updated org manager roles for user ${input.userId}. Remaining: [${result.remainingRoles.join(', ')}]`
  );
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const ORG_MEMBER_HANDLERS: Record<string, ToolHandler> = {
  zitadel_list_org_manager_roles: listOrgManagerRolesHandler,
  zitadel_list_org_managers: listOrgManagersHandler,
  zitadel_grant_org_manager: grantOrgManagerHandler,
  zitadel_revoke_org_manager: revokeOrgManagerHandler,
};
