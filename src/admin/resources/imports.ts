export const importResourceOptions = {
  navigation: { name: '数据', icon: 'Database' },
  label: '导入记录',
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
