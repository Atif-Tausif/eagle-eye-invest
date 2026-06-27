import { createFileRoute } from "@tanstack/react-router";
import { getMarketContext } from "@/lib/market-data";

const GROQ_API_KEY =
  (typeof process !== "undefined" && process.env.GROQ_API_KEY);
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";

// ---------------------------------------------------------------------------
// PDF text extraction (pdfjs-dist, Node.js / Nitro compatible)
// ---------------------------------------------------------------------------

async function extractPdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs" as string);
  // Disable the web worker — not available in Node.js
  (pdfjsLib as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc = "";

  const loadingTask = (pdfjsLib as { getDocument: (opts: { data: Uint8Array }) => { promise: Promise<{
    numPages: number;
    getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: Array<{ str?: string }> }> }>;
  }> } }).getDocument({ data: bytes });

  const pdf = await loadingTask.promise;
  const pages: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => item.str ?? "")
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (text.length > 20) pages.push(text);
  }
  return pages;
}

// Pick the pages most relevant to extraction (cover + financials)
function selectRelevantPages(pages: string[]): { cover: string; financials: string } {
  const cover = pages.slice(0, 3).join("\n\n---\n\n");

  const finKeywords = /net\s+operating\s+income|NOI|pro\s+forma|renovation|capital\s+expenditure/i;
  const finPages = pages.filter((p) => finKeywords.test(p));
  // Prefer pages that mention Year 1 values
  const year1Pages = finPages.filter((p) => /year\s*1|yr\.?\s*1/i.test(p));
  const financials = (year1Pages.length ? year1Pages : finPages).slice(0, 4).join("\n\n---\n\n");

  return { cover, financials };
}

// ---------------------------------------------------------------------------
// Groq API call with rate-limit retry
// ---------------------------------------------------------------------------

async function callGroq(userPrompt: string, retries = 4): Promise<string> {
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
      // Respect Retry-After header; default to 60 s if absent
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
// Extraction prompts
// ---------------------------------------------------------------------------

async function extractMetadata(coverText: string): Promise<{
  property_name: string | null;
  unit_count: number | null;
  asset_type: string | null;
  location: string | null;
}> {
  const prompt = `Extract property metadata from this Offering Memorandum cover page text.

Return JSON with exactly these keys:
{
  "property_name": "<full property name or null>",
  "unit_count": <integer number of units or null>,
  "asset_type": "<e.g. Apartment Community or null>",
  "location": "<city, state or null>"
}

Cover page text:
${coverText.slice(0, 4000)}`;

  const raw = await callGroq(prompt);
  try {
    return JSON.parse(raw);
  } catch {
    return { property_name: null, unit_count: null, asset_type: null, location: null };
  }
}

async function extractFinancials(financialsText: string): Promise<{
  net_operating_income_usd: number | null;
  interior_renovation_budget_usd: number | null;
}> {
  const prompt = `Extract Year 1 financial figures from this Offering Memorandum pro forma table text.

Return JSON with exactly these keys (integer dollar amounts, renovation budgets are typically negative):
{
  "net_operating_income_usd": <Year 1 NOI as integer or null>,
  "interior_renovation_budget_usd": <renovation/CapEx budget as negative integer or null>
}

Pro forma text:
${financialsText.slice(0, 4000)}`;

  const raw = await callGroq(prompt);
  try {
    return JSON.parse(raw);
  } catch {
    return { net_operating_income_usd: null, interior_renovation_budget_usd: null };
  }
}

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

export const Route = createFileRoute("/api/upload-om")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const formData = await request.formData();
          const file = formData.get("file");

          if (!(file instanceof File)) {
            return new Response(JSON.stringify({ error: "No file uploaded" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }
          if (!file.name.toLowerCase().endsWith(".pdf")) {
            return new Response(JSON.stringify({ error: "Only PDF files are supported" }), {
              status: 400,
              headers: { "Content-Type": "application/json" },
            });
          }

          // 1. Extract PDF text
          const bytes = new Uint8Array(await file.arrayBuffer());
          const pages = await extractPdfPages(bytes);

          if (pages.length === 0) {
            return new Response(JSON.stringify({ error: "Could not extract text from PDF" }), {
              status: 422,
              headers: { "Content-Type": "application/json" },
            });
          }

          const { cover, financials } = selectRelevantPages(pages);

          // 2. Call Groq — two sequential requests to stay within token limits
          const [meta, fins] = await Promise.all([
            extractMetadata(cover),
            financials ? extractFinancials(financials) : Promise.resolve({ net_operating_income_usd: null, interior_renovation_budget_usd: null }),
          ]);

          // 3. Derive metrics
          const noi = fins.net_operating_income_usd;
          const reno = fins.interior_renovation_budget_usd;
          const units = meta.unit_count;

          const derived: Record<string, number> = {};
          if (noi != null && reno != null) derived.net_cash_flow_after_capex_usd = noi + reno;
          if (noi != null && units) derived.noi_per_unit_usd = Math.round((noi / units) * 100) / 100;
          if (reno != null && units) derived.reno_cost_per_unit_usd = Math.round((Math.abs(reno) / units) * 100) / 100;

          // 4. Merge with stub market data
          const submarket = "DuPage County";
          const marketContext = getMarketContext(submarket);

          const deal = {
            merged_at: new Date().toISOString(),
            source_pdf: file.name,
            property_metadata: meta,
            financial_projections: {
              year_1: { net_operating_income_usd: noi },
              capital_expenditures: { interior_renovation_budget_usd: reno },
              rows: [
                { label: "Net Operating Income", year_1_usd: noi },
                { label: "Interior Renovation Budget", year_1_usd: reno },
              ],
            },
            market_context: marketContext,
            derived_metrics: derived,
          };

          return new Response(JSON.stringify(deal), {
            headers: { "Content-Type": "application/json" },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : "Failed to process uploaded OM";
          return new Response(JSON.stringify({ error: message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
