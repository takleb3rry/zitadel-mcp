/**
 * Tool handler tests with mocked Zitadel API client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { HandlerContext } from '../types/tools.js';
import type { ZitadelConfig } from '../utils/config.js';
import { USER_HANDLERS } from '../tools/users.js';
import { PROJECT_HANDLERS } from '../tools/projects.js';
import { APPLICATION_HANDLERS } from '../tools/applications.js';
import { ROLE_HANDLERS } from '../tools/roles.js';
import { SERVICE_ACCOUNT_HANDLERS } from '../tools/service-accounts.js';
import { ORG_HANDLERS } from '../tools/organizations.js';
import { UTILITY_HANDLERS } from '../tools/utility.js';

// ─── Mock setup ───────────────────────────────────────────────────────────────

function createMockContext(overrides?: Partial<ZitadelConfig>): HandlerContext {
  const config: ZitadelConfig = {
    issuer: 'https://test.zitadel.cloud',
    serviceAccountUserId: 'sa-123',
    serviceAccountKeyId: 'key-456',
    serviceAccountPrivateKey: 'dGVzdA==',
    orgId: 'org-789',
    projectId: 'proj-001',
    logLevel: 'ERROR',
    ...overrides,
  };

  const client = {
    request: vi.fn(),
    getConfig: vi.fn(() => config),
    clearTokenCache: vi.fn(),
  };

  return { client: client as any, config };
}

// ─── User handlers ────────────────────────────────────────────────────────────

describe('user handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_list_users', () => {
    it('returns formatted user list', async () => {
      (ctx.client.request as any).mockResolvedValue({
        result: [
          {
            userId: 'u1',
            username: 'jane',
            state: 'USER_STATE_ACTIVE',
            human: { profile: { givenName: 'Jane', familyName: 'Doe' }, email: { email: 'jane@test.com' } },
          },
        ],
        details: { totalResult: 1 },
      });

      const result = await USER_HANDLERS['zitadel_list_users']!({}, ctx);

      expect(result.isError).toBeFalsy();
      expect(result.content[0]!.text).toContain('Jane Doe');
      expect(result.content[0]!.text).toContain('jane@test.com');
      expect(result.content[0]!.text).toContain('ACTIVE');
    });

    it('returns "no users" for empty results', async () => {
      (ctx.client.request as any).mockResolvedValue({ result: [] });

      const result = await USER_HANDLERS['zitadel_list_users']!({}, ctx);

      expect(result.content[0]!.text).toContain('No users found');
    });

    it('validates limit parameter', async () => {
      await expect(
        USER_HANDLERS['zitadel_list_users']!({ limit: 0 }, ctx)
      ).rejects.toThrow();

      await expect(
        USER_HANDLERS['zitadel_list_users']!({ limit: 501 }, ctx)
      ).rejects.toThrow();
    });
  });

  describe('zitadel_get_user', () => {
    it('returns formatted user details', async () => {
      (ctx.client.request as any).mockResolvedValue({
        userId: 'u1',
        username: 'jane',
        state: 'USER_STATE_ACTIVE',
        human: {
          profile: { givenName: 'Jane', familyName: 'Doe' },
          email: { email: 'jane@test.com', isEmailVerified: true },
        },
        loginNames: ['jane@test.zitadel.cloud'],
        details: { creationDate: '2025-01-01T00:00:00Z' },
      });

      const result = await USER_HANDLERS['zitadel_get_user']!({ userId: 'u1' }, ctx);

      expect(result.content[0]!.text).toContain('Jane Doe');
      expect(result.content[0]!.text).toContain('jane@test.com');
      expect(result.content[0]!.text).toContain('Email Verified: true');
    });

    it('rejects missing userId', async () => {
      await expect(
        USER_HANDLERS['zitadel_get_user']!({}, ctx)
      ).rejects.toThrow();
    });

    it('rejects path traversal in userId', async () => {
      await expect(
        USER_HANDLERS['zitadel_get_user']!({ userId: '../admin' }, ctx)
      ).rejects.toThrow('alphanumeric');
    });
  });

  describe('zitadel_create_user', () => {
    it('creates user and returns ID', async () => {
      (ctx.client.request as any).mockResolvedValue({ userId: 'new-u1' });

      const result = await USER_HANDLERS['zitadel_create_user']!(
        { email: 'new@test.com', firstName: 'New', lastName: 'User' },
        ctx
      );

      expect(result.content[0]!.text).toContain('new-u1');
      expect(result.content[0]!.text).toContain('invitation email');
    });

    it('validates email format', async () => {
      await expect(
        USER_HANDLERS['zitadel_create_user']!(
          { email: 'not-an-email', firstName: 'A', lastName: 'B' },
          ctx
        )
      ).rejects.toThrow();
    });
  });

  describe('zitadel_deactivate_user', () => {
    it('deactivates user', async () => {
      (ctx.client.request as any).mockResolvedValue({});

      const result = await USER_HANDLERS['zitadel_deactivate_user']!({ userId: 'u1' }, ctx);

      expect(result.content[0]!.text).toContain('deactivated');
      expect(ctx.client.request).toHaveBeenCalledWith(
        '/v2/users/u1/deactivate',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });
});

// ─── Project handlers ─────────────────────────────────────────────────────────

describe('project handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_list_projects', () => {
    it('returns formatted project list', async () => {
      (ctx.client.request as any).mockResolvedValue({
        result: [{ id: 'p1', name: 'My Project', state: 'PROJECT_STATE_ACTIVE' }],
      });

      const result = await PROJECT_HANDLERS['zitadel_list_projects']!({}, ctx);

      expect(result.content[0]!.text).toContain('My Project');
      expect(result.content[0]!.text).toContain('ACTIVE');
    });
  });
});

// ─── Application handlers ─────────────────────────────────────────────────────

describe('application handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_create_oidc_app', () => {
    it('creates app and returns client ID', async () => {
      (ctx.client.request as any).mockResolvedValue({
        appId: 'app-1',
        clientId: 'client-123',
        clientSecret: 'secret-abc',
      });

      const result = await APPLICATION_HANDLERS['zitadel_create_oidc_app']!(
        { projectId: 'p1', name: 'Test App', redirectUris: ['https://app.test/callback'] },
        ctx
      );

      expect(result.content[0]!.text).toContain('client-123');
      expect(result.content[0]!.text).toContain('secret-abc');
      expect(result.content[0]!.text).toContain('WARNING');
    });

    it('rejects invalid redirect URIs', async () => {
      await expect(
        APPLICATION_HANDLERS['zitadel_create_oidc_app']!(
          { projectId: 'p1', name: 'Test', redirectUris: ['not-a-url'] },
          ctx
        )
      ).rejects.toThrow();
    });
  });
});

// ─── Role handlers ────────────────────────────────────────────────────────────

describe('role handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_create_user_grant', () => {
    it('validates roles exist before granting', async () => {
      // First call: list roles (returns only "admin")
      // Second call would be the grant (shouldn't happen)
      (ctx.client.request as any).mockResolvedValue({
        result: [{ key: 'admin' }],
      });

      const result = await ROLE_HANDLERS['zitadel_create_user_grant']!(
        { userId: 'u1', roleKeys: ['admin', 'nonexistent'] },
        ctx
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('nonexistent');
      expect(result.content[0]!.text).toContain('not found');
    });

    it('throws without projectId when no default set', async () => {
      const ctxNoProject = createMockContext({ projectId: undefined });

      await expect(
        ROLE_HANDLERS['zitadel_create_user_grant']!(
          { userId: 'u1', roleKeys: ['admin'] },
          ctxNoProject
        )
      ).rejects.toThrow('projectId is required');
    });
  });

  describe('zitadel_remove_user_grant', () => {
    it('calls DELETE with correct path', async () => {
      (ctx.client.request as any).mockResolvedValue({});

      await ROLE_HANDLERS['zitadel_remove_user_grant']!(
        { userId: 'u1', grantId: 'g1' },
        ctx
      );

      expect(ctx.client.request).toHaveBeenCalledWith(
        '/management/v1/users/u1/grants/g1',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });
});

// ─── Service account handlers ─────────────────────────────────────────────────

describe('service account handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_create_service_user_key', () => {
    it('returns key details with save warning', async () => {
      (ctx.client.request as any).mockResolvedValue({
        keyId: 'key-new',
        keyDetails: '{"type":"serviceaccount","keyId":"key-new"}',
      });

      const result = await SERVICE_ACCOUNT_HANDLERS['zitadel_create_service_user_key']!(
        { userId: 'sa1' },
        ctx
      );

      expect(result.content[0]!.text).toContain('key-new');
      expect(result.content[0]!.text).toContain('cannot be retrieved again');
    });
  });
});

// ─── Organization handlers ────────────────────────────────────────────────────

describe('organization handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_get_org', () => {
    it('returns current org details', async () => {
      (ctx.client.request as any).mockResolvedValue({
        org: {
          id: 'org-789',
          name: 'Test Org',
          state: 'ORG_STATE_ACTIVE',
          primaryDomain: 'test.zitadel.cloud',
          details: { creationDate: '2025-01-01T00:00:00Z' },
        },
      });

      const result = await ORG_HANDLERS['zitadel_get_org']!({}, ctx);

      expect(result.content[0]!.text).toContain('Test Org');
      expect(result.content[0]!.text).toContain('ACTIVE');
      expect(result.content[0]!.text).toContain('test.zitadel.cloud');
    });
  });
});

// ─── Utility handlers ─────────────────────────────────────────────────────────

describe('utility handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_get_auth_config', () => {
    it('returns formatted env vars', async () => {
      (ctx.client.request as any).mockResolvedValue({
        name: 'My App',
        oidcConfig: { clientId: 'client-abc' },
      });

      const result = await UTILITY_HANDLERS['zitadel_get_auth_config']!(
        { projectId: 'p1', appId: 'a1' },
        ctx
      );

      const text = result.content[0]!.text;
      expect(text).toContain('AUTH_ZITADEL_ISSUER=https://test.zitadel.cloud');
      expect(text).toContain('AUTH_ZITADEL_CLIENT_ID=client-abc');
      expect(text).toContain('ZITADEL_PROJECT_ID=p1');
    });
  });
});
