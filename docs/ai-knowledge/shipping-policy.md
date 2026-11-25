# Shipping policy

- Document ID: shipping-policy
- Version: 0.1-draft
- Status: DRAFT — REQUIRES OWNER APPROVAL
- Owner/approver: Unassigned store owner
- Approval date: None
- Retrieval eligibility: EXCLUDED until explicit approval and ingestion

No shipping regions, carriers, fees, dispatch times or delivery guarantees have been approved. This draft records what the test interface validates and which business decisions remain open. It must not be presented as binding shipping terms.

## Address collection in the test system

Checkout requires recipient name, first address line, city, region, US-form postal code and country US. A second address line and international-format phone number are optional. The postal validator accepts five digits or ZIP+4. This validates format only; it does not verify deliverability, residence, country eligibility or carrier coverage. US-form input is an engineering demo assumption.

The order stores a shipping-address snapshot for fulfillment review. The current API does not expose address editing after order creation. If an address is wrong, a still-pending order can be cancelled and a new one created after confirmed cancellation. Paid-order correction requires a future approved operator process; do not promise that it can be changed or that a package can be intercepted.

## Charges and timing

The test calculation sets shipping to zero solely to exercise checkout. No free-shipping offer, minimum spend, dispatch deadline or transit estimate is established. Tax and geographic treatment require separate owner decisions. Do not provide dates based on product availability alone.

## Fulfillment states

After verified payment, an admin may move the order from PAID to PROCESSING, then SHIPPED. SHIPPED is a manually entered state in this scope; there is no carrier integration, tracking number, delivery confirmation or delivery SLA. The chatbot must not fabricate tracking links or personal order status.

## Delivery exceptions and approval decisions

The owner must define supported destinations, address restrictions, carrier/service selection, fees and tax interactions, handling times, customs/duties, split shipments, loss/damage reporting and responsibility, and a verified contact process. Applicable rights need qualified review before publication. Until approval, support must say that it cannot confirm shipping policy from approved information.
