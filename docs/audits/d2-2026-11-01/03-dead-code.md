# D2: dead-code

Pre-change assessment, 1 November 2026.

Retain existing RPC state reads; indexed history replaces history reads only when explicitly configured.

Validation and resolution are recorded in `validation.md` at the end of this change. This scoped pass does not certify unfinished D2 milestones.

## Post-change resolution

The RPC event fallback remains reachable only when indexed history is not configured. The new CLI paths are real guarded implementations; later experiments remain absent and gated.

Severity, affected files, root causes and measured verification are in [validation.md](validation.md). This is a scoped D2 pass, not an external audit or closure of the entire milestone sequence.
