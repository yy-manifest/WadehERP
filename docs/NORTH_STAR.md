# WadehERP North Star

## Promise
WadehERP is an e-commerce-first ERP (Shopify/Salla/etc.) with extreme simplicity:
the system handles complexity; the user sees direct actions and always-trustworthy numbers.

## Non-negotiables (Invariants)
1) No silent edits.
   - Any meaningful change must be auditable (who, what, when, why).
2) No unbalanced journal entries.
   - Accounting must never persist an unbalanced JE.
3) Every action reversible safely.
   - Reversals are explicit (credit note, void with audit, reversal entries), never destructive.
4) Tenant isolation by design.
   - Every tenant-scoped table includes tenant_id; every query is tenant-scoped.
5) Idempotent writes.
   - Any write endpoint that can be retried must accept an idempotency key.
6) Trust > convenience.
   - If the system is unsure, it must block and ask for input, not guess.

## Definition of Done (global)
- Tests cover acceptance criteria.
- Audit events exist for critical actions.
- Decision Log updated for trade-offs.
- Posting Rules updated for accounting automation.
