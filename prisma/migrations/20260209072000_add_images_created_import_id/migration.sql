-- AlterTable
ALTER TABLE "images" ADD COLUMN "created_import_id" BIGINT;

-- CreateIndex
CREATE INDEX "images_created_import_id_idx" ON "images"("created_import_id");

