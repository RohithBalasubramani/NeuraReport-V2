# Costal Feeds Temperature Report: Contract Overview

## Executive Summary
This report visualizes temperature readings from various PT100 sensors across the Costal Feeds facility. It presents a time-series log of measurements, capturing timestamps alongside specific sensor values (M1A, P3A, P4A, etc.) and environmental conditions (Room, Dryout). The output is a landscape A4 sheet designed for physical printing.

## Token Inventory
- **Row Tokens (12)**: `row_date_time` (timestamp), and 11 numeric sensor tokens (`row_m1a_2_pt100` through `row_room_pt100`).
- **Scalar Tokens**: None.
- **Total Tokens**: None.

## Mapping Status
Due to an empty input catalog, all tokens are currently marked as `UNRESOLVED`. The contract defines the *expected* structure and formatting logic (date formatting, numeric precision) so that once the data source is connected, the pipeline will automatically apply the correct transformations:
- **Timestamps**: Formatted as `DD-MM-YYYY HH:MM:SS`.
- **Numerics**: Formatted with 2 decimal places.

## Join & Date Rules
- **Join Strategy**: Self-join (single table source assumed). `parent_table` = `child_table`.
- **Date Filtering**: The contract anticipates a `date_columns` mapping once the source is known, enabling `date_from` and `date_to` filters.

## Transformations
- **Date Formatting**: Explicit `format_date` operation applied to the timestamp column.
- **Numeric Formatting**: Display formatting applied to all sensor columns.
- **Reshaping**: No reshaping (MELT/UNION) required; data is assumed to be in wide format matching the report columns.

## Parameters
- **Required**: None (filters are optional until catalog is populated).
- **Optional**: `date_from`, `date_to` (pending column resolution).