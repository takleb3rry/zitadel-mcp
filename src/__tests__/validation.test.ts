/**
 * ID validation and input sanitization tests
 */

import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { zitadelId } from '../types/tools.js';
import { resolveProjectId } from '../tools/roles.js';

describe('zitadelId validator', () => {
  const schema = z.object({ id: zitadelId('testId') });

  it('accepts numeric ID strings', () => {
    expect(schema.parse({ id: '123456789' })).toEqual({ id: '123456789' });
  });

  it('accepts alphanumeric IDs', () => {
    expect(schema.parse({ id: 'abc123' })).toEqual({ id: 'abc123' });
  });

  it('accepts IDs with hyphens', () => {
    expect(schema.parse({ id: 'user-123-abc' })).toEqual({ id: 'user-123-abc' });
  });

  it('accepts IDs with underscores', () => {
    expect(schema.parse({ id: 'user_123' })).toEqual({ id: 'user_123' });
  });

  it('rejects empty strings', () => {
    expect(() => schema.parse({ id: '' })).toThrow('required');
  });

  it('rejects path traversal attempts', () => {
    expect(() => schema.parse({ id: '../admin/v1/something' })).toThrow('alphanumeric');
  });

  it('rejects IDs with slashes', () => {
    expect(() => schema.parse({ id: 'user/123' })).toThrow('alphanumeric');
  });

  it('rejects IDs with dots', () => {
    expect(() => schema.parse({ id: 'user.123' })).toThrow('alphanumeric');
  });

  it('rejects IDs with spaces', () => {
    expect(() => schema.parse({ id: 'user 123' })).toThrow('alphanumeric');
  });

  it('rejects IDs with special characters', () => {
    const badIds = ['id%00', 'id;drop', 'id&foo=bar', 'id<script>'];
    for (const badId of badIds) {
      expect(() => schema.parse({ id: badId }), `should reject: ${badId}`).toThrow('alphanumeric');
    }
  });

  it('uses custom label in error messages', () => {
    const userSchema = z.object({ userId: zitadelId('userId') });
    expect(() => userSchema.parse({ userId: '' })).toThrow('userId');
  });
});

describe('resolveProjectId', () => {
  const ctx = { config: { projectId: 'default-proj-1' } };

  it('returns the param projectId when provided', () => {
    expect(resolveProjectId({ projectId: 'proj-42' }, ctx)).toBe('proj-42');
  });

  it('falls back to the configured default project', () => {
    expect(resolveProjectId({}, ctx)).toBe('default-proj-1');
  });

  it('throws when no projectId is available', () => {
    expect(() => resolveProjectId({}, { config: {} })).toThrow('projectId is required');
  });

  it('rejects path traversal in the param projectId', () => {
    expect(() => resolveProjectId({ projectId: '../../admin/v1/orgs/_search' }, ctx)).toThrow('alphanumeric');
  });

  it('rejects path traversal in the configured default projectId', () => {
    expect(() => resolveProjectId({}, { config: { projectId: 'a/../b' } })).toThrow('alphanumeric');
  });
});
