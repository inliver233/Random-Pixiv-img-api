import { getPrismaClient } from '../../db/prismaClient';
import { auditAdminImageStatusChange, auditAdminModelChange } from '../../audit/adminAudit';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_BROKEN, IMAGE_STATUS_DISABLED } from '../../repositories/imagesRepo';
import { enqueueHydrateMetadata } from '../../jobs/hydrateMetadata';
import { runWithTimeout } from '../utils/runWithTimeout';

function toBigIntId(value: any): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return BigInt(value.trim());
  throw new Error('Invalid record id');
}

function toBigIntValue(value: any, field: string): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === 'string' && value.trim()) return BigInt(value.trim());
  throw new Error(`Invalid ${field}`);
}

function toNumberOrNull(value: any): number | null {
  if (value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export const imageResourceOptions = {
  navigation: { name: '导入与图片', icon: 'Database' },
  label: '图片',
  listProperties: [
    'id',
    'illustId',
    'pageIndex',
    'status',
    'xRestrict',
    'width',
    'height',
    'userId',
  ],
  filterProperties: [
    'status',
    'illustId',
    'userId',
    'userName',
    'xRestrict',
    'orientation',
    'minWidth',
    'minHeight',
    'tag',
  ],
  actions: {
    // RAPI-0087 will introduce safe delete behavior (soft delete).
    new: { isVisible: false, isAccessible: false },
    edit: { isVisible: false, isAccessible: false },
    bulkDelete: { isVisible: false, isAccessible: false },

    delete: {
      actionType: 'record',
      component: false,
      icon: 'Trash2',
      guard: 'Soft delete this image? (status will become disabled)',
      isVisible: (context: any) => toNumberOrNull(context?.record?.params?.status) !== IMAGE_STATUS_DISABLED,
      handler: async (request: any, _res: any, context: any) => {
        const { record, currentAdmin, h, resource } = context;
        if (!record) throw new Error('Record is required');

        if (request?.method === 'get') {
          return { record: record.toJSON(currentAdmin) };
        }

        const prisma = getPrismaClient();
        const imageId = toBigIntId(record.id?.() ?? record.params?.id);
        const fromStatus = toNumberOrNull(record.params?.status) ?? undefined;
        const toStatus = IMAGE_STATUS_DISABLED;

        await prisma.image.update({ where: { id: imageId }, data: { status: toStatus } });
        record.params.status = toStatus;

        auditAdminImageStatusChange({
          action: 'image_delete',
          imageId,
          fromStatus,
          toStatus,
          req: request,
        });

        return {
          record: record.toJSON(currentAdmin),
          notice: { type: 'success', message: 'Deleted (soft)' },
          redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
        };
      },
    },

    enable: {
      actionType: 'record',
      component: false,
      icon: 'Play',
      guard: 'Enable this image?',
      isVisible: (context: any) => toNumberOrNull(context?.record?.params?.status) !== IMAGE_STATUS_ACTIVE,
      handler: async (request: any, _res: any, context: any) => {
        const { record, currentAdmin, h, resource } = context;
        if (!record) throw new Error('Record is required');

        if (request?.method === 'get') {
          return { record: record.toJSON(currentAdmin) };
        }

        const prisma = getPrismaClient();
        const imageId = toBigIntId(record.id?.() ?? record.params?.id);
        const fromStatus = toNumberOrNull(record.params?.status) ?? undefined;
        const toStatus = IMAGE_STATUS_ACTIVE;

        await prisma.image.update({ where: { id: imageId }, data: { status: toStatus } });
        record.params.status = toStatus;

        auditAdminImageStatusChange({
          action: 'image_enable',
          imageId,
          fromStatus,
          toStatus,
          req: request,
        });

        return {
          record: record.toJSON(currentAdmin),
          notice: { type: 'success', message: 'Enabled' },
          redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
        };
      },
    },

    disable: {
      actionType: 'record',
      component: false,
      icon: 'Pause',
      guard: 'Disable this image?',
      isVisible: (context: any) => toNumberOrNull(context?.record?.params?.status) === IMAGE_STATUS_ACTIVE,
      handler: async (request: any, _res: any, context: any) => {
        const { record, currentAdmin, h, resource } = context;
        if (!record) throw new Error('Record is required');

        if (request?.method === 'get') {
          return { record: record.toJSON(currentAdmin) };
        }

        const prisma = getPrismaClient();
        const imageId = toBigIntId(record.id?.() ?? record.params?.id);
        const fromStatus = toNumberOrNull(record.params?.status) ?? undefined;
        const toStatus = IMAGE_STATUS_DISABLED;

        await prisma.image.update({ where: { id: imageId }, data: { status: toStatus } });
        record.params.status = toStatus;

        auditAdminImageStatusChange({
          action: 'image_disable',
          imageId,
          fromStatus,
          toStatus,
          req: request,
        });

        return {
          record: record.toJSON(currentAdmin),
          notice: { type: 'success', message: 'Disabled' },
          redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
        };
      },
    },

    statusCounts: {
      actionType: 'resource',
      component: false,
      icon: 'BarChart2',
      handler: async (_req: any, _res: any, context: any) => {
        const prisma = getPrismaClient();
        const [total, active, disabled, broken, x0, x1, x2, xUnknown] = await Promise.all([
          prisma.image.count(),
          prisma.image.count({ where: { status: IMAGE_STATUS_ACTIVE } }),
          prisma.image.count({ where: { status: IMAGE_STATUS_DISABLED } }),
          prisma.image.count({ where: { status: IMAGE_STATUS_BROKEN } }),
          prisma.image.count({ where: { xRestrict: 0 } }),
          prisma.image.count({ where: { xRestrict: 1 } }),
          prisma.image.count({ where: { xRestrict: 2 } }),
          prisma.image.count({ where: { xRestrict: null } }),
        ]);

        const r18Total = x1 + x2;
        const r18Ratio = total > 0 ? r18Total / total : 0;

        return {
          meta: { total, active, disabled, broken, xRestrict: { x0, x1, x2, unknown: xUnknown, r18Total, r18Ratio } },
          notice: {
            type: 'success',
            message:
              `total:${total} active:${active} disabled:${disabled} broken:${broken} `
              + `x_restrict(all:${x0} r18:${x1} r18g:${x2} unknown:${xUnknown} r18_ratio:${(r18Ratio * 100).toFixed(1)}%)`,
          },
          redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
        };
      },
    },

    hydrateMetadata: {
      actionType: 'record',
      component: 'RecordActionRunner',
      icon: 'RefreshCw',
      label: '补全元信息（入队 hydrate_metadata）',
      guard: 'Enqueue hydrate_metadata for this illust now?',
      handler: async (request: any, _res: any, context: any) => {
        const { record, currentAdmin, h, resource } = context;
        if (!record) throw new Error('Record is required');

        if (request?.method === 'get') {
          return { record: record.toJSON(currentAdmin) };
        }

        const illustId = toBigIntValue(record.params?.illustId ?? record.params?.illust_id, 'illustId');
        const requestIdRaw = request?.request_id || request?.headers?.['x-request-id'];
        const requestId = typeof requestIdRaw === 'string' && requestIdRaw.trim() ? requestIdRaw.trim() : undefined;

        try {
          const enqueueResult = await runWithTimeout(enqueueHydrateMetadata(illustId, requestId), 5_000);
          if (enqueueResult.status === 'timeout') {
            auditAdminModelChange({
              action: 'image_hydrate_metadata_enqueue_timeout',
              resource: 'Image',
              record_id: record.id?.() ? String(record.id()) : String(record.params?.id),
              req: request,
              detail: { illust_id: illustId.toString(), request_id: requestId ?? null },
            });
            return {
              record: record.toJSON(currentAdmin),
              notice: { type: 'error', message: '入队超时（>5000ms），请稍后重试。' },
              redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
            };
          }
          if (enqueueResult.status === 'error') {
            throw new Error(enqueueResult.error);
          }

          const jobId = enqueueResult.value;

          auditAdminModelChange({
            action: 'image_hydrate_metadata_enqueue',
            resource: 'Image',
            record_id: record.id?.() ? String(record.id()) : String(record.params?.id),
            req: request,
            detail: {
              illust_id: illustId.toString(),
              job_id: jobId,
            },
          });

          return {
            record: record.toJSON(currentAdmin),
            notice: { type: 'success', message: `已入队 hydrate_metadata: ${jobId}` },
            redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
          };
        } catch (err: unknown) {
          const code = typeof (err as any)?.code === 'string' ? (err as any).code : '';
          const message = err instanceof Error ? err.message : String(err);

          auditAdminModelChange({
            action: 'image_hydrate_metadata_enqueue_failed',
            resource: 'Image',
            record_id: record.id?.() ? String(record.id()) : String(record.params?.id),
            req: request,
            detail: {
              illust_id: illustId.toString(),
              code: code || null,
              message,
            },
          });

          return {
            record: record.toJSON(currentAdmin),
            notice: { type: 'error', message: code ? `${code}: ${message}` : message },
            redirectUrl: h.recordActionUrl({ resourceId: resource.id(), recordId: record.id(), actionName: 'show' }),
          };
        }
      },
    },
  },
  properties: {
    status: {
      availableValues: [
        { value: String(IMAGE_STATUS_ACTIVE), label: 'active' },
        { value: String(IMAGE_STATUS_DISABLED), label: 'disabled' },
        { value: String(IMAGE_STATUS_BROKEN), label: 'broken' },
      ],
    },
    xRestrict: {
      availableValues: [
        { value: '0', label: 'all-ages' },
        { value: '1', label: 'R18' },
        { value: '2', label: 'R18G' },
      ],
    },
    minWidth: {
      type: 'number',
      isVisible: { list: false, show: false, edit: false, filter: true },
    },
    minHeight: {
      type: 'number',
      isVisible: { list: false, show: false, edit: false, filter: true },
    },
    tag: {
      type: 'string',
      isVisible: { list: false, show: false, edit: false, filter: true },
    },
  },
} as const;
