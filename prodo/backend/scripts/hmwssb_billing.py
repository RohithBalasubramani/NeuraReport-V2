"""
HMWSSB Bill Payment Database & Report Generator
Parses HMWSSB transaction acknowledgment data, stores in SQLite, and generates reports.
"""

import sqlite3
import os
from datetime import datetime

DB_PATH = os.path.join(os.path.dirname(__file__), "hmwssb_billing.db")


def create_database():
    """Create the HMWSSB billing database with schema."""
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()

    cur.execute("""
        CREATE TABLE IF NOT EXISTS transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            transaction_status TEXT NOT NULL,
            transaction_ref_number TEXT UNIQUE NOT NULL,
            transaction_date TEXT NOT NULL,
            transaction_time TEXT NOT NULL,
            can_number TEXT NOT NULL,
            bill_amount REAL NOT NULL,
            bank_name TEXT,
            ip_address TEXT,
            access_timestamp TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)

    cur.execute("""
        CREATE TABLE IF NOT EXISTS consumers (
            can_number TEXT PRIMARY KEY,
            total_paid REAL DEFAULT 0,
            payment_count INTEGER DEFAULT 0,
            last_payment_date TEXT
        )
    """)

    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_txn_ref ON transactions(transaction_ref_number)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_can ON transactions(can_number)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_txn_date ON transactions(transaction_date)
    """)

    conn.commit()
    return conn


def insert_transaction(conn, data):
    """Insert a transaction record and update consumer summary."""
    cur = conn.cursor()

    cur.execute("""
        INSERT OR IGNORE INTO transactions
            (transaction_status, transaction_ref_number, transaction_date,
             transaction_time, can_number, bill_amount, bank_name,
             ip_address, access_timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        data["transaction_status"],
        data["transaction_ref_number"],
        data["transaction_date"],
        data["transaction_time"],
        data["can_number"],
        data["bill_amount"],
        data["bank_name"],
        data.get("ip_address"),
        data.get("access_timestamp"),
    ))

    cur.execute("""
        INSERT INTO consumers (can_number, total_paid, payment_count, last_payment_date)
        VALUES (?, ?, 1, ?)
        ON CONFLICT(can_number) DO UPDATE SET
            total_paid = total_paid + excluded.total_paid,
            payment_count = payment_count + 1,
            last_payment_date = excluded.last_payment_date
    """, (data["can_number"], data["bill_amount"], data["transaction_date"]))

    conn.commit()


def generate_report(conn):
    """Generate a summary report from the database."""
    cur = conn.cursor()

    report_lines = []
    report_lines.append("=" * 70)
    report_lines.append("  HMWSSB BILL PAYMENT — DATABASE REPORT")
    report_lines.append(f"  Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    report_lines.append("=" * 70)

    # --- Transaction Summary ---
    cur.execute("SELECT COUNT(*) FROM transactions")
    total_txns = cur.fetchone()[0]

    cur.execute("SELECT SUM(bill_amount) FROM transactions")
    total_amount = cur.fetchone()[0] or 0

    cur.execute("SELECT COUNT(*) FROM transactions WHERE transaction_status = 'Success'")
    success_count = cur.fetchone()[0]

    cur.execute("SELECT COUNT(DISTINCT can_number) FROM transactions")
    unique_consumers = cur.fetchone()[0]

    report_lines.append("")
    report_lines.append("  TRANSACTION SUMMARY")
    report_lines.append("  " + "-" * 40)
    report_lines.append(f"  Total Transactions   : {total_txns}")
    report_lines.append(f"  Successful           : {success_count}")
    report_lines.append(f"  Failed               : {total_txns - success_count}")
    report_lines.append(f"  Total Amount Paid    : Rs. {total_amount:,.2f}")
    report_lines.append(f"  Unique Consumers     : {unique_consumers}")

    # --- Individual Transactions ---
    cur.execute("""
        SELECT transaction_ref_number, transaction_date, transaction_time,
               can_number, bill_amount, transaction_status, bank_name
        FROM transactions ORDER BY transaction_date DESC, transaction_time DESC
    """)
    rows = cur.fetchall()

    report_lines.append("")
    report_lines.append("  TRANSACTION DETAILS")
    report_lines.append("  " + "-" * 40)
    report_lines.append(f"  {'Ref Number':<20} {'Date':<12} {'Time':<10} {'CAN':<12} {'Amount':>10} {'Status':<8}")
    report_lines.append("  " + "-" * 76)

    for row in rows:
        ref, date, time, can, amount, status, bank = row
        report_lines.append(f"  {ref:<20} {date:<12} {time:<10} {can:<12} Rs.{amount:>8,.2f} {status:<8}")

    # --- Consumer Summary ---
    cur.execute("""
        SELECT can_number, total_paid, payment_count, last_payment_date
        FROM consumers ORDER BY total_paid DESC
    """)
    consumers = cur.fetchall()

    report_lines.append("")
    report_lines.append("  CONSUMER SUMMARY")
    report_lines.append("  " + "-" * 40)
    report_lines.append(f"  {'CAN Number':<15} {'Total Paid':>12} {'Payments':>10} {'Last Payment':<12}")
    report_lines.append("  " + "-" * 55)

    for c in consumers:
        can, total, count, last_date = c
        report_lines.append(f"  {can:<15} Rs.{total:>9,.2f} {count:>10} {last_date:<12}")

    report_lines.append("")
    report_lines.append("=" * 70)
    report_lines.append("  END OF REPORT")
    report_lines.append("=" * 70)

    return "\n".join(report_lines)


def main():
    # --- Step 1: Create database ---
    conn = create_database()
    print("[+] Database created at:", DB_PATH)

    # --- Step 2: Insert data extracted from the PDF ---
    pdf_data = {
        "transaction_status": "Success",
        "transaction_ref_number": "YAX62668702574",
        "transaction_date": "2026-02-01",
        "transaction_time": "02:53:29",
        "can_number": "624140910",
        "bill_amount": 1510.00,
        "bank_name": "NA",
        "ip_address": "2401:4900:1c0e:21d5:cd38:bfd:36a7:a98b",
        "access_timestamp": "2026-02-01 02:53:40 IST",
    }

    insert_transaction(conn, pdf_data)
    print("[+] Transaction inserted:", pdf_data["transaction_ref_number"])

    # --- Step 3: Generate report ---
    report = generate_report(conn)
    print(report)

    # Save report to file
    report_path = os.path.join(os.path.dirname(__file__), "hmwssb_report.txt")
    with open(report_path, "w") as f:
        f.write(report)
    print(f"\n[+] Report saved to: {report_path}")

    conn.close()


if __name__ == "__main__":
    main()
