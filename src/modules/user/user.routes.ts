import { Router } from 'express';
import { UserController } from './user.controller';
import { authMiddleware } from '../../middleware/auth.middleware';

export function createUserRoutes(userController: UserController): Router {
  const router = Router();

  // Public routes
  router.post('/register', userController.register.bind(userController));
  router.post('/login', userController.login.bind(userController));
  
  // Password reset routes (public)
  router.post('/forgot-password', userController.forgotPassword.bind(userController));
  router.post('/reset-password', userController.resetPassword.bind(userController));

  // Protected routes
  router.use(authMiddleware);
  router.get('/profile', userController.getProfile.bind(userController));
  router.put('/profile', userController.updateProfile.bind(userController));
  router.get('/credits', userController.getCredits.bind(userController));
  router.get('/deposits', userController.getDepositHistory.bind(userController));
  router.get('/transactions', userController.getTransactionHistory.bind(userController));
  
  // Password management (protected)
  router.post('/change-password', userController.changePassword.bind(userController));

  return router;
}