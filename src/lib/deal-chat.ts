import { calculateDscr, type EnginePayload, type RiskFlag } from "@/lib/risk-engine";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTED_PROMPTS = [
  "What worries you the most?",
  "Explain DSCR",
  "What if occupancy falls to 88%?",
  "Summarize this OM",
  "Could I negotiate?",
  "What should I verify during due diligence?",
] as const;

export { SUGGESTED_PROMPTS };

function criticalFlags(flags: RiskFlag[]): RiskFlag[] {
  return flags.filter((f) => f.severity === "Critical Risk");
}

function topConcern(payload: EnginePayload): string {
  const { deal, flags, score } = payload;
  const critical = criticalFlags(flags);
  const dscr = calculateDscr(deal);
  const submarket = deal.market_context?.submarket ?? "the submarket";
  const pipeline =
    deal.market_context?.construction_pipeline?.summary?.delivering_through_2027_units ?? 0;

  if (critical.length === 0) {
    return `With a risk score of ${score}/100, nothing is flashing critical — but I'd still watch underwriting assumptions closely. The composite score reflects ${flags.length} active flag${flags.length === 1 ? "" : "s"} across rent growth, coverage, and market vacancy.`;
  }

  const lead = critical[0];
  const others = critical.slice(1).map((f) => f.title.toLowerCase());

  let body = `**${lead.title}** is my top concern. ${lead.justification}`;

  if (dscr < 1.15) {
    body += `\n\nYear-1 DSCR at ${dscr.toFixed(2)}x is the structural issue — refinance and covenant compliance are on the clock if NOI slips even slightly.`;
  }

  if (pipeline > 0) {
    body += `\n\nSupply makes this worse: ${pipeline.toLocaleString()} Class A units deliver in ${submarket} through 2027, which supports concession pressure and makes rent-premium underwriting harder to defend.`;
  }

  if (others.length) {
    body += `\n\nAlso on my radar: ${others.join("; ")}.`;
  }

  return body;
}

function explainDscr(payload: EnginePayload): string {
  const { deal } = payload;
  const dscr = calculateDscr(deal);
  const noi = deal.financial_projections?.year_1?.net_operating_income_usd ?? 0;
  const loan = deal.underwriting_assumptions?.loan_amount_usd ?? 60_000_000;
  const debtService = Math.round(loan * 0.096);

  return `**DSCR (Debt Service Coverage Ratio)** measures whether NOI covers annual debt payments. Lenders typically want **≥ 1.25x** for agency/CMBS paper.

**Formula:** Year-1 NOI ÷ Annual Debt Service

**This deal:**
• Year-1 NOI: **$${noi.toLocaleString()}**
• Assumed loan: **$${loan.toLocaleString()}** at 9.6% interest-only
• Annual debt service: **~$${debtService.toLocaleString()}**
• **DSCR: ${dscr.toFixed(2)}x**

At ${dscr.toFixed(2)}x, coverage is **below** the 1.25x covenant most lenders require. A +100 bps rate move or modest NOI miss would push DSCR toward breakeven — that's why it drives the risk score.`;
}

function occupancyScenario(payload: EnginePayload, targetPct = 88): string {
  const { deal } = payload;
  const noi = deal.financial_projections?.year_1?.net_operating_income_usd ?? 0;
  const currentOcc = deal.market_context?.submarket_occupancy?.average_occupancy_pct ?? 91.6;
  const units = deal.property_metadata?.unit_count ?? 344;
  const dscr = calculateDscr(deal);
  const loan = deal.underwriting_assumptions?.loan_amount_usd ?? 60_000_000;
  const debtService = loan * 0.096;

  const ratio = targetPct / currentOcc;
  const adjustedNoi = Math.round(noi * ratio);
  const adjustedDscr = Math.round((adjustedNoi / debtService) * 100) / 100;
  const noiDelta = adjustedNoi - noi;
  const vacantUnits = Math.round(units * (1 - targetPct / 100));

  return `**Stress test: ${targetPct}% occupancy** (vs ${currentOcc.toFixed(1)}% submarket average today)

If effective occupancy compresses to **${targetPct}%**, assuming revenue scales roughly with occupancy:
• Year-1 NOI moves from **$${noi.toLocaleString()}** → **~$${adjustedNoi.toLocaleString()}** (${noiDelta >= 0 ? "+" : ""}$${noiDelta.toLocaleString()})
• DSCR falls from **${dscr.toFixed(2)}x** → **~${adjustedDscr.toFixed(2)}x**
• Roughly **${vacantUnits} units** economically vacant on a ${units}-unit base

At ${adjustedDscr.toFixed(2)}x, you'd likely **fail lender covenants** and lose refinancing optionality in Year 3. With ${deal.market_context?.construction_pipeline?.summary?.delivering_through_2027_units?.toLocaleString() ?? "1,840"} units delivering nearby, an ${targetPct}% scenario isn't far-fetched — it's a reasonable downside case for IC discussion.`;
}

function summarizeOm(payload: EnginePayload): string {
  const { deal, flags, score } = payload;
  const meta = deal.property_metadata;
  const noi = deal.financial_projections?.year_1?.net_operating_income_usd ?? 0;
  const reno = Math.abs(
    deal.financial_projections?.capital_expenditures?.interior_renovation_budget_usd ?? 0,
  );
  const renoPerUnit = deal.derived_metrics?.reno_cost_per_unit_usd ?? 0;
  const submarket = deal.market_context?.submarket ?? "—";
  const rentCagr = deal.market_context?.rent_growth_trailing_3yr?.trailing_3yr_cagr_pct ?? 0;
  const occ = deal.market_context?.submarket_occupancy?.average_occupancy_pct ?? 0;
  const pipeline =
    deal.market_context?.construction_pipeline?.summary?.delivering_through_2027_units ?? 0;

  return `**OM snapshot — ${meta?.property_name ?? "Current deal"}**

**Asset:** ${meta?.unit_count ?? "—"}-unit ${meta?.asset_type?.toLowerCase() ?? "multifamily"} in ${meta?.location ?? "—"} (${submarket} submarket)

**Underwriting (Year 1):**
• NOI: **$${noi.toLocaleString()}** (~$${Math.round(deal.derived_metrics?.noi_per_unit_usd ?? 0).toLocaleString()}/unit)
• Interior renovation: **$${reno.toLocaleString()}** (~$${Math.round(renoPerUnit).toLocaleString()}/unit)
• Net cash flow after CapEx: **$${(deal.derived_metrics?.net_cash_flow_after_capex_usd ?? 0).toLocaleString()}**

**Market context:**
• Submarket occupancy: **${occ.toFixed(1)}%** (↓${Math.abs(deal.market_context?.submarket_occupancy?.trailing_12mo_change_bps ?? 0)} bps T-12)
• 3-yr rent growth CAGR: **${rentCagr.toFixed(1)}%**
• Pipeline through 2027: **${pipeline.toLocaleString()} units**

**Agent read:** Risk score **${score}/100** with **${flags.length} flags** (${criticalFlags(flags).length} critical). Value-add thesis depends on rent premiums in a softening submarket with heavy supply — execution and refinance risk are the through-line.`;
}

function negotiateAdvice(payload: EnginePayload): string {
  const { deal, flags, score } = payload;
  const dscr = calculateDscr(deal);
  const rentFlag = flags.find((f) => f.id.startsWith("rent"));
  const gap =
    (rentFlag?.metrics.rent_growth_gap_pct as number | undefined) ??
    (deal.underwriting_assumptions?.pro_forma_rent_growth_pct ?? 5.8) -
      (deal.market_context?.rent_growth_trailing_3yr?.trailing_3yr_cagr_pct ?? 2.9);

  return `**Yes — you have leverage.** A ${score}/100 risk score and ${flags.length} active flags give you a factual basis to push back.

**Price / cap rate:** DSCR at ${dscr.toFixed(2)}x means the seller's pro-forma doesn't support agency debt at current pricing. Ask for **5–8% price reduction** or seller credit toward CapEx/reserves.

**Rent growth:** Pro-forma assumes ~${(rentFlag?.metrics.pro_forma_rent_growth_pct as number | undefined)?.toFixed(1) ?? "5.8"}% growth vs ${(rentFlag?.metrics.submarket_rent_growth_avg_pct as number | undefined)?.toFixed(1) ?? "2.9"}% submarket trend (${gap.toFixed(1)} pp gap). Negotiate a **lower exit cap** or **haircut the rent ramp** in your model.

**Structure:** Request **GP co-invest ≥ 10%**, pref bump, or **earn-out tied to stabilized occupancy** given ${deal.market_context?.construction_pipeline?.summary?.delivering_through_2027_units?.toLocaleString() ?? "1,840"} units of competing supply.

**Timing:** Submarket occupancy down ${Math.abs(deal.market_context?.submarket_occupancy?.trailing_12mo_change_bps ?? 110)} bps T-12 — use market softness to justify **longer DD**, **free look**, or **seller-paid third-party reports**.`;
}

function dueDiligenceChecklist(payload: EnginePayload): string {
  const { deal, flags } = payload;
  const items = [
    "**T-12 & rent roll:** Reconcile parsed NOI ($" +
      (deal.financial_projections?.year_1?.net_operating_income_usd ?? 0).toLocaleString() +
      ") to source — verify loss-to-lease, concessions, and bad debt.",
    "**Renovation scope:** Validate $" +
      Math.round(deal.derived_metrics?.reno_cost_per_unit_usd ?? 0).toLocaleString() +
      "/unit interior budget supports underwritten rent premiums.",
    "**Debt terms:** Confirm IO period, rate cap, and DSCR covenants — model refi in Year 3 at +100 bps.",
    "**Market survey:** Drive comps within 3-mile radius; compare effective rents vs OM pro-forma.",
    "**Pipeline verification:** Field-check the " +
      (deal.market_context?.construction_pipeline?.summary?.project_count ?? 7) +
      " projects listed (" +
      (deal.market_context?.construction_pipeline?.summary?.delivering_through_2027_units?.toLocaleString() ??
        "1,840") +
      " units through 2027).",
    "**Physical condition:** Phase I/II environmental, roof/HVAC capex reserve, unit-level renovation status.",
    "**Sponsor track record:** Request prior deal IRRs, capital call history, and property management transition plan.",
  ];

  for (const flag of flags) {
    items.push(
      `**Flag follow-up (${flag.severity}):** ${flag.title} — ${flag.justification.split(".")[0]}.`,
    );
  }

  return `**Due diligence priorities for this deal:**\n\n${items.map((item, i) => `${i + 1}. ${item}`).join("\n\n")}`;
}

function matchIntent(message: string): string | null {
  const m = message.toLowerCase();

  if (/worry|concern|worried|biggest risk|red flag/.test(m)) return "worries";
  if (/dscr|debt service|coverage ratio/.test(m)) return "dscr";
  if (/occupancy|88%|vacancy|vacant/.test(m)) return "occupancy";
  if (/summarize|summary|om|offering memorandum|overview/.test(m)) return "summary";
  if (/negotiat|leverage|push back|price reduction|deal terms/.test(m)) return "negotiate";
  if (/due diligence|verify|dd|diligence|checklist|confirm/.test(m)) return "dd";
  if (/score|risk score|verdict|go or no/.test(m)) return "score";
  if (/rent growth|pro-forma|pro forma/.test(m)) return "rent";
  if (/pipeline|supply|construction|competing/.test(m)) return "supply";

  return null;
}

function scoreReply(payload: EnginePayload): string {
  const { score, flags } = payload;
  const verdict = score < 35 ? "NO-GO" : score < 65 ? "CAUTION" : "GO";
  return `**Risk score: ${score}/100 → ${verdict}**

Deductions come from ${flags.length} rule-engine flags (${criticalFlags(flags).length} critical, ${flags.filter((f) => f.severity === "Medium Risk").length} medium). Each critical flag costs 35 points; each medium costs 20.

${topConcern(payload)}`;
}

function rentReply(payload: EnginePayload): string {
  const flag = payload.flags.find((f) => f.id.startsWith("rent"));
  if (flag) return `**Rent growth risk:** ${flag.justification}`;
  const submarket = payload.deal.market_context?.submarket ?? "submarket";
  const cagr = payload.deal.market_context?.rent_growth_trailing_3yr?.trailing_3yr_cagr_pct ?? 0;
  return `Pro-forma rent growth appears aligned with ${submarket}'s ${cagr.toFixed(1)}% trailing 3-year CAGR — no rent-premium flag triggered at current thresholds.`;
}

function supplyReply(payload: EnginePayload): string {
  const pipeline = payload.deal.market_context?.construction_pipeline;
  if (!pipeline) return "No construction pipeline data is loaded for this deal.";
  const projects = pipeline.projects ?? [];
  const list = projects
    .slice(0, 4)
    .map(
      (p) =>
        `• **${p.project_name}** — ${p.units} units, ${p.status.replace(/_/g, " ")}, ${p.expected_delivery}`,
    )
    .join("\n");
  return `**Supply pipeline (${pipeline.submarket}):** ${pipeline.summary?.delivering_through_2027_units?.toLocaleString() ?? "—"} units delivering through 2027 across ${pipeline.summary?.project_count ?? projects.length} projects.

${list}

This level of Class A delivery supports the occupancy deterioration flag and limits pricing power on renovated units.`;
}

function fallbackReply(payload: EnginePayload, message: string): string {
  return `I can help analyze **${payload.deal.property_metadata?.property_name ?? "this deal"}** using live risk-engine data.

Try asking about:
• Top risks and DSCR coverage
• Occupancy stress scenarios
• OM summary and negotiation leverage
• Due diligence checklist items

Your question: "${message}" — I don't have a specific template for that yet, but the deal has **${payload.flags.length} flags** and a **${payload.score}/100** risk score. Ask me to explain any metric on the dashboard.`;
}

export function generateChatReply(payload: EnginePayload, message: string): string {
  const trimmed = message.trim();
  if (!trimmed) {
    return "Ask me anything about this deal — try one of the suggested prompts below.";
  }

  const intent = matchIntent(trimmed);

  switch (intent) {
    case "worries":
      return topConcern(payload);
    case "dscr":
      return explainDscr(payload);
    case "occupancy": {
      const pctMatch = trimmed.match(/(\d{2,3})\s*%/);
      const target = pctMatch ? Number(pctMatch[1]) : 88;
      return occupancyScenario(payload, target);
    }
    case "summary":
      return summarizeOm(payload);
    case "negotiate":
      return negotiateAdvice(payload);
    case "dd":
      return dueDiligenceChecklist(payload);
    case "score":
      return scoreReply(payload);
    case "rent":
      return rentReply(payload);
    case "supply":
      return supplyReply(payload);
    default:
      return fallbackReply(payload, trimmed);
  }
}
