"""E11 accounting in deposit-currency base units, using the contract reference payout.

A budget belongs to one pool, currency and replay window. Strategy P&L consumes
actual wallet cash flows valued in one common quote unit at a common horizon.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from fractions import Fraction

from touchstone_ref import BPS, PIPS, rebate_payout, split_retained


@dataclass
class Budget:
    balance: int = 0
    funding: int = 0
    requested: int = 0
    paid: int = 0
    tips: int = 0

    def retain(self, deposit: int, retained: int, tip_bps: int, tip_cap: int, protocol_bps: int, rho_bps: int) -> None:
        if (
            not 0 <= retained <= deposit
            or tip_cap < 0
            or any(not 0 <= r <= BPS for r in (tip_bps, protocol_bps, rho_bps))
        ):
            raise ValueError("invalid retention inputs")
        added = split_retained(deposit, retained, tip_bps, tip_cap, protocol_bps, rho_bps).to_rebate_pool
        self.funding += added
        self.balance += added

    def benign(self, deposit: int, notional: int, fee_pips: int, kappa_bps: int, tip_bps: int, tip_cap: int) -> int:
        if (
            min(deposit, notional, tip_cap) < 0
            or not 0 <= fee_pips < PIPS
            or any(not 0 <= r <= BPS for r in (kappa_bps, tip_bps))
        ):
            raise ValueError("invalid benign inputs")
        self.requested += notional * fee_pips * kappa_bps // (PIPS * BPS)
        outcome = rebate_payout(deposit, notional, fee_pips, kappa_bps, self.balance, tip_bps, tip_cap)
        self.balance -= outcome.tip + outcome.rebate
        self.paid += outcome.rebate
        self.tips += outcome.tip
        return outcome.rebate

    @property
    def gross_coverage(self) -> Fraction | None:
        """Funded share of demand before the settler tip; disclose tips and net trader receipts separately."""
        return Fraction(self.paid + self.tips, self.requested) if self.requested else None


@dataclass(frozen=True)
class Position:
    owner: str
    lower: int
    upper: int
    liquidity: int


def active_shares(tick: int, positions: Iterable[Position]) -> dict[str, Fraction]:
    """Aggregate simultaneous positions by identified owner. Upper tick is exclusive."""
    active: dict[str, int] = {}
    for p in positions:
        if not p.owner or p.lower >= p.upper or p.liquidity < 0:
            raise ValueError("invalid position")
        if p.lower <= tick < p.upper and p.liquidity:
            active[p.owner] = active.get(p.owner, 0) + p.liquidity
    if not active:
        raise ValueError("in-range concentration undefined without active liquidity")
    total = sum(active.values())
    return {owner: Fraction(liquidity, total) for owner, liquidity in active.items()}


@dataclass(frozen=True)
class Leg:
    # Include fees and impact in executed markout. Subtracting fees again would double-count them.
    markout_after_fee: Fraction
    lp_fee: Fraction
    owned_share: Fraction
    retained: Fraction
    rebate_received: Fraction
    gas: Fraction

    def profit(self) -> Fraction:
        if not 0 <= self.owned_share <= 1 or min(self.lp_fee, self.retained, self.rebate_received, self.gas) < 0:
            raise ValueError("invalid strategy cash flows")
        return self.markout_after_fee + self.lp_fee * self.owned_share + self.rebate_received - self.retained - self.gas
