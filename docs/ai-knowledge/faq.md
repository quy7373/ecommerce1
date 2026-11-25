# Frequently asked questions

- Document ID: faq
- Version: 0.1-draft
- Status: DRAFT — REQUIRES OWNER APPROVAL
- Owner/approver: Unassigned store owner
- Approval date: None
- Retrieval eligibility: EXCLUDED until explicit approval and ingestion

These are candidate answers for a future reviewed corpus. They describe proposed test behavior, not approved customer policies. Until approval, the assistant uses its deterministic no-evidence response rather than quoting this file. Approve each answer against the deployed implementation and final policies.

## How do I sign in?

Use Sign in with Google. A first successful verified sign-in creates a customer account. The prototype does not ask for a store password. Admin privileges are assigned by an operator, never through registration.

## Why did stock change after I added an item?

A cart does not reserve stock. Availability is checked again when an order is created, and other customers may reserve units in the meantime. Review the updated cart if checkout reports insufficient stock.

## Can I change quantities or remove an item?

Yes, in the proposed Cart screen. Quantity must be from 1 to 99, with up to 50 distinct products. Use Remove to delete a line. If another tab changes the cart, refresh and review it before submitting again.

## Why can the cart price differ from an earlier visit?

Cart totals reflect current catalog prices. Creating an order captures a server-calculated price snapshot. The test checkout currency is USD; zero shipping and tax are demo defaults, not approved offers.

## Does a successful return from Stripe prove payment?

No. Account & Orders displays the server-confirmed order state after Stripe information is verified. A return URL alone cannot prove payment. If it remains pending, refresh the same order instead of repeatedly placing replacement orders.

## What happens if I leave Stripe without paying?

The order remains pending until explicit cancellation or confirmed expiry. Returning through Stripe's cancel navigation does not itself cancel the order. Inventory is released only after the backend confirms an unpaid terminal outcome.

## Can I cancel a paid order?

The current API supports pending-order cancellation only. This is a feature limit and does not establish commercial cancellation or refund rights. Paid-order handling requires an approved policy and operator process.

## Where can I see my orders?

Account & Orders lists purchases for the signed-in account and provides item, address, total and status details. The chatbot has no private account access and cannot retrieve your order or tracking information.

## When will my order arrive, and what is the shipping cost?

There is no approved delivery estimate or shipping-fee policy. US-form address entry and zero demo shipping are test implementation choices. Do not infer supported delivery regions, carriers or guarantees from them.

## How many days do I have to return an item?

No return window is approved. A future published policy must specify eligibility and process consistent with applicable rights. The chatbot must not invent a deadline, return address or refund promise.

## What information should I send the chatbot?

Ask general product-ordering, FAQ or approved-policy questions. Do not send card numbers, security codes, passwords, tokens, personal addresses or order identifiers. The proposed assistant uses approved document excerpts and citations; it cannot change orders or make payment/refund decisions.

## What if the assistant has no approved answer?

The application response is: "I cannot confirm this from approved store information. Please contact store support." No contact address is invented; the owner must configure a verified support channel before launch. Draft policies, unsupported claims and model memory are not substitutes for approved evidence.

## Owner review and retrieval verification

Confirm every answer, replace provisional statements with approved policy references, identify an approver/effective date, and publish a versioned approved file. Test that only approved sections appear in citations, retired versions disappear, and draft-only retrieval still escalates.
