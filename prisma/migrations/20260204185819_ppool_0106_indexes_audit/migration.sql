-- CreateIndex
CREATE INDEX "images_user_random_idx" ON "images"("status", "user_id", "random_key");

-- CreateIndex
CREATE INDEX "images_created_at_pixiv_idx" ON "images"("created_at_pixiv");
