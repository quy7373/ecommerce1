# Allocation view

Task ARCH-001. This file specifies responsibilities; it does not authorize changes to other agents' directories or root configuration.

SEC-001 priority handoff: Backend and Frontend must acknowledge the [security requirements and ownership table](../security/security-requirements.md) before integration. Current acknowledgement status is pending because no identifiable active Backend/Frontend tasks were discoverable. Production host-cookie Path=/, admin MFA/recent-auth gates, encrypted storage/audit outbox, fixed provider expiry, shared limits and support isolation supersede the initial deployment defaults. No implementation acknowledgement or completed security control is implied.

| Owner | Owned artifacts | Implementation responsibilities |
|---|---|---|
| Agent 1 Architect | docs/ | Requirements, contracts, data model, security and test design; review cross-layer consistency |
| Agent 2 Backend | backend/ | Express modules, Prisma schema/migrations/seeds, worker, Google/Stripe/AI adapters, Jest/Supertest tests, backend Dockerfile |
| Agent 3 Frontend | frontend/ | React/Vite/Tailwind screens, typed API client, session/CSRF handling, UI tests, Playwright tests, frontend Dockerfile |
| Project owner/integrator | Root configuration and release process | Compose wiring, CI, secrets provisioning, dependency/version alignment, policy decisions, admin bootstrap; approve merge/deploy |

Root Compose files are required for the project but remain outside the architect's ownership. No branch, worktree, commit, merge, deployment or root edit is performed by this documentation task.

## Runtime allocation

| Process/service | Inputs | Connections and persistence | Failure behavior |
|---|---|---|---|
| frontend | API proxy target; public Google login URL only | Browser HTTP; internal API proxy, no secrets | Accessible error/loading states and retry |
| api | DB URL, JWT signing key/issuer/audience, allowed origins, OAuth client/secret/redirect URI, Stripe test key/webhook secret, fixed frontend URL, AI opt-in settings | PostgreSQL + Google + Stripe + optional approved AI | Bounded timeouts; safe 503; no local-memory business state |
| worker | DB URL, Stripe test key, reconciliation intervals | Same PostgreSQL schema and Stripe; no public port | Leased claims, retries, stalled-job alerts |
| support | Approved corpus read identity/mount, opt-in AI key and private service identity | No commerce/auth DB grants, KMS decrypt or Stripe secrets; provider-only egress | Safe escalation/503, hard quota/spend cap, no prompt/transcript logs |
| audit collector | Narrow outbox read/delivery-bookkeeping and append-only sink credentials | Immutable restricted sink; no admin/payment mutations | Durable retry/dedup, <=60s export target and independent alerts |
| migrate | DB URL | Runs checked-in Prisma migrations once | Blocks API/worker startup on failure |
| postgres | Restricted app credentials and volume | Internal network; persistent volume | Readiness fails; API does not acknowledge unstored events |

Configuration names are proposed integration labels, not existing environment variables. Backend and integrator must agree exact environment names and pin compatible package/database/provider API versions. Secret values belong in ignored local environment files or a secret manager; examples must contain dummy values only. AI opt-in defaults false.

Production security additionally requires TLS ingress/internal transport, per-service roles, managed secrets/KMS, encrypted PostgreSQL/WAL/backups, shared limits, immutable audit sink and isolated restore/deletion ledger. Runtime container requirements: non-root, read-only filesystem except bounded temp mounts, dropped capabilities, no Docker socket/privileged mode, resource limits and reviewed image digests. Migration identity is one-shot and not available to other containers. Root Compose/CI changes remain integrator-owned; architect edits documentation only.

## Seven screen allocations

| Screen and proposed browser route | API dependencies | Required UI behavior |
|---|---|---|
| Home `/` | products, categories, auth/session | Search/filter/sort reflected in URL; pagination; login; distinguish no results from failure |
| Product Detail `/products/:id` | products/:id, cart/items | Availability estimate, quantity bounds, sign-in prompt, stock-conflict recovery |
| Cart `/cart` | cart routes | Totals, quantity/remove, version conflict refetch, inactive/unavailable notices |
| Checkout `/checkout` | orders, checkout/sessions, order detail/cancel | Address validation; preserve idempotency keys across retries; Stripe redirect; explicit cancellation action separate from Stripe back navigation |
| Account & Orders `/account` | auth/session/logout, orders list/detail/cancel | Order list/detail panels; status polling after Stripe return, pause polling when settled or after 60 seconds and show manual refresh; never infer payment from query string |
| Admin Dashboard `/admin` | admin/products, admin/orders, categories | Product and order panels, role-gated navigation, server-enforced permissions, stale version recovery |
| AI Support `/support` | support/messages | Privacy notice, approved citations, safe escalation, no transcript persistence |

These are seven screens; panels/modal detail views avoid an eighth route requirement. Browser redirects to Google/Stripe are external screens. Screen authorization is for usability; API authorization remains authoritative. Provide keyboard access, semantic labels, focus/error summaries and responsive layouts.

## Integration handoff

Implement in order: schema/constraints and auth, catalog/cart, order reservation, Checkout/inbox/worker, admin, support, E2E. Frontend may mock only this contract while services are unavailable. Backend must expose no new field or endpoint without updating docs and notifying frontend. Integration must verify cookie proxy behavior, raw webhook middleware order, database migrations and concurrent worker safety before connecting real test provider accounts.
