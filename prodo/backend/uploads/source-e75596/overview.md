# Basic Invoice Report Contract

## Executive Summary
This contract defines the mapping logic for a standard invoice report generated from a pandas DataFrame pipeline. The report aggregates invoice header details (date, number, addresses) and line-item details (description, total) from the `invoices` and `invoice_items` tables, joined on the invoice number. It calculates and formats financial totals and ensures proper date formatting for the invoice issue date.

## Token Inventory
- **Scalars (Header):** `invoice_date`, `invoice_no`, `bill_to`, `ship_to`, `remarks`, `total_amount`.
- **Rows (Line Items):** `row_description`, `row_total`.
- **Totals:** `total_amount` (reused as a scalar for the final display).

## Mapping Table
| Token | Source Column | Type | Notes |
| :--- | :--- | :--- | :--- |
| `invoice_date` | `invoices.issue_date` | Date | Formatted via `row_computed` |
| `invoice_no` | `invoices.invoice_number` | String | Direct mapping |
| `bill_to` | `customers.billing_address` | String | Direct mapping |
| `ship_to` | `customers.billing_address` | String | Defaulted to billing address (no specific ship column in catalog) |
| `remarks` | `invoices.notes` | String | Direct mapping |
| `total_amount` | `invoices.total_amount` | Currency | Aggregated sum |
| `row_description` | `invoice_items.description` | String | Direct mapping |
| `row_total` | `invoice_items.line_total` | Currency | Direct mapping |

## Join & Date Rules
- **Join Strategy:** The report joins `invoices` (parent) with `invoice_items` (child) on `invoice_number`.
- **Date Handling:** The `issue_date` column is explicitly formatted to `dd-mm-yyyy HH:MM:SS` using a declarative `format_date` operation. No SQL `strftime` is used.

## Transformations
- **Date Formatting:** `invoices.issue_date` is transformed to a human-readable string.
- **Aggregation:** The `total_amount` is calculated as the sum of `row_total` (line items) for the specific invoice context.
- **No Reshape:** Data is presented in a standard row-by-row format; no melting or unioning is required.

## Parameters
- **Required:** None (The contract assumes a specific invoice context is provided via the join key or a filter parameter `invoice_no` if dynamic).
- **Optional:** `invoice_no` (to filter a specific invoice).