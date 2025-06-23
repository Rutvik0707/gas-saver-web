import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { BaseException } from '../shared/exceptions';
import { apiUtils } from '../shared/utils';
import { logger } from '../config';

export function errorMiddleware(
  error: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error('Error occurred', {
    error: error.message,
    stack: error.stack,
    path: req.path,
    method: req.method,
    body: req.body,
  });

  // Handle custom application exceptions
  if (error instanceof BaseException) {
    res.status(error.statusCode).json(
      apiUtils.error(error.message, error.details)
    );
    return;
  }

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    const validationErrors = error.errors.map(err => ({
      field: err.path.join('.'),
      message: err.message,
    }));

    res.status(400).json(
      apiUtils.error('Validation failed', JSON.stringify(validationErrors))
    );
    return;
  }

  // Handle Prisma errors
  if (error.name === 'PrismaClientKnownRequestError') {
    const prismaError = error as any;
    
    if (prismaError.code === 'P2002') {
      res.status(409).json(
        apiUtils.error('Unique constraint violation', prismaError.meta)
      );
      return;
    }

    if (prismaError.code === 'P2025') {
      res.status(404).json(
        apiUtils.error('Record not found')
      );
      return;
    }
  }

  // Handle unexpected errors
  res.status(500).json(
    apiUtils.error(
      'Internal server error',
      process.env.NODE_ENV === 'development' ? error.message : undefined
    )
  );
}