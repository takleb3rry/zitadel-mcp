/**
 * Configuration loader with Zod validation
 */

import { z } from 'zod';

const configSchema = z.object({
  issuer: z.string().url('ZITADEL_ISSUER must be a valid URL'),
  serviceAccountUserId: z.string().min(1, 'ZITADEL_SERVICE_ACCOUNT_USER_ID is required'),
  serviceAccountKeyId: z.string().min(1, 'ZITADEL_SERVICE_ACCOUNT_KEY_ID is required'),
  serviceAccountPrivateKey: z.string().min(1, 'ZITADEL_SERVICE_ACCOUNT_PRIVATE_KEY is required'),
  orgId: z.string().min(1, 'ZITADEL_ORG_ID is required'),
  projectId: z.string().optional(),
  portalDatabaseUrl: z.string().optional(),
  logLevel: z.enum(['DEBUG', 'INFO', 'WARN', 'ERROR']).default('INFO'),
});

export type ZitadelConfig = z.infer<typeof configSchema>;

export function loadConfig(): ZitadelConfig {
  const result = configSchema.safeParse({
    issuer: process.env['ZITADEL_ISSUER'],
    serviceAccountUserId: process.env['ZITADEL_SERVICE_ACCOUNT_USER_ID'],
    serviceAccountKeyId: process.env['ZITADEL_SERVICE_ACCOUNT_KEY_ID'],
    serviceAccountPrivateKey: process.env['ZITADEL_SERVICE_ACCOUNT_PRIVATE_KEY'],
    orgId: process.env['ZITADEL_ORG_ID'],
    projectId: process.env['ZITADEL_PROJECT_ID'] || undefined,
    portalDatabaseUrl: process.env['PORTAL_DATABASE_URL'] || undefined,
    logLevel: process.env['LOG_LEVEL'] || 'INFO',
  });

  if (!result.success) {
    const errors = result.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Configuration error:\n${errors}`);
  }

  return result.data;
}

export function isPortalEnabled(config: ZitadelConfig): boolean {
  return !!config.portalDatabaseUrl;
}
