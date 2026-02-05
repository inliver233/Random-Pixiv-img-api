# Testing Policy

Purpose: consistent verification across projects while allowing framework-specific commands.

## Required per issue
- Set `Test_Method` in the Issue CSV (command or "manual").
- Set `Tools` (or "manual"/"none") in the Issue CSV.
- If `Test_Method` is manual, add a short checklist in `Notes` or `Acceptance`.

## Default test layers
- Unit: fast checks with mocks where appropriate.
- Integration: real dependencies or realistic stubs.
- E2E/UI: critical user flows.
- Regression: full suite or critical subset after batch completion.

## Minimum expectations by change type
- Backend logic: Unit + Integration.
- API changes: Integration + contract verification.
- Frontend UI changes: UI/E2E (or manual UI checklist if no automation).
- Data/schema changes: Migration test + rollback check.
- Performance-sensitive changes: targeted perf check or benchmark.

## When automation is missing
- Use `Test_Method = manual`.
- Include a repeatable checklist (steps + expected outcome).
- Add a risk note in the plan if coverage is incomplete.

## Regression policy
- After all issues in a batch are DONE, run a regression pass.
- Failures must be fixed before marking Regression_Status = DONE.
- For this repo, prefer `npm run test:all` (lint + tests + smoke).
- For proxy-related delivery, also run `pwsh test/proxy-smoke.ps1` against a live backend.
- One-shot regression helper (repo-specific): `pwsh test/run-regression.ps1`.

## Command format (examples)
- `pytest -q`
- `npm test`
- `npm run test:all`
- `npm run smoke`
- `pwsh test/proxy-smoke.ps1 -BaseUrl http://127.0.0.1:3000`
- `pwsh test/run-regression.ps1`
- `pnpm test:e2e`
- `go test ./...`
