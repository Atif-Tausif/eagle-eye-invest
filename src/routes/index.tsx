import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Upload,
  ArrowRight,
  AlertTriangle,
  AlertOctagon,
  TrendingUp,
  TrendingDown,
  Percent,
  DollarSign,
  Building2,
  Wrench,
  ChevronDown,
  ChevronRight,
  FileText,
  Bookmark,
  GitCompare,
  ShieldAlert,
  Flag,
  Activity,
} from "lucide-react";
import { DealAiChat } from "@/components/deal-ai-chat";
import { NegotiationOpportunities } from "@/components/negotiation-opportunities";
import type { DealPayload, EnginePayload, RiskFlag } from "@/lib/risk-engine";
import {
  evaluateNegotiationOpportunities,
  type NegotiationOpportunity,
} from "@/lib/negotiation-engine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MultifamilyIQ — Deal Analysis Agent" },
      { name: "description", content: "AI-powered multifamily CRE deal screening with risk scoring, flag detection, and instant deal memos." },
      { property: "og:title", content: "MultifamilyIQ — Deal Analysis Agent" },
      { property: "og:description", content: "AI-powered multifamily CRE deal screening with risk scoring, flag detection, and instant deal memos." },
    ],
  }),
  component: Dashboard,
});

type MetricKey = "occupancy" | "dscr" | "expense" | "rent" | "vacancy" | "capex";
type MetricStatus = "good" | "warn" | "bad";
type FlagSeverity = "high" | "med" | "low";

interface MetricCard {
  key: MetricKey;
  label: string;
  value: string;
  delta: string;
  status: MetricStatus;
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
}

interface UiFlag {
  id: string;
  severity: FlagSeverity;
  title: string;
  body: string;
  linkedMetric: MetricKey;
}

const MEMO_SECTIONS: Array<{ key: string; label: string; body: string }> = [
  { key: "demand", label: "Demand Analysis",
    body: "Submarket demand fundamentals are mixed. Population growth of 1.4% CAGR and renter HH formation of 1.1% support absorption, but 1,840 competing Class A units in lease-up by 2027 will pressure rent growth and concessions for the next 24 months. Drive-time employment within 15 minutes shows healthy diversity (healthcare 22%, logistics 18%, education 12%), though wage growth is decelerating." },
  { key: "financial", label: "Financial Strength",
    body: "Underwriting fails covenant stress. Year-1 DSCR of 1.08x sits well below the agency 1.25x minimum and breaks to 0.94x under a +100bps rate shock. Yield-on-cost of 5.3% provides only 40bps of spread over the prevailing 4.9% market cap rate — below the 100bps threshold typical for value-add execution risk." },
  { key: "risks", label: "Key Risks",
    body: "(1) Refinance risk in Year 3 given covenant gap. (2) Rent growth assumption disconnected from submarket reality (5.8% UW vs 2.1% trend). (3) CapEx budget insufficient to deliver underwritten premiums. (4) Operational drag in payroll and R&M suggests management transition execution risk." },
  { key: "sponsor", label: "Sponsor & Structure",
    body: "Sponsor has executed 6 prior value-add deals in adjacent submarkets with a 1.9x equity multiple track record. However, two of the last three deals required capital calls. Proposed GP co-invest of 8% is below the 10% threshold typically required for this risk profile. Promote structure (8% pref, 70/30 above) is market." },
  { key: "exit", label: "Exit Strategy",
    body: "Year-5 exit underwritten at a 5.25% cap on stabilized NOI, representing 35bps of cap compression from entry. Given supply pipeline and interest rate forward curve, a flat-to-25bps decompression scenario is more defensible, which compresses the IRR from 16.4% UW to ~9.8% — below typical LP return thresholds for value-add multifamily." },
];

function flagSeverity(severity: RiskFlag["severity"]): FlagSeverity {
  if (severity === "Critical Risk") return "high";
  if (severity === "Medium Risk") return "med";
  return "low";
}

function linkedMetricForFlag(flag: RiskFlag): MetricKey {
  if (flag.id.startsWith("dscr")) return "dscr";
  if (flag.id.startsWith("rent")) return "rent";
  if (flag.id.startsWith("vacancy")) return "vacancy";
  return "dscr";
}

function buildMetrics(payload: EnginePayload): MetricCard[] {
  const { deal } = payload;
  const dscrFlag = payload.flags.find((f) => f.id.startsWith("dscr"));
  const rentFlag = payload.flags.find((f) => f.id.startsWith("rent"));
  const dscr = (dscrFlag?.metrics.dscr as number | undefined) ?? 0;
  const proForma = (rentFlag?.metrics.pro_forma_rent_growth_pct as number | undefined) ?? 5.8;
  const submarketRent = (rentFlag?.metrics.submarket_rent_growth_avg_pct as number | undefined)
    ?? deal.market_context?.rent_growth_trailing_3yr?.trailing_3yr_cagr_pct
    ?? 0;

  const occupancy = deal.market_context?.submarket_occupancy?.average_occupancy_pct ?? 0;
  const occChangeBps = deal.market_context?.submarket_occupancy?.trailing_12mo_change_bps ?? 0;
  const economicVacancy = deal.market_context?.submarket_occupancy?.economic_vacancy_pct ?? 0;
  const pipelineUnits =
    deal.market_context?.construction_pipeline?.summary?.delivering_through_2027_units ?? 0;
  const renoPerUnit = deal.derived_metrics?.reno_cost_per_unit_usd ?? 0;
  const noiPerUnit = deal.derived_metrics?.noi_per_unit_usd ?? 0;
  const netCfAfterCapex = deal.derived_metrics?.net_cash_flow_after_capex_usd ?? 0;

  const dscrStatus: MetricStatus =
    dscr < 1.15 ? "bad" : dscr < 1.25 ? "warn" : "good";
  const rentGap = proForma - submarketRent;
  const rentStatus: MetricStatus =
    rentGap > 4 ? "bad" : rentGap > 2 ? "warn" : "good";
  const occStatus: MetricStatus = occChangeBps < -50 ? "warn" : "good";
  const vacancyStatus: MetricStatus =
    occChangeBps <= -100 ? "bad" : occChangeBps < -50 ? "warn" : "good";

  return [
    {
      key: "occupancy",
      label: "Occupancy",
      value: `${occupancy.toFixed(1)}%`,
      delta: `${occChangeBps >= 0 ? "+" : ""}${(occChangeBps / 100).toFixed(1)}% T-12 submarket`,
      status: occStatus,
      icon: Building2,
      detail: `Submarket average occupancy is ${occupancy.toFixed(1)}% (${submarketName(deal)}). Trailing 12-month change of ${occChangeBps} bps reflects concession pressure and new supply deliveries.`,
    },
    {
      key: "dscr",
      label: "DSCR",
      value: `${dscr.toFixed(2)}x`,
      delta: dscr < 1.25 ? "Below 1.25x covenant" : "Above covenant",
      status: dscrStatus,
      icon: Activity,
      detail: dscrFlag?.justification
        ?? `Year-1 DSCR of ${dscr.toFixed(2)}x computed from parsed NOI of $${year1Noi(deal).toLocaleString()}.`,
    },
    {
      key: "expense",
      label: "NOI / Unit",
      value: noiPerUnit ? `$${Math.round(noiPerUnit).toLocaleString()}` : "—",
      delta: netCfAfterCapex
        ? `$${Math.round(netCfAfterCapex / 1_000_000).toFixed(2)}M after CapEx`
        : "Net CF after CapEx",
      status: "good",
      icon: Percent,
      detail: `Year-1 NOI per unit is $${Math.round(noiPerUnit).toLocaleString()} across ${deal.property_metadata?.unit_count ?? "—"} units. Net cash flow after interior renovation budget is $${netCfAfterCapex.toLocaleString()}.`,
    },
    {
      key: "rent",
      label: "Rent Growth Pro-forma",
      value: `${proForma.toFixed(1)}% / yr`,
      delta: `Submarket avg: ${submarketRent.toFixed(1)}%`,
      status: rentStatus,
      icon: TrendingUp,
      detail: rentFlag?.justification
        ?? `Pro-forma rent growth of ${proForma.toFixed(1)}% vs ${submarketRent.toFixed(1)}% submarket 3-year average.`,
    },
    {
      key: "vacancy",
      label: "Economic Vacancy",
      value: `${economicVacancy.toFixed(1)}%`,
      delta: pipelineUnits ? `${pipelineUnits.toLocaleString()} units by 2027` : "Pipeline pressure",
      status: vacancyStatus,
      icon: TrendingDown,
      detail: `Submarket economic vacancy is ${economicVacancy.toFixed(1)}%. ${pipelineUnits.toLocaleString()} competing units are in the construction pipeline through 2027, pressuring rent growth and concessions.`,
    },
    {
      key: "capex",
      label: "CapEx Budget",
      value: renoPerUnit ? `$${(renoPerUnit / 1000).toFixed(1)}K / unit` : "—",
      delta: renoPerUnit ? "Interior renovation scope" : "Not parsed",
      status: renoPerUnit > 0 ? "warn" : "bad",
      icon: Wrench,
      detail: `Interior renovation budget of $${Math.abs(deal.financial_projections?.capital_expenditures?.interior_renovation_budget_usd ?? 0).toLocaleString()} ($${Math.round(renoPerUnit).toLocaleString()}/unit) sourced from OM financial projections.`,
    },
  ];
}

function buildUiFlags(flags: RiskFlag[]): UiFlag[] {
  return flags.map((f) => ({
    id: f.id,
    severity: flagSeverity(f.severity),
    title: f.title,
    body: f.justification,
    linkedMetric: linkedMetricForFlag(f),
  }));
}

function submarketName(deal: DealPayload): string {
  return deal.market_context?.submarket ?? "submarket";
}

function year1Noi(deal: DealPayload): number {
  return deal.financial_projections?.year_1?.net_operating_income_usd ?? 0;
}

function verdictLabel(score: number): { label: string; tone: "destructive" | "warning" | "success" } {
  if (score < 35) return { label: "NO-GO", tone: "destructive" };
  if (score < 65) return { label: "CAUTION", tone: "warning" };
  return { label: "GO", tone: "success" };
}

function countFlags(flags: UiFlag[], severity: FlagSeverity): number {
  return flags.filter((f) => f.severity === severity).length;
}

function Dashboard() {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("dscr");
  const [selectedFlag, setSelectedFlag] = useState<string>("");
  const [whyNotOpen, setWhyNotOpen] = useState(true);
  const [activeMemo, setActiveMemo] = useState<string>("financial");
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<string[]>([]);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [engine, setEngine] = useState<EnginePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [analystNotes, setAnalystNotes] = useState("");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [selectedNegotiation, setSelectedNegotiation] = useState<string>("");

  const loadDeal = useCallback(async () => {
    setLoading(true);
    setFetchError(null);
    try {
      const res = await fetch("/api/deal");
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Failed to load deal (${res.status})`);
      }
      const data = (await res.json()) as EnginePayload;
      setEngine(data);
      if (data.flags.length) setSelectedFlag(data.flags[0].id);
      const negotiation = evaluateNegotiationOpportunities(data.deal);
      if (negotiation.opportunities.length) {
        setSelectedNegotiation(negotiation.opportunities[0].id);
      }
      const pdfName = data.deal.source_pdf?.split(/[/\\]/).pop();
      if (pdfName) setFiles([pdfName]);
    } catch (err) {
      setFetchError(err instanceof Error ? err.message : "Failed to load deal payload");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDeal();
  }, [loadDeal]);

  const analyzeDeal = useCallback(async () => {
    if (!pendingFile) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const formData = new FormData();
      formData.append("file", pendingFile);
      const res = await fetch("/api/upload-om", { method: "POST", body: formData });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Failed to analyze deal (${res.status})`);
      }
      await loadDeal();
      setPendingFile(null);
    } catch (err) {
      setAnalyzeError(err instanceof Error ? err.message : "Failed to analyze deal");
    } finally {
      setAnalyzing(false);
    }
  }, [pendingFile, loadDeal]);

  const metrics = useMemo(() => (engine ? buildMetrics(engine) : []), [engine]);
  const uiFlags = useMemo(() => (engine ? buildUiFlags(engine.flags) : []), [engine]);
  const negotiationOpportunities = useMemo<NegotiationOpportunity[]>(
    () => (engine ? evaluateNegotiationOpportunities(engine.deal).opportunities : []),
    [engine],
  );
  const ruleJustifications = useMemo(
    () => engine?.flags.map((f) => f.justification) ?? [],
    [engine],
  );
  const score = engine?.score ?? 0;
  const verdict = verdictLabel(score);

  const activeMetric = metrics.find((m) => m.key === selectedMetric) ?? metrics[0];
  const activeFlag = uiFlags.find((f) => f.id === selectedFlag) ?? uiFlags[0];
  const activeMemoSection = MEMO_SECTIONS.find((m) => m.key === activeMemo)!;

  const dealTitle = engine?.deal.property_metadata?.property_name ?? "Loading deal…";
  const unitCount = engine?.deal.property_metadata?.unit_count;
  const location = engine?.deal.property_metadata?.location ?? "";
  const submarket = engine?.deal.market_context?.submarket ?? "";

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files);
    const pdf = dropped.find((f) => f.name.toLowerCase().endsWith(".pdf"));
    setAnalyzeError(null);
    if (pdf) {
      setPendingFile(pdf);
      setFiles((prev) => [...prev, pdf.name]);
    } else if (dropped.length) {
      setAnalyzeError("Only PDF Offering Memoranda are supported right now");
    }
  }, []);

  const exportMemo = useCallback(async () => {
    setExporting(true);
    setExportError(null);
    try {
      const body: Record<string, unknown> = {};
      if (analystNotes.trim()) body.analyst_notes = analystNotes.trim();

      const res = await fetch("/api/export-memo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? `Export failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "deal-memo.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Export failed");
    } finally {
      setExporting(false);
    }
  }, [analystNotes]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-muted-foreground">
        Loading live deal engine…
      </div>
    );
  }

  if (fetchError || !engine) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-destructive">
        {fetchError ?? "Deal payload unavailable"}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-border bg-panel/80 backdrop-blur">
        <div className="flex h-14 items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/15 ring-1 ring-primary/30">
              <Building2 className="h-4 w-4 text-primary" />
            </div>
            <div className="flex items-baseline gap-2">
              <h1 className="text-sm font-semibold tracking-tight">MultifamilyIQ</h1>
              <span className="text-xs text-muted-foreground">— Deal Analysis Agent</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <span className="hidden sm:inline">
              Deal:{" "}
              <span className="text-foreground">
                {dealTitle.length > 48 ? `${dealTitle.slice(0, 48)}…` : dealTitle}
                {unitCount ? ` · ${unitCount} units` : ""}
                {location ? ` · ${location}` : submarket ? ` · ${submarket}` : ""}
              </span>
            </span>
            <span className="inline-flex h-2 w-2 rounded-full bg-success" />
            <span>Agent active</span>
          </div>
        </div>
      </header>

      <main className="grid grid-cols-12 gap-4 p-4">
        {/* Sidebar — Deal Ingestion Hub */}
        <aside className="col-span-12 lg:col-span-3">
          <section className="rounded-xl border border-border bg-panel p-4">
            <div className="mb-3 flex items-center gap-2">
              <Upload className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Deal Ingestion Hub</h2>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              className={`rounded-lg border-2 border-dashed p-6 text-center transition ${dragOver ? "border-primary bg-primary/10" : "border-border bg-background/50"}`}
            >
              <Upload className="mx-auto mb-2 h-6 w-6 text-muted-foreground" />
              <p className="text-xs font-medium">Drop an Offering Memorandum</p>
              <p className="mt-1 text-[11px] text-muted-foreground">PDF only, up to 50 MB</p>
            </div>

            <ul className="mt-3 space-y-1.5">
              {files.map((f) => (
                <li key={f} className="flex items-center gap-2 rounded-md bg-elevated px-2.5 py-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{f}</span>
                </li>
              ))}
            </ul>

            {analyzeError && (
              <p className="mt-2 text-[11px] text-destructive">{analyzeError}</p>
            )}

            <button
              onClick={analyzeDeal}
              disabled={!pendingFile || analyzing}
              className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {analyzing ? "Analyzing…" : "Analyze Deal"} <ArrowRight className="h-4 w-4" />
            </button>

            <div className="mt-4 space-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <div className="flex justify-between"><span>Flags triggered</span><span className="text-foreground">{uiFlags.length}</span></div>
              <div className="flex justify-between"><span>Risk score</span><span className="text-foreground">{score}/100</span></div>
              <div className="flex justify-between"><span>Data as of</span><span className="text-foreground">{engine.deal.merged_at?.slice(0, 10) ?? "—"}</span></div>
            </div>
          </section>
        </aside>

        {/* Center metrics + Flag Feed */}
        <section className="col-span-12 lg:col-span-6 space-y-4">
          {/* Metric grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {metrics.map((m) => {
              const Icon = m.icon;
              const active = selectedMetric === m.key;
              const statusColor =
                m.status === "good" ? "text-success" : m.status === "warn" ? "text-warning" : "text-destructive";
              return (
                <button
                  key={m.key}
                  onClick={() => setSelectedMetric(m.key)}
                  className={`group rounded-xl border bg-panel p-3 text-left transition hover:bg-elevated ${active ? "border-primary ring-1 ring-primary/40" : "border-border"}`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{m.label}</span>
                    <Icon className={`h-3.5 w-3.5 ${statusColor}`} />
                  </div>
                  <div className="mt-2 text-xl font-semibold">{m.value}</div>
                  <div className={`mt-0.5 text-[11px] ${statusColor}`}>{m.delta}</div>
                </button>
              );
            })}
          </div>

          {/* Flag Feed + Negotiation Opportunities */}
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-panel">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Flag className="h-4 w-4 text-warning" />
                  <h2 className="text-sm font-semibold">Flag Feed</h2>
                  {countFlags(uiFlags, "high") > 0 && (
                    <span className="ml-2 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">
                      {countFlags(uiFlags, "high")} High
                    </span>
                  )}
                  {countFlags(uiFlags, "med") > 0 && (
                    <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                      {countFlags(uiFlags, "med")} Med
                    </span>
                  )}
                  {countFlags(uiFlags, "low") > 0 && (
                    <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-medium text-info">
                      {countFlags(uiFlags, "low")} Low
                    </span>
                  )}
                </div>
                <span className="text-[11px] text-muted-foreground">Live</span>
              </div>
              <ul className="divide-y divide-border">
                {uiFlags.map((f) => {
                  const active = selectedFlag === f.id;
                  const sev =
                    f.severity === "high" ? { c: "text-destructive", bg: "bg-destructive/15", label: "HIGH" }
                    : f.severity === "med" ? { c: "text-warning", bg: "bg-warning/15", label: "MED" }
                    : { c: "text-info", bg: "bg-info/15", label: "LOW" };
                  return (
                    <li key={f.id}>
                      <button
                        onClick={() => { setSelectedFlag(f.id); setSelectedMetric(f.linkedMetric); }}
                        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-elevated ${active ? "bg-elevated" : ""}`}
                      >
                        <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${sev.c}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${sev.bg} ${sev.c}`}>{sev.label}</span>
                            <span className="truncate text-sm font-medium">{f.title}</span>
                          </div>
                          <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{f.body}</p>
                        </div>
                        <ChevronRight className="mt-1 h-4 w-4 text-muted-foreground" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            <NegotiationOpportunities
              opportunities={negotiationOpportunities}
              selectedId={selectedNegotiation}
              onSelect={setSelectedNegotiation}
            />
          </div>
        </section>

        {/* Right — Risk Score */}
        <aside className="col-span-12 lg:col-span-3">
          <section className={`rounded-xl border bg-panel p-5 ${verdict.tone === "destructive" ? "border-destructive/40" : verdict.tone === "warning" ? "border-warning/40" : "border-success/40"}`}>
            <div className="flex items-center gap-2">
              <ShieldAlert className={`h-4 w-4 ${verdict.tone === "destructive" ? "text-destructive" : verdict.tone === "warning" ? "text-warning" : "text-success"}`} />
              <h2 className="text-sm font-semibold">Risk Score</h2>
            </div>

            <div className="my-4 flex items-center justify-center">
              <RiskDial score={score} />
            </div>

            <div className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 ring-1 ${
              verdict.tone === "destructive"
                ? "bg-destructive/15 ring-destructive/40"
                : verdict.tone === "warning"
                  ? "bg-warning/15 ring-warning/40"
                  : "bg-success/15 ring-success/40"
            }`}>
              <AlertOctagon className={`h-5 w-5 ${
                verdict.tone === "destructive" ? "text-destructive" : verdict.tone === "warning" ? "text-warning" : "text-success"
              }`} />
              <span className={`text-base font-bold tracking-wider ${
                verdict.tone === "destructive" ? "text-destructive" : verdict.tone === "warning" ? "text-warning" : "text-success"
              }`}>{verdict.label}</span>
            </div>

            <ul className="mt-4 space-y-1.5 text-[11px]">
              <li className="flex justify-between"><span className="text-muted-foreground">Flags</span><span className="text-foreground">{uiFlags.length}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Critical</span><span className="text-destructive">{countFlags(uiFlags, "high")}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Medium</span><span className="text-warning">{countFlags(uiFlags, "med")}</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Year-1 NOI</span><span className="text-foreground">${year1Noi(engine.deal).toLocaleString()}</span></li>
            </ul>
          </section>
        </aside>

        {/* Bottom three columns */}
        <section className="col-span-12 grid grid-cols-12 gap-4">
          {/* Why-Not */}
          <div className="col-span-12 lg:col-span-4 rounded-xl border border-border bg-panel">
            <button
              onClick={() => setWhyNotOpen((v) => !v)}
              className="flex w-full items-center justify-between border-b border-border px-4 py-3"
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <h2 className="text-sm font-semibold">Why-Not Panel</h2>
                {ruleJustifications.length > 0 && (
                  <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">
                    {ruleJustifications.length} {ruleJustifications.length === 1 ? "flag" : "flags"}
                  </span>
                )}
              </div>
              {whyNotOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {whyNotOpen && (
              <div className="space-y-3 p-4">
                <ul className="space-y-2">
                  {ruleJustifications.map((text, idx) => (
                    <li key={idx} className="flex gap-2 rounded-lg bg-elevated p-3 text-xs leading-relaxed text-muted-foreground">
                      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-warning/15 text-[10px] font-semibold text-warning">
                        {idx + 1}
                      </span>
                      <span>{text}</span>
                    </li>
                  ))}
                </ul>
                {activeFlag && activeMetric && (
                  <div className="rounded-lg bg-elevated p-3">
                    <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Selected flag · {activeMetric.label}</div>
                    <div className="mt-1 text-sm font-semibold">{activeFlag.title}</div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-lg font-semibold">{activeMetric.value}</span>
                      <span className="text-[11px] text-muted-foreground">{activeMetric.delta}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Generated Deal Memo */}
          <div className="col-span-12 lg:col-span-5 rounded-xl border border-border bg-panel">
            <div className="flex items-center gap-2 border-b border-border px-4 py-3">
              <FileText className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-semibold">Generated Deal Memo</h2>
              <span className="ml-auto text-[11px] text-muted-foreground">Auto-drafted · v1.2</span>
            </div>
            <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
              {MEMO_SECTIONS.map((s) => {
                const active = activeMemo === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setActiveMemo(s.key)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${active ? "bg-primary text-primary-foreground" : "bg-elevated text-muted-foreground hover:text-foreground"}`}
                  >
                    {s.label}
                  </button>
                );
              })}
            </div>
            <div className="p-4">
              <h3 className="text-sm font-semibold">{activeMemoSection.label}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{activeMemoSection.body}</p>
            </div>
          </div>

          {/* Actions */}
          <div className="col-span-12 lg:col-span-3 rounded-xl border border-border bg-panel p-4">
            <h2 className="mb-3 text-sm font-semibold">Actions</h2>
            <div className="flex flex-col gap-2.5">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] text-muted-foreground">Analyst notes (appended to memo)</label>
                <textarea
                  value={analystNotes}
                  onChange={(e) => setAnalystNotes(e.target.value)}
                  placeholder="Optional: add context, caveats, or IC commentary…"
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-elevated px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                />
              </div>
              <button
                onClick={exportMemo}
                disabled={exporting}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <FileText className="h-4 w-4" />
                {exporting ? "Generating…" : "Export PDF Deal Memo"}
              </button>
              {exportError && (
                <p className="text-[11px] text-destructive">{exportError}</p>
              )}
              <button className="inline-flex items-center justify-center gap-2 rounded-md bg-purple px-4 py-2.5 text-sm font-medium text-purple-foreground transition hover:opacity-90">
                <Bookmark className="h-4 w-4" /> Save to Portfolio
              </button>
              <button className="inline-flex items-center justify-center gap-2 rounded-md bg-success px-4 py-2.5 text-sm font-medium text-success-foreground transition hover:opacity-90">
                <GitCompare className="h-4 w-4" /> Compare vs Another Deal
              </button>
            </div>

            <div className="mt-4 rounded-lg border border-border bg-elevated p-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <DollarSign className="h-3.5 w-3.5" /> Deal economics
              </div>
              <ul className="mt-2 space-y-1 text-[11px]">
                <li className="flex justify-between"><span className="text-muted-foreground">NOI / unit</span><span>${Math.round(engine.deal.derived_metrics?.noi_per_unit_usd ?? 0).toLocaleString()}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Reno / unit</span><span>${Math.round(engine.deal.derived_metrics?.reno_cost_per_unit_usd ?? 0).toLocaleString()}</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Year-1 NOI</span><span>${year1Noi(engine.deal).toLocaleString()}</span></li>
              </ul>
            </div>
          </div>
        </section>
      </main>

      <DealAiChat />
    </div>
  );
}

function RiskDial({ score }: { score: number }) {
  const size = 168;
  const stroke = 14;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const dash = c * pct;
  const color = score < 35 ? "var(--destructive)" : score < 65 ? "var(--warning)" : "var(--success)";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="var(--border)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-3xl font-bold leading-none">{score}<span className="text-base font-medium text-muted-foreground">/100</span></span>
        <span className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">Composite Risk</span>
      </div>
    </div>
  );
}
