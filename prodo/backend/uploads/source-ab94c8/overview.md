# Invoice Report Contract (DataFrame Mode)

## Executive Summary
This contract defines the declarative mapping for generating an invoice report (INV-17) using pandas DataFrames. The report aggregates header metadata (company, customer, dates), line-item details (description, qty, rate, amount), and financial totals (subtotal, taxes, balance due). No SQL is used; all logic is expressed via declarative operation objects.

## Token Inventory
- **Scalars**: 22 tokens covering invoice metadata, customer details, and summary financials.
- **Row Tokens**: 7 tokens for line-item details (index, description, qty, rate, discount, amount).
- **Totals**: 6 tokens for calculated financial summaries (Subtotal, Tax1, Tax2, Total, Payment, Balance Due).

## Mapping Table
- **Header**: Maps `invoices` and `customers` tables to scalar tokens. Dates are formatted via `row_computed`.
- **Rows**: Maps `invoice_items` to row tokens. Calculated `row_amount` uses `multiply` (qty * rate).
- **Totals**: Aggregates row tokens using `sum` and `subtract` operations.

## Join & Date Rules
- **Join**: `invoices` (parent) joined to `invoice_items` (child) on `invoice_number`. `customers` joined to `invoices` on `customer_id`.
- **Date Columns**: `invoices.issue_date` and `invoices.due_date` are formatted as `dd-mm-yyyy HH:MM:SS`.

## Transformations
- **Row Computed**: 
  - `row_amount` = `row_qty` * `row_rate`.
  - `row_description_main` = `invoice_items.description`.
  - `row_description_sub` = `invoice_items.category` (fallback if sub-desc missing).
- **Totals Math**:
  - `sub_total` = SUM(`row_amount`).
  - `total_amount` = `sub_total` + `tax1_value` + `tax2_value`.
  - `balance_due` = `total_amount` - `payment_made`.
- **Reshape**: None (single source table for rows).

## Parameters
- **Required**: `invoice_number` (string) to filter the specific invoice.
- **Optional**: `date_from`, `date_to` for date-range filtering on `issue_date`.