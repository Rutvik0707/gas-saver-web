import { Router } from 'express';
import { apiKeyController } from './api-key.controller';
import { authMiddleware } from '../../../middleware/auth.middleware';
import { v2RoleMiddleware } from '../../../middleware/v2-role.middleware';

const router = Router();

// All routes require JWT + API_CLIENT role
router.use(authMiddleware, v2RoleMiddleware);

router.post('/', (req, res) => apiKeyController.generate(req, res));
router.get('/', (req, res) => apiKeyController.list(req, res));
router.delete('/:id', (req, res) => apiKeyController.revoke(req, res));

export { router as apiKeyRoutes };
