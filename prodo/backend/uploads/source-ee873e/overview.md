# Invoice Report Contract

## Executive Summary
This contract defines the data mapping and transformation logic for a standard invoice report. The report aggregates header information from the `invoices` and `customers` tables, while line items are sourced from `invoice_items`. The logic ensures proper formatting of dates, currency values, and address concatenation using declarative operations compatible with pandas DataFrames.

## Token Inventory
- **Scalars**: 12 tokens covering invoice metadata (date, number, terms), vendor details, and client details (name, email, address).
- **Row Tokens**: 4 tokens representing invoice line items (description, quantity, price, amount).
- **Totals**: No explicit totals tokens defined in the schema, but the HTML template expects Subtotal, Tax, and Balance Due. (Note: Contract focuses on mapping provided schema tokens).

## Mapping Table
| Token | Source / Logic | Type |
| :--- | :--- | :--- |
| `date` | `invoices.issue_date` | Date (Formatted) |
| `due_date` | `invoices.due_date` | Date (Formatted) |
| `invoice_number` | `invoices.invoice_number` | String |
| `company_name` | `invoices.vendor_name` | String |
| `company_email` | Literal: `contact@riverbend.com` | String |
| `company_address_1` | Literal: `Riverbend Mechanical` | String |
| `company_address_2` | Literal: `Contact us for details` | String |
| `client_name` | `customers.customer_name` | String |
| `client_email` | `customers.email` | String |
| `client_address_1` | `customers.billing_address` | String |
| `client_address_2` | Concat: `city`, `state`, `postal_code` | String (Computed) |
| `terms` | Literal: `Net 30 days` | String |
| `notes` | `invoices.notes` | String |
| `row_item_description` | `invoice_items.description` | String |
| `row_quantity` | `invoice_items.quantity` | Number |
| `row_price` | `invoice_items.unit_price` | Number (Currency) |
| `row_amount` | `invoice_items.line_total` | Number (Currency) |

## Join & Date Rules
- **Parent Table**: `invoices` (Key: `invoice_number`)
- **Child Table**: `invoice_items` (Key: `invoice_number`)
- **Date Columns**: `invoices.issue_date`, `invoices.due_date`
- **Filters**: Optional `date_from` and `date_to` filters applied to `invoices.issue_date`.

## Transformations
1. **Date Formatting**: All date tokens are formatted as `DD-MM-YYYY HH:MM:SS` using `format_date` operations.
2. **Address Concatenation**: `client_address_2` is constructed by concatenating `customers.city`, `customers.state`, and `customers.postal_code` with a separator.
3. **Numeric Formatting**: `row_price` and `row_amount` are formatted as currency (2 decimals).
4. **Literal Injection**: Company details and terms are injected as static literals as per the override instructions.

## Parameters
- **Required**: None (All data sourced from tables or literals).
- **Optional**: `date_from`, `date_to` (for filtering invoices by issue date).