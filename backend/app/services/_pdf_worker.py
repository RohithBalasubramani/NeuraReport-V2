#!/usr/bin/env python3
"""Standalone Playwright PDF worker — runs in its own process.

Thin wrapper that delegates to the _convert function in reports.py.
See reports.py (_pdf_worker section) for the full implementation.

Usage:
    python _pdf_worker.py <json-args>
"""
from __future__ import annotations

import json
import sys


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: _pdf_worker.py <json-args>", file=sys.stderr)
        sys.exit(1)

    import asyncio
    from backend.app.services.reports import _convert

    args = json.loads(sys.argv[1])
    asyncio.run(
        _convert(
            html_path=args["html_path"],
            pdf_path=args["pdf_path"],
            base_dir=args["base_dir"],
            pdf_scale=args.get("pdf_scale"),
        )
    )


if __name__ == "__main__":
    main()
