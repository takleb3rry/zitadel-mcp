/**
 * App-portal extension tools (2 tools)
 * Only registered when PORTAL_DATABASE_URL is set
 *
 * Inserts into the app-portal `apps` table and orchestrates
 * cross-system app setup (Zitadel + portal DB)
 */

import { z } from 'zod';
import postgres from 'postgres';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse, errorResponse } from '../types/tools.js';
import type { CreateProjectResponse, CreateOIDCAppResponse } from '../types/zitadel.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const PORTAL_TOOLS: ToolDefinition[] = [
  {
    name: 'portal_register_app',
    description: 'Register an application in the app-portal database so it appears in the portal UI. This only creates the portal DB record — use zitadel_create_oidc_app separately if you also need the Zitadel OIDC app.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'URL-safe slug (e.g., "proposal-rodeo"). Used as the role key: app:{slug}' },
        name: { type: 'string', description: 'Display name (e.g., "Proposal Rodeo")' },
        description: { type: 'string', description: 'Brief description of the application' },
        appUrl: { type: 'string', description: 'URL where the app is hosted (e.g., "https://proposals.renewalinitiatives.org")' },
        iconUrl: { type: 'string', description: 'Optional URL to the app icon' },
      },
      required: ['slug', 'name', 'appUrl'],
    },
    _meta: { readOnly: false, domain: 'portal' },
    annotations: { title: 'Register App in Portal', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
  {
    name: 'portal_setup_full_app',
    description: 'One-click app setup: creates a Zitadel project (or uses existing), OIDC application, project role, AND registers the app in the portal database. Returns the .env.local configuration for the new app.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Application name (e.g., "Proposal Rodeo")' },
        slug: { type: 'string', description: 'URL-safe slug (e.g., "proposal-rodeo")' },
        appUrl: { type: 'string', description: 'URL where the app will be hosted' },
        description: { type: 'string', description: 'Brief description' },
        iconUrl: { type: 'string', description: 'Optional icon URL' },
        projectId: { type: 'string', description: 'Existing project ID. If omitted, a new project is created.' },
        redirectUris: {
          type: 'array',
          items: { type: 'string' },
          description: 'OAuth redirect URIs. Defaults to ["{appUrl}/api/auth/callback/zitadel"] if omitted.',
        },
        devMode: { type: 'boolean', description: 'Enable dev mode for http:// URIs (default: false)' },
      },
      required: ['name', 'slug', 'appUrl'],
    },
    _meta: { readOnly: false, domain: 'portal' },
    annotations: { title: 'Full App Setup', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getPortalDb(ctx: { config: { portalDatabaseUrl?: string } }): ReturnType<typeof postgres> {
  if (!ctx.config.portalDatabaseUrl) {
    throw new Error('PORTAL_DATABASE_URL is not configured');
  }
  return postgres(ctx.config.portalDatabaseUrl);
}

// ─── Handlers ────────────────────────────────────────────────────────────────

const portalRegisterAppHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers, and hyphens only'),
    name: z.string().min(1),
    description: z.string().optional(),
    appUrl: z.string().url(),
    iconUrl: z.string().url().optional(),
  }).parse(params);

  const sql = getPortalDb(ctx);

  try {
    // Check slug uniqueness
    const existing = await sql`SELECT id FROM apps WHERE slug = ${input.slug} LIMIT 1`;
    if (existing.length > 0) {
      return errorResponse(`Slug '${input.slug}' already exists in the portal database.`);
    }

    const [app] = await sql`
      INSERT INTO apps (slug, name, description, app_url, icon_url, created_at, updated_at)
      VALUES (${input.slug}, ${input.name}, ${input.description || ''}, ${input.appUrl}, ${input.iconUrl || null}, NOW(), NOW())
      RETURNING id, slug, name
    `;

    return textResponse(
      `App registered in portal.\n` +
      `ID: ${app?.['id']}\n` +
      `Slug: ${app?.['slug']}\n` +
      `Name: ${app?.['name']}`
    );
  } finally {
    await sql.end();
  }
};

const portalSetupFullAppHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    name: z.string().min(1),
    slug: z.string().min(1).regex(/^[a-z0-9-]+$/),
    appUrl: z.string().url(),
    description: z.string().optional(),
    iconUrl: z.string().url().optional(),
    projectId: z.string().optional(),
    redirectUris: z.array(z.string()).optional(),
    devMode: z.boolean().default(false),
  }).parse(params);

  const results: string[] = [];
  const config = ctx.client.getConfig();

  // Step 1: Create or use existing project
  let projectId = input.projectId || config.projectId;
  if (!projectId) {
    logger.info('Creating new Zitadel project', { name: input.name });
    const project = await ctx.client.request<CreateProjectResponse>(
      '/management/v1/projects',
      {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          projectRoleAssertion: true,
          projectRoleCheck: false,
        }),
      }
    );
    projectId = project.id;
    results.push(`1. Created project: ${projectId}`);
  } else {
    results.push(`1. Using existing project: ${projectId}`);
  }

  // Step 2: Create OIDC application
  const redirectUris = input.redirectUris || [`${input.appUrl}/api/auth/callback/zitadel`];
  logger.info('Creating OIDC app', { name: input.name, projectId });

  const app = await ctx.client.request<CreateOIDCAppResponse>(
    `/management/v1/projects/${projectId}/apps/oidc`,
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        redirectUris,
        responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
        grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE'],
        appType: 'OIDC_APP_TYPE_WEB',
        authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
        devMode: input.devMode,
      }),
    }
  );
  results.push(`2. Created OIDC app: Client ID = ${app.clientId}`);

  // Step 3: Create project role for the app
  const roleKey = `app:${input.slug}`;
  logger.info('Creating project role', { roleKey, projectId });

  try {
    await ctx.client.request(
      `/management/v1/projects/${projectId}/roles`,
      {
        method: 'POST',
        body: JSON.stringify({ roleKey, displayName: input.name }),
      }
    );
    results.push(`3. Created role: ${roleKey}`);
  } catch (error) {
    // Role may already exist — that's fine
    results.push(`3. Role ${roleKey} already exists (skipped)`);
  }

  // Step 4: Insert into portal database
  const sql = getPortalDb(ctx);
  try {
    const existing = await sql`SELECT id FROM apps WHERE slug = ${input.slug} LIMIT 1`;
    if (existing.length > 0) {
      results.push(`4. App slug '${input.slug}' already in portal DB (skipped)`);
    } else {
      await sql`
        INSERT INTO apps (slug, name, description, app_url, icon_url, created_at, updated_at)
        VALUES (${input.slug}, ${input.name}, ${input.description || ''}, ${input.appUrl}, ${input.iconUrl || null}, NOW(), NOW())
      `;
      results.push(`4. Registered in portal database`);
    }
  } finally {
    await sql.end();
  }

  // Step 5: Format env vars
  const envVars = [
    `AUTH_ZITADEL_ISSUER=${config.issuer}`,
    `AUTH_ZITADEL_CLIENT_ID=${app.clientId}`,
  ].join('\n');

  return textResponse(
    `Full app setup complete:\n\n` +
    `${results.join('\n')}\n\n` +
    `# .env.local for ${input.name}\n${envVars}\n\n` +
    `# Reference\n` +
    `# ZITADEL_PROJECT_ID=${projectId}\n` +
    `# ZITADEL_ORG_ID=${config.orgId}\n` +
    `# ZITADEL_APP_ID=${app.appId}\n` +
    `# Role key: ${roleKey}`
  );
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const PORTAL_HANDLERS: Record<string, ToolHandler> = {
  portal_register_app: portalRegisterAppHandler,
  portal_setup_full_app: portalSetupFullAppHandler,
};
