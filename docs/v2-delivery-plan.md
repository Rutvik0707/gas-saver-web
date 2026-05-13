# Gas Saver V2 — Delivery Plan
**Deadline:** Saturday, May 2, 2026
**Start:** Monday, April 28, 2026

---

## What's Already Done ✅

- Database schema — 4 new tables (`api_keys`, `v2_credit_ledger`, `v2_energy_requests`, deposit `purpose` flag, `role`, `v2Credits` on users)
- V2 Auth — `POST /api/v2/auth/register`, `POST /api/v2/auth/verify-otp`, `POST /api/v2/auth/login`, `GET /api/v2/auth/me`
- API Keys — `POST /api/v2/keys`, `GET /api/v2/keys`, `DELETE /api/v2/keys/:id`
- `v2RoleMiddleware` — blocks non API_CLIENT users from V2 routes

---

## Monday, April 28 — API Key Module ✅ DONE

**Goal:** Paycoins can generate and manage API keys after logging in.

### Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/v2/keys` | JWT | Generate new API key |
| `GET` | `/api/v2/keys` | JWT | List all keys |
| `DELETE` | `/api/v2/keys/:id` | JWT | Revoke a key |

### How It Works
```
Generate → sk_live_xxxxxxxxxxxx  (shown ONCE to user, never stored)
Store    → SHA-256 hash of key in api_keys table
Auth     → client sends key → we hash it → DB lookup → find user
Max 5 active keys per client
```

---

## Tuesday, April 29 — Top Up Flow

**Goal:** Paycoins can deposit USDT to get V2 credits.

### Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/v2/topup/initiate` | JWT | Get pool address to send USDT |
| `GET` | `/api/v2/topup/:id/status` | JWT | Check if payment detected |
| `GET` | `/api/v2/topup/history` | JWT | List all top ups |

### How It Works
```
Paycoins calls initiate
    ↓
Gets unique pool address (reuses V1 address pool)
    ↓
Paycoins sends USDT to that address
    ↓
V1 cron detects payment (deposit.purpose = TOPUP)
    ↓
Instead of delegating energy → adds credits to v2Credits
    ↓
1 USDT = 1 credit = 1 energy delegation (131,000 energy)
```

### Key Change to V1 Cron
Deposit processor checks `purpose` flag:
- `ENERGY_DELIVERY` → V1 flow (delegate energy, unchanged)
- `TOPUP` → V2 flow (add credits to v2Credits, no energy delegation)

### Files
```
src/modules/v2/topup/
├── topup.types.ts
├── topup.repository.ts
├── topup.service.ts
├── topup.controller.ts
└── topup.routes.ts
```

---

## Wednesday, April 30 — Core Delegate Endpoint + Account

**Goal:** Paycoins can delegate energy to any wallet using their API key.

### Endpoints
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/api/v2/energy/delegate` | API Key | Delegate energy to a wallet |
| `GET` | `/api/v2/energy/status/:id` | API Key | Check delegation status |
| `GET` | `/api/v2/account/balance` | API Key / JWT | Get current v2Credits |
| `GET` | `/api/v2/usage/history` | API Key / JWT | List all past delegations |

### Delegate Flow
```
POST /api/v2/energy/delegate
X-API-Key: sk_live_xxx
X-Request-ID: PAY-20260430-001   ← idempotency key

{ "wallet_address": "TPayAddr1" }

    ↓
1. Validate API key → find user
2. Check X-Request-ID in v2_energy_requests (idempotency)
   → if exists → return cached response (no double charge)
3. Check v2Credits > 0
   → if 0 → return 402 INSUFFICIENT_CREDITS
4. Deduct 1 credit atomically (SELECT FOR UPDATE)
5. Call energy.service.ts → transferEnergyDirect(wallet, 131000)
6. Save result to v2_energy_requests (energyReclaimedAt: null)
7. If delegation fails → refund 1 credit
8. Return response
```

### Energy Amount — 131,000 (Not 65,000)
```
Why 131,000?
  Paycoins generates FRESH wallets per deposit.
  Fresh/unactivated TRON wallets cost more energy on first use
  because the account needs to be activated on-chain.
  131,000 covers activation cost + sweep safely.
  Same amount as V1.
```

### Energy Reclaim — Critical
```
Gas Saver delegates energy FROM their staked TRX pool.
If never reclaimed → pool drains → can't serve new requests.

After delegation:
  v2_energy_requests.energyReclaimedAt = null

Reclaim cron (every 15 min) finds COMPLETED V2 requests
where energyReclaimedAt = null
    ↓
Reclaims energy from TPayAddr1
    ↓
v2_energy_requests.energyReclaimedAt = now
    ↓
Gas Saver pool replenished ✅

Paycoins never knows about this — invisible to them.
```

### Schema Addition Needed
```prisma
// Add to v2_energy_requests
energyReclaimedAt  DateTime?  @map("energy_reclaimed_at")
```

### Middleware Needed
```
apiKeyMiddleware   → reads X-API-Key header → SHA-256 hash → DB lookup → attach user
v2RoleMiddleware   → ensures role = API_CLIENT on JWT routes ✅ already done
```

### Files
```
src/modules/v2/energy/
├── v2-energy.types.ts
├── v2-energy.repository.ts
├── v2-energy.service.ts
├── v2-energy.controller.ts
└── v2-energy.routes.ts

src/middleware/
└── api-key.middleware.ts
```

---

## Thursday, May 1 — End to End Testing

**Goal:** Full flow works without bugs.

### Test Scenarios in Postman

#### Happy Path
```
1. Register Paycoins account
2. Verify OTP
3. Login → get JWT
4. Generate API key → get sk_live_xxx
5. Top up 10 USDT → v2Credits = 10
6. POST /energy/delegate with API key → 131,000 energy delegated to TPayAddr1
7. Check balance → v2Credits = 9
8. Check delegation status
9. Reclaim cron runs → energy back in Gas Saver pool
```

#### Edge Cases
```
- Same X-Request-ID sent twice → same response, no double charge
- v2Credits = 0 → 402 INSUFFICIENT_CREDITS
- Invalid wallet address → 400 validation error
- Invalid API key → 401 error
- Revoked API key → 401 error
- V1 user tries V2 login → blocked
- Fresh wallet (unactivated) → 131,000 energy handles it ✅
```

---

## Friday, May 2 — Polish + Ship

**Goal:** Clean, stable, ready for Paycoins integration.

### Tasks
- Clean up all debug logs
- Consistent error response format across all V2 endpoints
- Test with real TRON testnet wallet (fresh + activated)
- Verify V1 is completely unaffected
- Document API endpoints in Postman collection
- Verify energy reclaim cron works for V2 requests

---

## Architecture Summary

### What V2 Reuses From V1 (Untouched)
| V1 Component | How V2 Uses It |
|---|---|
| `address_pool` table | Top-up payment collection |
| Deposit detection cron | Detects USDT top-up payments |
| `energy.service.ts` | Called directly — `transferEnergyDirect(wallet, 131000)` |
| `final-energy-reclaim.service.ts` | Extended to also reclaim V2 delegations |
| `users` table | Same table, role + v2Credits fields added |
| JWT auth | Same secret, same format |

### What's New in V2
| Component | Purpose |
|---|---|
| `api_keys` table | API key management |
| `v2_credit_ledger` table | Audit trail for every credit movement |
| `v2_energy_requests` table | Idempotency + delegation history + reclaim tracking |
| `role` field on users | Distinguish V1 users from V2 clients |
| `v2Credits` field on users | Live credit balance |
| `purpose` field on deposits | Tell cron: credit vs delegate |
| `energyReclaimedAt` on v2_energy_requests | Track which delegations have been reclaimed |

### No Redis, No Webhooks
- **Idempotency:** handled by `v2_energy_requests` table (DB-based, unique on userId + idempotencyKey)
- **Status updates:** Paycoins polls `GET /energy/status/:id`
- **Reclaim:** extended V1 reclaim cron handles V2 addresses too
- **No extra infrastructure needed**

---

## Full Paycoins Integration Flow

```
1. Paycoins registers on Gas Saver          (one time)
2. Paycoins tops up 500 USDT               (v2Credits = 500)
3. Paycoins generates API key               (sk_live_xxx stored in their .env)

--- From this point, fully automated ---

4. Gaming user wants to deposit USDT
5. Paycoins generates TPayAddr1 (fresh wallet)
6. User sends USDT → TPayAddr1
7. Paycoins detects deposit → calls Gas Saver:
   POST /api/v2/energy/delegate
   X-API-Key: sk_live_xxx
   X-Request-ID: PAY-DEP-001
   { "wallet_address": "TPayAddr1" }
8. Gas Saver delegates 131,000 energy → TPayAddr1
9. Paycoins sweeps USDT from TPayAddr1 → Main Wallet (FREE, no TRX)
10. Gas Saver reclaim cron reclaims energy from TPayAddr1
11. v2Credits = 499
```

---

## Full API Reference

### Auth
```
POST /api/v2/auth/register
POST /api/v2/auth/verify-otp
POST /api/v2/auth/login
GET  /api/v2/auth/me
```

### API Keys
```
POST   /api/v2/keys
GET    /api/v2/keys
DELETE /api/v2/keys/:id
```

### Top Up
```
POST /api/v2/topup/initiate
GET  /api/v2/topup/:id/status
GET  /api/v2/topup/history
```

### Energy
```
POST /api/v2/energy/delegate
GET  /api/v2/energy/status/:id
```

### Account
```
GET /api/v2/account/balance
GET /api/v2/usage/history
```
