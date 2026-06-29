-- Purpose:
--   Maintenance-window cutover for the shared Supabase database.
--   Moves all planner-owned tables from public -> planner
--   and creates the parser schema for the reddit-parser stack.
--
-- Usage:
--   Run once while planner-app, planner-mcp, and any DB-writing jobs are stopped.
--
-- Notes:
--   1. _prisma_migrations is intentionally left in public.
--   2. Associated indexes, constraints, and owned serial sequences move with ALTER TABLE .. SET SCHEMA.
--   3. Parser tables are not created here; the parser repo should migrate them into parser later.

BEGIN;

CREATE SCHEMA IF NOT EXISTS planner;
CREATE SCHEMA IF NOT EXISTS parser;

ALTER TABLE IF EXISTS public.users SET SCHEMA planner;
ALTER TABLE IF EXISTS public.projects SET SCHEMA planner;
ALTER TABLE IF EXISTS public.project_members SET SCHEMA planner;
ALTER TABLE IF EXISTS public.project_invitations SET SCHEMA planner;
ALTER TABLE IF EXISTS public.project_settings SET SCHEMA planner;
ALTER TABLE IF EXISTS public.social_channels SET SCHEMA planner;
ALTER TABLE IF EXISTS public.weeks SET SCHEMA planner;
ALTER TABLE IF EXISTS public.posts SET SCHEMA planner;
ALTER TABLE IF EXISTS public.week_memories SET SCHEMA planner;
ALTER TABLE IF EXISTS public.events SET SCHEMA planner;
ALTER TABLE IF EXISTS public.agent_runs SET SCHEMA planner;
ALTER TABLE IF EXISTS public.agent_iterations SET SCHEMA planner;
ALTER TABLE IF EXISTS public.prompt_settings SET SCHEMA planner;
ALTER TABLE IF EXISTS public.prompt_presets SET SCHEMA planner;
ALTER TABLE IF EXISTS public.comments SET SCHEMA planner;
ALTER TABLE IF EXISTS public.provider_keys SET SCHEMA planner;
ALTER TABLE IF EXISTS public.telegram_accounts SET SCHEMA planner;
ALTER TABLE IF EXISTS public.quarter_plans SET SCHEMA planner;
ALTER TABLE IF EXISTS public.month_arcs SET SCHEMA planner;
ALTER TABLE IF EXISTS public.week_packages SET SCHEMA planner;
ALTER TABLE IF EXISTS public.content_items SET SCHEMA planner;
ALTER TABLE IF EXISTS public.feedback_packages SET SCHEMA planner;

COMMIT;
