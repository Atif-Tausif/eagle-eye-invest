/**
 * TypeScript mirror of backend/engine/risk_rules.py for client-side evaluation.
 */

export type RiskSeverity = "Medium Risk" | "Critical Risk";

export interface RiskFlag {
  id: string;
  category: string;
  severity: RiskSeverity;
  title: string;
  justification: string;
  metrics: Record<string, unknown>;
}

export interface DealPayload {
  merged_at?: string;
  source_pdf?: string;
  property_metadata?: {
    property_name?: string | null;
    unit_count?: number | null;
    asset_type?: string | null;
    location?: string | null;
  };
  financial_projections?: {
    year_1?: { net_operating_income_usd?: number | null };
    capital_expenditures?: { interior_renovation_budget_usd?: number | null };
  };
  market_context?: {
    submarket?: string;
    rent_growth_trailing_3yr?: {
      trailing_3yr_cagr_pct?: number;
      trailing_12mo_pct?: number;
      annual?: Array<{ year: number; growth_pct: number }>;
    };
    submarket_occupancy?: {
      average_occupancy_pct?: number;
      physical_vacancy_pct?: number;
      economic_vacancy_pct?: number;
      trailing_12mo_change_bps?: number;
    };
    construction_pipeline?: {
      submarket?: string;
      summary?: {
        delivering_through_2027_units?: number;
        total_pipeline_units?: number;
        project_count?: number;
      };
      projects?: Array<{
        project_name: string;
        units: number;
        status: string;
        expected_delivery: string;
      }>;
    };
  };
  derived_metrics?: {
    net_cash_flow_after_capex_usd?: number;
    noi_per_unit_usd?: number;
    reno_cost_per_unit_usd?: number;
    pro_forma_rent_growth_pct?: number;
  };
  underwriting_assumptions?: {
    pro_forma_rent_growth_pct?: number;
    loan_amount_usd?: number;
    interest_only?: boolean;
    amortization_years?: number;
  };
}

export interface EnginePayload {
  deal: DealPayload;
  flags: RiskFlag[];
  score: number;
}

const RENT_GAP_MEDIUM_PCT = 2.0;
const RENT_GAP_CRITICAL_PCT = 4.0;
export const DSCR_MEDIUM_THRESHOLD = 1.25;
const DSCR_CRITICAL_THRESHOLD = 1.15;
// Submarket occupancy deterioration thresholds (trailing 12-month bps change)
const VACANCY_DELTA_MEDIUM_BPS = -50;
const VACANCY_DELTA_CRITICAL_BPS = -100;
const DEFAULT_PRO_FORMA_RENT_GROWTH_PCT = 5.8;
const DEFAULT_LOAN_AMOUNT_USD = 60_000_000;
export const DEFAULT_DEBT_RATE = 0.096;

const SEVERITY_DEDUCTIONS: Record<RiskSeverity, number> = {
  "Critical Risk": 35,
  "Medium Risk": 20,
};

function underwriting(deal: DealPayload) {
  return deal.underwriting_assumptions ?? {};
}

function proFormaRentGrowth(deal: DealPayload): number {
  const uw = underwriting(deal);
  if (uw.pro_forma_rent_growth_pct != null) return uw.pro_forma_rent_growth_pct;
  if (deal.derived_metrics?.pro_forma_rent_growth_pct != null) {
    return deal.derived_metrics.pro_forma_rent_growth_pct;
  }
  return DEFAULT_PRO_FORMA_RENT_GROWTH_PCT;
}

function submarketRentGrowthAvg(deal: DealPayload): number {
  const rent = deal.market_context?.rent_growth_trailing_3yr;
  if (rent?.trailing_3yr_cagr_pct != null) return rent.trailing_3yr_cagr_pct;
  const annual = rent?.annual ?? [];
  if (annual.length) {
    const values = annual.map((r) => r.growth_pct);
    return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100;
  }
  return 0;
}

export function year1Noi(deal: DealPayload): number {
  return deal.financial_projections?.year_1?.net_operating_income_usd ?? 0;
}

export function loanAmount(deal: DealPayload): number {
  return underwriting(deal).loan_amount_usd ?? DEFAULT_LOAN_AMOUNT_USD;
}

export function hasCapexBudget(deal: DealPayload): boolean {
  const capex = deal.financial_projections?.capital_expenditures?.interior_renovation_budget_usd;
  return capex != null && Math.abs(capex) > 0;
}

export function annualDebtService(
  loan: number,
  rate: number,
  interestOnly = true,
  amortYears = 30,
): number {
  if (interestOnly) return loan * rate;
  const monthlyRate = rate / 12;
  const n = amortYears * 12;
  const factor = (1 + monthlyRate) ** n;
  const monthly = loan * ((monthlyRate * factor) / (factor - 1));
  return monthly * 12;
}

export function calculateDscr(deal: DealPayload, debtRate = DEFAULT_DEBT_RATE): number {
  const noi = year1Noi(deal);
  const uw = underwriting(deal);
  const io = uw.interest_only ?? true;
  const amort = uw.amortization_years ?? 30;
  const ds = annualDebtService(loanAmount(deal), debtRate, io, amort);
  if (ds <= 0) return 0;
  return Math.round((noi / ds) * 10000) / 10000;
}

export function evaluateRentPremiumRisk(deal: DealPayload): RiskFlag | null {
  const proForma = proFormaRentGrowth(deal);
  const submarketAvg = submarketRentGrowthAvg(deal);
  const gap = Math.round((proForma - submarketAvg) * 100) / 100;
  const capexPresent = hasCapexBudget(deal);
  const submarketName = deal.market_context?.submarket ?? "the submarket";

  const metrics = {
    pro_forma_rent_growth_pct: proForma,
    submarket_rent_growth_avg_pct: submarketAvg,
    rent_growth_gap_pct: gap,
    capex_budget_present: capexPresent,
  };

  if (gap > RENT_GAP_CRITICAL_PCT && !capexPresent) {
    return {
      id: "rent_premium_critical",
      category: "Rent Premium Risk",
      severity: "Critical Risk",
      title: "Pro-forma rent growth far exceeds market with no renovation budget",
      justification: `The sponsor underwrites ${proForma.toFixed(1)}% annual rent growth, which is ${gap.toFixed(1)} percentage points above the ${submarketAvg.toFixed(1)}% historical 3-year average for ${submarketName}. This gap exceeds the ${RENT_GAP_CRITICAL_PCT.toFixed(0)}% critical threshold, and no interior CapEx budget was identified in the OM to support the assumed rent premiums.`,
      metrics,
    };
  }

  if (gap > RENT_GAP_MEDIUM_PCT) {
    const capexNote = capexPresent
      ? "An interior renovation budget is present in the OM, which partially mitigates execution risk."
      : "No interior CapEx budget was found; monitor for escalation if the rent growth gap widens further.";
    return {
      id: "rent_premium_medium",
      category: "Rent Premium Risk",
      severity: "Medium Risk",
      title: "Pro-forma rent growth exceeds submarket trend",
      justification: `The sponsor assumes ${proForma.toFixed(1)}% annual rent growth versus a ${submarketAvg.toFixed(1)}% historical 3-year submarket average in ${submarketName}, a gap of ${gap.toFixed(1)} percentage points, above the ${RENT_GAP_MEDIUM_PCT.toFixed(0)}% medium-risk threshold. ${capexNote}`,
      metrics,
    };
  }

  return null;
}

export function evaluateDscrRisk(deal: DealPayload, debtRate = DEFAULT_DEBT_RATE): RiskFlag | null {
  const dscr = calculateDscr(deal, debtRate);
  const noi = year1Noi(deal);
  const loan = loanAmount(deal);
  const uw = underwriting(deal);
  const io = uw.interest_only ?? true;
  const amort = uw.amortization_years ?? 30;
  const debtService = annualDebtService(loan, debtRate, io, amort);

  const metrics = {
    year_1_noi_usd: noi,
    loan_amount_usd: loan,
    debt_rate_pct: Math.round(debtRate * 1000) / 10,
    annual_debt_service_usd: Math.round(debtService * 100) / 100,
    dscr,
  };

  if (dscr < DSCR_CRITICAL_THRESHOLD) {
    return {
      id: "dscr_critical",
      category: "Financial Ratios",
      severity: "Critical Risk",
      title: "DSCR critically below lender covenant",
      justification: `Year-1 DSCR is ${dscr.toFixed(2)}x based on NOI of $${noi.toLocaleString()} and annual debt service of $${Math.round(debtService).toLocaleString()} ($${loan.toLocaleString()} loan at ${(debtRate * 100).toFixed(2)}% interest-only). This falls below the ${DSCR_CRITICAL_THRESHOLD.toFixed(2)}x critical threshold and well under the typical 1.25x agency covenant.`,
      metrics,
    };
  }

  if (dscr < DSCR_MEDIUM_THRESHOLD) {
    return {
      id: "dscr_medium",
      category: "Financial Ratios",
      severity: "Medium Risk",
      title: "DSCR below typical lender covenant",
      justification: `Year-1 DSCR is ${dscr.toFixed(2)}x based on NOI of $${noi.toLocaleString()} and annual debt service of $${Math.round(debtService).toLocaleString()} ($${loan.toLocaleString()} loan at ${(debtRate * 100).toFixed(2)}% interest-only). This is below the ${DSCR_MEDIUM_THRESHOLD.toFixed(2)}x medium-risk threshold commonly required by agency and CMBS lenders.`,
      metrics,
    };
  }

  return null;
}

export function evaluateVacancyDeltaRisk(deal: DealPayload): RiskFlag | null {
  const occData = deal.market_context?.submarket_occupancy;
  const changeBps = occData?.trailing_12mo_change_bps;
  if (changeBps == null) return null;

  const avgOcc = occData?.average_occupancy_pct ?? 0;
  const econVac = occData?.economic_vacancy_pct ?? 0;
  const pipeline =
    deal.market_context?.construction_pipeline?.summary?.delivering_through_2027_units ?? 0;
  const submarket = deal.market_context?.submarket ?? "the submarket";

  const metrics = {
    trailing_12mo_change_bps: changeBps,
    average_occupancy_pct: avgOcc,
    economic_vacancy_pct: econVac,
    pipeline_units_through_2027: pipeline,
  };

  if (changeBps <= VACANCY_DELTA_CRITICAL_BPS) {
    return {
      id: "vacancy_delta_critical",
      category: "Market Vacancy Delta",
      severity: "Critical Risk",
      title: "Submarket vacancy deteriorating at critical pace",
      justification: `${submarket} occupancy has declined ${Math.abs(changeBps)} bps over the trailing 12 months to ${avgOcc.toFixed(1)}%, with economic vacancy at ${econVac.toFixed(1)}%. ${pipeline.toLocaleString()} competing Class A units deliver through 2027, sustaining concession pressure. Occupancy erosion at this pace compresses effective rents and directly threatens NOI projections.`,
      metrics,
    };
  }

  if (changeBps <= VACANCY_DELTA_MEDIUM_BPS) {
    return {
      id: "vacancy_delta_medium",
      category: "Market Vacancy Delta",
      severity: "Medium Risk",
      title: "Submarket occupancy trending negative",
      justification: `${submarket} occupancy declined ${Math.abs(changeBps)} bps over the trailing 12 months to ${avgOcc.toFixed(1)}%. Monitor for acceleration — ${pipeline.toLocaleString()} units in the construction pipeline through 2027 will sustain concession pressure.`,
      metrics,
    };
  }

  return null;
}

export function evaluateRiskFlags(deal: DealPayload, debtRate = DEFAULT_DEBT_RATE): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const rent = evaluateRentPremiumRisk(deal);
  if (rent) flags.push(rent);
  const dscr = evaluateDscrRisk(deal, debtRate);
  if (dscr) flags.push(dscr);
  const vacancy = evaluateVacancyDeltaRisk(deal);
  if (vacancy) flags.push(vacancy);
  return flags;
}

export function scoreDeal(flags: RiskFlag[]): number {
  const deductions = flags.reduce((sum, f) => sum + (SEVERITY_DEDUCTIONS[f.severity] ?? 0), 0);
  return Math.max(0, 100 - deductions);
}

export function evaluateDeal(deal: DealPayload, debtRate = DEFAULT_DEBT_RATE): EnginePayload {
  const flags = evaluateRiskFlags(deal, debtRate);
  return { deal, flags, score: scoreDeal(flags) };
}
