import { createApp } from './app';
import { config, logger, prisma, validateTronConnection } from './config';
import { cronService } from './services/cron.service';

async function startServer(): Promise<void> {
  try {
    logger.info('Starting Energy Broker API Server...');

    // Validate environment configuration
    logger.info('Environment configuration loaded', {
      nodeEnv: config.app.nodeEnv,
      port: config.app.port,
      tronNetwork: config.tron.network,
    });

    // Test database connection
    await prisma.$connect();
    logger.info('✅ Database connection established');

    // Validate TRON network connection (non-blocking)
    validateTronConnection().then(tronConnected => {
      if (tronConnected) {
        logger.info('✅ TRON network connection validated');
      } else {
        logger.warn('⚠️ TRON network connection failed - some features may not work');
      }
    }).catch(error => {
      logger.warn('⚠️ TRON network validation error:', error.message);
    });

    // Create Express application
    const app = createApp();

    // Start the server
    const server = app.listen(config.app.port, () => {
      logger.info(`🚀 Server running on port ${config.app.port}`);
      logger.info(`📚 API Documentation: http://localhost:${config.app.port}/api/${config.app.apiVersion}`);
      logger.info(`🏥 Health Check: http://localhost:${config.app.port}/health`);
    });

    // Release port immediately when connections are keep-alive
    server.keepAliveTimeout = 0;

    // Start cron jobs
    logger.info('🔄 Starting background services...');
    await cronService.start();
    logger.info('⏰ Background services started successfully');

    // Graceful shutdown handling
    const gracefulShutdown = async (signal: string) => {
      logger.info(`${signal} received, starting graceful shutdown...`);

      // Force exit after 1s so port is released before watch restarts
      const forceExit = setTimeout(() => process.exit(0), 1000);
      forceExit.unref();

      // Destroy all open connections immediately
      if ((server as any).closeAllConnections) {
        (server as any).closeAllConnections();
      }

      server.close(async () => {
        logger.info('HTTP server closed');
        try {
          await cronService.stop();
          await prisma.$disconnect();
          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during graceful shutdown', {
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          process.exit(1);
        }
      });
    };

    // Handle termination signals
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start server:', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Start the server if this file is executed directly
if (require.main === module) {
  startServer();
}