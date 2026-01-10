# AGENTS.md — How to work in this repo

## Golden rule
Agents do not invent product truth.
If it's not in docs/ or a Requirement, propose it as a new Requirement/Decision/Risk.

## Repo commands (must stay valid)
- Install: pnpm i
- Dev API: pnpm --filter api dev
- Dev Web: pnpm --filter web dev
- Typecheck: pnpm -r typecheck
- Tests: pnpm -r test
- Build: pnpm -r build

## Non-negotiables (from docs/NORTH_STAR.md)
- No silent edits
- No unbalanced journals
- Everything reversible
- tenant_id everywhere
- idempotent writes

## PR rules (required)
Every PR description must include:
1) What changed (summary)
2) Assumptions
3) Tests added/updated + commands run
4) DB/schema changes (yes/no)
5) Posting rules touched (yes/no)
6) Risks + mitigations

## Work packet protocol
No feature work starts without a Work Packet:
- Requirement ID + acceptance criteria
- Domain rules
- Posting rules (if money/stock)
- Definition of Done

## Code style conventions
- Prefer small modules.
- Domain logic in packages/domain (pure functions, no IO).
- Backend is an IO shell around domain.
- Security defaults locked down; loosen explicitly with Decision Log.

## Safety
Agents must not:
- disable auth checks “temporarily”
- write raw SQL without review
- change migrations without explaining impact
- bypass tenant scoping
