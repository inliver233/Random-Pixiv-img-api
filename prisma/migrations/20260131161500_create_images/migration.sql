-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "images" (
    "id" BIGSERIAL NOT NULL,
    "illust_id" BIGINT NOT NULL,
    "page_index" INTEGER NOT NULL,
    "ext" TEXT NOT NULL,
    "original_url" TEXT NOT NULL,
    "proxy_path" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "aspect_ratio" REAL,
    "orientation" SMALLINT,
    "x_restrict" SMALLINT,
    "ai_type" SMALLINT,
    "user_id" BIGINT,
    "user_name" TEXT,
    "title" TEXT,
    "created_at_pixiv" TIMESTAMP(3),
    "status" SMALLINT NOT NULL DEFAULT 1,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "last_fail_at" TIMESTAMP(3),
    "last_ok_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_msg" TEXT,
    "random_key" REAL NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "images_filter_idx" ON "images"("status", "x_restrict", "orientation", "width", "height", "random_key");

-- CreateIndex
CREATE UNIQUE INDEX "images_uniq" ON "images"("illust_id", "page_index");

