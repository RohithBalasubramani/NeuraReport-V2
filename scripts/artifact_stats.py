from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

default_warn_bytes = int(os.getenv("ARTIFACT_WARN_BYTES", "5242880"))
default_warn_render_ms = int(os.getenv("ARTIFACT_WARN_RENDER_MS", "2000"))


class ArtifactStatsError(RuntimeError):
    pass


def load_manifest(template_id: str, uploads_root: Path) -> dict:
    manifest_path = uploads_root / template_id / "artifact_manifest.json"
    if not manifest_path.exists():
        raise ArtifactStatsError(f"manifest not found: {manifest_path}")
    try:
        return json.loads(manifest_path.read_text(encoding="utf-8"))
    except Exception as exc:
        raise ArtifactStatsError(f"failed to parse manifest: {exc}") from exc


def check_thresholds(manifest: dict, warn_bytes: int, warn_render_ms: int, template_dir: Path) -> list[str]:
    issues: list[str] = []
    files = manifest.get("files") or {}
    for name, rel in files.items():
        try:
            path = (template_dir / rel).resolve()
        except Exception:
            path = None
        if not path:
            continue
        template_root = template_dir.resolve()
        if template_root not in path.parents and path != template_root:
            issues.append(f"{name} path escapes template_dir: {rel}")
            continue
        if not path.exists():
            continue
        size = path.stat().st_size
        if size > warn_bytes:
            issues.append(f"{name} size {size} > {warn_bytes}")
    render_times = manifest.get("render_times_ms") or {}
    for name, value in render_times.items():
        try:
            ms = float(value)
        except (TypeError, ValueError):
            continue
        if ms > warn_render_ms:
            issues.append(f"{name} render {ms:.1f}ms > {warn_render_ms}")
    return issues


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Inspect artifact manifest metrics.")
    parser.add_argument("--template-id", required=True, help="Template UUID to inspect.")
    parser.add_argument("--uploads-root", type=Path, default=Path("backend/uploads"), help="Uploads directory root.")
    parser.add_argument(
        "--warn-bytes", type=int, default=default_warn_bytes, help="Warn if artifact exceeds this many bytes."
    )
    parser.add_argument(
        "--warn-render-ms", type=int, default=default_warn_render_ms, help="Warn if render time exceeds this many ms."
    )
    args = parser.parse_args(argv)

    uploads_root = args.uploads_root.resolve()
    if not uploads_root.exists():
        print(f"Uploads root not found: {uploads_root}", file=sys.stderr)
        return 2

    try:
        manifest = load_manifest(args.template_id, uploads_root)
    except ArtifactStatsError as exc:
        print(str(exc), file=sys.stderr)
        return 2

    template_dir = (uploads_root / args.template_id).resolve()
    issues = check_thresholds(manifest, args.warn_bytes, args.warn_render_ms, template_dir)

    print(
        json.dumps(
            {
                "template_id": args.template_id,
                "produced_at": manifest.get("produced_at"),
                "files": manifest.get("files"),
                "issues": issues,
            },
            indent=2,
        )
    )

    return 0 if not issues else 3


if __name__ == "__main__":
    sys.exit(main())
