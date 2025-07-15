import { Router } from 'express';
import { FeedbackController } from './feedback.controller';
import { FeedbackService } from './feedback.service';
import { authMiddleware } from '../../middleware/auth.middleware';

/**
 * @swagger
 * tags:
 *   name: Feedback
 *   description: API for user feedback
 */

/**
 * @swagger
 * /feedback:
 *   post:
 *     summary: Submit user feedback
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - message
 *             properties:
 *               message:
 *                 type: string
 *                 description: The feedback message
 *                 example: "Great platform! Love the energy trading features."
 *     responses:
 *       200:
 *         description: Feedback submitted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Feedback submitted successfully"
 *                 data:
 *                   type: object
 *       400:
 *         description: Invalid feedback message
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "Invalid feedback message"
 *       401:
 *         description: User not authenticated
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: false
 *                 message:
 *                   type: string
 *                   example: "User not authenticated"
 */

/**
 * @swagger
 * feedback/all:
 *   get:
 *     summary: Get all feedback submissions
 *     tags: [Feedback]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Feedbacks retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 message:
 *                   type: string
 *                   example: "Feedbacks retrieved successfully"
 *                 data:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       id:
 *                         type: string
 *                         example: "123e4567-e89b-12d3-a456-426614174000"
 *                       userId:
 *                         type: string
 *                         example: "user123"
 *                       message:
 *                         type: string
 *                         example: "Great platform!"
 *                       createdAt:
 *                         type: string
 *                         format: date-time
 *                         example: "2024-01-01T10:00:00.000Z"
 *       401:
 *         description: Unauthorized access
 */

const feedbackController = new FeedbackController(new FeedbackService());

export function createFeedbackRoutes(): Router {
  const router = Router();

  router.post('/', authMiddleware, feedbackController.submitFeedback.bind(feedbackController));
  router.get('/all', authMiddleware, feedbackController.getAllFeedbacks.bind(feedbackController));

  return router;
}

export const feedbackRoutes = createFeedbackRoutes();