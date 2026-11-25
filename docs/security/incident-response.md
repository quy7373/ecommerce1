# Incident response, audit and recovery

Task SEC-001. SEC-12/15 and threats T-07/08/13/15/16. This is the required runbook design. No on-call service, security contact, notification channel or production backup is claimed to exist. Assign named responders and test contacts before launch; do not put personal phone numbers/secrets in public docs.

## Roles and readiness

Owner appoints Incident Commander (decisions/timeline), technical responder (Backend/Integrator), evidence custodian (restricted artifacts), privacy/legal reviewer (applicability/notification), communications lead (verified customer/provider notices) and backup responders. Store their contact/on-call details in a restricted operational directory reachable during an application outage. Two-person review is required for break-glass admin/secret changes, payment overrides and release from containment. Preserve the user's approval requirement for merge/deployment; emergency authorization comes from an approved operator process, not this document.

Maintain tested kill switches for checkout creation, admin mutations and external AI independently; read-only catalog/account views may remain if safe. Keep trusted offline access to secret manager, backups, infrastructure inventory, processor contacts, known-good artifact digests and the incident record system. Conduct a tabletop before launch and every6months; rehearse restoration quarterly and key rotation before launch.

## Audit event design

Required events: login initiation/outcome and state/replay failures; session creation/revocation; role/assurance changes and admin authorization failures; object-authorization denial patterns; CSRF/Origin/rate-limit blocks; product/stock/status edits; Checkout creation/cancel/reconciliation; webhook verification failure and payment transitions/mismatches; knowledge approvals/revocations; key/permission/deployment changes; privacy requests/holds/purges; backup/restore/deletion replay and incident actions. Do not record every successful private read indiscriminately; log sensitive operator/export reads with purpose and audit access to the audit system itself.

Operational event envelope: `{eventId:UUID,eventType:string,occurredAt:Instant,requestId:UUID|null,actorId:UUID|null,resourceType:string|null,resourceId:UUID|null,outcome:"SUCCESS"|"DENIED"|"FAILURE"|"REVIEW",reasonCode:string|null,metadata:object}`. eventType is a server-maintained allowlist, not user text; reasonCode uses safe enumerated categories. Metadata allows only changed product field names/previous-new public values, status transition, provider event/session reference, corpus version, key ID, deployment digest, counts and timing. Limit event<=8KiB, metadata strings<=200characters and known keys only. User UUIDs/payment references are pseudonymous personal data, not public anonymous metrics.

Never log cookies, JWT/CSRF/state/code/verifier values, Authorization/Stripe-Signature headers, provider secrets, PAN/CVV, shipping addresses, raw query strings, chat content, full provider bodies or raw failed request payloads. Sanitize newline/control characters; use structured encoding, not concatenated log lines. Access logs/APM/crash handlers/browser console must follow the same rules. Derive rate-limit IP pseudonyms with a rotating keyed digest; restrict short-lived raw-IP security telemetry under [retention policy](data-protection.md).

Business audit and SecurityAuditOutbox rows are written in the same transaction as privileged/security-relevant state changes; do not rely on stdout. Export through a least-privilege collector within60s to an append-only restricted sink with immutable storage/retention and source integrity. Event IDs deduplicate retries. Runtime roles cannot update/delete business audit or delivered sink events; collector can update only delivery bookkeeping. A DB audit row alone is not tamper-proof against DBA compromise. Infrastructure/KMS/CI events use independently protected platform audit sources. Failed requests without business transactions still require durable security telemetry; if sink/outbox cannot persist, deny high-risk operations with503 and alert through an independent channel.

## Alerts and severity

| Signal | Initial threshold / required handling |
|---|---|
| Payment amount/session/mode mismatch or paid-after-release | Any event: high severity; stop affected fulfillment, page responder |
| Known active-key leak, unauthorized admin access, confirmed BOLA/PII exposure | Any confirmed signal: critical; disable affected capability/revoke credentials |
| Login/CSRF/BOLA abuse | >=10 failures per principal/IP pseudonym in5min or5x15min baseline with minimum20events; investigate without logging submitted identifiers |
| Payment worker lag | Oldest actionable event>2min or pending reconciliation>5min: page; unknown cases beyond24h require review, not auto-release |
| Audit/backup/rotation failures | Export lag>60s alert; loss>5min page. WAL recovery gap>15min or daily backup failure page; purge>24h overdue alert |
| AI budget/privacy |80% budget warning;100% inference stop. Any suspected private-data egress/forbidden access: disable AI, preserve minimal evidence |
| Clock drift/limiter/KMS errors | Drift>30s, limiter unavailable or decrypt/signing failure: alert and fail closed for dependent high-risk operations |

Thresholds are initial engineering values; tune using synthetic/load tests and documented review. Critical alerts must reach the responder within5min; acknowledgement target15min with escalation to backup responder at15min. Test routing monthly. These are operational targets, not legal breach deadlines or customer SLAs.

Severity: SEV-1 active compromise/card or personal-data exposure/forged payment; SEV-2 suspected limited compromise, security-control outage or stuck payment integrity; SEV-3 contained scan/attempt with effective controls. Commander records severity and evidence; uncertainty may justify escalating, never guessing that encryption made disclosure harmless.

## Response sequence

1. Detect/triage: open incident ID, record UTC times, affected artifact/environment/data categories and initial source; assess ongoing access, payment integrity and processor involvement. Preserve minimized immutable evidence/hash and access chain, not an unrestricted copy of production data.
2. Contain: isolate affected service/account/network path; disable expensive or dangerous feature, preserve signed Stripe ingress into a safe durable inbox when feasible. If ingestion cannot safely persist/verify, return503 so provider retries rather than falsely200. Freeze risky fulfillment and unresolved inventory releases. Revoke sessions/keys when indicated; take encrypted snapshots only with restricted evidence access.
3. Investigate: correlate request/event IDs, scoped audit trails, provider dashboard events and deployment/permission changes; determine time range, data access versus modification, affected identities and downstream processors. Do not execute untrusted payloads from logs. Keep incident notes factual and distinguish confirmed/suspected effects.
4. Eradicate: remove persistence, rotate compromised credentials with bounded overlap or immediate revocation, patch root cause, rebuild from reviewed source and known-good dependencies. A rollback alone may restore a vulnerable version or schema incompatibility; review migrations first.
5. Recover: restore into an isolated network; verify artifacts, keys and permissions, replay deletion tombstones and retention purges, reconcile Stripe/inventory/inbox/outbox/dedup IDs, run critical security tests, then obtain authorized staged reopening. Never replay external payment creation blindly from a DB backup.
6. Notify: privacy/legal reviewer determines applicable jurisdictions, contracts, reporting thresholds, recipients and deadlines at detection; record the rationale even when no notification is required. Use current authoritative law/processor agreements, not a universal assumed deadline. Send only approved accurate notices through verified channels; no personal data in public status updates. User authorization is needed for actual outbound communication unless an approved incident process already grants it.
7. Learn: initial review within2business days of containment, final action plan target10business days; record root cause, timeline, impact, control failures, detection gaps, owners/dates and tests preventing recurrence. Review residual risk/threat model and verify completion rather than just closing the ticket.

## Specific containment playbooks

| Incident | Immediate actions | Recovery verification |
|---|---|---|
| JWT signing/session compromise | Remove compromised kid, revoke impacted/all sessions, block admin, rotate key and investigate upstream identity access | Old JWTs fail; new sessions validate; live-role/MFA proof restored |
| Stripe key/webhook secret compromise | Disable new Checkout/fulfillment for affected scope; rotate correct endpoint/API keys; compare signed events with independently retrieved provider state | Amount/session uniqueness, no double effects, event replay with valid current signatures only |
| BOLA/DB credential leak | Deny affected endpoints/role; rotate DB credentials, contain data plane, preserve scoped audit and assess exposure | Two-user authorization matrix, negative grants, secrets absent from logs/build |
| AI injection/privacy leak | Switch AI off, revoke provider credential if needed, unpublish affected corpus/model version, contact approved processor through authorized responders | No private credentials/access path; corpus revocation, privacy and adversarial suite pass |
| Malicious build/dependency | Isolate runner/artifact, revoke CI/deployment credentials, identify all affected digests and rebuild trusted pipeline | Reviewed provenance/SBOM, new secret scan, clean image/runtime and critical regression tests |

## Backup and service restoration checklist

Target RPO<=15min using encrypted WAL capture and daily base backup; RTO<=4h to verified safe service. Store35days of encrypted immutable backups in an isolated account/bucket with separate restore identity and KMS permission. Do not put backup decryption capability in API/worker containers. Test integrity and actual decrypt/restore, not only successful upload status.

For each drill record latest restorable timestamp, recovery duration, missing/deleted-data treatment, independent deletion-ledger availability, key access, outstanding webhook/session reconstruction and stock balance proof. Compare provider transactions since backup time before resuming order/payment processing; Stripe deliveries may already have been acknowledged before data loss. Re-ingest/reconcile through deduplicated state transitions, preserve business unique references and never double-create sessions/refunds. Keep service closed if payment truth or erased-user replay cannot be established. RPO measures expected data loss, not permission to lose financial integrity silently.

Incident evidence retention follows a documented legal/investigation hold with30day reviews and restricted access. Release holds promptly when purpose ends; retain a minimal redacted decision record. Residual risks include delayed discovery, processor uncertainty, compromised privileged operators and backup/key loss; drills and separation of duties reduce their impact without eliminating it.
