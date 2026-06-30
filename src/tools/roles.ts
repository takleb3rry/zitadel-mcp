/**
 * Role & grant management tools (5 tools)
 *
 * Project roles via Management API v1. Role assignment (granting a project role
 * to a user) is written via the v2 AuthorizationService (POST /v2/authorizations,
 * zitadel-background.md §6) — v1 user-grant endpoints are deprecated. Reads and
 * removals use the proven v1 grant endpoints; a v2 authorization id is the same
 * aggregate id as a v1 user grant, so the two interoperate.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, HandlerContext } from '../types/tools.js';
import { textResponse, errorResponse, zitadelId } from '../types/tools.js';
import type {
  ListProjectRolesResponse,
  ListUserGrantsResponse,
  CreateAuthorizationRequest,
  CreateAuthorizationResponse,
  CreateUserGrantResponse,
  UserGrant,
} from '../types/zitadel.js';
import { nonStandardRoles, RBAC_PROJECT_ROLES } from '../utils/rbac.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const ROLE_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_list_project_roles',
    description: 'List all roles defined in a Zitadel project (e.g., "admin", "standard").',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID (uses default project if omitted)' },
      },
    },
    _meta: { readOnly: true, domain: 'roles' },
    annotations: { title: 'List Project Roles', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_create_project_role',
    description: 'Create a new role in a Zitadel project. For the standardized RBAC model use the keys "admin" or "standard" (see zitadel_provision_user).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID (uses default project if omitted)' },
        roleKey: { type: 'string', description: 'Role key. Standardized vocabulary: "admin" or "standard".' },
        displayName: { type: 'string', description: 'Human-readable role name' },
        group: { type: 'string', description: 'Optional role group for organization' },
      },
      required: ['roleKey', 'displayName'],
    },
    _meta: { readOnly: false, domain: 'roles' },
    annotations: { title: 'Create Project Role', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_list_user_grants',
    description: 'List role grants (authorizations) for a specific user, showing which project roles they have been assigned.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The user ID to list grants for' },
        projectId: { type: 'string', description: 'Filter by project ID (uses default project if omitted)' },
      },
      required: ['userId'],
    },
    _meta: { readOnly: true, domain: 'roles' },
    annotations: { title: 'List User Grants', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_create_user_grant',
    description: 'Assign project roles to a user via the v2 AuthorizationService. Validates that the roles exist in the project before granting. For the standardized two-role model prefer "admin"/"standard"; other keys are allowed but flagged as drift.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The user ID to grant roles to' },
        roleKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of role keys to assign (standardized: ["admin"] or ["standard"])',
        },
        projectId: { type: 'string', description: 'The project ID (uses default project if omitted)' },
      },
      required: ['userId', 'roleKeys'],
    },
    _meta: { readOnly: false, domain: 'roles' },
    annotations: { title: 'Create User Grant', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'zitadel_remove_user_grant',
    description: 'Remove a role grant (authorization) from a user by grant ID. Requires confirm: true.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The user ID' },
        grantId: { type: 'string', description: 'The grant / authorization ID to remove' },
        confirm: { type: 'boolean', description: 'Must be true to execute. Omit to preview the action.' },
      },
      required: ['userId', 'grantId'],
    },
    _meta: { readOnly: false, domain: 'roles' },
    annotations: { title: 'Remove User Grant', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

// ─── Shared helpers (exported for provisioning tools) ────────────────────────

export function resolveProjectId(params: Record<string, unknown>, ctx: { config: { projectId?: string } }): string {
  const projectId = (params['projectId'] as string) || ctx.config.projectId;
  if (!projectId) {
    throw new Error('projectId is required — either pass it as a parameter or set ZITADEL_PROJECT_ID');
  }
  return projectId;
}

/** All role keys defined on a project (used to validate before granting). */
export async function getProjectRoleKeys(projectId: string, ctx: HandlerContext): Promise<string[]> {
  const response = await ctx.client.request<ListProjectRolesResponse>(
    `/management/v1/projects/${projectId}/roles/_search`,
    { method: 'POST', body: JSON.stringify({ query: { offset: '0', limit: 100 } }) }
  );
  return (response.result || []).map((r) => r.key);
}

// Per-client cache of whether the v2 AuthorizationService is available on the
// instance. Some Zitadel Cloud versions do not expose POST /v2/authorizations
// (it 404s) — we detect that once and fall back to the v1 user-grant endpoint
// for the rest of the process. Keyed by client so unit tests don't leak state.
const v2AuthzAvailable = new WeakMap<object, boolean>();

/**
 * Assign project roles to a user. Prefers the v2 AuthorizationService
 * (POST /v2/authorizations); if that endpoint is unavailable on the instance
 * (404), transparently falls back to the proven v1 user-grant endpoint. Returns
 * the resulting authorization/grant id (the same aggregate id either way), plus
 * which API path was used.
 */
export async function assignProjectRole(
  ctx: HandlerContext,
  args: { userId: string; projectId: string; roleKeys: string[]; organizationId?: string }
): Promise<{ id: string; via: 'v2' | 'v1' }> {
  const clientKey = ctx.client as unknown as object;

  if (v2AuthzAvailable.get(clientKey) !== false) {
    try {
      const body: CreateAuthorizationRequest = {
        userId: args.userId,
        projectId: args.projectId,
        organizationId: args.organizationId ?? ctx.config.orgId,
        roleKeys: args.roleKeys,
      };
      const resp = await ctx.client.request<CreateAuthorizationResponse>('/v2/authorizations', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      v2AuthzAvailable.set(clientKey, true);
      return { id: resp.id, via: 'v2' };
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status !== 404) throw e; // real error (perm/validation) — surface it
      v2AuthzAvailable.set(clientKey, false);
      logger.info('v2 /v2/authorizations unavailable (404) — falling back to v1 user grants');
    }
  }

  // v1 fallback: POST /management/v1/users/{userId}/grants
  const resp = await ctx.client.request<CreateUserGrantResponse>(
    `/management/v1/users/${args.userId}/grants`,
    { method: 'POST', body: JSON.stringify({ projectId: args.projectId, roleKeys: args.roleKeys }) }
  );
  return { id: resp.userGrantId, via: 'v1' };
}

/** A user's project-role grants (v1 read), optionally filtered to one project. */
export async function listUserProjectGrants(
  ctx: HandlerContext,
  userId: string,
  projectId?: string
): Promise<UserGrant[]> {
  const queries: unknown[] = [{ userIdQuery: { userId } }];
  if (projectId) queries.push({ projectIdQuery: { projectId } });
  const resp = await ctx.client.request<ListUserGrantsResponse>(
    '/management/v1/users/grants/_search',
    { method: 'POST', body: JSON.stringify({ query: { offset: '0', limit: 100 }, queries }) }
  );
  return resp.result || [];
}

/** Active grants on a project that include a specific role key (last-admin guard). */
export async function listRoleHolders(
  ctx: HandlerContext,
  projectId: string,
  roleKey: string
): Promise<UserGrant[]> {
  const resp = await ctx.client.request<ListUserGrantsResponse>(
    '/management/v1/users/grants/_search',
    {
      method: 'POST',
      body: JSON.stringify({
        query: { offset: '0', limit: 500 },
        queries: [{ projectIdQuery: { projectId } }, { roleKeyQuery: { roleKey } }],
      }),
    }
  );
  return (resp.result || []).filter((g) => g.state !== 'USER_GRANT_STATE_INACTIVE');
}

/** Remove a project-role grant (authorization) by its id. */
export async function removeProjectGrant(ctx: HandlerContext, userId: string, grantId: string): Promise<void> {
  await ctx.client.request(`/management/v1/users/${userId}/grants/${grantId}`, { method: 'DELETE' });
}

function formatGrant(g: UserGrant): string {
  const roles = g.roleKeys.join(', ');
  const state = g.state?.replace('USER_GRANT_STATE_', '') || 'UNKNOWN';
  return `- Grant ${g.id}: [${roles}] (${state}) Project: ${g.projectId}`;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const listProjectRolesHandler: ToolHandler = async (params, ctx) => {
  const projectId = resolveProjectId(params, ctx);
  const keys = await getProjectRoleKeys(projectId, ctx);
  if (keys.length === 0) {
    return textResponse(`No roles found in project ${projectId}.`);
  }
  // Re-fetch with display names for a richer listing.
  const response = await ctx.client.request<ListProjectRolesResponse>(
    `/management/v1/projects/${projectId}/roles/_search`,
    { method: 'POST', body: JSON.stringify({ query: { offset: '0', limit: 100 } }) }
  );
  const lines = (response.result || []).map((r) => {
    const group = r.group ? ` (group: ${r.group})` : '';
    return `- ${r.key}: ${r.displayName}${group}`;
  });
  return textResponse(`Found ${lines.length} role(s) in project ${projectId}:\n\n${lines.join('\n')}`);
};

const createProjectRoleHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    roleKey: z.string().min(1).max(200),
    displayName: z.string().min(1).max(200),
    group: z.string().max(200).optional(),
  }).parse(params);
  const projectId = resolveProjectId(params, ctx);

  logger.info('Creating project role', { projectId });

  await ctx.client.request(
    `/management/v1/projects/${projectId}/roles`,
    { method: 'POST', body: JSON.stringify({ roleKey: input.roleKey, displayName: input.displayName, group: input.group }) }
  );

  return textResponse(`Role created: ${input.roleKey} (${input.displayName}) in project ${projectId}`);
};

const listUserGrantsHandler: ToolHandler = async (params, ctx) => {
  const { userId } = z.object({ userId: zitadelId('userId') }).parse(params);
  const projectId = (params['projectId'] as string) || ctx.config.projectId;

  const grants = await listUserProjectGrants(ctx, userId, projectId);
  if (grants.length === 0) {
    return textResponse(`No grants found for user ${userId}.`);
  }
  const lines = grants.map(formatGrant);
  return textResponse(`Found ${grants.length} grant(s) for user ${userId}:\n\n${lines.join('\n')}`);
};

const createUserGrantHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    userId: zitadelId('userId'),
    roleKeys: z.array(z.string().min(1).max(200)).min(1).max(50),
  }).parse(params);
  const projectId = resolveProjectId(params, ctx);

  // Validate that roles exist before granting
  const existingRoles = await getProjectRoleKeys(projectId, ctx);
  const missingRoles = input.roleKeys.filter((r) => !existingRoles.includes(r));
  if (missingRoles.length > 0) {
    return errorResponse(
      `Cannot grant access: role(s) not found in project ${projectId}: ${missingRoles.join(', ')}\n` +
      `Available roles: ${existingRoles.join(', ') || 'none'}\n\n` +
      `Create the missing roles first with zitadel_create_project_role.`
    );
  }

  logger.info('Creating user grant (v2 authorization)', { userId: input.userId, projectId });

  const { id } = await assignProjectRole(ctx, {
    userId: input.userId,
    projectId,
    roleKeys: input.roleKeys,
  });

  // Drift guard (§8.1): flag keys outside the standardized two-role vocabulary.
  const drift = nonStandardRoles(input.roleKeys);
  const driftNote = drift.length > 0
    ? `\n\n⚠ Drift: role(s) outside the standardized vocabulary (${RBAC_PROJECT_ROLES.join(' | ')}): ${drift.join(', ')}. ` +
      `For the core SSO apps, prefer zitadel_provision_user with role admin|standard.`
    : '';

  return textResponse(
    `Authorization created successfully.\n` +
    `Authorization ID: ${id}\n` +
    `User: ${input.userId}\n` +
    `Roles: ${input.roleKeys.join(', ')}\n` +
    `Project: ${projectId}` +
    driftNote
  );
};

const removeUserGrantHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    userId: zitadelId('userId'),
    grantId: zitadelId('grantId'),
    confirm: z.boolean().optional(),
  }).parse(params);

  if (!input.confirm) {
    return textResponse(
      `⚠ CONFIRM: Remove grant ${input.grantId} from user ${input.userId}?\n` +
      `This will revoke the associated role(s) from this user.\n\n` +
      `To proceed, call zitadel_remove_user_grant again with confirm: true.`
    );
  }

  await removeProjectGrant(ctx, input.userId, input.grantId);
  return textResponse(`Grant ${input.grantId} removed from user ${input.userId}.`);
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const ROLE_HANDLERS: Record<string, ToolHandler> = {
  zitadel_list_project_roles: listProjectRolesHandler,
  zitadel_create_project_role: createProjectRoleHandler,
  zitadel_list_user_grants: listUserGrantsHandler,
  zitadel_create_user_grant: createUserGrantHandler,
  zitadel_remove_user_grant: removeUserGrantHandler,
};
