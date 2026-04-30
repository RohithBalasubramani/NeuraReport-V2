# Consumption Report Contract

## Executive Summary
This contract defines the data mapping for a Consumption Report generated from sensor telemetry data. The report aggregates flow meter readings (`neuract__FM_TABLE`) to calculate batch-level consumption metrics. It structures data into batches based on time intervals, calculating set weights, achieved weights, and error margins for each material batch.

## Token Inventory
- **Scalars**: Plant details, location, print date, report period (From/To), and report title. Most are static or derived from parameters.
- **Row Tokens**: Batch identifiers, timestamps (start/end), sequence numbers, material names, and calculated weight/error metrics per row.
- **Totals**: Aggregated sums for set weight, achieved weight, and error weight per batch, plus the average error percentage.

## Mapping Table
- **Time Source**: `neuract__FM_TABLE.timestamp_utc` is the primary timestamp for row ordering and batch grouping.
- **Weight Source**: `neuract__FM_TABLE.FM_101_TOTALIZER` is used as the proxy for weight accumulation (Set/Achieved) in the absence of explicit weight columns in the catalog.
- **Material Source**: `neuract__device_mappings.field_key` provides the material identifier.
- **Calculations**:
  - `row_error_kg` = `row_set_wt_kg` - `row_ach_wt_kg`
  - `row_error_percent` = (`row_error_kg` / `row_set_wt_kg`) * 100

## Join & Date Rules
- **Join**: Self-join on `neuract__FM_TABLE` using `timestamp_utc` as the key to simulate batch grouping logic in a flat DataFrame context.
- **Date Columns**: `neuract__FM_TABLE.timestamp_utc` is the sole date column, requiring `date_from` and `date_to` filters.

## Transformations
1. **Reshape**: No complex melting required; data is treated as a time-series stream.
2. **Formatting**: All timestamps formatted to `dd-mm-yyyy HH:MM:SS`. All numeric weights to 2 decimal places. Percentages to 2 decimal places.
3. **Aggregation**: Totals are computed per batch (grouped by `row_batch_num`).

## Parameters
- **Required**: `date_from`, `date_to` (for filtering the time range).
- **Optional**: `batch_no` (specific batch filter, though the report iterates batches).