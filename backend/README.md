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
   Fill in `DATABASE_URL` and any external provider credentials you intend to exercise:
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` (for Google OIDC login)
   - `STRIPE_SECRET_KEY` (`sk_test_...` only), `STRIPE_WEBHOOK_SECRET` (`whsec_...`) (for Stripe Checkout & webhooks)
   - `JWT_PRIVATE_KEY_PEM`, `JWT_PUBLIC_KEY_PEM` (ES256 P-256 keys; required in production, ephemeral fallback in dev/test)
   - `ENCRYPTION_MASTER_KEY` (32-byte hex or base64 key; required in production)
   - `AI_SUPPORT_ENABLED=true`, `GEMINI_API_KEY` (only after owner approval; model `gemini-3.5-flash-lite` and API base URL are configured in `src/config/env.js`)

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

Additional keys in `.env.example` (Argon2 parameters, timeouts, retry limits, and key IDs are hardcoded in `src/config/env.js`):
- `AUTH_EMAIL_HMAC_SECRET`: secret for HMAC-keyed email quotas and advisory locks.
- `MAIL_ENCRYPTION_MASTER_KEY`: separate AES-256-GCM wrapping key used exclusively by `AuthMailOutbox` and `worker:mail`.
- `MAIL_TRANSPORT` (`fake` for dev/test, `smtp` for real SMTP), `MAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`.

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
