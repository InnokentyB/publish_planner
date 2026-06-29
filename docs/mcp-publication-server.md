# MCP Publication Server

## Purpose
This project now includes a local MCP server that exposes publication workflows to MCP clients such as Claude.

The server wraps existing planner functionality instead of creating a second publication backend.

## Available tools
- `ba_import_publication_plan_file`
- `ba_import_publication_plan_json`
- `ba_parser_create_search_job`
- `ba_parser_get_insights`
- `ba_parser_get_search_job`
- `ba_parser_get_summary`
- `ba_parser_health`
- `ba_parser_import_templates`
- `ba_parser_list_posts`
- `ba_parser_list_templates`
- `ba_parser_refresh_search_job`
- `ba_parser_run_template`
- `ba_list_projects`
- `ba_list_publication_plan_assets`
- `ba_list_project_channels`
- `ba_list_publication_tasks`
- `ba_get_publication_task`
- `ba_get_publication_task_resources`
- `ba_prepare_publication_task`
- `ba_confirm_publication`
- `ba_publish_direct`
- `ba_read_publication_plan_asset`
- `ba_read_publication_plan_ref`

## What `ba_publish_direct` supports
Direct publication currently supports these channel types when a project has an active configured channel:
- `reddit`
- `telegram`
- `vk`
- `linkedin`

Notes:
- `reddit` requires `title` and `subreddit`
- `telegram`, `vk`, and `linkedin` publish from `text` and optional `imageUrl`
- `dryRun: true` can be used to validate routing without posting

## Build
```bash
npm run build:backend
```

## Run locally
```bash
npm run mcp:start
```

For local development without compiling first:

```bash
npm run mcp:dev
```

## Smoke test
Run a quick end-to-end MCP check:

```bash
npm run test:mcp
```

This verifies:
- the MCP server starts over stdio
- the expected tools are exposed
- the `ba_list_projects` read-only tool can be called
- parser tool registration is present in the MCP tool list

If you want to verify transport and tool registration without requiring a live database:

```bash
node scripts/test_mcp_server.js --skip-db
```

If you want to test publication plan import with a real JSON fixture:

```bash
node scripts/test_mcp_server.js \
  --plan-path "/Users/innokentyb/Documents/Claude/Projects/Seturon/content-pipeline-2026-04/08-automation/publication-plan.json" \
  --user-id 1
```

Convenience command for the Seturon fixture:

```bash
npm run test:mcp:seturon -- --user-id 1
```

Parser chain smoke for a live Railway-style environment:

```bash
node scripts/test_parser_chain.js \
  --user-id 1 \
  --project-id 123 \
  --query "course creation pain points" \
  --subreddits "onlinecourses,Entrepreneur" \
  --limit 10
```

This validates:
- direct reachability of `PARSER_API_BASE_URL/health`
- parser MCP tool registration
- planner-to-parser health flow through `ba_parser_health`
- project-scoped template listing through `ba_parser_list_templates`
- optional search-job creation and status lookup through planner-owned MCP tools

## Example Claude MCP command
Use the built server entrypoint:

```json
{
  "command": "node",
  "args": ["/Users/innokentyb/Ba_post_planner/dist/mcp/server.js"],
  "env": {
    "DATABASE_URL": "postgresql://..."
  }
}
```

If Claude should use the same `.env`-driven setup as the main app, make sure the required environment variables are available to the MCP process as well.

For a fuller deployment and operations guide, see:
- [docs/mcp-deployment.md](/Users/innokentyb/Ba_post_planner/docs/mcp-deployment.md)
- [docs/claude-mcp-playbook.md](/Users/innokentyb/Ba_post_planner/docs/claude-mcp-playbook.md)

## Recommended workflow from Claude
1. If you need to load a new plan, call `ba_import_publication_plan_json`
   Or call `ba_import_publication_plan_file` if Claude already has a local file path
2. Call `ba_list_projects`
3. If you need Reddit research for a project, use:
   - `ba_parser_health`
   - `ba_parser_list_templates`
   - `ba_parser_create_search_job`
   - `ba_parser_get_search_job`
   - `ba_parser_get_insights`
   - `ba_parser_get_summary`
4. If you need source content from the plan, use:
   - `ba_list_publication_plan_assets`
   - `ba_read_publication_plan_asset`
   - `ba_read_publication_plan_ref`
5. Call `ba_list_project_channels`
6. For task-based publication, use:
   - `ba_get_publication_task_resources`
   - `ba_list_publication_tasks`
   - `ba_prepare_publication_task`
   - `ba_confirm_publication`
7. For direct payload-driven publishing, call `ba_publish_direct`

## Parser workflow example
This is the recommended research flow before creating or publishing content for a project.

1. Check parser connectivity:

```json
{
  "userId": 1,
  "projectId": 123
}
```

Tool:
- `ba_parser_health`

2. List saved search templates:

```json
{
  "userId": 1,
  "projectId": 123
}
```

Tool:
- `ba_parser_list_templates`

3. Create a search job:

```json
{
  "userId": 1,
  "projectId": 123,
  "query": "course creation pain points",
  "subreddits": ["onlinecourses", "Entrepreneur", "smallbusiness"],
  "limit": 25
}
```

Tool:
- `ba_parser_create_search_job`

4. Poll job status:

```json
{
  "userId": 1,
  "projectId": 123,
  "jobId": "search-job-id"
}
```

Tool:
- `ba_parser_get_search_job`

5. Read the result set:
- `ba_parser_list_posts`
- `ba_parser_get_insights`
- `ba_parser_get_summary`

Template-driven research is also supported through:
- `ba_parser_import_templates`
- `ba_parser_run_template`

## Safety notes
- Channel secrets are redacted in list tools
- Direct publishes are logged into the `events` table as `mcp.direct_publication`
- Parser actions are routed through the planner integration layer and logged in planner events
- Unsupported channel types return a clear error instead of attempting a partial publish
