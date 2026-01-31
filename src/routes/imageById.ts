import { Router } from 'express';

import imageByIdController from '../controllers/imageByIdController';

const router = Router();

router.get('/:id.:ext', (req, res) => {
  void imageByIdController.getImageById(req, res);
});

export default router;
