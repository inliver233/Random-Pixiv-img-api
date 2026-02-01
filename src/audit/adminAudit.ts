import logger from '../logger/logger';

type AdminAuditEvent = {
  category: 'admin';
  action: string;
  resource: string;
  record_id?: string;
  from_status?: number;
  to_status?: number;
  request_id?: string;
  ip?: string;
  user_agent?: string;
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

export function auditAdminEvent(event: Omit<AdminAuditEvent, 'category'>) {
  const full: AdminAuditEvent = { category: 'admin', ...event };
  logger.info({ audit: full }, 'audit');
}

export function auditAdminImageStatusChange(params: {
  action: 'image_enable' | 'image_disable';
  imageId: bigint;
  fromStatus?: number;
  toStatus: number;
  req?: any;
}) {
  const { action, imageId, fromStatus, toStatus, req } = params;

  auditAdminEvent({
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

