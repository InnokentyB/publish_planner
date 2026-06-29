-- Rollback for dual-schema cutover.
-- Use only if application deployment fails after the schema move and you need to restore planner tables to public.

BEGIN;

ALTER TABLE IF EXISTS planner.users SET SCHEMA public;
ALTER TABLE IF EXISTS planner.projects SET SCHEMA public;
ALTER TABLE IF EXISTS planner.project_members SET SCHEMA public;
ALTER TABLE IF EXISTS planner.project_invitations SET SCHEMA public;
ALTER TABLE IF EXISTS planner.project_settings SET SCHEMA public;
ALTER TABLE IF EXISTS planner.social_channels SET SCHEMA public;
ALTER TABLE IF EXISTS planner.weeks SET SCHEMA public;
ALTER TABLE IF EXISTS planner.posts SET SCHEMA public;
ALTER TABLE IF EXISTS planner.week_memories SET SCHEMA public;
ALTER TABLE IF EXISTS planner.events SET SCHEMA public;
ALTER TABLE IF EXISTS planner.agent_runs SET SCHEMA public;
ALTER TABLE IF EXISTS planner.agent_iterations SET SCHEMA public;
ALTER TABLE IF EXISTS planner.prompt_settings SET SCHEMA public;
ALTER TABLE IF EXISTS planner.prompt_presets SET SCHEMA public;
ALTER TABLE IF EXISTS planner.comments SET SCHEMA public;
ALTER TABLE IF EXISTS planner.provider_keys SET SCHEMA public;
ALTER TABLE IF EXISTS planner.telegram_accounts SET SCHEMA public;
ALTER TABLE IF EXISTS planner.quarter_plans SET SCHEMA public;
ALTER TABLE IF EXISTS planner.month_arcs SET SCHEMA public;
ALTER TABLE IF EXISTS planner.week_packages SET SCHEMA public;
ALTER TABLE IF EXISTS planner.content_items SET SCHEMA public;
ALTER TABLE IF EXISTS planner.feedback_packages SET SCHEMA public;

COMMIT;
