import { Router } from 'express';

const router = Router();

router.get('/:id.:ext', (req, res) => {
  res.status(501).json({ error: 'not_implemented', route: '/i/:id.:ext' });
});

export default router;

