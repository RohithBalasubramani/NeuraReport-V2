# Invoice Report Contract

## Executive Summary
This contract defines the data mapping for a Basic Invoice report rendered via a pandas DataFrame pipeline. The report displays line items from invoices, specifically mapping the `row_description` token to the `vendor_name` from the `invoices` table (as per override) and `row_total` to `total_amount` from the same table. The pipeline aggregates invoice-level data into a row-based format suitable for the provided HTML template.

## Token Inventory
- **Scalars**: None (The template relies on static headers or implicit context).
- **Row Tokens**: 
  - `row_description`: Represents the vendor or item description.
  - `row_total`: Represents the total monetary amount for the line.
- **Totals**: None defined in schema.

## Mapping Table
| Token | Source Column | Logic |
| :--- | :--- | :--- |
| `row_description` | `invoices.vendor_name` | Direct mapping (Override applied) |
| `row_total` | `invoices.total_amount` | Direct mapping |

## Join & Date Rules
- **Join Strategy**: The report operates on the `invoices` table as the parent. Since no child table is joined for the row detail in this specific override context, the child table mirrors the parent (`invoices`).
- **Date Columns**: `invoices.issue_date` is identified as the primary date column, enabling date filtering.

## Transformations
- **Row Computed**: No complex row-level calculations (add/subtract) are required; direct column passthrough is used.
- **Formatting**: 
  - `row_total` is formatted as a currency/number with 2 decimal places.
  - No timestamp formatting is required for the row tokens as they map to text and numeric columns.

## Parameters
- **Required**: None explicitly defined in schema, but `date_from` and `date_to` are available as optional filters due to the presence of `issue_date`.
- **Optional**: `date_from`, `date_to` (derived from `invoices.issue_date`).