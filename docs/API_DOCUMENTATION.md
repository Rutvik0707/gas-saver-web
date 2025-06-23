# API Documentation

## Overview

The TRON Energy Broker API provides comprehensive Swagger/OpenAPI 3.0 documentation available at `/api-docs` when the server is running.

## Accessing API Documentation

### Swagger UI
Visit `http://localhost:3000/api-docs` to access the interactive Swagger UI where you can:
- Browse all available endpoints
- Test API calls directly from the browser
- View request/response schemas
- See example requests and responses
- Authenticate and test protected endpoints

### JSON Schema
The raw OpenAPI JSON specification is available at `http://localhost:3000/api-docs.json`

## Authentication

Most endpoints require authentication using JWT tokens. To authenticate:

1. **Register a new user**: `POST /api/v1/users/register`
2. **Login**: `POST /api/v1/users/login` - Returns a JWT token
3. **Use the token**: Include the token in the Authorization header for protected endpoints

### Using Authentication in Swagger UI

1. Open the Swagger UI at `/api-docs`
2. Click the "Authorize" button (lock icon) at the top right
3. Enter your JWT token in the format: `Bearer <your-token>`
4. Click "Authorize"
5. All subsequent API calls will include the authentication header

## API Endpoints Overview

### Authentication Endpoints
- `POST /api/v1/users/register` - Register new user with TRON address
- `POST /api/v1/users/login` - User login (returns JWT token)

### User Management Endpoints
- `GET /api/v1/users/profile` - Get user profile with credits and history
- `PUT /api/v1/users/profile` - Update user profile
- `GET /api/v1/users/credits` - Get current credit balance
- `GET /api/v1/users/deposits` - Get deposit history
- `GET /api/v1/users/transactions` - Get transaction history

### Deposit Management Endpoints
- `GET /api/v1/deposits/wallet-info` - Get system wallet for deposits
- `GET /api/v1/deposits/my-deposits` - Get user's deposit history
- `GET /api/v1/deposits/{id}` - Get specific deposit details
- `GET /api/v1/deposits/tx/{txHash}` - Get deposit by transaction hash
- `POST /api/v1/deposits/check` - Manual deposit verification (dev only)
- `POST /api/v1/deposits/scan` - Manual deposit scan (dev only)

### System Endpoints
- `GET /health` - Health check with system status

## Example Workflow

### 1. User Registration
```json
POST /api/v1/users/register
{
  "email": "user@example.com",
  "password": "securePassword123",
  "tronAddress": "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t"
}
```

### 2. User Login
```json
POST /api/v1/users/login
{
  "email": "user@example.com",
  "password": "securePassword123"
}
```

**Response includes JWT token:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": { ... },
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "expiresIn": "24h"
  }
}
```

### 3. Get System Wallet Info
```bash
GET /api/v1/deposits/wallet-info
```

### 4. Make USDT Deposit
Send USDT (TRC-20) to the system wallet address returned in step 3.

### 5. Check Deposit Status
```bash
GET /api/v1/deposits/my-deposits
Authorization: Bearer <your-jwt-token>
```

### 6. View Credits
```bash
GET /api/v1/users/credits
Authorization: Bearer <your-jwt-token>
```

## Schema Definitions

All request and response schemas are fully documented in the Swagger UI. Key schemas include:

### User Schemas
- `UserRegistration` - User registration request
- `UserLogin` - User login request
- `UserResponse` - User profile response
- `LoginResponse` - Login response with token

### Deposit Schemas
- `DepositResponse` - Deposit information
- `TransactionResponse` - Transaction details
- `SystemWalletInfo` - System wallet information

### Common Schemas
- `ApiResponse` - Standard successful response format
- `ErrorResponse` - Standard error response format
- `HealthResponse` - Health check response

## Error Handling

The API uses consistent error response format:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

Common HTTP status codes:
- `200` - Success
- `201` - Created successfully
- `400` - Bad request (validation error)
- `401` - Unauthorized (authentication required)
- `404` - Resource not found
- `409` - Conflict (duplicate resource)
- `500` - Internal server error

## Testing with Swagger UI

1. **Start the server**: `npm run dev`
2. **Open Swagger UI**: Navigate to `http://localhost:3000/api-docs`
3. **Register a user**: Use the registration endpoint with your testnet TRON address
4. **Login**: Get your JWT token
5. **Authorize**: Click "Authorize" and enter your token
6. **Test endpoints**: Try various API calls directly from the UI

## Development Notes

- **Testnet Only**: All TRON operations use testnet addresses and tokens
- **Dev Endpoints**: `/deposits/check` and `/deposits/scan` are for development only
- **Rate Limiting**: API has built-in rate limiting (configurable)
- **Validation**: All requests are validated using Zod schemas
- **Logging**: All API calls are logged with structured logging

## Frontend Integration

Frontend developers can:
1. Use the OpenAPI spec at `/api-docs.json` for code generation
2. Reference the Swagger UI for implementation details
3. Test all endpoints directly in the browser
4. Copy example requests from the documentation
5. Understand authentication requirements and error formats

## Production Considerations

When deploying to production:
- Remove or secure development endpoints (`/deposits/check`, `/deposits/scan`)
- Update server URLs in Swagger configuration
- Implement proper CORS policies
- Add API versioning strategy
- Set up monitoring and alerting for API endpoints