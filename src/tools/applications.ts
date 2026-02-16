/**
 * Application management tools (4 tools)
 * OIDC app CRUD via Zitadel Management API v1
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse, zitadelId } from '../types/tools.js';
import type { ListAppsResponse, ZitadelApp, CreateOIDCAppResponse } from '../types/zitadel.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const APPLICATION_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_list_apps',
    description: 'List all applications in a Zitadel project.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID to list apps for' },
      },
      required: ['projectId'],
    },
    _meta: { readOnly: true, domain: 'applications' },
    annotations: { title: 'List Apps', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_get_app',
    description: 'Get details of a specific application including its Client ID and OIDC configuration.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        appId: { type: 'string', description: 'The application ID' },
      },
      required: ['projectId', 'appId'],
    },
    _meta: { readOnly: true, domain: 'applications' },
    annotations: { title: 'Get App', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_create_oidc_app',
    description: 'Create a new OIDC application in a Zitadel project. Returns the Client ID (and Client Secret for confidential clients). Configure redirect URIs, response types, and grant types.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID to create the app in' },
        name: { type: 'string', description: 'Application name' },
        redirectUris: {
          type: 'array',
          items: { type: 'string' },
          description: 'OAuth redirect URIs (e.g., ["https://myapp.example.com/api/auth/callback/zitadel"])',
        },
        postLogoutRedirectUris: {
          type: 'array',
          items: { type: 'string' },
          description: 'Post-logout redirect URIs (optional)',
        },
        appType: {
          type: 'string',
          enum: ['OIDC_APP_TYPE_WEB', 'OIDC_APP_TYPE_USER_AGENT', 'OIDC_APP_TYPE_NATIVE'],
          description: 'Application type (default: OIDC_APP_TYPE_WEB)',
        },
        authMethodType: {
          type: 'string',
          enum: ['OIDC_AUTH_METHOD_TYPE_BASIC', 'OIDC_AUTH_METHOD_TYPE_POST', 'OIDC_AUTH_METHOD_TYPE_NONE', 'OIDC_AUTH_METHOD_TYPE_PRIVATE_KEY_JWT'],
          description: 'Auth method. Use NONE for PKCE public clients (default: OIDC_AUTH_METHOD_TYPE_NONE)',
        },
        devMode: {
          type: 'boolean',
          description: 'Enable dev mode to allow http:// redirect URIs (default: false)',
        },
      },
      required: ['projectId', 'name', 'redirectUris'],
    },
    _meta: { readOnly: false, domain: 'applications' },
    annotations: { title: 'Create OIDC App', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'zitadel_update_app',
    description: 'Update an OIDC application\'s configuration (redirect URIs, auth method, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        appId: { type: 'string', description: 'The application ID to update' },
        redirectUris: { type: 'array', items: { type: 'string' }, description: 'Updated redirect URIs' },
        postLogoutRedirectUris: { type: 'array', items: { type: 'string' }, description: 'Updated post-logout URIs' },
        devMode: { type: 'boolean', description: 'Enable/disable dev mode' },
      },
      required: ['projectId', 'appId'],
    },
    _meta: { readOnly: false, domain: 'applications' },
    annotations: { title: 'Update App', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

function formatApp(a: ZitadelApp): string {
  const state = a.state?.replace('APP_STATE_', '') || 'UNKNOWN';
  const clientId = a.oidcConfig?.clientId || 'N/A';
  return `- ${a.name} [${state}] Client ID: ${clientId} | App ID: ${a.id}`;
}

const listAppsHandler: ToolHandler = async (params, ctx) => {
  const { projectId } = z.object({ projectId: zitadelId('projectId') }).parse(params);

  const response = await ctx.client.request<ListAppsResponse>(
    `/management/v1/projects/${projectId}/apps/_search`,
    {
      method: 'POST',
      body: JSON.stringify({ query: { offset: '0', limit: 100 } }),
    }
  );

  const apps = response.result || [];
  if (apps.length === 0) {
    return textResponse('No applications found in this project.');
  }

  const lines = apps.map(formatApp);
  return textResponse(`Found ${apps.length} application(s):\n\n${lines.join('\n')}`);
};

const getAppHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    projectId: zitadelId('projectId'),
    appId: zitadelId('appId'),
  }).parse(params);

  const app = await ctx.client.request<ZitadelApp>(
    `/management/v1/projects/${input.projectId}/apps/${input.appId}`
  );

  const lines = [
    `Application: ${app.name}`,
    `App ID: ${app.id}`,
    `State: ${app.state?.replace('APP_STATE_', '') || 'UNKNOWN'}`,
  ];

  if (app.oidcConfig) {
    const oidc = app.oidcConfig;
    lines.push(
      `Client ID: ${oidc.clientId}`,
      `App Type: ${oidc.appType}`,
      `Auth Method: ${oidc.authMethodType}`,
      `Redirect URIs: ${(oidc.redirectUris || []).join(', ') || 'none'}`,
      `Post-Logout URIs: ${(oidc.postLogoutRedirectUris || []).join(', ') || 'none'}`,
      `Response Types: ${(oidc.responseTypes || []).join(', ')}`,
      `Grant Types: ${(oidc.grantTypes || []).join(', ')}`,
      `Dev Mode: ${oidc.devMode ?? false}`,
    );
  }

  lines.push(`Created: ${app.details?.creationDate || 'N/A'}`);

  return textResponse(lines.join('\n'));
};

const createOIDCAppHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    projectId: zitadelId('projectId'),
    name: z.string().min(1),
    redirectUris: z.array(z.string().url()).min(1),
    postLogoutRedirectUris: z.array(z.string().url()).optional(),
    appType: z.string().default('OIDC_APP_TYPE_WEB'),
    authMethodType: z.string().default('OIDC_AUTH_METHOD_TYPE_NONE'),
    devMode: z.boolean().default(false),
  }).parse(params);

  logger.info('Creating OIDC app', { name: input.name, projectId: input.projectId });

  const response = await ctx.client.request<CreateOIDCAppResponse>(
    `/management/v1/projects/${input.projectId}/apps/oidc`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        redirectUris: input.redirectUris,
        responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
        grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE'],
        appType: input.appType,
        authMethodType: input.authMethodType,
        postLogoutRedirectUris: input.postLogoutRedirectUris,
        devMode: input.devMode,
      }),
    }
  );

  const lines = [
    `OIDC Application created successfully.`,
    `App ID: ${response.appId}`,
    `Client ID: ${response.clientId}`,
  ];

  if (response.clientSecret) {
    lines.push(
      `Client Secret: ${response.clientSecret}`,
      ``,
      `WARNING: Save the Client Secret now — it cannot be retrieved again.`
    );
  }

  return textResponse(lines.join('\n'));
};

const updateAppHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    projectId: zitadelId('projectId'),
    appId: zitadelId('appId'),
    redirectUris: z.array(z.string()).optional(),
    postLogoutRedirectUris: z.array(z.string()).optional(),
    devMode: z.boolean().optional(),
  }).parse(params);

  const body: Record<string, unknown> = {};
  if (input.redirectUris) body['redirectUris'] = input.redirectUris;
  if (input.postLogoutRedirectUris) body['postLogoutRedirectUris'] = input.postLogoutRedirectUris;
  if (input.devMode !== undefined) body['devMode'] = input.devMode;

  await ctx.client.request(
    `/management/v1/projects/${input.projectId}/apps/${input.appId}/oidc`,
    { method: 'PUT', body: JSON.stringify(body) }
  );

  return textResponse(`Application ${input.appId} updated successfully.`);
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const APPLICATION_HANDLERS: Record<string, ToolHandler> = {
  zitadel_list_apps: listAppsHandler,
  zitadel_get_app: getAppHandler,
  zitadel_create_oidc_app: createOIDCAppHandler,
  zitadel_update_app: updateAppHandler,
};
