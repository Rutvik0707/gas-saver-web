import { Router } from 'express';
import { UserController } from './user.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

export function createUserRoutes(userController: UserController): Router {
  const router = Router();

  // Public routes
  router.post('/register', userController.register.bind(userController));
  router.post('/login', userController.login.bind(userController));
  
  // OTP and email verification routes (public)
  router.post('/verify-otp', userController.verifyOtp.bind(userController));
  router.post('/resend-otp', userController.resendOtp.bind(userController));
  router.get('/verify-email', userController.verifyEmail.bind(userController));
  
  // Password reset routes (public)
  router.post('/forgot-password', userController.forgotPassword.bind(userController));
  router.post('/reset-password', userController.resetPassword.bind(userController));

  // Protected routes
  router.use(authMiddleware);
  router.get('/profile', userController.getProfile.bind(userController));
  router.put('/profile', userController.updateProfile.bind(userController));
  router.get('/credits', userController.getCredits.bind(userController));
  router.get('/deposits', userController.getDeposits.bind(userController));
  router.get('/transactions', userController.getTransactions.bind(userController));
  
  // Password management (protected)
  router.post('/change-password', userController.changePassword.bind(userController));

  return router;
}