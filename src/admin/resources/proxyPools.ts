export const proxyPoolResourceOptions = {
  navigation: { name: '代理', icon: 'Network' },
  label: '代理池',
  listProperties: [
    'id',
    'name',
    'enabled',
    'description',
    'updatedAt',
    'createdAt',
  ],
  showProperties: [
    'id',
    'name',
    'enabled',
    'description',
    'updatedAt',
    'createdAt',
  ],
  filterProperties: [
    'enabled',
    'name',
    'updatedAt',
    'createdAt',
  ],
  actions: {
    // Start as read-only to avoid accidental destructive changes in production.
    new: { isVisible: false, isAccessible: false },
    edit: { isVisible: false, isAccessible: false },
    delete: { isVisible: false, isAccessible: false },
    bulkDelete: { isVisible: false, isAccessible: false },
  },
} as const;

