import { Router } from 'express';

const router = Router();

router.get('/:id', (req, res) => {
  res.status(501).json({ error: 'not_implemented', route: '/images/:id' });
});

export default router;

