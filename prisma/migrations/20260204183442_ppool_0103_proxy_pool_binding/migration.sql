-- CreateTable
CREATE TABLE "proxy_pools" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "proxy_pools_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proxy_pool_endpoints" (
    "pool_id" BIGINT NOT NULL,
    "endpoint_id" BIGINT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proxy_pool_endpoints_pkey" PRIMARY KEY ("pool_id","endpoint_id")
);

-- CreateTable
CREATE TABLE "token_proxy_bindings" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "token_id" BIGINT NOT NULL,
    "pool_id" BIGINT NOT NULL,
    "primary_proxy_id" BIGINT NOT NULL,
    "override_proxy_id" BIGINT,
    "override_expires_at" TIMESTAMP(3),

    CONSTRAINT "token_proxy_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proxy_pools_enabled" ON "proxy_pools"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_pools_name_uniq" ON "proxy_pools"("name");

-- CreateIndex
CREATE INDEX "proxy_pool_endpoints_endpoint" ON "proxy_pool_endpoints"("endpoint_id", "pool_id");

-- CreateIndex
CREATE INDEX "proxy_pool_endpoints_enabled" ON "proxy_pool_endpoints"("pool_id", "enabled");

-- CreateIndex
CREATE INDEX "token_proxy_bindings_pool" ON "token_proxy_bindings"("pool_id");

-- CreateIndex
CREATE INDEX "token_proxy_bindings_primary_proxy" ON "token_proxy_bindings"("primary_proxy_id");

-- CreateIndex
CREATE INDEX "token_proxy_bindings_override_proxy" ON "token_proxy_bindings"("override_proxy_id");

-- CreateIndex
CREATE UNIQUE INDEX "token_proxy_bindings_token_pool_uniq" ON "token_proxy_bindings"("token_id", "pool_id");

-- AddForeignKey
ALTER TABLE "proxy_pool_endpoints" ADD CONSTRAINT "proxy_pool_endpoints_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "proxy_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proxy_pool_endpoints" ADD CONSTRAINT "proxy_pool_endpoints_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "proxy_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_proxy_bindings" ADD CONSTRAINT "token_proxy_bindings_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "pixiv_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_proxy_bindings" ADD CONSTRAINT "token_proxy_bindings_pool_id_fkey" FOREIGN KEY ("pool_id") REFERENCES "proxy_pools"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_proxy_bindings" ADD CONSTRAINT "token_proxy_bindings_primary_proxy_id_fkey" FOREIGN KEY ("primary_proxy_id") REFERENCES "proxy_endpoints"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "token_proxy_bindings" ADD CONSTRAINT "token_proxy_bindings_override_proxy_id_fkey" FOREIGN KEY ("override_proxy_id") REFERENCES "proxy_endpoints"("id") ON DELETE SET NULL ON UPDATE CASCADE;
