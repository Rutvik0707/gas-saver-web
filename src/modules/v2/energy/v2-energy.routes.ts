import { Router } from 'express';
import { apiKeyMiddleware } from '../../../middleware/api-key.middleware';
import { v2EnergyController } from './v2-energy.controller';

const router = Router();

router.use(apiKeyMiddleware);

router.post('/delegate', v2EnergyController.delegate.bind(v2EnergyController));
router.get('/check/:walletAddress', v2EnergyController.checkEnergy.bind(v2EnergyController));
router.get('/status/:id', v2EnergyController.getStatus.bind(v2EnergyController));
router.get('/history', v2EnergyController.getHistory.bind(v2EnergyController));

export { router as v2EnergyRoutes };
