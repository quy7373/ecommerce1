# Authentication and authorization

Task SEC-001. Implements SEC-01..03/06 and threats T-01..03/09. Normative extension of [API v1](../api/api-contract.md). AUTH-002 expands the original Google-only scope with [verified email registration/password login/recovery](../api/email-password-auth-contract.md) and [implementation controls](../implementation/auth-implementation-plan.md). Password-reset tests are now applicable. No refresh-token, automatic account-linking or impersonation endpoint is introduced. The new preauth routes use their specified anonymous CSRF protection; session-authenticated mutations retain existing Origin+session CSRF.

## Google OIDC flow

1. GET auth/google generates independent 32-byte cryptographic random state, nonce and browser binding. Generate a PKCE verifier per RFC7636 using a vetted library and S256 challenge. Persist only state/binding/nonce hashes plus authenticated-encrypted verifier in OAuthAttempt; expiresAt=now+5min. Set the transient binding cookie described below. Requested scopes are openid email profile only; no offline access or unrelated Google APIs.
2. Redirect only to the configured Google HTTPS authorization endpoint, with response_type=code and exact registered redirect URI. Client ID, issuer, token/JWKS endpoints and return destination come from deployment configuration. Never discover an endpoint from a token's jku/x5u, callback hd/error_uri or user-supplied URL. Use Google's maintained server verification library and bounded JWKS cache/refresh, with one refresh attempt for an unknown key ID.
3. Callback requires one valid state and code (or a provider error with valid state). Match hashed state and browser cookie in constant time; atomically consume the unexpired attempt once before code exchange. A failed exchange requires a new attempt; retries cannot reuse consumed state. Reject duplicate/unknown query fields per API contract. Never log callback query strings at proxy/APM level.
4. Exchange code server-side with exact redirect URI, client credentials and verifier over verified TLS. Validate ID-token signature with permitted Google algorithms/keys, expected issuer and audience, azp when required for multi-audience tokens, exp/iat with at most60s clock skew, nonce and nonempty sub, and email_verified=true. Reject absent required claims and malformed token structures. A Google access token or unverified decoded token is not an application session.
5. Identify by verified issuer+Google subject (single configured Google issuer, googleSubject unique in current model). Normalize verified email only for the existing collision check; no automatic merge on email. Enforce uniqueness transactionally. Assign CUSTOMER only. Create a new AuthSession and app JWT, clear transient cookie, redirect to fixed /account without tokens or codes in Location. Revoke any superseded browser session on reauthentication.

Reference: [Google OIDC validation](https://developers.google.com/identity/openid-connect/openid-connect). Provider claim semantics and library behavior must be verified in the sandbox; do not assume Google guarantees recent authentication or MFA from a normal token.

## Session controls

| Setting | Required behavior |
|---|---|
| App cookie | `__Host-session`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain; Max-Age<=900; JWT/session expiry aligned |
| OAuth cookie | `__Host-oauth`, Secure, HttpOnly, SameSite=Lax, Path=/, no Domain; Max-Age<=300; random browser binding only |
| Local development | Different unprefixed cookie names on loopback HTTP only, never set production-prefixed names without Secure; production startup rejects insecure configuration |
| JWT | ES256 with centrally managed signing key; verification allowlists only ES256, known kid, issuer and audience; sub/sid UUID, iat<=now+60s, exp>now and exp-iat<=900; no role/email/address in JWT |
| Authoritative check | AuthSession exists, sid/sub match, not revoked, expiresAt>now; current User exists/current role. DB/key lookup uncertainty denies request (503), not cached allow |
| Expiry | Absolute15min; no sliding extension/refresh in MVP. New login creates new sid; never fixate on supplied session ID |
| CSRF | GET auth/session rotates a 32-byte token and stored SHA-256 hash; mutations require token plus allowed Origin. Refetch after token conflict, including other-tab rotation; no localStorage/sessionStorage |
| Logout | Atomically revoke sid, expire same host/path cookie, clear private browser state; revoke-all is an operator incident procedure, not an undocumented public route |

JWT payload is signed, not encrypted; keep it minimal. Keys have bounded overlap: routine rotation every90days, active old verifier retained only until all old tokens expire plus60s skew; compromise removes its kid immediately and revokes impacted sessions. Unknown algorithm/kid or signature mismatch returns401. CSRF failures return403 without leaking token values. Logs contain only allowlisted session event metadata, never full tokens. Cookies sent to static paths due to Path=/ must be removed from static/access logs; no other app or untrusted code may share this host.

## MFA and recent authentication

Admin is a high-risk role. Before any real-user admin deployment, require phishing-resistant MFA through a verified IdP/access-broker policy and backend-trusted proof bound to the same Google subject and application session. The API must not trust a browser boolean/header, an unverified amr/acr claim, or a belief that Google users usually enable MFA. ingress must strip client assurance headers; proof must arrive over an authenticated private channel with signature/audience/expiry and replay protections or an equivalent server-validated session binding.

The concrete broker/proof integration is an OPEN release blocker; no new proof API/claim/database field is assumed implemented. If the chosen integration needs new app fields/routes, Backend must propose exact contract/model changes and tests before coding them. Until approved/proven, admin access is restricted to synthetic local tests. For the full ASVS L2 assessment, verify customer MFA availability/assurance against applicable authentication requirements too; federated login alone does not close that row.

Require app authentication <=5min old for admin product/order mutations, role assignment and privacy export/deletion operations; compare trusted AuthSession.createdAt rather than a client timestamp. Recent app login alone does not prove a recent Google factor challenge; the selected MFA broker must enforce the corresponding recent challenge. Current routes return403 FORBIDDEN with safe reauthentication guidance when required assurance is absent; do not silently downgrade. Role bootstrap/change is a restricted two-person operator process with audit and session revocation, not a client-editable field.

## RBAC and ownership matrix

| Resource/action | Visitor | CUSTOMER | ADMIN | Service boundary |
|---|---|---|---|---|
| Active catalog/categories | Read | Read | Read | Public read views only |
| Cart read/mutations | Deny401 | Own only | Own only | Actor from session; ignore/reject body owner IDs |
| Customer orders/detail/cancel/Checkout | Deny401 | Own only | Own only on customer routes | Foreign/nonexistent UUID =>same404; state checks inside write transaction |
| Admin products/orders | Deny401 | Deny403 | Allowlisted operations with MFA/recent auth | Live DB role; no manual paid/refund or role write API |
| Webhook inbox | Signature only | Signature only | Signature only | Stripe signature is sole authority; user/admin cookie grants nothing |
| Support public corpus | Minimized query | Same public corpus | Same public corpus | No account-aware retrieval or actions |
| Inventory settlement/release | Deny | Deny | No direct API override | Worker identity, state machine and unique effects |
| Privacy export/deletion | No public route | Verified manual request | No blanket unrestricted export | Privacy operator verifies ownership and purpose |

Implement customer queries using WHERE id=<validatedId> AND userId=<session.sub>, including list counts and writes. Verify each nested reference belongs to the authorized parent. Fetching an order first and checking role only in UI is insufficient. Lock state after authorization and recheck before write to prevent TOCTOU. Admin routes are separate allowlists, not a flag that bypasses every customer scoping rule. UUID entropy does not replace authorization.

Required tests: absent/expired/revoked/wrong-sub session, role revocation, replay/fixation, cross-tab CSRF rotation, every method with two customers/admin, nested-ID swapping, pagination counts, recent-auth/MFA failure, and concurrent ownership/state changes. AUTH-002 adds local password/reset/verification/mail/privacy/race tests; these cannot be marked N/A on the former Google-only rationale. Google-only account recovery remains a Google/approved operator boundary; local recovery cannot silently add a password to those accounts. Support chat never overrides identity or initiates password recovery.
