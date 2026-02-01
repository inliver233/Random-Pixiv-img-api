import logger from '../logger/logger';
import { getPrismaClient } from '../db/prismaClient';

type AdminAuditEvent = {
  category: 'admin';
  actor?: string;
  action: string;
  resource: string;
  record_id?: string;
  from_status?: number;
  to_status?: number;
  request_id?: string;
  ip?: string;
  user_agent?: string;
  detail?: unknown;
};

function pickForwardedFor(req: any): string | undefined {
  const raw = req?.headers?.['x-forwarded-for'];
  if (!raw) return undefined;
  const value = Array.isArray(raw) ? raw[0] : String(raw);
  const first = value.split(',')[0]?.trim();
  return first || undefined;
}

function getRequestId(req: any): string | undefined {
  return req?.request_id || req?.headers?.['x-request-id'] || undefined;
}

async function persistAdminAudit(full: AdminAuditEvent): Promise<void> {
  try {
    const prisma = getPrismaClient();
    const model = (prisma as any).adminAudit;
    if (!model?.create) return;

    await model.create({
      data: {
        actor: full.actor ?? null,
        action: full.action,
        resource: full.resource,
        recordId: full.record_id ?? null,
        fromStatus: full.from_status ?? null,
        toStatus: full.to_status ?? null,
        requestId: full.request_id ?? null,
        ip: full.ip ?? null,
        userAgent: full.user_agent ?? null,
        detail: full.detail ?? undefined,
      },
    });
  } catch (err: unknown) {
    logger.warn(
      { err: { message: err instanceof Error ? err.message : String(err) } },
      'admin audit persist failed',
    );
  }
}

export function auditAdminEvent(event: Omit<AdminAuditEvent, 'category'>): Promise<void> {
  const full: AdminAuditEvent = { category: 'admin', ...event };
  logger.info({ audit: full }, 'audit');
  return persistAdminAudit(full);
}

export function auditAdminImageStatusChange(params: {
  action: 'image_enable' | 'image_disable' | 'image_delete';
  imageId: bigint;
  fromStatus?: number;
  toStatus: number;
  req?: any;
}) {
  const { action, imageId, fromStatus, toStatus, req } = params;

  void auditAdminEvent({
    actor: 'admin_token',
    action,
    resource: 'Image',
    record_id: imageId.toString(),
    from_status: fromStatus,
    to_status: toStatus,
    request_id: getRequestId(req),
    ip: req?.ip || pickForwardedFor(req),
    user_agent: req?.headers?.['user-agent'],
  });
}
