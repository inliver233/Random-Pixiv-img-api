-- CreateTable
CREATE TABLE "admin_audit" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "record_id" TEXT,
    "from_status" SMALLINT,
    "to_status" SMALLINT,
    "request_id" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "detail" JSONB,

    CONSTRAINT "admin_audit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "admin_audit_created_at" ON "admin_audit"("created_at");

-- CreateIndex
CREATE INDEX "admin_audit_action" ON "admin_audit"("action");

-- CreateIndex
CREATE INDEX "admin_audit_resource" ON "admin_audit"("resource");

-- CreateIndex
CREATE INDEX "admin_audit_record_id" ON "admin_audit"("record_id");

