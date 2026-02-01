import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@prisma/client';

type PrismaClientInstance = InstanceType<typeof PrismaClient>;

declare global {
  // eslint-disable-next-line no-var
  var __prismaClient: PrismaClientInstance | undefined;
}

let injectedPrismaClient: PrismaClientInstance | undefined;
let prismaSingleton: PrismaClientInstance | undefined;

function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error('DATABASE_URL is required to create PrismaClient.');
  }
  return url;
}

function createPrismaClient(): PrismaClientInstance {
  const adapter = new PrismaPg({ connectionString: getDatabaseUrl() });
  return new PrismaClient({ adapter });
}

export function setPrismaClientForTest(client: PrismaClientInstance | undefined) {
  injectedPrismaClient = client;
}

export async function disconnectPrismaClient(): Promise<void> {
  const clientsToDisconnect: PrismaClientInstance[] = [];

  if (globalThis.__prismaClient) {
    clientsToDisconnect.push(globalThis.__prismaClient);
    globalThis.__prismaClient = undefined;
  }

  if (prismaSingleton) {
    clientsToDisconnect.push(prismaSingleton);
    prismaSingleton = undefined;
  }

  await Promise.all(clientsToDisconnect.map((client) => client.$disconnect()));
}

export function getPrismaClient(): PrismaClientInstance {
  if (injectedPrismaClient) return injectedPrismaClient;

  if (process.env.NODE_ENV !== 'production') {
    globalThis.__prismaClient ??= createPrismaClient();
    return globalThis.__prismaClient;
  }

  prismaSingleton ??= createPrismaClient();
  return prismaSingleton;
}
