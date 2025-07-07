import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import swaggerUi from 'swagger-ui-express';
import 'express-async-errors';


import { config, validateTronConnection, swaggerSpec } from './config';
import { errorMiddleware } from './middleware';
import { userRoutes } from './modules/user';
import { depositRoutes } from './modules/deposit';
import { adminRoutes } from './modules/admin';
import { apiUtils } from './shared/utils';
import { feedbackRoutes } from './modules/feedback';


export function createApp(): express.Application {
  const app = express();

  // Global serialization fix for BigInt, Decimal, and Date
  const originalStringify = JSON.stringify;
  JSON.stringify = function(value, replacer, space) {
    return originalStringify(value, function(key, val) {
      if (typeof val === 'bigint') {
        return val.toString();
      }
      // Handle Prisma Decimal type
      if (val && typeof val === 'object' && 'toString' in val && val.constructor.name === 'Decimal') {
        return val.toString();
      }
      // Handle Date objects
      if (val instanceof Date) {
        return val.toISOString();
      }
      return typeof replacer === 'function' ? replacer(key, val) : val;
    }, space);
  };

  // Security middleware
  app.use(helmet());
  app.use(cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true,
  }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: apiUtils.error('Too many requests from this IP, please try again later.'),
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use(limiter);

  // Body parsing middleware
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Swagger documentation
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'TRON Energy Broker API Documentation',
    swaggerOptions: {
      persistAuthorization: true,
      displayRequestDuration: true,
      docExpansion: 'list',
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
    },
  }));

  // Swagger JSON endpoint
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(swaggerSpec);
  });

  /**
   * @swagger
   * /health:
   *   get:
   *     tags:
   *       - System
   *     summary: Health check
   *     description: Check the health status of the API server and its connections to external services.
   *     responses:
   *       200:
   *         description: Server is healthy
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
   *                   example: "Server is healthy"
   *                 data:
   *                   $ref: '#/components/schemas/HealthResponse'
   *                 timestamp:
   *                   type: string
   *                   format: date-time
   *       500:
   *         description: Server health check failed
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  app.get('/health', async (req, res) => {
    const tronConnected = await validateTronConnection();
    
    res.json(
      apiUtils.success('Server is healthy', {
        status: 'ok',
        timestamp: new Date().toISOString(),
        version: process.env.npm_package_version || '1.0.0',
        environment: config.app.nodeEnv,
        tronNetwork: config.tron.network,
        tronConnected,
      })
    );
  });

  // API routes
  const apiRouter = express.Router();
  
  // Mount module routes
  apiRouter.use('/users', userRoutes);
  apiRouter.use('/auth', userRoutes); // Auth routes are part of user module
  apiRouter.use('/deposits', depositRoutes);
  apiRouter.use('/admin', adminRoutes);
  apiRouter.use('/feedback', feedbackRoutes); // <-- Add this line

  // Mount API router
  app.use(`/api/${config.app.apiVersion}`, apiRouter);

  // 404 handler
  app.use('*', (req, res) => {
    res.status(404).json(
      apiUtils.error('Endpoint not found', `${req.method} ${req.originalUrl}`)
    );
  });

  // Global error handler (must be last)
  app.use(errorMiddleware);

  return app;
}