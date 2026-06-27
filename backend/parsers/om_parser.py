"""
Multifamily Offering Memorandum (OM) parser.

Extracts property metadata from page 1 and financial projection rows from page 52
using pdfplumber coordinate selectors and regex fallbacks. Targets JLL-style OM
layouts (e.g. Ovaltine Apartments — 344 units, suburban Chicago).
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pdfplumber

# ---------------------------------------------------------------------------
# Page 1 coordinate selectors (pdfplumber: x0, top, x1, bottom in page points)
# Tuned for JLL OM landscape layout — 792×612 pt. Cover text sits on the right
# half of the page (x ≈ 526–742, top ≈ 300–430).
# ---------------------------------------------------------------------------
PAGE1_REGIONS: dict[str, tuple[float, float, float, float]] = {
    "title_band": (36, 280, 792, 360),
    "subtitle_band": (36, 360, 792, 430),
    "location_band": (36, 430, 792, 500),
    "footer_band": (36, 500, 792, 612),
}

# ---------------------------------------------------------------------------
# Page 52 coordinate selector — financial projection / pro forma table band.
# Page is landscape (792×612); use full width so value columns are not clipped.
# ---------------------------------------------------------------------------
PAGE52_TABLE_REGION: tuple[float, float, float, float] = (36, 60, 792, 612)

# Financial row labels → normalized JSON keys
FINANCIAL_ROW_PATTERNS: dict[str, list[str]] = {
    "net_operating_income": [
        r"net\s+operating\s+income",
        r"\bNOI\b",
    ],
    "interior_renovation_budget": [
        r"interior\s+renovation(?:\s+(?:budget|cost))?",
        r"unit\s+interior\s+renovation",
        r"renovation\s+(?:budget|cost)",
    ],
}

YEAR1_HEADER_PATTERNS = [
    r"year\s*1",
    r"yr\.?\s*1",
    r"y\s*1\b",
    r"year\s*one",
]


@dataclass(frozen=True)
class ExtractionResult:
    property_metadata: dict[str, Any]
    financial_projections: dict[str, Any]

    def to_json(self) -> dict[str, Any]:
        return {
            "property_metadata": self.property_metadata,
            "financial_projections": self.financial_projections,
        }


# ---------------------------------------------------------------------------
# Text utilities
# ---------------------------------------------------------------------------

def clean_text(raw: str | None) -> str:
    """Normalize whitespace and common PDF encoding artifacts."""
    if not raw:
        return ""
    text = raw.replace("\u00a0", " ").replace("\u2013", "-").replace("\u2014", "-")
    text = re.sub(r"[\t\r\f\v]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def parse_currency(value: str | None) -> int | None:
    """Convert '$6,220,510' or '(841,109)' to integer dollars."""
    if not value:
        return None
    cleaned = clean_text(value)
    negative = cleaned.startswith("(") and cleaned.endswith(")")
    digits = re.sub(r"[^\d.]", "", cleaned)
    if not digits:
        return None
    amount = int(round(float(digits)))
    return -amount if negative else amount


def parse_unit_count(text: str) -> int | None:
    """Extract unit count from phrases like '344 Units' or '344-Unit'."""
    patterns = [
        r"(\d{1,4})\s*[-–]?\s*(?:Unit|Units)\b",
        r"\b(?:Unit|Units)\s*[-–:]?\s*(\d{1,4})\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return int(match.group(1))
    return None


def parse_asset_type(text: str) -> str | None:
    """Extract multifamily asset type descriptor."""
    patterns = [
        r"((?:Class\s+[A-D]\s+)?(?:Garden(?:\s+and|\s*&)?\s+Loft(?:-Style)?\s+)?Multifamily(?:\s+Community)?)",
        r"((?:Class\s+[A-D]\s+)?Multifamily(?:\s+Apartment\s+Community)?)",
        r"(Apartment\s+Community)",
        r"\b(Multifamily)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            label = clean_text(match.group(1))
            return label[0].upper() + label[1:] if label else None
    return None


def parse_location(text: str) -> str | None:
    """Extract suburban Chicago / Villa Park location string."""
    patterns = [
        r"((?:Western\s+)?Suburban\s+Chicago[^,\n]*?(?:,\s*[A-Z]{2})?)",
        r"([A-Za-z\s]+,\s*Illinois(?:,\s*a\s+[^.]+suburb\s+of\s+Chicago)?)",
        r"([A-Za-z\s]+,\s*IL(?:\s*[-–]\s*[^.]*Chicago)?)",
        r"(Villa\s+Park,\s*(?:IL|Illinois)(?:\s*[-–]\s*[^.]*)?)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            return clean_text(match.group(1))
    return None


def parse_property_name(text: str) -> str | None:
    """Heuristic: first title-case line that looks like a property name."""
    for line in text.split("\n"):
        line = clean_text(line)
        if not line or len(line) < 4:
            continue
        if re.search(r"\b(apartments?|residences?|community|village|place|court)\b", line, re.I):
            return line
        if re.match(r"^[A-Z][A-Za-z0-9\s&'.-]{3,}$", line) and not re.search(
            r"\b(units?|multifamily|offering|memorandum|jll)\b", line, re.I
        ):
            return line
    return None


def extract_region_text(page: pdfplumber.page.Page, bbox: tuple[float, float, float, float]) -> str:
    """Crop a page region and return joined word text."""
    cropped = page.within_bbox(bbox)
    words = cropped.extract_words(x_tolerance=3, y_tolerance=3, keep_blank_chars=False)
    if words:
        return clean_text(" ".join(w["text"] for w in words))
    return clean_text(cropped.extract_text() or "")


def find_year1_column_index(header_row: list[str | None]) -> int | None:
    """Locate the Year 1 column in a table header row."""
    for idx, cell in enumerate(header_row):
        if cell and any(re.search(p, cell, re.I) for p in YEAR1_HEADER_PATTERNS):
            return idx
    # Fallback: first numeric year column after label column
    for idx, cell in enumerate(header_row[1:], start=1):
        if cell and re.search(r"\b1\b", cell):
            return idx
    return 1 if len(header_row) > 1 else None


def row_matches_label(row_label: str, patterns: list[str]) -> bool:
    return any(re.search(p, row_label, re.IGNORECASE) for p in patterns)


def extract_financial_value_from_row(
    row: list[str | None], year1_idx: int | None
) -> int | None:
    """Pull Year 1 dollar value from a table row."""
    if year1_idx is not None and year1_idx < len(row):
        val = parse_currency(row[year1_idx])
        if val is not None:
            return val
    # Fallback: first currency-like cell after the label column
    for cell in row[1:]:
        val = parse_currency(cell)
        if val is not None:
            return val
    return None


# ---------------------------------------------------------------------------
# Page extractors
# ---------------------------------------------------------------------------

def extract_page1_metadata(page: pdfplumber.page.Page) -> dict[str, Any]:
    """Extract property metadata from OM cover page using regions + regex."""
    region_texts = {name: extract_region_text(page, bbox) for name, bbox in PAGE1_REGIONS.items()}
    full_text = clean_text(page.extract_text() or "")
    combined = clean_text(" ".join(region_texts.values()) + " " + full_text)

    unit_count = parse_unit_count(combined)
    asset_type = parse_asset_type(combined)
    location = parse_location(combined)
    property_name = parse_property_name(region_texts.get("title_band", "") + "\n" + full_text)

    return {
        "property_name": property_name,
        "unit_count": unit_count,
        "asset_type": asset_type,
        "location": location,
    }


def extract_tables_in_region(
    page: pdfplumber.page.Page, bbox: tuple[float, float, float, float]
) -> list[list[list[str | None]]]:
    """Extract tables cropped to a bounding box."""
    cropped = page.within_bbox(bbox)
    settings = {
        "vertical_strategy": "lines_strict",
        "horizontal_strategy": "lines_strict",
        "intersection_tolerance": 5,
    }
    tables = cropped.extract_tables(table_settings=settings)
    if tables:
        return tables

    # Fallback when line detection fails
    settings["vertical_strategy"] = "text"
    settings["horizontal_strategy"] = "text"
    return cropped.extract_tables(table_settings=settings) or []


def extract_financial_row_from_text(page_text: str, label_patterns: list[str]) -> int | None:
    """Regex fallback: match 'Net Operating Income ... $6,220,510' or '(841,109)' on one line."""
    for pattern in label_patterns:
        # Dollar sign is optional — some rows (e.g. renovation) omit it in the PDF
        row_re = rf"(?:{pattern}).{{0,80}}?(\(?\$?[\d][\d,]+(?:\.\d{{2}})?\)?)"
        match = re.search(row_re, page_text, re.IGNORECASE)
        if match:
            return parse_currency(match.group(1))
    return None


def extract_page52_financials(page: pdfplumber.page.Page) -> dict[str, Any]:
    """Extract Year 1 NOI and interior renovation budget from financial projections."""
    page_text = clean_text(page.extract_text() or "")
    tables = extract_tables_in_region(page, PAGE52_TABLE_REGION)

    year1_idx: int | None = None
    extracted_rows: dict[str, int | None] = {key: None for key in FINANCIAL_ROW_PATTERNS}

    for table in tables:
        if not table:
            continue

        # Detect header row with Year 1
        for row_idx, row in enumerate(table[:5]):
            cleaned_row = [clean_text(c) if c else None for c in row]
            idx = find_year1_column_index(cleaned_row)
            if idx is not None:
                year1_idx = idx
                data_rows = table[row_idx + 1 :]
                break
        else:
            data_rows = table

        for row in data_rows:
            if not row:
                continue
            cleaned_row = [clean_text(c) if c else None for c in row]
            label = cleaned_row[0] or ""
            if not label:
                continue

            for key, patterns in FINANCIAL_ROW_PATTERNS.items():
                if extracted_rows[key] is not None:
                    continue
                if row_matches_label(label, patterns):
                    extracted_rows[key] = extract_financial_value_from_row(
                        cleaned_row, year1_idx
                    )

    # Regex fallbacks on full page text
    for key, patterns in FINANCIAL_ROW_PATTERNS.items():
        if extracted_rows[key] is None:
            extracted_rows[key] = extract_financial_row_from_text(page_text, patterns)

    noi = extracted_rows["net_operating_income"]
    renovation = extracted_rows["interior_renovation_budget"]

    return {
        "year_1": {
            "net_operating_income_usd": noi,
        },
        "capital_expenditures": {
            "interior_renovation_budget_usd": renovation,
        },
        "rows": [
            {
                "label": "Net Operating Income",
                "year_1_usd": noi,
            },
            {
                "label": "Interior Renovation Budget",
                "year_1_usd": renovation,
            },
        ],
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def parse_om(pdf_path: str | Path) -> dict[str, Any]:
    """
    Parse a multifamily OM PDF and return standardized JSON-ready dict.

    Reads page 1 (index 0) for property metadata and page 52 (index 51)
    for financial projection rows.
    """
    path = Path(pdf_path)
    if not path.is_file():
        raise FileNotFoundError(f"PDF not found: {path}")

    with pdfplumber.open(path) as pdf:
        if len(pdf.pages) < 1:
            raise ValueError("PDF has no pages")

        page1 = pdf.pages[0]
        property_metadata = extract_page1_metadata(page1)

        financial_projections: dict[str, Any] = {
            "year_1": {"net_operating_income_usd": None},
            "capital_expenditures": {"interior_renovation_budget_usd": None},
            "rows": [],
        }
        if len(pdf.pages) >= 52:
            financial_projections = extract_page52_financials(pdf.pages[51])
        else:
            financial_projections["error"] = (
                f"Document has {len(pdf.pages)} pages; page 52 required for financials"
            )

    return {
        "source_document": str(path.resolve()),
        "extracted_at": datetime.now(timezone.utc).isoformat(),
        "property_metadata": property_metadata,
        "financial_projections": financial_projections,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract property metadata and financial projections from a multifamily OM PDF."
    )
    parser.add_argument("pdf_path", type=Path, help="Path to the OM PDF file")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Write JSON to this file (default: stdout)",
    )
    args = parser.parse_args()

    result = parse_om(args.pdf_path)
    payload = json.dumps(result, indent=2, ensure_ascii=False)

    if args.output:
        args.output.write_text(payload + "\n", encoding="utf-8")
        print(f"Wrote {args.output}")
    else:
        print(payload)


if __name__ == "__main__":
    main()
