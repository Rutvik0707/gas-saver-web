import { Router } from 'express';
import { authMiddleware } from '../../../middleware/auth.middleware';
import { v2RoleMiddleware } from '../../../middleware/v2-role.middleware';
import { v2AccountController } from './v2-account.controller';

const router = Router();

router.use(authMiddleware, v2RoleMiddleware);

router.get('/profile', v2AccountController.getProfile.bind(v2AccountController));
router.get('/balance', v2AccountController.getBalance.bind(v2AccountController));
router.get('/usage', v2AccountController.getUsageHistory.bind(v2AccountController));

export { router as v2AccountRoutes };
