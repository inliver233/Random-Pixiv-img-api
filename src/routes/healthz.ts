import { Router } from 'express';

const router = Router();

router.get('/', (req, res) => {
  res.status(501).json({ error: 'not_implemented', route: '/healthz' });
});

export default router;

