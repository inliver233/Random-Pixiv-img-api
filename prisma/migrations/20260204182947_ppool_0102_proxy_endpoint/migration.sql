-- CreateEnum
CREATE TYPE "ProxyScheme" AS ENUM ('http', 'https', 'socks4', 'socks5');

-- CreateTable
CREATE TABLE "proxy_endpoints" (
    "id" BIGSERIAL NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheme" "ProxyScheme" NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "username" TEXT NOT NULL DEFAULT '',
    "password" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_ref" TEXT,

    CONSTRAINT "proxy_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proxy_endpoints_enabled" ON "proxy_endpoints"("enabled");

-- CreateIndex
CREATE INDEX "proxy_endpoints_source" ON "proxy_endpoints"("source");

-- CreateIndex
CREATE UNIQUE INDEX "proxy_endpoints_identity" ON "proxy_endpoints"("scheme", "host", "port", "username");
