/**
 * Notification message text tools (2 tools)
 * Customize the e-mails (and SMS) ZITADEL itself sends — "Verify Email", "Initialize User",
 * "Password Reset", … — via the Management API (org level) or the Admin API (instance level):
 * `/{management|admin}/v1/text/message/{type}/{language}`.
 *
 * ⚠️ Not the same as the login texts (login-texts.ts): those change the screens of the hosted
 * login; these change the notifications ZITADEL sends out. Both are needed to brand a sign-up
 * flow end to end.
 *
 * Why this matters: ZITADEL's shipped texts are generic English/German sentences such as
 * "A new email has been added. Please use the button below to verify your email." — sent
 * HTML-only, with a button to the ZITADEL domain. Corporate mail filters readily quarantine
 * that pattern while the relay reports the message as delivered.
 *
 * Inheritance: a message text has seven fields (title, preHeader, subject, greeting, text,
 * buttonText, footerText). Each field stored at a level overrides the same field one level up
 * (org → instance → shipped defaults); an empty field inherits. The read endpoint returns the
 * level's own row with empty fields for inherited ones, or — when the level stores nothing at
 * all — the inherited text flagged `isDefault: true`.
 *
 * Idempotency / safety: the PUT endpoint replaces the whole row, and ZITADEL removes every
 * field sent empty. SET therefore first reads this level's own overrides, merges the requested
 * fields in, and writes the result — so fields the caller does not mention keep their current
 * override (or keep inheriting), and an explicit "" clears a single field back to inheritance.
 *
 * Scope: defaults to the configured org (ORG_ID), like login-texts.ts. `level: "instance"`
 * targets the instance default for every org and needs an IAM-level grant.
 */

import { z } from 'zod';
import type { ToolDefinition, ToolHandler } from '../types/tools.js';
import { textResponse } from '../types/tools.js';
import { logger } from '../utils/logger.js';

// ─── Shapes ──────────────────────────────────────────────────────────────────

/** Message types, spelled as the API path segment. */
const MESSAGE_TYPES = [
  'init',
  'passwordreset',
  'verifyemail',
  'verifyphone',
  'verifysmsotp',
  'verifyemailotp',
  'domainclaimed',
  'passwordless_registration',
  'password_change',
  'invite_user',
] as const;

const FIELDS = ['title', 'preHeader', 'subject', 'greeting', 'text', 'buttonText', 'footerText'] as const;
type Field = (typeof FIELDS)[number];
type MessageFields = Partial<Record<Field, string>>;

interface MessageCustomText extends MessageFields {
  isDefault?: boolean;
}

interface MessageTextResponse {
  customText?: MessageCustomText;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function messageTextPath(level: 'organization' | 'instance', type: string, language: string): string {
  const api = level === 'instance' ? 'admin' : 'management';
  return `/${api}/v1/text/message/${type}/${encodeURIComponent(language)}`;
}

/** This level's own overrides: empty when the level stores nothing (isDefault) or a field is unset. */
function ownOverrides(text: MessageCustomText | undefined): MessageFields {
  if (!text || text.isDefault) return {};
  const out: MessageFields = {};
  for (const field of FIELDS) {
    if (text[field]) out[field] = text[field];
  }
  return out;
}

function scopeLabel(level: 'organization' | 'instance', orgId: string): string {
  return level === 'instance' ? 'instance' : `org ${orgId}`;
}

const levelSchema = z.enum(['organization', 'instance']).default('organization');
const typeSchema = z.enum(MESSAGE_TYPES);
const languageSchema = z.string().min(2).max(35);

const TYPE_DESCRIPTION =
  'Message type as the API spells it: ' + MESSAGE_TYPES.map((t) => `"${t}"`).join(', ') +
  '. Self-registration with Login V2 sends "verifyemail"; a user created without a password gets "init"; ' +
  'an invite code sends "invite_user".';

// ─── Tool Definitions ────────────────────────────────────────────────────────

export const MESSAGE_TEXT_TOOLS: ToolDefinition[] = [
  {
    name: 'zitadel_get_message_text',
    description:
      'Read the text of a notification ZITADEL sends (e.g. the "Verify Email" e-mail) for one ' +
      'language. Shows, per field, whether this level overrides it or inherits it; when the level ' +
      'stores nothing, shows the inherited text. Defaults to the configured org; pass ' +
      'level:"instance" for the instance default. Not the login screens — see ' +
      'zitadel_get_hosted_login_translation for those.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...MESSAGE_TYPES], description: TYPE_DESCRIPTION },
        language: { type: 'string', description: 'Language code, e.g. "de" or "en".' },
        level: { type: 'string', enum: ['organization', 'instance'], description: 'Scope to read: "organization" (default, the configured ORG_ID) or "instance".' },
      },
      required: ['type', 'language'],
    },
    _meta: { readOnly: true, domain: 'organizations' },
    annotations: { title: 'Get Message Text', readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  },
  {
    name: 'zitadel_set_message_text',
    description:
      'Override fields of a notification text ZITADEL sends (e.g. the "Verify Email" e-mail) ' +
      'for one language. Pass only the fields to change — the tool reads this level\'s existing ' +
      'overrides, merges yours in and writes the result, so other fields keep their override or ' +
      'keep inheriting (idempotent). An explicit "" clears that field back to inheritance. ' +
      'Fields accept Go-template placeholders such as {{.Code}}, {{.DisplayName}}, ' +
      '{{.FirstName}}, {{.LastName}}, {{.PreferredLoginName}}; the button links to {{.URL}} on ' +
      'its own. Defaults to the configured org (ORG-LEVEL — every user of this org gets it); ' +
      'pass level:"instance" for the instance default (needs an IAM-level grant). One language ' +
      'per call; ZITADEL picks the language from the user\'s preferredLanguage.',
    inputSchema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: [...MESSAGE_TYPES], description: TYPE_DESCRIPTION },
        language: { type: 'string', description: 'Language code to write, e.g. "de" or "en".' },
        title: { type: 'string', description: 'Heading inside the e-mail.' },
        preHeader: { type: 'string', description: 'Preview line most mail clients show after the subject.' },
        subject: { type: 'string', description: 'E-mail subject.' },
        greeting: { type: 'string', description: 'Salutation line, e.g. "Hallo {{.DisplayName}},".' },
        text: { type: 'string', description: 'Body text.' },
        buttonText: { type: 'string', description: 'Label of the call-to-action button (links to {{.URL}}).' },
        footerText: { type: 'string', description: 'Footer line.' },
        level: { type: 'string', enum: ['organization', 'instance'], description: 'Scope to write: "organization" (default) or "instance".' },
      },
      required: ['type', 'language'],
    },
    _meta: { readOnly: false, domain: 'organizations' },
    annotations: { title: 'Set Message Text', readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

// ─── Handlers ────────────────────────────────────────────────────────────────

const getMessageTextHandler: ToolHandler = async (params, ctx) => {
  const { type, language, level } = z
    .object({ type: typeSchema, language: languageSchema, level: levelSchema })
    .parse(params);

  const orgId = ctx.client.getConfig().orgId;
  const scope = scopeLabel(level, orgId);
  const res = await ctx.client.request<MessageTextResponse>(messageTextPath(level, type, language));
  const text = res.customText ?? {};

  if (text.isDefault) {
    const body = FIELDS.map((f) => `  ${f} = ${text[f] ?? ''}`).join('\n');
    return textResponse(
      `No "${type}" message text overrides stored at ${scope} level for language "${language}". ` +
      `Inherited text:\n${body}`
    );
  }

  const body = FIELDS.map((f) => (text[f] ? `  ${f} = ${text[f]}  (override)` : `  ${f}  (inherits)`)).join('\n');
  return textResponse(`"${type}" message text at ${scope} level, language "${language}":\n${body}`);
};

const setMessageTextHandler: ToolHandler = async (params, ctx) => {
  const fieldSchema = z.string().max(40000).optional();
  const parsed = z
    .object({
      type: typeSchema,
      language: languageSchema,
      level: levelSchema,
      title: fieldSchema,
      preHeader: fieldSchema,
      subject: fieldSchema,
      greeting: fieldSchema,
      text: fieldSchema,
      buttonText: fieldSchema,
      footerText: fieldSchema,
    })
    .parse(params);
  const { type, language, level } = parsed;

  const patch: MessageFields = {};
  for (const field of FIELDS) {
    if (parsed[field] !== undefined) patch[field] = parsed[field];
  }
  const changed = Object.keys(patch) as Field[];
  if (changed.length === 0) {
    throw new Error(`Pass at least one of: ${FIELDS.join(', ')}.`);
  }

  const orgId = ctx.client.getConfig().orgId;
  const scope = scopeLabel(level, orgId);
  const path = messageTextPath(level, type, language);

  // The PUT replaces the whole row, so start from this level's own overrides — never from the
  // inherited text, which would freeze the defaults into an override.
  const existing = await ctx.client.request<MessageTextResponse>(path);
  const merged: MessageFields = { ...ownOverrides(existing.customText), ...patch };
  const body: Record<string, string> = { language };
  for (const field of FIELDS) body[field] = merged[field] ?? '';

  logger.info('Setting message text', { level, type, language, fields: changed.length });
  await ctx.client.request(path, { method: 'PUT', body: JSON.stringify(body) });

  const summary = changed.map((f) => (patch[f] ? `  ${f} = ${patch[f]}` : `  ${f}  (cleared — inherits)`)).join('\n');
  return textResponse(
    `Updated ${changed.length} field(s) of the "${type}" message text at ${scope} level for language "${language}":\n` +
    `${summary}\n\n` +
    `Impact: ${level === 'instance' ? 'INSTANCE-level — the default for every org on this instance.' : 'ORG-level — every user of this org gets it.'}\n` +
    `Changes apply to the next notification sent. Verify by triggering the real flow, ` +
    `e.g. a registration with a fresh address.`
  );
};

// ─── Export ──────────────────────────────────────────────────────────────────

export const MESSAGE_TEXT_HANDLERS: Record<string, ToolHandler> = {
  zitadel_get_message_text: getMessageTextHandler,
  zitadel_set_message_text: setMessageTextHandler,
};
