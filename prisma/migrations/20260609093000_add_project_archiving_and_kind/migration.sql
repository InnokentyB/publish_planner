ALTER TABLE "planner"."projects"
ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'content_network',
ADD COLUMN IF NOT EXISTS "is_archived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMP(3);

UPDATE "planner"."projects"
SET "kind" = 'content_network'
WHERE "kind" IS NULL OR btrim("kind") = '';

CREATE INDEX IF NOT EXISTS "projects_is_archived_idx" ON "planner"."projects"("is_archived");
CREATE INDEX IF NOT EXISTS "projects_kind_idx" ON "planner"."projects"("kind");
