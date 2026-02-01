import { Router } from 'express';

import adminAuth from '../middlewares/adminAuth';

const router = Router();

router.use(adminAuth);

router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ ok: true });
});

export default router;

