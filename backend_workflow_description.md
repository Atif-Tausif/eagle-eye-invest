# MultifamilyIQ — Backend Workflow Description

**Platform:** Custom serverless pipeline built on TanStack Start (Nitro) + Groq LLM + RentCast API  
**Hosting:** Lovable (serverless, edge-deployed)  
**Submission note:** No n8n or Zapier workflow is used. The backend is a fully custom TypeScript pipeline. This document describes each step in the same level of detail as an n8n workflow export.

---

## Pipeline Overview

The backend processes an Offering Memorandum PDF through five sequential steps, from raw file to investment verdict. Each step is a discrete function or API call with defined inputs and outputs.

```
STEP 1: PDF Text Extraction  (browser)
STEP 2: LLM Data Extraction  (Groq API)
STEP 3: Market Data Fetch    (RentCast API)
STEP 4: Risk Engine          (rule-based TypeScript)
STEP 5: Response Assembly    (EnginePayload → UI)
```

---

## Step 1 — PDF Text Extraction

**Where it runs:** Browser (client-side)  
**Library:** pdfjs-dist v4.4.168  
**Trigger:** User drops or selects a PDF file in the upload zone

**Process:**
1. The file is read as a `Uint8Array` via `file.arrayBuffer()`
2. pdfjs-dist opens the document and iterates every page
3. Text items are joined into a plain-text string per page
4. Pages are split into two sections:
   - **Cover** — first 3 pages (property name, location, unit count, asset type)
   - **Financials** — pages matching keywords: `net operating income`, `NOI`, `pro forma`, `renovation`, `capital expenditure`
5. The two text blocks are sent as JSON to the server: `{ fileName, cover, financials }`

**Why client-side:** The hosting environment (Lovable) does not expose native OS threads or filesystem at runtime. Browser web workers, which pdfjs-dist requires, are available in the browser but not in the serverless runtime.

---

## Step 2 — LLM Data Extraction (Groq)

**Where it runs:** Server — `POST /api/upload-om`  
**Model:** `llama-3.3-70b-versatile` via Groq API  
**Context window:** 128,000 tokens  
**Secret required:** `GROQ_API_KEY`

Two calls run in parallel (`Promise.all`):

### Call A — Property Metadata (from cover text)
**Input:** First ~4,000 characters of the cover section  
**System prompt:** "You are a precise real-estate data extraction assistant. Return ONLY valid JSON — no markdown fences, no commentary."  
**User prompt:** Extract the following fields:
```json
{
  "property_name": "string | null",
  "unit_count": "number | null",
  "asset_type": "string | null",
  "location": "string | null",
  "zip_code": "5-digit string | null"
}
```
**Fallback:** If Groq is unavailable or returns invalid JSON, regex patterns extract:
- Unit count: `/(\d{2,5})\s*unit/i`
- Location: state abbreviation pattern
- ZIP code: `/\b(\d{5})\b/`

### Call B — Financial Figures (from financials text)
**Input:** First ~4,000 characters of the financials section  
**User prompt:** Extract the following fields:
```json
{
  "net_operating_income_usd": "number | null",
  "interior_renovation_budget_usd": "number | null  (negative integer)"
}
```
**Fallback:** Regex patterns scan for dollar amounts near keywords `net operating income`, `NOI`, `renovation`, `capex`

**Rate limit handling:** On HTTP 429, the code reads the `Retry-After` header and waits that many seconds before retrying, up to 4 attempts total.

---

## Step 3 — Live Market Data (RentCast API)

**Where it runs:** Server — same `POST /api/upload-om` handler  
**API:** RentCast `GET /v1/markets`  
**Secret required:** `RENTCAST_API_KEY`

**Request:**
```
GET https://api.rentcast.io/v1/markets
  ?zipCode={zip_from_step_2}
  &propertyType=Apartment
  &historyRange=36
Headers:
  X-Api-Key: {RENTCAST_API_KEY}
```

**Data extracted from response:**
- `rentalVacancyRate` → converted to occupancy % and vacancy %
- `history[date].rentalVacancyRate` → compared to 12 months prior to produce trailing occupancy change in basis points
- `history[date].averageRent` → annual year-over-year rent growth percentages, 3-year CAGR, trailing-12-month growth

**Derived fields:**
- `economic_vacancy_pct` = physical vacancy + 0.7% (standard spread)
- `trailing_12mo_change_bps` = (latest vacancy − year-ago vacancy) × 100, sign-flipped to occupancy convention

**Fallback chain:**
1. No zip extracted from OM → skip API call, use hardcoded stub
2. `RENTCAST_API_KEY` not set → skip API call, use stub
3. API returns non-200 → log warning, use stub
4. Fetch throws (network error) → catch, use stub

**Stub data (fallback):** DuPage County, IL — 91.6% occupancy, −110 bps trailing change, 2.9% 3-yr rent CAGR

---

## Step 4 — Risk Engine

**Where it runs:** Server — still within `POST /api/upload-om`  
**Type:** Deterministic rule engine (no LLM, no external calls)  
**Entry point:** `evaluateDeal(deal)` → returns `{ deal, flags[], score }`

Three rules evaluate the assembled deal object:

### Rule 1 — DSCR
```
DSCR = Year-1 NOI ÷ (Loan Amount × Debt Rate)
     = {extracted NOI} ÷ ($60,000,000 × 9.6%)
```
- DSCR < 1.15 → Critical Risk flag, −35 points
- DSCR 1.15–1.25 → Medium Risk flag, −20 points

### Rule 2 — Rent Premium Gap
```
gap = pro_forma_rent_growth% − submarket_3yr_cagr%
    = 5.8% (OM default) − {RentCast CAGR}
```
- gap > 4 pts AND no CapEx budget → Critical Risk flag, −35 points
- gap > 2 pts → Medium Risk flag, −20 points

### Rule 3 — Vacancy Delta
```
change = submarket trailing-12mo occupancy change (bps from RentCast)
```
- change ≤ −100 bps → Critical Risk flag, −35 points
- change −50 to −100 bps → Medium Risk flag, −20 points

**Scoring:**
```
Score = max(0, 100 − sum of deductions)
Score < 35   → NO-GO    (red)
Score 35–64  → CAUTION  (amber)
Score ≥ 65   → GO       (green)
```

---

## Step 5 — Response Assembly

**Output shape (`EnginePayload`):**
```json
{
  "deal": {
    "property_metadata": { "property_name", "unit_count", "asset_type", "location", "zip_code" },
    "financial_projections": { "year_1": { "net_operating_income_usd" }, "capital_expenditures": { ... } },
    "market_context": { "submarket", "rent_growth_trailing_3yr", "submarket_occupancy", "construction_pipeline" },
    "derived_metrics": { "noi_per_unit_usd", "reno_cost_per_unit_usd", "net_cash_flow_after_capex_usd" }
  },
  "flags": [
    {
      "id": "dscr_critical",
      "category": "Financial Ratios",
      "severity": "Critical Risk",
      "title": "...",
      "justification": "...",
      "metrics": { ... }
    }
  ],
  "score": 30
}
```

The frontend receives this single JSON object and renders:
- Verdict badge (GO / CAUTION / NO-GO)
- Composite risk score (0–100)
- Risk flag cards with severity, title, and plain-English justification
- Metrics grid (NOI, NOI/unit, DSCR, CapEx/unit, occupancy, rent growth)
- Export button → `POST /api/export-memo` → downloads an HTML investment committee memo

---

## Supporting Routes (Static Demo Deal)

These routes serve a pre-loaded demo deal (`backend/data/current_deal.json` — 344-unit suburban Chicago asset) and are independent of the upload pipeline:

| Route | Purpose |
|-------|---------|
| `GET /api/deal` | Returns EnginePayload for the demo deal |
| `POST /api/chat` | Rule-based Q&A about the demo deal (no LLM) |
| `GET /api/negotiation` | Returns price-reduction opportunities derived from CapEx disclosures and DSCR shortfall |
| `POST /api/export-memo` | Generates a formatted HTML investment committee memo |

---

## Summary of External Services

| Service | Purpose | Auth | Fallback |
|---------|---------|------|---------|
| Groq API | LLM extraction of OM data | `GROQ_API_KEY` | Regex patterns |
| RentCast API | Live vacancy + rent growth by ZIP | `RENTCAST_API_KEY` | DuPage County stub |

No other third-party services, databases, queues, or workflow automation tools are used. The entire pipeline executes within a single serverless HTTP request in under 10 seconds on average.
