# Invoice Report Contract (DataFrame Mode)

## Executive Summary
This contract defines the mapping logic for generating a standard invoice report from the `invoices`, `customers`, `invoice_items`, and `payments` tables. The report includes header metadata (invoice details, billing info), a line-item table with calculated amounts, and a totals section including subtotals, taxes, and balance due.

## Token Inventory
- **Scalars**: 16 tokens (Invoice meta, customer details, dates, totals).
- **Row Tokens**: 7 tokens (Line items: number, description, qty, rate, discount, amount).
- **Totals**: 0 explicit tokens (handled via scalar calculations).

## Mapping Strategy
- **Direct Mappings**: Most fields map directly to catalog columns (e.g., `invoice_number` → `invoices.invoice_number`).
- **Computed Fields**:
  - `balance_due`: Calculated as `total_amount` - `payment_made`.
  - `row_discount`: Calculated as `unit_price` * `quantity` - `line_total` (or derived from specific discount logic if available, here assumed 0 if not explicit).
  - `tax_1_amount`: Calculated as 4.7% of `sub_total`.
  - `tax_2_amount`: Calculated as 7.0% of `sub_total`.
- **Unresolved/Hardcoded**: `terms`, `po_number`, `project_name`, `row_description_sub` are set to empty strings or defaults as no direct catalog columns exist.

## Join & Date Rules
- **Join**: `invoices` (parent) joined to `invoice_items` (child) on `invoice_number`. `customers` and `payments` are joined to `invoices` on respective keys.
- **Date Columns**: `invoices.issue_date` and `invoices.due_date` are formatted as `dd-mm-yyyy HH:MM:SS`.
- **Ordering**: Rows ordered by `line_no` ascending.

## Transformations
- **Date Formatting**: All date tokens use `format_date` op.
- **Numeric Formatting**: Currency and quantity fields use `number(2)` or `currency(2)`.
- **Aggregations**: Totals are computed using declarative math ops on row tokens or scalar sources.

## Parameters
- **Required**: `invoice_number` (string).
- **Optional**: `date_from`, `date_to` (date filters for invoice date range).