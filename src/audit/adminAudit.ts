import logger from '../logger/logger';
import { getPrismaClient } from '../db/prismaClient';
import { extractAdminActor } from '../utils/redactionActor';
import { pickForwardedFor, safeRequestId } from '../utils/requestMeta';
import { sanitizeStructuredData } from '../utils/redaction';

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
  const full: AdminAuditEvent = {
    category: 'admin',
    ...event,
    detail: event.detail === undefined ? undefined : sanitizeStructuredData(event.detail),
  };
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
    actor: extractAdminActor(req),
    action,
    resource: 'Image',
    record_id: imageId.toString(),
    from_status: fromStatus,
    to_status: toStatus,
    request_id: safeRequestId(req),
    ip: req?.ip || pickForwardedFor(req),
    user_agent: req?.headers?.['user-agent'],
  });
}

export function auditAdminModelChange(params: {
  action: string;
  resource: string;
  record_id?: string;
  req?: any;
  detail?: unknown;
}) {
  const { action, resource, record_id, req, detail } = params;

  void auditAdminEvent({
    actor: extractAdminActor(req),
    action,
    resource,
    record_id,
    request_id: safeRequestId(req),
    ip: req?.ip || pickForwardedFor(req),
    user_agent: req?.headers?.['user-agent'],
    detail,
  });
}
