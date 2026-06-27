import { ChevronRight, Handshake } from "lucide-react";
import type { NegotiationOpportunity } from "@/lib/negotiation-engine";

function formatUsd(value: number): string {
  return `$${value.toLocaleString()}`;
}

function confidenceTone(pct: number): { c: string; bg: string; label: string } {
  if (pct >= 80) return { c: "text-success", bg: "bg-success/15", label: "HIGH" };
  if (pct >= 60) return { c: "text-warning", bg: "bg-warning/15", label: "MED" };
  return { c: "text-info", bg: "bg-info/15", label: "LOW" };
}

interface NegotiationOpportunitiesProps {
  opportunities: NegotiationOpportunity[];
  selectedId?: string;
  onSelect?: (id: string) => void;
}

export function NegotiationOpportunities({
  opportunities,
  selectedId,
  onSelect,
}: NegotiationOpportunitiesProps) {
  return (
    <div className="rounded-xl border border-border bg-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2">
          <Handshake className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold">Negotiation Opportunities</h2>
          {opportunities.length > 0 && (
            <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
              {opportunities.length} {opportunities.length === 1 ? "item" : "items"}
            </span>
          )}
        </div>
      </div>
      <ul className="divide-y divide-border">
        {opportunities.map((opp) => {
          const active = selectedId === opp.id;
          const conf = confidenceTone(opp.confidence_pct);
          return (
            <li key={opp.id}>
              <button
                type="button"
                onClick={() => onSelect?.(opp.id)}
                className={`flex w-full items-start gap-3 px-4 py-3 text-left transition hover:bg-elevated ${active ? "bg-elevated" : ""}`}
              >
                <Handshake className={`mt-0.5 h-4 w-4 shrink-0 ${conf.c}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${conf.bg} ${conf.c}`}
                    >
                      {conf.label} · {opp.confidence_pct.toFixed(0)}%
                    </span>
                    <span className="truncate text-sm font-medium">{opp.item}</span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    Est. cost {formatUsd(opp.estimated_cost_usd)} · Ask{" "}
                    {formatUsd(opp.suggested_price_reduction_low_usd)}–
                    {formatUsd(opp.suggested_price_reduction_high_usd)} price reduction
                  </p>
                </div>
                <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
