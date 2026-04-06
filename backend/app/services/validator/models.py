# mypy: ignore-errors
"""Data models for pipeline validation results."""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Optional


class Severity(str, Enum):
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


@dataclass(frozen=True)
class ValidationIssue:
    severity: Severity
    category: str
    message: str
    token: Optional[str] = None
    detail: Optional[str] = None
    fix_hint: Optional[str] = None
    token_signature: Optional[str] = None
    fix_candidates: Optional[list[str]] = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity.value,
            "category": self.category,
            "message": self.message,
            "token": self.token,
            "detail": self.detail,
            "fix_hint": self.fix_hint,
            "token_signature": self.token_signature,
            "fix_candidates": self.fix_candidates,
        }


@dataclass
class ValidationResult:
    passed: bool
    issues: list[ValidationIssue] = field(default_factory=list)
    dry_run_pdf_path: Optional[Path] = None
    dry_run_html_path: Optional[Path] = None
    visual_check_passed: Optional[bool] = None
    checks_run: int = 0
    deterministic_ms: float = 0.0
    dry_run_ms: float = 0.0
    visual_ms: float = 0.0

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == Severity.ERROR]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == Severity.WARNING]

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "issues": [i.to_dict() for i in self.issues],
            "dry_run_pdf": str(self.dry_run_pdf_path) if self.dry_run_pdf_path else None,
            "visual_check_passed": self.visual_check_passed,
            "summary": {
                "errors": len(self.errors),
                "warnings": len(self.warnings),
                "info": len([i for i in self.issues if i.severity == Severity.INFO]),
                "checks_run": self.checks_run,
                "deterministic_ms": round(self.deterministic_ms, 1),
                "dry_run_ms": round(self.dry_run_ms, 1),
                "visual_ms": round(self.visual_ms, 1),
            },
        }
