import { Router } from 'express';
import { topupController } from './topup.controller';
import { authMiddleware } from '../../../middleware/auth.middleware';
import { v2RoleMiddleware } from '../../../middleware/v2-role.middleware';

const router = Router();

router.use(authMiddleware, v2RoleMiddleware);

router.post('/initiate', (req, res) => topupController.initiate(req, res));
router.get('/history', (req, res) => topupController.getHistory(req, res));
router.get('/:id/status', (req, res) => topupController.getStatus(req, res));

export { router as topupRoutes };
