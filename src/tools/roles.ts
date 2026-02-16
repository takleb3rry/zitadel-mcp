/**
 * Role & grant management tools (5 tools)
 * Project roles and user grants via Zitadel Management API v1
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse, errorResponse, zitadelId } from '../types/tools.js';
import type { ListProjectRolesResponse, ListUserGrantsResponse, CreateUserGrantResponse, UserGrant } from '../types/zitadel.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const ROLE_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_list_project_roles',
    description: 'List all roles defined in a Zitadel project (e.g., "admin", "app:finance").',
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
    description: 'Create a new role in a Zitadel project. Use key format "app:{slug}" for app-specific access roles.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID (uses default project if omitted)' },
        roleKey: { type: 'string', description: 'Role key (e.g., "admin", "app:finance", "app:timesheets")' },
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
    description: 'List role grants for a specific user, showing which roles they have been assigned.',
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
    description: 'Assign roles to a user by creating a grant. Validates that the roles exist in the project before granting.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The user ID to grant roles to' },
        roleKeys: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of role keys to assign (e.g., ["admin", "app:finance"])',
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
    description: 'Remove a role grant from a user by grant ID.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The user ID' },
        grantId: { type: 'string', description: 'The grant ID to remove' },
      },
      required: ['userId', 'grantId'],
    },
    _meta: { readOnly: false, domain: 'roles' },
    annotations: { title: 'Remove User Grant', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resolveProjectId(params: Record<string, unknown>, ctx: { config: { projectId?: string } }): string {
  const projectId = (params['projectId'] as string) || ctx.config.projectId;
  if (!projectId) {
    throw new Error('projectId is required — either pass it as a parameter or set ZITADEL_PROJECT_ID');
  }
  return projectId;
}

async function getProjectRoleKeys(projectId: string, ctx: { client: { request: <T>(path: string, options?: RequestInit) => Promise<T> } }): Promise<string[]> {
  const response = await ctx.client.request<ListProjectRolesResponse>(
    `/management/v1/projects/${projectId}/roles/_search`,
    {
      method: 'POST',
      body: JSON.stringify({ query: { offset: '0', limit: 100 } }),
    }
  );
  return (response.result || []).map(r => r.key);
}

function formatGrant(g: UserGrant): string {
  const roles = g.roleKeys.join(', ');
  const state = g.state?.replace('USER_GRANT_STATE_', '') || 'UNKNOWN';
  return `- Grant ${g.id}: [${roles}] (${state}) Project: ${g.projectId}`;
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const listProjectRolesHandler: ToolHandler = async (params, ctx) => {
  const projectId = resolveProjectId(params, ctx);

  const response = await ctx.client.request<ListProjectRolesResponse>(
    `/management/v1/projects/${projectId}/roles/_search`,
    {
      method: 'POST',
      body: JSON.stringify({ query: { offset: '0', limit: 100 } }),
    }
  );

  const roles = response.result || [];
  if (roles.length === 0) {
    return textResponse(`No roles found in project ${projectId}.`);
  }

  const lines = roles.map(r => {
    const group = r.group ? ` (group: ${r.group})` : '';
    return `- ${r.key}: ${r.displayName}${group}`;
  });

  return textResponse(`Found ${roles.length} role(s) in project ${projectId}:\n\n${lines.join('\n')}`);
};

const createProjectRoleHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    roleKey: z.string().min(1),
    displayName: z.string().min(1),
    group: z.string().optional(),
  }).parse(params);
  const projectId = resolveProjectId(params, ctx);

  logger.info('Creating project role', { projectId, roleKey: input.roleKey });

  await ctx.client.request(
    `/management/v1/projects/${projectId}/roles`,
    {
      method: 'POST',
      body: JSON.stringify({
        roleKey: input.roleKey,
        displayName: input.displayName,
        group: input.group,
      }),
    }
  );

  return textResponse(`Role created: ${input.roleKey} (${input.displayName}) in project ${projectId}`);
};

const listUserGrantsHandler: ToolHandler = async (params, ctx) => {
  const { userId } = z.object({ userId: zitadelId('userId') }).parse(params);
  const projectId = (params['projectId'] as string) || ctx.config.projectId;

  const queries: unknown[] = [{ userIdQuery: { userId } }];
  if (projectId) {
    queries.push({ projectIdQuery: { projectId } });
  }

  const response = await ctx.client.request<ListUserGrantsResponse>(
    '/management/v1/users/grants/_search',
    {
      method: 'POST',
      body: JSON.stringify({
        query: { offset: '0', limit: 100 },
        queries,
      }),
    }
  );

  const grants = response.result || [];
  if (grants.length === 0) {
    return textResponse(`No grants found for user ${userId}.`);
  }

  const lines = grants.map(formatGrant);
  return textResponse(`Found ${grants.length} grant(s) for user ${userId}:\n\n${lines.join('\n')}`);
};

const createUserGrantHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    userId: zitadelId('userId'),
    roleKeys: z.array(z.string().min(1)).min(1),
  }).parse(params);
  const projectId = resolveProjectId(params, ctx);

  // Validate that roles exist before granting
  const existingRoles = await getProjectRoleKeys(projectId, ctx);
  const missingRoles = input.roleKeys.filter(r => !existingRoles.includes(r));
  if (missingRoles.length > 0) {
    return errorResponse(
      `Cannot grant access: role(s) not found in project ${projectId}: ${missingRoles.join(', ')}\n` +
      `Available roles: ${existingRoles.join(', ') || 'none'}\n\n` +
      `Create the missing roles first with zitadel_create_project_role.`
    );
  }

  logger.info('Creating user grant', { userId: input.userId, roleKeys: input.roleKeys, projectId });

  const response = await ctx.client.request<CreateUserGrantResponse>(
    `/management/v1/users/${input.userId}/grants`,
    {
      method: 'POST',
      body: JSON.stringify({ projectId, roleKeys: input.roleKeys }),
    }
  );

  return textResponse(
    `Grant created successfully.\n` +
    `Grant ID: ${response.userGrantId}\n` +
    `User: ${input.userId}\n` +
    `Roles: ${input.roleKeys.join(', ')}\n` +
    `Project: ${projectId}`
  );
};

const removeUserGrantHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    userId: zitadelId('userId'),
    grantId: zitadelId('grantId'),
  }).parse(params);

  await ctx.client.request(
    `/management/v1/users/${input.userId}/grants/${input.grantId}`,
    { method: 'DELETE' }
  );

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
