import { Router } from 'express';
import { v2AuthController } from './v2-auth.controller';
import { authMiddleware } from '../../../middleware/auth.middleware';

const router = Router();

router.post('/register', (req, res) => v2AuthController.register(req, res));
router.post('/verify-otp', (req, res) => v2AuthController.verifyOtp(req, res));
router.post('/login', (req, res) => v2AuthController.login(req, res));
router.get('/me', authMiddleware, (req, res) => v2AuthController.me(req, res));

export { router as v2AuthRoutes };
