/**
 * Configuration validation tests
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, isPortalEnabled } from '../utils/config.js';

describe('loadConfig', () => {
  const VALID_ENV = {
    ZITADEL_ISSUER: 'https://test.zitadel.cloud',
    ZITADEL_SERVICE_ACCOUNT_USER_ID: '123456',
    ZITADEL_SERVICE_ACCOUNT_KEY_ID: 'key-789',
    ZITADEL_SERVICE_ACCOUNT_PRIVATE_KEY: 'dGVzdC1rZXk=',
    ZITADEL_ORG_ID: 'org-001',
  };

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Clear all ZITADEL_ and PORTAL_ vars
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('ZITADEL_') || key.startsWith('PORTAL_') || key === 'LOG_LEVEL') {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads valid configuration', () => {
    Object.assign(process.env, VALID_ENV);
    const config = loadConfig();

    expect(config.issuer).toBe('https://test.zitadel.cloud');
    expect(config.serviceAccountUserId).toBe('123456');
    expect(config.serviceAccountKeyId).toBe('key-789');
    expect(config.serviceAccountPrivateKey).toBe('dGVzdC1rZXk=');
    expect(config.orgId).toBe('org-001');
    expect(config.logLevel).toBe('INFO');
  });

  it('throws on missing required fields', () => {
    expect(() => loadConfig()).toThrow('Configuration error');
  });

  it('throws on missing ZITADEL_ISSUER', () => {
    const { ZITADEL_ISSUER, ...rest } = VALID_ENV;
    Object.assign(process.env, rest);

    expect(() => loadConfig()).toThrow('issuer');
  });

  it('throws on invalid ZITADEL_ISSUER URL', () => {
    Object.assign(process.env, { ...VALID_ENV, ZITADEL_ISSUER: 'not-a-url' });

    expect(() => loadConfig()).toThrow('valid URL');
  });

  it('accepts optional projectId', () => {
    Object.assign(process.env, { ...VALID_ENV, ZITADEL_PROJECT_ID: 'proj-123' });
    const config = loadConfig();

    expect(config.projectId).toBe('proj-123');
  });

  it('accepts optional portalDatabaseUrl', () => {
    Object.assign(process.env, { ...VALID_ENV, PORTAL_DATABASE_URL: 'postgres://localhost/portal' });
    const config = loadConfig();

    expect(config.portalDatabaseUrl).toBe('postgres://localhost/portal');
  });

  it('defaults logLevel to INFO', () => {
    Object.assign(process.env, VALID_ENV);
    const config = loadConfig();

    expect(config.logLevel).toBe('INFO');
  });

  it('accepts valid log levels', () => {
    for (const level of ['DEBUG', 'INFO', 'WARN', 'ERROR'] as const) {
      Object.assign(process.env, { ...VALID_ENV, LOG_LEVEL: level });
      const config = loadConfig();
      expect(config.logLevel).toBe(level);
    }
  });

  it('rejects invalid log level', () => {
    Object.assign(process.env, { ...VALID_ENV, LOG_LEVEL: 'TRACE' });

    expect(() => loadConfig()).toThrow();
  });
});

describe('isPortalEnabled', () => {
  it('returns true when portalDatabaseUrl is set', () => {
    expect(isPortalEnabled({ portalDatabaseUrl: 'postgres://localhost' } as any)).toBe(true);
  });

  it('returns false when portalDatabaseUrl is undefined', () => {
    expect(isPortalEnabled({} as any)).toBe(false);
  });
});
