# Data protection and privacy lifecycle

Task SEC-001. Controls SEC-10/12/13/15; threats T-08/15/16. Requirements apply to logs, replicas, caches, traces, exports, backups and processors as well as PostgreSQL. Privacy applicability must be decided from merchant establishment, customer locations, targeting, data categories and processor locations; a US-form demo address or operator timezone is not a legal conclusion.

## Data inventory and purpose

| Data | Purpose / access | Protection and minimization |
|---|---|---|
| Google subject, verified email, display name | Login/account display; identity module and verified owner | No Google tokens retained; encrypted DB volumes; no marketing reuse; identity-only queries |
| JWT, CSRF, OAuth attempt | Authenticate and prevent request replay; identity service only | Cookies/hashes, encrypted verifier, short expiry; never traces/browser storage |
| Cart and product references | Persistent shopping experience; owner/API | No address until checkout; actor-scoped queries; encrypted DB volumes |
| Order shipping address/optional phone | Fulfillment/account view; owner and authorized fulfillment admin | Application field encryption plus volume encryption; phone optional; no model/provider/log exposure |
| Prices, order/payment IDs, stock and audit | Reconcile orders/payments and accountability; scoped services/operators | No PAN/CVV; minimum Stripe projection; integrity checks and access logging |
| IP/request/security metadata | Abuse/security detection; security operators only | Avoid full query strings and user agents; rotate keyed pseudonyms; minimize raw IP retention |
| Question/public document excerpts | FAQ-only inference; isolated support | No chat persistence, no model training/prompt tracing by configuration; filter private data; approval before external processing |
| Idempotency response snapshots | Exact safe retries; owning user/API | Address-bearing bodies encrypted;24h retention only; exclude from debug tools |

Maintain a processor/subprocessor register for hosting, Google, Stripe, AI, observability and backup vendors: purpose, categories, region, contractual roles, retention, access, transfer safeguards, deletion route and incident contact. Approve processing agreements and an intelligible privacy notice before real-user collection. Separate essential session/security functions from optional analytics or AI; do not treat a generic terms checkbox as consent for all processing. No advertising trackers in this scope. Assess whether a privacy impact assessment, children's safeguards or special-category restrictions apply; disable unsupported collection/features until resolved.

Official context: [European Commission data protection guidance](https://commission.europa.eu/law/law-topic/data-protection/data-protection-explained_en). Where GDPR or another regime applies, privacy reviewer maps its purposes, lawful grounds, rights, transfers, security and notification requirements to this inventory. This document neither asserts GDPR applicability nor substitutes proposed periods for legal requirements.

## Encryption and key lifecycle

Public/non-loopback internal connections use verified TLS1.2+ including PostgreSQL sslmode=verify-full/equivalent hostname+CA validation. Prefer TLS1.3; never disable certificate checks for providers. Use managed encrypted volumes for PostgreSQL data, WAL, replicas and temporary storage, and separately encrypted backup objects. Infrastructure/container/host crash dumps are disabled or encrypted and restricted.

Application encryption is additionally required for Order.shippingAddress, address-bearing IdempotencyRecord.responseBody and OAuth PKCE verifier. Use vetted AES-256-GCM envelope encryption, a fresh random96-bit IV for each field encryption, 128-bit tag, and authenticated associated data containing environment, entity, row ID, field name and schema version. Never reuse an IV with the same data key. Data keys are wrapped by a KMS-held key separated from database/backup administration; only authorized API operations obtain decrypt capability. Worker cannot decrypt addresses. Integrity/authentication failure is a safe error/alert, never empty plaintext fallback. No deterministic encryption of addresses.

Exact proposed persisted JSON envelope for address and idempotency fields: `{encVersion:1,keyId:string,wrappedKey:string,iv:string,ciphertext:string,tag:string}`; binary values base64url. API DTOs remain plaintext over TLS after authorization. Order shippingAddress remains JSONB but stores the envelope, not Address; responseBody remains JSONB but stores the envelope, not a raw response. encryptedCodeVerifier uses the JSON serialization of that envelope in its existing text field. Length limits/provider KMS identifier formats must be pinned in Backend's storage schema; no encrypted blob is accepted from clients. Include AAD fixture tests and update dictionary/migrations together. This is a deliberate internal-storage delta, not an additional public API.

Identity email/name still require encrypted at-rest volumes; their current plaintext-in-live-DB lookup is a residual disclosure risk. If field encryption for identity is required by the applicability assessment, design separate encrypted values and a keyed lookup digest with versioned migration/uniqueness tests before changing the schema; do not improvise a database field in implementation.

Keys/secret credentials are environment-separated and managed outside source/images/Compose literals. Proposed maximum routine intervals: JWT signing90days, provider/DB static credentials90days or shorter vendor limits, data keys90days, KMS wrapping key365days. Prefer short-lived workload credentials; revoke immediately on suspected compromise. Rewrap data keys without exposing plaintext during KMS rotation; re-encrypt fields if a data key is compromised. Keep decryption versions only for retained records/backups, with audited restricted use; destroying keys before retained backups expire must be an approved crypto-erasure decision. Record key IDs/owners/rotation dates, not key values, and run a rotation drill before launch.

## Least-privilege database identities

| Identity | Permitted operations | Explicitly denied |
|---|---|---|
| api | Required scoped identity/cart/catalog/order operations; verified event inbox insert; atomic business audit insert | Schema changes, superuser, role management, bulk backup access, audit update/delete |
| worker | Reservation/order/payment state and inbox claims/projections; needed stock/cart reconciliation columns | Identity profile/session/OAuth reads; address field decryption; arbitrary admin writes |
| support | SELECT approved public document view/chunks only, or read-only approved artifact mount | All commerce/auth tables, migrations, KMS decrypt and provider payment credentials |
| migrate | DDL during controlled deployment only | Runtime use, Internet ingress; credential not mounted in API/worker |
| backup/privacy operator | Narrow audited backup or approved lifecycle procedure | Interactive unrestricted app role; routine audit modification |

Use column grants/views or restricted stored procedures to enforce worker exclusions because Order also contains shipping ciphertext. Enforce actor ownership in API even when SQL role covers multiple users; consider RLS as an additional layer only with tested pooled-connection context reset. Migration role owns schema; app role must not own tables or disable RLS/constraints. Production access uses short-lived credentials where supported and logged break-glass approvals.

## Retention schedule — proposed engineering defaults, owner approval required

| Category | Proposed maximum / trigger | Purge and exceptions |
|---|---|---|
| OAuthAttempt |5min usable, purge within1h after expiry/consumption | No raw codes/Google tokens retained at all |
| AuthSession |15min usable; purge expired/revoked rows within24h | Security event metadata retained separately, no reusable tokens |
| Idempotency response/key |24h after request completion; purge within next24h | Business uniqueness remains in order/payment records; unresolved requests keep minimal reference, not address snapshot |
| Abandoned cart |30days after last edit | Delete rows; do not make reads extend retention |
| Dormant identity |24months inactivity, with approved notice/request workflow | Delete/anonymize only after resolving lawful order holds and pending payments; no current activity field assumed |
| Order/payment/fulfillment address | Proposed24months after final resolution | Owner/legal reviewer must approve actual statutory/accounting/dispute schedule; redact address earlier when fulfillment/support purpose ends; no blanket indefinite retention |
| Raw abuse IP |24h rolling maximum | Retain rotating keyed pseudonym up to30days; IPs may still be personal data |
| Security/audit metadata | Security logs30days; admin/payment audit90days | Jurisdiction/investigation hold documented with review every30days; no raw payloads |
| Backups | Rolling35days; encrypted and nonpublic | Tombstone/deletion replay before restore serves traffic; holds in separately restricted approved archive only |
| Chat content | No persistence; ephemeral request processing only | Provider storage/training disabled; processor terms must support chosen mode; caches/traces excluded |

These periods are proposals, not approved legal/business policies. Production collection is blocked until owner/privacy reviewer chooses an approved schedule with a purpose for each exception. Run purge daily with counts/errors/oldest-overdue metrics; alert on >24h delay. Safe purge of consumed payment event payloads must preserve deduplication references for at least the retained order lifetime; deleting business uniqueness merely because a webhook payload expired is forbidden.

## Rights, deletion and recovery

Use an authenticated, verified operator workflow for access/export/correction/deletion/restriction requests; no public lifecycle API is invented. Verify control of the existing account without asking for passwords/card numbers or collecting identity documents by default. Record request category, pseudonymous subject, verification method, applicable response deadline, holds, status and completion in a restricted privacy ledger. Rate-limit requests; export only scoped data using encrypted short-lived download access (<=24h), never a public URL or another user's details.

Deletion first revokes sessions and blocks new processing, resolves pending Stripe outcomes/reservations, purges carts/OAuth/idempotency snapshots, then erases or irreversibly anonymizes identity and address data not subject to a documented hold. RESTRICT foreign keys mean simple hard delete will fail: Backend must design tombstoned User records/pseudonymous historical references and nullable/redacted shipping snapshots with versioned storage changes before implementing deletion. Do not claim the original dictionary already supports erasure. Keep necessary order amounts/payment deduplication under restricted legal purpose; do not retain identifying fields merely to avoid a migration.

Maintain deletion tombstones outside the restored dataset for at least backup lifetime plus7days; replay them and purge expired records before reopening a restored service. Propagate deletion to replicas, search indexes, exports and processors; record confirmations or pending legal holds. Backups may expire under the approved isolation schedule rather than in-place modification, but cannot reintroduce erased users into service. Test access/deletion with a multi-order fixture and a restored backup; loss of a deletion ledger blocks restore release.

Backup targets RPO<=15min/RTO<=4h, encrypted WAL shipping plus daily base backup, isolated restore at least quarterly and before launch. Separate immutable backup permissions from app credentials; verify checksum, keys and restore drills. Details and communications are in [incident response](incident-response.md). Jurisdiction, lawful retention, rights workflow and lifecycle migration approval remain production blockers.
