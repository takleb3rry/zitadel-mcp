/**
 * MCP Tool types — handler signatures, context, response format
 * Annotation pattern from Auth0 MCP server
 */

import { z } from 'zod';
import type { ZitadelClient } from '../auth/client.js';
import type { ZitadelConfig } from '../utils/config.js';

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolMeta {
  readOnly?: boolean;
  domain: 'users' | 'projects' | 'applications' | 'roles' | 'service-accounts' | 'organizations' | 'utility' | 'portal';
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  _meta?: ToolMeta;
  annotations?: ToolAnnotations;
}

export interface HandlerContext {
  client: ZitadelClient;
  config: ZitadelConfig;
}

export interface ToolResponse {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export type ToolHandler = (
  params: Record<string, unknown>,
  ctx: HandlerContext
) => Promise<ToolResponse>;

/** Zitadel IDs are numeric strings — reject anything that could alter URL paths */
export const zitadelId = (label = 'ID') =>
  z.string().min(1, `${label} is required`).regex(/^[a-zA-Z0-9_-]+$/, `${label} must be alphanumeric`);

/** Helper to create a successful text response */
export function textResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }] };
}

/** Helper to create an error text response */
export function errorResponse(text: string): ToolResponse {
  return { content: [{ type: 'text', text }], isError: true };
}
