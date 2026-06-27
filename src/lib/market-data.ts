/** Stub market-data — mirrors backend/services/market_data.py */

const AS_OF = "2026-06-01";
const SOURCE = "CoStar (stub)";

export function getMarketContext(submarket = "DuPage County") {
  const rentGrowth = {
    submarket,
    metric: "effective_rent_growth",
    period: "trailing_3_year",
    as_of: AS_OF,
    source: SOURCE,
    annual: [
      { year: 2023, growth_pct: 4.8 },
      { year: 2024, growth_pct: 2.6 },
      { year: 2025, growth_pct: 1.2 },
    ],
    trailing_3yr_cumulative_pct: 8.9,
    trailing_3yr_cagr_pct: 2.9,
    trailing_12mo_pct: 2.1,
  };

  const occupancy = {
    submarket,
    metric: "occupancy",
    as_of: AS_OF,
    source: SOURCE,
    average_occupancy_pct: 91.6,
    physical_vacancy_pct: 8.4,
    economic_vacancy_pct: 9.1,
    trailing_12mo_change_bps: -110,
    quarterly: [
      { quarter: "2025-Q3", occupancy_pct: 92.4 },
      { quarter: "2025-Q4", occupancy_pct: 92.0 },
      { quarter: "2026-Q1", occupancy_pct: 91.8 },
      { quarter: "2026-Q2", occupancy_pct: 91.6 },
    ],
  };

  const projects = [
    {
      project_name: "The Reserve at Yorktown",
      city: "Lombard",
      units: 312,
      status: "under_construction",
      expected_delivery: "2026-Q4",
      product_type: "Class A garden",
    },
    {
      project_name: "Westmont Station Apartments",
      city: "Westmont",
      units: 286,
      status: "under_construction",
      expected_delivery: "2027-Q1",
      product_type: "Class A mid-rise",
    },
    {
      project_name: "Glendale Crossing",
      city: "Glendale Heights",
      units: 224,
      status: "planned",
      expected_delivery: "2027-Q2",
      product_type: "Class A garden",
    },
    {
      project_name: "Route 59 Transit Flats",
      city: "Naperville",
      units: 418,
      status: "planned",
      expected_delivery: "2027-Q3",
      product_type: "Class A mid-rise",
    },
    {
      project_name: "Elmhurst Exchange",
      city: "Elmhurst",
      units: 198,
      status: "pre_leasing",
      expected_delivery: "2026-Q3",
      product_type: "Class A mid-rise",
    },
    {
      project_name: "Villa Park Lofts Phase II",
      city: "Villa Park",
      units: 96,
      status: "planned",
      expected_delivery: "2028-Q1",
      product_type: "Class A loft",
    },
    {
      project_name: "Downers Grove Riverwalk",
      city: "Downers Grove",
      units: 306,
      status: "under_construction",
      expected_delivery: "2027-Q1",
      product_type: "Class A garden",
    },
  ];

  const totalUnits = projects.reduce((s, p) => s + p.units, 0);
  const activeUnits = projects
    .filter((p) => p.status === "under_construction" || p.status === "pre_leasing")
    .reduce((s, p) => s + p.units, 0);
  const plannedUnits = projects
    .filter((p) => p.status === "planned")
    .reduce((s, p) => s + p.units, 0);

  const pipeline = {
    submarket,
    as_of: AS_OF,
    source: SOURCE,
    summary: {
      project_count: projects.length,
      total_pipeline_units: totalUnits,
      active_units: activeUnits,
      planned_units: plannedUnits,
      delivering_through_2027_units: 1840,
    },
    projects,
  };

  return {
    submarket,
    as_of: AS_OF,
    source: SOURCE,
    rent_growth_trailing_3yr: rentGrowth,
    submarket_occupancy: occupancy,
    construction_pipeline: pipeline,
  };
}
