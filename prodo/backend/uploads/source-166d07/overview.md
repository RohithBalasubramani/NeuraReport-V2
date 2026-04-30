# Invoice Report Contract Overview

## Executive Summary
This contract defines the data mapping for a static invoice report generated from a pandas DataFrame pipeline. The report consolidates header information (vendor and customer details), a line-item table, and financial totals. The pipeline joins `invoices` (parent) with `invoice_items` (child) to render a complete invoice document.

## Token Inventory
- **Scalars (Header/Footer):** 21 tokens covering vendor details, invoice metadata, customer billing info, payment instructions, and final financial totals.
- **Row Tokens:** 24 tokens representing 6 fixed rows of line items (Description, Qty, Unit Price, Total). These are mapped dynamically from the `invoice_items` table.
- **Totals:** Financial aggregates (Subtotal, Discount, Tax, Balance Due) are derived from scalar mappings or computed totals.

## Mapping Table
| Token Category | Source Table | Key Mappings |
| :--- | :--- | :--- |
| **Vendor** | `invoices` | `vendor_name`, `billing_address`, `phone`, `email` |
| **Invoice Meta** | `invoices` | `issue_date`, `invoice_number`, `notes` |
| **Customer** | `customers` | `customer_name`, `billing_address`, `city`, `state`, `postal_code`, `country` |
| **Line Items** | `invoice_items` | `description`, `quantity`, `unit_price`, `line_total` |
| **Financials** | `invoices` | `subtotal`, `discount_amount`, `tax_amount`, `total_amount` |

## Join & Date Rules
- **Join Strategy:** `invoices` (parent) joined to `invoice_items` (child) on `invoice_number`.
- **Date Handling:** `issue_date` is formatted as `dd-mm-yyyy HH:MM:SS` for display.
- **Filtering:** Optional date range filters (`date_from`, `date_to`) applied to `invoices.issue_date`.

## Transformations
- **Line Item Calculation:** `line_total` is validated/computed as `quantity * unit_price` (declarative multiply).
- **Totals Logic:** `balance_due` is computed as `total_amount - (sum of payments)` if payments exist, otherwise defaults to `total_amount`. For this static template, we map `total_amount` directly to `balance_due` assuming full balance or use the explicit `total_amount` field.
- **Formatting:** All currency values use `number(2)` formatting. Dates use `format_date`.

## Parameters
- **Required:** `invoice_number` (to fetch specific invoice).
- **Optional:** `date_from`, `date_to` (for filtering invoice lists if this were a list view, but here applied as context).