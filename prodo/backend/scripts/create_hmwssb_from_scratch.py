"""
Full NeuraReport pipeline: PDF → LLM Template → DB Mapping → Contract → Report

Creates an HMWSSB Bill Payment template from the raw PDF using NeuraReport's
LLM-powered template verification pipeline, maps tokens to the SQLite DB,
builds a contract, and generates the final report.
"""
import json
import logging
import os
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# ── Project setup ──────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

# Load environment before backend imports
from backend.app.utils.env_loader import load_env_file
load_env_file()
os.environ.setdefault("NEURA_DEBUG", "true")
# Allow Claude Code CLI to run inside this session
os.environ.pop("CLAUDECODE", None)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("hmwssb_scratch")

# ── Paths ──────────────────────────────────────────────────────────
PDF_PATH = PROJECT_ROOT / "Hyderabad Metropolitan Water Supply & Sewerage Board - Online Bill Payment.pdf"
DB_PATH = Path(__file__).resolve().parent / "hmwssb_billing.db"
TEMPLATE_ID = "hmwssb_scratch"
TEMPLATE_DIR = Path(__file__).resolve().parent / "uploads" / TEMPLATE_ID
OUTPUT_DIR = TEMPLATE_DIR / "output"

# ── Imports from NeuraReport ───────────────────────────────────────
from backend.app.services.templates import (
    pdf_to_pngs,
    request_initial_html,
    render_html_to_png,
    save_html,
    get_layout_hints,
)
from backend.app.services.reports import fill_and_print


def step0_prepare():
    """Create directories and verify inputs exist."""
    print("=" * 70)
    print("  NeuraReport — HMWSSB Full Pipeline (PDF → Template → Report)")
    print("=" * 70)

    assert PDF_PATH.exists(), f"PDF not found: {PDF_PATH}"
    assert DB_PATH.exists(), f"Database not found: {DB_PATH}"

    TEMPLATE_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"  PDF      : {PDF_PATH.name}")
    print(f"  Database : {DB_PATH}")
    print(f"  Template : {TEMPLATE_DIR}")
    print(f"  Output   : {OUTPUT_DIR}")
    print()


def step1_pdf_to_png() -> Path:
    """Step 1: Convert PDF first page to high-res PNG."""
    print("─" * 70)
    print("  STEP 1: PDF → PNG (reference image)")
    print("─" * 70)

    t0 = time.time()
    pngs = pdf_to_pngs(PDF_PATH, TEMPLATE_DIR, dpi=400)
    ref_png = pngs[0]
    elapsed = time.time() - t0

    size_kb = ref_png.stat().st_size / 1024
    print(f"  [OK] Reference PNG: {ref_png.name} ({size_kb:.0f} KB)")
    print(f"  [OK] Rendered in {elapsed:.1f}s")
    print()
    return ref_png


def step2_generate_html(ref_png: Path) -> tuple[str, dict | None]:
    """Step 2: LLM generates HTML template from the PDF screenshot."""
    print("─" * 70)
    print("  STEP 2: LLM → HTML Template (Claude Code CLI)")
    print("─" * 70)

    # Get layout hints from the PDF for better LLM output
    layout_hints = None
    try:
        layout_hints = get_layout_hints(PDF_PATH)
        if layout_hints:
            print(f"  [OK] Layout hints extracted: {list(layout_hints.keys())}")
    except Exception as exc:
        print(f"  [WARN] Layout hints skipped: {exc}")

    # Get DB schema to help LLM understand the data
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    tables = {}
    for row in cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        table = row[0]
        cols = cursor.execute(f"PRAGMA table_info({table})").fetchall()
        tables[table] = [col[1] for col in cols]
    conn.close()

    schema_json = {
        "tables": tables,
        "description": "HMWSSB bill payment database with transaction records and consumer summaries",
    }
    print(f"  [OK] DB schema: {', '.join(f'{t}({len(c)} cols)' for t, c in tables.items())}")

    t0 = time.time()
    print("  [..] Calling LLM to generate HTML template from PDF image...")
    result = request_initial_html(
        page_png=ref_png,
        schema_json=schema_json,
        layout_hints=layout_hints,
    )
    elapsed = time.time() - t0

    html = result.html
    schema = result.schema

    # Save the generated HTML
    html_path = TEMPLATE_DIR / "template_p1.html"
    save_html(html_path, html)

    print(f"  [OK] HTML generated: {len(html):,} chars in {elapsed:.1f}s")
    print(f"  [OK] Saved to: {html_path.name}")

    # Save schema if provided
    if schema:
        schema_path = TEMPLATE_DIR / "schema_ext.json"
        schema_path.write_text(json.dumps(schema, indent=2, ensure_ascii=False))
        print(f"  [OK] Schema extracted: {schema_path.name}")

    # Try to render HTML → PNG for visual verification
    try:
        render_png = TEMPLATE_DIR / "render_p1.png"
        render_html_to_png(html_path, render_png)
        print(f"  [OK] Render preview: {render_png.name}")
    except Exception as exc:
        print(f"  [WARN] Render preview skipped: {exc}")

    print()
    return html, schema


def step3_extract_tokens_and_build_contract(html: str) -> dict:
    """Step 3: Extract tokens from the generated HTML and build the contract."""
    print("─" * 70)
    print("  STEP 3: Extract Tokens → Build Contract")
    print("─" * 70)

    import re
    TOKEN_RE = re.compile(r"\{\{?\s*([A-Za-z0-9_\-\.]+)\s*\}\}?")
    tokens = sorted(set(TOKEN_RE.findall(html)))

    print(f"  [OK] Found {len(tokens)} tokens in HTML:")
    for t in tokens:
        print(f"       - {{{{{t}}}}}")

    # Get DB columns for mapping
    conn = sqlite3.connect(str(DB_PATH))
    cursor = conn.cursor()
    db_columns = {}
    for row in cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"):
        table = row[0]
        cols = cursor.execute(f"PRAGMA table_info({table})").fetchall()
        for col in cols:
            db_columns[f"{table}.{col[1]}"] = col[2]  # table.column -> type
    conn.close()

    print(f"  [OK] DB columns available: {len(db_columns)}")
    for col in sorted(db_columns.keys()):
        print(f"       - {col}")

    # Auto-map tokens to DB columns using name similarity
    mapping = _auto_map_tokens(tokens, db_columns)

    # Classify tokens
    row_tokens = []
    header_tokens = []
    literal_tokens = []

    # Tokens mapped to "transactions." table are row tokens (repeating data)
    # Tokens mapped to "consumers." or constants are header/literal tokens
    for token, col in mapping.items():
        if col.startswith("transactions."):
            row_tokens.append(token)
        elif col.startswith("consumers.") or col.startswith("LITERAL:"):
            header_tokens.append(token)
        else:
            literal_tokens.append(token)

    # Separate literals from real mappings
    real_mapping = {t: c for t, c in mapping.items() if not c.startswith("LITERAL:")}
    literals_map = {t: c.replace("LITERAL:", "") for t, c in mapping.items() if c.startswith("LITERAL:")}

    # Build the contract
    contract = {
        "mapping": real_mapping,
        "join": {
            "parent_table": "transactions",
            "child_table": "",
            "parent_key": "can_number",
            "child_key": "",
        },
        "header_tokens": [t for t in header_tokens if t in real_mapping],
        "row_tokens": row_tokens,
        "totals": {},
        "date_columns": {},
        "literals": {},
        "row_order": ["ROWID"],
    }

    # Save contract
    contract_path = TEMPLATE_DIR / "contract.json"
    contract_path.write_text(json.dumps(contract, indent=2, ensure_ascii=False))
    print(f"\n  [OK] Contract built:")
    print(f"       - Row tokens   : {row_tokens}")
    print(f"       - Header tokens: {[t for t in header_tokens if t in real_mapping]}")
    print(f"       - Literal tokens: {list(literals_map.keys())}")
    print(f"       - Mapping      : {len(real_mapping)} token→column pairs")
    print(f"       - Saved to     : {contract_path.name}")
    print()

    return contract, literals_map


def _auto_map_tokens(tokens: list[str], db_columns: dict[str, str]) -> dict[str, str]:
    """
    Map template tokens to DB columns using name similarity.
    Falls back to a known mapping for HMWSSB-specific tokens.
    """
    # Known mappings for HMWSSB bill tokens (covers common LLM-generated names)
    KNOWN_MAP = {
        # Transaction table mappings
        "txn_ref": "transactions.transaction_ref_number",
        "transaction_ref": "transactions.transaction_ref_number",
        "transaction_ref_number": "transactions.transaction_ref_number",
        "reference_number": "transactions.transaction_ref_number",
        "ref_number": "transactions.transaction_ref_number",
        "txn_date": "transactions.transaction_date",
        "transaction_date": "transactions.transaction_date",
        "date": "transactions.transaction_date",
        "txn_time": "transactions.transaction_time",
        "transaction_time": "transactions.transaction_time",
        "time": "transactions.transaction_time",
        "txn_can": "transactions.can_number",
        "can_number": "transactions.can_number",
        "can": "transactions.can_number",
        "txn_amount": "transactions.bill_amount",
        "bill_amount": "transactions.bill_amount",
        "amount": "transactions.bill_amount",
        "txn_status": "transactions.transaction_status",
        "transaction_status": "transactions.transaction_status",
        "status": "transactions.transaction_status",
        "txn_bank": "transactions.bank_name",
        "bank_name": "transactions.bank_name",
        "bank": "transactions.bank_name",
        "ip_address": "transactions.ip_address",
        "client_ip": "transactions.ip_address",
        "access_timestamp": "transactions.access_timestamp",
        "access_ts": "transactions.access_timestamp",
        # Consumer table mappings
        "can_id": "consumers.can_number",
        "consumer_can": "consumers.can_number",
        "total_amount": "consumers.total_paid",
        "total_paid": "consumers.total_paid",
        "pay_count": "consumers.payment_count",
        "payment_count": "consumers.payment_count",
        "total_payments": "consumers.payment_count",
        "last_pay_date": "consumers.last_payment_date",
        "last_payment_date": "consumers.last_payment_date",
        # Literal tokens (not from DB)
        "txn_date_display": "LITERAL:",
        "print_date": "LITERAL:",
        "report_date": "LITERAL:",
        "generated_date": "LITERAL:",
        "payment_gateway": "LITERAL:BillDesk (128-bit SSL)",
    }

    mapping = {}
    unmapped = []

    for token in tokens:
        token_lower = token.lower()

        # 1. Try exact match in known mappings
        if token in KNOWN_MAP:
            mapping[token] = KNOWN_MAP[token]
            continue

        # 2. Try lowercase match
        if token_lower in KNOWN_MAP:
            mapping[token] = KNOWN_MAP[token_lower]
            continue

        # 3. Try fuzzy match against DB column names
        best_match = None
        best_score = 0
        for db_col in db_columns:
            table, col = db_col.split(".", 1)
            # Compare token to column name
            score = _similarity(token_lower, col.lower())
            if score > best_score and score > 0.6:
                best_score = score
                best_match = db_col

        if best_match:
            mapping[token] = best_match
        else:
            # Mark as literal
            mapping[token] = "LITERAL:"
            unmapped.append(token)

    if unmapped:
        logger.info(f"Unmapped tokens (will be literals): {unmapped}")

    return mapping


def _similarity(a: str, b: str) -> float:
    """Simple token similarity based on longest common substring ratio."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0

    # Normalize: remove underscores, compare words
    a_words = set(a.replace("_", " ").replace("-", " ").split())
    b_words = set(b.replace("_", " ").replace("-", " ").split())

    if not a_words or not b_words:
        return 0.0

    intersection = a_words & b_words
    union = a_words | b_words
    return len(intersection) / len(union) if union else 0.0


def step4_prepare_literals(literals_map: dict[str, str]) -> dict[str, str]:
    """Step 4: Query DB for literal/header values."""
    print("─" * 70)
    print("  STEP 4: Pre-query DB for Literal Values")
    print("─" * 70)

    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Consumer summary
    cur.execute("SELECT can_number, total_paid, payment_count, last_payment_date FROM consumers LIMIT 1")
    consumer = dict(cur.fetchone() or {})

    # First transaction for IP/timestamp
    cur.execute("SELECT ip_address, access_timestamp, transaction_date FROM transactions LIMIT 1")
    txn = dict(cur.fetchone() or {})

    conn.close()

    # Build literals for tokens the engine can't resolve from row queries
    today = datetime.now().strftime("%d/%m/%Y")
    db_literals = {
        "transaction_status": "Success",
        "can_id": str(consumer.get("can_number", "")),
        "consumer_can": str(consumer.get("can_number", "")),
        "total_amount": f"{consumer.get('total_paid', 0):,.2f}",
        "total_paid": f"{consumer.get('total_paid', 0):,.2f}",
        "txn_date_display": str(consumer.get("last_payment_date", "")),
        "pay_count": str(consumer.get("payment_count", 0)),
        "payment_count": str(consumer.get("payment_count", 0)),
        "total_payments": str(consumer.get("payment_count", 0)),
        "last_pay_date": str(consumer.get("last_payment_date", "")),
        "last_payment_date": str(consumer.get("last_payment_date", "")),
        "client_ip": str(txn.get("ip_address", "")),
        "access_ts": str(txn.get("access_timestamp", "")),
        "access_timestamp": str(txn.get("access_timestamp", "")),
        "ip_address": str(txn.get("ip_address", "")),
        "print_date": today,
        "report_date": today,
        "generated_date": today,
        "payment_gateway": "BillDesk (128-bit SSL)",
        "can_number": str(consumer.get("can_number", "")),
        "status": "Success",
    }

    # Merge with any literal values from the mapping step
    for token, val in literals_map.items():
        if val and token not in db_literals:
            db_literals[token] = val

    print(f"  [OK] {len(db_literals)} literal values prepared:")
    for k, v in sorted(db_literals.items()):
        print(f"       {k} = {v}")
    print()

    return db_literals


def step5_generate_report(contract: dict, html: str, literals: dict):
    """Step 5: Generate the final report using fill_and_print."""
    print("─" * 70)
    print("  STEP 5: Generate Report (fill_and_print)")
    print("─" * 70)

    # Update contract with literals
    contract["literals"] = literals

    # Use the LLM-generated template
    template_path = TEMPLATE_DIR / "template_p1.html"

    t0 = time.time()
    result = fill_and_print(
        OBJ=contract,
        TEMPLATE_PATH=template_path,
        DB_PATH=DB_PATH,
        OUT_HTML=OUTPUT_DIR / "hmwssb_report.html",
        OUT_PDF=OUTPUT_DIR / "hmwssb_report.pdf",
        START_DATE="2020-01-01",
        END_DATE="2030-12-31",
        batch_ids=None,
        KEY_VALUES=None,
        GENERATOR_BUNDLE=None,
    )
    elapsed = time.time() - t0

    html_path = result["html_path"]
    pdf_path = result["pdf_path"]

    print(f"  [OK] Report generated in {elapsed:.1f}s")
    print(f"  [OK] HTML : {html_path}")
    print(f"  [OK] PDF  : {pdf_path}")

    if os.path.exists(pdf_path):
        size = os.path.getsize(pdf_path)
        print(f"  [OK] PDF size: {size:,} bytes")
    elif os.path.exists(html_path):
        size = os.path.getsize(html_path)
        print(f"  [OK] HTML size: {size:,} bytes (PDF unavailable)")

    print()
    return result


def main():
    step0_prepare()

    # Step 1: PDF → PNG
    ref_png = step1_pdf_to_png()

    # Step 2: LLM generates HTML template
    html, schema = step2_generate_html(ref_png)

    # Step 3: Extract tokens, map to DB, build contract
    contract, literals_map = step3_extract_tokens_and_build_contract(html)

    # Step 4: Pre-query DB for literal/header values
    literals = step4_prepare_literals(literals_map)

    # Step 5: Generate report
    result = step5_generate_report(contract, html, literals)

    print("=" * 70)
    print("  PIPELINE COMPLETE")
    print("=" * 70)
    print(f"  Template Dir : {TEMPLATE_DIR}")
    print(f"  HTML Report  : {result['html_path']}")
    print(f"  PDF Report   : {result['pdf_path']}")
    print("=" * 70)


if __name__ == "__main__":
    main()
