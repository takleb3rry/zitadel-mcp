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
import { ORG_MEMBER_TOOLS, ORG_MEMBER_HANDLERS } from './org-members.js';
import { PROVISIONING_TOOLS, PROVISIONING_HANDLERS } from './provisioning.js';
import {
  LOGIN_POLICY_TOOLS,
  LOGIN_POLICY_HANDLERS,
  LOGIN_POLICY_WRITE_TOOLS,
  LOGIN_POLICY_WRITE_HANDLERS,
} from './login-policy.js';
import { LOGIN_TEXTS_TOOLS, LOGIN_TEXTS_HANDLERS } from './login-texts.js';
import { MESSAGE_TEXT_TOOLS, MESSAGE_TEXT_HANDLERS } from './message-texts.js';
import { UTILITY_TOOLS, UTILITY_HANDLERS } from './utility.js';
import { PORTAL_TOOLS, PORTAL_HANDLERS } from './portal.js';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import type { ZitadelConfig } from '../utils/config.js';
import { isPortalEnabled, isLoginPolicyWriteEnabled } from '../utils/config.js';

export function getTools(config: ZitadelConfig): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    ...USER_TOOLS,
    ...PROJECT_TOOLS,
    ...APPLICATION_TOOLS,
    ...ROLE_TOOLS,
    ...SERVICE_ACCOUNT_TOOLS,
    ...ORG_TOOLS,
    ...ORG_MEMBER_TOOLS,
    ...PROVISIONING_TOOLS,
    ...LOGIN_POLICY_TOOLS,
    ...LOGIN_TEXTS_TOOLS,
    ...MESSAGE_TEXT_TOOLS,
    ...UTILITY_TOOLS,
  ];

  if (isLoginPolicyWriteEnabled(config)) {
    tools.push(...LOGIN_POLICY_WRITE_TOOLS);
  }

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
    ...ORG_MEMBER_HANDLERS,
    ...PROVISIONING_HANDLERS,
    ...LOGIN_POLICY_HANDLERS,
    ...LOGIN_TEXTS_HANDLERS,
    ...MESSAGE_TEXT_HANDLERS,
    ...UTILITY_HANDLERS,
  };

  if (isLoginPolicyWriteEnabled(config)) {
    Object.assign(handlers, LOGIN_POLICY_WRITE_HANDLERS);
  }

  if (isPortalEnabled(config)) {
    Object.assign(handlers, PORTAL_HANDLERS);
  }

  return handlers;
}
