# Test strategy

Task ARCH-001. This is the implementation verification plan; no application exists in the inspected repository, so application tests cannot yet be executed. Architect validation covers delivered documentation completeness, local links, required sections and contract/model consistency. Backend owns Jest unit and Jest+Supertest integration tests; frontend owns UI checks and Playwright E2E. Root CI/Compose integration belongs to the integrator.

SEC-001 adds the mandatory [security testing plan](../security/security-testing-plan.md) and [release-blocking control set](../security/security-requirements.md). Functional passes alone do not authorize release. Include authentication/MFA, cross-user BOLA, cryptography/least-privilege, browser/header, payment-race, LLM isolation, audit, privacy deletion/restore and supply-chain suites in owner evidence. Production assurance and deployment controls remain unverified.

AUTH-002 adds [verified registration/login/password recovery acceptance tests](../implementation/auth-implementation-plan.md) and its [API contract](../api/email-password-auth-contract.md). At this later inspection backend/frontend and package scripts existed, including an in-memory integration fixture and mocked Playwright tests. Future auth implementation must add real-PostgreSQL transactional race tests and a fake-mail end-to-end journey; prior absence-of-code notes are historical and do not claim current suites have been run.

## Layers and fixtures

Jest unit tests cover pure money arithmetic/overflow, input schemas, state transitions, token claim checks, retrieval eligibility and citation validation. Avoid mocking the implementation under test. Jest+Supertest exercises the actual Express app and middleware with a disposable migrated PostgreSQL database; never substitute SQLite for locking/constraint tests. Stub external Google/Stripe/AI adapters deterministically, and verify adapter inputs and retry keys. Provider sandbox smoke checks are separate opt-in jobs using test accounts/secrets.

Seed two customers, an admin, two categories, active/inactive/out-of-stock products, one final-unit product, and pending/paid/shipped/review orders. Use deterministic clocks and IDs where necessary. Integration workers use separate database connections for real concurrency tests. Each suite gets an isolated database/schema and cleans it safely; E2E uses an isolated Compose project/volume. No production data or live-mode Stripe credentials in tests.

## Traceable scenarios

| Test IDs | Layer | Required scenarios / assertions | Requirements |
|---|---|---|---|
| AUTH-01..08 | Unit/integration | Google valid flow, first registration race, invalid issuer/audience/signature/expiry/nonce, invalid/replayed/expired state, email collision, provider denial, revoked/expired JWT, CSRF/Origin failures | BF-01..04 |
| CAT-01..06 | Integration | Literal search including SQL metacharacters, category/price boundaries, min>max, deterministic sort ties, empty/out-of-range pages, archived detail 404 | BF-05..09 |
| CART-01..07 | Unit/integration | Add aggregation, 99-unit/50-line limits, replace/remove, zero quantity rejection, exact totals/overflow, stale concurrent updates, cart does not reserve | BF-10..13 |
| ORDER-01..07 | Integration | Invalid shipping, empty/inactive cart, snapshots survive product changes, same-key exact replay, changed-body conflict, same-version pending uniqueness, transaction rollback mid-reservation | BF-14,15,18 |
| STOCK-01..05 | Integration | 20 concurrent last-unit orders produce one success; reserved never negative/exceeds onHand; admin stock-floor conflict; archive preserves committed reservation; serializable retries bounded | BF-09,18,23 |
| PAY-01..10 | Integration | Stable Stripe creation key, unauthorized/foreign order, raw-body signature checks, live-mode rejection, amount/currency/order mismatch review, duplicate event ID, different paid events for same session, failure after success, paid redirect alone has no effect, inbox outage 503 | BF-16,17,20 |
| REC-01..08 | Integration | Crash after remote create before DB save; two workers claim same event; crash during settlement rolls back; create versus cancellation race; expiry versus paid race; unknown provider outcome holds stock; repeated release no-op; >24h unknown-create outcome escalates without new session | BF-19,22,26 |
| HIST-01..03 | Integration/E2E | Own list/detail pagination, cross-customer 404, immutable order address and prices | BF-21 |
| ADM-01..06 | Integration/E2E | Customer 403, SKU collision, invalid category, stale version, archive vs hard deletion, only allowed status transitions with atomic audit | BF-04,23,24 |
| AI-01..08 | Unit/integration | Draft exclusion, no-evidence exact escalation, approved citations, invalid citations/output fallback, prompt injection in source/user text, redaction, no transcript persistence, provider timeout 503 | BF-25 |

## Playwright journeys

1. Visitor filters/searches/paginates and views a product; keyboard and mobile layout checks.
2. Customer logs in through a nonproduction test identity adapter, adds/updates/removes cart items, reloads persisted state, validates address and creates an order. Test auth adapters are unavailable when production mode is set; never add an unrestricted impersonation endpoint.
3. Customer creates Checkout against a deterministic provider adapter; signed test webhook settles the order; return screen reads actual PAID state. Separate manual/opt-in sandbox smoke verifies real Google and hosted Stripe Checkout because external UI and challenge flows are unreliable CI dependencies.
4. Duplicate submission uses same key; stock conflict and stale cart recover visibly; Stripe cancellation navigation leaves order pending until explicit cancellation or confirmed expiry.
5. Order history/detail ownership; pending cancellation success; paid cancellation rejected.
6. Admin edits product stock, archives product, advances paid order to shipped; customer cannot access admin API.
7. Support with draft-only corpus escalates; a separately approved test fixture produces cited answers, injection cannot expose credentials or trigger actions.

Run Chromium on every integration build; Firefox/WebKit for release compatibility. Check labels, focus, announcements and no client errors. Collect redacted traces/screenshots on failure only; do not capture payment or personal fields in shared reports.

## Execution and gates

Backend should define scripts for Jest unit/integration suites; frontend should define scripts for UI and Playwright suites. Exact commands depend on owner-created package scripts and are not asserted to exist now. CI sequence: dependency install from lockfiles, static/type checks, unit tests, migrations into disposable PostgreSQL, integration/concurrency tests, Compose readiness, Playwright journeys, artifact cleanup. Pin the same PostgreSQL major version in CI and Compose. Test provider adapters exercise failure injection; sandbox smoke validates real SDK assumptions including raw-body signature handling.

Acceptance: all listed critical scenarios pass, no secrets in artifacts, no unreviewed contract/model drift, migration rollback/restore rehearsal recorded, and zero known critical payment/auth/overselling defects. Report test command, commit, fixture, duration, pass/fail and skipped tests. A high coverage percentage cannot replace the named race/security scenarios. Load-test the proposed p95 targets using the fixture in requirements and record hardware and provider exclusion.

## Architect delivery verification

Validate exactly the sixteen requested Markdown files, nonempty substantive content, all local Markdown links resolving, balanced fenced blocks, required Mermaid diagram types and coverage of BF-01..26/API groups 1..10/seven screens. Manually cross-check DTO fields against the dictionary and terminal-state transitions against stock/payment tests. Record actual results in the completion report; do not report this strategy as executed application tests.

Delivery check on 2026-11-23: a Node-based documentation validation passed 108 assertions covering all sixteen requested files, substantive size, local links, balanced fences, all six draft/retrieval approval markers, 26 function IDs, ten API groups, seven screen allocations and four Mermaid diagram types. Mermaid source was inspected but no graphical renderer was available in the repository. Application Jest/Supertest/Playwright suites were not run because no application or test runner existed. Git status showed only the new docs directory; no commit was created.
