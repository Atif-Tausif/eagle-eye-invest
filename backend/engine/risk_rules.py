"""
Deterministic risk rules for multifamily deal screening.

Evaluates merged deal payloads (OM + market context) against fixed thresholds
for rent premium risk and debt service coverage ratio (DSCR).
"""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Literal

RiskSeverity = Literal["Medium Risk", "Critical Risk"]

DEFAULT_DEAL_PATH = Path(__file__).resolve().parents[1] / "data" / "current_deal.json"

# Thresholds
RENT_GAP_MEDIUM_PCT = 2.0
RENT_GAP_CRITICAL_PCT = 4.0
DSCR_MEDIUM_THRESHOLD = 1.25
DSCR_CRITICAL_THRESHOLD = 1.15
VACANCY_DELTA_MEDIUM_BPS = -50   # trailing-12mo occupancy change worse than -50bps → Medium
VACANCY_DELTA_CRITICAL_BPS = -100  # worse than -100bps → Critical

# Fallback underwriting assumptions when not present in the payload
DEFAULT_PRO_FORMA_RENT_GROWTH_PCT = 5.8
DEFAULT_LOAN_AMOUNT_USD = 60_000_000
DEFAULT_DEBT_RATE = 0.096  # Year-1 IO rate implied by ~1.08x DSCR on $60M loan

# Score deductions applied per triggered flag severity (0-100 composite score)
SEVERITY_DEDUCTIONS: dict[str, int] = {
    "Critical Risk": 35,
    "Medium Risk": 20,
}


@dataclass(frozen=True)
class RiskFlag:
    id: str
    category: str
    severity: RiskSeverity
    title: str
    justification: str
    metrics: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def load_deal_payload(path: str | Path = DEFAULT_DEAL_PATH) -> dict[str, Any]:
    """Load a merged deal JSON payload."""
    deal_path = Path(path)
    if not deal_path.is_file():
        raise FileNotFoundError(f"Deal payload not found: {deal_path}")
    return json.loads(deal_path.read_text(encoding="utf-8"))


def _underwriting(deal: dict[str, Any]) -> dict[str, Any]:
    return deal.get("underwriting_assumptions") or {}


def get_pro_forma_rent_growth_pct(deal: dict[str, Any]) -> float:
    """Pro-forma annual rent growth assumed in the OM / sponsor model."""
    uw = _underwriting(deal)
    if uw.get("pro_forma_rent_growth_pct") is not None:
        return float(uw["pro_forma_rent_growth_pct"])
    derived = deal.get("derived_metrics") or {}
    if derived.get("pro_forma_rent_growth_pct") is not None:
        return float(derived["pro_forma_rent_growth_pct"])
    return DEFAULT_PRO_FORMA_RENT_GROWTH_PCT


def get_submarket_rent_growth_avg_pct(deal: dict[str, Any]) -> float:
    """Historical 3-year submarket average effective rent growth."""
    rent_data = (
        deal.get("market_context", {})
        .get("rent_growth_trailing_3yr", {})
    )
    if rent_data.get("trailing_3yr_cagr_pct") is not None:
        return float(rent_data["trailing_3yr_cagr_pct"])

    annual = rent_data.get("annual") or []
    if annual:
        values = [float(row["growth_pct"]) for row in annual if row.get("growth_pct") is not None]
        if values:
            return round(sum(values) / len(values), 2)

    raise ValueError("Submarket rent growth data missing from deal payload")


def get_year1_noi(deal: dict[str, Any]) -> float:
    """Year-1 net operating income from parsed OM financials."""
    noi = (
        deal.get("financial_projections", {})
        .get("year_1", {})
        .get("net_operating_income_usd")
    )
    if noi is None:
        raise ValueError("Year-1 NOI missing from deal payload")
    return float(noi)


def get_loan_amount_usd(deal: dict[str, Any]) -> float:
    uw = _underwriting(deal)
    if uw.get("loan_amount_usd") is not None:
        return float(uw["loan_amount_usd"])
    return DEFAULT_LOAN_AMOUNT_USD


def has_capex_budget(deal: dict[str, Any]) -> bool:
    """True when the OM includes a non-zero interior renovation / CapEx budget."""
    capex = (
        deal.get("financial_projections", {})
        .get("capital_expenditures", {})
        .get("interior_renovation_budget_usd")
    )
    if capex is None:
        return False
    return abs(float(capex)) > 0


def calculate_annual_debt_service(
    loan_amount_usd: float,
    debt_rate: float,
    *,
    interest_only: bool = True,
    amortization_years: int = 30,
) -> float:
    """
    Compute annual debt service from an adjustable debt rate.

    Defaults to interest-only, which is typical for Year-1 value-add screening.
    """
    if loan_amount_usd <= 0:
        raise ValueError("Loan amount must be positive")
    if debt_rate < 0:
        raise ValueError("Debt rate must be non-negative")

    if interest_only:
        return loan_amount_usd * debt_rate

    if debt_rate == 0:
        return loan_amount_usd / amortization_years

    # Use monthly compounding: mortgage payments are monthly, not annual.
    # Applying the annual rate directly overstates debt service by ~$46K on a $60M loan.
    monthly_rate = debt_rate / 12
    n_payments = amortization_years * 12
    factor = (1 + monthly_rate) ** n_payments
    monthly_payment = loan_amount_usd * (monthly_rate * factor) / (factor - 1)
    return monthly_payment * 12


def calculate_dscr(
    deal: dict[str, Any],
    debt_rate: float = DEFAULT_DEBT_RATE,
    *,
    interest_only: bool | None = None,
) -> float:
    """Debt Service Coverage Ratio = Year-1 NOI / annual debt service."""
    noi = get_year1_noi(deal)
    loan_amount = get_loan_amount_usd(deal)
    uw = _underwriting(deal)
    io = interest_only if interest_only is not None else bool(uw.get("interest_only", True))
    amort_years = int(uw.get("amortization_years", 30))

    debt_service = calculate_annual_debt_service(
        loan_amount,
        debt_rate,
        interest_only=io,
        amortization_years=amort_years,
    )
    if debt_service <= 0:
        raise ValueError("Annual debt service must be positive")
    return round(noi / debt_service, 4)


def evaluate_rent_premium_risk(deal: dict[str, Any]) -> RiskFlag | None:
    """
    Rent Premium Risk (two-level logic):
      - Gap > 2% vs 3-yr submarket average → Medium Risk
      - Gap > 4% AND no CapEx budget → Critical Risk (escalates Medium)
    """
    pro_forma = get_pro_forma_rent_growth_pct(deal)
    submarket_avg = get_submarket_rent_growth_avg_pct(deal)
    gap = round(pro_forma - submarket_avg, 2)
    capex_present = has_capex_budget(deal)
    submarket_name = deal.get("market_context", {}).get("submarket", "the submarket")

    metrics = {
        "pro_forma_rent_growth_pct": pro_forma,
        "submarket_rent_growth_avg_pct": submarket_avg,
        "rent_growth_gap_pct": gap,
        "capex_budget_present": capex_present,
    }

    if gap > RENT_GAP_CRITICAL_PCT and not capex_present:
        return RiskFlag(
            id="rent_premium_critical",
            category="Rent Premium Risk",
            severity="Critical Risk",
            title="Pro-forma rent growth far exceeds market with no renovation budget",
            justification=(
                f"The sponsor underwrites {pro_forma:.1f}% annual rent growth, "
                f"which is {gap:.1f} percentage points above the {submarket_avg:.1f}% "
                f"historical 3-year average for {submarket_name}. "
                f"This gap exceeds the {RENT_GAP_CRITICAL_PCT:.0f}% critical threshold, "
                f"and no interior CapEx budget was identified in the OM to support the "
                f"assumed rent premiums. The underwriting is disconnected from market "
                f"reality and lacks capital to bridge the gap."
            ),
            metrics=metrics,
        )

    if gap > RENT_GAP_MEDIUM_PCT:
        capex_note = (
            "An interior renovation budget is present in the OM, which partially "
            "mitigates execution risk."
            if capex_present
            else (
                "No interior CapEx budget was found; monitor for escalation if the "
                "rent growth gap widens further."
            )
        )
        return RiskFlag(
            id="rent_premium_medium",
            category="Rent Premium Risk",
            severity="Medium Risk",
            title="Pro-forma rent growth exceeds submarket trend",
            justification=(
                f"The sponsor assumes {pro_forma:.1f}% annual rent growth versus "
                f"a {submarket_avg:.1f}% historical 3-year submarket average in "
                f"{submarket_name}, a gap of {gap:.1f} percentage points, above "
                f"the {RENT_GAP_MEDIUM_PCT:.0f}% medium-risk threshold. "
                f"{capex_note}"
            ),
            metrics=metrics,
        )

    return None


def evaluate_dscr_risk(
    deal: dict[str, Any],
    debt_rate: float = DEFAULT_DEBT_RATE,
) -> RiskFlag | None:
    """
    Financial Ratios — DSCR (two-level logic):
      - DSCR < 1.25x → Medium Risk
      - DSCR < 1.15x → Critical Risk (escalates Medium)
    """
    dscr = calculate_dscr(deal, debt_rate)
    noi = get_year1_noi(deal)
    loan_amount = get_loan_amount_usd(deal)
    uw = _underwriting(deal)
    # Mirror the same IO / amortization settings used in calculate_dscr so that
    # the displayed debt_service matches the DSCR that appears in flag text.
    io = bool(uw.get("interest_only", True))
    amort_years = int(uw.get("amortization_years", 30))
    debt_service = calculate_annual_debt_service(
        loan_amount, debt_rate, interest_only=io, amortization_years=amort_years
    )

    metrics = {
        "year_1_noi_usd": noi,
        "loan_amount_usd": loan_amount,
        "debt_rate_pct": round(debt_rate * 100, 3),
        "annual_debt_service_usd": round(debt_service, 2),
        "dscr": dscr,
    }

    if dscr < DSCR_CRITICAL_THRESHOLD:
        return RiskFlag(
            id="dscr_critical",
            category="Financial Ratios",
            severity="Critical Risk",
            title="DSCR critically below lender covenant",
            justification=(
                f"Year-1 DSCR is {dscr:.2f}x based on NOI of ${noi:,.0f} and annual "
                f"debt service of ${debt_service:,.0f} "
                f"(${loan_amount:,.0f} loan at {debt_rate * 100:.2f}% interest-only). "
                f"This falls below the {DSCR_CRITICAL_THRESHOLD:.2f}x critical threshold "
                f"and well under the typical 1.25x agency covenant. Refinance and "
                f"default risk are materially elevated."
            ),
            metrics=metrics,
        )

    if dscr < DSCR_MEDIUM_THRESHOLD:
        return RiskFlag(
            id="dscr_medium",
            category="Financial Ratios",
            severity="Medium Risk",
            title="DSCR below typical lender covenant",
            justification=(
                f"Year-1 DSCR is {dscr:.2f}x based on NOI of ${noi:,.0f} and annual "
                f"debt service of ${debt_service:,.0f} "
                f"(${loan_amount:,.0f} loan at {debt_rate * 100:.2f}% interest-only). "
                f"This is below the {DSCR_MEDIUM_THRESHOLD:.2f}x medium-risk threshold "
                f"commonly required by agency and CMBS lenders. Limited cushion remains "
                f"for rate increases or NOI softness."
            ),
            metrics=metrics,
        )

    return None


def evaluate_vacancy_delta_risk(deal: dict[str, Any]) -> RiskFlag | None:
    """
    Market Vacancy Delta (two-level logic):
      - Trailing 12-month occupancy change worse than -50 bps → Medium Risk
      - Worse than -100 bps → Critical Risk
    """
    occ_data = deal.get("market_context", {}).get("submarket_occupancy", {})
    change_bps = occ_data.get("trailing_12mo_change_bps")
    if change_bps is None:
        return None

    avg_occ = occ_data.get("average_occupancy_pct", 0)
    econ_vac = occ_data.get("economic_vacancy_pct", 0)
    pipeline = (
        deal.get("market_context", {})
        .get("construction_pipeline", {})
        .get("summary", {})
        .get("delivering_through_2027_units", 0)
    )
    submarket = deal.get("market_context", {}).get("submarket", "the submarket")

    metrics: dict[str, Any] = {
        "trailing_12mo_change_bps": change_bps,
        "average_occupancy_pct": avg_occ,
        "economic_vacancy_pct": econ_vac,
        "pipeline_units_through_2027": pipeline,
    }

    if change_bps <= VACANCY_DELTA_CRITICAL_BPS:
        return RiskFlag(
            id="vacancy_delta_critical",
            category="Market Vacancy Delta",
            severity="Critical Risk",
            title="Submarket vacancy deteriorating at critical pace",
            justification=(
                f"{submarket} occupancy has declined {abs(change_bps)} bps over the trailing "
                f"12 months to {avg_occ:.1f}%, with economic vacancy at {econ_vac:.1f}%. "
                f"{pipeline:,} competing Class A units deliver through 2027, sustaining "
                f"concession pressure. Occupancy erosion at this pace compresses effective "
                f"rents and directly threatens NOI projections."
            ),
            metrics=metrics,
        )

    if change_bps <= VACANCY_DELTA_MEDIUM_BPS:
        return RiskFlag(
            id="vacancy_delta_medium",
            category="Market Vacancy Delta",
            severity="Medium Risk",
            title="Submarket occupancy trending negative",
            justification=(
                f"{submarket} occupancy declined {abs(change_bps)} bps over the trailing "
                f"12 months to {avg_occ:.1f}%. Monitor for acceleration — {pipeline:,} units "
                f"in the construction pipeline through 2027 will sustain concession pressure."
            ),
            metrics=metrics,
        )

    return None


def evaluate_risk_flags(
    deal: dict[str, Any],
    debt_rate: float = DEFAULT_DEBT_RATE,
) -> list[dict[str, Any]]:
    """
    Run all deterministic risk rules against a deal payload.

    Returns an array of triggered risk flags (highest applicable severity per
    category). Categories with no breach return no entry.
    """
    flags: list[RiskFlag] = []

    rent_flag = evaluate_rent_premium_risk(deal)
    if rent_flag:
        flags.append(rent_flag)

    dscr_flag = evaluate_dscr_risk(deal, debt_rate=debt_rate)
    if dscr_flag:
        flags.append(dscr_flag)

    vacancy_flag = evaluate_vacancy_delta_risk(deal)
    if vacancy_flag:
        flags.append(vacancy_flag)

    return [flag.to_dict() for flag in flags]


def score_deal(flags: list[dict[str, Any]]) -> int:
    """
    Compute a 0-100 composite risk score from triggered flag severities.

    Starts at 100 and subtracts SEVERITY_DEDUCTIONS per flag:
        Critical Risk → -35 pts
        Medium Risk   → -20 pts
    Score is clamped to [0, 100].
    """
    deductions = sum(SEVERITY_DEDUCTIONS.get(f.get("severity", ""), 0) for f in flags)
    return max(0, 100 - deductions)


def evaluate_deal_file(
    deal_path: str | Path = DEFAULT_DEAL_PATH,
    debt_rate: float = DEFAULT_DEBT_RATE,
) -> list[dict[str, Any]]:
    """Load current_deal.json and evaluate all risk rules."""
    deal = load_deal_payload(deal_path)
    return evaluate_risk_flags(deal, debt_rate=debt_rate)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Evaluate deal payload against deterministic risk thresholds."
    )
    parser.add_argument(
        "--deal",
        type=Path,
        default=DEFAULT_DEAL_PATH,
        help=f"Path to deal JSON (default: {DEFAULT_DEAL_PATH})",
    )
    parser.add_argument(
        "--debt-rate",
        type=float,
        default=DEFAULT_DEBT_RATE,
        help="Annual debt interest rate as decimal (default: 0.096)",
    )
    args = parser.parse_args()

    flags = evaluate_deal_file(args.deal, debt_rate=args.debt_rate)
    score = score_deal(flags)
    output = {
        "score": score,
        "flag_count": len(flags),
        "flags": flags,
    }
    print(json.dumps(output, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
