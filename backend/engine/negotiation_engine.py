"""
Negotiation opportunity engine for multifamily deal screening.

Reads merged deal payloads and surfaces negotiable items with estimated costs
and suggested price-reduction ranges. Opportunities are derived from OM-stated
CapEx line items and from the same debt math used by the risk rule engine
(no invented building conditions — only what the deal payload supports).
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from risk_rules import (
    DEFAULT_DEBT_RATE,
    DSCR_MEDIUM_THRESHOLD,
    calculate_annual_debt_service,
    calculate_dscr,
    get_loan_amount_usd,
    get_year1_noi,
    has_capex_budget,
)

DEFAULT_DEAL_PATH = Path(__file__).resolve().parents[1] / "data" / "current_deal.json"


@dataclass(frozen=True)
class NegotiationOpportunity:
    id: str
    item: str
    estimated_cost_usd: int
    suggested_price_reduction_low_usd: int
    suggested_price_reduction_high_usd: int
    confidence_pct: float
    rationale: str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_deal_payload(path: str | Path = DEFAULT_DEAL_PATH) -> dict[str, Any]:
    """Load a merged deal JSON payload."""
    deal_path = Path(path)
    if not deal_path.is_file():
        raise FileNotFoundError(f"Deal payload not found: {deal_path}")
    return json.loads(deal_path.read_text(encoding="utf-8"))


def _interior_renovation_opportunity(deal: dict[str, Any]) -> NegotiationOpportunity | None:
    """
    OM-stated interior renovation budget is a direct CapEx line item the buyer
    will fund post-close — it's reasonable to ask the seller to absorb most of it
    in price, since it reflects deferred unit condition, not buyer upside.
    """
    if not has_capex_budget(deal):
        return None

    capex = abs(
        float(
            deal.get("financial_projections", {})
            .get("capital_expenditures", {})
            .get("interior_renovation_budget_usd", 0)
        )
    )
    return NegotiationOpportunity(
        id="interior_renovation_budget",
        item="Interior renovation budget",
        estimated_cost_usd=round(capex),
        suggested_price_reduction_low_usd=round(capex * 0.70),
        suggested_price_reduction_high_usd=round(capex * 1.00),
        confidence_pct=95.0,
        rationale=(
            f"The OM discloses a ${capex:,.0f} interior renovation budget — capital the buyer "
            f"will fund post-close to bring units to pro-forma condition. Since this reflects "
            f"deferred unit condition rather than buyer-side upside, it's reasonable to ask the "
            f"seller to credit 70-100% of this budget at closing instead of the buyer absorbing "
            f"the full cost on top of the purchase price."
        ),
    )


def _dscr_shortfall_opportunity(
    deal: dict[str, Any], debt_rate: float = DEFAULT_DEBT_RATE
) -> NegotiationOpportunity | None:
    """
    If Year-1 DSCR is below the lender covenant threshold, compute the loan
    (and therefore price) reduction needed to restore coverage. This is a hard
    underwriting number, not a soft estimate, so confidence is high.
    """
    dscr = calculate_dscr(deal, debt_rate)
    if dscr >= DSCR_MEDIUM_THRESHOLD:
        return None

    noi = get_year1_noi(deal)
    loan_amount = get_loan_amount_usd(deal)
    current_debt_service = calculate_annual_debt_service(loan_amount, debt_rate)
    required_debt_service = noi / DSCR_MEDIUM_THRESHOLD
    debt_service_gap = current_debt_service - required_debt_service
    # Map the debt-service shortfall back to an equivalent loan/price reduction
    # at the same rate (interest-only): gap_in_debt_service / rate = gap_in_principal.
    price_reduction = debt_service_gap / debt_rate

    return NegotiationOpportunity(
        id="dscr_shortfall",
        item=f"Price reduction to restore {DSCR_MEDIUM_THRESHOLD:.2f}x DSCR covenant",
        estimated_cost_usd=round(debt_service_gap),
        suggested_price_reduction_low_usd=round(price_reduction * 0.85),
        suggested_price_reduction_high_usd=round(price_reduction * 1.05),
        confidence_pct=90.0,
        rationale=(
            f"Year-1 DSCR is {dscr:.2f}x against a {DSCR_MEDIUM_THRESHOLD:.2f}x lender covenant, "
            f"a ${debt_service_gap:,.0f} annual debt-service shortfall at the assumed "
            f"{debt_rate * 100:.2f}% rate. Reducing the purchase price (and therefore the loan "
            f"amount) by roughly ${price_reduction:,.0f} would right-size the debt service to "
            f"clear the covenant without changing in-place NOI assumptions."
        ),
    )


def estimate_negotiation_opportunities(
    deal: dict[str, Any], debt_rate: float = DEFAULT_DEBT_RATE
) -> list[NegotiationOpportunity]:
    """Derive negotiation levers from deal payload (OM CapEx + debt math)."""
    opportunities: list[NegotiationOpportunity] = []

    capex_opp = _interior_renovation_opportunity(deal)
    if capex_opp is not None:
        opportunities.append(capex_opp)

    dscr_opp = _dscr_shortfall_opportunity(deal, debt_rate)
    if dscr_opp is not None:
        opportunities.append(dscr_opp)

    return opportunities


def evaluate_negotiation_opportunities(deal: dict[str, Any]) -> list[dict[str, Any]]:
    """Evaluate all negotiation opportunities for a deal payload."""
    return [opp.to_dict() for opp in estimate_negotiation_opportunities(deal)]


def evaluate_negotiation_file(deal_path: str | Path = DEFAULT_DEAL_PATH) -> list[dict[str, Any]]:
    """Load current_deal.json and evaluate negotiation opportunities."""
    deal = load_deal_payload(deal_path)
    return evaluate_negotiation_opportunities(deal)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate deal payload for negotiation opportunities."
    )
    parser.add_argument(
        "--deal",
        type=Path,
        default=DEFAULT_DEAL_PATH,
        help=f"Path to deal JSON (default: {DEFAULT_DEAL_PATH})",
    )
    args = parser.parse_args()

    deal = load_deal_payload(args.deal)
    opportunities = evaluate_negotiation_opportunities(deal)
    output = {
        "opportunity_count": len(opportunities),
        "opportunities": opportunities,
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
