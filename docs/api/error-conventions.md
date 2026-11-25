# Error conventions

Task ARCH-001. Applies to all application JSON routes and error responses from OAuth/webhook middleware. Successful redirects and 204 responses have no JSON body.

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": [
      { "field": "shippingAddress.postalCode", "code": "FORMAT", "message": "Use a five-digit US postal code or ZIP+4." }
    ],
    "requestId": "7b53b62e-417b-4801-94cf-851b01c0b284"
  }
}
```

All four error properties are required. `code` is stable uppercase snake case, message is safe human-readable text (1..500 characters), details is an array max50 and is empty for nonvalidation errors; requestId is a server-generated UUID also returned as X-Request-Id. Do not trust arbitrary inbound request IDs. Detail objects contain exactly field/code/message; fields use dotted paths with numeric indices, `$` for whole body, `query.<name>`, `params.<name>`, or `headers.<name>`. Detail code is one of REQUIRED, TYPE, FORMAT, RANGE, UNKNOWN_FIELD, CONFLICT. Do not echo submitted values, SQL, tokens, stack traces, provider raw responses, addresses or existence of foreign orders.

| Status | Codes / meaning | Client action |
|---|---|---|
| 400 | VALIDATION_ERROR, OAUTH_INVALID, WEBHOOK_INVALID, WRONG_PAYMENT_MODE | Fix input; never retry malformed webhook as if paid |
| 401 | UNAUTHENTICATED, OAUTH_DENIED | Clear private UI state; sign in when appropriate |
| 403 | FORBIDDEN, CSRF_INVALID, ORIGIN_FORBIDDEN | Show access error; for session CSRF refetch session before intentional retry |
| 404 | NOT_FOUND | Show generic resource missing; foreign IDs indistinguishable |
| 405 | METHOD_NOT_ALLOWED; Allow header lists supported verbs | Fix client method |
| 409 | VERSION_CONFLICT, IDEMPOTENCY_CONFLICT, REQUEST_IN_PROGRESS, OUT_OF_STOCK, CART_LIMIT_EXCEEDED, TOTAL_LIMIT_EXCEEDED, CART_EMPTY, PRODUCT_UNAVAILABLE, ORDER_ALREADY_PENDING, ORDER_LIMIT_EXCEEDED, ORDER_NOT_PAYABLE, ORDER_NOT_CANCELLABLE, INVALID_ORDER_TRANSITION, SKU_CONFLICT, STOCK_RESERVED, CHECKOUT_EMPTY, ACCOUNT_LINK_REQUIRED | Refetch/review state; reuse key only for identical logical request |
| 413 | PAYLOAD_TOO_LARGE | Reduce request size |
| 415 | UNSUPPORTED_MEDIA_TYPE | Send required Content-Type |
| 429 | RATE_LIMITED; Retry-After integer seconds | Wait; preserve original idempotency key |
| 500 | INTERNAL_ERROR | Generic failure with request ID; log redacted diagnostics server-side |
| 503 | SERVICE_UNAVAILABLE, PAYMENT_PROVIDER_UNAVAILABLE, AI_UNAVAILABLE | Retry with backoff only where safe; never infer payment outcome |

Known paths with unsupported verbs return 405; unknown paths return 404. Malformed JSON returns 400 VALIDATION_ERROR with `$`/FORMAT detail. Missing idempotency key returns 400 with headers.Idempotency-Key detail. Shared API limits: auth initiation/callback 20/minute/IP; authenticated mutations 60/minute/user; catalog reads 120/minute/IP; support 10/minute/IP and user when authenticated. Return Retry-After on 429. Rate-limit login before provider work but do not apply ordinary consumer quotas to Stripe delivery; webhook ingress gets infrastructure abuse controls sized to provider retries. Distributed deployments require shared rate-limit state or gateway enforcement, not independent per-process counters.

Frontend renders message as text and branches on code, never string-matches English prose. Disable repeated submit while pending, preserve idempotency keys across network retries, and display field details accessibly. Backend centralizes normalization so parser, authorization, Prisma conflict and provider errors share the same format. Do not translate a transient DB error into an inventory conflict unless stock was actually rechecked.
