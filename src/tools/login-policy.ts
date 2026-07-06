/**
 * Login-policy tools (2 tools)
 * Org-level login policy via Zitadel Management API v1 (/management/v1/policies/login).
 *
 * Scope note: this stays within the server's least-privilege stance (see auth/client.ts) —
 * it uses ONLY the org-scoped Management API and an ORG_OWNER service account, never the
 * Admin API (/admin/v1/policies/login = the instance default, which needs IAM_ADMIN). So it
 * toggles self-registration for the configured ZITADEL_ORG_ID, not the whole instance. For a
 * single-org instance that is effectively instance-wide; for a multi-org instance, run it once
 * per org. Enabling `allowRegister` is what lets invited users finish the registration step on
 * invite-accept (ZITADEL #11138).
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse } from '../types/tools.js';
import { logger } from '../utils/logger.js';

// ─── Shapes (subset of the Management API login policy) ──────────────────────

interface LoginPolicy {
  allowRegister?: boolean;
  allowUsernamePassword?: boolean;
  allowExternalIdp?: boolean;
  forceMfa?: boolean;
  forceMfaLocalOnly?: boolean;
  passwordlessType?: string;
  hidePasswordReset?: boolean;
  ignoreUnknownUsernames?: boolean;
  allowDomainDiscovery?: boolean;
  disableLoginWithEmail?: boolean;
  disableLoginWithPhone?: boolean;
  defaultRedirectUri?: string;
  passwordCheckLifetime?: unknown;
  externalLoginCheckLifetime?: unknown;
  mfaInitSkipLifetime?: unknown;
  secondFactorCheckLifetime?: unknown;
  multiFactorCheckLifetime?: unknown;
  /** true while the org inherits the instance default (no custom policy yet) */
  isDefault?: boolean;
}

interface LoginPolicyResponse {
  policy: LoginPolicy;
}

const LOGIN_POLICY_PATH = '/management/v1/policies/login';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const LOGIN_POLICY_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_get_login_policy',
    description:
      'Get the login policy of the current organization (ZITADEL_ORG_ID), including whether ' +
      'self-registration (allowRegister) is on and whether the policy is inherited from the ' +
      'instance default or a custom org policy.',
    inputSchema: { type: 'object', properties: {} },
    _meta: { readOnly: true, domain: 'organizations' },
    annotations: { title: 'Get Login Policy', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_set_self_registration',
    description:
      "Enable or disable self-registration (the login screen's \"Register\" option) for the " +
      'current organization, by setting allowRegister on its login policy. Idempotent: reads ' +
      'first and no-ops if already in the requested state. ORG-LEVEL — affects every app whose ' +
      'login resolves to this org, not a single application. If the org inherits the instance ' +
      'default, this creates a custom org policy seeded from the current effective settings.',
    inputSchema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean', description: 'Target state for allowRegister (default: true)' },
      },
    },
    _meta: { readOnly: false, domain: 'organizations' },
    annotations: { title: 'Set Self-Registration', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

const getLoginPolicyHandler: ToolHandler = async (_params, ctx) => {
  const res = await ctx.client.request<LoginPolicyResponse>(LOGIN_POLICY_PATH);
  const p = res.policy ?? {};
  const orgId = ctx.client.getConfig().orgId;

  const lines = [
    `Login policy for org ${orgId}:`,
    `Source: ${p.isDefault ? 'inherited instance default (no custom org policy yet)' : 'custom org policy'}`,
    `Self-registration (allowRegister): ${p.allowRegister ? 'ENABLED' : 'disabled'}`,
    `Username/password login: ${p.allowUsernamePassword ? 'enabled' : 'disabled'}`,
    `External IdP login: ${p.allowExternalIdp ? 'enabled' : 'disabled'}`,
    `Force MFA: ${p.forceMfa ? 'yes' : 'no'}`,
  ];

  return textResponse(lines.join('\n'));
};

const setSelfRegistrationHandler: ToolHandler = async (params, ctx) => {
  const { enabled } = z.object({ enabled: z.boolean().default(true) }).parse(params);
  const orgId = ctx.client.getConfig().orgId;

  // 1) Read the org's *effective* policy (returned even while inheriting the instance default).
  const current = await ctx.client.request<LoginPolicyResponse>(LOGIN_POLICY_PATH);
  const policy = current.policy ?? {};

  // 2) Idempotent no-op when already in the requested state.
  if (Boolean(policy.allowRegister) === enabled) {
    const source = policy.isDefault ? 'inherited from the instance default' : 'custom org policy';
    return textResponse(
      `No change: self-registration is already ${enabled ? 'ENABLED' : 'disabled'} for org ${orgId} (${source}).`
    );
  }

  // 3) Build the update body: flip allowRegister, preserve every other writable field from the
  //    effective policy (so creating a custom policy doesn't reset lifetimes/flags to zero).
  //    secondFactors/multiFactors/idps are managed by separate endpoints — omit them here.
  const body = {
    allowUsernamePassword: policy.allowUsernamePassword ?? true,
    allowRegister: enabled,
    allowExternalIdp: policy.allowExternalIdp ?? true,
    forceMfa: policy.forceMfa ?? false,
    forceMfaLocalOnly: policy.forceMfaLocalOnly ?? false,
    passwordlessType: policy.passwordlessType ?? 'PASSWORDLESS_TYPE_ALLOWED',
    hidePasswordReset: policy.hidePasswordReset ?? false,
    ignoreUnknownUsernames: policy.ignoreUnknownUsernames ?? false,
    allowDomainDiscovery: policy.allowDomainDiscovery ?? false,
    disableLoginWithEmail: policy.disableLoginWithEmail ?? false,
    disableLoginWithPhone: policy.disableLoginWithPhone ?? false,
    defaultRedirectUri: policy.defaultRedirectUri ?? '',
    passwordCheckLifetime: policy.passwordCheckLifetime,
    externalLoginCheckLifetime: policy.externalLoginCheckLifetime,
    mfaInitSkipLifetime: policy.mfaInitSkipLifetime,
    secondFactorCheckLifetime: policy.secondFactorCheckLifetime,
    multiFactorCheckLifetime: policy.multiFactorCheckLifetime,
  };

  // 4) No custom policy yet (inheriting default) → POST creates one; else PUT updates it.
  const method = policy.isDefault ? 'POST' : 'PUT';
  logger.info('Updating org login policy', { method, allowRegister: enabled });
  await ctx.client.request(LOGIN_POLICY_PATH, { method, body: JSON.stringify(body) });

  const action = policy.isDefault
    ? 'Created a custom login policy for this org (it previously inherited the instance default)'
    : 'Updated the existing custom org login policy';

  return textResponse(
    `Self-registration ${enabled ? 'ENABLED' : 'disabled'} for org ${orgId}.\n` +
    `${action}.\n\n` +
    `Impact: this is an ORG-level setting — the "Register" option now ${enabled ? 'appears' : 'is hidden'} ` +
    `on the login screen for EVERY application whose login resolves to this org, not just one app.`
  );
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const LOGIN_POLICY_HANDLERS: Record<string, ToolHandler> = {
  zitadel_get_login_policy: getLoginPolicyHandler,
  zitadel_set_self_registration: setSelfRegistrationHandler,
};
