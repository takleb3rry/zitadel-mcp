#!/usr/bin/env node
/**
 * Zitadel MCP Server
 * Manage users, projects, apps, roles, and service accounts via the Model Context Protocol
 */

import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
// Load .env from the repo root (one level up from build/ or src/) so secrets can
// live in a gitignored .env regardless of the process working directory. Existing
// process env vars take precedence (override: false), so an inline MCP `env` block
// still wins during migration.
loadDotenv({ path: join(dirname(fileURLToPath(import.meta.url)), '..', '.env') });

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './utils/config.js';
import { ZitadelClient } from './auth/client.js';
import { getTools, getHandlers } from './tools/index.js';
import { logger } from './utils/logger.js';
import { setupErrorHandlers } from './utils/error-handler.js';
import { createRateLimiters } from './utils/rate-limiter.js';
import type { HandlerContext } from './types/tools.js';

async function main() {
  setupErrorHandlers();
  logger.info('Starting Zitadel MCP Server...');

  // Load and validate configuration
  const config = loadConfig();
  const client = new ZitadelClient(config);
  const ctx: HandlerContext = { client, config };

  // Get tools and handlers (portal tools included conditionally)
  const tools = getTools(config);
  const handlers = getHandlers(config);

  const server = new Server(
    { name: 'zitadel-mcp-server', version: '1.1.0' },
    { capabilities: { tools: {} } }
  );

  // List tools — strip internal _meta before returning
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const sanitizedTools = tools.map(({ _meta, ...rest }) => rest);
    return { tools: sanitizedTools };
  });

  // Fields that should never appear in debug logs (PII + sensitive URLs)
  const REDACTED_FIELDS = new Set([
    'email', 'firstName', 'lastName', 'userName',
    'name', 'displayName', 'description', 'query',
    'redirectUris', 'postLogoutRedirectUris',
    'appUrl', 'iconUrl', 'slug',
    'roleKey', 'roleKeys',
    'accessTokenType',
    'expirationDate',
  ]);

  function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      safe[key] = REDACTED_FIELDS.has(key) ? '[REDACTED]' : value;
    }
    return safe;
  }

  // Build a set of read-only tool names for enforcement
  const readOnlyToolNames = new Set(
    tools.filter(t => t._meta?.readOnly).map(t => t.name)
  );

  // Rate limiters: 60 reads/min, 10 writes/min
  const rateLimiters = createRateLimiters();

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
    logger.debug(`Tool call: ${toolName}`, { args: redactArgs(rawArgs) });

    try {
      // Block write operations in read-only mode
      if (config.readOnly && !readOnlyToolNames.has(toolName)) {
        return {
          content: [{ type: 'text' as const, text: `Blocked: ZITADEL_READ_ONLY is enabled. Tool "${toolName}" requires write access.` }],
          isError: true,
        };
      }

      const handler = handlers[toolName];
      if (!handler) {
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
      }

      // Rate limiting: separate buckets for read vs write
      const isReadOnly = readOnlyToolNames.has(toolName);
      const limiter = isReadOnly ? rateLimiters.read : rateLimiters.write;
      if (!limiter.tryAcquire()) {
        const kind = isReadOnly ? 'read' : 'write';
        logger.warn(`Rate limit exceeded for ${kind} operation: ${toolName}`);
        return {
          content: [{ type: 'text' as const, text: `Rate limit exceeded for ${kind} operations. Please wait before trying again.` }],
          isError: true,
        };
      }

      const result = await handler(rawArgs, ctx);
      return { content: result.content, isError: result.isError || false };
    } catch (error) {
      // Log full error details internally but return generic message to MCP client
      logger.error(`Error in ${toolName}`, { error: error instanceof Error ? error.message : error });
      return {
        content: [{ type: 'text' as const, text: `An error occurred while executing ${toolName}. Check server logs for details.` }],
        isError: true,
      };
    }
  });

  // Connect to stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);

  const portalStatus = config.portalDatabaseUrl ? ' (portal extension enabled)' : '';
  logger.info(`Zitadel MCP Server running with ${tools.length} tools${portalStatus}`);
}

// Graceful shutdown
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));

main().catch((error) => {
  logger.error('Fatal error', { error: error instanceof Error ? error.message : error });
  process.exit(1);
});
