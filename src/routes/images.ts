import { Router } from 'express';

import { IMAGE_STATUS_ACTIVE, IMAGE_STATUS_BROKEN, IMAGE_STATUS_DISABLED, getByIdWithTags } from '../repositories/imagesRepo';

const router = Router();

function parsePositiveInteger(value: unknown): bigint {
  const raw = typeof value === 'string' ? value : String(value);
  if (!/^([1-9][0-9]*)$/.test(raw)) {
    const err = new Error('Invalid id.');
    (err as any).status = 400;
    (err as any).code = 'INVALID_ID';
    throw err;
  }
  return BigInt(raw);
}

function bigintToSafeNumber(value: bigint, code: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n)) {
    const err = new Error('Integer out of safe range.');
    (err as any).status = 500;
    (err as any).code = code;
    throw err;
  }
  return n;
}

function normalizeStatus(status: number): 'active' | 'disabled' | 'broken' {
  if (status === IMAGE_STATUS_ACTIVE) return 'active';
  if (status === IMAGE_STATUS_DISABLED) return 'disabled';
  if (status === IMAGE_STATUS_BROKEN) return 'broken';
  return 'broken';
}

router.get('/:id', (req, res, next) => {
  (async () => {
    const id = parsePositiveInteger((req.params as any).id);

    const image = await getByIdWithTags(id);
    if (!image) {
      const err = new Error('Not Found');
      (err as any).status = 404;
      (err as any).code = 'NOT_FOUND';
      throw err;
    }

    const tags = (image.imageTags || []).map((row: any) => row.tag.name);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      id: bigintToSafeNumber(image.id, 'IMAGE_ID_OUT_OF_RANGE'),
      illust_id: bigintToSafeNumber(image.illustId, 'ILLUST_ID_OUT_OF_RANGE'),
      page_index: image.pageIndex,
      ext: image.ext,
      width: image.width ?? null,
      height: image.height ?? null,
      x_restrict: image.xRestrict ?? null,
      user_id: image.userId !== null && image.userId !== undefined ? bigintToSafeNumber(image.userId, 'USER_ID_OUT_OF_RANGE') : null,
      user_name: image.userName ?? null,
      status: normalizeStatus(image.status),
      tags,
      fail_count: image.failCount,
      last_fail_at: image.lastFailAt ?? null,
    });
  })().catch(next);
});

export default router;
