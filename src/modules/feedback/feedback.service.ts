import { prisma } from '../../config';

export class FeedbackService {
  async submitFeedback(userId: string, message: string) {
    return prisma.feedback.create({
      data: {
        userId,
        message,
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
