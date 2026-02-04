-- CreateTable
CREATE TABLE "runtime_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by" TEXT,
    "updated_from_ip" TEXT,
    "updated_request_id" TEXT,

    CONSTRAINT "runtime_settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "runtime_settings_updated_at" ON "runtime_settings"("updated_at");
