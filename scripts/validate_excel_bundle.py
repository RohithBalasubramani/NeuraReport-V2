#!/usr/bin/env python

# mypy: ignore-errors
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.utils.validation import (  # noqa: E402  # pylint: disable=wrong-import-position
    SchemaValidationError,
    validate_contract_v2,
    validate_generator_output_schemas,
    validate_generator_sql_pack,
    validate_step5_requirements,
)


def _load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:  # pragma: no cover - convenience script
        raise RuntimeError(f"Failed to load JSON from {path}: {exc}") from exc


def _validate_contract(contract_path: Path) -> list[str]:
    data = _load_json(contract_path)
    issues: list[str] = []
    try:
        validate_contract_v2(data, require_join=False)
    except SchemaValidationError as exc:
        issues.append(f"{contract_path.name}: {exc}")
        return issues

    row_order = data.get("row_order")
    if not isinstance(row_order, list) or not row_order:
        issues.append(f"{contract_path.name}: row_order missing or empty")
    reshape_rules = data.get("reshape_rules") or []
    for idx, rule in enumerate(reshape_rules):
        purpose = ""
        if isinstance(rule, dict):
            purpose = str(rule.get("purpose") or "").strip()
        if not purpose:
            issues.append(f"{contract_path.name}: reshape_rules[{idx}] missing purpose")
    return issues


def _normalize_order_entries(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value.strip()
        return [text] if text else []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item or "").strip()]
    return []


def _validate_excel_step5_payload(data: dict, label: str) -> list[str]:
    issues: list[str] = []
    params = data.get("parameters")
    if not isinstance(params, dict):
        issues.append(f"{label}: parameters must be an object")
    else:
        for key in ("required", "optional"):
            arr = params.get(key)
            if arr is None:
                continue
            if not isinstance(arr, list):
                issues.append(f"{label}: parameters.{key} must be an array when provided")
    datasets = data.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        issues.append(f"{label}: datasets must be a non-empty array")
    else:
        for idx, dataset in enumerate(datasets):
            if not isinstance(dataset, dict):
                issues.append(f"{label}: datasets[{idx}] must be an object")
                continue
            alias = str(dataset.get("alias") or "").strip()
            if not alias:
                issues.append(f"{label}: datasets[{idx}].alias must be a non-empty string")
            columns = dataset.get("columns")
            if not isinstance(columns, list) or not columns:
                issues.append(f"{label}: datasets[{idx}].columns must be a non-empty array")
                continue
            for col_idx, column in enumerate(columns):
                if not isinstance(column, dict):
                    issues.append(f"{label}: datasets[{idx}].columns[{col_idx}] must be an object")
                    continue
                alias = str(column.get("as") or "").strip()
                source = column.get("from")
                if not alias:
                    issues.append(f"{label}: datasets[{idx}].columns[{col_idx}].as must be a non-empty string")
                if not isinstance(source, str) or not source.strip():
                    issues.append(f"{label}: datasets[{idx}].columns[{col_idx}].from must be a non-empty string")
    order_block = data.get("order_by")
    rows_order_entries: list[str] = []
    if isinstance(order_block, dict):
        rows_order_entries = _normalize_order_entries(order_block.get("rows"))
    elif order_block is not None:
        rows_order_entries = _normalize_order_entries(order_block)
    if not rows_order_entries:
        issues.append(f"{label}: order_by.rows must include at least one clause")
    row_order_entries = _normalize_order_entries(data.get("row_order"))
    if not row_order_entries:
        issues.append(f"{label}: row_order must include at least one clause")
    return issues


def _validate_step5(step5_path: Path) -> list[str]:
    data = _load_json(step5_path)
    issues: list[str] = []
    try:
        validate_step5_requirements(data)
    except SchemaValidationError as exc:
        if isinstance(data.get("datasets"), list):
            issues.extend(_validate_excel_step5_payload(data, step5_path.name))
        else:
            issues.append(f"{step5_path.name}: {exc}")
    return issues


def _validate_generator_bundle(bundle_dir: Path) -> list[str]:
    issues: list[str] = []
    sql_pack_path = bundle_dir / "sql_pack.sql"
    generator_meta_path = bundle_dir / "generator_assets.json"
    output_schemas_path = bundle_dir / "output_schemas.json"

    if not generator_meta_path.exists():
        return [f"{generator_meta_path} missing"]
    if not output_schemas_path.exists():
        issues.append(f"{output_schemas_path} missing")

    meta = _load_json(generator_meta_path)
    output_schemas = _load_json(output_schemas_path) if output_schemas_path.exists() else {}

    try:
        validate_generator_output_schemas(output_schemas)
    except SchemaValidationError as exc:
        issues.append(f"output_schemas.json: {exc}")

    sql_pack_payload = {
        "dialect": meta.get("dialect") or "sqlite",
        "script": (bundle_dir / "sql_pack.sql").read_text(encoding="utf-8") if sql_pack_path.exists() else "",
        "entrypoints": meta.get("entrypoints") or {},
        "params": meta.get("params") or {"required": [], "optional": []},
    }
    try:
        validate_generator_sql_pack(sql_pack_payload)
    except SchemaValidationError as exc:
        issues.append(f"generator_assets.sql_pack: {exc}")

    return issues


def validate_excel_upload(upload_dir: Path) -> list[str]:
    required_files = [
        upload_dir / "contract.json",
        upload_dir / "step5_requirements.json",
        upload_dir / "generator" / "generator_assets.json",
        upload_dir / "generator" / "output_schemas.json",
        upload_dir / "generator" / "sql_pack.sql",
    ]
    missing = [str(path) for path in required_files if not path.exists()]
    if missing:
        return [f"Missing required files: {', '.join(missing)}"]

    issues: list[str] = []
    issues.extend(_validate_contract(upload_dir / "contract.json"))
    issues.extend(_validate_step5(upload_dir / "step5_requirements.json"))
    issues.extend(_validate_generator_bundle(upload_dir / "generator"))
    return issues


def main(argv: Iterable[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate Excel uploads bundle.")
    parser.add_argument("path", type=Path, help="Path to uploads_excel/<uuid> directory")
    args = parser.parse_args(argv)
    upload_dir: Path = args.path
    if not upload_dir.exists():
        print(f"{upload_dir} not found", file=sys.stderr)
        return 2

    issues = validate_excel_upload(upload_dir)
    if issues:
        print("Validation failed:")
        for issue in issues:
            print(f" - {issue}")
        return 1

    print(f"{upload_dir} passed validation.")
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
