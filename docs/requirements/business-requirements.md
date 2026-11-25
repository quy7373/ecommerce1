# Business requirements

Task ARCH-001. Scope: a complete test-mode E-Commerce implementation using React/Vite/Tailwind, Express, PostgreSQL/Prisma, Google login, JWT sessions, Stripe Checkout and evidence-grounded support. This is a proposed build specification. All commercial policies are DRAFT requiring owner approval; no document grants a shipping, refund or tax promise.

SEC-001 makes defense-in-depth security and user privacy mandatory: use the [threat model](../security/threat-model.md), [fifteen measurable security gates](../security/security-requirements.md) and [security testing plan](../security/security-testing-plan.md). ASVS5.0.0 Level2 is the verification target, with applicable privacy requirements determined before real-user collection. Functional completeness does not waive these requirements; no claim of complete security/compliance is made.

Actors: Visitor, Customer, Admin, Google identity provider, Stripe, reconciliation worker, store owner. Admin is an operator-assigned role, not a distinct login method. Visitors browse and ask document questions; customers must authenticate to use a persisted cart or place orders.

## Business functions and acceptance outcomes

| ID | Function | Observable acceptance condition |
|---|---|---|
| BF-01 | Google login | Valid code/state/nonce signs in; invalid or replayed credentials create no session |
| BF-02 | First-login registration | Verified new Google subject creates one CUSTOMER; concurrent callbacks cannot duplicate users |
| BF-03 | Session and logout | Protected routes require current JWT/session; logout revokes immediately |
| BF-04 | Role authorization | Customer admin calls receive 403 even when directly calling API |
| BF-05 | Product search | Case-insensitive literal name/description/SKU query returns matching active products |
| BF-06 | Category filtering | Results contain selected category only; unknown category yields empty list |
| BF-07 | Price filtering | Inclusive min/max integer cents boundaries apply; reversed range fails 400 |
| BF-08 | Sorting and pagination | Allowed sorts have stable ID tie-breaker; totals reflect all filters |
| BF-09 | Stock visibility | Public available quantity equals onHand minus reserved; stock is rechecked at order creation |
| BF-10 | Add to cart | Valid quantities aggregate within 99 and 50-line limit; no inventory reserved |
| BF-11 | Update quantities | Version-checked replacement prevents lost updates; zero rejected |
| BF-12 | Remove cart item | Version-checked removal returns updated cart and totals |
| BF-13 | Calculate totals | Server cents arithmetic is exact; clients cannot set price/tax/shipping |
| BF-14 | Validate shipping | Required fields and US test-market postal/phone rules enforced server-side |
| BF-15 | Create order | Snapshot and inventory reservations commit together or neither commits |
| BF-16 | Create Checkout session | Only owned payable orders; stable provider key prevents duplicate sessions |
| BF-17 | Verify payment notifications | Invalid signature never changes state; signed event is durable before acknowledgement |
| BF-18 | Reserve inventory | Concurrent final-unit purchases yield at most one reservation; no overselling |
| BF-19 | Release inventory | Confirmed unpaid cancellation/expiry releases once; unknown provider outcomes hold stock |
| BF-20 | Settle payment | Matching verified paid session consumes reservations once despite duplicates/reordering |
| BF-21 | Order history/details | Customer sees only own immutable purchase/address snapshots and current status |
| BF-22 | Cancel order | Pending order cancellation is confirmed with provider; paid order cancellation is rejected |
| BF-23 | Admin product management | Create/edit/archive validates SKU, category, price, version and reserved stock floor |
| BF-24 | Admin order management | Admin advances PAID->PROCESSING->SHIPPED with an audit trail; cannot fabricate payment |
| BF-25 | AI FAQ/policy support | Answers use approved evidence with citations; missing evidence safely escalates |
| BF-26 | Reconcile provider failures | Interrupted session creation/event processing recovers without double charge or stock release |

## Nonfunctional requirements

Security: HTTPS at deployed boundary, least-privilege DB credentials, strict input validation, parameterized queries, closed app objects, CSRF/Origin protection, rate limits, IDOR prevention, secret/log redaction and JWT algorithm/claim validation. External service failures must not create apparent payment success. Do not store card details.

Reliability: durable event inbox, idempotency records, transaction constraints, leased worker claims and bounded retries; database restart preserves pending work. Restore procedure must be tested before any production release. Worker backlog/oldest event age, stale reservations, payment mismatches, API failures and provider latency must be observable without personal data.

Performance targets are proposed engineering targets requiring measurement: on a documented local fixture of 10,000 products and 20 concurrent users, catalog p95 <500 ms and cart/order reads p95 <500 ms, excluding provider calls; no overselling under 20 concurrent attempts for the last unit. AI timeout 10 seconds and provider request timeout 15 seconds, with safe error UI. These are not customer SLAs.

Accessibility: keyboard-operable seven screens, programmatic form labels, focus management, readable error feedback, responsive 360px and desktop layouts. Do not display success only through color. Test strategy maps requirements to executable suites.

## Draft demo assumptions and decisions required

USD, US-form addresses, zero tax/shipping, card-only test Checkout, 30-minute reservation target, no guest cart, no discounts/refunds/returns workflow, no customer role editor, no category editor, no email notifications and no shipment carrier integration. They bound implementation; they do not approve commercial policies. Owner must decide supported geography, tax/shipping calculation, delivery estimates, cancellation/refund/return rules, support channel, legal identity/jurisdiction, data retention and AI provider processing terms. Until approved, all provided knowledge documents remain excluded from production retrieval.
