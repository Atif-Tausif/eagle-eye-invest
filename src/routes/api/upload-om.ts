import { createFileRoute } from "@tanstack/react-router";
import { getMarketContext } from "@/lib/market-data";
import { evaluateDeal } from "@/lib/risk-engine";

// PDF extraction now happens client-side (browser has real web workers).
// This route receives pre-extracted text sections and calls Groq.

const GROQ_API_KEY = typeof process !== "undefined" && process.env.GROQ_API_KEY;
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// Groq API call with rate-limit retry
// ---------------------------------------------------------------------------

async function callGroq(userPrompt: string, retries = 4): Promise<string> {
  if (!GROQ_API_KEY) throw new Error("GROQ_API_KEY is not configured");

  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a precise real-estate data extraction assistant. Return ONLY valid JSON — no markdown fences, no commentary.",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0,
        max_tokens: 512,
      }),
    });

    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get("retry-after") ?? "60", 10);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Groq error ${res.status}: ${body.slice(0, 200)}`);
    }

    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    return data.choices[0].message.content.trim();
  }
  throw new Error("Groq rate limit: max retries exceeded");
}

// ---------------------------------------------------------------------------
// Regex fallbacks (used when Groq is unavailable or returns bad JSON)
// ---------------------------------------------------------------------------

function parseMoney(value: string | undefined): number | null {
  if (!value) return null;
  const negative = /^\s*\(/.test(value) || /^\s*-/.test(value);
  const cleaned = value.replace(/[^\d.]/g, "");
  if (!cleaned) return null;
  const parsed = Number.parseFloat(cleaned);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed) * (negative ? -1 : 1);
}

function regexMetadata(text: string) {
  const unitMatch = text.match(/(\d{2,5})\s*(?:-|\s)?\s*unit/i);
  const assetMatch = text.match(/\b(apartment community|multifamily|garden apartments?)\b/i);
  const locationMatch = text.match(
    /\b([A-Z][A-Za-z .'-]+,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|IL|IN|IA|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY))\b/,
  );
  const titleMatch =
    text.match(/([A-Z][A-Za-z0-9&,' -]+(?:Apartment|Apartments|Community)[A-Za-z0-9&,' -]*)/) ??
    text.match(/([A-Z][A-Za-z0-9&,' -]{12,80})/);
  return {
    property_name: titleMatch?.[1]?.trim() ?? null,
    unit_count: unitMatch ? Number.parseInt(unitMatch[1], 10) : null,
    asset_type: assetMatch?.[1] ?? (unitMatch ? "Apartment Community" : null),
    location: locationMatch?.[1] ?? null,
  };
}

function regexFinancials(text: string) {
  const money = String.raw`(\(?-?\$?\s*\d[\d,]*(?:\.\d+)?\)?)`;
  const noiMatch =
    text.match(new RegExp(`net\\s+operating\\s+income[^$()\\d-]{0,80}${money}`, "i")) ??
    text.match(new RegExp(`\\bNOI\\b[^$()\\d-]{0,80}${money}`, "i"));
  const renoMatch =
    text.match(new RegExp(`interior\\s+renovation[^$()\\d-]{0,80}${money}`, "i")) ??
    text.match(new RegExp(`(?:renovation|capex|capital\\s+expenditure)[^$()\\d-]{0,80}${money}`, "i"));
  const reno = parseMoney(renoMatch?.[1]);
  return {
    net_operating_income_usd: parseMoney(noiMatch?.[1]),
    interior_renovation_budget_usd: reno == null ? null : -Math.abs(reno),
  };
}

// ---------------------------------------------------------------------------
// Groq extraction
// ---------------------------------------------------------------------------

async function extractMetadata(coverText: string) {
  const fallback = regexMetadata(coverText);
  try {
    const raw = await callGroq(
      `Extract property metadata from this Offering Memorandum text.\n\nReturn JSON with exactly these keys:\n{\n  "property_name": string | null,\n  "unit_count": number | null,\n  "asset_type": string | null,\n  "location": string | null\n}\n\nText:\n${coverText.slice(0, 4000)}`,
    );
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

async function extractFinancials(financialsText: string) {
  const fallback = regexFinancials(financialsText);
  try {
    const raw = await callGroq(
      `Extract Year 1 financial figures from this Offering Memorandum pro forma text.\n\nReturn JSON with exactly these keys (renovation budgets are negative integers):\n{\n  "net_operating_income_usd": number | null,\n  "interior_renovation_budget_usd": number | null\n}\n\nText:\n${financialsText.slice(0, 4000)}`,
    );
    return { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Route — accepts { fileName, cover, financials } JSON from the client
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/api/upload-om")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as {
            fileName?: string;
            cover?: string;
            financials?: string;
          };

          if (!body.cover) {
            return new Response(JSON.stringify({ error: "No extracted text provided" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          const [meta, fins] = await Promise.all([
            extractMetadata(body.cover),
            body.financials
              ? extractFinancials(body.financials)
              : Promise.resolve({ net_operating_income_usd: null, interior_renovation_budget_usd: null }),
          ]);

          const noi = fins.net_operating_income_usd;
          const reno = fins.interior_renovation_budget_usd;
          const units = meta.unit_count;

          const derived: Record<string, number> = {};
          if (noi != null && reno != null) derived.net_cash_flow_after_capex_usd = noi + reno;
          if (noi != null && units) derived.noi_per_unit_usd = Math.round((noi / units) * 100) / 100;
          if (reno != null && units) derived.reno_cost_per_unit_usd = Math.round((Math.abs(reno) / units) * 100) / 100;

          const deal = {
            merged_at: new Date().toISOString(),
            source_pdf: body.fileName ?? "upload.pdf",
            property_metadata: meta,
            financial_projections: {
              year_1: { net_operating_income_usd: noi },
              capital_expenditures: { interior_renovation_budget_usd: reno },
              rows: [
                { label: "Net Operating Income", year_1_usd: noi },
                { label: "Interior Renovation Budget", year_1_usd: reno },
              ],
            },
            market_context: getMarketContext("DuPage County"),
            derived_metrics: derived,
          };

          return new Response(JSON.stringify(evaluateDeal(deal)), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to process OM";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
