/**
 * Tool handler tests with mocked Zitadel API client
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, sep } from 'node:path';
import type { HandlerContext } from '../types/tools.js';
import type { ZitadelConfig } from '../utils/config.js';
import { USER_HANDLERS } from '../tools/users.js';
import { PROJECT_HANDLERS } from '../tools/projects.js';
import { APPLICATION_HANDLERS } from '../tools/applications.js';
import { ROLE_HANDLERS } from '../tools/roles.js';
import { SERVICE_ACCOUNT_HANDLERS } from '../tools/service-accounts.js';
import { ORG_HANDLERS } from '../tools/organizations.js';
import { LOGIN_TEXTS_HANDLERS } from '../tools/login-texts.js';
import { MESSAGE_TEXT_HANDLERS } from '../tools/message-texts.js';
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
        user: {
          userId: 'u1',
          username: 'jane',
          state: 'USER_STATE_ACTIVE',
          human: {
            profile: { givenName: 'Jane', familyName: 'Doe' },
            email: { email: 'jane@test.com', isVerified: true },
          },
          loginNames: ['jane@test.zitadel.cloud'],
          details: { creationDate: '2025-01-01T00:00:00Z' },
        },
      });

      const result = await USER_HANDLERS['zitadel_get_user']!({ userId: 'u1' }, ctx);

      expect(result.content[0]!.text).toContain('Jane Doe');
      expect(result.content[0]!.text).toContain('jane@test.com');
      expect(result.content[0]!.text).toContain('Email Verified: true');
    });

    it('reports an unverified email as false, the v2 API omitting the flag', async () => {
      (ctx.client.request as any).mockResolvedValue({
        user: {
          userId: 'u2',
          username: 'john',
          state: 'USER_STATE_ACTIVE',
          human: {
            profile: { givenName: 'John', familyName: 'Doe' },
            email: { email: 'john@test.com' },
          },
          loginNames: ['john@test.zitadel.cloud'],
          details: { creationDate: '2025-01-01T00:00:00Z' },
        },
      });

      const result = await USER_HANDLERS['zitadel_get_user']!({ userId: 'u2' }, ctx);

      expect(result.content[0]!.text).toContain('Email Verified: false');
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
    it('shows confirmation prompt without confirm flag', async () => {
      (ctx.client.request as any).mockResolvedValue({
        user: {
          userId: 'u1',
          username: 'jane',
          state: 'USER_STATE_ACTIVE',
          human: { profile: { givenName: 'Jane', familyName: 'Doe' } },
        },
      });

      const result = await USER_HANDLERS['zitadel_deactivate_user']!({ userId: 'u1' }, ctx);

      expect(result.content[0]!.text).toContain('CONFIRM');
      expect(result.content[0]!.text).toContain('confirm: true');
    });

    it('deactivates user with confirm: true', async () => {
      (ctx.client.request as any).mockResolvedValue({});

      const result = await USER_HANDLERS['zitadel_deactivate_user']!({ userId: 'u1', confirm: true }, ctx);

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
    it('creates app and returns client ID (secret suppressed)', async () => {
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
      // Client secret should NOT be shown in response (REM-01)
      expect(result.content[0]!.text).not.toContain('secret-abc');
      expect(result.content[0]!.text).toContain('NOT shown here');
    });

    it('rejects invalid redirect URIs', async () => {
      await expect(
        APPLICATION_HANDLERS['zitadel_create_oidc_app']!(
          { projectId: 'p1', name: 'Test', redirectUris: ['not-a-url'] },
          ctx
        )
      ).rejects.toThrow();
    });

    it('passes provided grantTypes + responseTypes to the API', async () => {
      (ctx.client.request as any).mockResolvedValue({
        appId: 'app-2',
        clientId: 'client-2',
      });

      await APPLICATION_HANDLERS['zitadel_create_oidc_app']!(
        {
          projectId: 'p1',
          name: 'Test',
          redirectUris: ['https://app.test/cb'],
          grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE', 'OIDC_GRANT_TYPE_REFRESH_TOKEN'],
          responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
        },
        ctx
      );

      const [, options] = (ctx.client.request as any).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.grantTypes).toEqual([
        'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
        'OIDC_GRANT_TYPE_REFRESH_TOKEN',
      ]);
      expect(body.responseTypes).toEqual(['OIDC_RESPONSE_TYPE_CODE']);
    });

    it('defaults grantTypes to authorization_code when omitted', async () => {
      (ctx.client.request as any).mockResolvedValue({ appId: 'app-3', clientId: 'client-3' });

      await APPLICATION_HANDLERS['zitadel_create_oidc_app']!(
        { projectId: 'p1', name: 'Test', redirectUris: ['https://app.test/cb'] },
        ctx
      );

      const [, options] = (ctx.client.request as any).mock.calls[0];
      const body = JSON.parse(options.body);
      expect(body.grantTypes).toEqual(['OIDC_GRANT_TYPE_AUTHORIZATION_CODE']);
      expect(body.responseTypes).toEqual(['OIDC_RESPONSE_TYPE_CODE']);
    });
  });

  describe('zitadel_update_app', () => {
    it('replaces grantTypes when provided and preserves untouched fields', async () => {
      (ctx.client.request as any)
        .mockResolvedValueOnce({
          app: {
            id: 'a1',
            name: 'Existing',
            oidcConfig: {
              clientId: 'c1',
              redirectUris: ['https://app.test/cb'],
              responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
              grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE'],
              appType: 'OIDC_APP_TYPE_WEB',
              authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
              devMode: false,
              accessTokenRoleAssertion: true,
            },
          },
        })
        .mockResolvedValueOnce({});

      await APPLICATION_HANDLERS['zitadel_update_app']!(
        {
          projectId: 'p1',
          appId: 'a1',
          grantTypes: [
            'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
            'OIDC_GRANT_TYPE_REFRESH_TOKEN',
          ],
        },
        ctx
      );

      const putCall = (ctx.client.request as any).mock.calls[1];
      const body = JSON.parse(putCall[1].body);
      expect(body.grantTypes).toEqual([
        'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
        'OIDC_GRANT_TYPE_REFRESH_TOKEN',
      ]);
      // Preserved from current config
      expect(body.responseTypes).toEqual(['OIDC_RESPONSE_TYPE_CODE']);
      expect(body.redirectUris).toEqual(['https://app.test/cb']);
      expect(body.accessTokenRoleAssertion).toBe(true);
    });

    it('preserves current grantTypes when omitted', async () => {
      (ctx.client.request as any)
        .mockResolvedValueOnce({
          app: {
            id: 'a1',
            name: 'Existing',
            oidcConfig: {
              clientId: 'c1',
              redirectUris: ['https://app.test/cb'],
              responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
              grantTypes: [
                'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
                'OIDC_GRANT_TYPE_REFRESH_TOKEN',
              ],
              appType: 'OIDC_APP_TYPE_WEB',
              authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
            },
          },
        })
        .mockResolvedValueOnce({});

      await APPLICATION_HANDLERS['zitadel_update_app']!(
        { projectId: 'p1', appId: 'a1', devMode: true },
        ctx
      );

      const body = JSON.parse((ctx.client.request as any).mock.calls[1][1].body);
      expect(body.grantTypes).toEqual([
        'OIDC_GRANT_TYPE_AUTHORIZATION_CODE',
        'OIDC_GRANT_TYPE_REFRESH_TOKEN',
      ]);
      expect(body.devMode).toBe(true);
    });

    it('rejects unknown grant type values', async () => {
      await expect(
        APPLICATION_HANDLERS['zitadel_update_app']!(
          { projectId: 'p1', appId: 'a1', grantTypes: ['NOT_A_REAL_GRANT'] },
          ctx
        )
      ).rejects.toThrow();
    });
  });

  describe('zitadel_update_app', () => {
    it('preserves accessTokenType when only redirect URIs change', async () => {
      const req = ctx.client.request as any;
      req.mockResolvedValueOnce({
        app: {
          oidcConfig: {
            clientId: 'c1',
            redirectUris: ['https://old/callback'],
            responseTypes: ['OIDC_RESPONSE_TYPE_CODE'],
            grantTypes: ['OIDC_GRANT_TYPE_AUTHORIZATION_CODE'],
            appType: 'OIDC_APP_TYPE_WEB',
            authMethodType: 'OIDC_AUTH_METHOD_TYPE_NONE',
            accessTokenType: 'OIDC_TOKEN_TYPE_JWT',
            clockSkew: '0s',
            additionalOrigins: ['https://extra'],
          },
        },
      });
      req.mockResolvedValueOnce({});

      await APPLICATION_HANDLERS['zitadel_update_app']!(
        { projectId: 'p1', appId: 'a1', redirectUris: ['https://new/callback'] },
        ctx
      );

      const putCall = req.mock.calls[1];
      const body = JSON.parse(putCall[1].body);
      expect(body.accessTokenType).toBe('OIDC_TOKEN_TYPE_JWT');
      expect(body.redirectUris).toEqual(['https://new/callback']);
      expect(body.additionalOrigins).toEqual(['https://extra']);
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
    it('shows confirmation prompt without confirm flag', async () => {
      const result = await ROLE_HANDLERS['zitadel_remove_user_grant']!(
        { userId: 'u1', grantId: 'g1' },
        ctx
      );

      expect(result.content[0]!.text).toContain('CONFIRM');
      expect(result.content[0]!.text).toContain('confirm: true');
    });

    it('calls DELETE with correct path when confirmed', async () => {
      (ctx.client.request as any).mockResolvedValue({});

      await ROLE_HANDLERS['zitadel_remove_user_grant']!(
        { userId: 'u1', grantId: 'g1', confirm: true },
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
    it('saves key to file and returns path', async () => {
      (ctx.client.request as any).mockResolvedValue({
        keyId: 'key-new',
        keyDetails: '{"type":"serviceaccount","keyId":"key-new"}',
      });

      const result = await SERVICE_ACCOUNT_HANDLERS['zitadel_create_service_user_key']!(
        { userId: 'sa1' },
        ctx
      );

      expect(result.content[0]!.text).toContain('key-new');
      // Key is saved to file, not shown in response (REM-01)
      expect(result.content[0]!.text).toContain('Private key saved to');
      // Built with join()/sep rather than a POSIX literal: the handler uses path.join, so the
      // separator is native. The hardcoded '.zitadel-mcp/keys/' failed every run on Windows.
      expect(result.content[0]!.text).toContain(join('.zitadel-mcp', 'keys') + sep);
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

  // zitadel_list_orgs removed (REM-22) — uses Admin API, violates least-privilege
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
        app: {
          name: 'My App',
          oidcConfig: { clientId: 'client-abc' },
        },
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

// ─── Hosted login translation handlers (Login V2) ─────────────────────────────

describe('hosted login translation handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_get_hosted_login_translation', () => {
    it('reads the merged effective file at org level by default and reports the key count', async () => {
      (ctx.client.request as any).mockResolvedValue({
        etag: 'abc',
        translations: { password: { errors: { couldNotCreateSessionForUser: 'x' } }, common: { back: 'Zurück' } },
      });

      const result = await LOGIN_TEXTS_HANDLERS['zitadel_get_hosted_login_translation']!({ locale: 'de' }, ctx);

      const [path] = (ctx.client.request as any).mock.calls[0];
      // org-scoped, effective (ignoreInheritance=false) by default
      expect(path).toContain('organizationId=org-789');
      expect(path).toContain('locale=de');
      expect(path).toContain('ignoreInheritance=false');
      expect(result.content[0]!.text).toContain('2 keys');
    });

    it('reports "no overrides" when onlyOverrides=true returns empty', async () => {
      (ctx.client.request as any).mockResolvedValue({ translations: {} });

      const result = await LOGIN_TEXTS_HANDLERS['zitadel_get_hosted_login_translation']!(
        { locale: 'de', onlyOverrides: true },
        ctx
      );

      expect((ctx.client.request as any).mock.calls[0][0]).toContain('ignoreInheritance=true');
      expect(result.content[0]!.text).toContain('No Login V2 text overrides');
    });
  });

  describe('zitadel_set_hosted_login_translation', () => {
    it('reads this level\'s own overrides, deep-merges the dot-path patch, and PUTs the result', async () => {
      // Existing override at this level (must be preserved).
      (ctx.client.request as any)
        .mockResolvedValueOnce({ translations: { loginname: { errors: { couldNotFindIdentityProvider: 'keep me' } } } })
        .mockResolvedValueOnce({ etag: 'new-etag' });

      const result = await LOGIN_TEXTS_HANDLERS['zitadel_set_hosted_login_translation']!(
        {
          locale: 'de',
          translations: {
            'password.errors.couldNotCreateSessionForUser': 'Benutzername oder Passwort falsch.',
            'loginname.errors.couldNotCreateSession': 'Benutzername oder Passwort falsch.',
          },
        },
        ctx
      );

      // 1st call: read only this level's overrides
      expect((ctx.client.request as any).mock.calls[0][0]).toContain('ignoreInheritance=true');

      // 2nd call: PUT merged body
      const [putPath, putOpts] = (ctx.client.request as any).mock.calls[1];
      expect(putPath).toBe('/v2/settings/hosted_login_translation');
      expect(putOpts.method).toBe('PUT');
      const body = JSON.parse(putOpts.body);
      expect(body.organizationId).toBe('org-789');
      expect(body.locale).toBe('de');
      // dot-paths expanded to nested
      expect(body.translations.password.errors.couldNotCreateSessionForUser).toBe('Benutzername oder Passwort falsch.');
      expect(body.translations.loginname.errors.couldNotCreateSession).toBe('Benutzername oder Passwort falsch.');
      // pre-existing override preserved (not clobbered)
      expect(body.translations.loginname.errors.couldNotFindIdentityProvider).toBe('keep me');

      expect(result.content[0]!.text).toContain('ORG-level');
    });

    it('targets the instance when level="instance"', async () => {
      (ctx.client.request as any)
        .mockResolvedValueOnce({ translations: {} })
        .mockResolvedValueOnce({ etag: 'e' });

      await LOGIN_TEXTS_HANDLERS['zitadel_set_hosted_login_translation']!(
        { locale: 'en', level: 'instance', translations: { 'password.errors.couldNotCreateSessionForUser': 'Incorrect username or password.' } },
        ctx
      );

      expect((ctx.client.request as any).mock.calls[0][0]).toContain('instance=true');
      const body = JSON.parse((ctx.client.request as any).mock.calls[1][1].body);
      expect(body.instance).toBe(true);
      expect(body.organizationId).toBeUndefined();
    });

    it('rejects an empty translations map', async () => {
      await expect(
        LOGIN_TEXTS_HANDLERS['zitadel_set_hosted_login_translation']!({ locale: 'de', translations: {} }, ctx)
      ).rejects.toThrow();
      expect((ctx.client.request as any).mock.calls.length).toBe(0);
    });
  });
});

// ─── Notification message text handlers ─────────────────────────────────────

describe('message text handlers', () => {
  let ctx: HandlerContext;

  beforeEach(() => {
    ctx = createMockContext();
  });

  describe('zitadel_get_message_text', () => {
    it('reads the org-level text via the Management API and marks overrides vs. inherited fields', async () => {
      (ctx.client.request as any).mockResolvedValue({
        customText: { subject: 'Ihr Code: {{.Code}}', isDefault: false },
      });

      const result = await MESSAGE_TEXT_HANDLERS['zitadel_get_message_text']!({ type: 'verifyemail', language: 'de' }, ctx);

      expect((ctx.client.request as any).mock.calls[0][0]).toBe('/management/v1/text/message/verifyemail/de');
      const text = result.content[0]!.text;
      expect(text).toContain('subject = Ihr Code: {{.Code}}  (override)');
      expect(text).toContain('text  (inherits)');
    });

    it('shows the inherited text when the level stores nothing', async () => {
      (ctx.client.request as any).mockResolvedValue({
        customText: { subject: 'Verify email', text: 'A new email has been added.', isDefault: true },
      });

      const result = await MESSAGE_TEXT_HANDLERS['zitadel_get_message_text']!(
        { type: 'verifyemail', language: 'en', level: 'instance' },
        ctx
      );

      expect((ctx.client.request as any).mock.calls[0][0]).toBe('/admin/v1/text/message/verifyemail/en');
      expect(result.content[0]!.text).toContain('No "verifyemail" message text overrides');
      expect(result.content[0]!.text).toContain('text = A new email has been added.');
    });

    it('rejects an unknown message type', async () => {
      await expect(
        MESSAGE_TEXT_HANDLERS['zitadel_get_message_text']!({ type: 'verify_email', language: 'de' }, ctx)
      ).rejects.toThrow();
      expect((ctx.client.request as any).mock.calls.length).toBe(0);
    });
  });

  describe('zitadel_set_message_text', () => {
    it('keeps this level\'s other overrides and PUTs the full row', async () => {
      (ctx.client.request as any)
        .mockResolvedValueOnce({ customText: { footerText: 'keep me', isDefault: false } })
        .mockResolvedValueOnce({});

      const result = await MESSAGE_TEXT_HANDLERS['zitadel_set_message_text']!(
        { type: 'verifyemail', language: 'de', subject: 'Ihr Bestätigungscode: {{.Code}}', buttonText: 'E-Mail-Adresse bestätigen' },
        ctx
      );

      const [putPath, putOpts] = (ctx.client.request as any).mock.calls[1];
      expect(putPath).toBe('/management/v1/text/message/verifyemail/de');
      expect(putOpts.method).toBe('PUT');
      const body = JSON.parse(putOpts.body);
      expect(body).toEqual({
        language: 'de',
        title: '',
        preHeader: '',
        subject: 'Ihr Bestätigungscode: {{.Code}}',
        greeting: '',
        text: '',
        buttonText: 'E-Mail-Adresse bestätigen',
        footerText: 'keep me',
      });
      expect(result.content[0]!.text).toContain('ORG-level');
    });

    it('never writes inherited text back as an override', async () => {
      (ctx.client.request as any)
        .mockResolvedValueOnce({ customText: { subject: 'Verify email', text: 'A new email has been added.', isDefault: true } })
        .mockResolvedValueOnce({});

      await MESSAGE_TEXT_HANDLERS['zitadel_set_message_text']!(
        { type: 'verifyemail', language: 'en', level: 'instance', greeting: 'Hello {{.DisplayName}},' },
        ctx
      );

      const [putPath, putOpts] = (ctx.client.request as any).mock.calls[1];
      expect(putPath).toBe('/admin/v1/text/message/verifyemail/en');
      const body = JSON.parse(putOpts.body);
      expect(body.greeting).toBe('Hello {{.DisplayName}},');
      expect(body.subject).toBe('');
      expect(body.text).toBe('');
    });

    it('clears a field when passed an empty string', async () => {
      (ctx.client.request as any)
        .mockResolvedValueOnce({ customText: { subject: 'old', text: 'keep', isDefault: false } })
        .mockResolvedValueOnce({});

      const result = await MESSAGE_TEXT_HANDLERS['zitadel_set_message_text']!(
        { type: 'verifyemail', language: 'de', subject: '' },
        ctx
      );

      const body = JSON.parse((ctx.client.request as any).mock.calls[1][1].body);
      expect(body.subject).toBe('');
      expect(body.text).toBe('keep');
      expect(result.content[0]!.text).toContain('subject  (cleared — inherits)');
    });

    it('rejects a call without any field', async () => {
      await expect(
        MESSAGE_TEXT_HANDLERS['zitadel_set_message_text']!({ type: 'verifyemail', language: 'de' }, ctx)
      ).rejects.toThrow();
      expect((ctx.client.request as any).mock.calls.length).toBe(0);
    });
  });
});
