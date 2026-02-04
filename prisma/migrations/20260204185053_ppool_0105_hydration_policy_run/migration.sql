-- CreateEnum
CREATE TYPE "HydrationRunType" AS ENUM ('manual', 'backfill');

-- CreateEnum
CREATE TYPE "HydrationRunStatus" AS ENUM ('pending', 'running', 'paused', 'canceled', 'completed', 'failed');

-- CreateTable
CREATE TABLE "hydration_policies" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "hydrate_on_import" BOOLEAN NOT NULL DEFAULT false,
    "opportunistic_hydrate" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,

    CONSTRAINT "hydration_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hydration_runs" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "HydrationRunType" NOT NULL,
    "status" "HydrationRunStatus" NOT NULL DEFAULT 'pending',
    "requested_by" TEXT,
    "criteria" JSONB,
    "cursor" JSONB,
    "total" INTEGER,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "success" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "last_error_msg" TEXT,

    CONSTRAINT "hydration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "hydration_policies_enabled" ON "hydration_policies"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "hydration_policies_name_uniq" ON "hydration_policies"("name");

-- CreateIndex
CREATE INDEX "hydration_runs_status_updated_at" ON "hydration_runs"("status", "updated_at");

-- CreateIndex
CREATE INDEX "hydration_runs_type_created_at" ON "hydration_runs"("type", "created_at");
