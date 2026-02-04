export const requestLogResourceOptions = {
  navigation: { name: '审计', icon: 'Clock' },
  label: '请求日志',
  listProperties: [
    'id',
    'createdAt',
    'method',
    'route',
    'status',
    'durationMs',
    'ip',
  ],
  showProperties: [
    'id',
    'createdAt',
    'requestId',
    'method',
    'route',
    'url',
    'status',
    'durationMs',
    'ip',
    'userAgent',
    'sampleRate',
  ],
  filterProperties: [
    'createdAt',
    'method',
    'route',
    'status',
    'requestId',
    'ip',
  ],
  actions: {
    // Request logs are append-only and may be cleaned up by retention.
    new: { isVisible: false },
    edit: { isVisible: false },
    delete: { isVisible: false },
    bulkDelete: { isVisible: false },
  },
} as const;

