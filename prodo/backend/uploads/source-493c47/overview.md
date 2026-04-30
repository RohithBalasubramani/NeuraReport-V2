# Invoice Report Contract

## Executive Summary
This contract defines the mapping for a standard Invoice report generated from a relational dataset. The report displays invoice metadata (date, number, terms), vendor and client contact details, a line-item table with descriptions, quantities, prices, and totals, and a summary section for subtotal, tax, and balance due. The pipeline uses pandas DataFrames to join `invoices`, `customers`, and `invoice_items` tables, computing derived address fields and formatting dates and currency values declaratively.

## Token Inventory
- **Scalars (Header/Footer):** `invoice_date`, `invoice_number`, `from_company_name`, `from_email`, `from_address_1`, `from_address_2`, `to_client_name`, `to_email`, `to_address_1`, `to_address_2`, `terms`, `due_date`, `notes_text`.
- **Row Tokens (Line Items):** `row_item_description`, `row_quantity`, `row_price`, `row_amount`.
- **Totals Tokens:** `total_subtotal`, `total_tax`, `total_balance_due`.

## Mapping Table
| Token | Source Column | Type | Notes |
| :--- | :--- | :--- | :--- |
| `invoice_date` | `invoices.issue_date` | Date | Formatted as DD-MM-YYYY HH:MM:SS |
| `invoice_number` | `invoices.invoice_number` | String | Direct mapping |
| `from_company_name` | `invoices.vendor_name` | String | Direct mapping |
| `from_email` | `customers.email` | String | Direct mapping |
| `from_address_1` | `customers.billing_address` | String | Direct mapping |
| `from_address_2` | `COMPUTED` | String | Concatenation of city, state, postal_code |
| `to_client_name` | `customers.customer_name` | String | Direct mapping |
| `to_email` | `customers.email` | String | Direct mapping |
| `to_address_1` | `customers.billing_address` | String | Direct mapping |
| `to_address_2` | `COMPUTED` | String | Concatenation of city, state, postal_code |
| `terms` | `invoices.status` | String | Direct mapping |
| `due_date` | `invoices.due_date` | Date | Formatted as DD-MM-YYYY HH:MM:SS |
| `row_item_description` | `invoice_items.description` | String | Direct mapping |
| `row_quantity` | `invoice_items.quantity` | Number | Formatted as integer/number |
| `row_price` | `invoice_items.unit_price` | Number | Formatted as currency |
| `row_amount` | `invoice_items.line_total` | Number | Formatted as currency |
| `total_subtotal` | `invoices.subtotal` | Number | Aggregated sum |
| `total_tax` | `invoices.tax_amount` | Number | Aggregated sum |
| `total_balance_due` | `invoices.total_amount` | Number | Aggregated sum |

## Join & Date Rules
- **Join Strategy:** The `invoices` table is the parent. `customers` is joined on `customer_id`. `invoice_items` is joined on `invoice_number`.
- **Date Columns:** `invoices.issue_date` and `invoices.due_date` are treated as timestamps and require explicit formatting.
- **Filters:** Date range filters (`date_from`, `date_to`) are available for `invoices.issue_date`.

## Transformations
1. **Address Construction:** `from_address_2` and `to_address_2` are constructed by concatenating `city`, `state`, and `postal_code` with a space separator.
2. **Date Formatting:** All date tokens are formatted to `%d-%m-%Y %H:%M:%S` using `row_computed` operations.
3. **Numeric Formatting:** Currency and quantity fields are formatted using `formatters` (e.g., `currency(2)`, `number(0)`).

## Parameters
- **Required:** None (all data derived from catalog).
- **Optional:** `date_from`, `date_to` for filtering invoice issues.