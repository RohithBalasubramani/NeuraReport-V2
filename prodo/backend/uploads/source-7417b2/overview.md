# Consumption Report Contract

## Executive Summary
This report generates a detailed consumption analysis for manufacturing batches, comparing set weights against actual weights for 12 material bins per batch. The data is derived from the `recipes` table, which contains recipe definitions, set points, and actual consumption values. The report groups data by batch (recipe), calculates row-level errors (difference and percentage), and aggregates totals for each batch.

## Token Inventory
- **Scalars**: Report header details (Plant, Location, Dates, Batch ID, Times) and Batch Totals.
- **Row Tokens**: Sequential number, Material Name, Set Weight, Actual Weight, Error (Kg), Error (%).
- **Totals**: Aggregated sums for Set Weight, Actual Weight, Error (Kg), and Error (%).

## Mapping Strategy
- **Source Table**: `recipes` is the sole data source. No joins are required.
- **Reshaping**: The 12 bin columns (`bin1_content`...`bin12_content`, `bin1_sp`...`bin12_sp`, `bin1_act`...`bin12_act`) are unpivoted (MELT) into three logical columns: `row_material_name`, `row_set_wt_kg`, and `row_ach_wt_kg`.
- **Computed Columns**:
  - `row_error_kg`: Calculated as `row_ach_wt_kg - row_set_wt_kg`.
  - `row_error_pct`: Calculated as `(row_ach_wt_kg - row_set_wt_kg) / row_set_wt_kg * 100`, rounded to 2 decimals.
  - `row_sl_no`: Generated row number within the batch.
- **Timestamps**: `start_time` and `end_time` are formatted to `%d-%m-%Y %H:%M:%S`.
- **Static Values**: Plant name and location are hardcoded as per override instructions.

## Join & Date Rules
- **Join**: Self-join on `recipes` (parent and child are the same) to satisfy contract structure, though logically a single table scan.
- **Date Filtering**: The report supports filtering by `start_time` and `end_time` via `date_from` and `date_to` parameters.

## Transformations
1. **MELT**: Unpivot 12 bin columns into a long format.
2. **SUBTRACT**: Compute error in Kg.
3. **DIVIDE & MULTIPLY**: Compute error percentage.
4. **FORMAT_DATE**: Standardize timestamp display.
5. **FORMAT_NUMBER**: Ensure numeric consistency (2 decimals for weights, 2 decimals for percentages).

## Parameters
- **Required**: None explicitly defined as user inputs, but `date_from` and `date_to` are available for optional filtering.
- **Optional**: `date_from`, `date_to` (mapped to `recipes.start_time` and `recipes.end_time`).