import { auditAdminModelChange } from '../../audit/adminAudit';
import { invalidateRuntimeCaches } from '../../config/runtimeConfig';
import { getPrismaClient } from '../../db/prismaClient';
import { testRefreshToken } from '../../services/pixivAuthService';

function maskSecret(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const prefixLen = 4;
  const suffixLen = 4;

  if (trimmed.length <= prefixLen + suffixLen) {
    return '*'.repeat(Math.max(8, trimmed.length));
  }

  return `${trimmed.slice(0, prefixLen)}...${trimmed.slice(-suffixLen)}`;
}

function stripSensitiveFields(recordParams: any): void {
  if (!recordParams || typeof recordParams !== 'object') return;
  delete recordParams.refreshToken;
}

function normalizeOptionalText(value: any): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function normalizeOptionalSecret(value: any): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s ? s : '';
}

function toBigIntId(value: any): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return BigInt(value.trim());
  throw new Error('Invalid record id');
}

export const pixivTokenResourceOptions = {
  navigation: { name: '令牌', icon: 'Key' },
  label: 'Pixiv Token',
  listProperties: [
    'id',
    'label',
    'enabled',
    'refreshTokenMasked',
    'updatedAt',
    'createdAt',
  ],
  filterProperties: [
    'enabled',
    'label',
    'createdAt',
    'updatedAt',
  ],
  actions: {
    new: {
      before: async (request: any) => {
        if (String(request?.method || '').toLowerCase() === 'get') return request;

        const payload = request?.payload && typeof request.payload === 'object'
          ? { ...request.payload }
          : {};

        const refreshToken = normalizeOptionalSecret(payload.refreshToken);
        if (!refreshToken) {
          throw new Error('refreshToken is required.');
        }

        payload.label = normalizeOptionalText(payload.label);
        payload.refreshToken = refreshToken;
        payload.refreshTokenMasked = maskSecret(refreshToken);

        return { ...request, payload };
      },
      after: async (response: any, request: any, context: any) => {
        const recordId = context?.record?.id?.() ?? context?.record?.params?.id;
        const payload = request?.payload && typeof request.payload === 'object' ? { ...request.payload } : undefined;
        if (payload && typeof payload === 'object') {
          delete (payload as any).refreshToken;
        }

        auditAdminModelChange({
          action: 'pixiv_token_create',
          resource: 'PixivToken',
          record_id: recordId === undefined || recordId === null ? undefined : String(recordId),
          req: request,
          detail: {
            payload,
            record: context?.record?.params
              ? {
                label: context.record.params.label,
                enabled: context.record.params.enabled,
                refreshTokenMasked: context.record.params.refreshTokenMasked,
              }
              : undefined,
          },
        });

        try {
          invalidateRuntimeCaches({ tokens: true });
        } catch {
          // best-effort
        }

        if (response?.record?.params) {
          stripSensitiveFields(response.record.params);
        }
        return response;
      },
    },

    edit: {
      before: async (request: any) => {
        if (String(request?.method || '').toLowerCase() === 'get') return request;

        const payload = request?.payload && typeof request.payload === 'object'
          ? { ...request.payload }
          : {};

        payload.label = normalizeOptionalText(payload.label);

        const refreshToken = normalizeOptionalSecret(payload.refreshToken);
        if (refreshToken === '') {
          // Empty means "keep existing".
          delete payload.refreshToken;
          delete payload.refreshTokenMasked;
        } else if (typeof refreshToken === 'string' && refreshToken.trim().length > 0) {
          payload.refreshToken = refreshToken;
          payload.refreshTokenMasked = maskSecret(refreshToken);
        } else {
          delete payload.refreshToken;
          delete payload.refreshTokenMasked;
        }

        return { ...request, payload };
      },
      after: async (response: any, request: any, context: any) => {
        // Hide refreshToken in both GET(edit form) and POST(edit save) responses.
        if (response?.record?.params) {
          response.record.params.refreshToken = '';
          stripSensitiveFields(response.record.params);
        }

        if (String(request?.method || '').toLowerCase() === 'get') {
          return response;
        }

        const recordId = context?.record?.id?.() ?? context?.record?.params?.id;
        const payload = request?.payload && typeof request.payload === 'object' ? { ...request.payload } : undefined;
        if (payload && typeof payload === 'object') {
          delete (payload as any).refreshToken;
        }

        auditAdminModelChange({
          action: 'pixiv_token_update',
          resource: 'PixivToken',
          record_id: recordId === undefined || recordId === null ? undefined : String(recordId),
          req: request,
          detail: {
            payload,
            record: context?.record?.params
              ? {
                label: context.record.params.label,
                enabled: context.record.params.enabled,
                refreshTokenMasked: context.record.params.refreshTokenMasked,
              }
              : undefined,
          },
        });

        try {
          invalidateRuntimeCaches({ tokens: true });
        } catch {
          // best-effort
        }

        return response;
      },
    },

    delete: {
      after: async (response: any, request: any, context: any) => {
        if (String(request?.method || '').toLowerCase() === 'get') return response;

        const recordId = context?.record?.id?.() ?? context?.record?.params?.id;

        auditAdminModelChange({
          action: 'pixiv_token_delete',
          resource: 'PixivToken',
          record_id: recordId === undefined || recordId === null ? undefined : String(recordId),
          req: request,
        });

        try {
          invalidateRuntimeCaches({ tokens: true });
        } catch {
          // best-effort
        }

        return response;
      },
    },

    testRefresh: {
      actionType: 'record',
      component: false,
      icon: 'Play',
      label: '测试刷新',
      guard: 'Refresh access token now?',
      handler: async (request: any, _res: any, context: any) => {
        const { record, currentAdmin, h, resource } = context;
        if (!record) throw new Error('Record is required');

        stripSensitiveFields(record.params);

        if (String(request?.method || '').toLowerCase() === 'get') {
          const jsonRecord = record.toJSON(currentAdmin);
          if (jsonRecord?.params) stripSensitiveFields(jsonRecord.params);
          return { record: jsonRecord };
        }

        const prisma = getPrismaClient();
        const id = toBigIntId(record.id?.() ?? record.params?.id);

        const token = await prisma.pixivToken.findUnique({
          where: { id },
          select: { id: true, enabled: true, label: true, refreshToken: true, refreshTokenMasked: true },
        });

        if (!token) {
          return {
            notice: { type: 'error', message: 'Not Found' },
            redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
          };
        }

        if (!token.enabled) {
          return {
            notice: { type: 'error', message: 'Token is disabled.' },
            redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
          };
        }

        const result = await testRefreshToken(token.refreshToken);

        auditAdminModelChange({
          action: result.ok ? 'pixiv_token_test_refresh_ok' : 'pixiv_token_test_refresh_fail',
          resource: 'PixivToken',
          record_id: token.id.toString(),
          req: request,
          detail: {
            ok: result.ok,
            label: token.label ?? null,
            refreshTokenMasked: token.refreshTokenMasked,
            status: result.ok ? 200 : result.status ?? null,
            code: result.ok ? null : result.code,
            message: result.ok ? null : result.message,
          },
        });

        const jsonRecord = record.toJSON(currentAdmin);
        if (jsonRecord?.params) stripSensitiveFields(jsonRecord.params);

        return {
          record: jsonRecord,
          notice: result.ok
            ? { type: 'success', message: `OK (expires_in=${result.expires_in}s)` }
            : { type: 'error', message: `${result.code}${result.status ? ` (${result.status})` : ''}: ${result.message}` },
          redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
        };
      },
    },
  },
  properties: {
    refreshToken: { isVisible: { list: false, filter: false, show: false, edit: true } },
    refreshTokenMasked: { isVisible: { list: true, filter: false, show: true, edit: false } },
  },
} as const;
