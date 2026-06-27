# MultifamilyIQ — Deal Analysis Agent

A multifamily real estate underwriting tool that parses Offering Memoranda, runs a risk rule engine, and generates PDF deal memos. Built with TanStack Start (React SSR) on the frontend and Python on the backend.

---

## Prerequisites

- **Node.js** 18+ and **npm**
- **Python** 3.10+

---

## 1. Python Virtual Environment Setup

All Python dependencies (PDF parsing, PDF generation) must be installed inside a virtual environment.

### Create and activate the venv

**macOS / Linux**
```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows (PowerShell)**
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

**Windows (Command Prompt)**
```cmd
python -m venv venv
venv\Scripts\activate.bat
```

> The venv directory is already present in this repo. If it already exists, just activate it — you don't need to recreate it.

### Install Python dependencies

With the venv active:

```bash
pip install -r backend/requirements.txt
```

This installs:
- `pdfplumber` — PDF text and table extraction
- `reportlab` — PDF generation for deal memos

### Verify

```bash
python -c "import pdfplumber, reportlab; print('OK')"
```

---

## 2. Node.js Dependencies

```bash
npm install
```

---

## 3. Ingest a Deal (Run the Python Pipeline)

These steps populate `backend/data/current_deal.json`, which the dashboard and risk engine read at runtime.

### Step 1 — Parse the Offering Memorandum

```bash
python backend/parsers/om_parser.py "Hackathon OM.pdf"
```

Prints a JSON payload with `unit_count`, `noi`, `renovation_cost`, and property metadata. Verify:
- `unit_count`: 344
- `noi`: 6,220,510
- `interior_renovation_cost`: 841,109

### Step 2 — Merge OM + Market Data

```bash
python backend/scripts/merge_deal_data.py "Hackathon OM.pdf"
```

Calls `om_parser.py` and `backend/services/market_data.py`, then writes the combined payload to `backend/data/current_deal.json`.

### Step 3 — Run the Risk Engine (optional smoke test)

```bash
python backend/engine/risk_rules.py
```

Reads `backend/data/current_deal.json` and prints a JSON object with the composite risk `score` (0–100) and all triggered `flags`.

---

## 4. Run the Development Server

```bash
npm run dev
```

Opens at [http://localhost:8080](http://localhost:8080).

The dashboard loads `current_deal.json` via the `/api/deal` route, runs the TypeScript risk engine, and renders the full UI including the Flag Feed, Risk Score gauge, and Why-Not Panel.

---

## 5. Export a PDF Deal Memo

1. Open [http://localhost:8080](http://localhost:8080) in your browser.
2. (Optional) Type analyst notes into the text area in the Actions panel.
3. Click **Export PDF Deal Memo**.

The button calls `POST /api/export-memo`, which spawns `backend/services/memo_generator.py` as a subprocess, generates the PDF, and streams it back to the browser as a file download (`deal-memo.pdf`).

---

## Project Structure

```
backend/
  data/
    current_deal.json       # merged deal payload (generated)
  engine/
    risk_rules.py           # Python risk rule engine (0-100 score)
  output/                   # generated PDF memos
  parsers/
    om_parser.py            # pdfplumber-based OM extractor
  scripts/
    merge_deal_data.py      # merges OM + market data -> current_deal.json
  services/
    market_data.py          # mock market context provider
    memo_generator.py       # ReportLab PDF generator
  requirements.txt

src/
  lib/
    risk-engine.ts          # TypeScript mirror of the Python risk engine
  routes/
    index.tsx               # Dashboard (main UI)
    api/
      deal.ts               # GET /api/deal — serves current_deal.json
      export-memo.ts        # POST /api/export-memo — spawns memo_generator.py

venv/                       # Python virtual environment (not committed to git)
```

---

## Other npm Scripts

| Command | Description |
|---|---|
| `npm run dev` | Start Vite dev server with HMR on port 8080 |
| `npm run build` | Production build |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |
| `npm run format` | Run Prettier |
