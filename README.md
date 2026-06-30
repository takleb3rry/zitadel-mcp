# Zitadel MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for [Zitadel](https://zitadel.com/) identity management. Manage users, projects, applications, roles, and service accounts through natural language from AI tools like Claude Code.

> *"Provision jane@example.com as an Admin."*
> — One tool call: creates the user, assigns the `admin` project role (v2 authorization), and grants `ORG_USER_MANAGER` so she can manage other users — no Super Admin required.

## Tools (33)

| Category | Tool | Description |
|----------|------|-------------|
| **Users** | `zitadel_list_users` | List/search users |
| | `zitadel_get_user` | Get user details |
| | `zitadel_create_user` | Create user (sends invite email; optional client-supplied `userId`) |
| | `zitadel_deactivate_user` | Deactivate user |
| | `zitadel_reactivate_user` | Reactivate user |
| | `zitadel_lock_user` | Lock user |
| | `zitadel_unlock_user` | Unlock user |
| | `zitadel_delete_user` | Permanently delete user |
| **Projects** | `zitadel_list_projects` | List projects |
| | `zitadel_get_project` | Get project details |
| | `zitadel_create_project` | Create project |
| **Applications** | `zitadel_list_apps` | List apps in a project |
| | `zitadel_get_app` | Get app details + Client ID |
| | `zitadel_create_oidc_app` | Create OIDC application |
| | `zitadel_update_app` | Update app (redirect URIs, etc.) |
| **Roles** | `zitadel_list_project_roles` | List roles in a project |
| | `zitadel_create_project_role` | Create a role (standardized: `admin`/`standard`) |
| | `zitadel_list_user_grants` | List user's role grants |
| | `zitadel_create_user_grant` | Assign project roles (v2 authorization; flags off-vocabulary drift) |
| | `zitadel_remove_user_grant` | Remove role grant |
| **Org Managers** | `zitadel_list_org_manager_roles` | List supported manager roles (ORG_OWNER, ORG_USER_MANAGER, …) |
| | `zitadel_list_org_managers` | List who holds manager grants (filter by role) |
| | `zitadel_grant_org_manager` | Grant manager role(s) (default `ORG_USER_MANAGER`); idempotent |
| | `zitadel_revoke_org_manager` | Revoke manager role(s); guards the last `ORG_OWNER` |
| **Provisioning** | `zitadel_provision_user` | Atomic + idempotent: create user + assign `admin`/`standard` + (for Admins) `ORG_USER_MANAGER` |
| | `zitadel_offboard_user` | Remove role + revoke manager + deactivate; guards last-Admin & self-demotion |
| **Service Accounts** | `zitadel_create_service_user` | Create machine user |
| | `zitadel_create_service_user_key` | Generate key pair |
| | `zitadel_list_service_user_keys` | List keys (metadata only) |
| **Organizations** | `zitadel_get_org` | Get current org details |
| **Utility** | `zitadel_get_auth_config` | Get .env.local template for an app |
| **Portal** | `portal_register_app` | Register app in portal DB |
| | `portal_setup_full_app` | One-click: Zitadel + portal setup |

Portal tools (`portal_*`) are only available when `PORTAL_DATABASE_URL` is configured.

### Two-role model & no-super-admin (Renewal Initiatives SSO)

The provisioning tools implement a standardized RBAC model for the core apps:

- **Two project (business) roles only:** `admin` and `standard` — these land in the OIDC token and gate what a user can do in the apps. The provisioning tools refuse any other key to prevent drift.
- **No Super Admin:** every Admin also receives an org-level `ORG_USER_MANAGER` grant (a *manager* role — administers Zitadel itself, not in the token), so any Admin can create/manage any user, including other Admins. Keep ≥2 `ORG_OWNER` break-glass accounts for org configuration.
- **Role assignment prefers the v2 `AuthorizationService`** (`POST /v2/authorizations`) and **automatically falls back to v1 user-grants** if that endpoint is unavailable on the instance (some Zitadel Cloud versions return 404). Org-manager grants use the Management v1 org-member API.

## Prerequisites

1. A Zitadel instance (Cloud or self-hosted)
2. A service account with **Org Owner** or **IAM Admin** role
3. A JSON key for the service account

### Creating a Service Account

1. In the Zitadel Console, go to **Users** > **Service Users** > **New**
2. Give it a name (e.g., `mcp-admin`) and select **Bearer** token type
3. Go to the service user's **Keys** tab > **New** > **JSON**
4. Save the downloaded key file — you'll need the `userId`, `keyId`, and base64-encoded `key`
5. Grant the service account the **Org Owner** role under **Organization** > **Authorizations**

## Setup

```bash
git clone https://github.com/takleb3rry/zitadel-mcp.git
cd zitadel-mcp
npm install
npm run build
```

## Configuration

Add the server to your MCP client config. The JSON block below works for both options:

- **Global** (all projects): `~/.claude.json` under the `"mcpServers"` key
- **Per-project**: `.mcp.json` in the project root

```json
{
  "mcpServers": {
    "zitadel": {
      "command": "node",
      "args": ["/path/to/zitadel-mcp/build/index.js"],
      "env": {
        "ZITADEL_ISSUER": "https://your-instance.zitadel.cloud",
        "ZITADEL_SERVICE_ACCOUNT_USER_ID": "...",
        "ZITADEL_SERVICE_ACCOUNT_KEY_ID": "...",
        "ZITADEL_SERVICE_ACCOUNT_PRIVATE_KEY": "...",
        "ZITADEL_ORG_ID": "...",
        "ZITADEL_PROJECT_ID": "..."
      }
    }
  }
}
```

Restart Claude Code after adding the config. The Zitadel tools will appear automatically.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZITADEL_ISSUER` | Yes | Zitadel instance URL |
| `ZITADEL_SERVICE_ACCOUNT_USER_ID` | Yes | Service account user ID |
| `ZITADEL_SERVICE_ACCOUNT_KEY_ID` | Yes | Key ID from the JSON key file |
| `ZITADEL_SERVICE_ACCOUNT_PRIVATE_KEY` | Yes | Base64-encoded RSA private key (the `key` field from the downloaded JSON) |
| `ZITADEL_ORG_ID` | Yes | Organization ID |
| `ZITADEL_PROJECT_ID` | No | Default project ID for role operations |
| `PORTAL_DATABASE_URL` | No | Postgres connection string (enables portal tools) |
| `LOG_LEVEL` | No | `DEBUG`, `INFO`, `WARN`, `ERROR` (default: `INFO`) |

## Security

**This server has admin-level access to your Zitadel instance.** Understand what that means before using it:

- The service account needs org-level management rights. Empirically (Zitadel Cloud, verified 2026-06): `ORG_USER_MANAGER` is enough to **create users and assign existing project roles**, but **`ORG_OWNER` is required** to create project roles, manage org-manager grants (the no-super-admin pattern), and manage applications. For the full provisioning workload, give the service account `ORG_OWNER`; human Admins can stay at `ORG_USER_MANAGER`. Keep the key in a gitignored `.env` (not a shared dotfile) and use `ZITADEL_READ_ONLY=true` for non-mutating sessions.
- When you create an OIDC app (`zitadel_create_oidc_app`), the **client secret** is returned in the tool response. It is only available at creation time. The AI assistant (and its conversation history) will see it — save it immediately and treat it as sensitive.
- When you generate a service account key (`zitadel_create_service_user_key`), the **full private key** is returned in the tool response. Same caveat: save it, and be aware it's visible in your MCP client's conversation.
- All tool arguments containing PII (email, name, URLs) are **redacted from debug logs**. IDs and tool names are still logged.
- All Zitadel IDs are validated against an alphanumeric format before being used in API paths.

> **Note for new users:** I've scanned all source files in this repo and found nothing notable, but I always recommend you have your own AI or tooling audit the code before installing any MCP server that gets access to your infrastructure. The full source is ~800 lines of TypeScript — a quick review shouldn't take long.

## Development

```bash
npm run dev    # Run with tsx (hot reload)
npm run build  # Compile TypeScript
npm start      # Run compiled version
npm test       # Run tests
```

## License

MIT
