# Use cases

Task ARCH-001. All routes and DTOs refer to [API v1](../api/api-contract.md). Policy-dependent behavior is draft. Each use case includes acceptance evidence in [test strategy](../testing/test-strategy.md).

| Use case | Actor / precondition | Main flow and postcondition | Alternatives and failures | Functions |
|---|---|---|---|---|
| UC-01 Sign in/register | Visitor; Google account | Start Google login; backend verifies callback; create/find user by subject; issue JWT cookie; Account fetches session/CSRF | Denial, invalid nonce/state, unverified email or email conflict creates no session; provider failure offers retry | BF-01..03 |
| UC-02 Browse catalog | Visitor | Search and select category/price/in-stock filter; choose sort/page; render product details | Empty results distinct from errors; archived detail 404; invalid filters 400 | BF-05..09 |
| UC-03 Build cart | Customer; session and current cart version | Read cart; add/update/remove; render server totals and new version | Stock may change; version conflict refetches and asks user to review desired quantity; never silently overwrite another edit | BF-10..13 |
| UC-04 Place order | Customer; nonempty cart | Validate address; submit once with persistent key/version; transactional snapshot/reservation; save order ID | Empty/inactive/stale/insufficient cart rejected atomically; timeout retried with same key; client prices ignored | BF-14,15,18 |
| UC-05 Pay | Customer; owned pending order | Create/reuse Checkout; redirect to test Stripe; return to Account and poll actual order | Stripe back button is not cancellation; failed/unknown request uses same key; sold stock not deducted again on redirect | BF-16,20 |
| UC-06 Receive payment | Stripe; valid signature | Store inbox event; worker validates session and totals; settle PAID and consume reservation transactionally | Duplicate/reordered event no duplicate effect; storage failure 503; amount mismatch or late payment enters review | BF-17,20,26 |
| UC-07 Expire pending order | Worker; reservation due | Claim order; reconcile/create-known-session outcome; expire provider session if needed; confirm unpaid; mark EXPIRED and release | Paid session settles; provider outage retains reservation and retries; workers cannot both release | BF-19,26 |
| UC-08 Cancel pending order | Customer; owned pending order | Request cancellation; block new Checkout; confirm provider expired/unpaid; mark CANCELLED and release | Unknown outcome 202 with polling; payment wins 409 and PAID; paid/shipped cancellation unsupported | BF-19,22 |
| UC-09 View purchases | Customer | List own orders, inspect snapshots, refresh pending outcome | Other user's ID returns 404; expired auth 401; no data leaked | BF-21 |
| UC-10 Maintain catalog | Admin | Create/edit with current version; adjust physical stock; archive without deleting history | Duplicate SKU or stale edit 409; stock cannot fall below reserved; wrong role 403 | BF-04,23 |
| UC-11 Fulfill order | Admin; paid order | Read order; advance PROCESSING then SHIPPED with version; record audit | Wrong transition 409; manual paid/refund not exposed; stale state refetch | BF-24 |
| UC-12 Ask support | Visitor; no personal data needed | Submit question; redact; retrieve approved sections; generate and validate cited answer | Draft-only corpus means deterministic escalation; injection ignored; provider failure 503; no transcript saved | BF-25 |
| UC-13 Sign out | Customer/Admin | Submit CSRF-protected logout; revoke session and clear cookie; private UI clears memory | Retried expired session 401; UI still clears its cached private state | BF-03 |

## Recovery walkthrough

For a Checkout timeout after remote creation, neither UI nor API should generate a replacement order/session key. API/worker repeats the same provider request within its safe reconciliation window, records the original session, and returns it or cancels it when cancellation was requested. After provider key retention uncertainty (24 hours), do not blindly create again; place the order into operator review and retain stock until the outcome is proven. User sees a pending/review status and a generic support instruction.

For two users ordering the last unit, both may initially see one available. Serializable transactions and constrained stock updates permit one order; the loser receives 409 OUT_OF_STOCK after transaction retry. No partial order or partial reservation is committed.

For a policy question such as "How many days do I have to return this?", draft source text is not evidence. Support responds that it cannot confirm approved store information. It must not choose an industry-standard return window or invent a contact address.
