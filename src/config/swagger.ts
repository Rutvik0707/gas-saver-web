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
    Most endpoints require authentication using JWT tokens. After successful login, include the token in the Authorization header:
    \`Authorization: Bearer <your-jwt-token>\`
    
    **User Authentication**: Use \`/api/v1/users/login\` for regular user access
    **Admin Authentication**: Use \`/api/v1/admin/login\` for admin dashboard access
    
    ## Testnet Notice
    ⚠️ This API operates on TRON testnet only. Do not use real funds or mainnet addresses.
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
      description: 'Development server',
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
      // User schemas
      UserRegistration: {
        type: 'object',
        required: ['email', 'password', 'tronAddress'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'user@example.com',
            description: 'Valid email address',
          },
          password: {
            type: 'string',
            minLength: 8,
            example: 'securePassword123',
            description: 'Password with minimum 8 characters',
          },
          tronAddress: {
            type: 'string',
            pattern: '^T[A-Za-z1-9]{33}$',
            example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            description: 'Valid TRON wallet address (Base58 format)',
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
            description: 'Unique user identifier (CUID)',
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
            description: 'User credit balance (decimal string)',
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
          user: {
            $ref: '#/components/schemas/UserResponse',
          },
          token: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            description: 'JWT authentication token',
          },
          expiresIn: {
            type: 'string',
            example: '24h',
            description: 'Token expiration time',
          },
        },
      },
      // Deposit schemas
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
            example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
            description: 'TRON transaction hash',
          },
          amountUsdt: {
            type: 'string',
            example: '100.500000',
            description: 'USDT amount (decimal string)',
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
            description: 'TRON block number where transaction was confirmed',
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
      // Transaction schemas
      TransactionResponse: {
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
          type: {
            type: 'string',
            enum: ['DEPOSIT', 'CREDIT', 'ENERGY_TRANSFER', 'ENERGY_RECEIVED'],
            example: 'DEPOSIT',
          },
          amount: {
            type: 'string',
            example: '100.500000',
          },
          txHash: {
            type: 'string',
            nullable: true,
            example: '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
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
            example: 'Energy delegation: 1 TRX worth of energy',
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
      // Response schemas
      ApiResponse: {
        type: 'object',
        properties: {
          success: {
            type: 'boolean',
            example: true,
          },
          message: {
            type: 'string',
            example: 'Operation completed successfully',
          },
          data: {
            type: 'object',
            description: 'Response data (varies by endpoint)',
          },
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
          success: {
            type: 'boolean',
            example: false,
          },
          message: {
            type: 'string',
            example: 'An error occurred',
          },
          error: {
            type: 'string',
            example: 'Detailed error description',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
        },
      },
      // System schemas
      HealthResponse: {
        type: 'object',
        properties: {
          status: {
            type: 'string',
            example: 'ok',
          },
          timestamp: {
            type: 'string',
            format: 'date-time',
            example: '2024-01-01T00:00:00.000Z',
          },
          version: {
            type: 'string',
            example: '1.0.0',
          },
          environment: {
            type: 'string',
            example: 'development',
          },
          tronNetwork: {
            type: 'string',
            example: 'testnet',
          },
          tronConnected: {
            type: 'boolean',
            example: true,
          },
        },
      },
      SystemWalletInfo: {
        type: 'object',
        properties: {
          address: {
            type: 'string',
            example: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
            description: 'System wallet address for USDT deposits',
          },
          network: {
            type: 'string',
            example: 'testnet',
          },
          supportedTokens: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['USDT (TRC-20)'],
          },
          minimumDeposit: {
            type: 'string',
            example: '1 USDT',
          },
          instructions: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: [
              '1. Send USDT (TRC-20) to the address above',
              '2. Deposits are processed automatically within 5-10 minutes',
              '3. Credits will be added to your account once confirmed',
              '4. You will receive 1 TRX worth of ENERGY automatically',
            ],
          },
        },
      },
      // Admin schemas
      AdminLogin: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'admin@example.com',
          },
          password: {
            type: 'string',
            example: 'adminPassword123',
          },
        },
      },
      CreateAdminDto: {
        type: 'object',
        required: ['email', 'password'],
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'newadmin@example.com',
          },
          password: {
            type: 'string',
            minLength: 8,
            example: 'securePassword123',
          },
          name: {
            type: 'string',
            example: 'John Admin',
          },
          role: {
            type: 'string',
            enum: ['SUPER_ADMIN', 'ADMIN', 'VIEWER'],
            default: 'ADMIN',
            example: 'ADMIN',
          },
          permissions: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['view_users', 'edit_users', 'view_deposits'],
          },
        },
      },
      UpdateAdminDto: {
        type: 'object',
        properties: {
          email: {
            type: 'string',
            format: 'email',
            example: 'updated@example.com',
          },
          name: {
            type: 'string',
            example: 'Updated Name',
          },
          role: {
            type: 'string',
            enum: ['SUPER_ADMIN', 'ADMIN', 'VIEWER'],
            example: 'ADMIN',
          },
          permissions: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['view_users', 'edit_users'],
          },
          isActive: {
            type: 'boolean',
            example: true,
          },
        },
      },
      ChangePasswordDto: {
        type: 'object',
        required: ['currentPassword', 'newPassword'],
        properties: {
          currentPassword: {
            type: 'string',
            example: 'currentPassword123',
          },
          newPassword: {
            type: 'string',
            minLength: 8,
            example: 'newPassword123',
          },
        },
      },
      AdminResponse: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            example: 'clp1234567890abcdef',
          },
          email: {
            type: 'string',
            format: 'email',
            example: 'admin@example.com',
          },
          name: {
            type: 'string',
            example: 'John Admin',
          },
          role: {
            type: 'string',
            enum: ['SUPER_ADMIN', 'ADMIN', 'VIEWER'],
            example: 'ADMIN',
          },
          permissions: {
            type: 'array',
            items: {
              type: 'string',
            },
            example: ['view_users', 'edit_users', 'view_deposits'],
          },
          isActive: {
            type: 'boolean',
            example: true,
          },
          lastLoginAt: {
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
      AdminLoginResponse: {
        type: 'object',
        properties: {
          admin: {
            $ref: '#/components/schemas/AdminResponse',
          },
          token: {
            type: 'string',
            example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
            description: 'JWT authentication token for admin',
          },
          expiresIn: {
            type: 'string',
            example: '8h',
            description: 'Token expiration time',
          },
        },
      },
      DashboardStats: {
        type: 'object',
        properties: {
          users: {
            type: 'object',
            properties: {
              total: { type: 'number', example: 1250 },
              active: { type: 'number', example: 1100 },
              inactive: { type: 'number', example: 150 },
              recentRegistrations: { type: 'number', example: 25 },
            },
          },
          deposits: {
            type: 'object',
            properties: {
              total: { type: 'number', example: 500 },
              pending: { type: 'number', example: 10 },
              confirmed: { type: 'number', example: 15 },
              processed: { type: 'number', example: 450 },
              failed: { type: 'number', example: 20 },
              expired: { type: 'number', example: 5 },
              totalAmount: { type: 'string', example: '125000.500000' },
              recentDeposits: { type: 'number', example: 35 },
            },
          },
          transactions: {
            type: 'object',
            properties: {
              total: { type: 'number', example: 2500 },
              pending: { type: 'number', example: 20 },
              completed: { type: 'number', example: 2400 },
              failed: { type: 'number', example: 80 },
              totalVolume: { type: 'string', example: '500000.750000' },
              recentTransactions: { type: 'number', example: 150 },
            },
          },
          addressPool: {
            type: 'object',
            properties: {
              total: { type: 'number', example: 100 },
              free: { type: 'number', example: 75 },
              assigned: { type: 'number', example: 15 },
              used: { type: 'number', example: 10 },
              utilization: { type: 'number', example: 25.0 },
            },
          },
          system: {
            type: 'object',
            properties: {
              uptime: { type: 'string', example: '86400' },
              tronConnectivity: { type: 'boolean', example: true },
              dbConnectivity: { type: 'boolean', example: true },
              lastCronRun: { type: 'string', format: 'date-time', example: '2024-01-01T00:00:00.000Z' },
            },
          },
        },
      },
    },
  },
  tags: [
    {
      name: 'Authentication',
      description: 'User registration and login endpoints',
    },
    {
      name: 'User Management',
      description: 'User profile and account management',
    },
    {
      name: 'Deposits',
      description: 'USDT deposit tracking and management',
    },
    {
      name: 'System',
      description: 'System health and information endpoints',
    },
    {
      name: 'Admin',
      description: 'Admin authentication and management endpoints',
    },
  ],
};

const swaggerOptions = {
  definition: swaggerDefinition,
  apis: [
    './src/modules/*/**.ts', // Include all module files
    './src/app.ts', // Include main app file
  ],
};

export const swaggerSpec = swaggerJSDoc(swaggerOptions);