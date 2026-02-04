-- CreateTable
CREATE TABLE "pixiv_tokens" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "refresh_token" TEXT NOT NULL,
    "refresh_token_masked" TEXT NOT NULL,

    CONSTRAINT "pixiv_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pixiv_tokens_enabled" ON "pixiv_tokens"("enabled");
