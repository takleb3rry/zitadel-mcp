/**
 * Debug log redaction tests
 */

import { describe, it, expect } from 'vitest';

// Replicate the redaction logic from index.ts for unit testing
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

  it('redacts name, displayName, description, query, roleKey', () => {
    const result = redactArgs({
      name: 'My Secret App',
      displayName: 'Admin Role',
      description: 'Internal app for finance',
      query: 'john.doe@',
      roleKey: 'admin',
    });
    expect(result['name']).toBe('[REDACTED]');
    expect(result['displayName']).toBe('[REDACTED]');
    expect(result['description']).toBe('[REDACTED]');
    expect(result['query']).toBe('[REDACTED]');
    expect(result['roleKey']).toBe('[REDACTED]');
  });

  it('redacts slug', () => {
    const result = redactArgs({ slug: 'finance-app', projectId: 'p1' });
    expect(result['slug']).toBe('[REDACTED]');
    expect(result['projectId']).toBe('p1');
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
      limit: 50,
      userId: 'u1',
      grantId: 'g1',
      confirm: true,
    });
    expect(result['projectId']).toBe('p1');
    expect(result['appId']).toBe('a1');
    expect(result['limit']).toBe(50);
    expect(result['userId']).toBe('u1');
    expect(result['grantId']).toBe('g1');
    expect(result['confirm']).toBe(true);
  });

  it('handles empty args', () => {
    expect(redactArgs({})).toEqual({});
  });
});
