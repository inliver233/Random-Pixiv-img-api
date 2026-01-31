import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setPrismaClientForTest } from '../src/db/prismaClient';
import { createImport, getById, updateImport } from '../src/repositories/importsRepo';

describe('importsRepo', () => {
  const prisma = {
    import: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
    },
  } as any;

  beforeEach(() => {
    setPrismaClientForTest(prisma);
  });

  afterEach(() => {
    setPrismaClientForTest(undefined);
    vi.clearAllMocks();
  });

  it('createImport sets defaults and writes audit row', async () => {
    prisma.import.create.mockResolvedValue({ id: 1n, total: 10, success: 0, failed: 0 });

    const res = await createImport({ total: 10, source: 'textarea' });

    expect(prisma.import.create).toHaveBeenCalledWith({
      data: {
        total: 10,
        createdBy: undefined,
        source: 'textarea',
        success: 0,
        failed: 0,
        detail: undefined,
      },
    });
    expect(res).toEqual({ id: 1n, total: 10, success: 0, failed: 0 });
  });

  it('updateImport updates audit row with detail', async () => {
    prisma.import.update.mockResolvedValue({ id: 1n });

    await updateImport({ id: 1n, success: 2, failed: 1, detail: { errors: ['bad url'] } });

    expect(prisma.import.update).toHaveBeenCalledWith({
      where: { id: 1n },
      data: {
        total: undefined,
        createdBy: undefined,
        source: undefined,
        success: 2,
        failed: 1,
        detail: { errors: ['bad url'] },
      },
    });
  });

  it('getById queries by id', async () => {
    prisma.import.findUnique.mockResolvedValue({ id: 2n });

    const res = await getById(2n);

    expect(prisma.import.findUnique).toHaveBeenCalledWith({ where: { id: 2n } });
    expect(res).toEqual({ id: 2n });
  });
});

