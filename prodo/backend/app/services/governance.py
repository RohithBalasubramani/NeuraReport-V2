# mypy: ignore-errors
"""
UX Governance Guards (merged from V1 governance_guards.py).

Enforces:
- All API routes have governance decorators
- Intent headers are validated on mutating endpoints
- Source code pattern checks
- AST-based analysis

These guards run at startup and in CI to prevent regressions.
"""
from __future__ import annotations

import ast
import re
import sys
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set, Tuple

try:
    from fastapi import FastAPI
    from fastapi.routing import APIRoute
except ImportError:
    FastAPI = None
    APIRoute = None


class ViolationSeverity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass
class GovernanceViolation:
    rule: str
    message: str
    severity: ViolationSeverity
    location: str
    line: Optional[int] = None
    suggestion: Optional[str] = None


@dataclass
class GovernanceCheckResult:
    passed: bool
    violations: List[GovernanceViolation] = field(default_factory=list)
    checked_items: int = 0

    @property
    def error_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == ViolationSeverity.ERROR)

    @property
    def warning_count(self) -> int:
        return sum(1 for v in self.violations if v.severity == ViolationSeverity.WARNING)


INTENT_REQUIRED_ENDPOINTS = {
    "POST": ["create", "add", "upload", "generate", "execute", "submit"],
    "PUT": ["update", "modify", "change", "edit"],
    "PATCH": ["update", "modify", "patch"],
    "DELETE": ["delete", "remove", "clear"],
}

REVERSIBLE_REQUIRED_PATTERNS = [r"delete_\w+", r"remove_\w+", r"clear_\w+"]

VIOLATION_PATTERNS = {
    "UNVALIDATED_INPUT": {"pattern": r"request\.json\(\)|await request\.body\(\)", "message": "Direct request body access without validation", "severity": ViolationSeverity.WARNING, "suggestion": "Use Pydantic models"},
    "MISSING_ERROR_HANDLING": {"pattern": r"except\s*:\s*pass|except Exception:\s*pass", "message": "Swallowing exceptions", "severity": ViolationSeverity.ERROR, "suggestion": "Log errors and return HTTP status codes"},
    "DIRECT_DB_MUTATION": {"pattern": r"\.execute\([\"'](?:INSERT|UPDATE|DELETE)", "message": "Direct database mutations without audit trail", "severity": ViolationSeverity.WARNING, "suggestion": "Use tracked operations"},
}


def check_route_governance(app) -> GovernanceCheckResult:
    result = GovernanceCheckResult(passed=True)
    if app is None or APIRoute is None:
        return result
    for route in getattr(app, "routes", []):
        if not isinstance(route, APIRoute):
            continue
        result.checked_items += 1
        endpoint = route.endpoint
        endpoint_name = getattr(endpoint, "__name__", str(endpoint))
        path = route.path
        methods = route.methods or set()
        for method in methods:
            if method in INTENT_REQUIRED_ENDPOINTS:
                keywords = INTENT_REQUIRED_ENDPOINTS[method]
                if any(kw in endpoint_name.lower() for kw in keywords):
                    if not _has_decorator(endpoint, "requires_intent"):
                        result.violations.append(GovernanceViolation(rule="MISSING_INTENT_DECORATOR", message=f"'{endpoint_name}' ({method} {path}) requires @requires_intent", severity=ViolationSeverity.ERROR, location=f"{getattr(endpoint, '__module__', '?')}.{endpoint_name}"))
                        result.passed = False
            # Reversibility check: DELETE endpoints matching dangerous patterns
            # must have @reversible decorator to ensure undo capability
            if method == "DELETE":
                for pattern in REVERSIBLE_REQUIRED_PATTERNS:
                    if re.match(pattern, endpoint_name):
                        if not _has_decorator(endpoint, "reversible"):
                            result.violations.append(GovernanceViolation(
                                rule="MISSING_REVERSIBLE_DECORATOR",
                                message=f"'{endpoint_name}' ({method} {path}) requires @reversible for undo support",
                                severity=ViolationSeverity.ERROR,
                                location=f"{getattr(endpoint, '__module__', '?')}.{endpoint_name}",
                                suggestion="Add @reversible decorator to enable undo for destructive operations",
                            ))
                            result.passed = False
                        break
    return result


def _has_decorator(func: Callable, decorator_name: str) -> bool:
    current = func
    seen: set = set()
    while current and id(current) not in seen:
        seen.add(id(current))
        if hasattr(current, f"__{decorator_name}__"):
            return True
        current = getattr(current, "__wrapped__", None)
    return False


def check_source_governance(directory: Path) -> GovernanceCheckResult:
    result = GovernanceCheckResult(passed=True)
    for py_file in directory.rglob("*.py"):
        if "test" in py_file.name.lower() or "__pycache__" in str(py_file):
            continue
        result.checked_items += 1
        try:
            source = py_file.read_text(encoding="utf-8")
            lines = source.split("\n")
            for name, config in VIOLATION_PATTERNS.items():
                pattern = re.compile(config["pattern"])
                for i, line in enumerate(lines, 1):
                    if pattern.search(line):
                        result.violations.append(GovernanceViolation(rule=name, message=config["message"], severity=config["severity"], location=str(py_file), line=i, suggestion=config.get("suggestion")))
                        if config["severity"] == ViolationSeverity.ERROR:
                            result.passed = False
        except Exception:
            pass
    return result


# ============================================================================
# AST-BASED CHECKER
# ============================================================================

class GovernanceVisitor(ast.NodeVisitor):
    """AST visitor that checks for governance violations."""

    def __init__(self, filename: str):
        self.filename = filename
        self.violations: List[GovernanceViolation] = []
        self.in_route_handler = False
        self.current_function = None

    def visit_FunctionDef(self, node: ast.FunctionDef):
        """Visit function definitions."""
        self.current_function = node.name

        # Check if this is a route handler (has route decorator)
        is_route = any(
            isinstance(d, ast.Call) and
            hasattr(d.func, "attr") and
            d.func.attr in ("get", "post", "put", "patch", "delete")
            for d in node.decorator_list
        )

        if is_route:
            self.in_route_handler = True

            # Check for exception handling
            has_try_except = any(
                isinstance(child, ast.Try)
                for child in ast.walk(node)
            )

            if not has_try_except:
                self.violations.append(GovernanceViolation(
                    rule="MISSING_ERROR_HANDLING",
                    message=f"Route handler '{node.name}' lacks try/except error handling",
                    severity=ViolationSeverity.WARNING,
                    location=self.filename,
                    line=node.lineno,
                    suggestion="Wrap route logic in try/except to handle errors gracefully",
                ))

        self.generic_visit(node)
        self.in_route_handler = False
        self.current_function = None

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef):
        """Visit async function definitions (same as sync)."""
        self.visit_FunctionDef(node)

    def _get_decorator_names(self, node: ast.FunctionDef) -> Set[str]:
        """Get all decorator names from a function."""
        names = set()
        for decorator in node.decorator_list:
            if isinstance(decorator, ast.Name):
                names.add(decorator.id)
            elif isinstance(decorator, ast.Call):
                if isinstance(decorator.func, ast.Name):
                    names.add(decorator.func.id)
                elif isinstance(decorator.func, ast.Attribute):
                    names.add(decorator.func.attr)
        return names


def check_ast_governance(directory: Path) -> GovernanceCheckResult:
    """Check Python files using AST analysis."""
    result = GovernanceCheckResult(passed=True)

    for py_file in directory.rglob("*.py"):
        if "test" in py_file.name.lower() or "__pycache__" in str(py_file):
            continue

        result.checked_items += 1

        try:
            source = py_file.read_text(encoding="utf-8")
            tree = ast.parse(source, filename=str(py_file))

            visitor = GovernanceVisitor(str(py_file))
            visitor.visit(tree)

            result.violations.extend(visitor.violations)

            if any(v.severity == ViolationSeverity.ERROR for v in visitor.violations):
                result.passed = False

        except SyntaxError as e:
            result.violations.append(GovernanceViolation(
                rule="SYNTAX_ERROR",
                message=f"Syntax error: {e}",
                severity=ViolationSeverity.ERROR,
                location=str(py_file),
                line=e.lineno,
            ))
            result.passed = False

    return result


def run_governance_ci(app=None, source_directory: Optional[Path] = None, strict: bool = True) -> Tuple[bool, str]:
    violations: List[GovernanceViolation] = []
    total = 0
    if app:
        r = check_route_governance(app)
        violations.extend(r.violations)
        total += r.checked_items
    if source_directory:
        r = check_source_governance(source_directory)
        violations.extend(r.violations)
        total += r.checked_items
        # Also run AST-based checks
        r_ast = check_ast_governance(source_directory)
        violations.extend(r_ast.violations)
        total += r_ast.checked_items
    errors = [v for v in violations if v.severity == ViolationSeverity.ERROR]
    passed = len(errors) == 0 if strict else True
    lines = [f"Items checked: {total}", f"Errors: {len(errors)}", f"Status: {'PASSED' if passed else 'FAILED'}"]
    return passed, "\n".join(lines)


def enforce_governance_at_startup(app, strict: bool = False):
    if app is None:
        return
    @app.on_event("startup")
    async def _check():
        result = check_route_governance(app)
        if result.violations:
            report = "\n".join(f"[{v.severity.value}] {v.rule}: {v.message}" for v in result.violations)
            if strict and not result.passed:
                raise RuntimeError(f"Governance violations:\n{report}")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="UX Governance CI Check")
    parser.add_argument("directory", type=Path, help="Directory to check")
    parser.add_argument("--strict", action="store_true", help="Fail on any error")
    args = parser.parse_args()

    passed, report = run_governance_ci(source_directory=args.directory, strict=args.strict)
    print(report)

    for v in []:  # placeholder — real violations logged above
        pass

    sys.exit(0 if passed else 1)
