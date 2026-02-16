/**
 * Tool registry tests — ensures all tools are properly defined and wired
 */

import { describe, it, expect } from 'vitest';
import { USER_TOOLS, USER_HANDLERS } from '../tools/users.js';
import { PROJECT_TOOLS, PROJECT_HANDLERS } from '../tools/projects.js';
import { APPLICATION_TOOLS, APPLICATION_HANDLERS } from '../tools/applications.js';
import { ROLE_TOOLS, ROLE_HANDLERS } from '../tools/roles.js';
import { SERVICE_ACCOUNT_TOOLS, SERVICE_ACCOUNT_HANDLERS } from '../tools/service-accounts.js';
import { ORG_TOOLS, ORG_HANDLERS } from '../tools/organizations.js';
import { UTILITY_TOOLS, UTILITY_HANDLERS } from '../tools/utility.js';
import { PORTAL_TOOLS, PORTAL_HANDLERS } from '../tools/portal.js';
import type { ToolDefinition } from '../types/tools.js';

const ALL_MODULES = [
  { name: 'users', tools: USER_TOOLS, handlers: USER_HANDLERS },
  { name: 'projects', tools: PROJECT_TOOLS, handlers: PROJECT_HANDLERS },
  { name: 'applications', tools: APPLICATION_TOOLS, handlers: APPLICATION_HANDLERS },
  { name: 'roles', tools: ROLE_TOOLS, handlers: ROLE_HANDLERS },
  { name: 'service-accounts', tools: SERVICE_ACCOUNT_TOOLS, handlers: SERVICE_ACCOUNT_HANDLERS },
  { name: 'organizations', tools: ORG_TOOLS, handlers: ORG_HANDLERS },
  { name: 'utility', tools: UTILITY_TOOLS, handlers: UTILITY_HANDLERS },
  { name: 'portal', tools: PORTAL_TOOLS, handlers: PORTAL_HANDLERS },
];

describe('tool registry', () => {
  it('has 25 total tools', () => {
    const total = ALL_MODULES.reduce((sum, m) => sum + m.tools.length, 0);
    expect(total).toBe(25);
  });

  it('has no duplicate tool names', () => {
    const names = ALL_MODULES.flatMap(m => m.tools.map(t => t.name));
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  for (const mod of ALL_MODULES) {
    describe(`${mod.name} module`, () => {
      it('every tool has a matching handler', () => {
        for (const tool of mod.tools) {
          expect(mod.handlers[tool.name], `missing handler for ${tool.name}`).toBeDefined();
          expect(typeof mod.handlers[tool.name]).toBe('function');
        }
      });

      it('every handler has a matching tool definition', () => {
        const toolNames = new Set(mod.tools.map(t => t.name));
        for (const handlerName of Object.keys(mod.handlers)) {
          expect(toolNames.has(handlerName), `orphaned handler: ${handlerName}`).toBe(true);
        }
      });
    });
  }
});

describe('tool definitions', () => {
  const allTools: ToolDefinition[] = ALL_MODULES.flatMap(m => m.tools);

  for (const tool of allTools) {
    describe(`${tool.name}`, () => {
      it('has a non-empty name', () => {
        expect(tool.name.length).toBeGreaterThan(0);
      });

      it('has a non-empty description', () => {
        expect(tool.description.length).toBeGreaterThan(0);
      });

      it('has an inputSchema with type "object"', () => {
        expect(tool.inputSchema['type']).toBe('object');
      });

      it('has _meta with a domain', () => {
        expect(tool._meta).toBeDefined();
        expect(tool._meta!.domain).toBeTruthy();
      });

      it('has annotations', () => {
        expect(tool.annotations).toBeDefined();
        expect(tool.annotations!.title).toBeTruthy();
        expect(typeof tool.annotations!.readOnlyHint).toBe('boolean');
        expect(typeof tool.annotations!.destructiveHint).toBe('boolean');
      });

      it('read-only tools are not marked destructive', () => {
        if (tool.annotations?.readOnlyHint) {
          expect(tool.annotations.destructiveHint).toBe(false);
        }
      });
    });
  }
});
