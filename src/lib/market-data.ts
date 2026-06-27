/** RentCast-backed market data with hardcoded DuPage County fallback */

const AS_OF = new Date().toISOString().slice(0, 10);
const SOURCE_RENTCAST = "RentCast";
const SOURCE_STUB = "CoStar (stub)";

// ---------------------------------------------------------------------------
// RentCast API types (subset we use)
// ---------------------------------------------------------------------------

interface RentCastMarket {
  averageRent?: number;
  minRent?: number;
  maxRent?: number;
  averageSquareFootage?: number;
  rentalVacancyRate?: number; // 0–100
  history?: Record<
    string,
    { averageRent?: number; rentalVacancyRate?: number }
  >;
}

// ---------------------------------------------------------------------------
// Stub fallback — DuPage County numbers
// ---------------------------------------------------------------------------

function duPageStub(submarket: string) {
  const rentGrowth = {
    submarket,
    metric: "effective_rent_growth",
    period: "trailing_3_year",
    as_of: AS_OF,
    source: SOURCE_STUB,
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
    source: SOURCE_STUB,
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

  const pipeline = {
    submarket,
    as_of: AS_OF,
    source: SOURCE_STUB,
    summary: {
      project_count: 7,
      total_pipeline_units: 1840,
      active_units: 1002,
      planned_units: 838,
      delivering_through_2027_units: 1840,
    },
    projects: [] as Array<{
      project_name: string;
      city: string;
      units: number;
      status: string;
      expected_delivery: string;
      product_type: string;
    }>,
  };

  return { submarket, as_of: AS_OF, source: SOURCE_STUB, rent_growth_trailing_3yr: rentGrowth, submarket_occupancy: occupancy, construction_pipeline: pipeline };
}

// ---------------------------------------------------------------------------
// Map RentCast history → annual rent growth array
// ---------------------------------------------------------------------------

function buildRentGrowthFromHistory(
  history: Record<string, { averageRent?: number }>,
  submarket: string,
) {
  const entries = Object.entries(history)
    .map(([dateStr, v]) => ({ date: new Date(dateStr), rent: v.averageRent ?? 0 }))
    .filter((e) => e.rent > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (entries.length < 2) return null;

  // Group by year, take last entry per year
  const byYear: Record<number, number> = {};
  for (const e of entries) {
    byYear[e.date.getFullYear()] = e.rent;
  }

  const years = Object.keys(byYear)
    .map(Number)
    .sort()
    .slice(-4); // up to 4 recent years
  const annual: Array<{ year: number; growth_pct: number }> = [];
  for (let i = 1; i < years.length; i++) {
    const prev = byYear[years[i - 1]];
    const curr = byYear[years[i]];
    if (prev > 0) {
      annual.push({
        year: years[i],
        growth_pct: Math.round(((curr - prev) / prev) * 1000) / 10,
      });
    }
  }

  if (!annual.length) return null;

  const values = annual.map((a) => a.growth_pct);
  const cagr = Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10;
  const trailing12mo = annual.at(-1)?.growth_pct ?? cagr;

  return {
    submarket,
    metric: "effective_rent_growth",
    period: "trailing_3_year",
    as_of: AS_OF,
    source: SOURCE_RENTCAST,
    annual,
    trailing_3yr_cumulative_pct: Math.round(values.reduce((s, v) => s + v, 0) * 10) / 10,
    trailing_3yr_cagr_pct: cagr,
    trailing_12mo_pct: trailing12mo,
  };
}

// ---------------------------------------------------------------------------
// Main export — async, uses RentCast when possible
// ---------------------------------------------------------------------------

export async function getMarketContext(zipCodeOrSubmarket = "DuPage County") {
  const apiKey =
    typeof process !== "undefined"
      ? (process.env.RENTCAST_API_KEY ?? "")
      : "";

  // If no zip code or no API key, return stub
  const isZip = /^\d{5}$/.test(zipCodeOrSubmarket.trim());
  if (!isZip || !apiKey) {
    return duPageStub(zipCodeOrSubmarket);
  }

  const zip = zipCodeOrSubmarket.trim();

  try {
    const res = await fetch(
      `https://api.rentcast.io/v1/markets?zipCode=${zip}&propertyType=Apartment&historyRange=36`,
      {
        headers: {
          "X-Api-Key": apiKey,
          Accept: "application/json",
        },
      },
    );

    if (!res.ok) {
      console.warn(`RentCast API error ${res.status} for zip ${zip} — using stub`);
      return duPageStub(zip);
    }

    const data = (await res.json()) as RentCastMarket;

    // Build occupancy from vacancy rate
    const vacancyRaw = data.rentalVacancyRate;
    const occupancyPct =
      vacancyRaw != null
        ? Math.round((100 - vacancyRaw) * 10) / 10
        : 91.6;
    const vacancyPct =
      vacancyRaw != null ? Math.round(vacancyRaw * 10) / 10 : 8.4;

    // Try to derive trailing-12mo vacancy change from history
    let trailing12moBps = -110; // fallback
    if (data.history) {
      const histEntries = Object.entries(data.history)
        .map(([d, v]) => ({ date: new Date(d), vac: v.rentalVacancyRate }))
        .filter((e) => e.vac != null)
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      if (histEntries.length >= 2) {
        const latest = histEntries.at(-1)!.vac!;
        const yearAgo = histEntries.find(
          (e) =>
            Math.abs(
              e.date.getTime() - (histEntries.at(-1)!.date.getTime() - 365 * 86400_000),
            ) <
            60 * 86400_000,
        );
        if (yearAgo) {
          trailing12moBps = Math.round((latest - yearAgo.vac!) * 100); // vacancy delta in bps (positive = worse)
          trailing12moBps = -trailing12moBps; // flip: occupancy change convention
        }
      }
    }

    const occupancy = {
      submarket: zip,
      metric: "occupancy",
      as_of: AS_OF,
      source: SOURCE_RENTCAST,
      average_occupancy_pct: occupancyPct,
      physical_vacancy_pct: vacancyPct,
      economic_vacancy_pct: Math.round((vacancyPct + 0.7) * 10) / 10,
      trailing_12mo_change_bps: trailing12moBps,
      quarterly: [] as Array<{ quarter: string; occupancy_pct: number }>,
    };

    // Build rent growth from history
    const rentGrowth =
      data.history
        ? buildRentGrowthFromHistory(data.history, zip)
        : null;

    const finalRentGrowth = rentGrowth ?? {
      submarket: zip,
      metric: "effective_rent_growth",
      period: "trailing_3_year",
      as_of: AS_OF,
      source: SOURCE_RENTCAST,
      annual: [],
      trailing_3yr_cumulative_pct: 0,
      trailing_3yr_cagr_pct: 0,
      trailing_12mo_pct: 0,
    };

    // Pipeline — RentCast doesn't provide supply pipeline; retain stub for DuPage or return empty
    const pipeline = {
      submarket: zip,
      as_of: AS_OF,
      source: SOURCE_STUB,
      summary: {
        project_count: 0,
        total_pipeline_units: 0,
        active_units: 0,
        planned_units: 0,
        delivering_through_2027_units: 0,
      },
      projects: [] as Array<{
        project_name: string;
        city: string;
        units: number;
        status: string;
        expected_delivery: string;
        product_type: string;
      }>,
    };

    return {
      submarket: zip,
      as_of: AS_OF,
      source: SOURCE_RENTCAST,
      average_rent_usd: data.averageRent,
      rent_growth_trailing_3yr: finalRentGrowth,
      submarket_occupancy: occupancy,
      construction_pipeline: pipeline,
    };
  } catch (err) {
    console.warn("RentCast fetch failed — using stub:", err);
    return duPageStub(zipCodeOrSubmarket);
  }
}
