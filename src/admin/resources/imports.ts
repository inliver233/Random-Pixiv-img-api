export const importResourceOptions = {
  navigation: { name: '导入与图片', icon: 'Database' },
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
    'enqueuedJobId',
    'lastJobId',
    'enqueueNote',
    'adminJobsUrl',
    'lastErrorCode',
    'lastErrorMessage',
    'detail',
  ],
  filterProperties: [
    'createdAt',
    'createdBy',
    'source',
  ],
  actions: {
    // Import records are append-only audit logs.
    new: { isVisible: false, isAccessible: false },
    edit: { isVisible: false, isAccessible: false },
    delete: { isVisible: false, isAccessible: false },
    bulkDelete: { isVisible: false, isAccessible: false },
    show: {
      after: async (response: any) => {
        const record = response?.record;
        const params = record?.params;
        if (!record || !params) return response;

        let detailRaw: any = params.detail;
        if (typeof detailRaw === 'string' && detailRaw.trim()) {
          try {
            detailRaw = JSON.parse(detailRaw);
          } catch {
            // ignore
          }
        }

        const detail = detailRaw && typeof detailRaw === 'object' ? detailRaw : null;
        const job = detail && typeof (detail as any).job === 'object' ? (detail as any).job : null;

        const enqueuedJobId = typeof job?.enqueued_job_id === 'string' && job.enqueued_job_id.trim()
          ? job.enqueued_job_id.trim()
          : null;
        const lastJobId = typeof job?.last_job_id === 'string' && job.last_job_id.trim()
          ? job.last_job_id.trim()
          : null;
        const enqueueNote = typeof detail?.enqueued?.note === 'string' && detail.enqueued.note.trim()
          ? detail.enqueued.note.trim()
          : null;

        const bestJobId = lastJobId ?? enqueuedJobId;
        const adminJobsUrl = bestJobId ? `/admin/pages/adminJobs?job_id=${encodeURIComponent(bestJobId)}` : null;

        const enqueueError = job && typeof job.enqueue_error === 'object' ? job.enqueue_error : null;
        const errors = detail && Array.isArray((detail as any).errors) ? (detail as any).errors : [];
        const lastErrorCode = typeof enqueueError?.code === 'string' && enqueueError.code.trim()
          ? enqueueError.code.trim()
          : (typeof errors?.[0]?.code === 'string' && errors[0].code.trim() ? errors[0].code.trim() : null);
        const lastErrorMessage = typeof enqueueError?.message === 'string' && enqueueError.message.trim()
          ? enqueueError.message.trim()
          : (typeof errors?.[0]?.message === 'string' && errors[0].message.trim() ? errors[0].message.trim() : null);

        record.params.enqueuedJobId = enqueuedJobId;
        record.params.lastJobId = lastJobId;
        record.params.enqueueNote = enqueueNote;
        record.params.adminJobsUrl = adminJobsUrl;
        record.params.lastErrorCode = lastErrorCode;
        record.params.lastErrorMessage = lastErrorMessage;

        return response;
      },
    },
  },
  properties: {
    detail: {
      type: 'mixed',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    enqueuedJobId: {
      type: 'string',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    lastJobId: {
      type: 'string',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    enqueueNote: {
      type: 'string',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    adminJobsUrl: {
      type: 'string',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    lastErrorCode: {
      type: 'string',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
    lastErrorMessage: {
      type: 'string',
      isVisible: { list: false, show: true, edit: false, filter: false },
    },
  },
} as const;
