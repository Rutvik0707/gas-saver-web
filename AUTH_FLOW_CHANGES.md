# Authentication Flow Changes Summary

## Overview
The authentication system has been updated to implement a dual OTP verification flow for registration and password reset, with support for both email and WhatsApp phone number login.

**IMPORTANT UPDATE**: Registration now requires password upfront - users provide email, phone number, AND password during initial registration.

## Key Changes

### 1. User Model Updates
- **Removed**: `tronAddress` field from User model (TRON addresses will be managed separately)
- **Made Required**: `phoneNumber` field (for WhatsApp verification)
- **passwordHash**: Required at registration (user provides password upfront)

### 2. Registration Flow
1. User registers with email, WhatsApp phone number, and password
2. System sends different OTPs to email and WhatsApp simultaneously
3. User must verify BOTH OTPs within 10 minutes
4. After successful dual verification, user receives JWT token (fully registered)

**Endpoints:**
- `POST /api/v1/users/register` - Register with email, phone, and password
- `POST /api/v1/users/verify-registration-otp` - Verify both OTPs (returns JWT)

### 3. Login Flow
Users can login with either email OR phone number + password:
- `POST /api/v1/users/login` - Password-based login
- `POST /api/v1/users/login-otp` - Request OTP login
- `POST /api/v1/users/verify-otp-login` - Verify OTP for login

**Important**: On successful login, all existing JWT tokens for that user should be invalidated (Redis implementation pending).

### 4. Password Reset Flow
1. User requests reset with email OR phone number
2. OTP sent to the corresponding channel
3. User verifies OTP (valid for 10 minutes)
4. User sets new password with verified OTP

**New Endpoints:**
- `POST /api/v1/users/forgot-password` - Request reset OTP
- `POST /api/v1/users/verify-reset-otp` - Verify reset OTP
- `POST /api/v1/users/reset-password` - Reset password with OTP

### 5. Security Enhancements
- All OTPs are valid for 10 minutes only
- Dual OTP verification for registration (both email and WhatsApp)
- Password is required during registration (no separate password setup step)
- JWT token invalidation on login (implementation pending)

## Removed/Deprecated Endpoints

The following endpoints have been removed or commented out as they are no longer needed:

1. **`POST /api/v1/users/set-password`** - Password is now set during registration
2. **`POST /api/v1/users/verify-otp`** - Replaced by dual OTP verification in `/verify-registration-otp`
3. **`POST /api/v1/users/resend-otp`** - Users should use the register endpoint again for new OTPs
4. **`GET /api/v1/users/verify-email`** - Email verification is now done through OTP
5. **`POST /api/v1/users/login-otp`** - OTP-based login not required, only password-based login
6. **`POST /api/v1/users/verify-otp-login`** - OTP-based login not required, only password-based login

## Pending Items

### Redis Integration for Token Management
To complete the token invalidation feature, you need to:

1. Install Redis dependencies:
```bash
npm install redis @types/redis
```

2. Create a Redis service for token blacklist management
3. Update auth middleware to check token blacklist
4. Implement token invalidation on login and password reset

### Database Migration
Run the Prisma migration to update the database schema:
```bash
npx prisma migrate dev --name update-user-auth-model
```

### Testing
Test all authentication flows:
1. Registration with dual OTP
2. Login with email/phone + password
3. Password reset with OTP
4. Token invalidation (after Redis implementation)

## API Examples

### Registration Flow
```bash
# 1. Register (includes password)
POST /api/v1/users/register
{
  "email": "user@example.com",
  "phoneNumber": "+919876543210",
  "password": "SecurePass123!"
}

# 2. Verify OTPs (returns JWT token)
POST /api/v1/users/verify-registration-otp
{
  "email": "user@example.com",
  "phoneNumber": "+919876543210",
  "emailOtp": "123456",
  "phoneOtp": "654321"
}
# Response includes JWT token - user is now fully registered and logged in
```

### Login
```bash
POST /api/v1/users/login
{
  "identifier": "user@example.com",  # or "+919876543210"
  "password": "SecurePass123!"
}
```

### Password Reset
```bash
# 1. Request OTP
POST /api/v1/users/forgot-password
{
  "identifier": "user@example.com"  # or "+919876543210"
}

# 2. Verify OTP
POST /api/v1/users/verify-reset-otp
{
  "identifier": "user@example.com",
  "otp": "123456"
}

# 3. Reset Password
POST /api/v1/users/reset-password
{
  "identifier": "user@example.com",
  "otp": "123456",
  "newPassword": "NewSecurePass123!"
}
```