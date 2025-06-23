# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TRON ENERGY Broker API service built with Node.js and TypeScript that enables USDT (TRC-20) holders to convert their deposits into TRON ENERGY credits, eliminating the need to purchase TRX for network fees.

**Current Implementation Status:** ✅ **COMPLETED** - Address pool system with real energy delegation fully implemented

**Core Business Flow:**
1. Users register with email, password, and TRON wallet address
2. Users initiate deposits and receive unique TRON addresses from address pool
3. Users send USDT to their assigned address (no memo required)
4. Cron jobs automatically detect USDT transactions and process deposits
5. System credits user accounts and delegates real TRON energy to user wallets
6. All transactions are logged and tracked with proper blockchain validation

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
- ✅ Deposit module: address-based USDT tracking with unique addresses per deposit
- ✅ Address pool service: manages 100+ TRON addresses with encrypted private keys
- ✅ Cron service: automated transaction detection and deposit processing
- ✅ Energy service: real TRON energy delegation using delegateResource protocol
- ✅ Transaction detection: TronGrid API integration for real-time USDT monitoring
- ✅ Middleware: authentication, validation, error handling
- ✅ Database schema: users, deposits, address_pool, transactions tables

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

### Address Pool System (src/services/address-pool.service.ts)
1. **Address Generation:** Creates batches of TRON addresses with encrypted private keys
2. **Address Assignment:** Assigns unique addresses to deposits with 3-hour expiration
3. **Address Management:** Handles reuse, cleanup, and pool maintenance
4. **Pool Statistics:** Monitors free, assigned, and used addresses

### Deposit Processing (src/modules/deposit/)
1. **Deposit Initiation:** Users get unique TRON addresses from address pool
2. **Transaction Detection:** TronGrid API monitors assigned addresses for USDT transfers
3. **Verification:** Validates transactions on TRON blockchain with confirmation checks
4. **Credit Assignment:** Converts confirmed USDT deposits to user credits (1:1 ratio)
5. **Energy Delegation:** Uses TRON's delegateResource protocol to transfer real energy

### Background Services (src/services/)
- **Transaction Detector** (every 30s): Monitors assigned addresses for USDT transactions
- **Deposit Processor** (every 1m): Processes confirmed deposits and credits accounts
- **Address Pool Maintenance** (every hour): Releases expired assignments and auto-replenishes
- **Deposit Expirer** (every 5m): Expires old deposits and releases addresses
- **Energy Service:** Real TRON energy delegation to user wallets

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
- `deposits` - Address-based USDT deposit tracking with unique address assignments
- `address_pool` - Pool of TRON addresses with encrypted private keys and status management
- `transactions` - All system transactions including deposits, credits, and energy delegations

**Key Fields:**
- Users: id, email, passwordHash, tronAddress, credits, isActive
- Deposits: id, userId, assignedAddress, assignedAddressId, txHash, amountUsdt, expectedAmount, status, expiresAt
- AddressPool: id, address, privateKeyEncrypted, status (FREE/ASSIGNED/USED), assignedToDepositId, expiresAt, usageCount
- Transactions: id, userId, type, amount, txHash, status, fromAddress, toAddress, description

**Address Pool System:**
- **Address States**: FREE → ASSIGNED → USED → (cooldown) → FREE
- **Expiration**: 3-hour assignment expiration with automatic release
- **Security**: AES-256 encrypted private keys stored in database
- **Reuse**: Addresses can be reused after successful transactions and cooldown period

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
- `POST /api/v1/deposits/initiate` - Initiate deposit and get unique assigned address with QR code
- `GET /api/v1/deposits/:id/status` - Get real-time deposit status with confirmation count
- `GET /api/v1/deposits/pending` - Get user's pending deposits (not expired)
- `GET /api/v1/deposits/my-deposits` - Get user's deposit history with pagination
- `GET /api/v1/deposits/:id` - Get specific deposit details
- `GET /api/v1/deposits/tx/:txHash` - Get deposit by transaction hash
- `GET /api/v1/deposits/wallet-info` - Get system wallet info (deprecated - use initiate instead)
- `POST /api/v1/deposits/check` - Manual deposit verification (dev/testing)
- `POST /api/v1/deposits/scan` - Manual deposit scan (dev/testing)
- `POST /api/v1/deposits/detect` - Manual transaction detection (dev/testing)
- `POST /api/v1/deposits/process-transaction` - Manual transaction processing by hash (dev/testing)

**Address Pool Management:**
- `GET /api/v1/deposits/address-pool/stats` - Get address pool statistics (free, assigned, used)
- `POST /api/v1/deposits/address-pool/generate` - Generate new addresses for the pool (admin)

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

**Current Status:** ✅ **FULLY IMPLEMENTED** - Address pool system with real energy delegation complete

**Testnet Configuration:**
- All TRON operations use Shasta testnet (https://api.shasta.trongrid.io)
- Real energy delegation using TRON's delegateResource protocol
- TronGrid API integration for real-time transaction detection
- Use TRON Shasta faucets to get test TRX and USDT
- Never use real funds or mainnet keys
- Built-in key generator: `npm run generate-keys`

**Environment Setup Required:**
- PostgreSQL database connection
- TRON testnet private keys and addresses
- System wallet with staked TRX for energy delegation
- ENCRYPTION_SECRET for address pool private key encryption (AES-256)
- JWT secret for authentication (minimum 32 characters)

**Important Setup Steps:**
1. Generate TRON keys: `npm run generate-keys`
2. Copy `.env.example` to `.env` and configure all variables  
3. Ensure JWT_SECRET is at least 32 characters long
4. Set up PostgreSQL database and update DATABASE_URL
5. Get test tokens from Shasta faucet: https://www.trongrid.io/shasta

**Key Implementation Details:**
- **Address Pool System:** 100+ unique TRON addresses with AES-256 encrypted private keys
- **Real Energy Delegation:** Uses TRON's delegateResource protocol (not TRX transfers)
- **Transaction Detection:** TronGrid API integration for real-time USDT monitoring
- **Modular Architecture:** Each feature is in its own module with controller, service, repository
- **Error Handling:** Comprehensive exception handling with custom exception classes
- **Validation:** Zod schemas validate all API inputs
- **Logging:** Structured Winston logging for debugging and monitoring
- **Background Processing:** Node-cron handles automated deposit monitoring and address management
- **Security:** JWT auth, bcrypt hashing, rate limiting, input validation, encrypted key storage

**Testing the Address Pool Workflow:**
1. Start the server: `npm run dev` (auto-generates 100 addresses on startup)
2. Register a user with your testnet TRON address
3. Initiate deposit: `POST /api/v1/deposits/initiate` with amount
4. Get unique address and QR code for your deposit
5. Send test USDT to the assigned address (no memo required)
6. System auto-detects transaction and processes deposit
7. Check your credits and energy delegation in your TRON wallet

**Address Pool Management:**
- Check pool stats: `GET /api/v1/deposits/address-pool/stats`
- Generate more addresses: `POST /api/v1/deposits/address-pool/generate`
- Monitor address usage and auto-replenishment
- 3-hour expiration with automatic address release and reuse

**Real Energy Delegation:**
- System delegates actual TRON energy (not TRX tokens) to user wallets
- Users receive energy that can be used for USDT transaction fees
- Energy delegation uses TRON's official delegateResource contract
- Real blockchain transactions with proper validation and confirmation

**Next Steps for Production:**
- Add comprehensive test suite
- Set up proper TRON mainnet configuration
- Add admin dashboard and monitoring
- Implement proper WebSocket for real-time updates
- Add energy reclaim mechanisms for unused delegations