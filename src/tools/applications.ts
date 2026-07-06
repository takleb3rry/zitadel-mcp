/**
 * Application management tools (4 tools)
 * OIDC app CRUD via Zitadel Management API v1
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse, zitadelId } from '../types/tools.js';
import type { ListAppsResponse, ZitadelApp, GetAppResponse, CreateOIDCAppResponse } from '../types/zitadel.js';
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
        grantTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
              'OIDC_GRANT_TYPE_IMPLICIT',
              'OIDC_GRANT_TYPE_REFRESH_TOKEN',
              'OIDC_GRANT_TYPE_DEVICE_CODE',
              'OIDC_GRANT_TYPE_TOKEN_EXCHANGE',
            ],
          },
          description: 'OAuth grant types (default: [OIDC_GRANT_TYPE_AUTHORIZATION_CODE]). Include OIDC_GRANT_TYPE_REFRESH_TOKEN to issue refresh tokens.',
        },
        responseTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'OIDC_RESPONSE_TYPE_CODE',
              'OIDC_RESPONSE_TYPE_ID_TOKEN',
              'OIDC_RESPONSE_TYPE_ID_TOKEN_TOKEN',
            ],
          },
          description: 'OIDC response types (default: [OIDC_RESPONSE_TYPE_CODE]).',
        },
        accessTokenType: {
          type: 'string',
          enum: ['OIDC_TOKEN_TYPE_BEARER', 'OIDC_TOKEN_TYPE_JWT'],
          description: 'Access token format. OIDC_TOKEN_TYPE_JWT issues self-contained JWTs validatable via JWKS; OIDC_TOKEN_TYPE_BEARER issues opaque reference tokens. Default OIDC_TOKEN_TYPE_BEARER. Use JWT for resource servers that validate tokens locally (e.g., agentgateway).',
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
    description: 'Update an OIDC application\'s configuration (redirect URIs, auth method, grant types, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
        appId: { type: 'string', description: 'The application ID to update' },
        redirectUris: { type: 'array', items: { type: 'string' }, description: 'Updated redirect URIs' },
        postLogoutRedirectUris: { type: 'array', items: { type: 'string' }, description: 'Updated post-logout URIs' },
        grantTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
              'OIDC_GRANT_TYPE_IMPLICIT',
              'OIDC_GRANT_TYPE_REFRESH_TOKEN',
              'OIDC_GRANT_TYPE_DEVICE_CODE',
              'OIDC_GRANT_TYPE_TOKEN_EXCHANGE',
            ],
          },
          description: 'Replace OAuth grant types (omit to keep current). Include OIDC_GRANT_TYPE_REFRESH_TOKEN to enable refresh tokens.',
        },
        responseTypes: {
          type: 'array',
          items: {
            type: 'string',
            enum: [
              'OIDC_RESPONSE_TYPE_CODE',
              'OIDC_RESPONSE_TYPE_ID_TOKEN',
              'OIDC_RESPONSE_TYPE_ID_TOKEN_TOKEN',
            ],
          },
          description: 'Replace OIDC response types (omit to keep current).',
        },
        accessTokenType: {
          type: 'string',
          enum: ['OIDC_TOKEN_TYPE_BEARER', 'OIDC_TOKEN_TYPE_JWT'],
          description: 'Change access token format. OIDC_TOKEN_TYPE_JWT issues self-contained JWTs (validatable via JWKS); OIDC_TOKEN_TYPE_BEARER issues opaque reference tokens. Omit to keep current.',
        },
        devMode: { type: 'boolean', description: 'Enable/disable dev mode' },
        accessTokenRoleAssertion: { type: 'boolean', description: 'Include user roles in access tokens' },
        idTokenRoleAssertion: { type: 'boolean', description: 'Include user roles in ID tokens' },
        idTokenUserinfoAssertion: { type: 'boolean', description: 'Include user info (name, email) in ID tokens' },
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

  const response = await ctx.client.request<GetAppResponse>(
    `/management/v1/projects/${input.projectId}/apps/${input.appId}`
  );
  const app = response.app;

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
      `Access Token Type: ${oidc.accessTokenType || 'OIDC_TOKEN_TYPE_BEARER (default)'}`,
      `Dev Mode: ${oidc.devMode ?? false}`,
      `Access Token Role Assertion: ${oidc.accessTokenRoleAssertion ?? false}`,
      `ID Token Role Assertion: ${oidc.idTokenRoleAssertion ?? false}`,
      `ID Token Userinfo Assertion: ${oidc.idTokenUserinfoAssertion ?? false}`,
    );
  }

  lines.push(`Created: ${app.details?.creationDate || 'N/A'}`);

  return textResponse(lines.join('\n'));
};

const GRANT_TYPE_VALUES = [
  'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
  'OIDC_GRANT_TYPE_IMPLICIT',
  'OIDC_GRANT_TYPE_REFRESH_TOKEN',
  'OIDC_GRANT_TYPE_DEVICE_CODE',
  'OIDC_GRANT_TYPE_TOKEN_EXCHANGE',
] as const;

const RESPONSE_TYPE_VALUES = [
  'OIDC_RESPONSE_TYPE_CODE',
  'OIDC_RESPONSE_TYPE_ID_TOKEN',
  'OIDC_RESPONSE_TYPE_ID_TOKEN_TOKEN',
] as const;

const ACCESS_TOKEN_TYPE_VALUES = ['OIDC_TOKEN_TYPE_BEARER', 'OIDC_TOKEN_TYPE_JWT'] as const;

const createOIDCAppHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    projectId: zitadelId('projectId'),
    name: z.string().min(1).max(200),
    redirectUris: z.array(z.string().url().max(2000)).min(1).max(20),
    postLogoutRedirectUris: z.array(z.string().url().max(2000)).max(20).optional(),
    appType: z.string().max(50).default('OIDC_APP_TYPE_WEB'),
    authMethodType: z.string().max(50).default('OIDC_AUTH_METHOD_TYPE_NONE'),
    grantTypes: z.array(z.enum(GRANT_TYPE_VALUES)).min(1).max(5).default(['OIDC_GRANT_TYPE_AUTHORIZATION_CODE']),
    responseTypes: z.array(z.enum(RESPONSE_TYPE_VALUES)).min(1).max(3).default(['OIDC_RESPONSE_TYPE_CODE']),
    accessTokenType: z.enum(ACCESS_TOKEN_TYPE_VALUES).optional(),
    devMode: z.boolean().default(false),
  }).parse(params);

  logger.info('Creating OIDC app', { projectId: input.projectId });

  const response = await ctx.client.request<CreateOIDCAppResponse>(
    `/management/v1/projects/${input.projectId}/apps/oidc`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        redirectUris: input.redirectUris,
        responseTypes: input.responseTypes,
        grantTypes: input.grantTypes,
        appType: input.appType,
        authMethodType: input.authMethodType,
        postLogoutRedirectUris: input.postLogoutRedirectUris,
        devMode: input.devMode,
        // Only send accessTokenType when caller specified it; let Zitadel default
        // (bearer) apply otherwise. Including it as undefined trips the API.
        ...(input.accessTokenType ? { accessTokenType: input.accessTokenType } : {}),
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
      ``,
      `A Client Secret was generated for this app.`,
      `For security, it is NOT shown here. Retrieve it from the Zitadel Console:`,
      `  Project → Apps → ${input.name} → Configuration → Regenerate Client Secret`,
    );
  }

  return textResponse(lines.join('\n'));
};

const updateAppHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    projectId: zitadelId('projectId'),
    appId: zitadelId('appId'),
    redirectUris: z.array(z.string().url().max(2000)).max(20).optional(),
    postLogoutRedirectUris: z.array(z.string().url().max(2000)).max(20).optional(),
    grantTypes: z.array(z.enum(GRANT_TYPE_VALUES)).min(1).max(5).optional(),
    responseTypes: z.array(z.enum(RESPONSE_TYPE_VALUES)).min(1).max(3).optional(),
    accessTokenType: z.enum(ACCESS_TOKEN_TYPE_VALUES).optional(),
    devMode: z.boolean().optional(),
    accessTokenRoleAssertion: z.boolean().optional(),
    idTokenRoleAssertion: z.boolean().optional(),
    idTokenUserinfoAssertion: z.boolean().optional(),
  }).parse(params);

  // Fetch current config first — PUT replaces the entire OIDC config
  const current = await ctx.client.request<GetAppResponse>(
    `/management/v1/projects/${input.projectId}/apps/${input.appId}`
  );
  const oidc = current.app.oidcConfig;

  const body: Record<string, unknown> = {
    redirectUris: input.redirectUris ?? oidc?.redirectUris,
    responseTypes: input.responseTypes ?? oidc?.responseTypes,
    grantTypes: input.grantTypes ?? oidc?.grantTypes,
    appType: oidc?.appType,
    authMethodType: oidc?.authMethodType,
    postLogoutRedirectUris: input.postLogoutRedirectUris ?? oidc?.postLogoutRedirectUris,
    devMode: input.devMode ?? oidc?.devMode ?? false,
    accessTokenType: input.accessTokenType ?? oidc?.accessTokenType,
    accessTokenRoleAssertion: input.accessTokenRoleAssertion ?? oidc?.accessTokenRoleAssertion ?? false,
    idTokenRoleAssertion: input.idTokenRoleAssertion ?? oidc?.idTokenRoleAssertion ?? false,
    idTokenUserinfoAssertion: input.idTokenUserinfoAssertion ?? oidc?.idTokenUserinfoAssertion ?? false,
  };

  await ctx.client.request(
    `/management/v1/projects/${input.projectId}/apps/${input.appId}/oidc_config`,
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
