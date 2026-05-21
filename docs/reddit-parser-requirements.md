# Reddit Parser Requirements for Ba Post Planner

## Status
Draft

## Purpose
Define product and technical requirements for the external `reddit-parser` service used by `Ba_post_planner` to collect audience signals, feedback, and content opportunities from Reddit.

## Background
`Ba_post_planner` already supports Reddit as a publishing and metrics channel. What is missing is a dedicated research pipeline that can:
- discover audience questions, pain points, objections, and language patterns on Reddit
- monitor mentions of our product, features, and competitors
- turn Reddit discussions into structured insights that improve content planning

The parser is treated as a separate service, not an in-process module of the planner.

## Product Goal
The service must help the planner answer these questions:
- What is the audience asking right now?
- What pain points repeat across subreddits?
- How do users describe their problems in their own language?
- Which competitor mentions and comparisons appear repeatedly?
- Which Reddit signals can be turned into weekly topics, briefs, and feedback packages?

## Primary Use Cases
1. Research content ideas before generating a weekly plan.
2. Collect recurring audience pain points for a project niche.
3. Track product, feature, or brand mentions on Reddit.
4. Track competitor and alternative solution mentions.
5. Extract quotes, objections, and vocabulary for better copywriting.
6. Re-run saved research templates daily or on demand.

## Scope
### In scope
- Reddit search and retrieval
- comment collection
- enrichment of posts, comments, authors, and subreddits
- query templates and scheduled reruns
- structured insight extraction for the planner
- API access for planner-triggered research jobs

### Out of scope for MVP
- advanced analytics dashboards inside the parser
- real-time streaming ingestion
- non-Reddit sources
- deep moderation workflows
- heavy internal UI work beyond basic inspection/debugging

## Functional Requirements

### 1. Search Jobs
The parser must support asynchronous search jobs.

It must allow:
- search by free-text query
- search by exact phrase
- search in one subreddit or multiple subreddits
- search within a date range
- configurable result limit
- configurable minimum score
- optional comment collection
- optional enrichment

The planner must be able to:
- create a search job
- poll job status
- fetch job results
- fetch aggregated summaries for a completed job

### 2. Post Collection
The parser must collect Reddit posts and normalize them into a stable contract.

Required post fields:
- `reddit_post_id`
- `subreddit`
- `title`
- `body`
- `author_name`
- `created_at`
- `score`
- `num_comments`
- `permalink`
- `url`
- `is_removed`
- `is_locked`
- `is_archived`
- `matched_query_id`
- `workspace_id`

Optional but recommended fields:
- `upvote_ratio`
- `flair`
- `external_links`
- `subreddit_subscribers_count`
- `subreddit_active_users_count`
- `subreddit_rules_snapshot_url`

### 3. Comment Collection
The parser must be able to collect comments for matched posts.

Required behavior:
- support top-level comments at minimum
- optionally include limited reply depth
- support configurable comment limit per post
- preserve relation to the source post
- sort comments predictably, preferably by score and time

Required comment fields:
- `reddit_comment_id`
- `reddit_post_id`
- `parent_id`
- `author_name`
- `body`
- `created_at`
- `score`
- `permalink`

### 4. Enrichment
The parser should enrich source data so the planner does not need to do raw Reddit interpretation itself.

Recommended enrichment:
- author account age
- author total karma
- author subreddit karma when available
- subreddit subscriber count
- subreddit active user count
- subreddit rules snapshot
- post-level derived text for matching and classification

### 5. Query Templates
The parser must support saved query templates.

Each template should support:
- `id`
- `name`
- `intent`
- `cluster`
- `priority`
- `subreddits`
- `query`
- `match_must_include_any`
- `exclude_if_contains`
- `exclude_regexes`
- `limit`
- `min_score`
- `include_comments`
- `enrich`
- scheduling metadata

The planner must be able to:
- create or import template banks
- list templates
- run a template immediately
- schedule daily reruns for selected templates

### 6. Feedback and Mention Tracking
The parser must support research flows focused on:
- product mentions
- feature mentions
- brand mentions
- competitor mentions
- alternative tools and workflows

It should support tagging results into categories such as:
- `pain_point`
- `question`
- `tool_request`
- `comparison`
- `recommendation`
- `complaint`
- `success_story`
- `workaround`
- `competitor_mention`

### 7. Insight Extraction
The parser must provide a structured insight layer above raw posts and comments.

Minimum insight types:
- pain points
- repeated questions
- objections
- competitor mentions
- repeated phrases / audience vocabulary
- content opportunities

Each insight should include:
- `insight_id`
- `type`
- `title`
- `summary`
- `evidence_count`
- `sample_quotes`
- `source_post_ids`
- `source_comment_ids`
- `subreddits`
- `first_seen_at`
- `last_seen_at`
- `confidence`
- `priority`

### 8. Summaries for Planning
The parser must expose planning-friendly outputs, not only raw Reddit entities.

Expected output groups:
- `topic_candidates`
- `pain_points`
- `questions_people_ask`
- `objections`
- `competitor_mentions`
- `language_patterns`
- `content_opportunities`

These outputs must be easy for `Ba_post_planner` to map into:
- weekly themes
- `ContentItem` briefs
- feedback packages
- project-specific research snapshots

## Project Isolation Requirements
The parser must support isolation by `workspace_id` or an equivalent project-scoping key.

Requirements:
- each planner project can own its own templates and jobs
- search results from different projects must not mix
- summaries and insights must be queryable per project/workspace
- idempotency and scheduling must respect project boundaries

## Planner Integration Requirements
The parser must be usable as an external service from `Ba_post_planner`.

### Required integration capabilities
- trigger search jobs from planner workflows
- poll job state from planner backend
- fetch structured results into planner services
- associate results with a planner project
- support periodic research refreshes

### Recommended integration style
The parser should expose a simple HTTP API with stable JSON contracts.

## API Expectations
The exact contract may evolve, but the service should provide endpoints equivalent to:
- `POST /search`
- `GET /search/{job_id}`
- `GET /posts`
- `GET /posts/{reddit_post_id}`
- `GET /insights`
- `GET /summaries/{job_id}`
- `GET /search-templates`
- `POST /search-templates/import`
- `POST /search-templates/{template_id}/run`
- `GET /health`

### API behavior requirements
- asynchronous job model for expensive work
- stable request and response envelopes
- machine-readable error codes
- request id / trace id support
- idempotency protection for job creation
- pagination for large result sets

## Data Quality Requirements
The parser must reduce noise before data reaches the planner.

Required anti-noise behavior:
- deduplicate repeated or overlapping posts
- skip removed, locked, archived, or sticky content when configured
- filter obviously low-value or spammy content
- support subreddit allowlists and denylists
- respect include/exclude matching rules from templates

## Non-Functional Requirements

### Reliability
- retry transient Reddit/API failures
- handle rate limiting gracefully
- allow partial success if comments or enrichment fail but posts are available
- persist job status and failure reason

### Performance
- search requests must not block UI interactions
- heavy work must run via worker/background processing
- result retrieval must support pagination

### Observability
The parser should expose enough state for support and debugging.

At minimum:
- job status
- counts of found posts/comments
- timestamps for job lifecycle
- reason for failed or partial runs
- request id on responses

### Security and Operations
- credentials must come from environment or secret storage
- no credentials in template payloads unless explicitly supported and encrypted
- workspace boundaries must be enforced server-side
- deployment should allow independent rollout from the planner

## MVP Definition
The first useful version for `Ba_post_planner` must include:
1. asynchronous search jobs
2. post collection
3. top comment collection
4. workspace/project isolation
5. saved query templates
6. daily rerun scheduling
7. basic enrichment for authors and subreddits
8. basic insight extraction for:
   - pain points
   - repeated questions
   - competitor mentions
   - repeated phrases
9. summary endpoint suitable for planner consumption

## Definition of Done
The integration is considered successful when the planner can:
1. trigger Reddit research for a specific project
2. retrieve structured insights for a date range or template run
3. use those insights to improve weekly planning or content briefs
4. persist resulting summaries or feedback packages in planner-owned models
5. repeat the process on a schedule without manual intervention

## Open Questions
These questions should be resolved before full implementation:
- Should insight extraction stay rule-based in MVP, or can it call an LLM summarizer?
- Should raw Reddit data be retained long-term or only summarized artifacts?
- Which exact subreddits are approved for each project domain?
- How much comment depth is actually needed for planning quality?
- Should competitor dictionaries live in the parser or in planner-managed config?

## Recommended Next Step
Define the API contract between `Ba_post_planner` and `reddit-parser`, then convert this document into an implementation backlog.
