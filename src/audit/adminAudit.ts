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

const REDACTED_VALUE = '[REDACTED]';
const TRUNCATED_VALUE = '[TRUNCATED]';
const CIRCULAR_VALUE = '[CIRCULAR]';

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

function extractAdminActor(req: any): string | undefined {
  const user = req?.session?.admin_user;
  if (typeof user === 'string' && user.trim()) return user.trim();
  if (user !== undefined && user !== null) return String(user);
  if (req?.session?.admin) return 'admin_session';
  return 'admin_token';
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return false;

  if (normalized.includes('password')) return true;
  if (normalized === 'refresh_token' || normalized === 'refreshtoken') return true;
  if (normalized === 'authorization' || normalized === 'cookie') return true;
  if (normalized.includes('secret')) return true;
  return false;
}

function redactString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return value;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('bearer ')) {
    return `Bearer ${REDACTED_VALUE}`;
  }

  try {
    const url = new URL(trimmed);
    if (url.password) {
      url.password = REDACTED_VALUE;
      return url.toString();
    }
  } catch {
    // ignore
  }

  return value;
}

function sanitizeAuditDetail(detail: unknown): unknown {
  const seen = new WeakSet<object>();

  const walk = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined) return value;
    if (typeof value === 'string') return redactString(value);
    if (typeof value !== 'object') return value;

    if (depth > 8) return TRUNCATED_VALUE;

    const obj = value as object;
    if (seen.has(obj)) return CIRCULAR_VALUE;
    seen.add(obj);

    if (Array.isArray(obj)) {
      return obj.map((item) => walk(item, depth + 1));
    }

    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
      if (isSensitiveKey(k)) out[k] = REDACTED_VALUE;
      else out[k] = walk(v, depth + 1);
    }
    return out;
  };

  return walk(detail, 0);
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
  const full: AdminAuditEvent = {
    category: 'admin',
    ...event,
    detail: event.detail === undefined ? undefined : sanitizeAuditDetail(event.detail),
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
    request_id: getRequestId(req),
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
    request_id: getRequestId(req),
    ip: req?.ip || pickForwardedFor(req),
    user_agent: req?.headers?.['user-agent'],
    detail,
  });
}
