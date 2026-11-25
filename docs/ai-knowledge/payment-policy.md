# Payment policy

- Document ID: payment-policy
- Version: 0.1-draft
- Status: DRAFT — REQUIRES OWNER APPROVAL
- Owner/approver: Unassigned store owner
- Approval date: None
- Retrieval eligibility: EXCLUDED until explicit approval and ingestion

This is a proposed policy for a test application. It does not promise payment acceptance, refunds, settlement times or consumer-rights terms. The store owner must approve a customer-facing policy before commercial use.

## Test payment method

The implementation uses hosted Stripe Checkout with test-mode card payments. Test transactions do not establish a real purchase obligation. Card numbers and verification codes belong only in the hosted test payment form; the store API, chatbot and support messages must never request or retain them. Wallets, delayed payment methods, subscriptions, installments and cash payments are outside the proposed scope.

## Amount and currency

The test currency is USD. The server computes the amount from order item snapshots and displays subtotal, shipping, tax and total. Zero shipping and tax are demo defaults awaiting owner decisions, not statements about tax liability or free shipping. Customers cannot change amounts by editing browser requests.

## Payment confirmation

An order is paid only when the backend verifies Stripe payment information and matches it to the order's amount, currency and session. The browser return page is not payment evidence. Duplicate notifications do not create duplicate orders, stock deductions or charges. Pending confirmation may persist during provider/network interruption; customers should inspect the same order rather than repeatedly placing replacement orders.

## Failed, abandoned or uncertain payment

An abandoned payment leaves the order pending until explicit cancellation or confirmed expiration. The backend reconciles provider state before releasing reserved stock. A failed API call can have an unknown outcome, so the system reuses the same checkout request identity. Contradictory payment information is flagged for operator review and must not automatically trigger fulfillment.

## Refunds and disputes

There is no automated paid-order cancellation/refund workflow in this release. Do not infer a no-refund rule from this technical limitation. Refund eligibility, partial refunds, processing timelines, dispute handling and contact details are undecided. Any required manual test action is handled by an authorized operator in Stripe's test dashboard with an audit record; it creates no commercial policy.

## Decisions needed for approval

Approve currencies, payment methods, pricing/tax presentation, pending-payment communication, refund/dispute process, legal requirements, and an operational support channel. Do not publish invented deadlines, guarantees, fees or refund rights. Implementation reference: [system architecture](../architecture/system-architecture.md).
