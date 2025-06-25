import { Request, Response, NextFunction } from 'express';
import { ZodSchema } from 'zod';

export function validateBody(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.body = schema.parse(req.body);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.query = schema.parse(req.query);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      req.params = schema.parse(req.params);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function validationMiddleware(schema: ZodSchema, type: 'body' | 'query' | 'params' = 'body') {
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      switch (type) {
        case 'body':
          req.body = schema.parse(req.body);
          break;
        case 'query':
          req.query = schema.parse(req.query);
          break;
        case 'params':
          req.params = schema.parse(req.params);
          break;
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}