# Gas Saver V2 — Detailed Flow & Why We Use Each Piece

> Every step explained with the reason behind it.

---

## Table of Contents

1. [The Business Example](#the-business-example)
2. [Part 1 — Registration & API Key](#part-1-registration--api-key)
3. [Part 2 — Top-Up (Loading Credits)](#part-2-top-up-loading-credits)
4. [Part 3 — Energy Delegation (Core API)](#part-3-energy-delegation-core-api)
5. [Part 4 — Edge Cases](#part-4-edge-cases)
6. [Why X-Request-ID](#why-x-request-id)
7. [Why Redis](#why-redis)
8. [Why Idempotency System](#why-idempotency-system)
9. [Why Webhooks](#why-webhooks)
10. [Are They Interconnected?](#are-they-interconnected)
11. [Who Can Use Gas Saver](#who-can-use-gas-saver)

---

## The Business Example

```
Company:  CryptoSwap Exchange
Problem:  Processes 500 USDT withdrawals/day
          Each costs $2.89 in TRX gas = $1,445/day wasted
Solution: Integrate Gas Saver API → pay $1/tx = save $1.89/tx
```

---

## Part 1: Registration & API Key

---

### Step 1: CryptoSwap Registers

```
POST /api/v1/users/register
{
  "email": "dev@cryptoswap.io",
  "password": "Secure@1234",
  "phoneNumber": "+911234567890"
}
```

DB result:
```
users:
  id: user_001
  email: dev@cryptoswap.io
  api_credits: 0              ← new v2 field
  low_balance_threshold: 10   ← alert when below 10 credits
```

**Why `api_credits` instead of v1 `credits`?**

V1 `credits` was tied to energy delivery per deposit. V2 needs a separate
clean credit pool that works like a prepaid wallet — top up any amount,
spend per API call. Keeping them separate means v1 users are completely unaffected.

---

### Step 2: CryptoSwap Generates an API Key

```
POST /api/v2/api-keys
Authorization: Bearer <JWT>
{
  "name": "Production Key",
  "type": "live"
}
```

**What happens inside:**

```
1. Generate random 32 chars → sk_live_gS4v3r_xK9mP2qR7tN4wL6uJ8vB3cE5hA1dF0
2. SHA-256 hash it          → e3b0c44298fc1c149afb...  ← stored in DB
3. Store key_prefix         → sk_live_gS4v3r_xK9m (first 12 chars)
4. Return full key ONCE     ← never shown again
```

DB result:
```
api_keys:
  id: key_001
  user_id: user_001
  key_hash: e3b0c44298fc1c149afb...   ← SHA-256 hash, never plaintext
  key_prefix: sk_live_gS4v3r_xK9m
  name: Production Key
  type: live
  is_active: true
  rate_limit: 60              ← max 60 requests/minute
```

Response to CryptoSwap (ONE TIME ONLY):
```json
{
  "api_key": "sk_live_gS4v3r_xK9mP2qR7tN4wL6uJ8vB3cE5hA1dF0",
  "warning": "Save this key now. It will never be shown again."
}
```

**Why not just use JWT (which v1 already has)?**

| JWT (v1)                        | API Key (v2)                          |
|---------------------------------|---------------------------------------|
| Expires in hours/days           | Never expires (until revoked)         |
| Made for humans logging in      | Made for machines making API calls    |
| One per session                 | Multiple per account                  |
| Can't be named or tracked       | Each key has name, usage stats, limit |

CryptoSwap's backend server can't "log in" every hour to refresh a JWT.
It needs a permanent key stored in `.env` and used forever.

**Why store only the SHA-256 hash?**

If someone hacks the database, they get the hash — useless without the
original key. Even Gas Saver's own DB never has the real key. This is
exactly how Stripe, OpenAI, and GitHub store API keys.

```
User gets:    sk_live_gS4v3r_xK9mP2qR7tN4...   (save this!)
DB stores:    e3b0c44298fc1c149afb...            (SHA-256 hash)
```

**Why `sk_live_` prefix?**

- `sk_live_` = real money, real TRON delegations
- `sk_test_` = sandbox mode, fake delegations for testing

**Why show the key only once?**

Forces the user to save it properly. If we stored and re-showed it,
we'd have to store it unhashed — a security risk.

---

## Part 2: Top-Up (Loading Credits)

---

### Step 3: Initiate Top-Up

CryptoSwap wants to load 1000 credits ($1000 USDT):

```
POST /api/v2/topup/initiate
Authorization: Bearer <JWT>
{
  "amount": 1000
}
```

**What happens inside:**

```
1. Validates amount >= 10 (minimum top-up)
2. Picks FREE address from address_pool → TPoolAddr_007
3. Marks TPoolAddr_007 as ASSIGNED
4. Creates deposit with purpose = "TOPUP"  ← new v2 flag
```

DB result:
```
deposits:
  id: dep_002
  user_id: user_001
  assigned_address: TPoolAddr_007
  expected_amount: 1000 USDT
  purpose: TOPUP              ← v2 flag (not ENERGY_DELIVERY)
  status: PENDING
```

Response:
```json
{
  "deposit_address": "TPoolAddr_007",
  "amount": 1000,
  "expires_at": "3 hours from now",
  "qr_code": "data:image/png..."
}
```

**Why reuse V1 deposit infrastructure?**

V1 already does address pool assignment, blockchain detection, and cron
processing. For V2 top-up, only the outcome changes:

```
V1: confirmed deposit → delegate energy to wallet
V2: confirmed deposit → add credits to balance
```

The `purpose` flag tells the deposit processor which path to take.
V1 is completely untouched.

**Why minimum $10?**

Each top-up uses one pool address, TronGrid API calls, and cron processing
time. Below $10, the overhead isn't worth it.

---

### Step 4: CryptoSwap Sends USDT

```
CryptoSwap sends from Binance:
  from: TBinanceHot123    ← Binance's hot wallet
  to:   TPoolAddr_007     ← your system's pool address
  amount: 1000 USDT
  txHash: 0xTOPUP123
```

The USDT sits in `TPoolAddr_007`. Gas Saver owns it (has the private key).

---

### Step 5 & 6: Detection + Credit Processing

Transaction detector (every 30s) finds the transfer.
Deposit processor checks `purpose = TOPUP` and calls `credit.service.topUpCredits()`.

**What is the credit_transactions table and why?**

It's a ledger — every single credit movement is recorded permanently:

```
ct_001: +1000  (topup)        balance: 1000
ct_002: -1     (delegation)   balance: 999
ct_003: -1     (delegation)   balance: 998
ct_004: +1     (refund)       balance: 999   ← delegation failed, refunded
ct_005: -1     (delegation)   balance: 998
```

Why we need it:
- **Disputes:** CryptoSwap claims double charge → show exact ledger
- **Debugging:** Trace exactly what happened and when
- **Analytics:** How many credits consumed this month?
- **Accounting:** Finance team needs this for revenue reporting

`users.api_credits` = current balance (like your bank app balance)
`credit_transactions` = full history (like your bank statement)

---

### Step 7: Webhook Fires — topup.completed

Gas Saver sends HTTP POST to CryptoSwap's webhook URL:

```
POST https://api.cryptoswap.io/gassaver-webhook
X-GS-Signature: sha256=hmac_signature   ← proof it came from Gas Saver

{
  "event": "topup.completed",
  "data": {
    "amount_usdt": 1000,
    "credits_added": 1000,
    "new_balance": 1000,
    "tx_hash": "0xTOPUP123"
  }
}
```

**What CryptoSwap does when they receive this:**

```python
def handle_topup(data):
    dashboard.update_balance(data["new_balance"])     # update their UI
    accounting.record_payment(data["amount_usdt"])    # log in their books
    email.send("finance@cryptoswap.io", "Top-up confirmed")
    if withdrawals.are_paused():
        withdrawals.resume()                          # re-enable withdrawals
```

**What is X-GS-Signature and why?**

Anyone could send a fake POST to CryptoSwap's webhook URL.
We sign the payload with HMAC-SHA256 using a shared secret.
CryptoSwap verifies the signature — if it matches, request is genuine.

```
Gas Saver signs:   HMAC-SHA256(payload, webhook_secret)
CryptoSwap checks: same computation → if equal → genuine ✅
```

Same technique used by Stripe, GitHub, and Shopify.

**What if top-up is done but no webhook URL is configured?**

```
Gas Saver tries to fire webhook
webhook_url = NULL → skip webhook delivery
Credits still added ✅ — webhook failure never blocks credit processing
```

Credits are always safe in the database. Webhook is just a notification.
CryptoSwap can always check balance manually:
```
GET /api/v2/account/balance  ← always accurate
```

---

## Part 3: Energy Delegation (Core API)

---

### Step 8: CryptoSwap Calls the API

John wants to withdraw 500 USDT. CryptoSwap's backend:

```python
import uuid

def process_withdrawal(user_id, john_wallet, amount):

    # Auto-generated by CryptoSwap's code — John never sees this
    idempotency_key = f"withdrawal_{user_id}_{uuid.uuid4()}"

    response = requests.post(
        "https://api.gassaver.live/api/v2/energy/delegate",
        headers={
            "X-API-Key": os.getenv("GASSAVER_API_KEY"),
            "X-Request-ID": idempotency_key
        },
        json={"wallet_address": john_wallet}
    )
```

**Who generates the X-Request-ID?**

CryptoSwap's backend generates it automatically. John (the end user)
never sees it or touches it. It's purely machine-to-machine.

**Why does CryptoSwap need to write this code?**

This is the integration work — 15 lines, written once, runs forever.
Everything else (blockchain, energy, TRON, cron jobs) is Gas Saver's problem.

---

### Step 9: API Key Auth Middleware

```
1. Extract key from X-API-Key header
2. SHA-256 hash it
3. Lookup in api_keys table (or Redis cache)
4. Check is_active = true
5. Check not expired
6. Check rate limit (Redis counter)
7. Attach user_001 to request
```

**Why hash before lookup?**

DB stores hashes. We hash the incoming key and look for that hash.
Raw key never appears in DB queries or logs.

**Why check is_active?**

Setting `is_active = false` instantly blocks all requests without
deleting history. Used when key is suspected compromised.

**Why rate limit?**

- If key is stolen, attacker can't drain all credits in 1 second
- Prevents one user from monopolizing the system
- 60 req/min = 1/sec — plenty for normal use

**Why cache API key in Redis?**

```
Without cache: every request = 1 DB query for auth
60 requests/min × 50 users = 3,000 DB queries/min (just for auth)

With Redis cache (TTL 5 min):
First request → DB → cache in Redis
Next 299 requests → Redis (0.1ms, not 5ms)
99% fewer DB queries for auth
```

---

### Step 10: Idempotency Check

```
X-Request-ID: withdrawal_john_20260426_f47ac10b

Check Redis:
  → not found before → proceed
  → found before     → return cached response immediately (no processing)
```

**Why Redis and not PostgreSQL for this?**

| PostgreSQL                        | Redis                              |
|-----------------------------------|------------------------------------|
| Stored on disk (slower)           | Stored in RAM (0.1ms)              |
| No native TTL (needs cleanup job) | Built-in TTL (auto-deletes in 24h) |
| Heavy for high-frequency reads    | Built for high-frequency reads     |

---

### Step 11: Validate Wallet Address

```
TronWeb.isAddress("TJohn456") → ✅ or ❌
```

**Why validate BEFORE reserving credit?**

If address is invalid:
- Without early validation: reserve credit → try TRON → TRON rejects → refund
- With early validation: return 400 immediately → credit never touched

Always fail fast before touching money.

---

### Step 12: Atomic Credit Reservation

```sql
BEGIN TRANSACTION
  SELECT api_credits FROM users
  WHERE id = 'user_001'
  FOR UPDATE;         ← locks the row

  -- balance = 1000, need 1 → ok

  UPDATE users
  SET api_credits = api_credits - 1
  WHERE id = 'user_001';
COMMIT
```

**Why `FOR UPDATE`? What race condition does it prevent?**

Without locking — 3 requests arrive at the exact same millisecond:

```
Request 1 reads: balance = 1 → ok → deduct → balance = 0
Request 2 reads: balance = 1 → ok → deduct → balance = 0  ← read before write
Request 3 reads: balance = 1 → ok → deduct → balance = 0  ← read before write

Result: 3 delegations, credit only went to 0 once
        User got 3 for the price of 1 — Gas Saver lost 2 delegations
```

With `FOR UPDATE`:
```
Request 1: locks row → reads 1 → deducts → balance = 0 → unlocks
Request 2: waits for lock → reads 0 → INSUFFICIENT → rejected ✅
Request 3: waits for lock → reads 0 → INSUFFICIENT → rejected ✅
```

---

### Step 13: Energy Delegation to John's Wallet

```
Calls existing energy.service.ts (UNCHANGED from V1):
  delegateResource(65000 energy, TJohn456)

TRON blockchain:
  from: TSystemWallet
  to:   TJohn456
  energy: 65,000
  txHash: 0xENERGY789
```

**Why reuse V1 energy.service.ts?**

It's battle-tested, production-ready code. No reason to rewrite it.
V2 just calls it with a different trigger (API request vs cron job).

**Why 65,000 energy specifically?**

One TRC-20 USDT transfer consumes exactly ~65,000 energy. Delegating
exactly this amount means precise, efficient use of system wallet energy.
Value comes from `energy_rates` table — configurable by admin.

---

### Step 14: Confirm Deduction + Log

```
credit_transactions:
  type: DEDUCTION
  amount: -1
  balance_after: 999
  description: "Energy delegated to TJohn456"

api_request_logs:
  endpoint: /api/v2/energy/delegate
  wallet_address: TJohn456
  tx_hash: 0xENERGY789
  credits_used: 1
  response_status: 200
  duration_ms: 3200
  ip_address: 45.32.100.5
```

**Why log everything?**

- Debugging: "Why did request X fail?" → open the log
- Billing disputes: "You charged me for a failed delegation" → show the log
- Security: Detect suspicious IP using the API key
- Analytics: Average response time, peak hours, most used wallets
- Compliance: Immutable audit trail

**Why store duration_ms?**

Track if delegation is getting slower over time.
If p95 latency creeps above 300ms, something is wrong.

Store idempotency response in Redis (TTL: 24hrs).

---

### Step 15: Response to CryptoSwap

```json
{
  "success": true,
  "data": {
    "request_id": "req_001",
    "wallet_address": "TJohn456",
    "energy_delegated": 65000,
    "tx_hash": "0xENERGY789",
    "credits_deducted": 1,
    "remaining_balance": 999
  }
}
```

---

### Step 16: CryptoSwap Executes Transfer

```python
if response["success"]:
    # John's wallet has energy → transfer is gas-free
    tron.transfer_usdt(to="TJohn456", amount=500)
```

**Why delegate energy FIRST, then transfer?**

Energy must arrive before the transfer. If you transfer first,
John already paid TRX gas before energy arrives. Sequence is strict:

```
1. Delegate energy → TJohn456 has 65,000 energy
2. Send USDT      → uses energy → $0 gas ✅
```

---

### Step 17: Webhook — energy.delegated

```
POST https://api.cryptoswap.io/gassaver-webhook
{
  "event": "energy.delegated",
  "data": {
    "wallet": "TJohn456",
    "tx_hash": "0xENERGY789",
    "energy_delegated": 65000,
    "credits_remaining": 999
  }
}
```

**What CryptoSwap does:**

```python
def handle_delegation(data):
    withdrawal.energy_status = "READY"
    withdrawal.energy_tx_hash = data["tx_hash"]
    tron.transfer_usdt(to=data["wallet"], amount=withdrawal.amount)
    dashboard.update_balance(data["credits_remaining"])
    withdrawal.status = "COMPLETED"
    email.send(john.email, "Your withdrawal is done")
```

---

## Part 4: Edge Cases

---

### What If Delegation Fails?

```
Reserve 1 credit → deducted ✅
Delegate energy  → TRON network error ❌

Auto refund:
  api_credits: 999 → 1000 (restored)

credit_transactions:
  type: REFUND
  amount: +1
  balance_after: 1000
  description: "Delegation failed - credit refunded"

Response:
  503 Service Unavailable
  { "error": "DELEGATION_FAILED", "credits_refunded": 1 }
```

**Why auto-refund?**

CryptoSwap paid for a service they didn't receive. Charging them anyway
destroys trust. Auto-refund means they can retry immediately without loss.

---

### What If Balance Drops Below Threshold?

```
users.api_credits = 8
users.low_balance_threshold = 10

8 < 10 → trigger alert

Webhook fires:
{
  "event": "balance.low",
  "data": {
    "current_balance": 8,
    "threshold": 10
  }
}

Email sent to dev@cryptoswap.io
```

**What CryptoSwap does:**

```python
def handle_low_balance(data):
    gassaver.topup(amount=1000)          # auto top-up
    email.send("finance@...", "Balance low, auto top-up initiated")
    if data["current_balance"] < 3:
        withdrawals.pause()              # pause if critically low
```

**Why does this matter?**

CryptoSwap processes 500 withdrawals/day. If they run out of credits
at 2am, all withdrawals fail. Low balance alert = early warning system
so they top up before it's ever a problem.

---

### What If CryptoSwap Hits Rate Limit?

```
61st request in 1 minute:

429 Too Many Requests
{
  "error": "RATE_LIMITED",
  "retry_after": 30,
  "limit": 60,
  "window": "1 minute"
}
```

**Why rate limit at all?**

- If key is stolen, attacker can't drain all credits instantly
- Prevents one client from monopolizing system wallet energy
- Protects other clients from degraded service

**Why Redis for rate limiting and not in-memory?**

With 3 servers and in-memory counters:
```
Server 1: 60 requests → BLOCKED
Server 2: 60 requests → BLOCKED  ← should have been blocked at 60 total
Server 3: 60 requests → BLOCKED  ← should have been blocked at 60 total

Total: 180 requests got through instead of 60
```

With Redis (shared counter):
```
All servers → same Redis counter
Counter hits 60 → ALL servers block ✅
```

---

## Why X-Request-ID

**One use: Prevent double charging.**

When a network fails mid-request, the client retries. Without X-Request-ID,
Gas Saver can't tell if it's a new request or a retry.

```
Real world analogy:

You tap your card at a payment terminal.
Terminal freezes. You tap again.
Bank charges you twice.

X-Request-ID is like a receipt number on the tap.
Bank sees same receipt number twice → only charges once.
```

**The exact scenario:**

```
WITHOUT X-Request-ID:

10:00:00 → Request arrives → deduct credit → delegate energy → NETWORK DROPS
10:00:10 → CryptoSwap retries
           Gas Saver has no idea it's a retry
           Deducts another credit → delegates again
           
Result: 2 credits charged, 2 delegations, system wallet drained 2x

WITH X-Request-ID:

10:00:00 → Request: ID=req_001 → Redis: not seen → process → cache response
10:00:10 → Retry:   ID=req_001 → Redis: SEEN → return cached response
           Nothing processed again
           
Result: 1 credit, 1 delegation ✅
```

---

## Why Redis

**Three uses:**

### 1. Shared state across servers

```
Without Redis (2 servers):
  Server 1 RAM: rate_limit=59 → allow request 60
  Server 2 RAM: rate_limit=59 → allow request 60
  Total: 120 requests through instead of 60

With Redis (shared):
  Redis counter: 60 → ALL servers block ✅
```

### 2. Survives server restarts

```
Without Redis:
  Server crashes → RAM wiped → all counters reset
  Rate limits bypass possible
  Idempotency cache lost → double charges possible

With Redis:
  Server crashes → Redis unaffected
  Restart → reconnect to Redis → all state intact ✅
```

### 3. Speed

```
DB query:    5ms   (disk-based)
Redis query: 0.1ms (memory-based)

50x faster for high-frequency reads like API key validation
```

---

## Why Idempotency System

**One use: Make retries safe.**

X-Request-ID + Redis working together:

```
X-Request-ID = the unique label on each request
Redis        = the memory that stores seen labels

Together:
  "Have I seen this exact request before?"
  YES → return old response, don't process again
  NO  → process it, remember the label
```

**Protects Gas Saver's system wallet:**

```
Without idempotency:
  Client bug sends same request 50 times
  50 delegations → system wallet energy drains
  Other clients get "insufficient energy" errors
  Service goes down

With idempotency:
  50 requests arrive
  1 processed, 49 return cached response
  System wallet used: 1 delegation only ✅
```

---

## Why Webhooks

**One use: Tell clients when something happens, without them asking.**

```
Real world analogy:

Without webhooks (polling):
  You order food online.
  You call restaurant every 5 mins: "Is it ready?"
  7 calls for 1 pizza.

With webhooks (push):
  You order food online.
  Restaurant calls YOU when ready.
  0 calls from you.
```

**The exact numbers:**

```
Without webhooks:
  100 clients topping up simultaneously
  Each polls every 5 seconds for 30 seconds
  = 600 useless requests hitting our server
  = 600 wasted DB queries
  = real work (deposit processing, energy monitoring) delayed

With webhooks:
  100 top-ups → 100 initiation requests
  Then silence — we work uninterrupted
  30 seconds later → 100 webhooks fire
  = 200 total requests (vs 700 without webhooks)
  = 500 fewer requests ✅
```

**Events that can't be polled:**

```
balance.low    → happens unpredictably, can't know when to poll
energy.failed  → needs instant notification for retry logic
api_key.rotated→ security event, needs immediate action
```

**Webhook retry on failure:**

```
CryptoSwap's server is down when webhook fires:

Attempt 1 (immediate): fail
Attempt 2 (5 min):     fail
Attempt 3 (30 min):    success ✅

Tracked in webhook_deliveries table
```

---

## Are They Interconnected?

**Yes. X-Request-ID is useless without Redis.**

```
X-Request-ID needs somewhere to store seen request IDs.

Option A — Node.js Memory:
  Breaks with multiple servers (each server has own memory)

Option B — PostgreSQL:
  Works but too slow (DB query on every single request)

Option C — Redis ✅:
  Shared across all servers
  0.1ms lookup
  Auto-expires after 24hrs (built-in TTL)
  Survives server restarts
```

```
X-Request-ID  =  WHAT to store (the unique label)
Redis         =  WHERE to store it (shared, fast, persistent)
```

They are two halves of the same feature.

---

## Full Flow in One Diagram

```
CryptoSwap generates X-Request-ID = "req_john_001"
        ↓
POST /api/v2/energy/delegate
        ↓
Redis checks: "req_john_001" seen before?
  NO → proceed
        ↓
Redis: rate limit < 60? ✅
        ↓
Redis: return cached API key → user_001 (no DB hit)
        ↓
DB atomic deduction: credits 1000 → 999 (FOR UPDATE lock)
        ↓
energy.service.ts: delegateResource(65000, TJohn456) [V1 code, unchanged]
        ↓
Redis stores: "req_john_001" → response (24hr TTL)
        ↓
Webhook fires: "energy.delegated" → CryptoSwap notified instantly
        ↓
Network drops. CryptoSwap retries with same "req_john_001"
        ↓
Redis finds: "req_john_001" → return cached response
No second delegation. No double charge. ✅
```

---

## Who Can Use Gas Saver

Anyone who sends USDT on TRON:

| Business           | Daily Txns | Gas Without GS     | Gas With GS | Daily Saving |
|--------------------|------------|-------------------|-------------|--------------|
| Crypto Exchange    | 5,000      | $14,450           | $5,000      | $9,450       |
| OTC Trading Desk   | 200        | $578              | $200        | $378         |
| Payment Processor  | 1,000      | $2,890            | $1,000      | $1,890       |
| Trading Bot        | 500        | $1,445            | $500        | $945         |

**Integration requirement:**

```
1. Create Gas Saver account
2. Top up USDT
3. Generate API key
4. Write 15 lines of code
5. Done — gas-free USDT transfers forever
```

Gas Saver doesn't care:
```
❌ What their business does
❌ What wallets they use
❌ How many wallets they have

✅ Only: do you have credits? which wallet needs energy?
```

---

## Money Flow Summary

```
CryptoSwap pays:  $1000 USDT → Gas Saver (top-up)
CryptoSwap gets:  1000 credits = 1000 gas-free withdrawals

Without Gas Saver: 1000 withdrawals × $2.89 = $2,890
With Gas Saver:    1000 withdrawals × $1.00 = $1,000

CryptoSwap saves:  $1,890 per 1000 withdrawals ✅
Gas Saver earns:   $1,000 revenue, ~$800 gross profit ✅
```

---

*Document generated: April 2026*
*Gas Saver V2 — API-Based Dynamic Energy Delivery*
