# Invoice Report Contract Overview

## Executive Summary
This contract defines the mapping logic for a Basic Invoice report pipeline using pandas DataFrames. The report renders line items from an invoice, displaying the item description and the calculated line total. The data source is derived from the `invoice_items` table, joined contextually with invoice metadata if required for filtering, though the current row tokens map directly to `invoice_items`.

## Token Inventory
- **Row Tokens**: 
  - `row_description`: Maps to the textual description of the line item.
  - `row_total`: Maps to the monetary value of the line item.
- **Scalar Tokens**: None defined in the current schema.
- **Total Tokens**: None defined in the current schema.

## Mapping Table
| Token | Source Column | Type | Computation |
|-------|---------------|------|-------------|
| `row_description` | `invoice_items.description` | String | Direct |
| `row_total` | `invoice_items.line_total` | Numeric | Direct |

## Join & Date Rules
- **Join Strategy**: The report operates primarily on the `invoice_items` table. For a full invoice context, `invoice_items` is conceptually linked to `invoices` via `invoice_number`, but the current row mapping requires only `invoice_items`.
- **Date Handling**: No date tokens are currently mapped to rows. If invoice date filtering is added later, `invoices.issue_date` will be used.

## Transformations
- No row-level computations (add, subtract, etc.) are required as `line_total` is pre-calculated in the source.
- No reshaping (MELT/UNION) is required; the data is already in a flat row format suitable for the table.

## Parameters
- No dynamic parameters are currently required for the row tokens. Future enhancements may include `invoice_number` as a filter parameter.