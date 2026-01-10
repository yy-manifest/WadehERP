# Security Baseline (M0.1)

This document defines the minimum security/integrity rules for WadehERP.
Agents MUST follow this. If a rule needs to change, it must be recorded as a Decision.

## Authentication & Sessions
- Passwords:
  - Stored as hashes only (bcrypt).
  - Minimum password length enforced at API validation.
- Sessions:
  - Client receives a session token once at signup.
  - Server stores only a hash of that token (sha256).
  - Sessions have expiry (expiresAt) and can be revoked (revokedAt).
  - Auth is Bearer token: `Authorization: Bearer <token>`.

## Tenant Isolation
- Tenant isolation is mandatory:
  - Tenant-scoped tables include `tenantId`.
  - Any read of user data must include `tenantId` in the where clause.
- Session determines tenant context:
  - Request tenantId MUST come from validated session, not client input.

## Audit Trail (Non-negotiable)
- AuditEvents are append-only:
  - No updates/deletes allowed (enforced via Prisma middleware).
- Audit must include:
  - tenantId, actorUserId (if present), action, entityType/entityId where applicable
  - ip and userAgent when available

## Error Handling
- Validation errors return 400 with structured issues.
- Internal errors never leak stack traces to the client.

## CORS & Headers
- Helmet enabled (secure headers baseline).
- CORS origin is controlled via env (tighten later).

## Roadmap (not in M0.1)
- Rate limiting
- CSRF strategy (if cookies are introduced)
- Idempotency keys for all write endpoints
- Secrets management for production

## Audit Immutability Enforcement
- AuditEvent is enforced append-only at the database level:
  - UPDATE and DELETE are blocked via Postgres triggers.
