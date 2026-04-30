# Invoice Report Mapping Contract

## Executive Summary
This contract defines the data mapping for a single-page invoice report (Invoice INV-17). The report aggregates header metadata, line item details, and financial totals from three source tables: `invoices`, `invoice_items`, and `payments`. The logic ensures that invoice headers, line items, and payment history are correctly joined and formatted for the HTML template.

## Token Inventory
- **Scalars (Header & Totals)**: 13 tokens including invoice metadata (number, dates, PO), financial summaries (subtotal, taxes, grand total), and payment status (balance due, payment made).
- **Row Tokens**: 0 tokens defined in the schema (line items are handled via implicit row generation in the template, but the contract focuses on the scalar aggregation logic for this specific input).
- **Totals**: 0 explicit total tokens defined in the schema (financial values are treated as scalar aggregates).

## Mapping Table
| Token | Source Column | Type | Notes |
| :--- | :--- | :--- | :--- |
| `invoice_number` | `invoices.invoice_number` | String | Primary key |
| `balance_due_top` | `invoices.total_amount` | Currency | Displayed as top-level balance |
| `invoice_date` | `invoices.issue_date` | Date | Formatted DD-MM-YYYY HH:MM:SS |
| `terms` | `invoices.notes` | String | Terms and conditions |
| `due_date` | `invoices.due_date` | Date | Formatted DD-MM-YYYY HH:MM:SS |
| `po_number` | `UNRESOLVED` | String | No direct mapping in catalog |
| `project_name` | `UNRESOLVED` | String | No direct mapping in catalog |
| `sub_total` | `invoices.subtotal` | Currency | Sum of line items |
| `tax_1` | `UNRESOLVED` | Currency | No specific tax column |
| `tax_2` | `UNRESOLVED` | Currency | No specific tax column |
| `grand_total` | `invoices.total_amount` | Currency | Final amount |
| `payment_made` | `payments.amount_paid` | Currency | Aggregated sum |
| `final_balance` | `invoices.total_amount` | Currency | Calculated difference |

## Join & Date Rules
- **Join Strategy**: `invoices` is the parent table. `invoice_items` and `payments` are child tables joined on `invoice_number`.
- **Date Columns**: `invoices.issue_date` and `invoices.due_date` are formatted using `format_date`.
- **Filtering**: No mandatory filters defined, but `invoice_number` acts as the primary filter key.

## Transformations
- **Date Formatting**: All date tokens are converted to `%d-%m-%Y %H:%M:%S`.
- **Numeric Formatting**: All currency tokens use `number(2)` or `currency(2)`.
- **Calculated Fields**: `final_balance` is computed as `grand_total` minus `payment_made`.

## Parameters
- **Required**: None (Invoice is typically retrieved by ID/Number).
- **Optional**: `date_from`, `date_to` (for filtering by invoice date).