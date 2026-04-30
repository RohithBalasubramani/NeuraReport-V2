# Batch Weighing Report Contract

## Executive Summary
This contract defines the data mapping and transformation logic for a Batch Weighing Report. The report aggregates recipe data from the `recipes` table, specifically focusing on 12 bins per batch. It calculates the difference between set weights and actual weights (error) and the percentage error for each bin. The report is structured to display batch-level headers (ID, Start/End time) followed by a detailed table of materials (bins) and their weighing metrics.

## Token Inventory
- **Scalars (Header):** `plant_name`, `location`, `print_date`, `from_date`, `to_date`, `batch_no`, `report_title`.
- **Row Tokens (Table Rows):** `row_sl_no` (Sequence), `row_material_name` (Bin Content), `row_set_wt_kg` (Set Weight), `row_ach_wt_kg` (Actual Weight), `row_error_kg` (Calculated Error), `row_error_pct` (Calculated % Error).
- **Totals:** `total_set_wt_kg`, `total_ach_wt_kg`, `total_error_kg`, `total_error_pct`.

## Mapping Table
| Token | Source | Type |
| :--- | :--- | :--- |
| `batch_id` | `recipes:id` | Direct |
| `batch_start` | `recipes:start_time` | Direct (Formatted) |
| `batch_end` | `recipes:end_time` | Direct (Formatted) |
| `batch_no` | `recipes:recipe_name` | Direct |
| `row_material_name` | `MELT` (bin1_content...bin12_content) | Reshape |
| `row_set_wt_kg` | `MELT` (bin1_sp...bin12_sp) | Reshape |
| `row_ach_wt_kg` | `MELT` (bin1_act...bin12_act) | Reshape |
| `row_error_kg` | `COMPUTED` (Actual - Set) | Computed |
| `row_error_pct` | `COMPUTED` ((Actual - Set) / Set * 100) | Computed |
| `row_sl_no` | `COMPUTED` (Row Number) | Computed |

## Join & Date Rules
- **Join Strategy:** Self-join or single-table operation on `recipes`. Parent and Child are both `recipes` keyed by `id`.
- **Date Columns:** `recipes:start_time` and `recipes:end_time` are used for filtering and display.
- **Filters:** `date_from` and `date_to` map to `recipes:start_time` and `recipes:end_time` respectively.

## Transformations
1. **Reshape (Melt):** The 12 bin columns for content, set weight, and actual weight are unpivoted into three distinct columns (`row_material_name`, `row_set_wt_kg`, `row_ach_wt_kg`).
2. **Row Computation:**
   - `row_error_kg`: Subtract `row_set_wt_kg` from `row_ach_wt_kg`.
   - `row_error_pct`: Divide the difference by `row_set_wt_kg`, multiply by 100, and round to 2 decimals.
   - `row_sl_no`: Generate a sequential integer (1, 2, 3...).
3. **Totals Computation:** Sum the row-level values for set, actual, and error weights. Calculate total error percentage as the ratio of total error to total set weight.

## Parameters
- **Required:** None (Report uses internal data).
- **Optional:** `date_from` (Start time filter), `date_to` (End time filter).