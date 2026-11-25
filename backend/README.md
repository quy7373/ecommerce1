# E-Commerce Backend API

Modular Node.js + Express + PostgreSQL + Prisma backend implementing the authoritative specification in `docs/api/api-contract.md`, `docs/database/erd.md`, `docs/database/data-dictionary.md`, and `docs/security/*`.

## Architecture & Module Layout

```text
backend/
├── prisma/
│   ├── schema.prisma              # 17 Prisma models aligned with docs/database/erd.md & data-dictionary.md
│   ├── migrations/                # SQL migrations including CHECK constraints & partial unique indexes
│   └── seed.js                    # Sample categories, products, and optional operator admin bootstrap
├── src/
│   ├── config/                    # Env config, AES-256-GCM envelope crypto, ES256 JWT, Prisma tx retry, OpenAPI
│   ├── middleware/                # Request ID, security headers, strict JSON/query parser, auth/CSRF/RBAC, rate limit, error handler
│   ├── integrations/
│   │   ├── stripe/                # Stripe Checkout (test mode only) & webhook signature verification
│   │   └── llm/                   # PII redaction & grounded LLM client (disabled by default until approved)
│   ├── modules/
│   │   ├── auth/                  # Google OIDC + PKCE + ES256 session cookies + CSRF rotation
│   │   ├── categories/            # Public category listing
│   │   ├── products/              # Public catalog search, filtering, sorting, pagination
│   │   ├── cart/                  # Optimistic-locked shopping cart CRUD (no stock reservation)
│   │   ├── orders/                # Idempotent order creation, atomic stock reservation, cancellation
│   │   ├── payments/              # Stripe Checkout sessions, durable webhook inbox, reconciliation
│   │   ├── admin/                 # Admin product & order management with MFA/recent-auth guard & AuditLog
│   │   └── chat/                  # Public FAQ support grounded ONLY in APPROVED knowledge documents
│   ├── app.js                     # Express app factory
│   ├── server.js                  # HTTP server entrypoint
│   └── worker.js                  # Background payment/reservation reconciliation worker
└── tests/
    ├── unit/                      # Crypto, parser, validation, Stripe client, LLM redaction & grounding tests
    └── integration/               # Full Express + Supertest API contract & security tests
```

## Database Alignment Note

Per `docs/database/erd.md` and `docs/database/data-dictionary.md`, the Prisma schema uses the 17 authoritative models:
`User`, `AuthSession`, `OAuthAttempt`, `Category`, `Product`, `Cart`, `CartItem`, `Order`, `OrderItem`, `InventoryReservation`, `Payment`, `WebhookEvent`, `IdempotencyRecord`, `AuditLog`, `SecurityAuditOutbox`, `KnowledgeDocument`, and `KnowledgeChunk`.
- Shipping addresses are stored as AES-256-GCM encrypted JSON envelopes on `Order.shippingAddress`.
- Chat transcripts are **not** persisted (`erd.md`: *"No chat/message entity is defined because transcripts are not retained"*).

## Prerequisites

- Node.js >= 20
- PostgreSQL 15+

## Setup & Database Instructions

1. Install dependencies and generate the Prisma client:
   ```bash
   cd backend
   npm install
   npm run prisma:generate
   ```

2. Configure environment variables:
   ```bash
   cp .env.example .env
   ```
   Fill in the 6 main environment keys in `.env` (all runtime, JWT, encryption, Argon2, worker, and mail defaults are configured in `src/config/env.js`):
   - `DATABASE_URL` (PostgreSQL connection string)
   - `STRIPE_SECRET_KEY` (`sk_test_...` only), `STRIPE_WEBHOOK_SECRET` (`whsec_...`) (for Stripe Checkout & webhooks)
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (for Google OIDC login)
   - `GEMINI_API_KEY` (enables Gemini AI Support automatically using `gemini-3.5-flash-lite`)

3. Apply database migrations (includes PostgreSQL `CHECK` constraints and partial unique indexes):
   ```bash
   npm run prisma:migrate
   ```

4. Seed initial categories and sample products:
   ```bash
   npm run prisma:seed
   ```

## Running the Services

- Development API server:
  ```bash
  npm run dev
  ```
- Production API server:
  ```bash
  npm start
  ```
- Background reconciliation worker (separate process):
  ```bash
  npm run worker
  ```
- Auth transactional mail worker (separate process with dedicated mail encryption key):
  ```bash
  npm run worker:mail
  ```

### AUTH-002 Email/Password & Mail Configuration

All Argon2id parameters, key IDs, retry limits, and local dev mail settings (`transport: 'fake'`) are configured directly in `src/config/env.js`. No SMTP or email env keys are required in `.env`.

## Health Checks & API Documentation

- Liveness: `GET /health/live` and `GET /api/v1/health/live`
- Readiness (PostgreSQL check): `GET /health/ready` and `GET /api/v1/health/ready`
- Swagger UI: `GET /api/v1/docs`
- OpenAPI JSON: `GET /api/v1/openapi.json`

## Running Tests

```bash
npm test
npm run test:unit
npm run test:integration
```
