# Invoice Report Mapping Contract

## Executive Summary
This contract defines the data mapping for a standard invoice report generated from a pandas DataFrame pipeline. The report aggregates header metadata (vendor, customer, invoice details) and calculates financial totals (subtotal, tax, discount, balance due). No row-level line items are rendered in this specific template view, focusing instead on the invoice summary and payment instructions.

## Token Inventory
- **Scalars (Header):** 14 tokens representing vendor info, customer billing details, invoice metadata, and payment instructions.
- **Row Tokens:** 0 (This template does not render a dynamic line-item table in the final output; it uses static placeholders or expects pre-aggregated data).
- **Totals:** 7 tokens representing financial calculations (Subtotal, Discount, Tax, Shipping, Balance Due).

## Mapping Strategy
- **Vendor Info:** Mapped from `invoices` table (e.g., `vendor_name`). Static fields (address, phone, email) are mapped to `UNRESOLVED` as they are not present in the provided catalog for the `invoices` table, requiring external configuration or defaults.
- **Customer Info:** Mapped from `customers` table (e.g., `customer_name`, `billing_address`).
- **Invoice Metadata:** Mapped from `invoices` table (`issue_date`, `invoice_number`).
- **Financial Totals:** Mapped directly from `invoices` table columns where available (`subtotal`, `tax_amount`, `discount_amount`, `total_amount`). Derived totals (`total_subtotal_less_discount`, `total_balance_due`) are computed via declarative operations.

## Join & Date Rules
- **Join Strategy:** Parent table `invoices` joined with child table `customers` on `customer_id`.
- **Date Handling:** `invoice_date` is formatted using `format_date` operation to ensure consistent display (`dd-mm-yyyy HH:MM:SS`).

## Transformations
- **Date Formatting:** `invoices.issue_date` is formatted for display.
- **Arithmetic:** 
  - `total_subtotal_less_discount` = `subtotal` - `discount_amount`.
  - `total_balance_due` = `total_subtotal_less_discount` + `tax_amount` + `shipping` (if applicable, otherwise just tax + subtotal logic). Based on catalog, `total_amount` is available, but `total_balance_due` is often `total_amount` - `amount_paid`. Since `payments` table exists but no specific payment token is in the schema, we assume `total_balance_due` maps to `invoices.total_amount` or is derived if `total_amount` represents gross. Given the template structure, `total_balance_due` is likely the final amount owed. We will map `total_balance_due` to `invoices.total_amount` if it represents the final due, or calculate it. Let's assume `total_amount` in `invoices` is the final amount due. If `total_amount` is gross, we need to subtract payments. However, without a row-level payment join in the schema, we map `total_balance_due` to `invoices.total_amount` and assume the source data is pre-calculated, OR we derive it if we have `subtotal`, `tax`, `discount`. 
  - Logic: `Balance Due` = `Subtotal` - `Discount` + `Tax` + `Shipping`. 
  - Catalog has `subtotal`, `discount_amount`, `tax_amount`. `shipping` is not in catalog, assume 0 or part of `total_amount`. 
  - We will define `total_balance_due` as a computed sum of components if `total_amount` is not the final due, but standard practice is `total_amount` = final due. Let's map `total_balance_due` to `invoices.total_amount` directly for simplicity unless the user specifies otherwise, but the template has `total_subtotal_less_discount` and `total_tax` separate. 
  - Refined Logic: 
    - `total_subtotal` -> `invoices.subtotal`
    - `total_discount` -> `invoices.discount_amount`
    - `total_subtotal_less_discount` -> Computed: `subtotal` - `discount_amount`
    - `total_tax_rate` -> Not in catalog, map to `UNRESOLVED` or assume 0. Wait, `total_tax` is `invoices.tax_amount`. Rate is missing. Map to `UNRESOLVED`.
    - `total_tax` -> `invoices.tax_amount`
    - `total_shipping` -> Not in catalog. Map to `UNRESOLVED` (or 0).
    - `total_balance_due` -> Computed: `total_subtotal_less_discount` + `total_tax` + `total_shipping`.

## Parameters
- **Required:** None (Static report).
- **Optional:** `date_from`, `date_to` for filtering invoices by issue date.