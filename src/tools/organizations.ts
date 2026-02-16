/**
 * Organization tools (2 tools)
 * Org-level operations via Zitadel Management API v1 + Admin API
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse } from '../types/tools.js';
import type { GetOrgResponse, ListOrgsResponse, ZitadelOrg } from '../types/zitadel.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const ORG_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_get_org',
    description: 'Get details of the current organization (based on the configured ZITADEL_ORG_ID).',
    inputSchema: { type: 'object', properties: {} },
    _meta: { readOnly: true, domain: 'organizations' },
    annotations: { title: 'Get Organization', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_list_orgs',
    description: 'List all organizations in the Zitadel instance. Requires IAM-level admin permissions.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
      },
    },
    _meta: { readOnly: true, domain: 'organizations' },
    annotations: { title: 'List Organizations', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

const getOrgHandler: ToolHandler = async (_params, ctx) => {
  const response = await ctx.client.request<GetOrgResponse>('/management/v1/orgs/me');
  const org = response.org;

  const lines = [
    `Organization: ${org.name}`,
    `ID: ${org.id}`,
    `State: ${org.state?.replace('ORG_STATE_', '') || 'UNKNOWN'}`,
    `Primary Domain: ${org.primaryDomain || 'N/A'}`,
    `Created: ${org.details?.creationDate || 'N/A'}`,
  ];

  return textResponse(lines.join('\n'));
};

const listOrgsHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    limit: z.number().min(1).max(500).default(50),
  }).parse(params);

  const response = await ctx.client.request<ListOrgsResponse>(
    '/admin/v1/orgs/_search',
    {
      method: 'POST',
      body: JSON.stringify({ query: { offset: '0', limit: input.limit } }),
    }
  );

  const orgs = response.result || [];
  if (orgs.length === 0) {
    return textResponse('No organizations found.');
  }

  const lines = orgs.map((o: ZitadelOrg) => {
    const state = o.state?.replace('ORG_STATE_', '') || 'UNKNOWN';
    return `- ${o.name} [${state}] ID: ${o.id}`;
  });

  return textResponse(`Found ${orgs.length} organization(s):\n\n${lines.join('\n')}`);
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const ORG_HANDLERS: Record<string, ToolHandler> = {
  zitadel_get_org: getOrgHandler,
  zitadel_list_orgs: listOrgsHandler,
};
