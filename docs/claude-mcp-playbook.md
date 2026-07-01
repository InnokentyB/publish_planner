# Claude MCP Playbook

## Purpose
This is a short operational playbook for Claude when working with the `Ba_post_planner` MCP server.

Use it to:
- import a publication plan
- run Reddit research through the parser stack
- inspect source assets and refs
- prepare publication tasks
- publish directly when appropriate
- confirm manual publication back into the planner

Related product backlog:
- [docs/publication-workflow-ideas-ru.md](/Users/innokentyb/Ba_post_planner/docs/publication-workflow-ideas-ru.md)

## Connection modes
There are two supported ways to use this MCP server:

1. Local `stdio`
2. Remote MCP over HTTP

For team usage across multiple devices, prefer remote MCP on Railway.

Client setup summary:
- Claude.ai / Cowork: add the remote MCP URL in `Customize -> Connectors`
- Claude Code: use `claude mcp add --transport http ...`
- Cline: add a remote `streamableHttp` entry with `Authorization: Bearer ...`

See the ready snippets in:
- [docs/mcp-deployment.md](/Users/innokentyb/Ba_post_planner/docs/mcp-deployment.md)

## Core tools
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
- `ba_import_publication_plan_file`
- `ba_import_publication_plan_json`
- `ba_list_projects`
- `ba_list_publication_plan_assets`
- `ba_read_publication_plan_asset`
- `ba_read_publication_plan_ref`
- `ba_list_project_channels`
- `ba_list_publication_tasks`
- `ba_get_publication_task`
- `ba_get_publication_task_resources`
- `ba_prepare_publication_task`
- `ba_publish_direct`
- `ba_confirm_publication`

## Default workflow
### 1. Find the target project
Tool:
- `ba_list_projects`

Use the returned `project.id` for all subsequent calls.

### 2. Run Reddit research when needed
Start here when you need feedback, topic validation, objections, or language patterns before publishing.

Health check:

```json
{
  "userId": 1,
  "projectId": 123
}
```

Tool:
- `ba_parser_health`

Create a search job:

```json
{
  "userId": 1,
  "projectId": 123,
  "query": "how creators validate course ideas",
  "subreddits": ["onlinecourses", "Entrepreneur"],
  "limit": 20
}
```

Tools:
- `ba_parser_create_search_job`
- `ba_parser_get_search_job`

Read the output:
- `ba_parser_list_posts`
- `ba_parser_get_insights`
- `ba_parser_get_summary`

For reusable research flows:
- `ba_parser_list_templates`
- `ba_parser_import_templates`
- `ba_parser_run_template`

### 3. Import the plan
Preferred when Claude already has a local file path:

```json
{
  "userId": 1,
  "planPath": "/Users/innokentyb/Documents/Claude/Projects/Seturon/content-pipeline-2026-04/08-automation/publication-plan.json"
}
```

Tool:
- `ba_import_publication_plan_file`

Alternative:
- `ba_import_publication_plan_json`

### 4. Inspect the plan structure
Tool:
- `ba_list_publication_plan_assets`

This shows:
- available `assetRef` values
- file-backed paths
- section markers
- whether files exist

### 5. Read the source content
Use one of:
- `ba_read_publication_plan_asset`
- `ba_read_publication_plan_ref`

Examples:

Read a file-backed asset:
```json
{
  "projectId": 123,
  "assetRef": "linkedin_post_3_contrarian"
}
```

Resolve a scalar ref:
```json
{
  "projectId": 123,
  "ref": "article_knowledge.target_url"
}
```

Resolve an asset/object ref:
```json
{
  "projectId": 123,
  "ref": "brand_post_1_decision_point_demo"
}
```

## Task-based publication workflow
Use this when the plan already created `ContentItem` tasks and Claude should work through the planner queue.

### 1. List tasks
Tool:
- `ba_list_publication_tasks`

Recommended input:
```json
{
  "projectId": 123,
  "status": "active"
}
```

### 2. Inspect one task
Tool:
- `ba_get_publication_task`

### 3. Read resolved resources for that task
Tool:
- `ba_get_publication_task_resources`

This is often the best source for publication-ready content because it merges:
- `action.content_files`
- asset-backed content
- section-resolved snippets

### 4. Prepare handoff
Tool:
- `ba_prepare_publication_task`

Use this before manual publication workflows. It returns:
- publication body
- resource files
- checklist
- verification/post actions

### 5. Publish or hand off
If the workflow is manual:
- Claude reads the handoff bundle and helps execute the checklist

If a supported direct channel is available:
- Claude may use `ba_publish_direct`

### 6. Confirm result
Tool:
- `ba_confirm_publication`

Example:
```json
{
  "projectId": 123,
  "taskId": 456,
  "publishedLink": "https://www.linkedin.com/feed/update/...",
  "outcome": "published",
  "note": "Published manually from prepared task bundle."
}
```

## Direct publish workflow
Use this when Claude should publish from payload directly instead of working through a task queue.

Tool:
- `ba_publish_direct`

Supported channel types:
- `reddit`
- `telegram`
- `vk`
- `linkedin`

### Recommended sequence
1. Resolve content with `ba_read_publication_plan_asset` or `ba_get_publication_task_resources`
2. Resolve URLs and metadata with `ba_read_publication_plan_ref`
3. Run `ba_publish_direct` with `dryRun: true`
4. Publish for real

### Example Reddit publish
```json
{
  "projectId": 123,
  "channelType": "reddit",
  "title": "Linear courses are not failing because of content",
  "subreddit": "edtech",
  "text": "..."
}
```

### Example LinkedIn publish
```json
{
  "projectId": 123,
  "channelType": "linkedin",
  "text": "...",
  "imageUrl": "/uploads/example.png",
  "dryRun": true
}
```

## Seturon example flow
### Import
Use:
- `ba_import_publication_plan_file`

With:
```json
{
  "userId": 1,
  "planPath": "/Users/innokentyb/Documents/Claude/Projects/Seturon/content-pipeline-2026-04/08-automation/publication-plan.json"
}
```

### Resolve article URL
Use:
- `ba_read_publication_plan_ref`

With:
```json
{
  "projectId": 123,
  "ref": "article_knowledge.target_url"
}
```

### Read a LinkedIn post section
Use:
- `ba_read_publication_plan_asset`

With:
```json
{
  "projectId": 123,
  "assetRef": "linkedin_post_3_contrarian"
}
```

### Read resources for a concrete task
Use:
- `ba_get_publication_task_resources`

## Heuristics for Claude
- Prefer parser research before publishing when the topic, objections, or audience language are still unclear.
- Prefer saved parser templates for recurring project research instead of ad-hoc repeated queries.
- Prefer task-based flows when a task already exists.
- Prefer `ba_get_publication_task_resources` over raw asset reading when publishing a specific task.
- Prefer `ba_read_publication_plan_ref` for URLs, scalar metadata, or ref-linked values.
- Use `dryRun: true` before direct publish when channel routing is uncertain.
- Always record manual publication back with `ba_confirm_publication`.

## Safety rules
- Do not assume a file path outside `meta.pipeline_root` is readable through MCP.
- Do not expose channel secrets from returned config.
- Do not publish to unsupported channel types through `ba_publish_direct`.

## Related docs
- [docs/mcp-publication-server.md](/Users/innokentyb/Ba_post_planner/docs/mcp-publication-server.md)
- [docs/mcp-deployment.md](/Users/innokentyb/Ba_post_planner/docs/mcp-deployment.md)
