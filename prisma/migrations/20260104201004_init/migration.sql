-- CreateTable
CREATE TABLE "channels" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "telegram_channel_id" BIGINT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weeks" (
    "id" SERIAL NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "week_start" DATE NOT NULL,
    "week_end" DATE NOT NULL,
    "theme" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "regen_attempt" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "weeks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "posts" (
    "id" SERIAL NOT NULL,
    "week_id" INTEGER NOT NULL,
    "channel_id" INTEGER NOT NULL,
    "slot_date" DATE NOT NULL,
    "slot_index" INTEGER NOT NULL,
    "publish_at" TIMESTAMPTZ NOT NULL,
    "topic_index" INTEGER NOT NULL,
    "topic" TEXT,
    "generated_text" TEXT,
    "final_text" TEXT,
    "status" TEXT NOT NULL,
    "approval_message_id" BIGINT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "ts" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "entity_type" TEXT NOT NULL,
    "entity_id" INTEGER NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weeks_channel_id_week_start_week_end_key" ON "weeks"("channel_id", "week_start", "week_end");

-- CreateIndex
CREATE INDEX "posts_week_id_idx" ON "posts"("week_id");

-- CreateIndex
CREATE INDEX "posts_publish_at_idx" ON "posts"("publish_at");

-- CreateIndex
CREATE INDEX "posts_status_idx" ON "posts"("status");

-- AddForeignKey
ALTER TABLE "weeks" ADD CONSTRAINT "weeks_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "weeks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "posts" ADD CONSTRAINT "posts_channel_id_fkey" FOREIGN KEY ("channel_id") REFERENCES "channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
