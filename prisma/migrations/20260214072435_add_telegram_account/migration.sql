-- CreateTable
CREATE TABLE "telegram_accounts" (
    "id" SERIAL NOT NULL,
    "project_id" INTEGER NOT NULL,
    "phone_number" TEXT NOT NULL,
    "session_string" TEXT NOT NULL,
    "api_id" INTEGER NOT NULL,
    "api_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_accounts_project_id_phone_number_key" ON "telegram_accounts"("project_id", "phone_number");

-- AddForeignKey
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
