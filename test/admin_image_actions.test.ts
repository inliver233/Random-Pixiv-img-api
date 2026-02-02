import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import adminAuth from '../src/middlewares/adminAuth';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_DISABLED } from '../src/repositories/imagesRepo';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const errorHandler = require('../src/middlewares/errorHandler.js');

const mockAuditAdminImageStatusChange = vi.fn();

vi.mock('../src/audit/adminAudit', () => ({
  auditAdminImageStatusChange: mockAuditAdminImageStatusChange,
}));

async function createApp() {
  const adminImagesActionsRouter = (await import('../src/routes/adminImagesActions')).default;
  const app = express();
  app.use('/admin', adminAuth, adminImagesActionsRouter);
  app.use(errorHandler);
  return app;
}

describe('POST /admin/images/:id/{disable|enable|delete}', () => {
  const prisma = {
    image: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    process.env.ADMIN_TOKEN = 'test-admin-token';
    setPrismaClientForTest(prisma);

    prisma.image.findUnique.mockReset();
    prisma.image.update.mockReset();
    mockAuditAdminImageStatusChange.mockReset();
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    delete process.env.ADMIN_TOKEN;
  });

  it('returns 401 when missing ADMIN_TOKEN', async () => {
    const app = await createApp();

    const res = await request(app)
      .post('/admin/images/1/disable')
      .set('accept', 'application/json')
      .expect(401);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toMatchObject({ code: 'UNAUTHORIZED' });
    expect(prisma.image.findUnique).not.toHaveBeenCalled();
    expect(mockAuditAdminImageStatusChange).not.toHaveBeenCalled();
  });

  it('disables an image and writes audit', async () => {
    prisma.image.findUnique.mockResolvedValueOnce({ id: 1n, status: IMAGE_STATUS_ACTIVE });
    prisma.image.update.mockResolvedValueOnce({ id: 1n, status: IMAGE_STATUS_DISABLED });

    const app = await createApp();

    const res = await request(app)
      .post('/admin/images/1/disable')
      .set('authorization', 'Bearer test-admin-token')
      .set('accept', 'application/json')
      .expect(200);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body).toEqual({
      ok: true,
      id: '1',
      from_status: IMAGE_STATUS_ACTIVE,
      to_status: IMAGE_STATUS_DISABLED,
      status: 'disabled',
    });

    expect(prisma.image.update).toHaveBeenCalledWith({ where: { id: 1n }, data: { status: IMAGE_STATUS_DISABLED } });
    expect(mockAuditAdminImageStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'image_disable',
        imageId: 1n,
        fromStatus: IMAGE_STATUS_ACTIVE,
        toStatus: IMAGE_STATUS_DISABLED,
      }),
    );
  });

  it('enables an image and writes audit', async () => {
    prisma.image.findUnique.mockResolvedValueOnce({ id: 2n, status: IMAGE_STATUS_DISABLED });
    prisma.image.update.mockResolvedValueOnce({ id: 2n, status: IMAGE_STATUS_ACTIVE });

    const app = await createApp();

    const res = await request(app)
      .post('/admin/images/2/enable')
      .set('authorization', 'Bearer test-admin-token')
      .set('accept', 'application/json')
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      id: '2',
      from_status: IMAGE_STATUS_DISABLED,
      to_status: IMAGE_STATUS_ACTIVE,
      status: 'active',
    });

    expect(prisma.image.update).toHaveBeenCalledWith({ where: { id: 2n }, data: { status: IMAGE_STATUS_ACTIVE } });
    expect(mockAuditAdminImageStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'image_enable',
        imageId: 2n,
        fromStatus: IMAGE_STATUS_DISABLED,
        toStatus: IMAGE_STATUS_ACTIVE,
      }),
    );
  });

  it('soft-deletes an image and writes audit', async () => {
    prisma.image.findUnique.mockResolvedValueOnce({ id: 3n, status: IMAGE_STATUS_ACTIVE });
    prisma.image.update.mockResolvedValueOnce({ id: 3n, status: IMAGE_STATUS_DISABLED });

    const app = await createApp();

    const res = await request(app)
      .post('/admin/images/3/delete')
      .set('authorization', 'Bearer test-admin-token')
      .set('accept', 'application/json')
      .expect(200);

    expect(res.body).toMatchObject({
      ok: true,
      id: '3',
      to_status: IMAGE_STATUS_DISABLED,
      status: 'disabled',
    });

    expect(mockAuditAdminImageStatusChange).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'image_delete',
        imageId: 3n,
        toStatus: IMAGE_STATUS_DISABLED,
      }),
    );
  });

  it('returns 400 for invalid id', async () => {
    const app = await createApp();

    const res = await request(app)
      .post('/admin/images/abc/disable')
      .set('authorization', 'Bearer test-admin-token')
      .set('accept', 'application/json')
      .expect(400);

    expect(res.body).toMatchObject({ code: 'INVALID_ID' });
    expect(prisma.image.findUnique).not.toHaveBeenCalled();
  });

  it('returns 404 when record does not exist', async () => {
    prisma.image.findUnique.mockResolvedValueOnce(null);

    const app = await createApp();

    const res = await request(app)
      .post('/admin/images/999/disable')
      .set('authorization', 'Bearer test-admin-token')
      .set('accept', 'application/json')
      .expect(404);

    expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
    expect(prisma.image.update).not.toHaveBeenCalled();
  });
});
