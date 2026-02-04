export const adminAuditResourceOptions = {
  navigation: { name: '审计', icon: 'Shield' },
  label: '操作审计',
  listProperties: [
    'id',
    'createdAt',
    'actor',
    'action',
    'resource',
    'recordId',
    'ip',
  ],
  showProperties: [
    'id',
    'createdAt',
    'actor',
    'action',
    'resource',
    'recordId',
    'fromStatus',
    'toStatus',
    'requestId',
    'ip',
    'userAgent',
    'detail',
  ],
  filterProperties: [
    'createdAt',
    'actor',
    'action',
    'resource',
    'recordId',
    'requestId',
    'ip',
  ],
  actions: {
    // Audit logs are append-only.
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
