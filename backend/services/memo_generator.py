"""
Generate a professional Go / No-Go investment memo PDF from reviewed deal data.

Uses ReportLab to produce a five-section report aligned with the MultifamilyIQ
dashboard: Demand Analysis, Financial Strength, Operating Efficiency,
Market Alignment, and Capital Position.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import (
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from backend.engine.risk_rules import (  # noqa: E402
    DEFAULT_DEBT_RATE,
    calculate_dscr,
    evaluate_risk_flags,
    get_loan_amount_usd,
    get_pro_forma_rent_growth_pct,
    get_submarket_rent_growth_avg_pct,
    get_year1_noi,
    load_deal_payload,
    score_deal,
)

DEFAULT_DEAL_PATH = Path(__file__).resolve().parents[1] / "data" / "current_deal.json"
DEFAULT_OUTPUT_DIR = Path(__file__).resolve().parents[1] / "output"

SECTION_KEYS = ("demand", "financial", "operating", "market", "capital")

SECTION_TITLES: dict[str, str] = {
    "demand": "Demand Analysis",
    "financial": "Financial Strength",
    "operating": "Operating Efficiency",
    "market": "Market Alignment",
    "capital": "Capital Position",
}

# Brand palette
NAVY = colors.HexColor("#1e293b")
SLATE = colors.HexColor("#475569")
ACCENT = colors.HexColor("#2563eb")
GO_GREEN = colors.HexColor("#16a34a")
CAUTION_AMBER = colors.HexColor("#d97706")
NO_GO_RED = colors.HexColor("#dc2626")
LIGHT_BG = colors.HexColor("#f8fafc")
BORDER = colors.HexColor("#e2e8f0")


def verdict_from_score(score: int) -> tuple[str, colors.Color]:
    if score < 35:
        return "NO-GO", NO_GO_RED
    if score < 65:
        return "CAUTION", CAUTION_AMBER
    return "GO", GO_GREEN


def _fmt_usd(value: float | int | None) -> str:
    if value is None:
        return "N/A"
    return f"${float(value):,.0f}"


def _fmt_pct(value: float | None, decimals: int = 1) -> str:
    if value is None:
        return "N/A"
    return f"{float(value):.{decimals}f}%"


def _section_overrides(overrides: dict[str, Any] | None, key: str) -> dict[str, Any]:
    if not overrides:
        return {}
    sections = overrides.get("sections") or {}
    return sections.get(key) or {}


def _global_notes(overrides: dict[str, Any] | None) -> str | None:
    if not overrides:
        return None
    return overrides.get("analyst_notes") or overrides.get("custom_notes")


def _verdict_override(overrides: dict[str, Any] | None, score: int) -> tuple[str, colors.Color]:
    if overrides and overrides.get("verdict"):
        label = str(overrides["verdict"]).upper()
        color_map = {"GO": GO_GREEN, "NO-GO": NO_GO_RED, "CAUTION": CAUTION_AMBER}
        return label, color_map.get(label, SLATE)
    return verdict_from_score(score)


def build_section_content(
    deal: dict[str, Any],
    flags: list[dict[str, Any]],
    overrides: dict[str, Any] | None = None,
) -> dict[str, dict[str, Any]]:
    """Build narrative body and metric bullets for each memo section."""
    meta = deal.get("property_metadata") or {}
    market = deal.get("market_context") or {}
    derived = deal.get("derived_metrics") or {}
    fins = deal.get("financial_projections") or {}
    occ = market.get("submarket_occupancy") or {}
    rent = market.get("rent_growth_trailing_3yr") or {}
    pipeline = (market.get("construction_pipeline") or {}).get("summary") or {}

    noi = get_year1_noi(deal)
    dscr = calculate_dscr(deal)
    loan = get_loan_amount_usd(deal)
    pro_forma = get_pro_forma_rent_growth_pct(deal)
    submarket_rent = get_submarket_rent_growth_avg_pct(deal)
    rent_gap = round(pro_forma - submarket_rent, 2)
    units = meta.get("unit_count") or 0
    submarket = market.get("submarket") or "Submarket"
    reno = abs(fins.get("capital_expenditures", {}).get("interior_renovation_budget_usd") or 0)
    reno_per_unit = derived.get("reno_cost_per_unit_usd")
    noi_per_unit = derived.get("noi_per_unit_usd")
    net_cf = derived.get("net_cash_flow_after_capex_usd")
    pipeline_units = pipeline.get("delivering_through_2027_units") or pipeline.get("total_pipeline_units") or 0

    dscr_flags = [f for f in flags if f.get("id", "").startswith("dscr")]
    rent_flags = [f for f in flags if f.get("id", "").startswith("rent")]
    vacancy_flags = [f for f in flags if f.get("id", "").startswith("vacancy")]

    sections: dict[str, dict[str, Any]] = {
        "demand": {
            "body": (
                f"{submarket} submarket fundamentals reflect {occ.get('average_occupancy_pct', 0):.1f}% "
                f"average occupancy with economic vacancy at {occ.get('economic_vacancy_pct', 0):.1f}%. "
                f"Trailing 12-month occupancy change of {occ.get('trailing_12mo_change_bps', 0)} bps signals "
                f"{'softening demand' if (occ.get('trailing_12mo_change_bps') or 0) < 0 else 'stable absorption'}. "
                f"The construction pipeline includes {pipeline_units:,} units delivering through 2027, "
                f"which will influence concession levels and lease-up velocity over the next 24 months."
            ),
            "metrics": [
                ("Submarket", submarket),
                ("Avg. Occupancy", _fmt_pct(occ.get("average_occupancy_pct"))),
                ("Economic Vacancy", _fmt_pct(occ.get("economic_vacancy_pct"))),
                ("T-12 Occ. Change", f"{occ.get('trailing_12mo_change_bps', 0)} bps"),
                ("Pipeline Units (2027)", f"{pipeline_units:,}"),
            ],
            "flags": vacancy_flags,
        },
        "financial": {
            "body": (
                f"Year-1 net operating income is {_fmt_usd(noi)} against assumed "
                f"{_fmt_usd(loan)} senior debt. Pro-forma DSCR of {dscr:.2f}x "
                f"{'falls below' if dscr < 1.25 else 'meets or exceeds'} the 1.25x agency covenant benchmark. "
                f"{'Critical refinance and covenant risk is present.' if dscr < 1.15 else ''}"
                f"{'Limited debt-service cushion remains for rate volatility.' if dscr < 1.25 else ' Debt service coverage appears adequate at entry.'}"
            ),
            "metrics": [
                ("Year-1 NOI", _fmt_usd(noi)),
                ("Loan Amount", _fmt_usd(loan)),
                ("DSCR", f"{dscr:.2f}x"),
                ("Debt Rate (assumed)", f"{DEFAULT_DEBT_RATE * 100:.2f}% IO"),
                ("Annual Debt Service", _fmt_usd(loan * DEFAULT_DEBT_RATE)),
            ],
            "flags": dscr_flags,
        },
        "operating": {
            "body": (
                f"The {units}-unit asset generates {_fmt_usd(noi_per_unit)} NOI per unit at Year 1. "
                f"Net cash flow after interior renovation spend is {_fmt_usd(net_cf)}. "
                f"Interior renovation is budgeted at {_fmt_usd(reno)} "
                f"({_fmt_usd(reno_per_unit)}/unit), which {'supports' if reno else 'does not support'} "
                f"the value-add execution plan outlined in the OM."
            ),
            "metrics": [
                ("Unit Count", str(units)),
                ("NOI / Unit", _fmt_usd(noi_per_unit)),
                ("Reno Budget / Unit", _fmt_usd(reno_per_unit)),
                ("Total Reno Budget", _fmt_usd(reno)),
                ("Net CF After CapEx", _fmt_usd(net_cf)),
            ],
            "flags": [],
        },
        "market": {
            "body": (
                f"Sponsor underwrites {pro_forma:.1f}% annual rent growth versus a "
                f"{submarket_rent:.1f}% historical 3-year submarket average — a gap of "
                f"{rent_gap:.1f} percentage points. Trailing 12-month market rent growth is "
                f"{rent.get('trailing_12mo_pct', 'N/A')}%. "
                f"{'Rent growth assumptions appear disconnected from submarket trends.' if rent_gap > 2 else 'Rent growth assumptions are broadly aligned with market history.'} "
                f"Elevated supply of {pipeline_units:,} pipeline units may compress achievable rent bumps."
            ),
            "metrics": [
                ("Pro-forma Rent Growth", _fmt_pct(pro_forma)),
                ("Submarket 3-Yr Avg", _fmt_pct(submarket_rent)),
                ("Rent Growth Gap", f"{rent_gap:.1f} pts"),
                ("T-12 Market Rent Growth", _fmt_pct(rent.get("trailing_12mo_pct"))),
                ("3-Yr CAGR", _fmt_pct(rent.get("trailing_3yr_cagr_pct"))),
            ],
            "flags": rent_flags,
        },
        "capital": {
            "body": (
                f"Capital stack assumes {_fmt_usd(loan)} debt financing on Year-1 NOI of {_fmt_usd(noi)}. "
                f"Interior renovation capital of {_fmt_usd(reno)} ({_fmt_usd(reno_per_unit)}/unit) "
                f"is {'allocated in the OM' if reno else 'not identified in the OM'}. "
                f"Post-renovation net cash flow of {_fmt_usd(net_cf)} defines the Year-1 capital "
                f"position after value-add spend."
            ),
            "metrics": [
                ("Senior Loan", _fmt_usd(loan)),
                ("Interior Reno Budget", _fmt_usd(reno)),
                ("Reno / Unit", _fmt_usd(reno_per_unit)),
                ("Year-1 NOI", _fmt_usd(noi)),
                ("Net CF After CapEx", _fmt_usd(net_cf)),
            ],
            "flags": dscr_flags + rent_flags,
        },
    }

    for key in SECTION_KEYS:
        sec_override = _section_overrides(overrides, key)
        if sec_override.get("body_override"):
            sections[key]["body"] = sec_override["body_override"]
        elif sec_override.get("body"):
            sections[key]["body"] = sec_override["body"]
        if sec_override.get("notes"):
            sections[key]["analyst_notes"] = sec_override["notes"]

    return sections


class MemoDocTemplate(SimpleDocTemplate):
    """SimpleDocTemplate with property name + page footer."""

    def __init__(self, *args: Any, property_name: str = "", **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self.property_name = property_name

    def afterPage(self) -> None:
        self.canv.saveState()
        self.canv.setFont("Helvetica", 8)
        self.canv.setFillColor(SLATE)
        self.canv.drawString(
            self.leftMargin,
            0.45 * inch,
            f"MultifamilyIQ  |  Confidential  |  {self.property_name[:60]}",
        )
        self.canv.drawRightString(
            self.pagesize[0] - self.rightMargin,
            0.45 * inch,
            f"Page {self.page}",
        )
        self.canv.restoreState()


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "MemoTitle",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=22,
            textColor=NAVY,
            spaceAfter=12,
            alignment=TA_LEFT,
        ),
        "subtitle": ParagraphStyle(
            "MemoSubtitle",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=11,
            textColor=SLATE,
            spaceAfter=6,
        ),
        "section": ParagraphStyle(
            "SectionHead",
            parent=base["Heading1"],
            fontName="Helvetica-Bold",
            fontSize=16,
            textColor=NAVY,
            spaceBefore=6,
            spaceAfter=10,
            borderPadding=4,
        ),
        "body": ParagraphStyle(
            "Body",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=10,
            leading=14,
            textColor=NAVY,
            spaceAfter=8,
        ),
        "bullet": ParagraphStyle(
            "Bullet",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=SLATE,
            leftIndent=12,
            spaceAfter=4,
        ),
        "note_label": ParagraphStyle(
            "NoteLabel",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=9,
            textColor=ACCENT,
            spaceAfter=4,
        ),
        "note_body": ParagraphStyle(
            "NoteBody",
            parent=base["Normal"],
            fontName="Helvetica-Oblique",
            fontSize=9,
            leading=13,
            textColor=SLATE,
            spaceAfter=6,
        ),
        "flag": ParagraphStyle(
            "Flag",
            parent=base["Normal"],
            fontName="Helvetica",
            fontSize=9,
            leading=13,
            textColor=NO_GO_RED,
            leftIndent=8,
            spaceAfter=4,
        ),
        "cover_center": ParagraphStyle(
            "CoverCenter",
            parent=base["Normal"],
            fontName="Helvetica-Bold",
            fontSize=14,
            textColor=NAVY,
            alignment=TA_CENTER,
            spaceAfter=8,
        ),
        "verdict": ParagraphStyle(
            "Verdict",
            parent=base["Title"],
            fontName="Helvetica-Bold",
            fontSize=28,
            alignment=TA_CENTER,
            spaceAfter=12,
        ),
    }


def _metrics_table(rows: list[tuple[str, str]], styles: dict[str, ParagraphStyle]) -> Table:
    data = [[Paragraph(f"<b>{label}</b>", styles["bullet"]), Paragraph(value, styles["bullet"])] for label, value in rows]
    table = Table(data, colWidths=[2.2 * inch, 3.8 * inch])
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
                ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
                ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ]
        )
    )
    return table


def _note_box(text: str, styles: dict[str, ParagraphStyle]) -> list[Any]:
    return [
        Spacer(1, 0.1 * inch),
        Paragraph("Analyst Notes", styles["note_label"]),
        Paragraph(text.replace("\n", "<br/>"), styles["note_body"]),
    ]


def _flags_block(flags: list[dict[str, Any]], styles: dict[str, ParagraphStyle]) -> list[Any]:
    if not flags:
        return []
    flow: list[Any] = [
        Spacer(1, 0.08 * inch),
        Paragraph("<b>Triggered Risk Flags</b>", styles["note_label"]),
    ]
    for flag in flags:
        sev = flag.get("severity", "Risk")
        title = flag.get("title", "Flag")
        flow.append(
            Paragraph(f"• [{sev}] {title}: {flag.get('justification', '')}", styles["flag"])
        )
    return flow


def generate_investment_memo(
    deal: dict[str, Any],
    *,
    flags: list[dict[str, Any]] | None = None,
    score: int | None = None,
    overrides: dict[str, Any] | None = None,
    output_path: str | Path | None = None,
    debt_rate: float = DEFAULT_DEBT_RATE,
) -> Path:
    """
    Render a Go / No-Go investment memo PDF.

    Parameters
    ----------
    deal:
        Merged deal payload (e.g. from backend/data/current_deal.json).
    flags:
        Triggered risk flags; computed via risk_rules if omitted.
    score:
        Composite 0-100 score; computed if omitted.
    overrides:
        Optional frontend overrides / custom notes::

            {
              "verdict": "NO-GO",
              "analyst_notes": "Global reviewer comment",
              "sections": {
                "demand": {"notes": "...", "body_override": "..."},
                ...
              }
            }
    output_path:
        Destination PDF path. Defaults to backend/output/<property>_memo.pdf.
    """
    if flags is None:
        flags = evaluate_risk_flags(deal, debt_rate=debt_rate)
    if score is None:
        score = score_deal(flags)

    meta = deal.get("property_metadata") or {}
    property_name = meta.get("property_name") or "Multifamily Investment"
    location = meta.get("location") or ""
    units = meta.get("unit_count")
    asset_type = meta.get("asset_type") or "Multifamily"

    verdict_label, verdict_color = _verdict_override(overrides, score)
    sections = build_section_content(deal, flags, overrides)

    if output_path is None:
        DEFAULT_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        slug = "".join(c if c.isalnum() else "_" for c in property_name[:40]).strip("_").lower()
        output_path = DEFAULT_OUTPUT_DIR / f"{slug or 'deal'}_memo.pdf"
    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    styles = _styles()
    doc = MemoDocTemplate(
        str(out),
        pagesize=letter,
        property_name=property_name,
        rightMargin=0.75 * inch,
        leftMargin=0.75 * inch,
        topMargin=0.75 * inch,
        bottomMargin=0.65 * inch,
    )

    story: list[Any] = []

    # ---- Cover page ----
    story.append(Spacer(1, 0.6 * inch))
    story.append(Paragraph("Investment Committee Memo", styles["cover_center"]))
    story.append(Spacer(1, 0.15 * inch))
    story.append(Paragraph(property_name, styles["title"]))
    story.append(
        Paragraph(
            f"{asset_type}  ·  {units or '—'} units  ·  {location}",
            styles["subtitle"],
        )
    )
    story.append(Spacer(1, 0.35 * inch))

    verdict_style = ParagraphStyle(
        "VerdictDynamic",
        parent=styles["verdict"],
        textColor=verdict_color,
    )
    story.append(Paragraph(verdict_label, verdict_style))
    story.append(
        Paragraph(
            f"Composite Risk Score: {score}/100",
            ParagraphStyle(
                "ScoreLine",
                parent=styles["cover_center"],
                fontSize=12,
                textColor=SLATE,
            ),
        )
    )
    story.append(Spacer(1, 0.25 * inch))

    cover_summary = (
        f"Generated {datetime.now(timezone.utc).strftime('%B %d, %Y')} UTC  ·  "
        f"{len(flags)} risk flag{'s' if len(flags) != 1 else ''} triggered  ·  "
        f"Source: {Path(deal.get('source_pdf', 'OM')).name}"
    )
    story.append(Paragraph(cover_summary, styles["subtitle"]))

    global_notes = _global_notes(overrides)
    if global_notes:
        story.extend(_note_box(global_notes, styles))

    if flags:
        story.append(Spacer(1, 0.2 * inch))
        story.append(Paragraph("<b>Executive Risk Summary</b>", styles["note_label"]))
        for flag in flags:
            story.append(
                Paragraph(
                    f"• {flag.get('title', 'Risk')}: {flag.get('justification', '')}",
                    styles["body"],
                )
            )

    story.append(PageBreak())

    # ---- Five report sections (one page each) ----
    for idx, key in enumerate(SECTION_KEYS):
        title = SECTION_TITLES[key]
        section = sections[key]

        story.append(Paragraph(f"{idx + 1}. {title}", styles["section"]))
        story.append(
            Table(
                [[""]],
                colWidths=[6.5 * inch],
                rowHeights=[2],
                style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), ACCENT)]),
            )
        )
        story.append(Spacer(1, 0.12 * inch))
        story.append(Paragraph(section["body"], styles["body"]))
        story.append(Spacer(1, 0.1 * inch))
        story.append(_metrics_table(section["metrics"], styles))

        if section.get("analyst_notes"):
            story.extend(_note_box(section["analyst_notes"], styles))

        story.extend(_flags_block(section.get("flags") or [], styles))

        if idx < len(SECTION_KEYS) - 1:
            story.append(PageBreak())

    doc.build(story)
    return out


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a Go / No-Go investment memo PDF from deal data and optional overrides."
    )
    parser.add_argument(
        "--deal",
        type=Path,
        default=DEFAULT_DEAL_PATH,
        help=f"Path to merged deal JSON (default: {DEFAULT_DEAL_PATH})",
    )
    parser.add_argument(
        "--overrides",
        type=Path,
        default=None,
        help="Optional JSON file with verdict / section notes / body overrides from the dashboard",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=None,
        help="Output PDF path (default: backend/output/<deal>_memo.pdf)",
    )
    parser.add_argument(
        "--debt-rate",
        type=float,
        default=DEFAULT_DEBT_RATE,
        help="Annual debt rate for DSCR (default: 0.096)",
    )
    args = parser.parse_args()

    deal = load_deal_payload(args.deal)
    overrides: dict[str, Any] | None = None
    if args.overrides:
        overrides = json.loads(args.overrides.read_text(encoding="utf-8"))

    flags = evaluate_risk_flags(deal, debt_rate=args.debt_rate)
    score = score_deal(flags)
    path = generate_investment_memo(
        deal,
        flags=flags,
        score=score,
        overrides=overrides,
        output_path=args.out,
        debt_rate=args.debt_rate,
    )
    print(f"Wrote {path}")
    print(f"  Verdict : {verdict_from_score(score)[0]} ({score}/100)")
    print(f"  Flags   : {len(flags)}")


if __name__ == "__main__":
    main()
