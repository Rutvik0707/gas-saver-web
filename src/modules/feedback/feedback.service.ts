import { prisma } from '../../config';

export class FeedbackService {
  async submitFeedback(userId: string, message: string, rating: number | null = null) {
    return prisma.feedback.create({
      data: {
        userId,
        message,
        rating,
      },
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });
  }

  async getAllFeedbacks() {
    return prisma.feedback.findMany({
      include: {
        user: {
          select: {
            id: true,
            email: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
