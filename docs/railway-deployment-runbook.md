# Railway Deployment Runbook

## Purpose
Operational runbook for deploying the planner stack and parser stack to Railway.

This document assumes:
- all services are deployed to Railway
- the database is a single Supabase Postgres project
- application schemas are `planner` and `parser`

Automation companion:
- [docs/railway-automation-ru.md](/Users/innokentyb/Ba_post_planner/docs/railway-automation-ru.md)

## Railway services
### From `Ba_post_planner`
1. `planner-app`
2. `planner-mcp`

### From `InnokentyB/reddit-parser`
3. `reddit-parser-api`
4. `reddit-parser-worker`
5. `reddit-parser-scheduler`

## Deployment matrix
| Service | Repo | Public | Purpose | Build | Start |
|---|---|---:|---|---|---|
| `planner-app` | `Ba_post_planner` | yes | frontend + main API | `npm install && npm run build` | `npm run migrate:deploy && node dist/server.js` |
| `planner-mcp` | `Ba_post_planner` | yes | remote MCP gateway | `npm install && npm run build:backend` | `node dist/mcp/remote-server.js` |
| `reddit-parser-api` | `reddit-parser` | optional | parser HTTP API | `pip install -r requirements.txt` | `./bin/start api` |
| `reddit-parser-worker` | `reddit-parser` | no | parser continuous worker | `pip install -r requirements.txt` | `./bin/start worker` |
| `reddit-parser-scheduler` | `reddit-parser` | no | parser cron / scheduler | `pip install -r requirements.txt` | `./bin/start scheduler` |

## Recommended public domains
| Service | Domain role |
|---|---|
| `planner-app` | `app.<domain>` |
| `planner-mcp` | `mcp.<domain>` |
| `reddit-parser-api` | internal only preferred; if public, `parser-api.<domain>` |

## Railway private networking
Deploy all services into the same Railway project and environment.

Then internal DNS should follow:
- `planner-app.railway.internal`
- `planner-mcp.railway.internal`
- `reddit-parser-api.railway.internal`

Reference:
- [Railway Private Networking](https://docs.railway.com/networking/private-networking)

## Environment variables
### Shared database
All services need access to the same Supabase Postgres connection string.

Preferred variable names:
- `APP_DATABASE_URL` for all services
- `APP_DIRECT_DATABASE_URL` for services that run migrations directly
- `APP_DB_SCHEMA` for the service's own application schema

Compatibility aliases can remain during transition:
- planner legacy: `DATABASE_URL`, `DIRECT_DATABASE_URL`, `PLANNER_DB_SCHEMA`, `PLANNER_TARGET_SCHEMA`
- parser legacy: `PARSER_DB_SCHEMA`

### `planner-app`
Required baseline:
- `APP_DATABASE_URL`
- `APP_DIRECT_DATABASE_URL`
- `APP_DB_SCHEMA=planner`
- `APP_TARGET_DB_SCHEMA=planner`
- `JWT_SECRET`
- `PORT`

Likely required based on current codebase:
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `TELEGRAM_BOT_TOKEN`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- channel/provider secrets already stored in DB where applicable

Parser integration:
- `PARSER_API_BASE_URL`
- `PARSER_SERVICE_TOKEN`

Compatibility aliases to keep in Railway for now:
- `DATABASE_URL=<same as APP_DATABASE_URL>`
- `DIRECT_DATABASE_URL=<same as APP_DIRECT_DATABASE_URL>`
- `PLANNER_DB_SCHEMA=planner`
- `PLANNER_TARGET_SCHEMA=planner`

Keep the connection string default schema on `public`.
Reason:
- Prisma models now target `planner` explicitly
- `_prisma_migrations` remains in `public`
- raw SQL without schema qualification should not be relied on for planner tables

### `planner-mcp`
Required:
- `APP_DATABASE_URL`
- `APP_DB_SCHEMA=planner`
- `PORT`
- `MCP_AUTH_TOKEN` or equivalent remote MCP auth secret

Compatibility aliases to keep in Railway for now:
- `DATABASE_URL=<same as APP_DATABASE_URL>`
- `PLANNER_DB_SCHEMA=planner`

If `planner-mcp` calls planner HTTP APIs instead of shared code directly:
- `PLANNER_INTERNAL_BASE_URL=http://planner-app.railway.internal:<port>`
- `PLANNER_INTERNAL_TOKEN`

Parser integration if used directly:
- `PARSER_API_BASE_URL`
- `PARSER_SERVICE_TOKEN`

### `reddit-parser-api`
Required:
- `APP_DATABASE_URL`
- `APP_DB_SCHEMA=parser`
- `PORT`

Compatibility alias:
- `PARSER_DB_SCHEMA=parser`

Reddit provider mode:
- `REDDIT_PROVIDER=oauth` or `browser`

For OAuth mode:
- `REDDIT_CLIENT_ID`
- `REDDIT_CLIENT_SECRET`
- `REDDIT_USER_AGENT`

For service auth:
- `PARSER_SERVICE_TOKEN`

### `reddit-parser-worker`
Required:
- `APP_DATABASE_URL`
- `APP_DB_SCHEMA=parser`
- `REDDIT_PROVIDER`
- Reddit provider credentials
- `PARSER_SERVICE_TOKEN` if internal API access is enforced

Compatibility alias:
- `PARSER_DB_SCHEMA=parser`

### `reddit-parser-scheduler`
Required:
- `APP_DATABASE_URL`
- `APP_DB_SCHEMA=parser`
- `PARSER_SERVICE_TOKEN` if needed

Compatibility alias:
- `PARSER_DB_SCHEMA=parser`

## Health checks
### `planner-app`
- path: `/api/health`

### `planner-mcp`
- add path: `/health`

### `reddit-parser-api`
- path: `/health`

### Worker / scheduler
- no public healthcheck
- monitor process logs and restart behavior through Railway

## Deployment order
### Phase 1. Database preparation
1. Confirm Supabase project is active
2. Stop:
   - `planner-app`
   - `planner-mcp`
   - any DB-writing jobs
3. Run [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
4. Verify with [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)
5. Define migration ownership:
   - planner migrations only touch `planner`
   - parser migrations only touch `parser`

### Phase 2. Parser stack
1. Deploy `reddit-parser-api`
2. Deploy `reddit-parser-worker`
3. Deploy `reddit-parser-scheduler`
4. Verify:
   - `GET /health`
   - parser API auth
   - one sample parser search job

### Phase 3. Planner app
1. Deploy `planner-app`
2. Verify:
   - web loads
   - `/api/health`
   - auth works
   - planner DB access works

### Phase 4. Planner MCP
1. Deploy `planner-mcp` remote entrypoint
2. Verify:
   - `/health`
   - MCP tool listing
   - auth enforcement
   - parser tools can route through planner
3. Run remote smoke:
   - `node scripts/test_remote_mcp.js --url "https://<mcp-domain>/mcp" --auth-token "<token>"`

## Required implementation backlog before full production rollout
### In `Ba_post_planner`
1. Add MCP auth scopes or per-user tokens beyond one shared bearer token
2. Add planner endpoints for parser actions used by frontend
3. Add audit logging for parser and MCP write actions
4. Add schema-aware database migration strategy for `planner`

### In `reddit-parser`
1. Make schema configurable or explicitly `parser`
2. Add service auth if exposed publicly
3. Verify worker/scheduler role separation on Railway
4. Confirm API routes used by planner:
   - search
   - job status
   - templates
   - insights
   - summaries

## Recommended runtime ownership model
### `planner-app` owns
- browser-facing API
- auth and project permissions
- project to parser workspace mapping
- UI-oriented parser orchestration

### `planner-mcp` owns
- Claude-facing remote MCP API
- MCP auth and tool authorization
- publication and parser tool access

### `reddit-parser-*` owns
- collection
- enrichment
- template scheduling
- insight generation

## Data ownership
### Planner schema
Source of truth for:
- users
- projects
- channels
- content items
- publication plans
- publication execution

### Parser schema
Source of truth for:
- parser jobs
- parser runs
- Reddit raw data
- templates
- parser insights and summaries

## Logging and audit
### Minimum logging requirements
For `planner-app` and `planner-mcp`:
- actor
- project id
- action type
- parser workspace id if relevant
- external publish target if relevant
- success/failure

### Suggested event types
- `mcp.direct_publication`
- `mcp.plan_import`
- `mcp.parser_job_create`
- `mcp.parser_template_run`
- `planner.parser_sync`

## Rollback strategy
### App rollback
- redeploy previous Railway release

### Parser rollback
- redeploy previous parser release

### Database rollback
Because planner and parser share one DB:
- schema-qualified migration rollback is mandatory
- never run unreviewed destructive migration in production
- back up before cross-schema rollout windows

## Operational risks
1. Parser load degrades planner responsiveness
2. One DB instance is a shared failure domain
3. MCP write tools can have high blast radius if auth is weak
4. Public parser API without service auth is risky

## Mitigations
1. Use Railway private networking where possible
2. Keep parser API internal or strongly authenticated
3. Use schema-qualified migrations
4. Add retention policy for parser raw data
5. Keep `planner-mcp` isolated from `planner-app`

## Immediate next engineering steps
1. Add schema configuration plan for both repos
2. Implement remote MCP transport
3. Implement planner parser integration client
4. Add Railway service definitions and env setup in project ops docs

## Related docs
- [railway-production-architecture.md](/Users/innokentyb/Ba_post_planner/docs/railway-production-architecture.md)
- [database-topology.md](/Users/innokentyb/Ba_post_planner/docs/database-topology.md)
- [schema-plan.md](/Users/innokentyb/Ba_post_planner/docs/schema-plan.md)
- [migration-plan.md](/Users/innokentyb/Ba_post_planner/docs/migration-plan.md)
- [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
- [production-cutover-checklist-ru.md](/Users/innokentyb/Ba_post_planner/docs/production-cutover-checklist-ru.md)
- [railway-supabase-operator-guide-ru.md](/Users/innokentyb/Ba_post_planner/docs/railway-supabase-operator-guide-ru.md)
