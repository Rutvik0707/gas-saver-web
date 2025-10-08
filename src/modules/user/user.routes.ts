import { Router } from 'express';
import { UserController } from './user.controller';
import { authMiddleware } from '../../middleware/auth.middleware';
import { authRateLimiter, authenticatedRateLimiter } from '../../config/rate-limiters';
import telegramAuthRoutes from './telegram-auth.routes';

export function createUserRoutes(userController: UserController): Router {
  const router = Router();

  // Telegram authentication routes (public)
  router.use('/auth/telegram', telegramAuthRoutes);

  // Public routes - Registration flow
  router.post('/register', authRateLimiter, userController.register.bind(userController));
  router.post('/verify-registration-otp', authRateLimiter, userController.verifyRegistrationOtp.bind(userController));

  // Public routes - Login
  router.post('/login', authRateLimiter, userController.login.bind(userController));
  // Commented out - OTP-based login not required, only password-based login is needed
  // router.post('/login-otp', userController.loginWithOtp.bind(userController));
  // router.post('/verify-otp-login', userController.verifyOtpLogin.bind(userController));
  
  // OTP and email verification routes (public)
  // Commented out - these endpoints are replaced by the dual OTP verification flow
  // router.post('/verify-otp', userController.verifyOtp.bind(userController));
  // router.post('/resend-otp', userController.resendOtp.bind(userController));
  // router.get('/verify-email', userController.verifyEmail.bind(userController));
  
  // Password reset routes (public)
  router.post('/forgot-password', authRateLimiter, userController.forgotPassword.bind(userController));
  router.post('/verify-reset-otp', authRateLimiter, userController.verifyResetOtp.bind(userController));
  router.post('/reset-password', authRateLimiter, userController.resetPassword.bind(userController));

  // Protected routes
  router.use(authMiddleware);
  router.use(authenticatedRateLimiter); // Apply authenticated rate limiter to all protected routes
  router.get('/profile', userController.getProfile.bind(userController));
  router.put('/profile', userController.updateProfile.bind(userController));
  router.get('/credits', userController.getCredits.bind(userController));
  router.get('/deposits', userController.getDeposits.bind(userController));
  router.get('/transactions', userController.getTransactions.bind(userController));
  router.get('/dashboard', userController.getDashboard.bind(userController));
  
  // Password management (protected)
  router.post('/change-password', userController.changePassword.bind(userController));

  return router;
}