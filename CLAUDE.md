# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TRON ENERGY Broker API service built with Node.js and TypeScript that enables USDT (TRC-20) holders to convert their deposits into TRON ENERGY credits, eliminating the need to purchase TRX for network fees.

**Current Implementation Status:** ✅ **COMPLETED** - Basic workflow fully implemented

**Core Business Flow:**
1. Users register with email, password, and TRON wallet address
2. Users deposit USDT to the system wallet address
3. Cron jobs automatically detect and verify USDT deposits
4. System credits user accounts and transfers 1 TRX worth of energy
5. All transactions are logged and tracked

## Technology Stack

- **Runtime:** Node.js 18 LTS
- **Language:** TypeScript 5
- **Framework:** Express.js + express-async-errors
- **Database:** PostgreSQL + Prisma ORM
- **Blockchain:** TronWeb SDK (testnet configured)
- **Validation:** Zod schemas for request validation
- **Logging:** Winston (JSON structured logging)
- **Security:** bcrypt password hashing, JWT auth, Helmet, rate limiting
- **Background Jobs:** Node-cron for deposit monitoring
- **Testing:** Jest (configured but tests not implemented yet)

## Architecture Overview

The codebase follows a domain-driven module structure:

```
src/
├── config/           # Configuration (environment, database, TRON, logging)
├── middleware/       # Express middleware (auth, validation, error handling)
├── modules/          # Feature modules (domain-driven design)
│   ├── user/         # User registration, login, profile management
│   └── deposit/      # USDT deposit detection and processing
├── services/         # Background services (cron jobs, energy transfer)
├── shared/           # Common utilities, exceptions, and interfaces
├── types/            # Global TypeScript definitions
├── app.ts            # Express application setup
└── server.ts         # Server entry point
```

**Implemented Components:**
- ✅ User module: registration, authentication, profile management
- ✅ Deposit module: USDT tracking, verification, processing
- ✅ Cron service: automated deposit monitoring and processing
- ✅ Energy service: simulated energy delegation to users
- ✅ Middleware: authentication, validation, error handling
- ✅ Database schema: users, deposits, transactions tables

## Development Commands

**Setup Commands:**
```bash
# Install dependencies
npm install

# Setup environment (copy and edit .env.example)
cp .env.example .env

# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev

# Seed test data
npm run seed
```

**Development Commands:**
```bash
# Development with hot reload
npm run dev

# Build the application
npm run build

# Start production server
npm start

# Database operations
npx prisma migrate dev      # Run new migrations
npx prisma generate         # Regenerate Prisma client
npx prisma studio          # Open database GUI
npm run seed               # Seed test data

# Code quality
npm run lint               # Check linting
npm run lint:fix           # Fix linting issues
npm run format             # Format code with Prettier

# Testing (configured but not implemented)
npm test
npm run test:watch
npm run test:coverage
```

## Implemented Business Logic

### User Management (src/modules/user/)
- **Registration:** Users register with email, password, and TRON wallet address
- **Authentication:** JWT-based login with bcrypt password hashing
- **Profile Management:** Update user info, view credits and transaction history
- **Credit System:** Track user credits from USDT deposits (1:1 ratio)

### Deposit Processing (src/modules/deposit/)
1. **Deposit Detection:** Cron jobs scan for USDT transfers to system wallet
2. **Verification:** Validate transactions on TRON blockchain
3. **Credit Assignment:** Convert confirmed USDT deposits to user credits
4. **Energy Transfer:** Automatically send 1 TRX worth of energy to user's wallet

### Background Services (src/services/)
- **Deposit Checker** (every 30s): Verifies pending deposits on blockchain
- **Deposit Processor** (every 1m): Processes confirmed deposits and updates credits
- **Deposit Scanner** (every 2m): Scans for new USDT transfers to system wallet
- **Energy Service:** Handles simulated energy delegation to user wallets

### Security Features
- JWT authentication with configurable expiration
- bcrypt password hashing with salt rounds
- Rate limiting (configurable via environment)
- Request validation using Zod schemas
- Comprehensive error handling and logging

## Performance Requirements

- **p95 latency:** < 300ms for REST endpoints
- **Throughput:** Support 100 deposits/minute
- **Uptime:** 99.9% monthly SLA
- **Deposit Detection:** ≤15 seconds from blockchain confirmation

## Database Schema (Prisma)

**Implemented Tables:**
- `users` - User profiles with email, password, TRON address, and credits
- `deposits` - USDT deposit tracking with status (PENDING/CONFIRMED/PROCESSED/FAILED)
- `transactions` - All system transactions including deposits, credits, and energy transfers

**Key Fields:**
- Users: id, email, passwordHash, tronAddress, credits, isActive
- Deposits: id, userId, txHash, amountUsdt, status, confirmed, blockNumber
- Transactions: id, userId, type, amount, txHash, status, fromAddress, toAddress

## Testing Strategy

- **Unit Tests:** ≥90% coverage requirement
- **Integration Tests:** API endpoints and database operations
- **E2E Tests:** Complete user journeys from deposit to delegation
- **Load Tests:** 100 concurrent users, deposit processing stress tests

## API Endpoints (Implemented)

**Authentication & User Management:**
- `POST /api/v1/users/register` - Register with email, password, TRON address
- `POST /api/v1/users/login` - User login (returns JWT token)
- `GET /api/v1/users/profile` - Get user profile with credits and history
- `PUT /api/v1/users/profile` - Update user profile
- `GET /api/v1/users/credits` - Get current credit balance
- `GET /api/v1/users/deposits` - Get deposit history
- `GET /api/v1/users/transactions` - Get transaction history

**Deposit Management:**
- `GET /api/v1/deposits/wallet-info` - Get system wallet address for deposits
- `GET /api/v1/deposits/my-deposits` - Get user's deposit history
- `GET /api/v1/deposits/:id` - Get specific deposit details
- `GET /api/v1/deposits/tx/:txHash` - Get deposit by transaction hash
- `POST /api/v1/deposits/check` - Manual deposit verification (dev/testing)
- `POST /api/v1/deposits/scan` - Manual deposit scan (dev/testing)

**System:**
- `GET /health` - Health check with system status and TRON connectivity

## API Documentation (Swagger)

**Comprehensive Documentation Available:**
- **Swagger UI**: `http://localhost:3000/api-docs` - Interactive API documentation
- **OpenAPI JSON**: `http://localhost:3000/api-docs.json` - Raw OpenAPI 3.0 specification
- **Documentation File**: `docs/API_DOCUMENTATION.md` - Detailed usage guide

**Swagger Features:**
- ✅ Complete OpenAPI 3.0 specification
- ✅ Interactive testing interface with authentication
- ✅ Detailed request/response schemas and examples
- ✅ Error response documentation with status codes
- ✅ Authentication flow documentation (JWT Bearer tokens)
- ✅ Organized by functional areas (Authentication, User Management, Deposits, System)

**Frontend Integration:**
- Use `/api-docs.json` for code generation tools
- All endpoints include example requests and responses
- Authentication requirements clearly documented
- Error handling patterns standardized

## Important Development Notes

**Current Status:** ✅ **FULLY IMPLEMENTED** - Basic workflow is complete and functional

**Testnet Configuration:**
- All TRON operations use Shasta testnet (https://api.shasta.trongrid.io)
- Energy transfers are simulated for development/testing
- Use TRON Shasta faucets to get test TRX and USDT
- Never use real funds or mainnet keys
- Built-in key generator: `npm run generate-keys`

**Environment Setup Required:**
- PostgreSQL database connection
- TRON testnet private keys and addresses
- System wallet for receiving USDT deposits
- JWT secret for authentication (minimum 32 characters)

**Important Setup Steps:**
1. Generate TRON keys: `npm run generate-keys`
2. Copy `.env.example` to `.env` and configure all variables  
3. Ensure JWT_SECRET is at least 32 characters long
4. Set up PostgreSQL database and update DATABASE_URL
5. Get test tokens from Shasta faucet: https://www.trongrid.io/shasta

**Key Implementation Details:**
- **Modular Architecture:** Each feature is in its own module with controller, service, repository
- **Error Handling:** Comprehensive exception handling with custom exception classes
- **Validation:** Zod schemas validate all API inputs
- **Logging:** Structured Winston logging for debugging and monitoring
- **Background Processing:** Node-cron handles automated deposit monitoring
- **Security:** JWT auth, bcrypt hashing, rate limiting, input validation

**Testing the Workflow:**
1. Start the server: `npm run dev`
2. Register a user with your testnet TRON address
3. Get system wallet from `/api/v1/deposits/wallet-info`
4. Send test USDT to the system wallet
5. Use `/api/v1/deposits/check` to trigger manual processing
6. Check your credits and transaction history

**Next Steps for Production:**
- Implement real TRON energy staking and delegation
- Add comprehensive test suite
- Set up proper TRON mainnet configuration
- Add admin dashboard and monitoring
- Implement proper WebSocket for real-time updates