import { Router } from 'express';
import upload from '../middleware/upload';
import * as imageController from '../services/imageController';

const router = Router();

router.post('/upload', upload.single('image'), imageController.upload);
router.get('/', imageController.list);
router.get('/:id', imageController.getById);
router.delete('/:id', imageController.remove);

export default router;
