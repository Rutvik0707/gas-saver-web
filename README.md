# TRON Energy Broker API

A Node.js TypeScript API service that enables USDT (TRC-20) holders to convert their deposits into TRON ENERGY credits, eliminating the need to purchase TRX for network fees.

## 🚀 Features

- **User Registration & Authentication**: JWT-based auth with TRON wallet integration
- **USDT Deposit Processing**: Automatic detection and processing of TRC-20 USDT deposits
- **Credit System**: Convert USDT deposits to internal credits
- **Energy Delegation**: Automatic transfer of 1 TRX worth of ENERGY to user wallets
- **Real-time Monitoring**: Cron jobs for continuous deposit monitoring
- **Secure API**: Rate limiting, validation, and comprehensive error handling

## 🏗️ Architecture

The project follows a modular, domain-driven architecture:

```
src/
├── config/           # Configuration and external service setup
├── middleware/       # Express middleware (auth, validation, error handling)
├── modules/          # Feature modules
│   ├── user/         # User management and authentication
│   └── deposit/      # USDT deposit processing
├── services/         # Background services (cron, energy transfer)
├── shared/           # Common utilities, exceptions, and interfaces
└── types/            # Global TypeScript definitions
```

## 🛠️ Tech Stack

- **Runtime**: Node.js 18+ with TypeScript
- **Framework**: Express.js with async error handling
- **Database**: PostgreSQL with Prisma ORM
- **Blockchain**: TronWeb SDK for TRON network integration
- **Authentication**: JWT tokens with bcrypt password hashing
- **Validation**: Zod schemas for request validation
- **Background Jobs**: Node-cron for deposit monitoring
- **Logging**: Winston for structured logging

## 📋 Prerequisites

- Node.js 18 or higher
- PostgreSQL database
- TRON testnet account with private key
- USDT test tokens for testing

## 🚀 Quick Start

1. **Clone and install dependencies**:
   ```bash
   npm install
   ```

2. **Generate TRON testnet keys**:
   ```bash
   npm run generate-keys
   ```
   This creates testnet addresses and provides environment configuration.

3. **Set up environment variables**:
   ```bash
   cp .env.example .env
   # Edit .env with the generated keys and database configuration
   ```

4. **Configure database**:
   ```bash
   # Generate Prisma client
   npx prisma generate
   
   # Run database migrations
   npx prisma migrate dev
   
   # Seed test data
   npm run seed
   ```

5. **Get testnet tokens**:
   - Visit https://www.trongrid.io/shasta for free TRX
   - Get test USDT tokens for deposit testing

6. **Start development server**:
   ```bash
   npm run dev
   ```

The API will be available at `http://localhost:3000`

7. **Access API Documentation**:
   ```
   http://localhost:3000/api-docs
   ```

For detailed TRON testnet setup, see [TRON_TESTNET_SETUP.md](docs/TRON_TESTNET_SETUP.md)

## 📊 API Documentation

### 📖 Interactive Documentation
Access comprehensive API documentation with interactive testing:
- **Swagger UI**: `http://localhost:3000/api-docs`
- **OpenAPI JSON**: `http://localhost:3000/api-docs.json`

### 🔑 Authentication
All protected endpoints require JWT authentication:
```bash
Authorization: Bearer <your-jwt-token>
```

### 📋 Quick Reference

**Authentication & User Management:**
- `POST /api/v1/users/register` - Register with TRON address
- `POST /api/v1/users/login` - Login (get JWT token)
- `GET /api/v1/users/profile` - Get profile with credits/history
- `PUT /api/v1/users/profile` - Update profile
- `GET /api/v1/users/credits` - Get credit balance

**Deposit Management:**
- `GET /api/v1/deposits/wallet-info` - Get system wallet for deposits
- `GET /api/v1/deposits/my-deposits` - Get user's deposits
- `GET /api/v1/deposits/{id}` - Get deposit details
- `POST /api/v1/deposits/check` - Manual verification (dev)

**System:**
- `GET /health` - Health check with TRON connectivity

For complete documentation with examples, schemas, and testing interface, visit `/api-docs`

## 🔧 Development Commands

```bash
# Development with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start

# Database operations
npm run migrate        # Run migrations
npm run generate       # Generate Prisma client
npm run seed           # Seed test data
npx prisma studio      # Open database GUI

# Code quality
npm run lint           # Check linting
npm run lint:fix       # Fix linting issues
npm run format         # Format code with Prettier

# Testing
npm test               # Run tests
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Generate coverage report
```

## 💰 How It Works

1. **User Registration**: Users register with email, password, and their TRON wallet address
2. **Deposit USDT**: Users transfer USDT (TRC-20) to the system wallet address
3. **Automatic Detection**: Cron jobs monitor the blockchain for incoming USDT transfers
4. **Credit Assignment**: Confirmed deposits are converted to user credits (1:1 ratio)
5. **Energy Transfer**: System automatically sends 1 TRX worth of ENERGY to user's wallet
6. **Transaction History**: All operations are logged for transparency

## 🔐 Security Features

- JWT authentication with secure token generation
- Password hashing using bcrypt with salt rounds
- Request rate limiting to prevent abuse
- Input validation using Zod schemas
- Comprehensive error handling and logging
- CORS protection and security headers

## 🧪 Testing

The system includes endpoints for testing the deposit flow:

1. Register a user with your TRON testnet address
2. Get the system wallet address from `/api/v1/deposits/wallet-info`
3. Send test USDT to the system wallet
4. Use `/api/v1/deposits/check` to manually trigger deposit checking
5. Check your credits and transaction history

## 📝 Environment Variables

Key environment variables (see `.env.example`):

- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - Secret key for JWT tokens
- `TRON_PRIVATE_KEY` - TRON private key for system operations
- `SYSTEM_WALLET_ADDRESS` - TRON address for receiving deposits
- `USDT_CONTRACT_ADDRESS` - USDT TRC-20 contract address

## 🔄 Background Jobs

The system runs several cron jobs:

- **Deposit Checker** (every 30s): Verifies pending deposits on blockchain
- **Deposit Processor** (every 1m): Processes confirmed deposits and updates credits
- **Deposit Scanner** (every 2m): Scans for new deposits to system wallet

## 🚨 Important Notes

⚠️ **This is a testnet implementation** - Do not use real funds or mainnet keys

- All TRON operations use testnet
- Energy transfers are simulated for testing
- Use TRON testnet faucets to get test TRX and USDT
- Never commit private keys or sensitive data to version control

## 📈 Monitoring

The API includes comprehensive logging and monitoring:

- Structured JSON logging with Winston
- Health check endpoint with system status
- Transaction tracking and audit logs
- Error monitoring and alerting

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Run linting and formatting
6. Submit a pull request

## 📄 License

This project is licensed under the MIT License.