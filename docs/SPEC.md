# Touchstone v2 developer specification

The owner supplied [spec.md](../spec.md) on 30 October 2026 and explicitly selected it as the reference for
the ongoing audit and repairs. Read that document together with [CLAUDE.md](../CLAUDE.md), which
contains standing instructions, and the dated [decision records](decisions/).

The supplied document is an exported design specification dated 18 October 2026. Some older section numbers,
layout, and API examples differ from the implementation. Existing decisions explain intentional changes,
including the named directory layout, 1e36 price scale, referenceFeed naming, staged milestone interfaces,
and factory config registry. Do not silently replace those decisions with the older examples.

The owner separately approved payout isolation (0042) and authenticated executed-fee capture (0044).
The design's non-overshooting ITM rule is implemented as a conformance fix (0045). Research conformance and
pre-registration enforcement are recorded in 0046. No economic threshold or frozen E1/E2 result is retuned.

The root source is preserved rather than copied into a second document that could drift. Its historical
external claims, addresses, event deadlines, and statements that nothing is built are not current verified
facts. Use the audit report and measured validation evidence for implementation status. Exported equations
that are missing from the source are not reconstructed here.

The developer specification of 25 October 2026 ("Touchstone v2: Developer Specification for Claude Code"), the
source of CLAUDE.md §0 and of the M0 to M12 milestone plan in its §20.5, is kept verbatim in
[developer-spec-2026-10-25.md](developer-spec-2026-10-25.md) for reference. Where it and spec.md differ, the
decision records say which applies.
