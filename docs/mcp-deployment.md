# MCP Deployment Guide

## Purpose
This guide explains how to deploy and connect the `Ba_post_planner` MCP server so Claude can use planner publication and parser tools.

## What is deployed
The project now supports two MCP entrypoints:

1. Local `stdio` MCP for development and Claude Desktop on the same machine
2. Remote Streamable HTTP MCP for Railway and multi-device use

Local entrypoint:
- [dist/mcp/server.js](/Users/innokentyb/Ba_post_planner/dist/mcp/server.js)

Remote entrypoint:
- [dist/mcp/remote-server.js](/Users/innokentyb/Ba_post_planner/dist/mcp/remote-server.js)

Source:
- [src/mcp/server.ts](/Users/innokentyb/Ba_post_planner/src/mcp/server.ts)
- [src/mcp/remote-server.ts](/Users/innokentyb/Ba_post_planner/src/mcp/remote-server.ts)
- [src/mcp/shared.ts](/Users/innokentyb/Ba_post_planner/src/mcp/shared.ts)

## What the MCP server currently exposes
- parser health checks
- parser search job creation and status lookup
- parser post, insight, summary, and template access
- publication plan file import
- publication plan JSON import
- publication plan asset listing
- publication plan asset reading
- publication plan ref resolution
- project listing
- project channel listing
- publication task listing
- publication task inspection
- publication task resource reading
- publication handoff preparation
- manual publication confirmation
- direct publication to supported channels

Supported direct publish channel types:
- `reddit`
- `telegram`
- `vk`
- `linkedin`

Parser-facing MCP tools:
- `ba_parser_health`
- `ba_parser_create_search_job`
- `ba_parser_get_search_job`
- `ba_parser_refresh_search_job`
- `ba_parser_list_posts`
- `ba_parser_get_insights`
- `ba_parser_get_summary`
- `ba_parser_list_templates`
- `ba_parser_import_templates`
- `ba_parser_run_template`

## Publication plan import
Publication plan JSON import is now exposed through MCP as:
- `ba_import_publication_plan_file`
- `ba_import_publication_plan_json`

The underlying HTTP route still exists:
- [src/routes/project.routes.ts](/Users/innokentyb/Ba_post_planner/src/routes/project.routes.ts#L449)

Current MCP import input:
- `userId`
- `planJson`

File import input:
- `userId`
- `planPath`

And uses:
- [src/services/publication_plan.service.ts](/Users/innokentyb/Ba_post_planner/src/services/publication_plan.service.ts#L145)

## Publication content file access
Claude can now read file-backed content referenced by the imported plan through:
- `ba_list_publication_plan_assets`
- `ba_read_publication_plan_asset`
- `ba_read_publication_plan_ref`
- `ba_get_publication_task_resources`

These tools are intentionally constrained to paths inside the imported plan's `meta.pipeline_root`.

## Prerequisites
The MCP process must have the same runtime access as the main planner backend.

Required:
- Node.js compatible with project dependencies
- installed `node_modules`
- reachable Postgres via `DATABASE_URL`

Depending on the channels you want Claude to publish to, the MCP process may also need:
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USERNAME`
- `REDDIT_PASSWORD`
- `REDDIT_USER_AGENT`
- `TELEGRAM_BOT_TOKEN`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- any project-specific channel credentials already stored in DB

For parser-backed research tools, the MCP process also needs:
- `PARSER_API_BASE_URL`
- `PARSER_SERVICE_TOKEN` if the parser API is protected by bearer auth

## Build
From the repository root:

```bash
npm install
npm run build:backend
```

## Local run
Run the MCP server directly:

```bash
npm run mcp:start
```

Or in TypeScript dev mode:

```bash
npm run mcp:dev
```

## Remote run
For Railway or any remote MCP deployment:

```bash
npm run mcp:remote:start
```

For TypeScript dev mode:

```bash
npm run mcp:remote:dev
```

Remote MCP defaults:
- binds to `0.0.0.0`
- uses `PORT` or `MCP_PORT`
- exposes `GET /health`
- exposes MCP on `GET/POST/DELETE /mcp`
- enforces `Authorization: Bearer <MCP_AUTH_TOKEN>` when `MCP_AUTH_TOKEN` is configured

## Smoke test
Transport-only test:

```bash
node scripts/test_mcp_server.js --skip-db
```

Full test:

```bash
npm run test:mcp
```

Parser chain smoke:

```bash
node scripts/test_parser_chain.js \
  --user-id 1 \
  --project-id 123 \
  --query "customer feedback on online course launches" \
  --subreddits "onlinecourses,Entrepreneur" \
  --limit 10
```

Remote MCP smoke:

```bash
node scripts/test_remote_mcp.js \
  --url "https://mcp.example.com/mcp" \
  --auth-token "<mcp auth token>" \
  --user-id 1 \
  --project-id 123
```

Import test with a real publication plan fixture:

```bash
node scripts/test_mcp_server.js \
  --plan-path "/Users/innokentyb/Documents/Claude/Projects/Seturon/content-pipeline-2026-04/08-automation/publication-plan.json" \
  --user-id 1
```

Convenience wrapper for the same fixture:

```bash
npm run test:mcp:seturon -- --user-id 1
```

Expected outcomes:
- exit `0`: MCP transport and DB-backed test passed
- exit `2`: MCP transport passed, but DB-backed tool could not complete
- exit `1`: startup, handshake, or tool registration failed
- exit `3`: import tool was reached, but the publication plan import itself failed
- exit `4`: ref-reading step failed after a successful import

Current smoke coverage:
- transport and tool registration
- publication-plan import path
- publication-plan ref read path
- parser direct `/health` reachability
- planner-to-parser MCP health and template listing
- optional parser search-job creation and status lookup
- remote MCP `/health`
- remote MCP tool listing
- remote MCP `ba_list_projects`
- optional remote MCP `ba_parser_health`

Recommended parser smoke env:
- `PARSER_API_BASE_URL`
- `PARSER_SERVICE_TOKEN` when parser auth is enabled
- `DATABASE_URL`
- a valid `--user-id`
- a valid `--project-id`

Parser smoke exit codes:
- exit `5`: direct parser `/health` failed
- exit `6`: `ba_parser_health` failed
- exit `7`: `ba_parser_list_templates` failed
- exit `8`: `ba_parser_create_search_job` failed
- exit `9`: `ba_parser_get_search_job` failed

Remote MCP smoke exit codes:
- exit `5`: remote MCP `/health` failed
- exit `6`: remote MCP `ba_list_projects` failed
- exit `7`: remote MCP `ba_parser_health` failed

## Claude desktop / local MCP config
Example local MCP config:

```json
{
  "mcpServers": {
    "ba-post-planner": {
      "command": "node",
      "args": ["/Users/innokentyb/Ba_post_planner/dist/mcp/server.js"],
      "env": {
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

If the machine already provides the needed environment variables globally, `env` can be omitted or reduced.

## Remote MCP on Railway
Recommended Railway start command for `planner-mcp`:

```bash
node dist/mcp/remote-server.js
```

Recommended Railway variables:
- `DATABASE_URL`
- `PLANNER_DB_SCHEMA=planner`
- `PORT`
- `MCP_AUTH_TOKEN`
- `PARSER_API_BASE_URL`
- `PARSER_SERVICE_TOKEN`

Healthcheck:
- `GET /health`

Expected MCP endpoint:
- `POST /mcp`
- `GET /mcp`
- `DELETE /mcp`

### Recommended production naming template
Use one stable naming convention everywhere: Railway service, public domain, connector name, and secret names.

Recommended values:
- Railway service: `planner-mcp`
- Public domain: `mcp.ba-post-planner.<your-domain>`
- MCP endpoint: `https://mcp.ba-post-planner.<your-domain>/mcp`
- Health URL: `https://mcp.ba-post-planner.<your-domain>/health`
- Claude/Cline connector name: `ba-post-planner-prod`
- Railway secret name: `MCP_AUTH_TOKEN`
- Local secret alias if you store it outside Railway: `BA_POST_PLANNER_MCP_AUTH_TOKEN`

If you do not have a custom domain yet, use the Railway public URL first and keep the same connector name:
- `https://planner-mcp-production-xxxx.up.railway.app/mcp`

Recommended companion parser values:
- Railway service: `reddit-parser-api`
- Internal parser URL: `http://reddit-parser-api.railway.internal:<port>`
- Public parser URL if needed: `https://parser-api.ba-post-planner.<your-domain>`
- Parser service secret: `PARSER_SERVICE_TOKEN`

## Ready client config snippets
Use these examples after `planner-mcp` is deployed and remote smoke has passed.

Assume:
- remote URL: `https://mcp.ba-post-planner.<your-domain>/mcp`
- bearer token: `YOUR_MCP_AUTH_TOKEN`

### Claude.ai / Cowork / Claude Desktop as remote connector
Remote connectors are configured through the Claude UI, not through local `claude_desktop_config.json`.

Use:
1. Open `Customize -> Connectors`
2. Click `Add custom connector`
3. Enter the remote MCP URL:
   - `https://mcp.ba-post-planner.<your-domain>/mcp`
4. If your server later moves to OAuth, use `Advanced settings`
5. Enable the connector for the conversation

Important:
- remote connectors are reached from Anthropic's cloud, not from your laptop
- the Railway MCP URL must be publicly reachable
- local `stdio` MCP config is a separate path and does not power Cowork

### Claude Code
CLI command:

```bash
claude mcp add --transport http ba-post-planner-prod https://mcp.ba-post-planner.<your-domain>/mcp \
  --header "Authorization: Bearer YOUR_MCP_AUTH_TOKEN"
```

JSON alternative:

```json
{
  "type": "http",
  "url": "https://mcp.ba-post-planner.<your-domain>/mcp",
  "headers": {
    "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
  }
}
```

Example with `add-json`:

```bash
claude mcp add-json ba-post-planner-prod '{"type":"http","url":"https://mcp.ba-post-planner.<your-domain>/mcp","headers":{"Authorization":"Bearer YOUR_MCP_AUTH_TOKEN"}}'
```

### Cline
Add this to `~/.cline/mcp.json` or through the MCP settings UI:

```json
{
  "mcpServers": {
    "ba-post-planner-prod": {
      "url": "https://mcp.ba-post-planner.<your-domain>/mcp",
      "type": "streamableHttp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_AUTH_TOKEN"
      },
      "disabled": false,
      "autoApprove": [
        "ba_list_projects",
        "ba_parser_health",
        "ba_parser_list_templates"
      ],
      "timeout": 60
    }
  }
}
```

Recommended first `autoApprove` set:
- `ba_list_projects`
- `ba_parser_health`
- `ba_parser_list_templates`

Do not auto-approve at first:
- `ba_publish_direct`
- `ba_confirm_publication`
- `ba_parser_create_search_job`
- `ba_parser_run_template`

### Local Claude Desktop stdio config
If you still want a same-machine fallback instead of remote MCP, keep using:

## Recommended deployment pattern
For local single-machine use:

1. Deploy or mount the main app environment where DB access already works
2. Build the backend artifacts
3. Point Claude's MCP configuration at `dist/mcp/server.js`
4. Run `npm run test:mcp`
5. Validate one read-only tool before enabling direct publish

For Railway / shared multi-device use:

1. Deploy `planner-mcp` with `dist/mcp/remote-server.js`
2. Set `MCP_AUTH_TOKEN`
3. Verify `GET /health`
4. Run `node scripts/test_remote_mcp.js --url "https://mcp.ba-post-planner.<your-domain>/mcp" --auth-token "<token>"`
5. Run parser and planner smoke checks
6. Connect Claude to the remote MCP URL

Operational usage guide:
- [docs/claude-mcp-playbook.md](/Users/innokentyb/Ba_post_planner/docs/claude-mcp-playbook.md)

## Operational notes
- the MCP server is state-light; it reads from DB and invokes existing services
- it should be restarted after backend code updates
- direct publish actions are logged in the `events` table as `mcp.direct_publication`
- parser actions are routed through planner services and logged as planner parser events
- secrets are not returned by channel listing tools
- remote MCP sessions are kept in-memory per service instance

## Troubleshooting
### `Can't reach database server`
The MCP process cannot reach the Postgres host from its runtime environment.

Check:
- `DATABASE_URL`
- network access to the DB host
- firewall / VPC / tunnel setup
- whether the DB is restricted to a different runtime

### Tool list works but data tools fail
This usually means:
- MCP transport is healthy
- backend build is healthy
- the failure is in DB connectivity or external provider credentials

If only parser tools fail, check:
- `PARSER_API_BASE_URL`
- `PARSER_SERVICE_TOKEN`
- planner-to-parser network reachability
- whether the target Railway parser services are healthy

### Remote MCP returns `401 Unauthorized`
Check:
- `MCP_AUTH_TOKEN` is set on the server
- the client sends `Authorization: Bearer <token>`
- there are no trailing spaces or mismatched secrets

### Publish tool fails for a channel
Check:
- the target project has an active `SocialChannel`
- required channel credentials exist in DB config
- provider-specific environment variables are available

## Next recommended improvement
Add a file-oriented companion tool, for example:
- richer ref-aware publish helpers that can resolve task payloads from plan refs automatically
