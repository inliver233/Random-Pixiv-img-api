import { afterEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { generateRandomKey } from '../src/domain/randomKey';
import { resetImageRandomKey, upsertImageForImport } from '../src/services/import/imageWriteService';

describe('randomKey', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    setPrismaClientForTest(undefined);
  });

  it('generateRandomKey returns value in [0,1)', () => {
    const value = generateRandomKey(() => 0.123);
    expect(value).toBe(0.123);
  });

  it('generateRandomKey rejects out-of-range values', () => {
    expect(() => generateRandomKey(() => -0.1)).toThrow(/\[0,1\)/);
    expect(() => generateRandomKey(() => 1)).toThrow(/\[0,1\)/);
  });

  it('upsertImageForImport generates randomKey when missing', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.42);

    const prisma = {
      image: {
        upsert: vi.fn().mockResolvedValue({ id: 1n }),
      },
    } as any;
    setPrismaClientForTest(prisma);

    await upsertImageForImport({
      illustId: 100n,
      pageIndex: 0,
      ext: 'jpg',
      originalUrl: 'https://i.pximg.net/img-original/img/xxx.jpg',
      proxyPath: '/i/1.jpg',
    });

    expect(prisma.image.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ randomKey: 0.42 }),
        update: expect.objectContaining({ randomKey: 0.42 }),
      }),
    );
  });

  it('resetImageRandomKey updates record with a new randomKey', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.9);

    const prisma = {
      image: {
        update: vi.fn().mockResolvedValue({ id: 1n }),
      },
    } as any;
    setPrismaClientForTest(prisma);

    await resetImageRandomKey(1n);

    expect(prisma.image.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: { randomKey: 0.9 },
    });
  });
});
