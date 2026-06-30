/**
 * Tests for the SSO/RBAC additions: two-role vocabulary, v2 authorization writes,
 * org-manager tools, and the atomic provision_user / offboard_user flows.
 */

import { describe, it, expect, vi } from 'vitest';
import type { HandlerContext } from '../types/tools.js';
import type { ZitadelConfig } from '../utils/config.js';
import { isRbacRoleSet, nonStandardRoles, RBAC_PROJECT_ROLES } from '../utils/rbac.js';
import { ROLE_HANDLERS } from '../tools/roles.js';
import { ORG_MEMBER_HANDLERS } from '../tools/org-members.js';
import { PROVISIONING_HANDLERS } from '../tools/provisioning.js';

const PROJECT = 'proj-001';
const ORG = 'org-789';

type Dispatch = (path: string, method: string, body: any) => any;

function ctxWith(dispatch: Dispatch): HandlerContext {
  const config = {
    issuer: 'https://test.zitadel.cloud',
    serviceAccountUserId: 'sa-123',
    serviceAccountKeyId: 'key-456',
    serviceAccountPrivateKey: 'dGVzdA==',
    orgId: ORG,
    projectId: PROJECT,
    logLevel: 'ERROR',
  } as ZitadelConfig;

  const request = vi.fn((path: string, opts: any = {}) => {
    const method = opts.method || 'GET';
    const body = opts.body ? JSON.parse(opts.body) : undefined;
    try {
      return Promise.resolve(dispatch(path, method, body));
    } catch (e) {
      return Promise.reject(e); // mirror the real client (rejected promise, not sync throw)
    }
  });

  const client = { request, getConfig: () => config, clearTokenCache: vi.fn() };
  return { client: client as any, config };
}

// Convenience matchers
const isRoleSearch = (p: string) => p.includes('/roles/_search') && p.includes('/projects/');
const isGrantSearch = (p: string) => p === '/management/v1/users/grants/_search';
const isMemberSearch = (p: string) => p === '/management/v1/orgs/me/members/_search';

// ─── rbac vocabulary ──────────────────────────────────────────────────────────

describe('rbac vocabulary', () => {
  it('RBAC_PROJECT_ROLES is exactly admin + standard', () => {
    expect([...RBAC_PROJECT_ROLES]).toEqual(['admin', 'standard']);
  });
  it('isRbacRoleSet accepts admin/standard, rejects app:* drift', () => {
    expect(isRbacRoleSet(['admin'])).toBe(true);
    expect(isRbacRoleSet(['standard'])).toBe(true);
    expect(isRbacRoleSet(['admin', 'app:finance'])).toBe(false);
  });
  it('nonStandardRoles surfaces drift keys', () => {
    expect(nonStandardRoles(['admin', 'app:finance', 'standard'])).toEqual(['app:finance']);
  });
});

// ─── roles: v2 authorization write + drift warning ────────────────────────────

describe('zitadel_create_user_grant (v2 authorization)', () => {
  it('writes via POST /v2/authorizations and returns the authorization id', async () => {
    const ctx = ctxWith((path, _m, _b) => {
      if (isRoleSearch(path)) return { result: [{ key: 'admin' }, { key: 'standard' }] };
      if (path === '/v2/authorizations') return { id: 'auth-99' };
      throw new Error(`unmocked ${path}`);
    });
    const res = await ROLE_HANDLERS['zitadel_create_user_grant']!({ userId: 'u1', roleKeys: ['admin'] }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toContain('auth-99');
    const calls = (ctx.client.request as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('/v2/authorizations');
  });

  it('falls back to v1 user grants when v2 /v2/authorizations is 404', async () => {
    const ctx = ctxWith((path, method) => {
      if (isRoleSearch(path)) return { result: [{ key: 'admin' }, { key: 'standard' }] };
      if (path === '/v2/authorizations') throw Object.assign(new Error('not found'), { status: 404 });
      if (path === '/management/v1/users/u1/grants' && method === 'POST') return { userGrantId: 'grant-v1' };
      throw new Error(`unmocked ${path}`);
    });
    const res = await ROLE_HANDLERS['zitadel_create_user_grant']!({ userId: 'u1', roleKeys: ['standard'] }, ctx);
    expect(res.isError).toBeFalsy();
    expect(res.content[0]!.text).toContain('grant-v1');
    const calls = (ctx.client.request as any).mock.calls.map((c: any[]) => c[0]);
    expect(calls).toContain('/v2/authorizations'); // tried v2 first
    expect(calls).toContain('/management/v1/users/u1/grants'); // then fell back to v1
  });

  it('flags drift when granting a non-standard role key', async () => {
    const ctx = ctxWith((path) => {
      if (isRoleSearch(path)) return { result: [{ key: 'admin' }, { key: 'app:finance' }] };
      if (path === '/v2/authorizations') return { id: 'auth-1' };
      throw new Error(`unmocked ${path}`);
    });
    const res = await ROLE_HANDLERS['zitadel_create_user_grant']!({ userId: 'u1', roleKeys: ['app:finance'] }, ctx);
    expect(res.content[0]!.text).toContain('Drift');
    expect(res.content[0]!.text).toContain('app:finance');
  });
});

// ─── org-members ──────────────────────────────────────────────────────────────

describe('zitadel_grant_org_manager', () => {
  it('adds a new member with default ORG_USER_MANAGER', async () => {
    const ctx = ctxWith((path, method) => {
      if (isMemberSearch(path)) return { result: [] }; // not a member yet
      if (path === '/management/v1/orgs/me/members' && method === 'POST') return { details: {} };
      throw new Error(`unmocked ${path} ${method}`);
    });
    const res = await ORG_MEMBER_HANDLERS['zitadel_grant_org_manager']!({ userId: 'u1' }, ctx);
    expect(res.content[0]!.text).toContain('ORG_USER_MANAGER');
    const addCall = (ctx.client.request as any).mock.calls.find((c: any[]) => c[0] === '/management/v1/orgs/me/members');
    expect(JSON.parse(addCall[1].body)).toEqual({ userId: 'u1', roles: ['ORG_USER_MANAGER'] });
  });

  it('is idempotent: no change when the role is already held', async () => {
    const ctx = ctxWith((path) => {
      if (isMemberSearch(path)) return { result: [{ userId: 'u1', roles: ['ORG_USER_MANAGER'] }] };
      throw new Error(`unmocked ${path}`);
    });
    const res = await ORG_MEMBER_HANDLERS['zitadel_grant_org_manager']!({ userId: 'u1' }, ctx);
    expect(res.content[0]!.text).toContain('No change');
    // Only the search should run — no AddOrgMember (POST .../members) and no UpdateOrgMember (PUT).
    const mutations = (ctx.client.request as any).mock.calls.filter(
      (c: any[]) => c[0] === '/management/v1/orgs/me/members' || c[1]?.method === 'PUT'
    );
    expect(mutations.length).toBe(0);
  });

  it('merges roles via PUT for an existing member', async () => {
    const ctx = ctxWith((path, method) => {
      if (isMemberSearch(path)) return { result: [{ userId: 'u1', roles: ['ORG_USER_MANAGER'] }] };
      if (path === '/management/v1/orgs/me/members/u1' && method === 'PUT') return {};
      throw new Error(`unmocked ${path} ${method}`);
    });
    const res = await ORG_MEMBER_HANDLERS['zitadel_grant_org_manager']!({ userId: 'u1', roles: ['ORG_OWNER'] }, ctx);
    const putCall = (ctx.client.request as any).mock.calls.find((c: any[]) => c[1]?.method === 'PUT');
    expect(JSON.parse(putCall[1].body).roles).toEqual(expect.arrayContaining(['ORG_USER_MANAGER', 'ORG_OWNER']));
    expect(res.content[0]!.text).toContain('ORG_OWNER');
  });
});

describe('zitadel_revoke_org_manager', () => {
  it('blocks removing the last ORG_OWNER', async () => {
    const ctx = ctxWith((path, _m, body) => {
      if (isMemberSearch(path)) {
        // getOrgMember(u1) -> filtered by userId; owners list -> all owners
        const byUser = body?.queries?.some((q: any) => q.userIdQuery);
        if (byUser) return { result: [{ userId: 'u1', roles: ['ORG_OWNER'] }] };
        return { result: [{ userId: 'u1', roles: ['ORG_OWNER'] }] }; // only one owner
      }
      throw new Error(`unmocked ${path}`);
    });
    const res = await ORG_MEMBER_HANDLERS['zitadel_revoke_org_manager']!({ userId: 'u1', confirm: true }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('last ORG_OWNER');
    // No DELETE should have happened
    const deletes = (ctx.client.request as any).mock.calls.filter((c: any[]) => c[1]?.method === 'DELETE');
    expect(deletes.length).toBe(0);
  });

  it('previews without confirm', async () => {
    const ctx = ctxWith((path) => {
      if (isMemberSearch(path)) return { result: [{ userId: 'u1', roles: ['ORG_USER_MANAGER'] }] };
      throw new Error(`unmocked ${path}`);
    });
    const res = await ORG_MEMBER_HANDLERS['zitadel_revoke_org_manager']!({ userId: 'u1' }, ctx);
    expect(res.content[0]!.text).toContain('CONFIRM');
  });

  it('removes membership with confirm when more than one owner exists', async () => {
    const ctx = ctxWith((path, method, body) => {
      if (isMemberSearch(path)) {
        const byUser = body?.queries?.some((q: any) => q.userIdQuery);
        if (byUser) return { result: [{ userId: 'u1', roles: ['ORG_USER_MANAGER'] }] };
        return { result: [{ userId: 'owner-a', roles: ['ORG_OWNER'] }, { userId: 'owner-b', roles: ['ORG_OWNER'] }] };
      }
      if (path === '/management/v1/orgs/me/members/u1' && method === 'DELETE') return {};
      throw new Error(`unmocked ${path} ${method}`);
    });
    const res = await ORG_MEMBER_HANDLERS['zitadel_revoke_org_manager']!({ userId: 'u1', confirm: true }, ctx);
    expect(res.content[0]!.text).toContain('Removed org manager membership');
  });
});

// ─── provision_user ───────────────────────────────────────────────────────────

describe('zitadel_provision_user', () => {
  it('errors when the requested role is not defined in the project', async () => {
    const ctx = ctxWith((path) => {
      if (isRoleSearch(path)) return { result: [{ key: 'admin' }] }; // no 'standard'
      throw new Error(`unmocked ${path}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_provision_user']!(
      { email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'standard' },
      ctx
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('not defined in project');
  });

  it('rejects a role outside the two-role vocabulary at the schema level', async () => {
    const ctx = ctxWith(() => ({}));
    await expect(
      PROVISIONING_HANDLERS['zitadel_provision_user']!(
        { email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'app:finance' },
        ctx
      )
    ).rejects.toThrow();
  });

  it('creates user + standard role (no manager) and returns structured result', async () => {
    const ctx = ctxWith((path, method) => {
      if (isRoleSearch(path)) return { result: [{ key: 'admin' }, { key: 'standard' }] };
      if (path === '/v2/users' && method === 'POST') return { result: [] }; // findUserByEmail: none
      if (path === '/v2/users/human' && method === 'POST') return { userId: 'newU' };
      if (isGrantSearch(path)) return { result: [] };
      if (path === '/v2/authorizations' && method === 'POST') return { id: 'auth-new' };
      throw new Error(`unmocked ${path} ${method}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_provision_user']!(
      { email: 'a@b.com', firstName: 'A', lastName: 'B', role: 'standard' },
      ctx
    );
    const text = res.content[0]!.text;
    expect(text).toContain('"zitadelUserId": "newU"');
    expect(text).toContain('"role": "standard"');
    expect(text).toContain('"authorizationId": "auth-new"');
    // standard role must NOT trigger an org-manager add
    const memberPosts = (ctx.client.request as any).mock.calls.filter(
      (c: any[]) => c[0] === '/management/v1/orgs/me/members'
    );
    expect(memberPosts.length).toBe(0);
  });

  it('admin role also grants ORG_USER_MANAGER by default', async () => {
    const ctx = ctxWith((path, method) => {
      if (isRoleSearch(path)) return { result: [{ key: 'admin' }, { key: 'standard' }] };
      if (path === '/v2/users' && method === 'POST') return { result: [] };
      if (path === '/v2/users/human' && method === 'POST') return { userId: 'adminU' };
      if (isGrantSearch(path)) return { result: [] };
      if (path === '/v2/authorizations' && method === 'POST') return { id: 'auth-admin' };
      if (isMemberSearch(path)) return { result: [] };
      if (path === '/management/v1/orgs/me/members' && method === 'POST') return { details: {} };
      throw new Error(`unmocked ${path} ${method}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_provision_user']!(
      { email: 'admin@b.com', firstName: 'Ad', lastName: 'Min', role: 'admin' },
      ctx
    );
    expect(res.content[0]!.text).toContain('ORG_USER_MANAGER');
    const addCall = (ctx.client.request as any).mock.calls.find((c: any[]) => c[0] === '/management/v1/orgs/me/members');
    expect(JSON.parse(addCall[1].body).roles).toEqual(['ORG_USER_MANAGER']);
  });

  it('is idempotent: reuses an existing user + existing role + existing manager grant', async () => {
    const ctx = ctxWith((path, method, body) => {
      if (isRoleSearch(path)) return { result: [{ key: 'admin' }, { key: 'standard' }] };
      if (path === '/v2/users' && method === 'POST')
        return { result: [{ userId: 'U1', human: { email: { email: 'admin@b.com' } } }] };
      if (isGrantSearch(path))
        return { result: [{ id: 'g1', userId: 'U1', projectId: PROJECT, roleKeys: ['admin'], state: 'USER_GRANT_STATE_ACTIVE' }] };
      if (isMemberSearch(path)) return { result: [{ userId: 'U1', roles: ['ORG_USER_MANAGER'] }] };
      throw new Error(`unmocked ${path} ${method} ${JSON.stringify(body)}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_provision_user']!(
      { email: 'admin@b.com', firstName: 'Ad', lastName: 'Min', role: 'admin' },
      ctx
    );
    const text = res.content[0]!.text;
    expect(text).toContain('"createdUser": false');
    expect(text).toContain('"createdAuthorization": false');
    expect(text).toContain('"authorizationId": "g1"');
    // No create-user, no authorization, no member POST should occur
    const calls = (ctx.client.request as any).mock.calls.map((c: any[]) => `${c[1]?.method || 'GET'} ${c[0]}`);
    expect(calls).not.toContain('POST /v2/users/human');
    expect(calls).not.toContain('POST /v2/authorizations');
    expect(calls).not.toContain('POST /management/v1/orgs/me/members');
  });
});

// ─── offboard_user ────────────────────────────────────────────────────────────

describe('zitadel_offboard_user', () => {
  it('blocks self-demotion', async () => {
    const ctx = ctxWith((path) => {
      if (path === '/v2/users/U1') return { user: { userId: 'U1', username: 'u', human: { profile: { givenName: 'A', familyName: 'B' } } } };
      throw new Error(`unmocked ${path}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_offboard_user']!(
      { userId: 'U1', actingUserId: 'U1', confirm: true },
      ctx
    );
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('self-offboard');
  });

  it('blocks removing the last Admin', async () => {
    const ctx = ctxWith((path, _m, body) => {
      if (path === '/v2/users/U1') return { user: { userId: 'U1', username: 'u', human: { profile: { givenName: 'A', familyName: 'B' } } } };
      if (isGrantSearch(path)) {
        const byRole = body?.queries?.some((q: any) => q.roleKeyQuery);
        if (byRole) return { result: [{ id: 'g1', userId: 'U1', roleKeys: ['admin'], state: 'USER_GRANT_STATE_ACTIVE' }] }; // only U1
        return { result: [{ id: 'g1', userId: 'U1', projectId: PROJECT, roleKeys: ['admin'], state: 'USER_GRANT_STATE_ACTIVE' }] };
      }
      if (isMemberSearch(path)) return { result: [] };
      throw new Error(`unmocked ${path}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_offboard_user']!({ userId: 'U1', confirm: true }, ctx);
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toContain('last Admin');
  });

  it('previews actions without confirm', async () => {
    const ctx = ctxWith((path, _m, body) => {
      if (path === '/v2/users/U2') return { user: { userId: 'U2', username: 'u2', human: { profile: { givenName: 'C', familyName: 'D' } } } };
      if (isGrantSearch(path)) {
        const byRole = body?.queries?.some((q: any) => q.roleKeyQuery);
        if (byRole) return { result: [{ userId: 'U2' }, { userId: 'other' }] };
        return { result: [{ id: 'g2', userId: 'U2', projectId: PROJECT, roleKeys: ['standard'], state: 'USER_GRANT_STATE_ACTIVE' }] };
      }
      if (isMemberSearch(path)) return { result: [] };
      throw new Error(`unmocked ${path}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_offboard_user']!({ userId: 'U2' }, ctx);
    expect(res.content[0]!.text).toContain('CONFIRM');
    expect(res.content[0]!.text).toContain('deactivate');
  });

  it('executes: removes grant and deactivates with confirm', async () => {
    const calls: string[] = [];
    const ctx = ctxWith((path, method, body) => {
      calls.push(`${method} ${path}`);
      if (path === '/v2/users/U2') return { user: { userId: 'U2', username: 'u2', human: { profile: { givenName: 'C', familyName: 'D' } } } };
      if (isGrantSearch(path)) {
        const byRole = body?.queries?.some((q: any) => q.roleKeyQuery);
        if (byRole) return { result: [{ userId: 'U2' }, { userId: 'other' }] };
        return { result: [{ id: 'g2', userId: 'U2', projectId: PROJECT, roleKeys: ['standard'], state: 'USER_GRANT_STATE_ACTIVE' }] };
      }
      if (isMemberSearch(path)) return { result: [] }; // not a manager
      if (path === '/management/v1/users/U2/grants/g2' && method === 'DELETE') return {};
      if (path === '/v2/users/U2/deactivate' && method === 'POST') return {};
      throw new Error(`unmocked ${path} ${method}`);
    });
    const res = await PROVISIONING_HANDLERS['zitadel_offboard_user']!({ userId: 'U2', confirm: true }, ctx);
    expect(res.content[0]!.text).toContain('offboarded');
    expect(calls).toContain('DELETE /management/v1/users/U2/grants/g2');
    expect(calls).toContain('POST /v2/users/U2/deactivate');
  });
});
