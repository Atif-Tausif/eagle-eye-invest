import { createFileRoute } from "@tanstack/react-router";
import {
  evaluateRiskFlags,
  scoreDeal,
  calculateDscr,
  type DealPayload,
  type RiskFlag,
} from "@/lib/risk-engine";
import dealDataRaw from "../../../backend/data/current_deal.json";

const dealData = dealDataRaw as DealPayload;

const DEFAULT_DEBT_RATE = 0.096;
const DEFAULT_LOAN_AMOUNT_USD = 60_000_000;

function fmtUsd(v: number | null | undefined): string {
  if (v == null) return "N/A";
  return `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number | null | undefined, d = 1): string {
  if (v == null) return "N/A";
  return `${Number(v).toFixed(d)}%`;
}

function verdictFromScore(score: number): { label: string; color: string } {
  if (score < 35) return { label: "NO-GO", color: "#dc2626" };
  if (score < 65) return { label: "CAUTION", color: "#d97706" };
  return { label: "GO", color: "#16a34a" };
}

function buildMemoHtml(
  deal: DealPayload,
  flags: RiskFlag[],
  score: number,
  overrides: Record<string, unknown>,
): string {
  const meta = deal.property_metadata ?? {};
  const market = deal.market_context ?? {};
  const derived = deal.derived_metrics ?? {};
  const fins = deal.financial_projections ?? {};
  const occ = market.submarket_occupancy ?? {};
  const rent = market.rent_growth_trailing_3yr ?? {};
  const pipeline = market.construction_pipeline?.summary ?? {};

  const noi = fins.year_1?.net_operating_income_usd ?? 0;
  const reno = Math.abs(fins.capital_expenditures?.interior_renovation_budget_usd ?? 0);
  const loan = DEFAULT_LOAN_AMOUNT_USD;
  const dscr = calculateDscr(deal, DEFAULT_DEBT_RATE);
  const proForma = derived.pro_forma_rent_growth_pct ?? 5.8;
  const submktAvg = rent.trailing_3yr_cagr_pct ?? 0;
  const rentGap = Math.round((proForma - submktAvg) * 10) / 10;
  const pipelineUnits =
    pipeline.delivering_through_2027_units ?? pipeline.total_pipeline_units ?? 0;
  const submarket = market.submarket ?? "Submarket";
  const units = meta.unit_count ?? 0;

  const verdictOverride =
    typeof overrides.verdict === "string" ? overrides.verdict.toUpperCase() : null;
  const analystNotes = typeof overrides.analyst_notes === "string" ? overrides.analyst_notes : null;
  const { label: verdictLabel, color: verdictColor } = verdictOverride
    ? {
        label: verdictOverride,
        color:
          verdictOverride === "GO"
            ? "#16a34a"
            : verdictOverride === "NO-GO"
              ? "#dc2626"
              : "#d97706",
      }
    : verdictFromScore(score);

  const now = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const flagsHtml = flags.length
    ? flags
        .map(
          (f) => `
        <div style="margin:6px 0;padding:8px 12px;border-left:3px solid ${f.severity === "Critical Risk" ? "#dc2626" : "#d97706"};background:#fef2f2;border-radius:0 4px 4px 0;">
          <strong style="color:${f.severity === "Critical Risk" ? "#dc2626" : "#d97706"}">[${f.severity}]</strong>
          <strong> ${f.title}</strong><br/>
          <span style="font-size:13px;color:#475569">${f.justification}</span>
        </div>`,
        )
        .join("")
    : `<p style="color:#16a34a">No risk flags triggered.</p>`;

  const sections = [
    {
      title: "1. Demand Analysis",
      body: `${submarket} submarket fundamentals reflect ${fmtPct(occ.average_occupancy_pct)} average occupancy with economic vacancy at ${fmtPct(occ.economic_vacancy_pct)}. Trailing 12-month occupancy change of ${occ.trailing_12mo_change_bps ?? 0} bps signals ${(occ.trailing_12mo_change_bps ?? 0) < 0 ? "softening demand" : "stable absorption"}. The construction pipeline includes ${pipelineUnits.toLocaleString()} units delivering through 2027.`,
      metrics: [
        ["Submarket", submarket],
        ["Avg. Occupancy", fmtPct(occ.average_occupancy_pct)],
        ["Economic Vacancy", fmtPct(occ.economic_vacancy_pct)],
        ["T-12 Occ. Change", `${occ.trailing_12mo_change_bps ?? 0} bps`],
        ["Pipeline Units (2027)", pipelineUnits.toLocaleString()],
      ],
    },
    {
      title: "2. Financial Strength",
      body: `Year-1 NOI is ${fmtUsd(noi)} against assumed ${fmtUsd(loan)} senior debt. Pro-forma DSCR of ${dscr.toFixed(2)}x ${dscr < 1.25 ? "falls below" : "meets or exceeds"} the 1.25x agency covenant benchmark.${dscr < 1.15 ? " Critical refinance and covenant risk is present." : ""}`,
      metrics: [
        ["Year-1 NOI", fmtUsd(noi)],
        ["Loan Amount", fmtUsd(loan)],
        ["DSCR", `${dscr.toFixed(2)}x`],
        ["Debt Rate (assumed)", `${(DEFAULT_DEBT_RATE * 100).toFixed(2)}% IO`],
        ["Annual Debt Service", fmtUsd(loan * DEFAULT_DEBT_RATE)],
      ],
    },
    {
      title: "3. Operating Efficiency",
      body: `The ${units}-unit asset generates ${fmtUsd(derived.noi_per_unit_usd)} NOI per unit at Year 1. Net cash flow after interior renovation spend is ${fmtUsd(derived.net_cash_flow_after_capex_usd)}. Interior renovation is budgeted at ${fmtUsd(reno)} (${fmtUsd(derived.reno_cost_per_unit_usd)}/unit).`,
      metrics: [
        ["Unit Count", String(units)],
        ["NOI / Unit", fmtUsd(derived.noi_per_unit_usd)],
        ["Reno Budget / Unit", fmtUsd(derived.reno_cost_per_unit_usd)],
        ["Total Reno Budget", fmtUsd(reno)],
        ["Net CF After CapEx", fmtUsd(derived.net_cash_flow_after_capex_usd)],
      ],
    },
    {
      title: "4. Market Alignment",
      body: `Sponsor underwrites ${fmtPct(proForma)} annual rent growth versus a ${fmtPct(submktAvg)} historical 3-year submarket average — a gap of ${rentGap.toFixed(1)} percentage points. Trailing 12-month market rent growth is ${fmtPct(rent.trailing_12mo_pct)}. ${rentGap > 2 ? "Rent growth assumptions appear disconnected from submarket trends." : "Rent growth assumptions are broadly aligned with market history."}`,
      metrics: [
        ["Pro-forma Rent Growth", fmtPct(proForma)],
        ["Submarket 3-Yr Avg", fmtPct(submktAvg)],
        ["Rent Growth Gap", `${rentGap.toFixed(1)} pts`],
        ["T-12 Market Rent Growth", fmtPct(rent.trailing_12mo_pct)],
        ["3-Yr CAGR", fmtPct(rent.trailing_3yr_cagr_pct)],
      ],
    },
    {
      title: "5. Capital Position",
      body: `Capital stack assumes ${fmtUsd(loan)} debt financing on Year-1 NOI of ${fmtUsd(noi)}. Interior renovation capital of ${fmtUsd(reno)} (${fmtUsd(derived.reno_cost_per_unit_usd)}/unit) is ${reno ? "allocated in the OM" : "not identified in the OM"}. Post-renovation net cash flow of ${fmtUsd(derived.net_cash_flow_after_capex_usd)} defines the Year-1 capital position after value-add spend.`,
      metrics: [
        ["Senior Loan", fmtUsd(loan)],
        ["Interior Reno Budget", fmtUsd(reno)],
        ["Reno / Unit", fmtUsd(derived.reno_cost_per_unit_usd)],
        ["Year-1 NOI", fmtUsd(noi)],
        ["Net CF After CapEx", fmtUsd(derived.net_cash_flow_after_capex_usd)],
      ],
    },
  ];

  const sectionsHtml = sections
    .map(
      (sec) => `
    <div style="margin-top:32px;page-break-inside:avoid;">
      <h2 style="font-size:18px;color:#1e293b;border-bottom:2px solid #2563eb;padding-bottom:6px;margin-bottom:12px">${sec.title}</h2>
      <p style="font-size:13px;color:#1e293b;line-height:1.6;margin-bottom:14px">${sec.body}</p>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:8px">
        ${sec.metrics
          .map(
            ([k, v]) => `
          <tr>
            <td style="padding:6px 10px;background:#f8fafc;border:1px solid #e2e8f0;font-weight:600;color:#1e293b;width:38%">${k}</td>
            <td style="padding:6px 10px;background:#f8fafc;border:1px solid #e2e8f0;color:#475569">${v}</td>
          </tr>`,
          )
          .join("")}
      </table>
    </div>`,
    )
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>Investment Committee Memo</title>
<style>
  body{font-family:Helvetica,Arial,sans-serif;margin:0;padding:40px;color:#1e293b;background:#fff;max-width:800px;margin:0 auto}
  @media print{body{padding:20px}button{display:none}}
</style>
</head>
<body>
  <div style="text-align:right;margin-bottom:8px">
    <button onclick="window.print()" style="padding:8px 18px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px">Print / Save as PDF</button>
  </div>

  <div style="border-bottom:3px solid #1e293b;padding-bottom:20px;margin-bottom:24px">
    <p style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#475569;margin:0 0 6px">Investment Committee Memo</p>
    <h1 style="font-size:24px;margin:0 0 6px;color:#1e293b">${meta.property_name ?? "Multifamily Investment"}</h1>
    <p style="margin:0;color:#475569;font-size:13px">${meta.asset_type ?? "Multifamily"}  ·  ${units} units  ·  ${meta.location ?? ""}</p>
    <p style="margin:8px 0 0;color:#94a3b8;font-size:12px">Generated ${now}  ·  ${flags.length} risk flag${flags.length !== 1 ? "s" : ""} triggered  ·  MultifamilyIQ  |  Confidential</p>
  </div>

  <div style="text-align:center;margin:24px 0;padding:20px;border:2px solid ${verdictColor};border-radius:8px;background:${verdictColor}10">
    <div style="font-size:42px;font-weight:900;color:${verdictColor};letter-spacing:4px">${verdictLabel}</div>
    <div style="font-size:15px;color:#475569;margin-top:4px">Composite Risk Score: ${score}/100</div>
  </div>

  ${analystNotes ? `<div style="margin:16px 0;padding:12px 16px;background:#eff6ff;border-left:4px solid #2563eb;border-radius:0 6px 6px 0"><strong style="color:#2563eb;font-size:12px">ANALYST NOTES</strong><p style="margin:6px 0 0;font-style:italic;color:#475569;font-size:13px">${analystNotes}</p></div>` : ""}

  <div style="margin-top:24px">
    <h2 style="font-size:16px;color:#1e293b;margin-bottom:10px">Executive Risk Summary</h2>
    ${flagsHtml}
  </div>

  ${sectionsHtml}

  <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center">
    MultifamilyIQ  ·  Confidential  ·  ${meta.property_name ?? ""}
  </div>
</body>
</html>`;
}

export const Route = createFileRoute("/api/export-memo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const overrides: Record<string, unknown> = await request.json().catch(() => ({}));
          const flags = evaluateRiskFlags(dealData, DEFAULT_DEBT_RATE);
          const score = scoreDeal(flags);
          const html = buildMemoHtml(dealData, flags, score, overrides);

          return new Response(html, {
            headers: {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to generate memo";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
