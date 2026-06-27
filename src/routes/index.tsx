import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useState } from "react";
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

const METRICS: Array<{
  key: MetricKey;
  label: string;
  value: string;
  delta: string;
  status: "good" | "warn" | "bad";
  icon: React.ComponentType<{ className?: string }>;
  detail: string;
}> = [
  { key: "occupancy", label: "Occupancy", value: "87.4%", delta: "-4.2% vs submarket", status: "warn", icon: Building2,
    detail: "Trailing 3-month occupancy of 87.4% trails the submarket average of 91.6%. Concession burn-off in Q2 may have suppressed renewals; T-12 turnover sits at 58%." },
  { key: "dscr", label: "DSCR", value: "1.08x", delta: "Below 1.25x covenant", status: "bad", icon: Activity,
    detail: "Year-1 DSCR of 1.08x falls below typical agency covenant of 1.25x. Stressed at +100bps rate, DSCR drops to 0.94x. Insufficient cushion for variable-rate debt." },
  { key: "expense", label: "Expense Ratio", value: "54.2%", delta: "+6pts vs peer set", status: "bad", icon: Percent,
    detail: "Operating expense ratio of 54.2% materially exceeds the 1980s-vintage Class B peer median of 48%. Payroll and R&M are the primary drivers." },
  { key: "rent", label: "Rent Growth Pro-forma", value: "5.8% / yr", delta: "Submarket trend: 2.1%", status: "bad", icon: TrendingUp,
    detail: "Sponsor pro-forma assumes 5.8% annual rent growth through Year 5. CoStar submarket trend is 2.1% with elevated supply pipeline of 1,840 units delivering by 2027." },
  { key: "vacancy", label: "Market Vacancy Delta", value: "+310 bps", delta: "Worsening", status: "warn", icon: TrendingDown,
    detail: "Submarket vacancy has expanded 310 bps over the trailing 12 months as new Class A deliveries pull renters up-market. Lease-up at the property is decelerating." },
  { key: "capex", label: "CapEx Budget", value: "$3.4K / unit", delta: "Below renovation scope", status: "warn", icon: Wrench,
    detail: "Budgeted $3,400/unit for interior renovations is light versus the $5,800-$7,200/unit needed to achieve the underwritten $185 premium based on comp scopes." },
];

const FLAGS = [
  { id: "f1", severity: "high" as const, title: "DSCR below covenant threshold", body: "Year-1 DSCR of 1.08x violates the 1.25x minimum DSCR covenant on the agency debt quote. Refinance risk in Year 3 is materially elevated.", linkedMetric: "dscr" as MetricKey },
  { id: "f2", severity: "high" as const, title: "Rent growth assumption disconnected from submarket", body: "Sponsor underwrites 5.8% annual rent growth through stabilization while CoStar reports 2.1% trailing growth and 1,840 competing units in lease-up.", linkedMetric: "rent" as MetricKey },
  { id: "f3", severity: "med" as const, title: "Expense ratio outlier vs peer set", body: "54.2% expense ratio vs 48% peer median. Payroll at $1,180/unit is 22% above benchmark for a 184-unit asset under third-party management.", linkedMetric: "expense" as MetricKey },
  { id: "f4", severity: "med" as const, title: "CapEx scope under-funded for premiums", body: "$3,400/unit interior CapEx is insufficient to deliver the $185 renovation premium underwritten in the value-add pro-forma.", linkedMetric: "capex" as MetricKey },
  { id: "f5", severity: "low" as const, title: "Occupancy lag vs submarket", body: "T-3 occupancy of 87.4% trails submarket by 420bps. Concession burn and elevated turnover suggest operational drag, not just market softness.", linkedMetric: "occupancy" as MetricKey },
];

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

function Dashboard() {
  const [selectedMetric, setSelectedMetric] = useState<MetricKey>("dscr");
  const [selectedFlag, setSelectedFlag] = useState<string>("f1");
  const [whyNotOpen, setWhyNotOpen] = useState(true);
  const [activeMemo, setActiveMemo] = useState<string>("financial");
  const [dragOver, setDragOver] = useState(false);
  const [files, setFiles] = useState<string[]>(["OM_RiverPark_184u.pdf", "T-12_OperatingStatement.xlsx"]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const dropped = Array.from(e.dataTransfer.files).map((f) => f.name);
    if (dropped.length) setFiles((prev) => [...prev, ...dropped]);
  }, []);

  const activeMetric = METRICS.find((m) => m.key === selectedMetric)!;
  const activeFlag = FLAGS.find((f) => f.id === selectedFlag)!;
  const activeMemoSection = MEMO_SECTIONS.find((m) => m.key === activeMemo)!;

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
            <span className="hidden sm:inline">Deal: <span className="text-foreground">RiverPark Apartments · 184 units · Phoenix MSA</span></span>
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
              <p className="text-xs font-medium">Drop OM, T-12, Rent Roll</p>
              <p className="mt-1 text-[11px] text-muted-foreground">PDF, XLSX, CSV up to 50 MB</p>
            </div>

            <ul className="mt-3 space-y-1.5">
              {files.map((f) => (
                <li key={f} className="flex items-center gap-2 rounded-md bg-elevated px-2.5 py-1.5 text-xs">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate">{f}</span>
                </li>
              ))}
            </ul>

            <button className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg shadow-primary/20 transition hover:bg-primary/90">
              Analyze Deal <ArrowRight className="h-4 w-4" />
            </button>

            <div className="mt-4 space-y-2 border-t border-border pt-3 text-[11px] text-muted-foreground">
              <div className="flex justify-between"><span>Parsed pages</span><span className="text-foreground">142</span></div>
              <div className="flex justify-between"><span>Confidence</span><span className="text-foreground">94%</span></div>
              <div className="flex justify-between"><span>Run time</span><span className="text-foreground">38s</span></div>
            </div>
          </section>
        </aside>

        {/* Center metrics + Flag Feed */}
        <section className="col-span-12 lg:col-span-6 space-y-4">
          {/* Metric grid */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {METRICS.map((m) => {
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

          {/* Flag Feed */}
          <div className="rounded-xl border border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2">
                <Flag className="h-4 w-4 text-warning" />
                <h2 className="text-sm font-semibold">Flag Feed</h2>
                <span className="ml-2 rounded-full bg-destructive/15 px-2 py-0.5 text-[10px] font-medium text-destructive">2 High</span>
                <span className="rounded-full bg-warning/15 px-2 py-0.5 text-[10px] font-medium text-warning">2 Med</span>
                <span className="rounded-full bg-info/15 px-2 py-0.5 text-[10px] font-medium text-info">1 Low</span>
              </div>
              <span className="text-[11px] text-muted-foreground">Live</span>
            </div>
            <ul className="divide-y divide-border">
              {FLAGS.map((f) => {
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
        </section>

        {/* Right — Risk Score */}
        <aside className="col-span-12 lg:col-span-3">
          <section className="rounded-xl border border-destructive/40 bg-panel p-5">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-destructive" />
              <h2 className="text-sm font-semibold">Risk Score</h2>
            </div>

            <div className="my-4 flex items-center justify-center">
              <RiskDial score={18} />
            </div>

            <div className="flex items-center justify-center gap-2 rounded-lg bg-destructive/15 px-3 py-2.5 ring-1 ring-destructive/40">
              <AlertOctagon className="h-5 w-5 text-destructive" />
              <span className="text-base font-bold tracking-wider text-destructive">NO-GO</span>
            </div>

            <ul className="mt-4 space-y-1.5 text-[11px]">
              <li className="flex justify-between"><span className="text-muted-foreground">Demand</span><span className="text-warning">42</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Financial</span><span className="text-destructive">12</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Sponsor</span><span className="text-warning">38</span></li>
              <li className="flex justify-between"><span className="text-muted-foreground">Exit</span><span className="text-destructive">15</span></li>
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
              </div>
              {whyNotOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
            </button>
            {whyNotOpen && (
              <div className="space-y-3 p-4">
                <div className="rounded-lg bg-elevated p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Selected flag</div>
                  <div className="mt-1 text-sm font-semibold">{activeFlag.title}</div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{activeFlag.body}</p>
                </div>
                <div className="rounded-lg bg-elevated p-3">
                  <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Linked metric · {activeMetric.label}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className="text-lg font-semibold">{activeMetric.value}</span>
                    <span className="text-[11px] text-muted-foreground">{activeMetric.delta}</span>
                  </div>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{activeMetric.detail}</p>
                </div>
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
              <button className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90">
                <FileText className="h-4 w-4" /> Export PDF Deal Memo
              </button>
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
                <li className="flex justify-between"><span className="text-muted-foreground">Price / unit</span><span>$184,800</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">Going-in cap</span><span>4.6%</span></li>
                <li className="flex justify-between"><span className="text-muted-foreground">UW IRR</span><span>16.4%</span></li>
              </ul>
            </div>
          </div>
        </section>
      </main>
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
