import swaggerJSDoc from 'swagger-jsdoc';
import { config } from './environment';

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'TRON Energy Broker API',
    version: '1.0.0',
    description: `
A Node.js TypeScript API service that enables USDT (TRC-20) holders to convert their deposits into TRON ENERGY credits.

## Core Features
- User registration and authentication with TRON wallet integration
- Automatic USDT deposit detection and processing
- Credit system for internal accounting
- Automated energy delegation to user wallets
- Real-time transaction monitoring and history
- Comprehensive admin dashboard with user and transaction management

## Authentication
Most endpoints require JWT authentication. After login, include the token in:
\`Authorization: Bearer <your-jwt-token>\`

**User Login:** \`/api/v1/users/login\`  
**Admin Login:** \`/api/v1/admin/login\`

⚠️ **Testnet Only:** Do not use real funds or mainnet addresses.
    `,
    contact: {
      name: 'Energy Broker API Support',
      email: 'support@energybroker.com',
    },
    license: {
      name: 'MIT',
      url: 'https://opensource.org/licenses/MIT',
    },
  },
  servers: [
    {
      url: `http://localhost:${config.app.port}/api/${config.app.apiVersion}`,
      description: 'Local development server',
    },
    {
      url: `https://energy-demo.scriptlanes.in/api/${config.app.apiVersion}`,
      description: 'Production server',
    },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token obtained from login endpoint',
      },
    },
    schemas: {
      FeedbackCreate: {
        type: 'object',
        required: ['message'],
        properties: {
          message: {
            type: 'string',
            example: 'This is my feedback about the service.',
          },
          rating: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            example: 4,
          },
        },
      },
      Feedback: {
        type: 'object',
        required: ['userId', 'message'],
        properties: {
          id: {
            type: 'string',
            example: 'clp1234567890abcdef',
          },
          userId: {
            type: 'string',
            example: 'clp1234567890abcdef',
          },
          message: {
            type: 'string',
            example: 'This is my feedback about the service.',
          },
          rating: {
            type: 'integer',
            minimum: 1,
            maximum: 5,
            example: 4,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      UserRegistration: {
        type: 'object',
        required: ['email', 'password', 'tronAddress'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'user@example.com',
          },
          password: {
            type: 'string',
            minLength: 8,
            example: 'securePassword123',
          },
          tronAddress: {
            type: 'string',
            pattern: '^T[A-Za-z1-9]{33}$',
            example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          },
        },
      },
      UserLogin: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'user@example.com',
          },
          password: {
            type: 'string',
            example: 'securePassword123',
          },
        },
      },
      UserUpdate: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'newemail@example.com',
          },
          tronAddress: {
            type: 'string',
            pattern: '^T[A-Za-z1-9]{33}$',
            example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          },
        },
      },
      UserResponse: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'clp1234567890abcdef',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'user@example.com',
          },
          tronAddress: {
            type: 'string',
            example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          },
          credits: {
            type: 'string',
            example: '100.500000',
          },
          isActive: {
            type: 'boolean',
            example: true,
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      LoginResponse: {
        type: 'object',
        properties: {
          user: { $ref: '#/components/schemas/UserResponse' },
          token: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
          },
          expiresIn: {
            type: 'string',
            example: '24h',
          },
        },
      },
      DepositResponse: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'clp1234567890abcdef',
          },
          userId: {
            type: 'string',
            example: 'clp1234567890abcdef',
          },
          txHash: {
            type: 'string',
            example: '0x1234567890abcdef...',
          },
          amountUsdt: {
            type: 'string',
            example: '100.500000',
          },
          status: {
            type: 'string',
            enum: ['PENDING', 'CONFIRMED', 'PROCESSED', 'FAILED'],
            example: 'CONFIRMED',
          },
          confirmed: {
            type: 'boolean',
            example: true,
          },
          blockNumber: {
            type: 'string',
            nullable: true,
            example: '12345678',
          },
          processedAt: {
            type: 'string',
            format: 'date-time',
            nullable: true,
            example: '2024-01-01T00:00:00.000Z',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      TransactionResponse: {
        type: 'object',
        properties: {
          id: { type: 'string', example: 'clp1234567890abcdef' },
          userId: { type: 'string', example: 'clp1234567890abcdef' },
          type: {
            type: 'string',
            enum: ['DEPOSIT', 'CREDIT', 'ENERGY_TRANSFER', 'ENERGY_RECEIVED'],
            example: 'DEPOSIT',
          },
          amount: { type: 'string', example: '100.500000' },
          txHash: {
            type: 'string',
            nullable: true,
            example: '0x1234567890abcdef...',
          },
          status: {
            type: 'string',
            enum: ['PENDING', 'COMPLETED', 'FAILED'],
            example: 'COMPLETED',
          },
          fromAddress: {
            type: 'string',
            nullable: true,
            example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          },
          toAddress: {
            type: 'string',
            nullable: true,
            example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
          },
          description: {
            type: 'string',
            nullable: true,
            example: 'Energy delegation...',
          },
          createdAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
          updatedAt: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      ApiResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          message: { type: 'string', example: 'Operation completed' },
          data: { type: 'object' },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          message: { type: 'string', example: 'An error occurred' },
          error: { type: 'string', example: 'Detailed error' },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      // Add any other schemas you have...
    },
  },
  tags: [
    { name: 'Authentication', description: 'User & admin auth' },
    { name: 'Feedback', description: 'User feedback operations' },
    { name: 'User Management', description: 'User profiles & updates' },
    { name: 'Deposits', description: 'Deposit monitoring' },
    { name: 'Transactions', description: 'Transactions & history' },
    { name: 'System', description: 'System info & health' },
    { name: 'Admin', description: 'Admin dashboard & management' },
  ],
};

const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    './src/app.ts',
    './src/routes/*.ts',
    './src/modules/**/*.routes.ts',
    './src/modules/**/*.controller.ts',
  ],
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);
