-- CreateEnum for user roles (optional, can use String)
-- CREATE TYPE "UserRole" AS ENUM ('owner', 'editor', 'viewer');

-- ============================================
-- Step 1: Create new tables
-- ============================================

-- Users table
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Projects table
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- Project members (team collaboration)
CREATE TABLE "project_members" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_members_project_id_user_id_key" ON "project_members"("project_id", "user_id");

-- Project settings (replaces global PromptSettings)
CREATE TABLE "project_settings" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_settings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "project_settings_project_id_key_key" ON "project_settings"("project_id", "key");

-- Social channels (replaces old channels table)
CREATE TABLE "social_channels" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_channels_pkey" PRIMARY KEY ("id")
);

-- ============================================
-- Step 2: Add foreign keys
-- ============================================

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" 
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" 
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "project_settings" ADD CONSTRAINT "project_settings_project_id_fkey" 
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "social_channels" ADD CONSTRAINT "social_channels_project_id_fkey" 
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ============================================
-- Step 3: Modify existing tables
-- ============================================

-- Add project_id to weeks table
ALTER TABLE "weeks" ADD COLUMN "project_id" INTEGER;

-- Remove old channel_id foreign key from weeks
ALTER TABLE "weeks" DROP CONSTRAINT IF EXISTS "weeks_channel_id_fkey";

-- Update posts table: channel_id becomes nullable and references social_channels
ALTER TABLE "posts" DROP CONSTRAINT IF EXISTS "posts_channel_id_fkey";
ALTER TABLE "posts" ALTER COLUMN "channel_id" DROP NOT NULL;

-- ============================================
-- Step 4: Data migration
-- ============================================

-- Create default user
INSERT INTO "users" ("email", "password_hash", "name", "updated_at")
VALUES ('admin@example.com', '$2b$10$YourHashHere', 'Admin', CURRENT_TIMESTAMP)
RETURNING id;

-- Create default project (using the first channel's info or a default name)
INSERT INTO "projects" ("name", "slug", "description", "updated_at")
VALUES ('Аналитик который думал', 'analyst', 'Default project migrated from single-channel setup', CURRENT_TIMESTAMP)
RETURNING id;

-- Get the IDs (you'll need to run this as a script to capture these)
-- For now, we'll use subqueries

-- Link admin user to default project as owner
INSERT INTO "project_members" ("project_id", "user_id", "role")
SELECT p.id, u.id, 'owner'
FROM "projects" p, "users" u
WHERE p.slug = 'analyst' AND u.email = 'admin@example.com';

-- Migrate old channels to social_channels
INSERT INTO "social_channels" ("project_id", "type", "name", "config", "updated_at")
SELECT 
    (SELECT id FROM "projects" WHERE slug = 'analyst'),
    'telegram',
    c.name,
    jsonb_build_object(
        'telegram_channel_id', c.telegram_channel_id,
        'bot_token', '',
        'chat_id', c.telegram_channel_id
    ),
    CURRENT_TIMESTAMP
FROM "channels" c;

-- Update weeks to reference the default project
UPDATE "weeks" 
SET "project_id" = (SELECT id FROM "projects" WHERE slug = 'analyst')
WHERE "project_id" IS NULL;

-- Make project_id NOT NULL after data migration
ALTER TABLE "weeks" ALTER COLUMN "project_id" SET NOT NULL;

-- Add foreign key for weeks.project_id
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_project_id_fkey" 
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Update posts to reference new social_channels
-- Map old channel_id to new social_channels id
UPDATE "posts" p
SET "channel_id" = sc.id
FROM "channels" c
JOIN "social_channels" sc ON sc.config->>'telegram_channel_id' = c.telegram_channel_id::text
WHERE p.channel_id = c.id;

-- Add foreign key for posts.channel_id
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_fkey" 
    FOREIGN KEY ("channel_id") REFERENCES "social_channels"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Migrate PromptSettings to ProjectSettings
INSERT INTO "project_settings" ("project_id", "key", "value", "updated_at")
SELECT 
    (SELECT id FROM "projects" WHERE slug = 'analyst'),
    ps.key,
    ps.value,
    ps.updated_at
FROM "prompt_settings" ps;

-- ============================================
-- Step 5: Drop old tables and constraints
-- ============================================

-- Remove old unique constraint from weeks
ALTER TABLE "weeks" DROP CONSTRAINT IF EXISTS "weeks_channel_id_week_start_week_end_key";

-- Add new unique constraint
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_project_id_week_start_week_end_key" 
    UNIQUE ("project_id", "week_start", "week_end");

-- Drop old channels table (after verifying migration)
-- DROP TABLE "channels";

-- Note: Keep PromptSettings for now as a backup, can drop later
-- DROP TABLE "prompt_settings";
