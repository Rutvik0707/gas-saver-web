import { Router } from 'express';
import { EnergyRateController } from './energy-rate.controller';
import { EnergyRateService } from './energy-rate.service';
import { EnergyRateRepository } from './energy-rate.repository';
import { authMiddleware as authenticate } from '../../middleware';
import { adminAuth } from '../../middleware/admin-auth.middleware';

const router = Router();

// Initialize dependencies
const energyRateRepository = new EnergyRateRepository();
const energyRateService = new EnergyRateService(energyRateRepository);
const energyRateController = new EnergyRateController(energyRateService);

// Public routes (authenticated users can view rates)
router.get('/current', authenticate, energyRateController.getCurrentRate.bind(energyRateController));

// Admin routes
router.get('/', adminAuth, energyRateController.getAllRates.bind(energyRateController));
router.get('/history', adminAuth, energyRateController.getRateHistory.bind(energyRateController));
router.get('/:id', adminAuth, energyRateController.getRateById.bind(energyRateController));
router.post('/', adminAuth, energyRateController.createRate.bind(energyRateController));
router.put('/:id', adminAuth, energyRateController.updateRate.bind(energyRateController));

export default router;