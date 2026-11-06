# Dead code: M0-M5 repair audit

Date: 30 October 2026. Baseline: 07f4bbe.

## Before changes

Severity: Low. Location: `backend/keeper/src/schedule.ts:Action; contracts/src/Settler.sol:_settleTime`.

The stale scheduling branch treats a publish-time bound as a submission cutoff. Calendar settlement remains unreachable because factory deliberately rejects calendar pools (0029); that is staged behavior, not an implemented market calendar.

Scope: first-party contracts, backend, research, tests and docs; dependency code inspected where integration semantics matter. Recorded research results are historical backtests, not independently reproduced outcomes.

## After changes

Removed the obsolete hook pushOut API and its fixture/test declaration after approved payout isolation. Removed the incorrect stale scheduling branch. Regenerated shared ABIs. Deliberately disabled calendar/licence branches remain documented, not silently removed.

Final command evidence and limitations: [validation.md](validation.md). Findings still open are not accepted trade-offs merely because they are documented.
