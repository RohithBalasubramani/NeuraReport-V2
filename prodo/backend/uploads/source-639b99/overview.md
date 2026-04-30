# Invoice Report Contract

## Executive Summary
This contract defines the data mapping and transformation logic for generating a standard Invoice report from a pandas DataFrame pipeline. The report aggregates header information (company details, billing/shipping addresses, invoice metadata) and line-item details (services, quantities, rates, amounts) from the `invoices` and `invoice_items` tables. No SQL is used; all logic is expressed via declarative operations.

## Token Inventory
- **Scalars**: Company identity, contact info, billing/ship-to details, invoice metadata (number, dates, terms), and financial totals (subtotal, tax, shipping, total).
- **Row Tokens**: Line item details including item code, description, quantity, unit price, and calculated line total.
- **Totals**: Aggregated financial figures derived from the row data.

## Mapping Table
| Token | Source Column | Type |
|-------|---------------|------|
| company_name | UNRESOLVED (Static/Param) | Scalar |
| company_address | UNRESOLVED (Static/Param) | Scalar |
| company_phone | UNRESOLVED (Static/Param) | Scalar |
| company_email | UNRESOLVED (Static/Param) | Scalar |
| company_website | UNRESOLVED (Static/Param) | Scalar |
| bill_to_client | customers.customer_name | Scalar |
| bill_to_address | customers.billing_address | Scalar |
| ship_to_client | customers.customer_name | Scalar |
| ship_to_address | customers.billing_address | Scalar |
| invoice_number | invoices.invoice_number | Scalar |
| invoice_date | invoices.issue_date | Scalar (Date) |
| terms | UNRESOLVED (Static) | Scalar |
| due_date | invoices.due_date | Scalar (Date) |
| customer_message | invoices.notes | Scalar |
| subtotal | invoices.subtotal | Scalar |
| sales_tax | invoices.tax_amount | Scalar |
| shipping | UNRESOLVED (Static/Param) | Scalar |
| total | invoices.total_amount | Scalar |
| row_item_service | invoice_items.item_code | Row |
| row_description | invoice_items.description | Row |
| row_quantity_hrs | invoice_items.quantity | Row |
| row_rate | invoice_items.unit_price | Row |
| row_amount | invoice_items.line_total | Row |

## Join & Date Rules
- **Join**: `invoices` (parent) joined to `invoice_items` (child) on `invoice_number`.
- **Date Columns**: `invoices.issue_date` and `invoices.due_date` are treated as date fields and formatted explicitly.
- **Filters**: Date range filters (`date_from`, `date_to`) are mapped to `invoices.issue_date`.

## Transformations
- **Date Formatting**: `invoice_date` and `due_date` are formatted as `dd-mm-yyyy HH:MM:SS` using `row_computed.format_date`.
- **Numeric Formatting**: All monetary and quantity fields use `number(2)` or `currency(2)` formatters.
- **Reshaping**: No complex reshaping (MELT/UNION) is required; data is structured as a flat join.

## Parameters
- **Required**: None explicitly defined in schema, but `invoice_number` is implied as a primary filter.
- **Optional**: `date_from`, `date_to` for filtering invoice issues.