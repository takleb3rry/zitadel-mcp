/**
 * Error classes and MCP error handling
 */

import { McpError, ErrorCode } from '@modelcontextprotocol/sdk/types.js';

export class ZitadelAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ZitadelAPIError';
  }
}

export class ValidationError extends Error {
  constructor(message: string, public field?: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

export function handleMCPError(error: unknown): McpError {
  if (error instanceof ValidationError) {
    return new McpError(
      ErrorCode.InvalidParams,
      `Invalid parameter${error.field ? ` '${error.field}'` : ''}: ${error.message}`
    );
  }

  if (error instanceof ZitadelAPIError) {
    if (error.statusCode === 404) {
      return new McpError(ErrorCode.InvalidParams, 'Resource not found in Zitadel');
    }
    if (error.statusCode === 409) {
      return new McpError(ErrorCode.InvalidParams, `Conflict: ${error.message}`);
    }
    if (error.statusCode === 429) {
      return new McpError(ErrorCode.InternalError, 'Rate limit exceeded. Please try again later.');
    }
    return new McpError(ErrorCode.InternalError, `Zitadel API error: ${error.message}`);
  }

  return new McpError(
    ErrorCode.InternalError,
    error instanceof Error ? error.message : 'Unknown error occurred'
  );
}

export function setupErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}
