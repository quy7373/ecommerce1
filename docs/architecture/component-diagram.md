# Component and interaction diagrams

Task ARCH-001. Proposed components; see [system architecture](system-architecture.md) for security and transaction rules.

```mermaid
flowchart LR
  Browser[React / Vite / Tailwind]
  Edge[Frontend static server and API proxy]
  Auth[Identity and session middleware]
  Catalog[Catalog module]
  Cart[Cart module]
  Orders[Order and checkout module]
  Admin[Admin module]
  Support[Support retrieval and output validation]
  Inbox[Raw-body webhook ingress]
  Worker[Payment and reservation worker]
  Prisma[Prisma repositories]
  DB[(PostgreSQL)]
  Google[Google OpenID Connect]
  Stripe[Stripe Checkout test mode]
  AI[Approved AI provider]
  Docs[Approved knowledge documents]
  Browser --> Edge
  Edge --> Auth
  Auth --> Catalog
  Auth --> Cart
  Auth --> Orders
  Auth --> Admin
  Edge --> Support
  Google <--> Auth
  Orders --> Stripe
  Browser --> Stripe
  Stripe --> Inbox
  Inbox --> Prisma
  Worker <--> Stripe
  Worker --> Prisma
  Catalog --> Prisma
  Cart --> Prisma
  Orders --> Prisma
  Admin --> Prisma
  Auth --> Prisma
  Support --> Docs
  Support --> AI
  Prisma --> DB
```

Support bypasses session requirements but has Origin validation, rate limits, body limits and privacy processing. Admin calls share identity middleware and add live role checks. Webhook ingress bypasses cookie/CSRF middleware and uses signature authentication. All database mutation rules belong in services, not route handlers or React components.

```mermaid
sequenceDiagram
  participant UI as Checkout UI
  participant API as Express
  participant DB as PostgreSQL
  participant ST as Stripe test
  participant W as Worker
  UI->>API: POST orders + idempotency key
  API->>DB: Transaction: lock cart/products, reserve, snapshot
  DB-->>API: Pending order
  API-->>UI: 201 Order
  UI->>API: POST checkout/sessions + idempotency key
  API->>DB: Claim checkout creation
  API->>ST: Create session with stable provider key
  ST-->>API: Session URL and expiry
  API->>DB: Persist session
  API-->>UI: Checkout URL
  UI->>ST: Redirect and pay test card
  ST->>API: Signed raw webhook
  API->>DB: Durable unique inbox insert
  API-->>ST: 200 received
  W->>DB: Claim event and read order
  W->>ST: Retrieve session when verification requires
  W->>DB: Transaction: settle payment and consume reservations once
  UI->>API: GET order (poll after return)
  API-->>UI: PAID or pending/review state
```

```mermaid
stateDiagram-v2
  [*] --> PENDING_PAYMENT: reserve inventory
  PENDING_PAYMENT --> PAID: verified paid session / consume
  PENDING_PAYMENT --> CANCELLED: cancellation confirmed / release
  PENDING_PAYMENT --> EXPIRED: unpaid provider expiry confirmed / release
  PAID --> PROCESSING: admin
  PROCESSING --> SHIPPED: admin
  CANCELLED --> PAYMENT_REVIEW: contradictory late paid event
  EXPIRED --> PAYMENT_REVIEW: contradictory late paid event
```

Duplicate events are no-ops. PAYMENT_REVIEW has no automated outgoing transition in MVP. Cancellation intent is orthogonal to status until provider confirmation. External outages hold inventory and require retry/alerting rather than guessing the payment result.
