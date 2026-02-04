import { getPrismaClient } from '../db/prismaClient';

export type CreateRequestLogInput = {
  requestId?: string | null;
  method: string;
  route: string;
  url?: string | null;
  status: number;
  durationMs: number;
  ip?: string | null;
  userAgent?: string | null;
  sampleRate?: number | null;
};

export async function createRequestLog(input: CreateRequestLogInput): Promise<void> {
  const prisma = getPrismaClient();
  await prisma.requestLog.create({
    data: {
      requestId: input.requestId ?? null,
      method: input.method,
      route: input.route,
      url: input.url ?? null,
      status: Math.trunc(input.status),
      durationMs: Math.max(0, Math.trunc(input.durationMs)),
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      sampleRate: input.sampleRate ?? null,
    },
  });
}

export async function deleteRequestLogsBefore(cutoff: Date): Promise<number> {
  const prisma = getPrismaClient();
  const res = await prisma.requestLog.deleteMany({
    where: {
      createdAt: {
        lt: cutoff,
      },
    },
  });
  return Number(res.count || 0);
}

