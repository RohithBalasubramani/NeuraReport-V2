"""
Generate HMWSSB Bill Payment report using NeuraReport's fill_and_print() pipeline.

Pre-queries the database for summary/header values and passes them as literals,
then lets the engine handle row rendering via generator SQL.
"""
import json
import sqlite3
import sys
import os
from pathlib import Path

# Ensure the project root is on the path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.reports import fill_and_print

TEMPLATE_DIR = Path(__file__).resolve().parent / "uploads" / "hmwssb_billing"
TEMPLATE_PATH = TEMPLATE_DIR / "report_final.html"
CONTRACT_PATH = TEMPLATE_DIR / "contract.json"
DB_PATH = Path(__file__).resolve().parent / "hmwssb_billing.db"
OUT_HTML = TEMPLATE_DIR / "output" / "hmwssb_report.html"
OUT_PDF = TEMPLATE_DIR / "output" / "hmwssb_report.pdf"


def _query_literals(db_path: Path) -> dict:
    """Pre-query the DB for header/summary values that go into literals."""
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    # Consumer summary
    cur.execute("SELECT can_number, total_paid, payment_count, last_payment_date FROM consumers LIMIT 1")
    consumer = dict(cur.fetchone() or {})

    # First transaction for IP/timestamp
    cur.execute("SELECT ip_address, access_timestamp FROM transactions LIMIT 1")
    txn = dict(cur.fetchone() or {})

    conn.close()

    return {
        "transaction_status": "Success",
        "can_id": str(consumer.get("can_number", "")),
        "total_amount": f"{consumer.get('total_paid', 0):,.2f}",
        "txn_date_display": str(consumer.get("last_payment_date", "")),
        "pay_count": str(consumer.get("payment_count", 0)),
        "last_pay_date": str(consumer.get("last_payment_date", "")),
        "client_ip": str(txn.get("ip_address", "")),
        "access_ts": str(txn.get("access_timestamp", "")),
    }


def main():
    # Load contract
    with open(CONTRACT_PATH, "r") as f:
        contract = json.load(f)

    # Pre-query header/summary values and inject as literals
    literals = _query_literals(DB_PATH)
    contract["literals"] = literals

    print("=" * 60)
    print("  NeuraReport — HMWSSB Bill Payment Report Generator")
    print("=" * 60)
    print(f"  Template : {TEMPLATE_PATH}")
    print(f"  Contract : {CONTRACT_PATH}")
    print(f"  Database : {DB_PATH}")
    print(f"  Output   : {OUT_PDF}")
    print(f"  Literals : {len(literals)} values pre-loaded")
    print("=" * 60)

    # Run NeuraReport's fill_and_print engine
    result = fill_and_print(
        OBJ=contract,
        TEMPLATE_PATH=TEMPLATE_PATH,
        DB_PATH=DB_PATH,
        OUT_HTML=OUT_HTML,
        OUT_PDF=OUT_PDF,
        START_DATE="2020-01-01",
        END_DATE="2030-12-31",
        batch_ids=None,
        KEY_VALUES=None,
        GENERATOR_BUNDLE=None,
    )

    print()
    print("[RESULT]")
    print(f"  HTML : {result['html_path']}")
    print(f"  PDF  : {result['pdf_path']}")
    print(f"  Rows : {'Yes' if result.get('rows_rendered') else 'No data rows'}")
    print()

    if os.path.exists(result["pdf_path"]):
        size = os.path.getsize(result["pdf_path"])
        print(f"  PDF generated successfully! ({size:,} bytes)")
    else:
        print("  WARNING: PDF file was not created (Playwright may not be available)")
        if os.path.exists(result["html_path"]):
            size = os.path.getsize(result["html_path"])
            print(f"  HTML report available: {result['html_path']} ({size:,} bytes)")


if __name__ == "__main__":
    main()
