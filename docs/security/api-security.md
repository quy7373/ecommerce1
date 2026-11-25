# API and browser security

Task SEC-001. SEC-03..07/09/12/14; threats T-03/04/09/12/14/16. [API v1](../api/api-contract.md) remains the exact functional contract; this document specifies its security enforcement order. Do not rely on hidden buttons, UUID unpredictability, CORS or frontend validation for authorization.

## Request pipeline and parser controls

1. Trusted ingress enforces TLS, host allowlist, request/header size and timeouts, strips client forwarded/assurance headers and assigns request IDs. Express trusts only explicit proxy CIDRs/hop topology; no blanket trust proxy=true. API/DB ports are private. Readiness reveals no configuration; detailed metrics/admin consoles require separate operator authentication.
2. Route-specific size/type controls: application JSON16KiB, Stripe raw JSON1MiB, request headers16KiB, header read5s and whole inbound request30s (streaming is not supported). Disable compressed request bodies or apply the same decompressed byte ceiling before parsing. Reject ambiguous content-length/transfer-encoding and duplicate Host/content-length at ingress; keep ingress/runtime HTTP parsers patched.
3. Webhook raw-body route mounts before JSON middleware and uses signature rather than session authentication. OAuth callback uses bounded provider query parsing plus state validation. Other app mutations accept application/json only and closed object schemas. Reject invalid UTF-8, duplicate JSON keys/query parameters, unknown fields, prototype-pollution keys (`__proto__`, `constructor`, `prototype`) and nonfinite/unsafe numbers. Express JSON.parse alone does not detect duplicate keys: use a reviewed parser/preflight validator. Normalize expected text once before validation, not arbitrary double-decoding. Do not trim cryptographic tokens/provider raw bytes.
4. Apply limits, then authenticate/resolve current role, verify required Origin/CSRF, validate route schema and execute actor-scoped service operations. Coarse size/abuse checks precede expensive crypto/provider calls. No sensitive business read occurs before authorization. CSRF failures do not reveal whether a target belongs to somebody else.
5. Use typed Prisma/parameterized raw SQL only; map sort enums to hardcoded columns, escape literal search wildcards, never interpolate user input into SQL/shell/template/regex source. No server-side product-image fetching in MVP. Any future fetch requires explicit protocol/host/port allowlist, DNS/IP/redirect revalidation and blocking private/link-local/metadata addresses, plus egress firewall.
6. Serialize allowlisted DTOs; centralize [safe errors](../api/error-conventions.md) including malformed parser/body/rate-limit failures. No stacks/provider dumps/SQL in responses. Use no-store on sensitive JSON and HTML that embeds private state; exclude API responses from service-worker/CDN caches.

## Shared anti-abuse budgets

Initial ceilings are engineering defaults; load-test and adjust through documented security review, not an unreviewed unlimited fallback. Sliding60s windows, burst capacity equal to stated per-minute count. Return429 plus Retry-After; hard body/time violations use documented errors. Shared counters at ingress or PostgreSQL-backed transactional buckets must be consistent across two API replicas.

| Operation | Limit | Additional guard |
|---|---|---|
| Catalog reads |120/min/IP | pageSize<=100; bounded q/filter enums |
| Login initiation/callback |20/min/IP, callback also single-use attempt | Never lock victim account solely by submitted email |
| Authenticated reads |120/min/user and300/min/IP | Cart/order lists scoped; no unrestricted export |
| Authenticated mutations |60/min/user and120/min/IP | CSRF, version checks, state machine |
| Order creation |5/min/user | max3 active pending orders/user, one per cart version; reservation length not extended by repeated requests |
| Checkout creation |5/min/user and3/min/order | Reuse stable session/provider key; idempotent replay consumes abuse quota but never duplicates effects |
| AI support |10/min/IP and10/min/user when logged in | max2 in-flight/IP; global max10 in-flight; output/provider token and spend caps |

Distributed bot stock hoarding remains a residual risk; watch unusually high pending-order occupancy and cancellation rates, and use measured friction without automatically granting access or compromising privacy. Trusted IP derivation must work with IPv4/IPv6; cookie-authenticated requests use both user and IP quotas. Avoid retaining raw IPs in counters beyond24h. When counters fail, reject expensive/mutating operations with503; bounded public catalog fallback may use conservative local limits but must emit an alert. Stripe uses a separate queue/body/concurrency budget and signature controls; ordinary shopper quotas must not drop valid provider retries.

Provider client timeout15s, support10s, DB statement timeout5s/lock timeout2s; cap serializable retries at3 and total operation deadline20s, within the30s ingress ceiling. Enforce the cumulative deadline rather than multiplying it by retries. Network-unknown payment effects remain reconciled. Worker jobs use bounded leases/backoff; queue age/backlog alerts prevent silent stuck payments. Resource caps apply per container/process and aggregate provider account.

## CSRF, CORS and browser controls

Production is same-origin via /api proxy. If separate origins are necessary, explicitly enumerate scheme+host+port; reject null, suffix matches, wildcard reflection and unapproved origins. Credentials=true only for trusted origins; Vary: Origin; allow only used methods and Content-Type, X-CSRF-Token, Idempotency-Key headers; expose X-Request-Id/Retry-After/Location only. Preflight carries no business action or private data. CORS is a browser read policy and does not authenticate scripts/servers.

Cookie-authenticated POST/PATCH/DELETE require allowed exact Origin and session-bound X-CSRF-Token. Missing/null Origin fails; only explicit OAuth state and Stripe signature routes are exempt. Check Fetch Metadata as an extra signal, never a substitute for token/Origin. GET auth/session rotates a CSRF token but changes no business state; no other GET may mutate. Public support requires allowed Origin but has no account effect/CSRF token requirement. Production cookies follow [authentication](authentication-authorization.md).

Render product names/descriptions, error messages and chatbot answers through React text nodes. Prohibit dangerouslySetInnerHTML, eval/new Function, user-defined scripts/templates and unsanitized Markdown/links. Citation labels are text and links are derived from approved server metadata, not generated URLs. Validate HTTPS image URLs; production adds a store-owned CDN host allowlist, no arbitrary tracking images. Use referrerPolicy=no-referrer and image CSP restrictions. No client analytics/session-replay on account/checkout/support pages.

## Required response headers

| Header | Production policy |
|---|---|
| Content-Security-Policy | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' <approved-image-CDN>; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests` |
| Strict-Transport-Security | `max-age=31536000; includeSubDomains` on HTTPS; verify all subdomains can support TLS before enabling; use a dedicated domain if needed; preload only after separate review |
| X-Content-Type-Options | `nosniff`; accurate JSON/HTML/image MIME types |
| Referrer-Policy | `no-referrer` |
| X-Frame-Options | `DENY` as legacy complement to CSP |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=()`; hosted Stripe navigation is external |
| Cache-Control | `no-store` for private/auth/support/error state; immutable public hashed assets may cache |

Replace <approved-image-CDN> with exact approved origins; literal placeholders must not ship. Built Vite assets use external scripts/styles; no unsafe-inline/unsafe-eval. Hosted Google/Stripe flows use top-level navigation, so they need not be script-src/connect-src/frame-src exceptions. Re-test any added SDK/widget; do not broadly allow *.google.com or *.stripe.com. Collect only minimized CSP report fields at a private sink; full document URLs may carry IDs/PII. Enforce CSP in production after test/report verification, not report-only indefinitely.

Required evidence: header scans on static/API/error responses, invalid Origin/preflight/CSRF cases, stored/reflected/DOM XSS payloads, JSON duplicate/prototype tests, two-replica rate-limit bypass attempts, SSRF/metadata blocking, method/body/parser edge cases, negative database permissions, failure-mode timeouts and no private browser/cache storage. Release gates are in [security testing](security-testing-plan.md).
