/**
 * TypeScript mirror of backend/engine/negotiation_engine.py for client-side evaluation.
 *
 * Opportunities are derived from OM-stated CapEx line items and the same debt
 * math used by the risk rule engine — no invented building conditions.
 */

import {
  annualDebtService,
  calculateDscr,
  DEFAULT_DEBT_RATE,
  DSCR_MEDIUM_THRESHOLD,
  hasCapexBudget,
  loanAmount,
  year1Noi,
  type DealPayload,
} from "@/lib/risk-engine";

export interface NegotiationOpportunity {
  id: string;
  item: string;
  estimated_cost_usd: number;
  suggested_price_reduction_low_usd: number;
  suggested_price_reduction_high_usd: number;
  confidence_pct: number;
}

export interface NegotiationPayload {
  deal: DealPayload;
  opportunities: NegotiationOpportunity[];
}

function interiorRenovationOpportunity(deal: DealPayload): NegotiationOpportunity | null {
  if (!hasCapexBudget(deal)) return null;

  const capex = Math.abs(
    deal.financial_projections?.capital_expenditures?.interior_renovation_budget_usd ?? 0,
  );
  return {
    id: "interior_renovation_budget",
    item: "Interior renovation budget",
    estimated_cost_usd: Math.round(capex),
    suggested_price_reduction_low_usd: Math.round(capex * 0.7),
    suggested_price_reduction_high_usd: Math.round(capex * 1.0),
    confidence_pct: 95,
  };
}

function dscrShortfallOpportunity(
  deal: DealPayload,
  debtRate = DEFAULT_DEBT_RATE,
): NegotiationOpportunity | null {
  const dscr = calculateDscr(deal, debtRate);
  if (dscr >= DSCR_MEDIUM_THRESHOLD) return null;

  const noi = year1Noi(deal);
  const loan = loanAmount(deal);
  const currentDebtService = annualDebtService(loan, debtRate);
  const requiredDebtService = noi / DSCR_MEDIUM_THRESHOLD;
  const debtServiceGap = currentDebtService - requiredDebtService;
  const priceReduction = debtServiceGap / debtRate;

  return {
    id: "dscr_shortfall",
    item: `Price reduction to restore ${DSCR_MEDIUM_THRESHOLD.toFixed(2)}x DSCR covenant`,
    estimated_cost_usd: Math.round(debtServiceGap),
    suggested_price_reduction_low_usd: Math.round(priceReduction * 0.85),
    suggested_price_reduction_high_usd: Math.round(priceReduction * 1.05),
    confidence_pct: 90,
  };
}

/** Derive negotiation levers from deal payload (OM CapEx + debt math). */
export function estimateNegotiationOpportunities(
  deal: DealPayload,
  debtRate = DEFAULT_DEBT_RATE,
): NegotiationOpportunity[] {
  const opportunities: NegotiationOpportunity[] = [];

  const capexOpp = interiorRenovationOpportunity(deal);
  if (capexOpp) opportunities.push(capexOpp);

  const dscrOpp = dscrShortfallOpportunity(deal, debtRate);
  if (dscrOpp) opportunities.push(dscrOpp);

  return opportunities;
}

export function evaluateNegotiationOpportunities(
  deal: DealPayload,
  debtRate = DEFAULT_DEBT_RATE,
): NegotiationPayload {
  return {
    deal,
    opportunities: estimateNegotiationOpportunities(deal, debtRate),
  };
}
