"""
DataValidator — Data validation using great-expectations patterns.

Validates report data against contract constraints and domain rules.
Returns structured violations for frontend display.
"""
import logging
from typing import Any

import pandas as pd

try:
    import great_expectations as gx
    from great_expectations.dataset import PandasDataset
    GX_AVAILABLE = True
except ImportError:
    GX_AVAILABLE = False

log = logging.getLogger(__name__)


class DataValidator:
    """Validates DataFrame columns and report data against expectations."""

    def validate_column(
        self, df: pd.DataFrame, column: str, expectations: list[dict]
    ) -> list[dict]:
        """
        Run expectations on a single column.

        Each expectation dict has:
            - type: 'not_null' | 'unique' | 'in_range' | 'regex' | 'in_set'
            - params: dict of parameters (min, max, pattern, values, etc.)

        Returns list of violation dicts:
            { field, rule, value, severity, message }
        """
        violations = []
        if column not in df.columns:
            violations.append({
                "field": column,
                "rule": "column_exists",
                "value": None,
                "severity": "error",
                "message": f"Column '{column}' not found in data",
            })
            return violations

        series = df[column]

        for exp in expectations:
            exp_type = exp.get("type", "")
            params = exp.get("params", {})

            if exp_type == "not_null":
                null_count = int(series.isnull().sum())
                if null_count > 0:
                    violations.append({
                        "field": column,
                        "rule": "not_null",
                        "value": f"{null_count} nulls",
                        "severity": params.get("severity", "warning"),
                        "message": f"{column} has {null_count} null values ({null_count/len(df)*100:.1f}%)",
                    })

            elif exp_type == "unique":
                dup_count = int(series.duplicated().sum())
                if dup_count > 0:
                    violations.append({
                        "field": column,
                        "rule": "unique",
                        "value": f"{dup_count} duplicates",
                        "severity": params.get("severity", "warning"),
                        "message": f"{column} has {dup_count} duplicate values",
                    })

            elif exp_type == "in_range":
                try:
                    numeric = pd.to_numeric(series, errors="coerce")
                    min_val = params.get("min")
                    max_val = params.get("max")
                    if min_val is not None:
                        below = int((numeric < min_val).sum())
                        if below > 0:
                            violations.append({
                                "field": column,
                                "rule": "in_range",
                                "value": f"{below} below {min_val}",
                                "severity": params.get("severity", "error"),
                                "message": f"{column} has {below} values below minimum {min_val}",
                            })
                    if max_val is not None:
                        above = int((numeric > max_val).sum())
                        if above > 0:
                            violations.append({
                                "field": column,
                                "rule": "in_range",
                                "value": f"{above} above {max_val}",
                                "severity": params.get("severity", "error"),
                                "message": f"{column} has {above} values above maximum {max_val}",
                            })
                except Exception:
                    pass

            elif exp_type == "regex":
                pattern = params.get("pattern", "")
                if pattern:
                    try:
                        non_match = int((~series.astype(str).str.match(pattern, na=False)).sum())
                        if non_match > 0:
                            violations.append({
                                "field": column,
                                "rule": "regex",
                                "value": f"{non_match} non-matching",
                                "severity": params.get("severity", "warning"),
                                "message": f"{column} has {non_match} values not matching pattern '{pattern}'",
                            })
                    except Exception:
                        pass

            elif exp_type == "in_set":
                allowed = set(params.get("values", []))
                if allowed:
                    outside = int((~series.isin(allowed)).sum())
                    if outside > 0:
                        violations.append({
                            "field": column,
                            "rule": "in_set",
                            "value": f"{outside} outside set",
                            "severity": params.get("severity", "warning"),
                            "message": f"{column} has {outside} values not in allowed set",
                        })

        return violations

    def validate_report_data(
        self, df: pd.DataFrame, contract: dict
    ) -> list[dict]:
        """
        Validate data against contract constraints.

        Reads constraints from contract['constraints'] or infers defaults.
        Returns list of violations.
        """
        violations = []

        if df is None or df.empty:
            return [{"field": "*", "rule": "has_data", "value": None,
                      "severity": "error", "message": "No data to validate"}]

        constraints = contract.get("constraints", [])

        # Apply explicit constraints
        for constraint in constraints:
            col = constraint.get("column") or constraint.get("field")
            exps = constraint.get("expectations", [])
            if col and exps:
                violations.extend(self.validate_column(df, col, exps))

        # Default validations (always run)
        # 1. Check for completely empty columns
        for col in df.columns:
            null_pct = df[col].isnull().mean() * 100
            if null_pct == 100:
                violations.append({
                    "field": col,
                    "rule": "not_all_null",
                    "value": "100% null",
                    "severity": "error",
                    "message": f"Column '{col}' is entirely empty",
                })
            elif null_pct > 50:
                violations.append({
                    "field": col,
                    "rule": "high_null_pct",
                    "value": f"{null_pct:.1f}% null",
                    "severity": "warning",
                    "message": f"Column '{col}' is {null_pct:.1f}% null",
                })

        # 2. Check row count
        if len(df) == 0:
            violations.append({
                "field": "*",
                "rule": "min_rows",
                "value": "0",
                "severity": "error",
                "message": "Dataset has no rows",
            })

        # 3. Use great-expectations if available for advanced checks
        if GX_AVAILABLE and len(df) > 0:
            try:
                ge_df = PandasDataset(df)
                # Auto-detect numeric columns and check for negative totals
                for col in df.select_dtypes(include=["number"]).columns:
                    if "total" in col.lower() or "amount" in col.lower() or "qty" in col.lower():
                        result = ge_df.expect_column_values_to_be_between(
                            col, min_value=0, mostly=0.95
                        )
                        if not result.success:
                            violations.append({
                                "field": col,
                                "rule": "non_negative",
                                "value": None,
                                "severity": "warning",
                                "message": f"Column '{col}' has unexpected negative values",
                                "explanation": "Total/amount/quantity columns typically should not be negative.",
                            })
            except Exception as e:
                log.debug("great-expectations validation skipped: %s", e)

        return violations

    def get_column_stats(
        self, df: pd.DataFrame, columns: list[str] | None = None
    ) -> dict[str, dict]:
        """
        Get distribution, null%, unique count, top values for columns.

        Returns: { "column_name": { nullPct, uniqueCount, topValues, type, distribution } }
        """
        stats = {}
        target_columns = columns or list(df.columns)

        for col in target_columns:
            if col not in df.columns:
                continue

            series = df[col]
            null_pct = float(series.isnull().mean() * 100)
            unique_count = int(series.nunique())

            # Top values
            top_values = []
            try:
                vc = series.dropna().value_counts().head(5)
                top_values = [str(v) for v in vc.index.tolist()]
            except Exception:
                pass

            # Detect type
            dtype = str(series.dtype)
            if "int" in dtype or "float" in dtype:
                col_type = "number"
            elif "datetime" in dtype:
                col_type = "datetime"
            elif "bool" in dtype:
                col_type = "boolean"
            else:
                col_type = "text"

            # Distribution (histogram for numbers, top-N for text)
            distribution = []
            try:
                if col_type == "number":
                    numeric = pd.to_numeric(series, errors="coerce").dropna()
                    if len(numeric) > 0:
                        hist_values, bin_edges = pd.cut(numeric, bins=min(10, len(numeric)), retbins=True)
                        counts = hist_values.value_counts().sort_index()
                        distribution = [int(c) for c in counts.values]
                elif col_type == "datetime":
                    # Temporal distribution by month
                    dt = pd.to_datetime(series, errors="coerce").dropna()
                    if len(dt) > 0:
                        monthly = dt.dt.to_period("M").value_counts().sort_index()
                        temporal = [{"period": str(p), "count": int(c)} for p, c in monthly.items()]
                        # Store temporal separately
                        stats[col] = {
                            "nullPct": round(null_pct, 1),
                            "uniqueCount": unique_count,
                            "topValues": top_values,
                            "type": col_type,
                            "distribution": distribution,
                            "temporalDistribution": temporal[:24],  # Last 24 periods
                        }
                        continue
                else:
                    vc = series.dropna().value_counts().head(8)
                    distribution = [int(c) for c in vc.values]
            except Exception:
                pass

            stats[col] = {
                "nullPct": round(null_pct, 1),
                "uniqueCount": unique_count,
                "topValues": top_values,
                "type": col_type,
                "distribution": distribution,
            }

        return stats

    def stratified_sample(
        self, df: pd.DataFrame, key_column: str | None = None, n: int = 5
    ) -> pd.DataFrame:
        """
        Select representative sample rows using stratified sampling.
        Ensures coverage of: edge cases, null-heavy rows, high/low values.
        """
        if df is None or df.empty:
            return df

        samples = []

        # 1. First row (header-adjacent)
        samples.append(df.iloc[0])

        # 2. Last row (boundary)
        if len(df) > 1:
            samples.append(df.iloc[-1])

        # 3. Row with most nulls
        null_counts = df.isnull().sum(axis=1)
        if null_counts.max() > 0:
            samples.append(df.iloc[null_counts.idxmax()])

        # 4. If key column, get diverse keys
        if key_column and key_column in df.columns:
            unique_keys = df[key_column].dropna().unique()
            for key in unique_keys[:min(n, len(unique_keys))]:
                row = df[df[key_column] == key].iloc[0]
                samples.append(row)

        # 5. Random sample to fill
        remaining = n - len(samples)
        if remaining > 0 and len(df) > len(samples):
            random_idx = df.index.difference(
                pd.Index([s.name for s in samples if hasattr(s, "name")])
            )
            if len(random_idx) > 0:
                samples.extend(
                    df.loc[random_idx].sample(min(remaining, len(random_idx))).itertuples(index=False, name=None)
                )

        result = pd.DataFrame(samples[:n], columns=df.columns).drop_duplicates()
        return result.head(n)
