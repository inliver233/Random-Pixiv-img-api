export const importResourceOptions = {
  listProperties: [
    'id',
    'createdAt',
    'createdBy',
    'source',
    'total',
    'success',
    'failed',
  ],
  showProperties: [
    'id',
    'createdAt',
    'createdBy',
    'source',
    'total',
    'success',
    'failed',
    'detail',
  ],
  filterProperties: [
    'createdAt',
    'createdBy',
    'source',
  ],
  actions: {
    // Import records are append-only audit logs.
    new: { isVisible: false },
    edit: { isVisible: false },
    delete: { isVisible: false },
    bulkDelete: { isVisible: false },
  },
  properties: {
    detail: {
      type: 'mixed',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
  },
} as const;

