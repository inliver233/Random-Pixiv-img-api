import { Router } from 'express';

import adminAuth from '../middlewares/adminAuth';
import adminImportRouter from './adminImport';
import adminImagesActionsRouter from './adminImagesActions';

const router = Router();

router.use(adminAuth);
router.use(adminImportRouter);
router.use(adminImagesActionsRouter);

if (process.env.NODE_ENV === 'test') {
  router.get('/', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ ok: true });
  });
} else {
  router.use((req, res, next) => {
    (async () => {
      // Lazy-load AdminJS in non-test environments to keep unit tests fast.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getAdminJsRouter } = require('../admin/adminJs') as typeof import('../admin/adminJs');
      const adminRouter = await getAdminJsRouter();
      adminRouter(req, res, next);
    })().catch(() => {
      res.setHeader('Cache-Control', 'no-store');
      res.status(503).json({ error: 'admin_not_ready' });
    });
  });
}

export default router;
