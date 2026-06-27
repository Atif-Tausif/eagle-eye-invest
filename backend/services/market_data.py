"""
Stub market-data client for multifamily submarket benchmarks.

Simulates live API calls to providers such as CoStar / RealPage for DuPage County
and adjacent western-Chicago submarkets. Replace `_MarketDataClient` internals with
real HTTP calls when credentials and endpoints are available.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import Any


@dataclass(frozen=True)
class _MarketDataClient:
    """Simulated third-party market data API client."""

    provider: str = "CoStar (stub)"
    as_of: date = date(2026, 6, 1)

    def fetch_rent_growth(self, submarket: str) -> dict[str, Any]:
        """Historical 3-year trailing effective rent growth by year."""
        _ = submarket  # routing key for future live API lookup
        return {
            "submarket": submarket,
            "metric": "effective_rent_growth",
            "period": "trailing_3_year",
            "as_of": self.as_of.isoformat(),
            "source": self.provider,
            "annual": [
                {"year": 2023, "growth_pct": 4.8},
                {"year": 2024, "growth_pct": 2.6},
                {"year": 2025, "growth_pct": 1.2},
            ],
            "trailing_3yr_cumulative_pct": 8.9,
            "trailing_3yr_cagr_pct": 2.9,
            "trailing_12mo_pct": 2.1,
        }

    def fetch_occupancy(self, submarket: str) -> dict[str, Any]:
        """Average submarket occupancy and recent trend."""
        _ = submarket
        return {
            "submarket": submarket,
            "metric": "occupancy",
            "as_of": self.as_of.isoformat(),
            "source": self.provider,
            "average_occupancy_pct": 91.6,
            "physical_vacancy_pct": 8.4,
            "economic_vacancy_pct": 9.1,
            "trailing_12mo_change_bps": -110,
            "quarterly": [
                {"quarter": "2025-Q3", "occupancy_pct": 92.4},
                {"quarter": "2025-Q4", "occupancy_pct": 92.0},
                {"quarter": "2026-Q1", "occupancy_pct": 91.8},
                {"quarter": "2026-Q2", "occupancy_pct": 91.6},
            ],
        }

    def fetch_construction_pipeline(self, submarket: str) -> list[dict[str, Any]]:
        """Active and planned multifamily projects in the submarket."""
        _ = submarket
        return [
            {
                "project_name": "The Reserve at Yorktown",
                "city": "Lombard",
                "units": 312,
                "status": "under_construction",
                "expected_delivery": "2026-Q4",
                "product_type": "Class A garden",
            },
            {
                "project_name": "Westmont Station Apartments",
                "city": "Westmont",
                "units": 286,
                "status": "under_construction",
                "expected_delivery": "2027-Q1",
                "product_type": "Class A mid-rise",
            },
            {
                "project_name": "Glendale Crossing",
                "city": "Glendale Heights",
                "units": 224,
                "status": "planned",
                "expected_delivery": "2027-Q2",
                "product_type": "Class A garden",
            },
            {
                "project_name": "Route 59 Transit Flats",
                "city": "Naperville",
                "units": 418,
                "status": "planned",
                "expected_delivery": "2027-Q3",
                "product_type": "Class A mid-rise",
            },
            {
                "project_name": "Elmhurst Exchange",
                "city": "Elmhurst",
                "units": 198,
                "status": "pre_leasing",
                "expected_delivery": "2026-Q3",
                "product_type": "Class A mid-rise",
            },
            {
                "project_name": "Villa Park Lofts Phase II",
                "city": "Villa Park",
                "units": 96,
                "status": "planned",
                "expected_delivery": "2028-Q1",
                "product_type": "Class A loft",
            },
            {
                "project_name": "Downers Grove Riverwalk",
                "city": "Downers Grove",
                "units": 306,
                "status": "under_construction",
                "expected_delivery": "2027-Q1",
                "product_type": "Class A garden",
            },
        ]


_CLIENT = _MarketDataClient()


def get_rent_growth_trailing_3yr(submarket: str = "DuPage County") -> dict[str, Any]:
    """Pull historical 3-year trailing rent growth for a submarket."""
    return _CLIENT.fetch_rent_growth(submarket)


def get_submarket_occupancy(submarket: str = "DuPage County") -> dict[str, Any]:
    """Pull average submarket occupancy rates and recent trend."""
    return _CLIENT.fetch_occupancy(submarket)


def get_construction_pipeline(submarket: str = "DuPage County") -> dict[str, Any]:
    """Pull active or planned local multifamily construction pipeline projects."""
    projects = _CLIENT.fetch_construction_pipeline(submarket)
    total_units = sum(p["units"] for p in projects)
    active_units = sum(
        p["units"] for p in projects if p["status"] in {"under_construction", "pre_leasing"}
    )
    planned_units = sum(p["units"] for p in projects if p["status"] == "planned")

    return {
        "submarket": submarket,
        "as_of": _CLIENT.as_of.isoformat(),
        "source": _CLIENT.provider,
        "summary": {
            "project_count": len(projects),
            "total_pipeline_units": total_units,
            "active_units": active_units,
            "planned_units": planned_units,
            "delivering_through_2027_units": 1840,
        },
        "projects": projects,
    }


def get_market_context(submarket: str = "DuPage County") -> dict[str, Any]:
    """
    Aggregate live market benchmarks for deal screening context.

    Returns rent growth, occupancy, and construction pipeline data for the
    requested submarket (defaults to DuPage County).
    """
    rent_growth = get_rent_growth_trailing_3yr(submarket)
    occupancy = get_submarket_occupancy(submarket)
    pipeline = get_construction_pipeline(submarket)

    return {
        "submarket": submarket,
        "as_of": _CLIENT.as_of.isoformat(),
        "source": _CLIENT.provider,
        "rent_growth_trailing_3yr": rent_growth,
        "submarket_occupancy": occupancy,
        "construction_pipeline": pipeline,
    }


if __name__ == "__main__":
    import json

    print(json.dumps(get_market_context(), indent=2))
