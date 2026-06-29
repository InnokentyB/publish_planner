-- Post-cutover verification for planner/parser split.

-- Planner tables should now live in planner.
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'planner'
ORDER BY tablename;

-- Parser schema should exist, even if parser tables are not migrated yet.
SELECT schema_name
FROM information_schema.schemata
WHERE schema_name IN ('planner', 'parser')
ORDER BY schema_name;

-- Public should no longer contain planner domain tables.
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename IN (
    'users',
    'projects',
    'project_members',
    'project_invitations',
    'project_settings',
    'social_channels',
    'weeks',
    'posts',
    'week_memories',
    'events',
    'agent_runs',
    'agent_iterations',
    'prompt_settings',
    'prompt_presets',
    'comments',
    'provider_keys',
    'telegram_accounts',
    'quarter_plans',
    'month_arcs',
    'week_packages',
    'content_items',
    'feedback_packages'
  )
ORDER BY tablename;

-- Prisma migration table should remain in public.
SELECT schemaname, tablename
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename = '_prisma_migrations';
