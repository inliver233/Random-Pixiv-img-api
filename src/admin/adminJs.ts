import type { Router } from 'express';

import { getPrismaClient } from '../db/prismaClient';
import * as PrismaModule from '@prisma/client';

let cachedRouter: Router | null = null;
let cachedPromise: Promise<Router> | null = null;

export async function getAdminJsRouter(): Promise<Router> {
  if (cachedRouter) return cachedRouter;
  if (cachedPromise) return cachedPromise;

  cachedPromise = (async () => {
    const [adminJSImport, adminJSExpressImport, adminJSPrismaImport] = await Promise.all([
      import('adminjs'),
      import('@adminjs/express'),
      import('@adminjs/prisma'),
    ]);

    const AdminJS = (adminJSImport as any).default || adminJSImport;
    const AdminJSExpress = (adminJSExpressImport as any).default || adminJSExpressImport;
    const { Database, Resource, getModelByName } = adminJSPrismaImport as any;

    AdminJS.registerAdapter({ Database, Resource });

    const prismaClientModule = {
      Prisma: {
        // Avoid passing Prisma's strict-enum proxies into AdminJS options merging logic.
        // AdminJS Prisma adapter only needs access to DMMF (datamodel metadata).
        dmmf: (PrismaModule as any).Prisma?.dmmf,
      },
    };

    if (!prismaClientModule.Prisma.dmmf) {
      throw new Error('Prisma.dmmf is missing. Run `prisma generate` before starting the server.');
    }

    const prisma = getPrismaClient();

    const admin = new AdminJS({
      rootPath: '/admin',
      resources: [
        {
          resource: { model: getModelByName('Image', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: {},
        },
        {
          resource: { model: getModelByName('Tag', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: {},
        },
        {
          resource: { model: getModelByName('Import', prismaClientModule), client: prisma, clientModule: prismaClientModule },
          options: {},
        },
      ],
    });

    const router = AdminJSExpress.buildRouter(admin);
    cachedRouter = router;
    return router;
  })();

  try {
    return await cachedPromise;
  } finally {
    cachedPromise = null;
  }
}
