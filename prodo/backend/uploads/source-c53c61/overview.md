# Consumption Report Mapping Contract

## Executive Summary
This contract defines the data pipeline for a **Consumption Report** generated from industrial sensor data. The report aggregates batch-level consumption metrics (Set Weight, Achieved Weight, Error) derived from Flow Meter (`FM_TABLE`) and Level Transmitter (`LT_TABLE`) data. The pipeline maps raw sensor readings to report tokens, computes row-level error metrics, and aggregates totals per batch. No SQL is used; all logic is expressed via declarative operations.

## Token Inventory
- **Scalars (Header):** Plant name, Location, Print Date, Date Range (From/To), Batch No.
- **Row Tokens (Detail):** Serial No, Material Name, Set Weight (Kg), Achieved Weight (Kg), Error (Kg), Error (%).
- **Totals (Batch Summary):** Batch ID, Start/End Timestamps, Total Set Weight, Total Achieved Weight, Total Error, Total Error %.

## Mapping Strategy
- **Source Data:** Primarily `neuract__FM_TABLE` for flow/weight data and `neuract__LT_TABLE` for level/weight context. `neuract__ANALYSER_TABLE` provides environmental context if needed.
- **Key Logic:**
  - `row_set_wt_kg` and `row_ach_wt_kg` are mapped from specific Flow Meter totalizer columns.
  - `row_error_kg` is computed as `Set - Achieved`.
  - `row_error_pct` is computed as `(Error / Set) * 100`.
  - Timestamps are formatted using `format_date` ops.
- **Parameters:** `from_date` and `to_date` are required filters for the time range. `batch_no` is a dynamic filter.

## Join & Date Rules
- **Join:** Self-join on `neuract__FM_TABLE` (acting as both parent and child for this single-table scope) keyed by `timestamp_utc` to align with batch windows.
- **Date Columns:** `neuract__FM_TABLE.timestamp_utc` is the primary date source.
- **Filters:** `date_from` and `date_to` map to the timestamp column for filtering.

## Transformations
- **Row Computed:** Subtraction for error, division for percentage.
- **Totals Math:** Summation of weights, weighted average or sum for error percentage.
- **Formatting:** Dates formatted as `dd-mm-yyyy hh:mm:ss`, numbers as `number(2)`.

## Parameters
- **Required:** `from_date`, `to_date` (Date), `batch_no` (String).
- **Optional:** None (Plant/Location are static or derived from context).