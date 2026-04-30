# Invoice Report Mapping Contract

## Executive Summary
This contract defines the data mapping for a standard Invoice report generated from a pandas DataFrame pipeline. The report aggregates header information (company, billing, shipping, invoice details), line items (services/products), and financial totals (subtotal, tax, shipping, grand total). The pipeline joins `invoices` as the parent table with `invoice_items` as the child table to produce a flat row-based structure for line items, while scalar tokens pull from the parent `invoices` and `customers` tables.

## Token Inventory
- **Scalars (Header/Footer):** 21 tokens covering company info, billing/ship-to addresses, invoice metadata, and summary totals.
- **Row Tokens (Line Items):** 5 tokens (`row_item_service`, `row_description`, `row_quantity_hrs`, `row_rate`, `row_amount`).
- **Totals Tokens:** 0 explicit tokens in schema (totals are handled via scalar mapping).

## Mapping Logic
- **Join:** `invoices` (parent) → `invoice_items` (child) on `invoice_number`.
- **Scalars:** Mapped directly to `invoices` or `customers` columns. `invoice_date` and `due_date` are formatted via `row_computed`.
- **Row Tokens:** Mapped to `invoice_items` columns. `row_amount` is computed as `quantity * unit_price` to ensure accuracy, though `line_total` exists in the catalog.
- **Totals:** The scalar tokens `subtotal`, `sales_tax`, `shipping`, and `total` are mapped directly to `invoices.subtotal`, `invoices.tax_amount`, `invoices.discount_amount` (mapped to shipping as no direct shipping col exists, or assumed 0 if not present), and `invoices.total_amount`.

## Transformations
- **Date Formatting:** `invoice_date` and `due_date` are formatted to `dd-mm-yyyy HH:MM:SS`.
- **Numeric Formatting:** All currency fields use `currency(2)` or `number(2)` formatting.
- **Computed Row:** `row_amount` is calculated as `row_quantity_hrs * row_rate`.

## Parameters
- **Required:** None (all data is derived from the joined dataset).
- **Optional:** `date_from`, `date_to` for filtering invoices by issue date.

## Validation
- All schema tokens are resolved.
- No SQL expressions are used; all logic is declarative.
- Date columns are explicitly formatted.
- Join keys are consistent.