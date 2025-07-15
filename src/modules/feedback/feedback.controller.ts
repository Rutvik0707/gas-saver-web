import { Request, Response } from 'express';
import { FeedbackService } from './feedback.service';
import { apiUtils } from '../../shared/utils';

export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  async submitFeedback(req: Request, res: Response) {
    const id = (req as any).user?.id;
    const { message, rating } = req.body;
    console.log((req as any).user);
    if (!id) {
      return res.status(401).json(
        apiUtils.error('User not authenticated')
      );
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json(
        apiUtils.error('Invalid feedback message')
      );
    }

    // Validate rating if provided
    const parsedRating = rating !== undefined ? parseInt(rating, 10) : null;
    if (parsedRating !== null && (isNaN(parsedRating) || parsedRating < 1 || parsedRating > 5)) {
      return res.status(400).json(
        apiUtils.error('Rating must be a number between 1 and 5')
      );
    }

    const feedback = await this.feedbackService.submitFeedback(id, message, parsedRating);

    res.json(apiUtils.success('Feedback submitted successfully', feedback));
  }

  async getAllFeedbacks(req: Request, res: Response) {
    const feedbacks = await this.feedbackService.getAllFeedbacks();
    res.json(apiUtils.success('Feedbacks retrieved successfully', feedbacks));
  }
}