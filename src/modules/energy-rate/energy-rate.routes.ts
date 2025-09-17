import { Router } from 'express';
import { EnergyRateController } from './energy-rate.controller';
import { EnergyRateService } from './energy-rate.service';
import { EnergyRateRepository } from './energy-rate.repository';
import { authMiddleware as authenticate } from '../../middleware';
import { adminAuthMiddleware } from '../../middleware/admin-auth.middleware';

const router = Router();

// Initialize dependencies
const energyRateRepository = new EnergyRateRepository();
const energyRateService = new EnergyRateService(energyRateRepository);
const energyRateController = new EnergyRateController(energyRateService);

// Admin routes
router.get('/current', adminAuthMiddleware, energyRateController.getCurrentRate.bind(energyRateController));
router.get('/', adminAuthMiddleware, energyRateController.getAllRates.bind(energyRateController));
router.get('/history', adminAuthMiddleware, energyRateController.getRateHistory.bind(energyRateController));
router.get('/:id', adminAuthMiddleware, energyRateController.getRateById.bind(energyRateController));
router.post('/', adminAuthMiddleware, energyRateController.createRate.bind(energyRateController));
router.put('/:id', adminAuthMiddleware, energyRateController.updateRate.bind(energyRateController));

export default router;