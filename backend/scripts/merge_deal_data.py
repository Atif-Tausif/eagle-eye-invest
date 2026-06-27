"""
Merge OM parser output with market data into a single deal payload.

Usage:
    python -m backend.scripts.merge_deal_data <pdf_path> [--submarket <name>] [--out <path>]

Reads:
    - OM PDF    → backend.parsers.om_parser.parse_om
    - Market    → backend.services.market_data.get_market_context

Writes:
    - backend/data/current_deal.json  (default output path)
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Make sure repo root is on the path when run as a plain script
_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.parsers.om_parser import parse_om
from backend.services.market_data import get_market_context

DEFAULT_OUT = _REPO_ROOT / "backend" / "data" / "current_deal.json"


def merge(pdf_path: Path, submarket: str) -> dict:
    om_data = parse_om(pdf_path)
    market_data = get_market_context(submarket)

    meta = om_data["property_metadata"]
    fins = om_data["financial_projections"]

    noi = fins["year_1"]["net_operating_income_usd"]
    reno = fins["capital_expenditures"]["interior_renovation_budget_usd"]
    units = meta.get("unit_count")

    derived: dict = {}
    if noi and reno:
        derived["net_cash_flow_after_capex_usd"] = noi + reno  # reno is negative
    if noi and units:
        derived["noi_per_unit_usd"] = round(noi / units, 2)
    if reno and units:
        derived["reno_cost_per_unit_usd"] = round(abs(reno) / units, 2)

    return {
        "merged_at": datetime.now(timezone.utc).isoformat(),
        "source_pdf": str(pdf_path.resolve()),
        "property_metadata": meta,
        "financial_projections": fins,
        "market_context": market_data,
        "derived_metrics": derived,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Merge OM parser + market data into a single deal JSON payload."
    )
    parser.add_argument("pdf_path", type=Path, help="Path to the OM PDF")
    parser.add_argument(
        "--submarket",
        default="DuPage County",
        help="Submarket name passed to market_data (default: DuPage County)",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=DEFAULT_OUT,
        help=f"Output JSON path (default: {DEFAULT_OUT})",
    )
    args = parser.parse_args()

    payload = merge(args.pdf_path, args.submarket)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {args.out}")
    print(f"  property      : {payload['property_metadata'].get('property_name')}")
    print(f"  units         : {payload['property_metadata'].get('unit_count')}")
    print(f"  NOI (Year 1)  : ${payload['financial_projections']['year_1']['net_operating_income_usd']:,}")
    print(f"  Reno cost     : ${abs(payload['financial_projections']['capital_expenditures']['interior_renovation_budget_usd']):,}")
    dm = payload["derived_metrics"]
    if dm:
        print(f"  NOI/unit      : ${dm.get('noi_per_unit_usd', 'n/a'):,}")
        print(f"  Reno/unit     : ${dm.get('reno_cost_per_unit_usd', 'n/a'):,}")


if __name__ == "__main__":
    main()
