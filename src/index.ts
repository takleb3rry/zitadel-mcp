#!/usr/bin/env node
/**
 * Zitadel MCP Server
 * Manage users, projects, apps, roles, and service accounts via the Model Context Protocol
 */

import 'dotenv/config';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { loadConfig } from './utils/config.js';
import { ZitadelClient } from './auth/client.js';
import { getTools, getHandlers } from './tools/index.js';
import { logger } from './utils/logger.js';
import { setupErrorHandlers } from './utils/error-handler.js';
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
    { name: 'zitadel-mcp-server', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // List tools — strip internal _meta before returning
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const sanitizedTools = tools.map(({ _meta, ...rest }) => rest);
    return { tools: sanitizedTools };
  });

  // Fields that should never appear in debug logs
  const REDACTED_FIELDS = new Set([
    'email', 'firstName', 'lastName', 'userName',
    'redirectUris', 'postLogoutRedirectUris',
    'appUrl', 'iconUrl',
  ]);

  function redactArgs(args: Record<string, unknown>): Record<string, unknown> {
    const safe: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
      safe[key] = REDACTED_FIELDS.has(key) ? '[REDACTED]' : value;
    }
    return safe;
  }

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const toolName = request.params.name;
    const rawArgs = (request.params.arguments ?? {}) as Record<string, unknown>;
    logger.debug(`Tool call: ${toolName}`, { args: redactArgs(rawArgs) });

    try {
      const handler = handlers[toolName];
      if (!handler) {
        return {
          content: [{ type: 'text' as const, text: `Unknown tool: ${toolName}` }],
          isError: true,
        };
      }

      const result = await handler(rawArgs, ctx);
      return { content: result.content, isError: result.isError || false };
    } catch (error) {
      logger.error(`Error in ${toolName}`, { error: error instanceof Error ? error.message : error });
      return {
        content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
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
