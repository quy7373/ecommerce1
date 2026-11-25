# Ordering guide

- Document ID: ordering-guide
- Version: 0.1-draft
- Status: DRAFT — REQUIRES OWNER APPROVAL
- Owner/approver: Unassigned store owner
- Approval date: None
- Retrieval eligibility: EXCLUDED until explicit approval and ingestion

This guide describes proposed test application behavior. It is not a commercial service promise. An approved version must be reviewed against the implemented screens and API before customers or the chatbot rely on it.

## Finding products

Use Home to search product names, descriptions or SKUs, narrow by category and price, show in-stock products, and choose a sort order. Prices are displayed in USD for the test implementation. Availability is an estimate: another shopper may reserve a unit before an order is submitted. Open Product Detail to review description, price and current availability.

## Signing in and maintaining a cart

Sign in with Google to maintain a cart. First verified sign-in creates a customer account; no store password is requested. Add a quantity from 1 to 99, update quantities in Cart, or remove a line. The proposed cart supports up to 50 different products. Adding to Cart does not reserve stock. After a concurrent cart change, refresh and review the current quantities before trying again.

Cart totals are recalculated by the server from current prices. A product price can change between adding to cart and creating an order. The checkout order records its own price snapshot. Do not rely on cached browser totals.

## Creating an order and paying

Review Cart, enter the required shipping fields in Checkout and submit the order. The demo accepts US-form addresses only; this does not establish approved shipping coverage. The backend validates the address shape, current products, prices and stock before creating a pending order and reserving inventory. Test totals currently use zero shipping and zero tax; commercial calculation is undecided.

The Pay action opens Stripe Checkout in test mode. Never enter a real card into development test workflows. On return, Account & Orders reads the stored payment result. A redirect or browser success message alone does not prove payment. If the order is still pending, refresh its details while reconciliation completes. Repeated network retries should recover the same order/session instead of creating a second payment.

## Changing your mind

Returning from Stripe without paying leaves the order pending. Use the explicit cancellation action for a pending order. Cancellation may remain pending while the payment provider is checked; a payment that completed first can prevent cancellation. The current test system does not provide cancellation or refund actions for paid orders. Commercial cancellation rights and the future support process require owner/legal review.

## Owner review checklist

Confirm supported geography/currency, shipping and tax totals, reservation messaging, purchase confirmation behavior, cancellation/help wording and a real support channel. Publish a new approved version only after these statements match the deployed implementation. No chatbot should use this draft to answer customer questions.
