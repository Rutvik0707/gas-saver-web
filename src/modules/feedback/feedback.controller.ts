import { Request, Response } from 'express';
import { FeedbackService } from './feedback.service';
import { apiUtils } from '../../shared/utils';

export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  async submitFeedback(req: Request, res: Response) {
    const id = (req as any).user?.id;
    const { message } = req.body;
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

    const feedback = await this.feedbackService.submitFeedback(id, message);

    res.json(apiUtils.success('Feedback submitted successfully', feedback));
  }

  async getAllFeedbacks(req: Request, res: Response) {
    const feedbacks = await this.feedbackService.getAllFeedbacks();
    res.json(apiUtils.success('Feedbacks retrieved successfully', feedbacks));
  }
}