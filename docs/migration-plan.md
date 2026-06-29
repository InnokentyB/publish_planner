# Migration Plan

## Purpose
Make database rollout safe on Railway while the planner and parser share one Supabase Postgres database.

This document answers three practical questions:
1. what we can migrate automatically today
2. what must wait for a controlled migration window
3. where `migrate deploy` is safe to enable

## Current truth

### Planner repository
This branch has been prepared for the post-cutover Prisma state:
- Prisma datasource includes schema `planner`
- planner models are mapped with `@@schema("planner")`

The current production database may still be in the pre-cutover state:
- runtime schema before cutover: `public`
- migration history table remains in `public`

That means this branch must be deployed together with the cutover SQL, not before it.

### Parser repository
The parser target should be:
- schema: `parser`
- schema-aware migrations from day one

The parser stack should never rely on `public`.

## Safe deployment policy

### What can be automated now
For `Ba_post_planner`, after the cutover SQL has been applied:
- `npx prisma migrate deploy`
- with planner runtime schema now in `planner`
- while `_prisma_migrations` remains in `public`

For `reddit-parser`:
- automatic migrations are safe only after that repo explicitly creates and targets `parser`

### What must not be automated yet
Do not auto-run a migration that:
- renames or moves planner tables from `public` to `planner`
- changes planner runtime `search_path` without data migration
- mixes planner and parser schema changes in one release

## Planner migration phases

### Phase P0. Maintenance-window cutover
Status:
- safe now

Actions:
1. stop `planner-app`
2. stop `planner-mcp`
3. stop any DB-writing jobs
4. run [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
5. verify with [dual-schema-cutover-verify.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-verify.sql)
6. deploy this branch
7. set `PLANNER_DB_SCHEMA=planner`

This is the required first step for this branch.

### Phase P1. Post-cutover app deploy
Status:
- next

Goal:
- bring planner services up on the new schema

Actions:
1. deploy `planner-app`
2. let only `planner-app` run `npm run migrate:deploy`
3. deploy `planner-mcp` without running migrations
4. smoke test planner reads and writes

### Phase P2. Parser schema enablement
Status:
- next

Goal:
- bring parser services onto the same database safely

Required work:
1. keep `parser` schema created by the shared cutover SQL
2. update the parser repo so its migrations explicitly target `parser`
3. deploy `reddit-parser-api`
4. run parser-owned migrations there
5. deploy worker and scheduler after parser API is healthy

### Phase P3. Post-cutover feature migrations
Status:
- ongoing

Then it becomes safe to:
- run planner migrations automatically against `planner`
- add planner integration tables in `planner`
- add parser feature migrations in `parser`

## Parser migration phases

### Phase R0. Make parser schema explicit
In `reddit-parser`:
1. add configurable schema support, defaulting to `parser`
2. ensure all SQLAlchemy models and migrations target `parser`
3. create schema if missing during bootstrap or migration

### Phase R1. Enable parser auto-migrate
After the parser repo has schema-qualified migrations:
- enable parser deploy step to run its migration command automatically
- verify worker and scheduler can start against the migrated schema

### Phase R2. Ongoing parser retention migrations
Later parser-specific migrations can evolve independently:
- raw data retention
- summary tables
- template changes

Because parser owns only `parser`, these are much safer than planner cross-schema moves.

## Railway recommendations

### `planner-app`
Safe after cutover SQL:
- build command: `npm install && npm run build`
- start command: `npm run migrate:deploy && node dist/server.js`

Why this is safe:
- Prisma client now targets `planner`
- migration history remains discoverable from `public`
- the planner `DATABASE_URL` can keep its default schema on `public`

### `planner-mcp`
Do not run migrations here if `planner-app` already does.

Recommended start:
- `node dist/mcp/remote-server.js`

Reason:
- avoid two services racing the same Prisma migration on deploy

### `reddit-parser-api`
Add auto-migrate only after parser repo is schema-aware for `parser`.

### `reddit-parser-worker`
- no migrations here

### `reddit-parser-scheduler`
- no migrations here

## One-writer rule for migrations
Within a deploy wave, exactly one service should run schema migrations for a given repository.

Recommended ownership:
- planner migrations: `planner-app`
- parser migrations: `reddit-parser-api`

Never let:
- `planner-app` and `planner-mcp` both run Prisma deploy migrations
- `reddit-parser-api` and worker/scheduler all run parser migrations in parallel

## Rollback notes

### Safe rollback after cutover
If the application deployment fails right after the schema move:
- redeploy previous app version
- run [dual-schema-cutover-rollback.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover-rollback.sql)
- keep runtime on the pre-cutover app version
- inspect Prisma migration status before retry

## Commands

### Planner repo
- status: `npm run migrate:status`
- deploy: `npm run migrate:deploy`

### Pre-deploy checklist
1. confirm `DIRECT_DATABASE_URL` or direct Supabase URL is available for Prisma migrations
2. confirm cutover SQL has already been applied
3. confirm `PLANNER_DB_SCHEMA=planner`
4. confirm only `planner-app` runs `migrate:deploy`

## Decision
Today we enable:
- automatic planner migrations after the shared cutover is complete

Today we do not enable:
- automatic parser migrations until the parser repo is made schema-aware

## Related docs
- [schema-plan.md](/Users/innokentyb/Ba_post_planner/docs/schema-plan.md)
- [database-topology.md](/Users/innokentyb/Ba_post_planner/docs/database-topology.md)
- [railway-deployment-runbook.md](/Users/innokentyb/Ba_post_planner/docs/railway-deployment-runbook.md)
- [dual-schema-cutover.sql](/Users/innokentyb/Ba_post_planner/ops/sql/dual-schema-cutover.sql)
