import { Router } from 'express';
import upload from '../middleware/upload';
import * as imageController from '../controllers/imageController';

const router = Router();

router.post('/upload', upload.single('image'), imageController.upload);
router.get('/', imageController.list);
router.get('/:id/view', imageController.viewUrl);
router.get('/:id', imageController.getById);
router.delete('/:id', imageController.remove);

export default router;
