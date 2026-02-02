import { Router } from 'express';

import { auditAdminImageStatusChange } from '../audit/adminAudit';
import { getPrismaClient } from '../db/prismaClient';
import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_BROKEN, IMAGE_STATUS_DISABLED } from '../repositories/imagesRepo';

function parsePositiveBigInt(value: unknown): bigint {
  const raw = typeof value === 'string' ? value : String(value);
  if (!/^([1-9][0-9]*)$/.test(raw)) {
    const err = new Error('Invalid id.');
    (err as any).status = 400;
    (err as any).code = 'INVALID_ID';
    throw err;
  }
  return BigInt(raw);
}

function normalizeStatus(status: number): 'active' | 'disabled' | 'broken' {
  if (status === IMAGE_STATUS_ACTIVE) return 'active';
  if (status === IMAGE_STATUS_DISABLED) return 'disabled';
  if (status === IMAGE_STATUS_BROKEN) return 'broken';
  return 'broken';
}

async function updateStatus(
  req: any,
  res: any,
  next: any,
  action: 'image_enable' | 'image_disable' | 'image_delete',
  toStatus: number,
) {
  try {
    const id = parsePositiveBigInt(req?.params?.id);
    const prisma = getPrismaClient();

    const existing = await prisma.image.findUnique({
      where: { id },
      select: { id: true, status: true },
    });

    if (!existing) {
      const err = new Error('Not Found');
      (err as any).status = 404;
      (err as any).code = 'NOT_FOUND';
      throw err;
    }

    const fromStatus = existing.status;
    await prisma.image.update({ where: { id }, data: { status: toStatus } });

    auditAdminImageStatusChange({
      action,
      imageId: id,
      fromStatus,
      toStatus,
      req,
    });

    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({
      ok: true,
      id: id.toString(),
      from_status: fromStatus,
      to_status: toStatus,
      status: normalizeStatus(toStatus),
    });
  } catch (err: unknown) {
    next(err);
  }
}

const router = Router();

router.post('/images/:id/enable', (req, res, next) => updateStatus(req, res, next, 'image_enable', IMAGE_STATUS_ACTIVE));
router.post('/images/:id/disable', (req, res, next) => updateStatus(req, res, next, 'image_disable', IMAGE_STATUS_DISABLED));
router.post('/images/:id/delete', (req, res, next) => updateStatus(req, res, next, 'image_delete', IMAGE_STATUS_DISABLED));

export default router;

