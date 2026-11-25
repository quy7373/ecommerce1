# API contract v1

Task ARCH-001. Proposed authoritative implementation baseline, not a claim about existing code. Base path `/api/v1`. JSON uses UTF-8 and camelCase. All schemas below are closed objects (unknown fields rejected), all properties required unless `?` marks optional, and `|null` explicitly permits null. Arrays may be empty unless otherwise stated. No undefined fields appear on the wire. Responses omit secrets and internal provider payloads. Business policy defaults are DRAFT requiring owner approval; see [architecture](../architecture/system-architecture.md).

Security update SEC-001: [critical security acceptance criteria](../security/security-requirements.md) and [API/browser enforcement](../security/api-security.md) are normative. Production host cookies, MFA/recent-admin authentication, shared abuse quotas, parser protections, headers and storage encryption below extend the initial baseline. No implementation security verification is claimed.

AUTH-002 adds the proposed [email/password registration, login and recovery contract](email-password-auth-contract.md). Those new routes use preauth Origin+CSRF rather than AuthSession CSRF; passwords are NFC-normalized without trimming and action tokens remain raw ASCII, explicit exceptions to generic string normalization. Google/session/logout continue unchanged. User.email may now come from verified email registration as well as verified Google claims; the public User DTO is unchanged. No new route is claimed implemented until Backend delivers it.

## Shared exact schemas and validation

Notation: `UUID` is a UUID string; `Instant` is RFC3339 UTC timestamp; `Money` is integer cents 0..100000000; `CartMoney` is integer cents 0..495000000000 (50 lines * 99 units * maximum unit price), calculated without persistence; `Qty` is integer 1..99. Strings are trimmed, Unicode text normalized NFC, with lengths measured in Unicode code points. Reject invalid JSON/types, duplicate query parameters, NaN and noninteger numeric strings. Query integers are base-10 digit strings. Unknown query parameters rejected. Body limit 16 KiB except webhook 1 MiB. UUID path parameters must be valid or 400. Timestamps and IDs are server-generated. Use text escaping in UI; do not accept HTML content.

```ts
type Role = "CUSTOMER" | "ADMIN";
type OrderStatus = "PENDING_PAYMENT" | "PAID" | "PROCESSING" | "SHIPPED" | "CANCELLED" | "EXPIRED" | "PAYMENT_REVIEW";
type User = { id: UUID; email: string; displayName: string; role: Role };
type Category = { id: UUID; name: string; slug: string };
type Product = {
  id: UUID; sku: string; name: string; description: string;
  category: Category; price: Money; currency: "USD";
  imageUrl: string|null; availableQuantity: number; active: boolean; version: number
};
type Page<T> = { data: T[]; pagination: { page: number; pageSize: number; totalItems: number; totalPages: number } };
type Address = {
  fullName: string; line1: string; line2?: string; city: string;
  region: string; postalCode: string; country: "US"; phone?: string
};
type CartItem = { product: Product; quantity: Qty; lineTotal: CartMoney };
type Cart = {
  id: UUID; version: number; items: CartItem[]; subtotal: CartMoney;
  shippingTotal: Money; taxTotal: Money; grandTotal: CartMoney; currency: "USD"
};
type OrderItem = { productId: UUID; sku: string; name: string; unitPrice: Money; quantity: Qty; lineTotal: Money };
type Order = {
  id: UUID; status: OrderStatus; items: OrderItem[]; shippingAddress: Address;
  subtotal: Money; shippingTotal: Money; taxTotal: Money; grandTotal: Money;
  currency: "USD"; createdAt: Instant; updatedAt: Instant;
  reservationExpiresAt: Instant; paidAt: Instant|null; cancellationRequestedAt: Instant|null;
  version: number
};
type Checkout = { orderId: UUID; sessionId: string; checkoutUrl: string; expiresAt: Instant };
type Cancellation = { order: Order; pending: boolean };
type ErrorBody = { error: { code: string; message: string; details: { field: string; code: string; message: string }[]; requestId: string } };
```

Response number constraints: quantities/availableQuantity nonnegative integers (cart/order quantity uses Qty), versions positive integers, page>=1, pageSize 1..100, totalItems/totalPages>=0, totalPages=ceil(totalItems/pageSize), empty result totalPages=0. `lineTotal=unitPrice*quantity` (cart uses product.price), subtotal=sum(lineTotal), grandTotal=subtotal+shippingTotal+taxTotal. Cart remains readable/editable at its larger CartMoney bound; order creation rejects totals above Money with 409 TOTAL_LIMIT_EXCEEDED before persisting any order or reservation. Compute using checked safe arithmetic before narrowing to database integers. Cart may contain inactive/unavailable products so users can remove them. Checkout cannot.

Address validation: fullName 1..100; line1 1..200; line2 if supplied 1..200; city/region 1..100; postalCode matches `^[0-9]{5}(-[0-9]{4})?$`; country must be US; optional phone matches `^\+[1-9][0-9]{7,14}$`. This is a test-market validation default, not an approved shipping promise. No address deliverability claim. Email in User comes from verified Google claims (maximum 254); displayName 1..100 with fallback `Customer`. Category name 1..80 and slug lowercase `[a-z0-9]+(?:-[a-z0-9]+)*`, max 80. imageUrl is null or HTTPS absolute URL <=2048 characters with no credentials; prohibit private/network-local targets if backend fetches images. Product fields and bounds follow group 9.

Success JSON is `{data:T}` unless Page<T>, explicitly unwrapped objects, or 204 below. All errors use ErrorBody including middleware errors; see [error conventions](error-conventions.md). Set X-Request-Id on every response; Cache-Control: no-store for identity, carts, orders, checkout, admin and support. Error codes listed per route supplement shared 400 VALIDATION_ERROR, 413 PAYLOAD_TOO_LARGE, 415 UNSUPPORTED_MEDIA_TYPE, 429 RATE_LIMITED, 500 INTERNAL_ERROR, 503 SERVICE_UNAVAILABLE. Protected routes add 401 UNAUTHENTICATED; admin routes add 403 FORBIDDEN. Every cookie-authenticated mutation adds 403 CSRF_INVALID. Non-JSON mutation bodies except OAuth/webhook are 415.

## Authentication and concurrency conventions

Public = no login. Session = valid app JWT cookie and unrevoked AuthSession. Admin = Session plus current ADMIN role and verified MFA assurance; admin mutations also require trusted authentication <=5min old. Missing assurance/recent authentication returns403 FORBIDDEN; concrete assurance integration is a production blocker described in [authentication design](../security/authentication-authorization.md), not a browser-supplied boolean. Read requests need no CSRF header. Mutations require exact allowed Origin plus `X-CSRF-Token` obtained from GET /auth/session. CSRF tokens are random, bound to AuthSession and compared in constant time; origin failures also use CSRF_INVALID. OAuth callback uses state binding instead. Stripe uses a verified signature instead. Missing resource or another user's resource both return 404 NOT_FOUND.

Cart mutation bodies require `cartVersion` (positive integer); lock cart and compare to current version, then increment on success. A mismatch is 409 VERSION_CONFLICT; refetch before retry. Admin updates use version similarly. Every logical create of order/Checkout requires `Idempotency-Key` header, 16..128 ASCII `[A-Za-z0-9_-]`. Scope key by user+method+canonical route, hash canonical body, and durably serialize claims. Same key/body returns the stored original status/body; changed body returns 409 IDEMPOTENCY_CONFLICT; in-progress returns 409 REQUEST_IN_PROGRESS with Retry-After: 1. Keep records at least 24 hours; retain order/payment business uniqueness indefinitely. Transient failures before side effects may be retried; unknown provider outcomes reconcile using deterministic provider key. No API-side Stripe retry may use a newly generated key for the same order.

## 1. Identity — /auth

| Method/path | Access/request | Success | Specific failures |
|---|---|---|---|
| GET /auth/google | Public; no body/query | 302 Location Google authorization URL; sets transient HttpOnly state-binding cookie | 503 identity unavailable |
| GET /auth/google/callback | Public; query `code` string 1..4096, `state` string 32..256; alternatively `error` string 1..100 + `state` | 302 Location fixed frontend `/account`; creates CUSTOMER on first verified login, sets session cookie, clears state cookie | 400 OAUTH_INVALID for missing/invalid/expired/reused state, code, nonce or invalid claims; 401 OAUTH_DENIED for valid-state provider denial; 409 ACCOUNT_LINK_REQUIRED for conflicting email; 503 provider unavailable |
| GET /auth/session | Session; no body/query | 200 unwrapped `{user:User,csrfToken:string,expiresAt:Instant}`; csrfToken base64url 32 random bytes; rotates the stored token hash, so earlier tab tokens must be refreshed after CSRF_INVALID | 401 |
| POST /auth/logout | Session; empty object `{}` | 204, revoke session and expire cookie | 401, 403 |

Allow provider-standard `scope`, `authuser`, `prompt`, `hd`, `error_description`, `error_uri` callback parameters as ignored bounded strings <=1024; never use them as verified claims or redirect targets. Success must contain code and state with no error; denial must contain error and state with no code. Reject other callback query fields. Production cookies: `__Host-session` and `__Host-oauth`, both Path=/, no Domain, Secure, HttpOnly, SameSite=Lax; Max-Age900 and300 respectively. Loopback HTTP development uses distinct unprefixed names only. This supersedes the original narrower cookie paths. One-time state is persisted server-side with hashed binding; no returnTo parameter. No API token is placed in a redirect URL or localStorage.

## 2. Catalog — /products

GET `/products` is Public. Query: `q?` 1..100 literal case-insensitive text search over name/description/SKU; `categoryId?` UUID; `minPrice?`, `maxPrice?` Money, min<=max; `inStock?` exactly `true` or `false` (false means include all); `sort?` one of `newest` (default), `price_asc`, `price_desc`, `name_asc`; `page?` default 1; `pageSize?` default 20, max 100. Returns 200 Page<Product>, active products only. Apply filters before count and pagination, use parameterized queries, and append id ascending as deterministic sort tie-breaker. `newest` uses createdAt descending. Page beyond results returns empty data with accurate totals. Unknown category gives empty page.

GET `/products/:productId` Public returns 200 `{data:Product}` for an active product; 404 NOT_FOUND otherwise. Both endpoints expose live availability estimates, not stock guarantees. No request body.

## 3. Categories — /categories

GET `/categories` Public, no query/body, returns 200 `{data:Category[]}`, sorted name ascending then id. Category creation/editing is seed/operator-managed in MVP; no undocumented category write route.

## 4. Cart — /cart

All routes Session; cart is created lazily once per user with initial version=1. Maximum 50 distinct items. Cart totals use current product prices, zero demo shipping/tax. Reading does not change the version. Price changes can change totals without a cart-version change; order creation always revalidates.

| Method/path | Exact request body | Success | Specific failures |
|---|---|---|---|
| GET /cart | none | 200 `{data:Cart}` | shared |
| POST /cart/items | `{productId:UUID,quantity:Qty,cartVersion:number}`; add quantity to existing line, aggregate <=99 | 200 `{data:Cart}` | 404 product missing/inactive; 409 OUT_OF_STOCK, CART_LIMIT_EXCEEDED, VERSION_CONFLICT |
| PATCH /cart/items/:productId | `{quantity:Qty,cartVersion:number}`; replace quantity | 200 `{data:Cart}` | 404 line absent; 409 OUT_OF_STOCK, PRODUCT_UNAVAILABLE, VERSION_CONFLICT |
| DELETE /cart/items/:productId | `{cartVersion:number}` | 200 `{data:Cart}` | 404 line absent; 409 VERSION_CONFLICT |

Availability checks are advisory at cart edit time; carts never reserve inventory. Quantity zero is invalid; remove uses DELETE. Serialized mutation and version increment happen in one transaction. Read endpoints have no query parameters.

## 5. Orders — /orders

Session and ownership required. GET list query `page?=1`, `pageSize?=20` max100, `status?` OrderStatus; sort createdAt descending then id ascending. Returns 200 Page<Order>. GET `/orders/:orderId` no query/body returns 200 `{data:Order}` or 404. All status values are visible, including reconciliation states.

POST `/orders`: Idempotency-Key required. Body `{cartVersion:number,shippingAddress:Address}`. Returns 201 `{data:Order}`, Location `/api/v1/orders/<id>`. Snapshot current cart and totals, reserve inventory atomically, status PENDING_PAYMENT, version=1. Empty cart is 409 CART_EMPTY; changed cart 409 VERSION_CONFLICT; active pending order for same cart version 409 ORDER_ALREADY_PENDING; inactive product 409 PRODUCT_UNAVAILABLE; insufficient stock 409 OUT_OF_STOCK; invalid address 400 VALIDATION_ERROR. For a retry with the same key replay before cart/stock checks. Do not accept client totals, price, status, role or userId. A new order for the same unchanged cart is allowed after prior order cancellation/expiry; only one active pending reference may exist.

SEC-001 abuse limits: at most3 active PENDING_PAYMENT orders/user, checked transactionally; excess returns409 ORDER_LIMIT_EXCEEDED. New order creation5/min/user, Checkout creation5/min/user and3/min/order, with429 RATE_LIMITED and Retry-After on request quotas. Repeated pending requests do not extend reservations. Shared authenticated read/mutation/IP quotas and counter failure behavior follow API security; idempotent replays are safe but still rate-limited.

POST `/orders/:orderId/cancel`: Session, `{}` body, no query. Returns 200 `{data:Cancellation}` with pending=false when cancelled/already CANCELLED; 202 with pending=true while provider outcome is unresolved. Cancellation intent is persistent, retries do not create another effect. 409 ORDER_NOT_CANCELLABLE for PAID, PROCESSING, SHIPPED, EXPIRED or PAYMENT_REVIEW; 404 foreign/missing order. Reconciliation may result in PAID if payment won. Poll order details; the API never claims cancellation before provider confirmation.

## 6. Checkout — /checkout

POST `/checkout/sessions`: Session, Idempotency-Key required, body `{orderId:UUID}`. Returns 201 `{data:Checkout}`, or 200 `{data:Checkout}` when an active session already exists for that order under a new request key. Replays retain original status. 404 foreign/missing order; 409 ORDER_NOT_PAYABLE for non-pending/cancellation requested/expired reservation; 409 CHECKOUT_EMPTY for zero grand total; 503 PAYMENT_PROVIDER_UNAVAILABLE when outcome must be retried/reconciled. Stripe metadata contains orderId only; line items come solely from snapshots. Server supplies fixed success URL `/account?orderId=<id>&payment=returned` and cancel URL `/checkout?orderId=<id>&payment=cancelled`; these query values are UI hints. Restrict card method and test mode. Worker and endpoint claim the same order state to prevent create/expiry races. Never return a URL other than a validated Stripe HTTPS Checkout host.

## 7. Payment notifications — /webhooks

POST `/webhooks/stripe`: Public network route authenticated by Stripe-Signature, exact raw provider JSON (Stripe Event schema at pinned SDK/API version, provider fields may vary). This is the sole exception to closed app objects. Required envelope fields: `id:string`, `type:string`, `livemode:boolean`, `created:integer`, `data:{object:object}`; event is cryptographically verified by SDK before use. Known events: checkout.session.completed, checkout.session.expired, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed. Async events are defensive handlers; new sessions allow cards only. Re-read provider session when state is uncertain. Require checkout.session object id, mode=payment, metadata.orderId, currency=usd, amount_total, payment_status and livemode=false for fulfillment. Nested provider fields follow pinned Stripe types, not an invented local copy.

Returns 200 unwrapped `{received:true}` after durable inbox insert, including duplicates or unsupported signed event types. 400 WEBHOOK_INVALID for absent/invalid signature or malformed envelope; 400 WRONG_PAYMENT_MODE for live event in test deployment; 413 oversized; 503 SERVICE_UNAVAILABLE when inbox cannot be committed. No session, CSRF or CORS dependency. Correctly signed business mismatches are durably stored for review and acknowledged, never applied blindly.

## 8. Administration — /admin/orders

Admin. GET `/admin/orders` query same pagination/status as customer list, returns 200 Page<Order> across users. GET `/admin/orders/:orderId` returns 200 `{data:Order}` or 404. No personal data is exposed in application logs.

PATCH `/admin/orders/:orderId/status` body `{status:"PROCESSING"|"SHIPPED",version:number}` returns 200 `{data:Order}`. Only PAID->PROCESSING and PROCESSING->SHIPPED are accepted; 409 INVALID_ORDER_TRANSITION or VERSION_CONFLICT, 404 unknown order. Audit actor, previous/new status and request ID atomically. No manual PAID, inventory release, refund, customer role or reconciliation override route. Admin list includes PAYMENT_REVIEW for operator investigation in payment tooling.

## 9. Administration — /admin/products

Admin. GET `/admin/products` supports catalog query plus `active?` exactly true/false (absent includes both), returns 200 Page<Product>. GET `/admin/products/:productId` returns 200 `{data:Product}` including inactive, or 404.

ProductWrite: `{sku:string,name:string,description:string,categoryId:UUID,price:Money,imageUrl:string|null,stockOnHand:number,active:boolean}`. SKU 1..64 uppercase `[A-Z0-9_-]+`, unique; name 1..200; description 0..5000 plain text; stockOnHand integer 0..1000000; currency fixed USD. Product price must be >=1 for sale. categoryId must exist. POST `/admin/products` body ProductWrite returns 201 `{data:Product}` and Location header; 409 SKU_CONFLICT; 400 VALIDATION_ERROR for invalid category.

Production imageUrl additionally requires a configured store-owned HTTPS image CDN host allowlist, no credentials/nonstandard port; invalid host returns400 VALIDATION_ERROR. Backend does not fetch remote images in MVP. Frontend img-src CSP must match the same deployment allowlist.

PATCH `/admin/products/:productId` body `Partial<ProductWrite> & {version:number}` requires at least one write field. Returns 200 `{data:Product}`; 404 missing; 409 VERSION_CONFLICT, SKU_CONFLICT or STOCK_RESERVED if new stockOnHand < stockReserved. All changes increment version and audit. DELETE `/admin/products/:productId` body `{version:number}` performs soft archive active=false, returns 204; 404 missing or 409 VERSION_CONFLICT. Historical order snapshots and existing reservations survive archival. No hard deletion route. Product stockOnHand is only an admin input; public Product returns availableQuantity to avoid confusing reserved versus physical inventory.

## 10. AI support — /support

POST `/support/messages` Public; require allowed Origin, Content-Type application/json, maximum 10 requests/minute per IP (authenticated user limiter also applied when available); no cookie required and no CSRF because no account effect. Body `{message:string}` length 1..2000, no conversation ID/history. Returns 200 `{data:{answer:string,citations:{documentId:string,title:string,version:string,section:string}[],escalated:boolean}}`. answer length 1..4000; citations <=5, all from approved retrieved chunks. No evidence: exact answer `I cannot confirm this from approved store information. Please contact store support.`, citations=[], escalated=true. Supported answer requires >=1 verified citation and escalated=false. If output checks fail use the same no-evidence response. 400 VALIDATION_ERROR, 403 ORIGIN_FORBIDDEN, 429 RATE_LIMITED; 503 AI_UNAVAILABLE for configured provider failure. No configured/approved corpus uses safe no-evidence response and does not call AI. No unapproved contact details or binding return/shipping promises may be generated.

## Operational routes (outside ten business groups)

GET `/health/live` Public returns 200 `{status:"ok"}` without external calls. GET `/health/ready` returns 200 `{status:"ready"}` when DB/migrations available; otherwise 503 ErrorBody. Do not return configuration or connection details. These paths are also under `/api/v1`.
