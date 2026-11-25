# Data dictionary

Task ARCH-001. Proposed PostgreSQL/Prisma logical fields, all defined here for implementation alignment. No existing database was found. `?` means nullable, not an omitted column. All PKs named id are UUID, generated server-side. `time` means timestamptz UTC; `int` means PostgreSQL integer; `text` means text with application length validation. Defaults are explicit below. Enum values are closed. Foreign-key relationships and indexes are in [ERD](erd.md).

AUTH-002 later inspection found an implemented Google-only schema. The proposed [local-auth model extension](../implementation/auth-implementation-plan.md) now defines User.googleSubject nullable, emailVerifiedAt, PasswordCredential, AuthActionToken and AuthMailOutbox. These are new migration requirements, not fields found in the inspected schema. For these entities/deltas, AUTH-002 supersedes the original required-googleSubject model below. Do not create fake Google subjects for local accounts, rewrite migration history or merge identities by email.

SEC-001 storage deltas: [data protection](../security/data-protection.md) requires authenticated encryption of address-bearing fields and OAuth verifier; API DTOs do not change. In Order, shippingAddress JSONB stores the versioned encryption envelope, decrypting/validating Address only after authorization. In IdempotencyRecord, responseBody JSONB stores the encrypted response envelope. encryptedCodeVerifier text stores the serialized envelope. Exact envelope fields/crypto/AAD are defined in data protection. Plaintext-at-rest interpretations in the initial logical field tables below are superseded by this storage mapping. Data deletion/anonymization migration remains a production blocker; existing RESTRICT historical references are not a complete erasure design.

Order additionally has checkoutRequestedExpiresAt time? default null, set atomically with checkoutFirstAttemptAt before first Stripe call to firstAttemptAt+31min, immutable afterward. This freezes exact provider request parameters across retries; reservationExpiresAt may later align to the actual remote expiry without changing it. No new client field is accepted.

## User, identity and sessions

| Entity | Fields, types, defaults and constraints |
|---|---|
| User | id UUID PK; googleSubject text unique required 1..255; email text unique normalized lowercase <=254; displayName text 1..100; role enum CUSTOMER(default)/ADMIN; createdAt time default now; updatedAt time maintained on write |
| AuthSession | id UUID PK (JWT sid); userId UUID FK User; csrfTokenHash text SHA-256 hex; expiresAt time required (creation+15min); revokedAt time? default null; createdAt time default now |
| OAuthAttempt | id UUID PK; stateHash text unique SHA-256 hex; browserBindingHash text SHA-256 hex; nonceHash text SHA-256 hex; encryptedCodeVerifier text required encrypted at rest with server-held key; expiresAt time creation+5min; consumedAt time? default null; createdAt time default now |

Never persist Google access/refresh tokens or raw authorization codes for this identity-only flow. CSRF raw token may be derived securely per session or encrypted in a session field if retrieval requires it; to keep this model exact, GET auth/session issues a new random token and replaces csrfTokenHash. Clients refetch after token conflicts; existing UI tabs may need refresh. Use a response/token issuance lock to avoid issuing an unhashed token. OAuthAttempt deletion after expiry is safe; AuthSession revocation/expiry remains authoritative regardless of cookie.

## Catalog and cart

| Entity | Fields, types, defaults and constraints |
|---|---|
| Category | id UUID PK; name text 1..80; slug text unique 1..80 per API pattern; createdAt time default now; updatedAt time maintained |
| Product | id UUID PK; categoryId UUID FK Category; sku text unique 1..64 API pattern; name text 1..200; description text 0..5000 default empty; price int 1..100000000; currency text fixed USD; imageUrl text? default null; stockOnHand int 0..1000000; stockReserved int default0 with 0<=reserved<=onHand; active boolean default true; version int default1; createdAt time default now; updatedAt time maintained |
| Cart | id UUID PK; userId UUID unique FK User; version int default1; createdAt time default now; updatedAt time maintained |
| CartItem | id UUID PK; cartId UUID FK Cart; productId UUID FK Product; quantity int 1..99; createdAt time default now; updatedAt time maintained; unique(cartId,productId) |

availableQuantity is computed as stockOnHand-stockReserved and is never separately stored. Cart totals are computed from current catalog data, not authoritative persisted prices. Enforce 50-line limit by locking Cart when adding. The API Product.version is the current row version; cart line updates do not modify product version unless inventory changes.

## Orders and stock

| Entity | Fields, types, defaults and constraints |
|---|---|
| Order | id UUID PK; userId UUID FK User; cartId UUID FK Cart; cartVersion int required; status enum PENDING_PAYMENT(default)/PAID/PROCESSING/SHIPPED/CANCELLED/EXPIRED/PAYMENT_REVIEW; shippingAddress JSONB conforming exactly to API Address; subtotal/shippingTotal/taxTotal/grandTotal int each 0..100000000, grandTotal=sum; currency text fixed USD; reservationExpiresAt time required; stripeSessionId text? unique default null; checkoutState enum NOT_STARTED(default)/CREATING/READY/RECONCILING/CLOSED; checkoutClaimUntil time? null; checkoutFirstAttemptAt time? null; cancellationRequestedAt time? null; paidAt time? null; version int default1; createdAt time default now; updatedAt time maintained |
| OrderItem | id UUID PK; orderId UUID FK Order; productId UUID FK Product; sku text 1..64 snapshot; name text 1..200 snapshot; unitPrice int 1..100000000; quantity int 1..99; lineTotal int 1..100000000 equal unitPrice*quantity; unique(orderId,productId) |
| InventoryReservation | id UUID PK; orderId UUID FK Order; productId UUID FK Product; quantity int 1..99; status enum ACTIVE(default)/CONSUMED/RELEASED; expiresAt time required; resolvedAt time? null; createdAt time default now; unique(orderId,productId) |

reservationExpiresAt begins at creation+30min, then is aligned with actual Stripe expiry on session persistence; update corresponding ACTIVE reservation expiresAt too. Never release just on time. checkoutClaimUntil is a worker/API lease, not an inventory expiry. checkoutFirstAttemptAt bounds provider-idempotency safety. Cross-field application checks: paidAt set only when a verified payment is recorded; historical paidAt remains on later fulfillment states; resolvedAt non-null exactly for resolved reservations. Order DTO excludes operational checkout fields and user/cart IDs.

On successful payment, clear only purchased cart lines if cart.version still equals Order.cartVersion, and increment cart.version. If a user edited the cart meanwhile, preserve it and let UI show the purchased order separately; avoid deleting their newer changes. Document this behavior on the checkout confirmation UI. Reservation stock changes increment Product.version so concurrent admin updates conflict safely.

## Payments, jobs and audit

| Entity | Fields, types, defaults and constraints |
|---|---|
| Payment | id UUID PK; orderId UUID unique FK Order; stripeSessionId text unique; stripePaymentIntentId text? unique; amount int 1..100000000; currency text fixed USD; status enum SUCCEEDED/REVIEW; paidAt time?; createdAt time default now; updatedAt time maintained |
| WebhookEvent | id UUID PK; stripeEventId text unique; type text <=200; orderId UUID? FK Order default null; sessionId text?; payload JSONB verified minimum provider fields only (event ID/type/created/livemode plus session ID/mode/payment_status/amount_total/currency/metadata.orderId/payment_intent); status enum RECEIVED(default)/PROCESSING/PROCESSED/REVIEW; attempts int default0 >=0; nextAttemptAt time default now; claimUntil time? null; lastErrorCode text? max100; receivedAt time default now; processedAt time? null |
| IdempotencyRecord | id UUID PK; userId UUID FK User; method text POST; route text canonical route <=200; key text 16..128 per API; requestHash text SHA-256 canonical-body hash; status enum IN_PROGRESS/COMPLETED; responseStatus int?; responseBody JSONB?; resourceId UUID?; claimUntil time?; createdAt time default now; expiresAt time creation+24h; unique(userId,method,route,key) |
| AuditLog | id UUID PK; actorId UUID FK User; resourceType enum PRODUCT/ORDER; resourceId UUID; action enum CREATE_PRODUCT/UPDATE_PRODUCT/ARCHIVE_PRODUCT/UPDATE_ORDER_STATUS; changes JSONB allowlisted changed catalog fields or previous/new order status, never address/credentials; requestId UUID; createdAt time default now |

SEC-001 adds SecurityAuditOutbox: id UUID PK (eventId); eventType text allowlisted <=100; occurredAt time default now; requestId UUID?; actorId UUID?; resourceType text? <=100; resourceId UUID?; outcome enum SUCCESS/DENIED/FAILURE/REVIEW; reasonCode text? allowlisted <=100; metadata JSONB closed per-event schema <=8KiB total event; exportedAt time? default null; attempts int default0 >=0; nextAttemptAt time default now. Identifiers are audit references without FKs so evidence survives approved erasure; never embed raw personal data. Allowed event types cover AUTH_LOGIN_STARTED, AUTH_LOGIN_SUCCEEDED, AUTH_LOGIN_DENIED, SESSION_REVOKED, ROLE_CHANGED, AUTHORIZATION_DENIED, CSRF_DENIED, RATE_LIMITED, PRODUCT_CHANGED, ORDER_STATUS_CHANGED, CHECKOUT_CHANGED, WEBHOOK_DENIED, PAYMENT_CHANGED, RECONCILIATION_REVIEW, KNOWLEDGE_CHANGED, PRIVACY_CHANGED and RETENTION_PURGED; infrastructure events use protected platform sources. Metadata keys/values and delivery semantics are constrained by [incident response](../security/incident-response.md). Add (exportedAt,nextAttemptAt) index and role grants preventing event-body modification/deletion by runtime roles; collector updates only exportedAt/attempts/nextAttemptAt. Business mutation and outbox insert commit together; delivery retries deduplicate on eventId. Purge delivered outbox rows after7days only after durable sink confirmation, under the approved audit retention schedule.

Webhook payload projection is computed after signature verification; do not persist raw customer details. Event timestamps are provider values inside the projection and never trusted for authorization. Payment REVIEW records contradictory outcomes without claiming fulfillment. Failed worker attempts retry with backoff; after ten attempts or 24 hours move to REVIEW and alert an operator. REVIEW retains unresolved stock holds. Idempotency response snapshots contain addresses: restrict DB access and purge on expiry; exact replay requires durable snapshots during the retention period. Lease recovery must first inspect resourceId/business uniqueness and provider key before retrying an effect.

## Knowledge corpus

| Entity | Fields, types, defaults and constraints |
|---|---|
| KnowledgeDocument | id UUID PK; documentId text stable slug 1..100; title text 1..200; version text 1..40; status enum DRAFT(default)/APPROVED/RETIRED; owner text 1..200; approvedAt time? null; sourcePath text 1..500 constrained to docs/ai-knowledge; contentHash text SHA-256; createdAt time default now; unique(documentId,version) |
| KnowledgeChunk | id UUID PK; documentVersionId UUID FK KnowledgeDocument; section text 1..200; ordinal int >=0; content text 1..4000; unique(documentVersionId,section,ordinal) |

Publishing requires APPROVED, non-null approvedAt and an identified approver in owner metadata; only one approved active version per documentId via a partial unique index. Retrieve only APPROVED documents, never rely on prompt instructions to suppress drafts. API citation documentId is the stable slug; version disambiguates immutable sources. Approval revocation immediately removes retrieval eligibility. Re-ingestion replaces chunks transactionally after hash/version checks. No customer data or credentials belong in source documents.
