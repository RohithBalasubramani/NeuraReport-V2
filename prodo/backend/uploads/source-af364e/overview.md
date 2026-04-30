# Consumption Report Contract

## Executive Summary
This contract defines the data mapping for a **Consumption Report** generated from the `recipes` table. The report tracks material consumption per batch, comparing set weights against actual weights to calculate errors. Data is unpivoted from 12 bin columns into a single row-per-material format for detailed analysis.

## Token Inventory
- **Scalars**: Plant metadata, date range, batch identifiers, and timestamps.
- **Row Tokens**: Sequential number, material name, set weight, actual weight, error (kg), and error (%).
- **Totals**: Aggregated sums for set weight, actual weight, error, and overall error percentage.

## Mapping Table
| Token | Source / Logic | Type |
|-------|----------------|------|
| `plant_name` | LITERAL: Costal Plant | Scalar |
| `location` | LITERAL: Production Floor | Scalar |
| `print_date` | CURRENT_DATE (Formatted) | Scalar |
| `from_date` | Derived from `start_time` | Scalar |
| `to_date` | Derived from `end_time` | Scalar |
| `batch_no` | `recipes.id` | Scalar |
| `batch_id` | `recipes.recipe_name` | Scalar |
| `start_time` | `recipes.start_time` (Formatted) | Scalar |
| `end_time` | `recipes.end_time` (Formatted) | Scalar |
| `row_sl_no` | ROW_NUMBER | Row |
| `row_material_name` | Unpivot `bin1_content`...`bin12_content` | Row |
| `row_set_wt_kg` | Unpivot `bin1_sp`...`bin12_sp` | Row |
| `row_ach_wt_kg` | Unpivot `bin1_act`...`bin12_act` | Row |
| `row_error_kg` | `row_ach_wt_kg` - `row_set_wt_kg` | Row (Computed) |
| `row_error_pct` | `row_error_kg` / `row_set_wt_kg` * 100 | Row (Computed) |
| `total_set_wt_kg` | SUM(`row_set_wt_kg`) | Total |
| `total_ach_wt_kg` | SUM(`row_ach_wt_kg`) | Total |
| `total_error_kg` | SUM(`row_error_kg`) | Total |
| `total_error_pct` | SUM(`row_error_kg`) / SUM(`row_set_wt_kg`) * 100 | Total |

## Join & Date Rules
- **Join**: Self-referential on `recipes` table (Parent: `recipes.id`, Child: `recipes.id`).
- **Date Columns**: `recipes.start_time` and `recipes.end_time` drive the report range.
- **Filters**: `date_from` and `date_to` map to `start_time` and `end_time` respectively.

## Transformations
1. **Reshape**: Melt 12 bin columns (content, set weight, actual weight) into 3 long-format columns.
2. **Compute Error**: Calculate difference and percentage error per row.
3. **Aggregate**: Sum totals per batch.
4. **Format**: Apply date formatting to timestamps and numeric formatting to weights/percentages.

## Parameters
- **Required**: None (Report is static per batch ID).
- **Optional**: `date_from`, `date_to` (for filtering batches).