/**
 * Tool registry — aggregates all tools and handlers
 * Portal tools conditionally included based on config
 */

import { USER_TOOLS, USER_HANDLERS } from './users.js';
import { PROJECT_TOOLS, PROJECT_HANDLERS } from './projects.js';
import { APPLICATION_TOOLS, APPLICATION_HANDLERS } from './applications.js';
import { ROLE_TOOLS, ROLE_HANDLERS } from './roles.js';
import { SERVICE_ACCOUNT_TOOLS, SERVICE_ACCOUNT_HANDLERS } from './service-accounts.js';
import { ORG_TOOLS, ORG_HANDLERS } from './organizations.js';
import { UTILITY_TOOLS, UTILITY_HANDLERS } from './utility.js';
import { PORTAL_TOOLS, PORTAL_HANDLERS } from './portal.js';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import type { ZitadelConfig } from '../utils/config.js';
import { isPortalEnabled } from '../utils/config.js';

export function getTools(config: ZitadelConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    ...USER_TOOLS,
    ...PROJECT_TOOLS,
    ...APPLICATION_TOOLS,
    ...ROLE_TOOLS,
    ...SERVICE_ACCOUNT_TOOLS,
    ...ORG_TOOLS,
    ...UTILITY_TOOLS,
  ];

  if (isPortalEnabled(config)) {
    tools.push(...PORTAL_TOOLS);
  }

  return tools;
}

export function getHandlers(config: ZitadelConfig): Record<string, ToolHandler> {
  const handlers: Record<string, ToolHandler> = {
    ...USER_HANDLERS,
    ...PROJECT_HANDLERS,
    ...APPLICATION_HANDLERS,
    ...ROLE_HANDLERS,
    ...SERVICE_ACCOUNT_HANDLERS,
    ...ORG_HANDLERS,
    ...UTILITY_HANDLERS,
  };

  if (isPortalEnabled(config)) {
    Object.assign(handlers, PORTAL_HANDLERS);
  }

  return handlers;
}
