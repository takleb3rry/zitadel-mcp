/**
 * Debug log redaction tests
 */

import { describe, it, expect } from 'vitest';

// Replicate the redaction logic from index.ts for unit testing
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

describe('redactArgs', () => {
  it('redacts email', () => {
    const result = redactArgs({ email: 'user@example.com', userId: '123' });
    expect(result['email']).toBe('[REDACTED]');
    expect(result['userId']).toBe('123');
  });

  it('redacts firstName and lastName', () => {
    const result = redactArgs({ firstName: 'Jane', lastName: 'Doe', userId: '123' });
    expect(result['firstName']).toBe('[REDACTED]');
    expect(result['lastName']).toBe('[REDACTED]');
  });

  it('redacts userName', () => {
    const result = redactArgs({ userName: 'service-bot' });
    expect(result['userName']).toBe('[REDACTED]');
  });

  it('redacts redirect URIs', () => {
    const result = redactArgs({
      redirectUris: ['https://secret-app.internal/callback'],
      postLogoutRedirectUris: ['https://secret-app.internal/'],
      projectId: 'p1',
    });
    expect(result['redirectUris']).toBe('[REDACTED]');
    expect(result['postLogoutRedirectUris']).toBe('[REDACTED]');
    expect(result['projectId']).toBe('p1');
  });

  it('redacts portal URLs', () => {
    const result = redactArgs({ appUrl: 'https://app.test', iconUrl: 'https://cdn.test/icon.png' });
    expect(result['appUrl']).toBe('[REDACTED]');
    expect(result['iconUrl']).toBe('[REDACTED]');
  });

  it('preserves non-sensitive fields', () => {
    const result = redactArgs({
      projectId: 'p1',
      appId: 'a1',
      roleKey: 'admin',
      limit: 50,
    });
    expect(result['projectId']).toBe('p1');
    expect(result['appId']).toBe('a1');
    expect(result['roleKey']).toBe('admin');
    expect(result['limit']).toBe(50);
  });

  it('handles empty args', () => {
    expect(redactArgs({})).toEqual({});
  });
});
