import { Router } from 'express';

import imageByIdController from '../controllers/imageByIdController';

const router = Router();

router.get('/:id.:ext', (req, res) => {
  return imageByIdController.getImageById(req, res);
});

export default router;
