import { getPrismaClient } from '../../db/prismaClient';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_BROKEN, IMAGE_STATUS_DISABLED } from '../../repositories/imagesRepo';

export const imageResourceOptions = {
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
    // RAPI-0086/RAPI-0087 will introduce safe, explicit mutations (enable/disable/soft-delete).
    new: { isVisible: false },
    edit: { isVisible: false },
    delete: { isVisible: false },
    bulkDelete: { isVisible: false },

    statusCounts: {
      actionType: 'resource',
      icon: 'BarChart2',
      handler: async (_req: any, _res: any, context: any) => {
        const prisma = getPrismaClient();
        const [total, active, disabled, broken] = await Promise.all([
          prisma.image.count(),
          prisma.image.count({ where: { status: IMAGE_STATUS_ACTIVE } }),
          prisma.image.count({ where: { status: IMAGE_STATUS_DISABLED } }),
          prisma.image.count({ where: { status: IMAGE_STATUS_BROKEN } }),
        ]);

        return {
          meta: { total, active, disabled, broken },
          notice: {
            type: 'success',
            message: `total:${total} active:${active} disabled:${disabled} broken:${broken}`,
          },
          redirectUrl: context.h.resourceUrl({ resourceId: context.resource.id() }),
        };
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
