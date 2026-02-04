-- CreateTable
CREATE TABLE "request_log" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" TEXT,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "url" TEXT,
    "status" SMALLINT NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "sample_rate" REAL,

    CONSTRAINT "request_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "request_log_created_at" ON "request_log"("created_at");

-- CreateIndex
CREATE INDEX "request_log_route" ON "request_log"("route");

-- CreateIndex
CREATE INDEX "request_log_status" ON "request_log"("status");

