# How MultifamilyIQ Works

MultifamilyIQ is an AI-powered deal screening agent for multifamily CRE. You upload an Offering Memorandum PDF and get back a GO / CAUTION / NO-GO verdict with a risk score, flag breakdown, negotiation leverage points, and an exportable investment committee memo.

---

## End-to-End Flow

```
User drops PDF
      │
      ▼
[Browser] pdf-extract-client.ts
  pdfjs-dist reads the file locally
  Splits pages into "cover" (pages 1–3) and "financials" (NOI/CapEx pages)
      │
      ▼
POST /api/upload-om  { fileName, cover, financials }
      │
      ├─► Groq LLM (llama-3.3-70b-versatile)
      │     Call 1: extract property_name, unit_count, asset_type, location, zip_code
      │     Call 2: extract net_operating_income_usd, interior_renovation_budget_usd
      │     Regex fallback if Groq is rate-limited or returns bad JSON
      │
      ├─► RentCast API  GET /v1/markets?zipCode={zip}&propertyType=Apartment&historyRange=36
      │     Returns live vacancy rate + 36-month rent history for the property's zip
      │     Falls back to hardcoded DuPage County stub if zip not found or API unavailable
      │
      ├─► Risk Engine  evaluateDeal(deal)
      │     Runs 3 deterministic rules (see below)
      │     Returns { deal, flags[], score }
      │
      └─► Response: EnginePayload JSON  →  frontend renders verdict dashboard
```

---

## File Map

### Client-side (runs in the browser)

| File | What it does |
|------|-------------|
| `src/routes/index.tsx` | Main UI — upload zone, file list, verdict dashboard, metrics cards, chat panel |
| `src/lib/pdf-extract-client.ts` | Reads PDF bytes with pdfjs-dist; splits into cover + financials text sections |
| `src/components/deal-ai-chat.tsx` | Chat UI component; POSTs to `/api/chat` |
| `src/components/negotiation-opportunities.tsx` | Renders negotiation leverage cards |

PDF extraction runs entirely in the browser. pdfjs-dist needs a web worker, which is loaded from the unpkg CDN (`https://unpkg.com/pdfjs-dist@{version}/build/pdf.worker.mjs`) to avoid Vite asset-bundling differences between dev and Lovable's production CDN.

### Server-side API routes (Nitro/TanStack Start serverless)

| Route | Method | What it does |
|-------|--------|-------------|
| `POST /api/upload-om` | POST | Main pipeline: receives extracted text, calls Groq + RentCast, runs risk engine, returns EnginePayload |
| `GET /api/deal` | GET | Returns EnginePayload for the static hackathon demo deal (`backend/data/current_deal.json`) |
| `POST /api/chat` | POST | Answers questions about the static demo deal using rule-based logic |
| `GET /api/negotiation` | GET | Returns negotiation opportunities for the static demo deal |
| `POST /api/export-memo` | POST | Returns a fully formatted HTML investment committee memo for the static demo deal |

### Core business logic

| File | What it does |
|------|-------------|
| `src/lib/risk-engine.ts` | Three deterministic risk rules + scoring. Pure TypeScript, no API calls |
| `src/lib/market-data.ts` | Async RentCast API client. Falls back to DuPage County stub |
| `src/lib/negotiation-engine.ts` | Derives price reduction opportunities from OM CapEx disclosures and DSCR shortfall |
| `src/lib/deal-chat.ts` | Rule-based Q&A over the deal payload; no LLM |

---

## Risk Engine — 3 Rules

All rules run in `src/lib/risk-engine.ts`. Scoring starts at 100 and deducts per flag.

### 1. DSCR Risk
```
DSCR = Year-1 NOI / Annual Debt Service
     = NOI / (loan_amount × debt_rate)   [interest-only assumed]
```
- DSCR < 1.15 → **Critical Risk** (−35 pts) — below covenant, refinance risk
- DSCR 1.15–1.25 → **Medium Risk** (−20 pts) — below typical agency covenant
- Default assumptions: $60M loan, 9.6% IO rate (overridden by OM data if present)

### 2. Rent Premium Risk
```
gap = pro_forma_rent_growth_pct − submarket_3yr_cagr_pct
```
- gap > 4 pts AND no CapEx budget → **Critical Risk** (−35 pts)
- gap > 2 pts → **Medium Risk** (−20 pts)
- Submarket CAGR comes from RentCast history (or stub fallback)
- Pro-forma growth defaults to 5.8% if not extracted from OM

### 3. Vacancy Delta Risk
```
trailing_12mo_change_bps = current_occupancy_bps − year_ago_occupancy_bps
```
- change ≤ −100 bps → **Critical Risk** (−35 pts) — occupancy deteriorating fast
- change −50 to −100 bps → **Medium Risk** (−20 pts)
- This data comes entirely from RentCast (or stub)

**Final score** = max(0, 100 − sum of deductions)
- Score < 35 → **NO-GO**
- Score 35–64 → **CAUTION**
- Score ≥ 65 → **GO**

---

## RentCast Integration

**Endpoint:** `GET https://api.rentcast.io/v1/markets?zipCode={zip}&propertyType=Apartment&historyRange=36`

**Auth:** `X-Api-Key` header — set `RENTCAST_API_KEY` in Lovable secrets.

**What we use from the response:**
- `rentalVacancyRate` → vacancy %, occupancy %, economic vacancy estimate
- `history[date].rentalVacancyRate` → trailing-12mo occupancy change in bps
- `history[date].averageRent` → annual rent growth array + 3-yr CAGR

**Fallback chain:**
1. Zip extracted from OM by Groq (or regex) → live RentCast data
2. No zip found → DuPage County hardcoded stub
3. RentCast API error / non-200 → DuPage County hardcoded stub

Construction pipeline data is not available from RentCast; that section remains a stub.

---

## Groq Extraction

**Model:** `llama-3.3-70b-versatile` (128k context window)  
**API key:** `GROQ_API_KEY` in Lovable secrets  
**Rate limits:** Retries on HTTP 429, respects `Retry-After` header, up to 4 attempts

Two parallel calls per upload:
1. **Cover call** → `property_name`, `unit_count`, `asset_type`, `location`, `zip_code`
2. **Financials call** → `net_operating_income_usd`, `interior_renovation_budget_usd`

Each call has a regex fallback that runs first and is merged with the Groq result (Groq wins on overlap).

---

## Static Demo Deal

`backend/data/current_deal.json` — a 344-unit suburban Chicago multifamily asset with $6.22M Year-1 NOI. Used by `/api/deal`, `/api/chat`, `/api/negotiation`, and `/api/export-memo`. These routes always return the same deal regardless of what was uploaded, so the chat and negotiation tabs reflect the demo deal, not the uploaded OM.

---

## Environment Variables (Lovable Secrets)

| Key | Used by | Required |
|-----|---------|----------|
| `GROQ_API_KEY` | `/api/upload-om` | Yes — OM extraction falls back to regex only without it |
| `RENTCAST_API_KEY` | `src/lib/market-data.ts` | No — stub data used as fallback |

---

## Tech Stack

- **Framework:** TanStack Start (React + Vite + Nitro)
- **Hosting:** Lovable (serverless, no `child_process`, no `node:fs` runtime reads)
- **PDF parsing:** pdfjs-dist v4.4.168 (client-side only)
- **LLM:** Groq `llama-3.3-70b-versatile`
- **Market data:** RentCast API
- **UI:** shadcn/ui + Tailwind CSS + Recharts
