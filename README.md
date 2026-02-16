# Zitadel MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server for [Zitadel](https://zitadel.com/) identity management. Manage users, projects, applications, roles, and service accounts through natural language from AI tools like Claude Code.

> *"Create a user for jane@example.com, assign her the app:finance role, and give me the auth config."*
> — That's three tool calls the AI handles for you.

## Tools (25)

| Category | Tool | Description |
|----------|------|-------------|
| **Users** | `zitadel_list_users` | List/search users |
| | `zitadel_get_user` | Get user details |
| | `zitadel_create_user` | Create user (sends invite email) |
| | `zitadel_deactivate_user` | Deactivate user |
| | `zitadel_reactivate_user` | Reactivate user |
| **Projects** | `zitadel_list_projects` | List projects |
| | `zitadel_get_project` | Get project details |
| | `zitadel_create_project` | Create project |
| **Applications** | `zitadel_list_apps` | List apps in a project |
| | `zitadel_get_app` | Get app details + Client ID |
| | `zitadel_create_oidc_app` | Create OIDC application |
| | `zitadel_update_app` | Update app (redirect URIs, etc.) |
| **Roles** | `zitadel_list_project_roles` | List roles in a project |
| | `zitadel_create_project_role` | Create a role (e.g., `app:finance`) |
| | `zitadel_list_user_grants` | List user's role grants |
| | `zitadel_create_user_grant` | Assign roles to user |
| | `zitadel_remove_user_grant` | Remove role grant |
| **Service Accounts** | `zitadel_create_service_user` | Create machine user |
| | `zitadel_create_service_user_key` | Generate key pair |
| | `zitadel_list_service_user_keys` | List keys (metadata only) |
| **Organizations** | `zitadel_get_org` | Get current org details |
| | `zitadel_list_orgs` | List organizations |
| **Utility** | `zitadel_get_auth_config` | Get .env.local template for an app |
| **Portal** | `portal_register_app` | Register app in portal DB |
| | `portal_setup_full_app` | One-click: Zitadel + portal setup |

Portal tools (`portal_*`) are only available when `PORTAL_DATABASE_URL` is configured.

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

### Claude Code (`.mcp.json`)

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

- The service account needs **Org Owner** (or **IAM Admin** for `zitadel_list_orgs`). It can create users, modify roles, and manage applications in your organization.
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
