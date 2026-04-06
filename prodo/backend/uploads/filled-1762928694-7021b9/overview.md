# Consumption Report Contract

## Executive Summary
This contract defines the data mapping and transformation logic for a **Consumption Report** generated from the `recipes` table. The report displays material consumption metrics, comparing set weights against actual weights to calculate error margins in both absolute (Kg) and percentage terms. The data source is a wide-format recipe table containing 12 potential bins, but this specific report view focuses on the first bin (`bin1`).

## Token Inventory
- **Scalars**: `print_date`, `from_date`, `to_date` (Report metadata).
- **Row Tokens**: 
  - `row_sl_no`: Sequential batch number.
  - `row_material_name`: Name of the material in Bin 1.
  - `row_set_wt_kg`: Target weight for Bin 1.
  - `row_ach_wt_kg`: Actual weight recorded for Bin 1.
  - `row_error_kg`: Computed difference (Actual - Set).
  - `row_error_pct`: Computed percentage error.
- **Totals**: Currently empty (no aggregate totals defined in schema).

## Mapping Table
| Token | Source Column | Type | Notes |
|-------|---------------|------|-------|
| `row_sl_no` | `recipes.rowid` | Direct | Used as sequence identifier. |
| `row_material_name` | `recipes.bin1_content` | Direct | Material name for Bin 1. |
| `row_set_wt_kg` | `recipes.bin1_sp` | Direct | Set Point (Target) weight. |
| `row_ach_wt_kg` | `recipes.bin1_act` | Direct | Actual weight. |
| `row_error_kg` | Computed | Derived | `row_ach_wt_kg` - `row_set_wt_kg`. |
| `row_error_pct` | Computed | Derived | (`row_error_kg` / `row_set_wt_kg`) * 100. |

## Join & Date Rules
- **Join Strategy**: Single table (`recipes`). No joins required.
- **Date Handling**: The schema includes date scalars (`from_date`, `to_date`) but the source table `recipes` contains `start_time` and `end_time`. The report currently relies on parameter passthrough for the header dates. No row-level date filtering is applied in the base mapping, but date columns are registered for potential future filtering.

## Transformations
1. **Error Calculation**: Subtracts Set Weight from Actual Weight.
2. **Percentage Calculation**: Divides the Error by the Set Weight and multiplies by 100.
3. **Formatting**: 
   - Numeric columns (`row_set_wt_kg`, `row_ach_wt_kg`, `row_error_kg`) are formatted to 2 decimal places.
   - Percentage column (`row_error_pct`) is formatted to 2 decimal places.
   - `row_sl_no` is treated as an integer.

## Parameters
- **Required**: None (all data is pulled from the `recipes` table).
- **Optional**: `date_from`, `date_to` (for filtering the `recipes` table by `start_time` if implemented).