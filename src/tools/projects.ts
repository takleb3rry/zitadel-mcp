/**
 * Project management tools (3 tools)
 * CRUD operations for Zitadel projects via Management API v1
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse, zitadelId } from '../types/tools.js';
import type { ListProjectsResponse, ZitadelProject, GetProjectResponse, CreateProjectResponse } from '../types/zitadel.js';
import { logger } from '../utils/logger.js';

// ─── Tool Definitions ───────────────────────────────────────────────────────

export const PROJECT_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_list_projects',
    description: 'List all projects in the Zitadel organization.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of results (default: 50)' },
      },
    },
    _meta: { readOnly: true, domain: 'projects' },
    annotations: { title: 'List Projects', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_get_project',
    description: 'Get details of a specific project by its ID.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The project ID' },
      },
      required: ['projectId'],
    },
    _meta: { readOnly: true, domain: 'projects' },
    annotations: { title: 'Get Project', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_create_project',
    description: 'Create a new project in Zitadel. Projects contain applications, roles, and grants.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Project name' },
        projectRoleAssertion: { type: 'boolean', description: 'Include roles in tokens (default: true)' },
        projectRoleCheck: { type: 'boolean', description: 'Only allow users with grants to authenticate (default: false)' },
      },
      required: ['name'],
    },
    _meta: { readOnly: false, domain: 'projects' },
    annotations: { title: 'Create Project', readOnlyHint: false, destructiveHint: false, idempotentHint: false },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

function formatProject(p: ZitadelProject): string {
  const state = p.state?.replace('PROJECT_STATE_', '') || 'UNKNOWN';
  return `- ${p.name} [${state}] ID: ${p.id}`;
}

const listProjectsHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    limit: z.number().min(1).max(500).default(50),
  }).parse(params);

  const response = await ctx.client.request<ListProjectsResponse>(
    '/management/v1/projects/_search',
    {
      method: 'POST',
      body: JSON.stringify({ query: { offset: '0', limit: input.limit } }),
    }
  );

  const projects = response.result || [];
  if (projects.length === 0) {
    return textResponse('No projects found.');
  }

  const lines = projects.map(formatProject);
  return textResponse(`Found ${projects.length} project(s):\n\n${lines.join('\n')}`);
};

const getProjectHandler: ToolHandler = async (params, ctx) => {
  const { projectId } = z.object({ projectId: zitadelId('projectId') }).parse(params);

  const response = await ctx.client.request<GetProjectResponse>(`/management/v1/projects/${projectId}`);
  const project = response.project;

  const lines = [
    `Project: ${project.name}`,
    `ID: ${project.id}`,
    `State: ${project.state?.replace('PROJECT_STATE_', '') || 'UNKNOWN'}`,
    `Role Assertion: ${project.projectRoleAssertion ?? 'N/A'}`,
    `Role Check: ${project.projectRoleCheck ?? 'N/A'}`,
    `Created: ${project.details?.creationDate || 'N/A'}`,
  ];

  return textResponse(lines.join('\n'));
};

const createProjectHandler: ToolHandler = async (params, ctx) => {
  const input = z.object({
    name: z.string().min(1),
    projectRoleAssertion: z.boolean().default(true),
    projectRoleCheck: z.boolean().default(false),
  }).parse(params);

  logger.info('Creating project', { name: input.name });

  const response = await ctx.client.request<CreateProjectResponse>(
    '/management/v1/projects',
    {
      method: 'POST',
      body: JSON.stringify({
        name: input.name,
        projectRoleAssertion: input.projectRoleAssertion,
        projectRoleCheck: input.projectRoleCheck,
      }),
    }
  );

  return textResponse(
    `Project created successfully.\n` +
    `Project ID: ${response.id}\n` +
    `Name: ${input.name}`
  );
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const PROJECT_HANDLERS: Record<string, ToolHandler> = {
  zitadel_list_projects: listProjectsHandler,
  zitadel_get_project: getProjectHandler,
  zitadel_create_project: createProjectHandler,
};
