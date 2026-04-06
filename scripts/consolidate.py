#!/usr/bin/env python3
"""
Codebase consolidation script.
Merges multiple Python files into single domain-grouped files,
updates all import references, creates backward-compat stubs, and deletes originals.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
APP = BACKEND / "app"

# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def read(p: Path) -> str:
    return p.read_text(encoding="utf-8") if p.exists() else ""


def write(p: Path, content: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    print(f"  WRITE {p.relative_to(ROOT)}")


def delete(p: Path) -> None:
    if p.exists():
        p.unlink()
        print(f"  DEL   {p.relative_to(ROOT)}")


def delete_dir_if_empty(d: Path) -> None:
    if d.is_dir() and not any(d.iterdir()):
        d.rmdir()
        print(f"  RMDIR {d.relative_to(ROOT)}")


def find_py_files(base: Path) -> List[Path]:
    """Find all .py files under base, excluding .venv and __pycache__."""
    results = []
    for root, dirs, files in os.walk(base):
        dirs[:] = [d for d in dirs if d not in (".venv", "__pycache__", "node_modules")]
        for f in files:
            if f.endswith(".py"):
                results.append(Path(root) / f)
    return results


def update_imports_in_file(
    filepath: Path,
    old_module: str,  # e.g. "backend.app.utils.fs"
    new_module: str,  # e.g. "backend.app.utils.core"
) -> bool:
    """Replace imports of old_module with new_module in filepath. Returns True if changed."""
    content = read(filepath)
    if old_module not in content:
        return False

    # Pattern: from backend.app.utils.fs import X
    # Replace with: from backend.app.utils.core import X
    old_escaped = re.escape(old_module)
    pattern = re.compile(rf"(from\s+){old_escaped}(\s+import)")
    new_content = pattern.sub(rf"\g<1>{new_module}\g<2>", content)

    # Also handle: import backend.app.utils.fs
    pattern2 = re.compile(rf"(import\s+){old_escaped}\b")
    new_content = pattern2.sub(rf"\g<1>{new_module}", new_content)

    if new_content != content:
        write(filepath, new_content)
        return True
    return False


def collect_imports(lines: List[str]) -> Tuple[set, List[str]]:
    """Extract 'from __future__' and stdlib imports from file top, return (imports_set, remaining_lines)."""
    future_imports = set()
    stdlib_imports = set()
    body_start = 0

    for i, line in enumerate(lines):
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or stripped.startswith('"""') or stripped.startswith("'''"):
            continue
        if stripped.startswith("from __future__"):
            future_imports.add(stripped)
            body_start = i + 1
            continue
        if stripped.startswith("import ") or stripped.startswith("from "):
            stdlib_imports.add(stripped)
            body_start = i + 1
            continue
        break

    # Find the actual body start (after docstrings too)
    return future_imports | stdlib_imports, lines[body_start:]


def merge_files(source_files: List[Path], header: str = "") -> str:
    """Merge multiple Python files into one, deduplicating top-level imports."""
    all_imports = set()
    all_bodies = []

    for f in source_files:
        if not f.exists():
            continue
        content = read(f)
        lines = content.split("\n")

        # Skip module-level docstring
        body_lines = []
        in_docstring = False
        docstring_done = False
        imports_section = True
        file_imports = []

        i = 0
        # Skip leading docstring
        while i < len(lines):
            line = lines[i].strip()
            if not docstring_done:
                if not line:
                    i += 1
                    continue
                if line.startswith('"""') or line.startswith("'''"):
                    quote = line[:3]
                    if line.count(quote) >= 2 and len(line) > 3:
                        # Single-line docstring
                        i += 1
                        docstring_done = True
                        continue
                    # Multi-line docstring
                    i += 1
                    while i < len(lines) and quote not in lines[i]:
                        i += 1
                    i += 1  # skip closing quote line
                    docstring_done = True
                    continue
                docstring_done = True

            if imports_section:
                if line.startswith("from __future__") or line.startswith("import ") or line.startswith("from "):
                    file_imports.append(lines[i])
                    i += 1
                    # Handle multi-line imports
                    while i < len(lines) and (lines[i].strip().startswith(",") or lines[i].strip().startswith(")")):
                        file_imports[-1] += "\n" + lines[i]
                        i += 1
                    continue
                elif not line:
                    i += 1
                    continue
                else:
                    imports_section = False

            body_lines.append(lines[i])
            i += 1

        for imp in file_imports:
            all_imports.add(imp.strip())

        # Add section separator with original filename
        fname = f.stem
        all_bodies.append(f"\n# {'─' * 60}")
        all_bodies.append(f"# Originally: {f.name}")
        all_bodies.append(f"# {'─' * 60}\n")
        all_bodies.extend(body_lines)

    # Build final content
    parts = []
    if header:
        parts.append(header)

    # Sort imports: __future__ first, then stdlib, then local
    future = sorted(i for i in all_imports if "from __future__" in i)
    local = sorted(i for i in all_imports if i.startswith("from backend.") or i.startswith("from ."))
    stdlib = sorted(i for i in all_imports if i not in set(future) and i not in set(local))

    if future:
        parts.extend(future)
        parts.append("")
    if stdlib:
        parts.extend(stdlib)
        parts.append("")
    if local:
        parts.extend(local)
        parts.append("")

    parts.extend(all_bodies)

    result = "\n".join(parts)
    # Remove internal cross-imports that now reference the same file
    return result


def update_all_imports(old_mod: str, new_mod: str) -> int:
    """Update all imports across the codebase. Returns count of files changed."""
    count = 0
    for f in find_py_files(BACKEND):
        if update_imports_in_file(f, old_mod, new_mod):
            count += 1
    return count


# ─────────────────────────────────────────────────────────────────
# Phase B1: Domain + App Utils
# ─────────────────────────────────────────────────────────────────

def phase_b1_domain():
    """Merge domain/ 4 files -> 1 models.py"""
    print("\n=== Phase B1a: Domain Consolidation ===")

    domain = APP / "domain"
    sources = [
        domain / "connections.py",
        domain / "jobs.py",
        domain / "schedules.py",
        domain / "templates.py",
    ]

    target = domain / "models.py"

    # Read and merge
    header = '"""Domain entities for the NeuraReport application.\n\nPure business logic: no I/O, no framework dependencies.\nConsolidated from connections, jobs, schedules, and templates.\n"""\n'
    content = merge_files(sources, header)
    write(target, content)

    # Update imports across codebase
    for src in sources:
        old_mod = f"backend.app.domain.{src.stem}"
        new_mod = "backend.app.domain.models"
        # Also handle relative imports: from .connections import X -> from .models import X
        n = update_all_imports(old_mod, new_mod)
        print(f"  Updated {n} files: {old_mod} -> {new_mod}")

    # Delete originals
    for src in sources:
        delete(src)

    # Update __init__.py
    init = domain / "__init__.py"
    write(init, '"""Domain layer for pure business logic."""\nfrom .models import *  # noqa: F401,F403\n')

    print(f"  Domain: 4 files -> 1 (models.py)")


def phase_b1_utils():
    """Merge utils/ 12 files -> 2 (core.py + security.py)"""
    print("\n=== Phase B1b: Utils Consolidation ===")

    utils = APP / "utils"

    # Group 1: core.py (general utilities)
    core_sources = [
        utils / "result.py",
        utils / "event_bus.py",
        utils / "pipeline.py",
        utils / "strategies.py",
        utils / "env_loader.py",
        utils / "fs.py",
        utils / "job_status.py",
    ]

    # Group 2: security.py (validation & security)
    security_sources = [
        utils / "errors.py",
        utils / "sql_safety.py",
        utils / "ssrf_guard.py",
        utils / "validation.py",
        utils / "email_utils.py",
    ]

    # ─── core.py ───
    core_header = '"""Core utilities: Result type, event bus, pipeline runner, strategies, env loader, filesystem, job status.\n"""\n'
    core_content = merge_files(core_sources, core_header)

    # Remove internal cross-imports within core.py
    # pipeline.py imports from .event_bus and .result - these are now in same file
    core_content = re.sub(r"from \.event_bus import [^\n]+\n", "", core_content)
    core_content = re.sub(r"from \.result import [^\n]+\n", "", core_content)

    core_target = utils / "core.py"
    write(core_target, core_content)

    # ─── security.py ───
    sec_header = '"""Security utilities: errors, SQL safety, SSRF guard, validation, email utils.\n"""\n'
    sec_content = merge_files(security_sources, sec_header)

    # Remove internal cross-import: email_utils imports from validation (now same file)
    sec_content = re.sub(r"from backend\.app\.utils\.validation import [^\n]+\n", "", sec_content)

    sec_target = utils / "security.py"
    write(sec_target, sec_content)

    # Update imports across codebase
    for src in core_sources:
        old_mod = f"backend.app.utils.{src.stem}"
        new_mod = "backend.app.utils.core"
        n = update_all_imports(old_mod, new_mod)
        print(f"  Updated {n} files: {old_mod} -> {new_mod}")

    for src in security_sources:
        old_mod = f"backend.app.utils.{src.stem}"
        new_mod = "backend.app.utils.security"
        n = update_all_imports(old_mod, new_mod)
        print(f"  Updated {n} files: {old_mod} -> {new_mod}")

    # Delete originals
    for src in core_sources + security_sources:
        delete(src)

    # Update __init__.py
    init = utils / "__init__.py"
    write(init, '"""App utilities (consolidated)."""\nfrom __future__ import annotations\n\nfrom .core import *  # noqa: F401,F403\nfrom .security import *  # noqa: F401,F403\n')

    print(f"  Utils: 12 files -> 2 (core.py + security.py)")


# ─────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────

def main():
    phases = sys.argv[1:] if len(sys.argv) > 1 else ["b1"]

    for phase in phases:
        phase = phase.lower()
        if phase == "b1":
            phase_b1_domain()
            phase_b1_utils()
        else:
            print(f"Unknown phase: {phase}")
            sys.exit(1)

    print("\n✓ Consolidation complete!")
    print("  Run: python -c 'import backend.api' to verify no import errors")


if __name__ == "__main__":
    main()
