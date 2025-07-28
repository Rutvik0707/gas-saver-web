import { Router } from 'express';
import { TronAddressController } from './tron-address.controller';
import { TronAddressService } from './tron-address.service';
import { TronAddressRepository } from './tron-address.repository';
import { authMiddleware } from '../../middleware/auth.middleware';

const router = Router();

// Initialize dependencies
const tronAddressRepository = new TronAddressRepository();
const tronAddressService = new TronAddressService(tronAddressRepository);
const tronAddressController = new TronAddressController(tronAddressService);

// All routes require authentication
router.use(authMiddleware);

// Routes
router.post('/', tronAddressController.addAddress.bind(tronAddressController));
router.get('/', tronAddressController.getUserAddresses.bind(tronAddressController));
router.get('/transactions', tronAddressController.getAddressTransactions.bind(tronAddressController));
router.get('/:addressId', tronAddressController.getAddress.bind(tronAddressController));
router.put('/:addressId/set-primary', tronAddressController.setPrimaryAddress.bind(tronAddressController));
router.put('/:addressId', tronAddressController.updateAddress.bind(tronAddressController));
router.delete('/:addressId', tronAddressController.deleteAddress.bind(tronAddressController));

export default router;