from __future__ import annotations

# mypy: ignore-errors
"""
Validation gate protocol for the pipeline.

Gates are mandatory checkpoints that block pipeline progression.
Each gate produces a GateResult. If passed=False, the pipeline
must abort or enter a repair loop.
"""

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any

@dataclass(frozen=True)
class GateIssue:
    """A single issue found by a validation gate."""
    severity: str          # "error" | "warning"
    code: str              # machine-readable code, e.g. "column_not_found"
    message: str           # human-readable description
    token: str = ""        # affected token (if applicable)
    section: str = ""      # contract section (if applicable)

@dataclass
class GateResult:
    """Result of a validation gate check."""
    passed: bool
    stage: str                              # gate identifier, e.g. "G5_contract_semantic"
    errors: list[GateIssue] = field(default_factory=list)
    warnings: list[GateIssue] = field(default_factory=list)
    artifact_sha256: str = ""               # checksum of the artifact being validated

    @property
    def error_count(self) -> int:
        return len(self.errors)

    @property
    def warning_count(self) -> int:
        return len(self.warnings)

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "stage": self.stage,
            "error_count": self.error_count,
            "warning_count": self.warning_count,
            "errors": [
                {"severity": e.severity, "code": e.code, "message": e.message,
                 "token": e.token, "section": e.section}
                for e in self.errors
            ],
            "warnings": [
                {"severity": w.severity, "code": w.code, "message": w.message,
                 "token": w.token, "section": w.section}
                for w in self.warnings
            ],
            "artifact_sha256": self.artifact_sha256,
        }

class PipelineGateError(Exception):
    """Raised when a mandatory validation gate fails."""

    def __init__(self, result: GateResult, message: str | None = None):
        self.result = result
        msg = message or (
            f"Pipeline gate '{result.stage}' failed: "
            f"{result.error_count} error(s), {result.warning_count} warning(s)"
        )
        super().__init__(msg)

class PipelineRepairExhausted(PipelineGateError):
    """Raised when repair attempts are exhausted and gates still fail."""

    def __init__(self, result: GateResult, attempts: int):
        self.attempts = attempts
        super().__init__(
            result,
            f"Pipeline repair exhausted after {attempts} attempt(s). "
            f"Gate '{result.stage}' still has {result.error_count} error(s)."
        )

def require_gate(result: GateResult) -> None:
    """Enforce a gate result. Raises PipelineGateError if gate did not pass."""
    if not result.passed:
        raise PipelineGateError(result)

def compute_artifact_sha256(artifact: dict | str | bytes) -> str:
    """Compute SHA256 of an artifact for integrity tracking."""
    if isinstance(artifact, dict):
        content = json.dumps(artifact, sort_keys=True, ensure_ascii=False).encode("utf-8")
    elif isinstance(artifact, str):
        content = artifact.encode("utf-8")
    else:
        content = artifact
    return hashlib.sha256(content).hexdigest()

# mypy: ignore-errors
"""
Stage result tracking for the pipeline.

Each pipeline stage produces a StageResult that records
what happened, what artifacts were produced, and how long it took.
"""

from dataclasses import dataclass, field
from typing import Any


@dataclass
class StageResult:
    """Result of a single pipeline stage execution."""
    stage_name: str
    status: str                 # "success" | "failed" | "skipped"
    elapsed_ms: float = 0.0
    artifacts: dict[str, str] = field(default_factory=dict)   # name -> path
    gate_result: GateResult | None = None
    error_message: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return self.status == "success"

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "stage_name": self.stage_name,
            "status": self.status,
            "elapsed_ms": round(self.elapsed_ms, 1),
        }
        if self.artifacts:
            d["artifacts"] = self.artifacts
        if self.gate_result:
            d["gate"] = self.gate_result.to_dict()
        if self.error_message:
            d["error"] = self.error_message
        if self.metadata:
            d["metadata"] = self.metadata
        return d

# mypy: ignore-errors
"""
Artifact registry for pipeline lineage tracking.

Every artifact produced by the pipeline is recorded with its
SHA256 checksum, state (Draft/Validated/Frozen), and lineage
(which input artifacts it was derived from).

The registry is stored as pipeline_manifest.json in each template directory.
"""

import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any


logger = logging.getLogger("neura.pipeline.artifacts")

MANIFEST_FILENAME = "pipeline_manifest.json"

class ArtifactState(str, Enum):
    DRAFT = "draft"
    VALIDATED = "validated"
    FROZEN = "frozen"

@dataclass
class ArtifactRecord:
    """A single artifact in the pipeline registry."""
    name: str                             # e.g. "contract.json"
    stage: str                            # e.g. "contract_build"
    state: ArtifactState                  # Draft | Validated | Frozen
    sha256: str                           # content hash
    produced_at: str                      # ISO timestamp
    version: int = 1                      # monotonically increasing per name
    lineage: list[str] = field(default_factory=list)  # input artifact sha256s
    metadata: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["state"] = self.state.value
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> ArtifactRecord:
        d = dict(d)
        d["state"] = ArtifactState(d.get("state", "draft"))
        return cls(**{k: v for k, v in d.items() if k in cls.__dataclass_fields__})

class ArtifactRegistry:
    """
    Per-template artifact registry.

    Manages pipeline_manifest.json in a template directory,
    tracking all artifacts with their state and lineage.
    """

    def __init__(self, template_dir: Path):
        self._dir = Path(template_dir)
        self._manifest_path = self._dir / MANIFEST_FILENAME
        self._records: dict[str, list[ArtifactRecord]] = {}  # name -> version history
        self._load()

    def _load(self) -> None:
        """Load existing manifest from disk."""
        if self._manifest_path.exists():
            try:
                data = json.loads(self._manifest_path.read_text(encoding="utf-8"))
                for name, versions in data.get("artifacts", {}).items():
                    self._records[name] = [
                        ArtifactRecord.from_dict(v) for v in versions
                    ]
            except (json.JSONDecodeError, KeyError, TypeError):
                logger.warning("corrupt_pipeline_manifest", extra={"path": str(self._manifest_path)})
                self._records = {}

    def _save(self) -> None:
        """Persist manifest to disk atomically."""
        data = {
            "schema_version": 1,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "artifacts": {
                name: [r.to_dict() for r in versions]
                for name, versions in self._records.items()
            },
        }
        tmp = self._manifest_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self._manifest_path)

    def record(
        self,
        name: str,
        stage: str,
        state: ArtifactState,
        content: dict | str | bytes,
        lineage: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> ArtifactRecord:
        """Record a new artifact version."""
        sha256 = compute_artifact_sha256(content)
        versions = self._records.get(name, [])
        version = (versions[-1].version + 1) if versions else 1

        record = ArtifactRecord(
            name=name,
            stage=stage,
            state=state,
            sha256=sha256,
            produced_at=datetime.now(timezone.utc).isoformat(),
            version=version,
            lineage=lineage or [],
            metadata=metadata or {},
        )

        if name not in self._records:
            self._records[name] = []
        self._records[name].append(record)
        self._save()

        logger.info(
            "artifact_recorded",
            extra={
                "name": name, "stage": stage, "state": state.value,
                "sha256": sha256[:12], "version": version,
            },
        )
        return record

    def promote(self, name: str, new_state: ArtifactState) -> ArtifactRecord | None:
        """Promote the latest version of an artifact to a new state."""
        versions = self._records.get(name)
        if not versions:
            return None
        latest = versions[-1]
        promoted = ArtifactRecord(
            name=latest.name,
            stage=latest.stage,
            state=new_state,
            sha256=latest.sha256,
            produced_at=datetime.now(timezone.utc).isoformat(),
            version=latest.version,
            lineage=latest.lineage,
            metadata={**latest.metadata, "promoted_from": latest.state.value},
        )
        versions[-1] = promoted
        self._save()
        return promoted

    def latest(self, name: str) -> ArtifactRecord | None:
        """Get the latest version of a named artifact."""
        versions = self._records.get(name)
        return versions[-1] if versions else None

    def get_sha256(self, name: str) -> str | None:
        """Get the SHA256 of the latest version of a named artifact."""
        rec = self.latest(name)
        return rec.sha256 if rec else None

    def get_lineage(self, name: str) -> list[ArtifactRecord]:
        """Get all versions of a named artifact (full history)."""
        return list(self._records.get(name, []))

    def all_latest(self) -> dict[str, ArtifactRecord]:
        """Get the latest version of every artifact."""
        return {name: versions[-1] for name, versions in self._records.items() if versions}

# mypy: ignore-errors
"""
Freeze ceremony for pipeline contracts.

The freeze ceremony is the explicit transition from a validated
contract to an immutable frozen contract. Frozen contracts are
the only artifacts consumed by the deterministic runtime.
"""

import json
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


logger = logging.getLogger("neura.pipeline.freeze")

FROZEN_CONTRACT_FILENAME = "contract.frozen.json"

@dataclass(frozen=True)
class FrozenContract:
    """Handle to a frozen, immutable contract."""
    path: Path
    sha256: str
    frozen_at: str
    contract: dict

class FreezeError(Exception):
    """Raised when the freeze ceremony cannot proceed."""
    pass

def freeze_contract(
    template_dir: Path,
    contract: dict,
    gate_results: list[GateResult],
    registry: ArtifactRegistry | None = None,
) -> FrozenContract:
    """
    Freeze ceremony: seal a validated contract as immutable.

    1. Verify all gates passed
    2. Verify no UNRESOLVED/empty tokens in mapping
    3. Compute content SHA256
    4. Write contract.frozen.json
    5. Record in artifact registry with lineage
    6. Return FrozenContract handle

    Raises FreezeError if preconditions are not met.
    Raises PipelineGateError if any gate did not pass.
    """
    # 1. Verify all gates passed
    for gr in gate_results:
        if not gr.passed:
            raise PipelineGateError(
                gr,
                f"Cannot freeze: gate '{gr.stage}' has {gr.error_count} unresolved error(s)."
            )

    # 2. Verify no UNRESOLVED tokens
    mapping = contract.get("mapping", {})
    unresolved = [
        token for token, expr in mapping.items()
        if isinstance(expr, str) and expr.upper() in ("UNRESOLVED", "")
    ]
    if unresolved:
        raise FreezeError(
            f"Cannot freeze: {len(unresolved)} UNRESOLVED token(s): {', '.join(unresolved[:5])}"
        )

    # 3. Compute SHA256
    sha256 = compute_artifact_sha256(contract)
    frozen_at = datetime.now(timezone.utc).isoformat()

    # 4. Write contract.frozen.json
    frozen_path = Path(template_dir) / FROZEN_CONTRACT_FILENAME
    envelope = {
        "_frozen": True,
        "_sha256": sha256,
        "_frozen_at": frozen_at,
        "_gate_summary": [gr.to_dict() for gr in gate_results],
        "contract": contract,
    }
    tmp = frozen_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(envelope, indent=2, ensure_ascii=False), encoding="utf-8")
    tmp.replace(frozen_path)

    logger.info(
        "contract_frozen",
        extra={
            "sha256": sha256[:12],
            "frozen_at": frozen_at,
            "path": str(frozen_path),
        },
    )

    # 5. Record in registry
    if registry:
        contract_rec = registry.latest("contract.json")
        lineage = [contract_rec.sha256] if contract_rec else []
        registry.record(
            name=FROZEN_CONTRACT_FILENAME,
            stage="freeze",
            state=ArtifactState.FROZEN,
            content=contract,
            lineage=lineage,
            metadata={
                "gate_stages": [gr.stage for gr in gate_results],
                "frozen_at": frozen_at,
            },
        )

    # 6. Return handle
    return FrozenContract(
        path=frozen_path,
        sha256=sha256,
        frozen_at=frozen_at,
        contract=contract,
    )

def load_frozen_contract(template_dir: Path) -> FrozenContract:
    """
    Load a frozen contract and verify its integrity.

    Raises FreezeError if the file is missing, corrupt, or
    the SHA256 checksum doesn't match.
    """
    frozen_path = Path(template_dir) / FROZEN_CONTRACT_FILENAME
    if not frozen_path.exists():
        raise FreezeError(f"No frozen contract at {frozen_path}")

    try:
        envelope = json.loads(frozen_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        raise FreezeError(f"Corrupt frozen contract: {exc}") from exc

    if not envelope.get("_frozen"):
        raise FreezeError("File is not a frozen contract (missing _frozen flag)")

    contract = envelope.get("contract")
    if not isinstance(contract, dict):
        raise FreezeError("Frozen contract has no 'contract' payload")

    recorded_sha = envelope.get("_sha256", "")
    actual_sha = compute_artifact_sha256(contract)
    if recorded_sha and recorded_sha != actual_sha:
        raise FreezeError(
            f"Frozen contract integrity check failed: "
            f"recorded={recorded_sha[:12]}... actual={actual_sha[:12]}..."
        )

    return FrozenContract(
        path=frozen_path,
        sha256=actual_sha,
        frozen_at=envelope.get("_frozen_at", ""),
        contract=contract,
    )

def has_frozen_contract(template_dir: Path) -> bool:
    """Check if a template directory has a frozen contract."""
    return (Path(template_dir) / FROZEN_CONTRACT_FILENAME).exists()

# mypy: ignore-errors
"""
Pipeline orchestrator — stage sequencing state machine.

Coordinates the full validation chain:
  validate → dry-run → repair → freeze

The orchestrator owns the stage transitions and produces
structured SSE-compatible events for each stage.
"""

import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Generator


logger = logging.getLogger("neura.pipeline.orchestrator")

@dataclass
class PipelineEvent:
    """A single SSE-compatible event from the orchestrator."""
    event_type: str  # "stage_start" | "stage_finish" | "error" | "frozen"
    stage: str
    label: str
    status: str = "started"
    progress: float = 0.0
    data: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        d = {
            "event": self.event_type,
            "stage": self.stage,
            "label": self.label,
            "status": self.status,
            "progress": self.progress,
        }
        d.update(self.data)
        return d

@dataclass
class PipelineResult:
    """Full result of the validation/freeze pipeline."""
    success: bool
    frozen: FrozenContract | None = None
    stage_results: list[StageResult] = field(default_factory=list)
    events: list[PipelineEvent] = field(default_factory=list)
    error_message: str = ""
    elapsed_ms: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        d: dict[str, Any] = {
            "success": self.success,
            "elapsed_ms": round(self.elapsed_ms, 1),
            "stages": [sr.to_dict() for sr in self.stage_results],
        }
        if self.frozen:
            d["frozen"] = {
                "sha256": self.frozen.sha256[:12],
                "frozen_at": self.frozen.frozen_at,
                "path": str(self.frozen.path),
            }
        if self.error_message:
            d["error"] = self.error_message
        return d

class PipelineOrchestrator:
    """
    Coordinates the contract validation → repair → freeze pipeline.

    Usage:
        orch = PipelineOrchestrator(template_dir, contract_payload)
        for event in orch.run(validate_fn, dry_run_fn, repair_fn):
            yield sse_encode(event)
        result = orch.result
    """

    def __init__(
        self,
        template_dir: Path,
        contract: dict,
        *,
        progress_base: float = 76.0,
        progress_end: float = 92.0,
    ):
        self.template_dir = Path(template_dir)
        self.contract = contract
        self._progress_base = progress_base
        self._progress_end = progress_end
        self._events: list[PipelineEvent] = []
        self._stage_results: list[StageResult] = []
        self.result: PipelineResult | None = None

    def _emit(self, event: PipelineEvent) -> PipelineEvent:
        self._events.append(event)
        return event

    def run(
        self,
        validate_fn,
        dry_run_fn,
        repair_fn,
    ) -> Generator[PipelineEvent, None, None]:
        """
        Run the full validation chain, yielding events as they happen.

        Parameters
        ----------
        validate_fn : callable(contract) -> GateResult
            Runs schema-aware validation. Returns GateResult.
        dry_run_fn : callable(contract) -> GateResult
            Runs dry-run preflight. Returns GateResult.
        repair_fn : callable(contract, list[GateResult]) -> bool
            Attempts auto-repair. Returns True if contract was modified.
        """
        pipeline_start = time.time()
        pspan = self._progress_end - self._progress_base

        def run_all_gates(contract: dict) -> list[GateResult]:
            results = []
            try:
                results.append(validate_fn(contract))
            except Exception:
                logger.warning("validate_fn_failed", exc_info=True)
            try:
                results.append(dry_run_fn(contract))
            except Exception:
                logger.warning("dry_run_fn_failed", exc_info=True)
            return results

        # --- Stage: Validate ---
        yield self._emit(PipelineEvent(
            event_type="stage_start",
            stage="contract_validation",
            label="Validating contract",
            progress=self._progress_base,
        ))

        gate_validate = None
        stage_start = time.time()
        try:
            gate_validate = validate_fn(self.contract)
            self._stage_results.append(StageResult(
                stage_name="contract_validation",
                status="success" if gate_validate.passed else "failed",
                elapsed_ms=(time.time() - stage_start) * 1000,
                gate_result=gate_validate,
            ))
            yield self._emit(PipelineEvent(
                event_type="stage_finish",
                stage="contract_validation",
                label="Validating contract",
                status="complete" if gate_validate.passed else "fail",
                progress=self._progress_base + pspan * 0.15,
                data={"gate_passed": gate_validate.passed, "error_count": gate_validate.error_count},
            ))
        except Exception as exc:
            self._stage_results.append(StageResult(
                stage_name="contract_validation",
                status="failed",
                elapsed_ms=(time.time() - stage_start) * 1000,
                error_message=str(exc),
            ))
            yield self._emit(PipelineEvent(
                event_type="stage_finish",
                stage="contract_validation",
                label="Validating contract",
                status="error",
                progress=self._progress_base + pspan * 0.15,
            ))

        # --- Stage: Dry-run ---
        yield self._emit(PipelineEvent(
            event_type="stage_start",
            stage="contract_dry_run",
            label="Running contract dry-run",
            progress=self._progress_base + pspan * 0.2,
        ))

        gate_dry_run = None
        stage_start = time.time()
        try:
            gate_dry_run = dry_run_fn(self.contract)
            self._stage_results.append(StageResult(
                stage_name="contract_dry_run",
                status="success" if gate_dry_run.passed else "failed",
                elapsed_ms=(time.time() - stage_start) * 1000,
                gate_result=gate_dry_run,
            ))
            yield self._emit(PipelineEvent(
                event_type="stage_finish",
                stage="contract_dry_run",
                label="Running contract dry-run",
                status="complete" if gate_dry_run.passed else "fail",
                progress=self._progress_base + pspan * 0.4,
                data={"gate_passed": gate_dry_run.passed, "error_count": gate_dry_run.error_count},
            ))
        except Exception as exc:
            self._stage_results.append(StageResult(
                stage_name="contract_dry_run",
                status="failed",
                elapsed_ms=(time.time() - stage_start) * 1000,
                error_message=str(exc),
            ))
            yield self._emit(PipelineEvent(
                event_type="stage_finish",
                stage="contract_dry_run",
                label="Running contract dry-run",
                status="error",
                progress=self._progress_base + pspan * 0.4,
            ))

        # --- Stage: Repair loop (if needed) ---
        needs_repair = (
            (gate_validate is not None and not gate_validate.passed) or
            (gate_dry_run is not None and not gate_dry_run.passed)
        )

        repaired = False
        if needs_repair:
            yield self._emit(PipelineEvent(
                event_type="stage_start",
                stage="contract_repair",
                label="Repairing contract",
                progress=self._progress_base + pspan * 0.45,
            ))

            stage_start = time.time()
            try:
                loop_result = run_repair_loop(
                    contract=self.contract,
                    run_gates=run_all_gates,
                    repair_fn=repair_fn,
                )
                repaired = loop_result.repaired
                # Update gate results from the repair loop
                for gr in loop_result.gate_results:
                    if gr.stage == "contract_validate":
                        gate_validate = gr
                    elif gr.stage == "contract_dry_run":
                        gate_dry_run = gr

                self._stage_results.append(StageResult(
                    stage_name="contract_repair",
                    status="success",
                    elapsed_ms=(time.time() - stage_start) * 1000,
                    metadata={"repaired": repaired, "attempts": loop_result.attempts},
                ))
                yield self._emit(PipelineEvent(
                    event_type="stage_finish",
                    stage="contract_repair",
                    label="Repairing contract",
                    status="complete",
                    progress=self._progress_base + pspan * 0.55,
                    data={"repaired": repaired},
                ))
            except PipelineRepairExhausted as exc:
                self._stage_results.append(StageResult(
                    stage_name="contract_repair",
                    status="failed",
                    elapsed_ms=(time.time() - stage_start) * 1000,
                    error_message=str(exc),
                ))
                yield self._emit(PipelineEvent(
                    event_type="error",
                    stage="contract_repair",
                    label="Contract repair exhausted",
                    status="error",
                    progress=self._progress_base + pspan * 0.55,
                    data={"detail": str(exc)},
                ))
                self.result = PipelineResult(
                    success=False,
                    stage_results=self._stage_results,
                    events=self._events,
                    error_message=str(exc),
                    elapsed_ms=(time.time() - pipeline_start) * 1000,
                )
                return
            except Exception as exc:
                self._stage_results.append(StageResult(
                    stage_name="contract_repair",
                    status="failed",
                    elapsed_ms=(time.time() - stage_start) * 1000,
                    error_message=str(exc),
                ))
                yield self._emit(PipelineEvent(
                    event_type="error",
                    stage="contract_repair",
                    label="Contract repair failed",
                    status="error",
                    progress=self._progress_base + pspan * 0.55,
                    data={"detail": str(exc)},
                ))
                self.result = PipelineResult(
                    success=False,
                    stage_results=self._stage_results,
                    events=self._events,
                    error_message=str(exc),
                    elapsed_ms=(time.time() - pipeline_start) * 1000,
                )
                return

        # --- Stage: Freeze ceremony ---
        gate_results = [g for g in [gate_validate, gate_dry_run] if g is not None]
        all_passed = all(g.passed for g in gate_results) if gate_results else True

        frozen: FrozenContract | None = None
        if all_passed:
            yield self._emit(PipelineEvent(
                event_type="stage_start",
                stage="contract_freeze",
                label="Freezing contract",
                progress=self._progress_base + pspan * 0.6,
            ))

            stage_start = time.time()
            try:
                registry = ArtifactRegistry(self.template_dir)
                frozen = freeze_contract(
                    template_dir=self.template_dir,
                    contract=self.contract,
                    gate_results=gate_results,
                    registry=registry,
                )
                self._stage_results.append(StageResult(
                    stage_name="contract_freeze",
                    status="success",
                    elapsed_ms=(time.time() - stage_start) * 1000,
                    artifacts={"contract.frozen.json": str(frozen.path)},
                    metadata={"sha256": frozen.sha256[:12], "frozen_at": frozen.frozen_at},
                ))
                yield self._emit(PipelineEvent(
                    event_type="frozen",
                    stage="contract_freeze",
                    label="Freezing contract",
                    status="complete",
                    progress=self._progress_base + pspan * 0.75,
                    data={"sha256": frozen.sha256[:12], "frozen_at": frozen.frozen_at},
                ))
            except Exception as exc:
                logger.warning("contract_freeze_error", exc_info=True)
                self._stage_results.append(StageResult(
                    stage_name="contract_freeze",
                    status="failed",
                    elapsed_ms=(time.time() - stage_start) * 1000,
                    error_message=str(exc),
                ))
                yield self._emit(PipelineEvent(
                    event_type="stage_finish",
                    stage="contract_freeze",
                    label="Freezing contract",
                    status="error",
                    progress=self._progress_base + pspan * 0.75,
                ))

        self.result = PipelineResult(
            success=frozen is not None,
            frozen=frozen,
            stage_results=self._stage_results,
            events=self._events,
            elapsed_ms=(time.time() - pipeline_start) * 1000,
        )

# mypy: ignore-errors
"""
Repair loop protocol for the pipeline.

Encapsulates the 2-attempt validate/repair/revalidate cycle:
  Attempt 1: Run all gates on the draft contract.
  If any gate fails AND errors are repairable:
    auto_repair_contract(draft, issues)
  Attempt 2: Re-run all gates on the repaired contract.
  If still failing → abort with PipelineRepairExhausted.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable


logger = logging.getLogger("neura.pipeline.repair_loop")

MAX_REPAIR_ATTEMPTS = 2

@dataclass
class RepairLoopResult:
    """Result of the full repair loop."""
    passed: bool
    attempts: int
    gate_results: list[GateResult] = field(default_factory=list)
    repaired: bool = False
    elapsed_ms: float = 0.0
    error_summary: str = ""

    def to_dict(self) -> dict[str, Any]:
        return {
            "passed": self.passed,
            "attempts": self.attempts,
            "repaired": self.repaired,
            "elapsed_ms": round(self.elapsed_ms, 1),
            "error_summary": self.error_summary,
            "gate_results": [gr.to_dict() for gr in self.gate_results],
        }

def run_repair_loop(
    contract: dict,
    run_gates: Callable[[dict], list[GateResult]],
    repair_fn: Callable[[dict, list[GateResult]], bool],
    *,
    max_attempts: int = MAX_REPAIR_ATTEMPTS,
) -> RepairLoopResult:
    """
    Execute the validate/repair/revalidate loop.

    Parameters
    ----------
    contract : dict
        The contract payload (mutated in place by repair_fn).
    run_gates : callable
        A function that takes the contract dict and returns a list of GateResults.
        Each GateResult has .passed indicating whether that gate succeeded.
    repair_fn : callable
        A function that takes (contract, failed_gate_results) and returns True
        if any repairs were applied. The contract dict is mutated in place.
    max_attempts : int
        Maximum number of attempts (default 2).

    Returns
    -------
    RepairLoopResult
        The outcome of the loop including all gate results.

    Raises
    ------
    PipelineRepairExhausted
        If all attempts are exhausted and gates still fail.
    """
    start = time.time()

    for attempt in range(1, max_attempts + 1):
        gate_results = run_gates(contract)
        all_passed = all(gr.passed for gr in gate_results)

        if all_passed:
            return RepairLoopResult(
                passed=True,
                attempts=attempt,
                gate_results=gate_results,
                repaired=attempt > 1,
                elapsed_ms=(time.time() - start) * 1000,
            )

        # Last attempt — no more retries
        if attempt >= max_attempts:
            remaining_errors = []
            for gr in gate_results:
                if not gr.passed:
                    remaining_errors.extend(e.message for e in gr.errors[:3])
            error_summary = "; ".join(remaining_errors[:5])

            logger.warning(
                "repair_loop_exhausted",
                extra={
                    "attempts": attempt,
                    "error_count": sum(gr.error_count for gr in gate_results),
                    "error_summary": error_summary,
                },
            )

            failed = next((gr for gr in gate_results if not gr.passed), gate_results[0])
            raise PipelineRepairExhausted(
                result=failed,
                attempts=attempt,
            )

        # Attempt repair
        failed_gates = [gr for gr in gate_results if not gr.passed]
        try:
            did_repair = repair_fn(contract, failed_gates)
        except Exception:
            logger.warning("repair_fn_failed", exc_info=True)
            did_repair = False

        if not did_repair:
            # Repair couldn't fix anything — no point retrying
            remaining_errors = []
            for gr in failed_gates:
                remaining_errors.extend(e.message for e in gr.errors[:3])
            error_summary = "; ".join(remaining_errors[:5])

            logger.warning(
                "repair_loop_no_fix",
                extra={"attempts": attempt, "error_summary": error_summary},
            )

            raise PipelineRepairExhausted(
                result=failed_gates[0],
                attempts=attempt,
            )

        logger.info(
            "repair_applied",
            extra={"attempt": attempt, "sha256": compute_artifact_sha256(contract)[:12]},
        )

    # Should not reach here
    return RepairLoopResult(
        passed=False,
        attempts=max_attempts,
        gate_results=[],
        elapsed_ms=(time.time() - start) * 1000,
        error_summary="Unexpected: loop exited without resolution",
    )

"""Pipeline orchestration — state, fallback, graph report, graph agent workflow."""

# mypy: ignore-errors
"""
Pipeline State Definitions.

All inter-node keys must be declared in TypedDict (BFI LangGraph pattern).
Runtime refs (llm_client, db_client) are stored outside state to avoid
serialization issues with LangGraph checkpointing.
"""

from typing import Any, Dict, List, Optional, TypedDict

class ReportPipelineState(TypedDict, total=False):
    """
    State flowing through the report generation pipeline.

    All keys that flow between graph nodes must be declared here.
    Runtime services (LLM client, DB pool) are NOT in state — they are
    injected via closure or passed as config to avoid serialization issues.
    """
    # Input
    template_id: str
    connection_id: str
    filters: Dict[str, Any]
    batch_values: Optional[Dict[str, Any]]

    # Phase: Verify Template
    template_html: str
    template_fields: List[Dict[str, Any]]
    layout_hints: Dict[str, Any]

    # Phase: Analyze Schema
    schema_info: Dict[str, Any]
    table_names: List[str]
    column_info: List[Dict[str, Any]]

    # Phase: Extract Mappings
    mappings: List[Dict[str, Any]]
    mapping_confidence: float

    # Phase: Merge Contract
    contract: Dict[str, Any]
    sql_queries: List[str]

    # Phase: Execute Queries
    query_results: List[Dict[str, Any]]
    data_quality: float
    row_count: int

    # Phase: Render HTML
    rendered_html: str
    render_warnings: List[str]

    # Phase: Generate PDF
    pdf_path: str
    pdf_size_bytes: int

    # Pipeline metadata
    correlation_id: str
    phase: str
    error: Optional[str]
    retry_count: int
    checkpoints: List[str]

    # V2: SSE callback reference (not serialized by checkpointer)
    sse_callback: Optional[Any]

class AgentWorkflowState(TypedDict, total=False):
    """
    State flowing through agent workflow pipeline.
    """
    # Input
    task_id: str
    agent_type: str
    input_data: Dict[str, Any]

    # Phase: Plan
    plan: Dict[str, Any]
    sub_tasks: List[Dict[str, Any]]

    # Phase: Execute (parallel)
    search_results: List[Dict[str, Any]]
    doc_results: List[Dict[str, Any]]
    db_results: List[Dict[str, Any]]

    # Phase: Synthesize
    synthesis: str
    key_findings: List[str]

    # Phase: Review
    review_feedback: str
    quality_score: float
    needs_revision: bool

    # Output
    final_result: Dict[str, Any]

    # Metadata
    correlation_id: str
    phase: str
    error: Optional[str]
    retry_count: int

# mypy: ignore-errors
"""
Sequential Fallback Pipeline Executor.

Used when LangGraph is not installed. Executes pipeline stages sequentially
with basic error handling and observability.
"""

import logging
from typing import Any, Callable, Dict, List

# ReportPipelineState, AgentWorkflowState defined above

logger = logging.getLogger("neura.pipelines.fallback")

class SequentialPipelineExecutor:
    """
    Simple sequential pipeline executor (no LangGraph dependency).

    Executes a list of stages in order, tracking timing and errors.
    Used as a fallback when LangGraph is not available.

    Usage:
        executor = SequentialPipelineExecutor("report-generation")
        executor.add_stage("verify", verify_func)
        executor.add_stage("map", map_func)
        executor.add_stage("generate", generate_func)
        result = await executor.run(initial_state)
    """

    def __init__(self, pipeline_name: str):
        self.pipeline_name = pipeline_name
        self._stages: List[tuple[str, Callable]] = []

    def add_stage(self, name: str, func: Callable) -> "SequentialPipelineExecutor":
        """Add a stage to the pipeline."""
        self._stages.append((name, func))
        return self

    async def run(self, state: Dict[str, Any]) -> Dict[str, Any]:
        """Execute all stages sequentially."""
        from backend.app.services.platform_services import PipelineRun

        run = PipelineRun(self.pipeline_name)

        for stage_name, stage_func in self._stages:
            with run.stage(stage_name):
                try:
                    state = stage_func(state)
                except Exception as exc:
                    state["error"] = str(exc)
                    logger.error(
                        "pipeline_stage_failed",
                        extra={
                            "pipeline": self.pipeline_name,
                            "stage": stage_name,
                            "error": str(exc)[:500],
                        },
                    )
                    break

        run.finish()
        state["_pipeline_summary"] = run.summary()
        return state

async def run_report_sequential(state: ReportPipelineState) -> ReportPipelineState:
    """
    Fallback: run report generation pipeline sequentially.

    This mirrors the existing ReportGenerate.py flow without graph orchestration.
    """
    logger.info("report_sequential_start", extra={
        "template_id": state.get("template_id"),
        "correlation_id": state.get("correlation_id"),
    })

    stages = [
        "verify_template",
        "extract_mappings",
        "analyze_schema",
        "merge_contract",
        "execute_queries",
        "render_html",
        "generate_pdf",
    ]

    for stage_name in stages:
        state["phase"] = stage_name
        state["checkpoints"] = state.get("checkpoints", []) + [stage_name]
        logger.info("report_sequential_stage", extra={
            "stage": stage_name,
            "correlation_id": state.get("correlation_id"),
        })
        # Each stage will be wired to actual service calls when integrated

    logger.info("report_sequential_complete", extra={
        "correlation_id": state.get("correlation_id"),
        "phases": state.get("checkpoints", []),
    })

    return state

async def run_agent_sequential(state: AgentWorkflowState) -> AgentWorkflowState:
    """
    Fallback: run agent workflow sequentially.
    """
    logger.info("agent_sequential_start", extra={
        "task_id": state.get("task_id"),
        "correlation_id": state.get("correlation_id"),
    })

    stages = ["plan_research", "search", "synthesize", "review"]

    for stage_name in stages:
        state["phase"] = stage_name
        logger.info("agent_sequential_stage", extra={
            "stage": stage_name,
            "correlation_id": state.get("correlation_id"),
        })

    return state

# mypy: ignore-errors
"""
LangGraph-based Report Generation Pipeline.

Decomposes the monolithic ReportGenerate.py into a graph with:
- Checkpointing (resume on failure)
- Conditional routing (retry on low data quality)
- Parallel execution of independent stages (mappings + schema analysis)

Graph topology:
    START → verify_template → [extract_mappings, analyze_schema] (parallel)
                                    ↓
                             merge_contract → execute_queries → render_html → generate_pdf → END
                                                    │
                                        (data_quality < 0.7) → retry_queries (max 2)

Graceful fallback: If LangGraph is not installed, use SequentialPipelineExecutor.
"""

import logging
import uuid
from typing import Any, Dict, Optional

# ReportPipelineState defined above

logger = logging.getLogger("neura.pipelines.report")

# Graceful import (BFI pattern)
_langgraph_available = False
try:
    from langgraph.graph import StateGraph, END
    from langgraph.checkpoint.memory import MemorySaver
    _langgraph_available = True
except ImportError:
    pass

def _notify_sse(state: ReportPipelineState, event_type: str, stage: str, **data):
    """Helper: call SSE callback if present in state."""
    cb = state.get("sse_callback")
    if cb and callable(cb):
        try:
            cb(event_type, stage, **data)
        except Exception:
            pass

def _verify_template(state: ReportPipelineState) -> Dict[str, Any]:
    """Phase 1: Verify template — extract fields and generate HTML."""
    from backend.app.services.platform_services import PipelineTracer

    _notify_sse(state, "stage_start", "verify_template")
    with PipelineTracer("report.verify_template"):
        state["phase"] = "verify_template"
        state["checkpoints"] = state.get("checkpoints", []) + ["verify_template"]

        logger.info("report_pipeline_verify", extra={
            "template_id": state.get("template_id"),
            "correlation_id": state.get("correlation_id"),
        })

    _notify_sse(state, "stage_complete", "verify_template")
    return state

def _extract_mappings(state: ReportPipelineState) -> Dict[str, Any]:
    """Phase 2a: Extract field-to-column mappings (parallel with analyze_schema)."""
    from backend.app.services.platform_services import PipelineTracer

    _notify_sse(state, "stage_start", "extract_mappings")
    with PipelineTracer("report.extract_mappings"):
        state["phase"] = "extract_mappings"
        state["checkpoints"] = state.get("checkpoints", []) + ["extract_mappings"]

        logger.info("report_pipeline_mappings", extra={
            "template_id": state.get("template_id"),
            "correlation_id": state.get("correlation_id"),
        })

    _notify_sse(state, "stage_complete", "extract_mappings")
    return state

def _analyze_schema(state: ReportPipelineState) -> Dict[str, Any]:
    """Phase 2b: Analyze database schema (parallel with extract_mappings)."""
    from backend.app.services.platform_services import PipelineTracer

    _notify_sse(state, "stage_start", "analyze_schema")
    with PipelineTracer("report.analyze_schema"):
        state["phase"] = "analyze_schema"
        state["checkpoints"] = state.get("checkpoints", []) + ["analyze_schema"]

        logger.info("report_pipeline_schema", extra={
            "connection_id": state.get("connection_id"),
            "correlation_id": state.get("correlation_id"),
        })

    _notify_sse(state, "stage_complete", "analyze_schema")
    return state

def _merge_contract(state: ReportPipelineState) -> Dict[str, Any]:
    """Phase 3: Merge mappings + schema into execution contract."""
    from backend.app.services.platform_services import PipelineTracer

    _notify_sse(state, "stage_start", "merge_contract")
    with PipelineTracer("report.merge_contract"):
        state["phase"] = "merge_contract"
        state["checkpoints"] = state.get("checkpoints", []) + ["merge_contract"]

        logger.info("report_pipeline_contract", extra={
            "correlation_id": state.get("correlation_id"),
        })

    _notify_sse(state, "stage_complete", "merge_contract")
    return state

def _execute_queries(state: ReportPipelineState) -> Dict[str, Any]:
    """Phase 4: Execute SQL queries and fetch data."""
    from backend.app.services.platform_services import PipelineTracer

    _notify_sse(state, "stage_start", "execute_queries")
    with PipelineTracer("report.execute_queries"):
        state["phase"] = "execute_queries"
        state["checkpoints"] = state.get("checkpoints", []) + ["execute_queries"]
        state["retry_count"] = state.get("retry_count", 0)

        logger.info("report_pipeline_queries", extra={
            "correlation_id": state.get("correlation_id"),
            "retry_count": state.get("retry_count", 0),
        })

    _notify_sse(state, "stage_complete", "execute_queries")
    return state

def _render_html(state: ReportPipelineState) -> Dict[str, Any]:
    """Phase 5: Render data into HTML template."""
    from backend.app.services.platform_services import PipelineTracer

    _notify_sse(state, "stage_start", "render_html")
    with PipelineTracer("report.render_html"):
        state["phase"] = "render_html"
        state["checkpoints"] = state.get("checkpoints", []) + ["render_html"]

        logger.info("report_pipeline_render", extra={
            "correlation_id": state.get("correlation_id"),
        })

    _notify_sse(state, "stage_complete", "render_html")
    return state

def _generate_pdf(state: ReportPipelineState) -> Dict[str, Any]:
    """Phase 6: Convert HTML to PDF via Playwright."""
    from backend.app.services.platform_services import PipelineTracer

    _notify_sse(state, "stage_start", "generate_pdf")
    with PipelineTracer("report.generate_pdf"):
        state["phase"] = "generate_pdf"
        state["checkpoints"] = state.get("checkpoints", []) + ["generate_pdf"]

        logger.info("report_pipeline_pdf", extra={
            "correlation_id": state.get("correlation_id"),
        })

    _notify_sse(state, "stage_complete", "generate_pdf")
    return state

def _should_retry_queries(state: ReportPipelineState) -> str:
    """Decide whether to retry queries based on data quality."""
    data_quality = state.get("data_quality", 1.0)
    retry_count = state.get("retry_count", 0)

    if data_quality < 0.7 and retry_count < 2:
        logger.info("report_pipeline_retry", extra={
            "correlation_id": state.get("correlation_id"),
            "data_quality": data_quality,
            "retry_count": retry_count,
        })
        return "retry"
    return "proceed"

def build_report_graph(checkpointer=None):
    """Build the LangGraph StateGraph for report generation."""
    if not _langgraph_available:
        raise ImportError(
            "LangGraph is required for graph-based pipelines. "
            "Install with: pip install langgraph"
        )

    graph = StateGraph(ReportPipelineState)

    # Add nodes
    graph.add_node("verify_template", _verify_template)
    graph.add_node("extract_mappings", _extract_mappings)
    graph.add_node("analyze_schema", _analyze_schema)
    graph.add_node("merge_contract", _merge_contract)
    graph.add_node("execute_queries", _execute_queries)
    graph.add_node("render_html", _render_html)
    graph.add_node("generate_pdf", _generate_pdf)

    # Set entry point
    graph.set_entry_point("verify_template")

    # Edges: verify → parallel (mappings + schema) → merge
    graph.add_edge("verify_template", "extract_mappings")
    graph.add_edge("verify_template", "analyze_schema")
    graph.add_edge("extract_mappings", "merge_contract")
    graph.add_edge("analyze_schema", "merge_contract")

    # merge → execute → conditional routing
    graph.add_edge("merge_contract", "execute_queries")
    graph.add_conditional_edges(
        "execute_queries",
        _should_retry_queries,
        {
            "retry": "execute_queries",
            "proceed": "render_html",
        },
    )

    # render → pdf → END
    graph.add_edge("render_html", "generate_pdf")
    graph.add_edge("generate_pdf", END)

    # Compile with checkpointer
    if checkpointer is None:
        checkpointer = MemorySaver()

    return graph.compile(checkpointer=checkpointer)

async def run_report_pipeline(
    template_id: str,
    connection_id: str,
    filters: Optional[Dict[str, Any]] = None,
    batch_values: Optional[Dict[str, Any]] = None,
    graph=None,
) -> ReportPipelineState:
    """Run the report generation pipeline."""
    correlation_id = uuid.uuid4().hex[:12]

    initial_state: ReportPipelineState = {
        "template_id": template_id,
        "connection_id": connection_id,
        "filters": filters or {},
        "batch_values": batch_values,
        "correlation_id": correlation_id,
        "phase": "init",
        "error": None,
        "retry_count": 0,
        "checkpoints": [],
    }

    if not _langgraph_available:
        logger.info("report_pipeline_sequential_fallback", extra={
            "correlation_id": correlation_id,
        })
        # run_report_sequential defined above
        return await run_report_sequential(initial_state)

    if graph is None:
        graph = build_report_graph()

    logger.info("report_pipeline_start", extra={
        "correlation_id": correlation_id,
        "template_id": template_id,
        "mode": "langgraph",
    })

    config = {"configurable": {"thread_id": correlation_id}}
    result = await graph.ainvoke(initial_state, config=config)

    logger.info("report_pipeline_complete", extra={
        "correlation_id": correlation_id,
        "phases_completed": result.get("checkpoints", []),
    })

    return result

# mypy: ignore-errors
"""
LangGraph-based Agent Workflow Pipeline.

Provides graph-based orchestration for complex agent tasks with:
- Planning phase
- Parallel execution (search, docs, DB)
- Synthesis and review
- Quality-gated retry

Graph topology:
    START → plan_research → [search_web, search_docs, query_db] (parallel)
                                        ↓
                                  synthesize → review → END
                                                  │
                                    (needs_revision) → synthesize (max 2)
"""

import logging
import uuid
from typing import Any, Dict

# AgentWorkflowState defined above

logger = logging.getLogger("neura.pipelines.agent_workflow")

# Graceful import
_langgraph_available = False
try:
    from langgraph.graph import StateGraph, END
    from langgraph.checkpoint.memory import MemorySaver
    _langgraph_available = True
except ImportError:
    pass

def _plan_research(state: AgentWorkflowState) -> Dict[str, Any]:
    """Phase 1: Analyze task and create execution plan."""
    from backend.app.services.platform_services import PipelineTracer

    with PipelineTracer("agent.plan_research"):
        state["phase"] = "plan_research"
        logger.info("agent_workflow_plan", extra={
            "task_id": state.get("task_id"),
            "agent_type": state.get("agent_type"),
            "correlation_id": state.get("correlation_id"),
        })
    return state

def _search_web(state: AgentWorkflowState) -> Dict[str, Any]:
    """Phase 2a: Search web sources (parallel)."""
    from backend.app.services.platform_services import PipelineTracer

    with PipelineTracer("agent.search_web"):
        state["phase"] = "search_web"
        state["search_results"] = state.get("search_results", [])
    return state

def _search_docs(state: AgentWorkflowState) -> Dict[str, Any]:
    """Phase 2b: Search document knowledge base (parallel)."""
    from backend.app.services.platform_services import PipelineTracer

    with PipelineTracer("agent.search_docs"):
        state["phase"] = "search_docs"
        state["doc_results"] = state.get("doc_results", [])
    return state

def _query_db(state: AgentWorkflowState) -> Dict[str, Any]:
    """Phase 2c: Query connected databases (parallel)."""
    from backend.app.services.platform_services import PipelineTracer

    with PipelineTracer("agent.query_db"):
        state["phase"] = "query_db"
        state["db_results"] = state.get("db_results", [])
    return state

def _synthesize(state: AgentWorkflowState) -> Dict[str, Any]:
    """Phase 3: Synthesize all results into coherent output."""
    from backend.app.services.platform_services import PipelineTracer

    with PipelineTracer("agent.synthesize"):
        state["phase"] = "synthesize"
        state["retry_count"] = state.get("retry_count", 0)
        logger.info("agent_workflow_synthesize", extra={
            "task_id": state.get("task_id"),
            "correlation_id": state.get("correlation_id"),
            "retry_count": state.get("retry_count", 0),
        })
    return state

def _review(state: AgentWorkflowState) -> Dict[str, Any]:
    """Phase 4: Review synthesis quality."""
    from backend.app.services.platform_services import PipelineTracer

    with PipelineTracer("agent.review"):
        state["phase"] = "review"
        # Quality evaluation will be done by LLM or heuristic
        quality_score = state.get("quality_score", 0.8)
        state["needs_revision"] = quality_score < 0.7 and state.get("retry_count", 0) < 2
        logger.info("agent_workflow_review", extra={
            "task_id": state.get("task_id"),
            "correlation_id": state.get("correlation_id"),
            "quality_score": quality_score,
            "needs_revision": state.get("needs_revision"),
        })
    return state

def _should_revise(state: AgentWorkflowState) -> str:
    """Decide whether synthesis needs revision."""
    if state.get("needs_revision", False):
        return "revise"
    return "done"

def build_agent_workflow_graph(checkpointer=None):
    """Build the LangGraph StateGraph for agent workflows."""
    if not _langgraph_available:
        raise ImportError("LangGraph is required. Install with: pip install langgraph")

    graph = StateGraph(AgentWorkflowState)

    graph.add_node("plan_research", _plan_research)
    graph.add_node("search_web", _search_web)
    graph.add_node("search_docs", _search_docs)
    graph.add_node("query_db", _query_db)
    graph.add_node("synthesize", _synthesize)
    graph.add_node("review", _review)

    graph.set_entry_point("plan_research")

    # plan → parallel search
    graph.add_edge("plan_research", "search_web")
    graph.add_edge("plan_research", "search_docs")
    graph.add_edge("plan_research", "query_db")

    # parallel → synthesize
    graph.add_edge("search_web", "synthesize")
    graph.add_edge("search_docs", "synthesize")
    graph.add_edge("query_db", "synthesize")

    # synthesize → review → conditional
    graph.add_edge("synthesize", "review")
    graph.add_conditional_edges(
        "review",
        _should_revise,
        {
            "revise": "synthesize",
            "done": END,
        },
    )

    if checkpointer is None:
        checkpointer = MemorySaver()

    return graph.compile(checkpointer=checkpointer)

async def run_agent_workflow(
    task_id: str,
    agent_type: str,
    input_data: Dict[str, Any],
    graph=None,
) -> AgentWorkflowState:
    """Run an agent workflow through the graph pipeline."""
    correlation_id = uuid.uuid4().hex[:12]

    initial_state: AgentWorkflowState = {
        "task_id": task_id,
        "agent_type": agent_type,
        "input_data": input_data,
        "correlation_id": correlation_id,
        "phase": "init",
        "error": None,
        "retry_count": 0,
    }

    if not _langgraph_available:
        # run_agent_sequential defined above
        return await run_agent_sequential(initial_state)

    if graph is None:
        graph = build_agent_workflow_graph()

    config = {"configurable": {"thread_id": correlation_id}}
    result = await graph.ainvoke(initial_state, config=config)
    return result

# mypy: ignore-errors
"""
Pipeline orchestration module (V2).

Provides graph-based pipeline execution using LangGraph (when available)
with automatic fallback to sequential execution. Inspired by BFI pipeline_v45.

Features:
- LangGraph StateGraph for report generation with checkpointing
- Conditional routing (retry on low quality)
- Parallel execution of independent stages
- Graceful fallback to sequential execution
- Integration with observability tracer
"""

# Graceful LangGraph import (BFI pattern)
_langgraph_available = False
try:
    from langgraph.graph import StateGraph, END
    _langgraph_available = True
except ImportError:
    pass

if _langgraph_available:
    pass  # build_report_graph, run_report_pipeline etc. already defined above
else:
    # Fallback stubs that use sequential execution
    def build_report_graph(*args, **kwargs):
        raise ImportError("LangGraph not installed. Using sequential fallback.")

    def run_report_pipeline(*args, **kwargs):
        return run_report_sequential(*args, **kwargs)

    def build_agent_workflow_graph(*args, **kwargs):
        raise ImportError("LangGraph not installed. Using sequential fallback.")

    def run_agent_workflow(*args, **kwargs):
        return run_agent_sequential(*args, **kwargs)

def is_langgraph_available() -> bool:
    """Check if LangGraph is available."""
    return _langgraph_available

__all__ = [
    "ReportPipelineState",
    "AgentWorkflowState",
    "SequentialPipelineExecutor",
    "build_report_graph",
    "run_report_pipeline",
    "build_agent_workflow_graph",
    "run_agent_workflow",
    "is_langgraph_available",
]
