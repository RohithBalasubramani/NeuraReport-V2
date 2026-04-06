from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, List, Tuple

REPO_ROOT = Path(__file__).resolve().parents[1]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.app.services.utils.artifacts import (  # type: ignore  # noqa: E402
    MANIFEST_SCHEMA_VERSION,
    compute_checksums,
    load_manifest,
)
from backend.app.utils.fs import (  # type: ignore  # noqa: E402
    write_text_atomic,
)
from backend.app.services.utils.validation import (  # type: ignore  # noqa: E402
    SchemaValidationError,
    validate_contract_schema,
    validate_mapping_schema,
)


@dataclass
class CheckResult:
    name: str
    ok: bool
    detail: str = ""


OPTIONAL_CHECKS: set[str] = {
    "artifact_manifest",
    "filled.html_artifacts",
    "filled.pdf_artifacts",
}


def _mark_optional(check: CheckResult) -> CheckResult:
    if check.name in OPTIONAL_CHECKS and not check.ok:
        return CheckResult(name=check.name, ok=True, detail=f"skipped: {check.detail}")
    return check


def _resolve_template_dir(uploads_root: Path, template_id: str) -> Tuple[Path, CheckResult]:
    """
    Ensure template_id is a UUID and resolve its directory under uploads_root.
    """
    try:
        tid = uuid.UUID(str(template_id))
    except (ValueError, TypeError):
        return uploads_root, CheckResult(
            name="template_id_format",
            ok=False,
            detail="template_id must be a valid UUID.",
        )

    base = uploads_root.resolve()
    tdir = (base / str(tid)).resolve()
    if base not in tdir.parents:
        return uploads_root, CheckResult(
            name="template_dir_safety",
            ok=False,
            detail="Resolved template directory escapes uploads root.",
        )
    if not tdir.exists():
        return tdir, CheckResult(
            name="template_dir_exists",
            ok=False,
            detail=f"Template directory not found: {tdir}",
        )
    return tdir, CheckResult(
        name="template_dir_exists",
        ok=True,
        detail=str(tdir),
    )


def _check_file_exists(tdir: Path, relative: str) -> CheckResult:
    path = tdir / relative
    return CheckResult(
        name=f"{relative}",
        ok=path.exists(),
        detail=str(path) if path.exists() else "missing",
    )


def _check_html(path: Path, name: str) -> CheckResult:
    if not path.exists():
        return CheckResult(name=name, ok=False, detail="file missing")
    text = path.read_text(encoding="utf-8", errors="ignore")
    ok = "<html" in text.lower() and "</html>" in text.lower()
    detail = "HTML structure detected" if ok else "Missing <html> or </html> tags"
    return CheckResult(name=name, ok=ok, detail=detail)


def _check_html_images(tdir: Path) -> CheckResult:
    path = tdir / "report_final.html"
    if not path.exists():
        return CheckResult(name="report_final_images", ok=False, detail="file missing")
    text = path.read_text(encoding="utf-8", errors="ignore")
    missing: list[str] = []
    for src in re.findall(r'<img[^>]+src=["\']([^"\']+)["\']', text, flags=re.IGNORECASE):
        if src.startswith(("http://", "https://", "data:")):
            continue
        candidate = (path.parent / src).resolve()
        if not str(candidate).startswith(str(tdir.resolve())):
            missing.append(f"{src} (unsafe path)")
        elif not candidate.exists():
            missing.append(src)
    ok = not missing
    detail = "all referenced images exist" if ok else "missing: " + ", ".join(missing)
    return CheckResult(name="report_final_images", ok=ok, detail=detail)


def _check_mapping(path: Path) -> CheckResult:
    if not path.exists():
        return CheckResult(name="mapping_pdf_labels.json", ok=False, detail="file missing")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        validate_mapping_schema(data)
    except (json.JSONDecodeError, SchemaValidationError) as exc:
        return CheckResult(name="mapping_pdf_labels_schema", ok=False, detail=f"invalid: {exc}")
    count = len(data) if isinstance(data, list) else 0
    return CheckResult(name="mapping_pdf_labels_schema", ok=True, detail=f"{count} entries")  # type: ignore[arg-type]


def _check_contract(path: Path) -> CheckResult:
    if not path.exists():
        return CheckResult(name="contract.json", ok=False, detail="file missing")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        validate_contract_schema(data)
    except (json.JSONDecodeError, SchemaValidationError) as exc:
        return CheckResult(name="contract_schema", ok=False, detail=f"invalid: {exc}")
    return CheckResult(name="contract_schema", ok=True, detail="keys ok")


def _check_image_contents(path: Path) -> CheckResult:
    if not path.exists():
        return CheckResult(name="_image_contents.json", ok=True, detail="optional file missing")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return CheckResult(name="_image_contents.json", ok=False, detail=f"invalid JSON: {exc}")
    ok = isinstance(data, list)
    detail = f"{len(data)} image entries" if ok else "expected list"
    return CheckResult(name="_image_contents_schema", ok=ok, detail=detail)


def _glob_filled_files(tdir: Path, suffix: str) -> CheckResult:
    files = sorted(tdir.glob(f"filled_*{suffix}"))
    ok = len(files) > 0
    detail = f"{len(files)} found" if ok else f"no filled_*{suffix} files"
    return CheckResult(name=f"filled{suffix}_artifacts", ok=ok, detail=detail)


def _check_manifest(tdir: Path) -> CheckResult:
    manifest = load_manifest(tdir)
    if not manifest:
        return CheckResult(name="artifact_manifest", ok=False, detail="missing or unreadable")
    errors: list[str] = []
    if manifest.get("schema_version") != MANIFEST_SCHEMA_VERSION:
        errors.append(f"schema_version={manifest.get('schema_version')}")
    if "step" not in manifest:
        errors.append("missing step")
    files = manifest.get("files", {})
    checksums = manifest.get("file_checksums", {})
    if not isinstance(files, dict) or not isinstance(checksums, dict):
        errors.append("invalid manifest structure")
    else:
        resolved = {name: (tdir / rel).resolve() for name, rel in files.items()}
        computed = compute_checksums(resolved)
        for name, checksum in computed.items():
            if checksums.get(name) != checksum:
                errors.append(f"checksum mismatch for {name}")
        for name, rel in files.items():
            if not (tdir / rel).exists():
                errors.append(f"missing file {rel}")
    ok = not errors
    detail = "manifest ok" if ok else "; ".join(errors)
    return CheckResult(name="artifact_manifest", ok=ok, detail=detail)


def _fmt_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts).isoformat(timespec="seconds")


def _check_staleness(tdir: Path) -> CheckResult:
    report = tdir / "report_final.html"
    contract = tdir / "contract.json"
    mapping = tdir / "mapping_pdf_labels.json"
    missing = [str(p.name) for p in (report, contract, mapping) if not p.exists()]
    if missing:
        return CheckResult(name="artifact_staleness", ok=False, detail="missing: " + ", ".join(missing))
    m_report = report.stat().st_mtime
    m_contract = contract.stat().st_mtime
    m_mapping = mapping.stat().st_mtime
    tolerance = 1.0  # seconds
    report_after_contract = m_report + tolerance >= m_contract
    contract_after_mapping = m_contract + tolerance >= m_mapping
    ok = report_after_contract and contract_after_mapping
    if ok:
        detail = f"order ok ({_fmt_ts(m_report)} >= {_fmt_ts(m_contract)} >= {_fmt_ts(m_mapping)})"
    else:
        detail = (
            "expected report_final >= contract >= mapping "
            f"(within {tolerance:.1f}s tolerance); "
            f"got {_fmt_ts(m_report)} / {_fmt_ts(m_contract)} / {_fmt_ts(m_mapping)}"
        )
    return CheckResult(name="artifact_staleness", ok=ok, detail=detail)


def _simulate_failure(tdir: Path, step: str) -> CheckResult:
    target = tdir / f".simulate_{step}.txt"
    previous_fail_after = os.environ.get("NEURA_FAIL_AFTER_STEP")
    os.environ["NEURA_FAIL_AFTER_STEP"] = step
    try:
        try:
            write_text_atomic(target, "simulate", step=step)
        except RuntimeError:
            pass
        else:
            return CheckResult(name=f"simulate_{step}", ok=False, detail="failure did not trigger")
    finally:
        if previous_fail_after is None:
            os.environ.pop("NEURA_FAIL_AFTER_STEP", None)
        else:
            os.environ["NEURA_FAIL_AFTER_STEP"] = previous_fail_after
        with contextlib.suppress(FileNotFoundError):
            target.unlink()
    residuals = list(tdir.glob(f".{target.name}.*.tmp"))
    ok = not residuals
    detail = "rollback ok" if ok else "residual temps: " + ", ".join(p.name for p in residuals)
    return CheckResult(name=f"simulate_{step}", ok=ok, detail=detail)


def verify_pipeline(
    template_id: str, uploads_root: Path, simulate: Iterable[str] | None = None
) -> Tuple[bool, List[CheckResult]]:
    uploads_root = uploads_root.resolve()
    original_fail_after = os.environ.get("NEURA_FAIL_AFTER_STEP")
    os.environ["NEURA_FAIL_AFTER_STEP"] = ""
    checks: List[CheckResult] = []

    try:
        tdir, dir_check = _resolve_template_dir(uploads_root, template_id)
        checks.append(dir_check)
        if not dir_check.ok:
            return False, checks

        required_files = [
            "source.pdf",
            "reference_p1.png",
            "template_p1.html",
            "report_final.html",
            "mapping_pdf_labels.json",
            "contract.json",
        ]

        for rel in required_files:
            checks.append(_check_file_exists(tdir, rel))

        checks.append(_check_html(tdir / "template_p1.html", "template_html_valid"))
        checks.append(_check_html(tdir / "report_final.html", "final_html_valid"))
        checks.append(_check_html_images(tdir))
        checks.append(_check_mapping(tdir / "mapping_pdf_labels.json"))
        checks.append(_check_contract(tdir / "contract.json"))
        checks.append(_check_image_contents(tdir / "_image_contents.json"))
        checks.append(_mark_optional(_check_manifest(tdir)))
        checks.append(_check_staleness(tdir))
        checks.append(_mark_optional(_glob_filled_files(tdir, ".html")))
        checks.append(_mark_optional(_glob_filled_files(tdir, ".pdf")))

        if simulate:
            for step in simulate:
                checks.append(_simulate_failure(tdir, step))

        success = all(check.ok for check in checks)
        return success, checks
    finally:
        if original_fail_after is None:
            os.environ.pop("NEURA_FAIL_AFTER_STEP", None)
        else:
            os.environ["NEURA_FAIL_AFTER_STEP"] = original_fail_after


def _print_report(checks: Iterable[CheckResult], success: bool) -> None:
    checks = list(checks)
    name_width = max((len(check.name) for check in checks), default=10)
    print(f"{'STATUS':<6} {'CHECK':<{name_width}} DETAILS")
    for check in checks:
        status = "OK" if check.ok else "FAIL"
        detail = check.detail
        print(f"{status:<6} {check.name:<{name_width}} {detail}")
    print(f"{'PASS' if success else 'FAIL'}")


def main(argv: List[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify pipeline artifacts for a template.")
    default_uploads = Path(__file__).resolve().parents[1] / "backend" / "uploads"
    parser.add_argument("--template-id", required=True, help="Template UUID to verify.")
    parser.add_argument(
        "--uploads-root",
        type=Path,
        default=default_uploads,
        help=f"Base uploads directory (default: {default_uploads})",
    )
    parser.add_argument(
        "--simulate",
        action="append",
        default=[],
        help="Simulate failure for the given step name to ensure rollback cleans up temps. Can be supplied multiple times.",
    )
    args = parser.parse_args(argv)

    success, checks = verify_pipeline(args.template_id, args.uploads_root, simulate=args.simulate)
    _print_report(checks, success)
    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
