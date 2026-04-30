# Consumption Report Mapping Contract

## Executive Summary
This contract defines the data pipeline for a **Consumption Report** that tracks material usage against set points across multiple batches. The report aggregates data from the `recipes` table, which contains wide-format columns for 12 bins (content, set point, actual weight). The pipeline reshapes this wide data into a long format to display individual bin consumption rows, calculates error metrics (weight difference and percentage), and groups results by batch.

## Token Inventory
- **Scalars (Header):** Plant name, Location, Print Date, Date Range, Batch No, Report Title, Batch Number, Start/End Times.
- **Row Tokens:** Serial Number, Material Name, Set Weight, Actual Weight, Error (Kg), Error (%).
- **Totals:** Sum of Set/Actual/Error weights, Average Error %.

## Mapping Strategy
1. **Source Table:** `recipes` is the primary source for all bin data.
2. **Reshape (Melt):** The wide columns (`bin1_content`...`bin12_content`, `bin1_sp`...`bin12_sp`, `bin1_act`...`bin12_act`) are melted into three logical columns: `row_material_name`, `row_set_wt_kg`, and `row_ach_wt_kg`.
3. **Computed Metrics:**
   - `row_error_kg` = `row_ach_wt_kg` - `row_set_wt_kg`
   - `row_error_pct` = (`row_error_kg` / `row_set_wt_kg`) * 100
4. **Aggregation:** Totals are calculated per batch using `sum` for weights and `mean` for percentages.
5. **Formatting:** Timestamps are formatted to `dd-mm-yyyy hh:mm:ss`. Numeric values use standard 2-decimal formatting, except error percentages which may require higher precision if domain-specific (defaulting to 2).

## Join & Date Rules
- **Join:** Self-join logic is not required as all data resides in `recipes`. The `parent` and `child` tables are set to `recipes` with `id` as the key to satisfy structural requirements.
- **Date Filtering:** The report supports filtering by `start_time` and `end_time` from the `recipes` table.

## Transformations
- **Reshape:** Converts 12 bin columns into 12 rows per recipe.
- **Date Formatting:** Applies `format_date` to `start_time` and `end_time`.
- **Numeric Formatting:** Applies `number(2)` to weights and percentages.
- **Serial Numbers:** Generated dynamically per batch.

## Parameters
- **Required:** None (static defaults provided).
- **Optional:** `date_from`, `date_to` (mapped to `recipes.start_time` and `recipes.end_time`).