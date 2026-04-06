#!/usr/bin/env python3
"""Export the FastAPI OpenAPI schema deterministically.

Plan.md requirement:
- `/api/v1` is the single source of truth for client code generation.
- Root-mounted legacy routes remain for backwards compatibility but are excluded
  from the OpenAPI schema (see `backend/app/api/router.py`).
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="Export NeuraReport OpenAPI schema as JSON.")
    parser.add_argument(
        "--output",
        default="docs/openapi.json",
        help="Output path for the OpenAPI JSON (default: docs/openapi.json).",
    )
    args = parser.parse_args()

    # Ensure settings init doesn't raise if local env isn't configured.
    os.environ.setdefault("NEURA_DEBUG", "true")
    os.environ.setdefault("NEURA_JWT_SECRET", "openapi-export-dev-secret")

    repo_root = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(repo_root))

    from backend.api import app

    spec = app.openapi()
    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(spec, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Wrote OpenAPI schema to {output_path} (paths={len(spec.get('paths', {}))})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
