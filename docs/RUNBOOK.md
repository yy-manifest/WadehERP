# Runbook

## Work Packet: REQ-FOUNDATION-001 — M0.1 Foundation Slice

### Objective
Bootstrapped monorepo with CI + API baseline enabling safe ERP development.

### Acceptance Criteria
1) Repo boots:
   - pnpm i works
   - pnpm -r typecheck passes
   - pnpm -r test passes
2) API provides:
   - GET /health => 200 { ok: true }
   - POST /auth/signup creates a user + session
   - GET /me returns the signed-in user
3) Audit:
   - signup emits an AuditEvent record
4) Tenant safety:
   - Tenant model exists
   - User and AuditEvent are tenant-scoped (tenant_id)
5) Security baseline:
   - passwords hashed
   - cookies or tokens handled safely (documented in SECURITY_BASELINE)

### Definition of Done
- All acceptance criteria covered by tests
- CI green on PR
- docs updated: DOMAIN_GLOSSARY, SECURITY_BASELINE
