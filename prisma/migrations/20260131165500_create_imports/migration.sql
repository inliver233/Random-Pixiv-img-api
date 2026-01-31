-- CreateTable
CREATE TABLE "imports" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "source" TEXT,
    "total" INTEGER NOT NULL,
    "success" INTEGER NOT NULL,
    "failed" INTEGER NOT NULL,
    "detail" JSONB,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("id")
);

