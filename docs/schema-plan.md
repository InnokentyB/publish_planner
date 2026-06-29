# Schema Plan

## Purpose
Define the production-safe database schema strategy before we wire the planner and parser together on Railway.

## Branch state
This branch is prepared for the **post-cutover** runtime:
- planner Prisma models target `planner`
- parser target schema remains `parser`

Do not deploy this branch before running the maintenance-window cutover SQL.

## Previous runtime state
Before the cutover, the planner application used:
- runtime planner schema: `public`

That old state is the reason the cutover has to be done atomically with deployment.

## Target production state
The target Railway + Supabase topology is:
- planner-owned tables in schema `planner`
- parser-owned tables in schema `parser`
- Supabase-managed schemas untouched:
  - `public`
  - `auth`
  - `storage`
  - internal Supabase schemas

## Recommended rollout stages

### Stage 1. Current public runtime
- planner runtime schema: `public`
- parser runtime schema: `parser`
- planner migrations still operate against existing planner tables
- parser repo is prepared to create and use only `parser`

This is the safe starting point for deployment preparation.

### Stage 2. Cutover branch
- application code targets `planner`
- production database may still be on `public` until maintenance window
- deploy is blocked until cutover SQL is applied
- parser continues to use `parser`

This is the state of the repository right now.

### Stage 3. Target dual schema
- planner runtime schema: `planner`
- parser runtime schema: `parser`
- no planner domain writes to `public`
- `public` is kept only for legacy compatibility or intentionally empty

## Workspace mapping rule
Every planner project maps to one parser workspace:

- planner `project_id = 42`
- parser `workspace_id = project:42`

This must stay identical across:
- planner backend integration
- MCP tools
- parser search jobs
- parser summaries and templates

## Ownership boundaries

### `Ba_post_planner`
Owns:
- planner schema strategy
- project to workspace mapping
- planner-facing parser integration client
- planner-side auth, audit, and policy checks

Must not:
- write parser raw tables directly
- expose parser API directly to frontend

### `reddit-parser`
Owns:
- parser schema
- ingestion tables
- search job execution
- templates
- summaries and insights

Must not:
- assume browser-facing auth
- become the primary product API

## Environment conventions

### Planner repo
- `PLANNER_DB_SCHEMA=planner`
- `PLANNER_TARGET_SCHEMA=planner`
- `PARSER_DB_SCHEMA=parser`

### Parser repo
- `PARSER_DB_SCHEMA=parser`

This lets us encode the transition honestly in configuration instead of pretending the migration is already complete.

## Immediate engineering implications
1. Run the maintenance-window cutover before deploying this branch.
2. Keep `_prisma_migrations` in `public`.
3. Build the parser integration layer now, using project-to-workspace mapping.
4. Make parser repo explicitly schema-aware for `parser`.

## Code references
- runtime helper: [src/services/schema_plan.service.ts](/Users/innokentyb/Ba_post_planner/src/services/schema_plan.service.ts)
- parser client: [src/services/parser_client.ts](/Users/innokentyb/Ba_post_planner/src/services/parser_client.ts)
- cutover SQL: [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
- broader topology: [docs/database-topology.md](/Users/innokentyb/Ba_post_planner/docs/database-topology.md)
