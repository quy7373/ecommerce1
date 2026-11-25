# Security requirements and critical acceptance criteria

Task SEC-001. Normative design requirements, dated 2026-11-23. These controls extend ARCH-001 and take precedence over weaker earlier security defaults. They are requirements to implement, not controls verified in this repository. Business/privacy policy periods remain proposed pending owner review. All changes stay within docs/.

## Target and applicability

Target: applicable OWASP ASVS 5.0.0 Level 1 and Level 2 requirements. OWASP Top 10:2025 is a risk-awareness cross-check, not a substitute for verification. No ASVS certification or complete conformance is claimed. Before real-user release, import the official versioned requirement set, record applicability/evidence for every L1/L2 row, and justify each N/A with architecture evidence; do not declare whole chapters N/A because this summary omits them. References: [ASVS stable release](https://asvs.owasp.org/), [official 5.0.0 requirement dataset](https://raw.githubusercontent.com/OWASP/ASVS/v5.0.0/5.0/docs_en/OWASP_Application_Security_Verification_Standard_5.0.0_en.csv), [Top 10:2025](https://top10.owasp.org/2025/0x00_2025-Introduction/).

## Critical acceptance criteria — release blocking

| ID | Measurable requirement / acceptance | Owner and required evidence |
|---|---|---|
| SEC-01 | Reject invalid issuer/audience/signature/expiry/nonce, absent/unverified subject/email and invalid/replayed/expired/browser-mismatched state; each attempt creates at most one session; state/nonce/binding each >=256 random bits, PKCE S256 | Backend; AUTH-SEC negative tests and provider sandbox smoke |
| SEC-02 | Production JWT cookie __Host-session: Secure, HttpOnly, SameSite=Lax, Path=/, no Domain, <=15min lifetime; pin algorithm/key/issuer/audience, reject future iat beyond 60s skew; revocation/role removal effective on next request; reject admin mutations without authentication <=5min old and proven MFA assurance | Backend + Frontend + Integrator; SESSION-SEC and verified MFA deployment design. Unproven Google MFA signals block production admin use |
| SEC-03 | Deny by default; every customer object query scoped to authenticated actor; foreign and nonexistent objects both 404; admin actions use live role and audit; no client userId/role assignment | Backend; endpoint/method/role/ownership matrix tests including nested IDs and races |
| SEC-04 | All app bodies/queries/paths validated against closed v1 schemas, bounded numbers and sizes; no raw interpolated SQL/eval/shell templates; server-derived totals/statuses only | Backend + Frontend; forged input, mass assignment, parser and injection tests |
| SEC-05 | TLS1.2 minimum/TLS1.3 preferred at public and non-loopback internal hops, certificate verification; exact CORS allowlist; enforcing CSP, HSTS and headers; proxy metadata trusted only from configured ingress | Integrator + Backend + Frontend; TLS/header/CORS/forwarded-header tests |
| SEC-06 | Every cookie-auth mutation validates Origin plus constant-time session-bound CSRF token; no GET business mutation; OAuth state and signed webhook are explicit alternate protections; all untrusted text rendered as text | Backend + Frontend; CSRF/XSS browser tests, including catalog and AI output |
| SEC-07 | Shared limits work across two API replicas and cannot be bypassed with forwarded IP headers; API/provider/DB timeouts, pagination and body limits enforced; AI and checkout have cost/abuse budgets | Backend + Integrator; ABUSE-SEC concurrency/time-budget evidence |
| SEC-08 | No PAN/CVV application capture/storage/logs; verify raw Stripe signatures with 300s tolerance and synchronized clocks; reject live events in test mode; durable inbox before 200, amount/session/order/mode checks before settlement | Backend; PAY-SEC signed events, secret scan and log/DB/browser inspection |
| SEC-09 | Duplicate/reordered events and 20 simultaneous last-unit orders cannot double-settle/oversell; ambiguous provider outcomes retain reservations and reconcile; max3 active pending orders/user, max1 pending per cart version | Backend; real-PostgreSQL race/crash tests and reconciliation alert drill |
| SEC-10 | Encrypted sensitive fields, DB/WAL/backup volumes, KMS-separated keys, TLS DB connection and per-service least privilege; compromised reader cannot decrypt field ciphertext; rotate signing/data/provider credentials through a tested runbook | Backend + Integrator; field ciphertext/privilege tests, rotation and restore evidence |
| SEC-11 | AI disabled until processor/privacy approval; runtime cannot read customer/order/payment/session data or call action tools; only approved versioned public chunks; unsafe/no-evidence output escalates; no chat transcript/prompt tracing | Backend + Frontend + Owner; LLM/KNOWLEDGE-SEC, network/credential negative tests and provider settings |
| SEC-12 | Allowlisted audit events durably recorded for admin, identity/security and payments; no tokens/addresses/messages; tamper-resistant restricted export within60s; critical alert delivered within5min in drill | Backend + Integrator; AUDIT-SEC and on-call acknowledgement test |
| SEC-13 | Published data inventory/purpose, jurisdiction decision, retention/purge/hold rules, verified access/deletion workflow and processor agreements; restore cannot resurrect deleted accounts; no real customer data in development | Owner/privacy reviewer + Backend + Integrator; PRIVACY-SEC tests and signed release checklist |
| SEC-14 | SAST, secret scanning, dependency/image/IaC scans, SBOM, security integration/E2E and authenticated DAST run on release candidate; no unresolved exploitable high/critical issue or untriaged high/critical scanner finding; no production auth bypass/debug/test adapter | All owners; attributable CI reports and manual review |
| SEC-15 | Tested encrypted backups with RPO<=15min and RTO<=4h engineering targets, incident roles/runbooks, isolated restore exercise at least quarterly and before launch | Integrator + Owner; timed DR-SEC/IR exercise with reconciliation and deletion replay |

All fifteen are mandatory gates for real-user Internet deployment. Local synthetic-data development can proceed with documented loopback-only TLS/cookie exceptions, AI off and test providers; it is not a security acceptance. Retest material changes. Owner approval for merge/deploy remains required independently of passing gates.

## ASVS and Top 10 alignment

This is a chapter-level design map, NOT a complete ASVS assessment or an invented per-control equivalence. Use version-prefixed IDs in the later evidence ledger. Only a few verified anchors are listed to orient implementation.

| Design controls | ASVS 5.0.0 areas | Top 10:2025 coverage |
|---|---|---|
| SEC-01..03 | Authentication, Session Management, Authorization, Self-contained Tokens, OAuth/OIDC | A01 Broken Access Control; A07 Authentication Failures |
| SEC-04/06/09 | Encoding and Sanitization; Validation and Business Logic; Web Frontend Security; API and Web Service | A05 Injection; A06 Insecure Design; A08 Software or Data Integrity Failures |
| SEC-05/10 | Cryptography; Secure Communication; Configuration; Data Protection | A02 Security Misconfiguration; A04 Cryptographic Failures |
| SEC-07/08/11 | Business limits; APIs; secure design/validation; privacy boundaries | A06 Insecure Design; A08 Software or Data Integrity Failures; A10 Mishandling of Exceptional Conditions |
| SEC-12/15 | Security Logging and Error Handling; Configuration; Secure Coding and Architecture | A09 Security Logging & Alerting Failures; A10 Mishandling of Exceptional Conditions |
| SEC-13/14 | Data Protection; Configuration; Secure Coding and Architecture | A03 Software Supply Chain Failures; A04 Cryptographic Failures; A09 Security Logging & Alerting Failures |

Verified anchor IDs: v5.0.0-1.2.4 (parameterized database queries), v5.0.0-2.3.3 (atomic business transactions), v5.0.0-2.3.4 (limited-resource locking), v5.0.0-3.3.3 (host-prefixed cookies), v5.0.0-3.4.1 (HSTS). These anchors are paraphrased orientation; assess the official dataset rather than relying on this list. File handling requirements need explicit N/A reasoning because uploads are excluded; browser image URLs and knowledge ingestion still require review.

## Coordination and open implementation work

| Recipient | Required handoff | Completion evidence |
|---|---|---|
| Agent 2 Backend | Implement SEC-01..04,06..13; reconcile DTO/model changes listed in auth/data/API docs; supply authorization matrix, encryption/deletion migration design, MFA proof design and security tests | Acknowledge control IDs and contract deltas in this table; link implementation/test evidence when available |
| Agent 3 Frontend | Implement SEC-02,04..06,11,13,14; host-cookie/CSRF flow, safe text rendering/CSP, no token or transcript storage, privacy UI and error recovery | Acknowledge control IDs and seven-screen tests; link CI/browser evidence |
| Integrator/Owner | TLS/secret manager/support isolation, shared limits, secure images/CI, audit sink/alerts/backups; appoint incident/privacy owners and determine applicable law | Deployment evidence, approvals and dated risk assessment |

Coordination status at authoring: active-task discovery exposed no identifiable Backend or Frontend task, and neither owned directory existed. No message was sent to an unrelated task; no agent acknowledgement is claimed. This shared versioned documentation is the available handoff. Backend/Frontend acknowledgement and conflict review remain integration gates, not a reason to leave architecture work unfinished. No new agent/task/branch/worktree was created.

Open production blockers: MFA assurance mechanism; encrypted-storage/deletion implementation; support runtime isolation; actual ASVS row-by-row assessment; legal applicability/retention approval; assigned on-call/privacy contacts; deployment/test evidence. These are tracked gaps, not assertions that any control is already implemented.
