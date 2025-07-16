# OTP-Based Login Implementation

## Overview
The application now uses a passwordless OTP-based authentication system where users can login using either their email or phone number.

## Login Flow

### 1. Request OTP
**Endpoint:** `POST /api/v1/users/login`
```json
{
  "identifier": "user@example.com"  // or "+919876543210"
}
```

**Response:**
```json
{
  "success": true,
  "message": "OTP has been sent to your registered email and phone number"
}
```

### 2. Verify OTP and Get Access Token
**Endpoint:** `POST /api/v1/users/verify-otp-login`
```json
{
  "identifier": "user@example.com",  // or "+919876543210"
  "otp": "123456"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Login successful",
  "data": {
    "user": {
      "id": "cuid",
      "email": "user@example.com",
      "phoneNumber": "+919876543210",
      "isEmailVerified": true,
      "isPhoneVerified": true,
      "credits": "1000",
      "isActive": true
    },
    "token": "jwt-token-here",
    "expiresIn": "24h"
  }
}
```

## Implementation Details

### Schema Updates
- Added `loginWithOtpSchema` to accept email/phone identifier
- Added `verifyOtpLoginSchema` for OTP verification with identifier

### Service Methods
- `loginWithOtp(LoginWithOtpDto)`: Generates and sends OTP to user
- `verifyOtpLogin(VerifyOtpLoginDto)`: Verifies OTP and returns JWT token

### Key Features
1. **Flexible Identifier**: Users can login with either email or phone number
2. **No Password Required**: Fully passwordless authentication
3. **Dual Channel OTP**: OTP sent via both email and WhatsApp (if phone available)
4. **Secure**: OTP expires after 5 minutes
5. **JWT Token**: Returns standard JWT token for API access

### Error Handling
- User not found: Returns 404
- Invalid/expired OTP: Returns 400
- Inactive account: Returns 401

## Migration Notes
- Existing users can continue to use their accounts
- Password field is still in database but not used for login
- Registration still requires password (for now) but login is OTP-only