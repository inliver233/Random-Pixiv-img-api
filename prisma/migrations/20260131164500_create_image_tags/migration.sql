-- CreateTable
CREATE TABLE "image_tags" (
    "image_id" BIGINT NOT NULL,
    "tag_id" BIGINT NOT NULL,

    CONSTRAINT "image_tags_pkey" PRIMARY KEY ("image_id", "tag_id")
);

-- CreateIndex
CREATE INDEX "image_tags_tag" ON "image_tags"("tag_id", "image_id");

-- AddForeignKey
ALTER TABLE "image_tags" ADD CONSTRAINT "image_tags_image_id_fkey"
  FOREIGN KEY ("image_id") REFERENCES "images"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "image_tags" ADD CONSTRAINT "image_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

