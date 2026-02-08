/*
  Warnings:

  - You are about to drop the column `channel_id` on the `weeks` table. All the data in the column will be lost.
  - You are about to drop the `channels` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `project_id` to the `posts` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "posts" DROP CONSTRAINT "posts_week_id_fkey";

-- DropIndex
DROP INDEX "weeks_channel_id_week_start_week_end_key";

-- AlterTable
ALTER TABLE "posts" ADD COLUMN     "project_id" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "weeks" DROP COLUMN "channel_id";

-- DropTable
DROP TABLE "channels";

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" SERIAL NOT NULL,
    "topic" TEXT NOT NULL,
    "final_score" INTEGER NOT NULL DEFAULT 0,
    "total_iterations" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_iterations" (
    "id" SERIAL NOT NULL,
    "run_id" INTEGER NOT NULL,
    "iteration_number" INTEGER NOT NULL,
    "agent_role" TEXT NOT NULL,
    "input" TEXT NOT NULL,
    "output" TEXT NOT NULL,
    "score" INTEGER,
    "critique" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_iterations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_presets" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_presets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "author_role" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_keys" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_iterations_run_id_idx" ON "agent_iterations"("run_id");

-- CreateIndex
CREATE INDEX "comments_project_id_entity_type_entity_id_idx" ON "comments"("project_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "posts_project_id_idx" ON "posts"("project_id");

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_iterations" ADD CONSTRAINT "agent_iterations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "agent_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_presets" ADD CONSTRAINT "prompt_presets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
