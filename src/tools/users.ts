/**
 * User management tools (5 tools)
 * CRUD operations for human users via Zitadel v2 API
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler, HandlerContext } from '../types/tools.js';
import { textResponse, errorResponse, zitadelId } from '../types/tools.js';
import type { ListUsersResponse, CreateUserResponse, ZitadelUserDetails } from '../types/zitadel.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const USER_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_list_users',
    description: 'List or search users in the Zitadel instance. Returns user details including name, email, status, and login names.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Optional search query to filter users by email, name, or username',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of users to return (default: 50)',
        },
      },
    },
    _meta: { readOnly: true, domain: 'users' },
    annotations: { title: 'List Users', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_get_user',
    description: 'Get detailed information about a specific user by their user ID.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The Zitadel user ID' },
      },
      required: ['userId'],
    },
    _meta: { readOnly: true, domain: 'users' },
    annotations: { title: 'Get User', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_create_user',
    description: 'Create a new human user in Zitadel. An invitation email will be sent automatically so the user can set their password.',
    inputSchema: {
      type: 'object',
      properties: {
        email: { type: 'string', description: 'Email address for the new user' },
        firstName: { type: 'string', description: 'First name' },
        lastName: { type: 'string', description: 'Last name' },
      },
      required: ['email', 'firstName', 'lastName'],
    },
    _meta: { readOnly: false, domain: 'users' },
    annotations: { title: 'Create User', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'zitadel_deactivate_user',
    description: 'Deactivate a user account. The user will no longer be able to log in.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The Zitadel user ID to deactivate' },
      },
      required: ['userId'],
    },
    _meta: { readOnly: false, domain: 'users' },
    annotations: { title: 'Deactivate User', readOnlyHint: false, destructiveHint: true, idempotentHint: true },
  },
  {
    name: 'zitadel_reactivate_user',
    description: 'Reactivate a previously deactivated user account.',
    inputSchema: {
      type: 'object',
      properties: {
        userId: { type: 'string', description: 'The Zitadel user ID to reactivate' },
      },
      required: ['userId'],
    },
    _meta: { readOnly: false, domain: 'users' },
    annotations: { title: 'Reactivate User', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

function formatUser(u: ZitadelUserDetails): string {
  const name = u.human?.profile
    ? `${u.human.profile.givenName} ${u.human.profile.familyName}`.trim()
    : u.username;
  const email = u.human?.email?.email || 'N/A';
  const state = u.state.replace('USER_STATE_', '');
  return `- ${name} (${email}) [${state}] ID: ${u.userId}`;
}

const listUsersHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    query: z.string().optional(),
    limit: z.number().min(1).max(500).default(50),
  }).parse(params);

  const queries: unknown[] = [];
  if (input.query) {
    queries.push({
      emailQuery: { emailAddress: input.query, method: 'TEXT_QUERY_METHOD_CONTAINS_IGNORE_CASE' },
    });
  }

  const response = await ctx.client.request<ListUsersResponse>('/v2/users', {
    method: 'POST',
    body: JSON.stringify({
      query: { offset: '0', limit: input.limit },
      ...(queries.length > 0 ? { queries } : {}),
    }),
  });

  const users = response.result || [];
  if (users.length === 0) {
    return textResponse('No users found.');
  }

  const total = response.details?.totalResult || users.length;
  const lines = users.map(formatUser);
  return textResponse(`Found ${total} user(s):\n\n${lines.join('\n')}`);
};

const getUserHandler: ToolHandler = async (params, ctx) => {
  const { userId } = z.object({ userId: zitadelId('userId') }).parse(params);

  const response = await ctx.client.request<ZitadelUserDetails>(`/v2/users/${userId}`);

  // v2 GET returns user fields directly (not nested under .user)
  const u = response;
  const name = u.human?.profile
    ? `${u.human.profile.givenName} ${u.human.profile.familyName}`.trim()
    : u.username;

  const lines = [
    `User: ${name}`,
    `ID: ${u.userId}`,
    `Email: ${u.human?.email?.email || 'N/A'}`,
    `Email Verified: ${u.human?.email?.isEmailVerified ?? 'N/A'}`,
    `State: ${u.state.replace('USER_STATE_', '')}`,
    `Username: ${u.username}`,
    `Login Names: ${(u.loginNames || []).join(', ')}`,
    `Created: ${u.details?.creationDate || 'N/A'}`,
  ];

  return textResponse(lines.join('\n'));
};

const createUserHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    email: z.string().email(),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
  }).parse(params);

  logger.info('Creating user', { email: input.email });

  const response = await ctx.client.request<CreateUserResponse>('/v2/users/human', {
    method: 'POST',
    body: JSON.stringify({
      profile: {
        givenName: input.firstName,
        familyName: input.lastName,
      },
      email: {
        email: input.email,
        isVerified: false,
      },
    }),
  });

  return textResponse(
    `User created successfully.\n` +
    `User ID: ${response.userId}\n` +
    `Email: ${input.email}\n` +
    `Name: ${input.firstName} ${input.lastName}\n\n` +
    `An invitation email has been sent to ${input.email} to complete registration.`
  );
};

const deactivateUserHandler: ToolHandler = async (params, ctx) => {
  const { userId } = z.object({ userId: zitadelId('userId') }).parse(params);

  await ctx.client.request(`/v2/users/${userId}/deactivate`, { method: 'POST' });
  return textResponse(`User ${userId} has been deactivated.`);
};

const reactivateUserHandler: ToolHandler = async (params, ctx) => {
  const { userId } = z.object({ userId: zitadelId('userId') }).parse(params);

  await ctx.client.request(`/v2/users/${userId}/reactivate`, { method: 'POST' });
  return textResponse(`User ${userId} has been reactivated.`);
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const USER_HANDLERS: Record<string, ToolHandler> = {
  zitadel_list_users: listUsersHandler,
  zitadel_get_user: getUserHandler,
  zitadel_create_user: createUserHandler,
  zitadel_deactivate_user: deactivateUserHandler,
  zitadel_reactivate_user: reactivateUserHandler,
};
