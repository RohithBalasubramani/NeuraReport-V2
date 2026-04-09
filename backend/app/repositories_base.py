from __future__ import annotations

"""Merged repositories module."""

"""
Agent Tasks Repository - Persistent storage for AI agent tasks.

Consolidated module containing models, repository, and singleton instance.

Design Principles:
- All task state is persisted to SQLite
- Tasks survive server restarts
- Progress is tracked and queryable
- Full audit trail via events table
- Idempotency via unique key constraint
- All operations are atomic
- Optimistic locking prevents race conditions
"""

import logging
import os
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Generator, List, Optional, Tuple

from pydantic import field_validator
from sqlalchemy import Column, event, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.types import JSON
from sqlmodel import Field, Session, SQLModel, create_engine, select

from backend.app.common import utc_now, utc_now_iso

logger = logging.getLogger("neura.agent_tasks.repository")

# Helpers


def _generate_task_id() -> str:
    """Generate a time-sortable UUID v7-style ID.

    Format: timestamp_hex (8 chars) + random (8 chars) = 16 char ID
    This ensures tasks are naturally sorted by creation time.
    """
    import time
    import secrets

    ts_ms = int(time.time() * 1000)
    ts_hex = format(ts_ms, 'x')[-8:].zfill(8)
    rand_hex = secrets.token_hex(4)
    return f"{ts_hex}{rand_hex}"

def _serialize_for_json(obj: Any) -> Any:
    """Recursively serialize objects to JSON-safe format."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, Enum):
        return obj.value
    elif isinstance(obj, dict):
        return {k: _serialize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return type(obj)(_serialize_for_json(item) for item in obj)
    else:
        return obj

# Enums

class AgentTaskStatus(str, Enum):
    """Task execution status with clear semantics.

    State transitions:
    - PENDING -> RUNNING (worker claims task)
    - RUNNING -> COMPLETED (success)
    - RUNNING -> FAILED (non-retryable error)
    - RUNNING -> RETRYING (retryable error, will retry)
    - RETRYING -> RUNNING (retry attempt starts)
    - RETRYING -> FAILED (max retries exceeded)
    - PENDING/RUNNING -> CANCELLED (user cancellation)
    """
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"
    RETRYING = "retrying"

    @classmethod
    def terminal_statuses(cls) -> set["AgentTaskStatus"]:
        """Statuses that indicate task completion (no more work)."""
        return {cls.COMPLETED, cls.FAILED, cls.CANCELLED}

    @classmethod
    def active_statuses(cls) -> set["AgentTaskStatus"]:
        """Statuses that indicate task is in-flight."""
        return {cls.PENDING, cls.RUNNING, cls.RETRYING}

class AgentType(str, Enum):
    """Types of AI agents available."""
    RESEARCH = "research"
    DATA_ANALYST = "data_analyst"
    EMAIL_DRAFT = "email_draft"
    CONTENT_REPURPOSE = "content_repurpose"
    PROOFREADING = "proofreading"
    REPORT_ANALYST = "report_analyst"
    REPORT_PIPELINE = "report_pipeline"

# SQLModel Tables

class AgentTaskModel(SQLModel, table=True):
    """
    Persistent model for agent tasks.

    Invariants:
    - task_id is unique and immutable
    - idempotency_key is unique when not null
    - progress_percent is in range [0, 100]
    - attempt_count <= max_attempts
    - completed_at is set IFF status is terminal
    - result is set IFF status is COMPLETED
    - error_message is set IFF status is FAILED
    """
    __tablename__ = "agent_tasks"

    task_id: str = Field(
        default_factory=_generate_task_id,
        primary_key=True,
        max_length=32
    )
    agent_type: AgentType = Field(
        ...,
        index=True
    )
    status: AgentTaskStatus = Field(
        default=AgentTaskStatus.PENDING,
        index=True
    )
    input_params: Dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False)
    )
    result: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSON, nullable=True)
    )
    error_message: Optional[str] = Field(
        default=None,
        max_length=2000
    )
    error_code: Optional[str] = Field(
        default=None,
        max_length=50
    )
    is_retryable: bool = Field(
        default=True
    )
    idempotency_key: Optional[str] = Field(
        default=None,
        max_length=64,
        index=True
    )
    user_id: Optional[str] = Field(
        default=None,
        max_length=64,
        index=True
    )
    progress_percent: int = Field(
        default=0,
        ge=0,
        le=100
    )
    progress_message: Optional[str] = Field(
        default=None,
        max_length=500
    )
    current_step: Optional[str] = Field(
        default=None,
        max_length=100
    )
    total_steps: Optional[int] = Field(
        default=None,
        ge=0
    )
    current_step_num: Optional[int] = Field(
        default=None,
        ge=0
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        index=True
    )
    started_at: Optional[datetime] = Field(
        default=None
    )
    completed_at: Optional[datetime] = Field(
        default=None,
        index=True
    )
    expires_at: Optional[datetime] = Field(
        default=None,
        index=True
    )
    attempt_count: int = Field(
        default=0,
        ge=0
    )
    max_attempts: int = Field(
        default=3,
        ge=1,
        le=10
    )
    next_retry_at: Optional[datetime] = Field(
        default=None
    )
    last_error: Optional[str] = Field(
        default=None,
        max_length=2000
    )
    tokens_input: int = Field(
        default=0,
        ge=0
    )
    tokens_output: int = Field(
        default=0,
        ge=0
    )
    estimated_cost_cents: int = Field(
        default=0,
        ge=0
    )
    priority: int = Field(
        default=0,
        ge=0,
        le=10,
        index=True
    )
    webhook_url: Optional[str] = Field(
        default=None,
        max_length=2000
    )
    version: int = Field(
        default=1,
        ge=1
    )

    class Config:
        use_enum_values = True

    @field_validator('progress_percent')
    @classmethod
    def validate_progress(cls, v: int) -> int:
        """Ensure progress is within valid range."""
        return max(0, min(100, v))

    def is_terminal(self) -> bool:
        """Check if task is in a terminal state."""
        return self.status in AgentTaskStatus.terminal_statuses()

    def is_active(self) -> bool:
        """Check if task is still in progress."""
        return self.status in AgentTaskStatus.active_statuses()

    def can_cancel(self) -> bool:
        """Check if task can be cancelled."""
        return self.status in {AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING}

    def can_retry(self) -> bool:
        """Check if task can be retried."""
        return (
            self.status == AgentTaskStatus.FAILED and
            self.is_retryable and
            self.attempt_count < self.max_attempts
        )

    def to_response_dict(self) -> Dict[str, Any]:
        """Convert to API response format."""
        return {
            "task_id": self.task_id,
            "agent_type": self.agent_type,
            "status": self.status,
            "progress": {
                "percent": self.progress_percent,
                "message": self.progress_message,
                "current_step": self.current_step,
                "total_steps": self.total_steps,
                "current_step_num": self.current_step_num,
            },
            "result": self.result,
            "error": {
                "code": self.error_code,
                "message": self.error_message,
                "retryable": self.is_retryable,
            } if self.error_message else None,
            "timestamps": {
                "created_at": self.created_at.isoformat() if self.created_at else None,
                "started_at": self.started_at.isoformat() if self.started_at else None,
                "completed_at": self.completed_at.isoformat() if self.completed_at else None,
            },
            "cost": {
                "tokens_input": self.tokens_input,
                "tokens_output": self.tokens_output,
                "estimated_cost_cents": self.estimated_cost_cents,
            },
            "attempts": {
                "count": self.attempt_count,
                "max": self.max_attempts,
            },
            "links": {
                "self": f"/agents/tasks/{self.task_id}",
                "cancel": f"/agents/tasks/{self.task_id}/cancel" if self.can_cancel() else None,
                "retry": f"/agents/tasks/{self.task_id}/retry" if self.can_retry() else None,
                "events": f"/agents/tasks/{self.task_id}/events",
                "stream": f"/agents/tasks/{self.task_id}/stream" if self.is_active() else None,
            }
        }

class AgentTaskEvent(SQLModel, table=True):
    """
    Audit log for agent task state changes.

    Every state transition and significant event is logged here.
    """
    __tablename__ = "agent_task_events"

    id: Optional[int] = Field(
        default=None,
        primary_key=True
    )
    task_id: str = Field(
        ...,
        foreign_key="agent_tasks.task_id",
        index=True,
        max_length=32
    )
    event_type: str = Field(
        ...,
        max_length=50,
        index=True
    )
    event_data: Optional[Dict[str, Any]] = Field(
        default=None,
        sa_column=Column(JSON, nullable=True)
    )
    previous_status: Optional[str] = Field(
        default=None,
        max_length=20
    )
    new_status: Optional[str] = Field(
        default=None,
        max_length=20
    )
    created_at: datetime = Field(
        default_factory=utc_now,
        index=True
    )

    class Config:
        use_enum_values = True

INDEX_DEFINITIONS = [
    "CREATE INDEX IF NOT EXISTS idx_tasks_pending_priority ON agent_tasks(status, priority DESC, created_at) WHERE status = 'pending'",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idempotency ON agent_tasks(idempotency_key) WHERE idempotency_key IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_tasks_expires ON agent_tasks(expires_at) WHERE expires_at IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_tasks_user_created ON agent_tasks(user_id, created_at DESC) WHERE user_id IS NOT NULL",
    "CREATE INDEX IF NOT EXISTS idx_events_task_time ON agent_task_events(task_id, created_at DESC)",
]

# Exceptions

class TaskNotFoundError(Exception):
    """Raised when a task is not found."""
    pass

class TaskConflictError(Exception):
    """Raised when a task operation conflicts with current state."""
    pass

class IdempotencyConflictError(Exception):
    """Raised when an idempotency key is already used."""

    def __init__(self, existing_task_id: str):
        self.existing_task_id = existing_task_id
        super().__init__(f"Idempotency key already used by task {existing_task_id}")

class OptimisticLockError(Exception):
    """Raised when optimistic locking detects a concurrent modification."""
    pass

# Repository

class AgentTaskRepository:
    """
    Repository for agent task persistence.

    Features:
    - SQLite-backed persistent storage
    - Thread-safe operations with connection pooling
    - Automatic cleanup of old tasks
    - Event logging for audit trail
    - Idempotency key support
    - Optimistic locking for concurrent updates
    """

    DEFAULT_DB_FILENAME = "agent_tasks.db"
    MAX_TASK_AGE_DAYS = 7
    CLEANUP_BATCH_SIZE = 100
    IDEMPOTENCY_WINDOW_HOURS = 24

    def __init__(self, db_path: Optional[Path] = None):
        if db_path is None:
            state_dir = Path(
                os.getenv("NEURA_STATE_DIR")
                or Path(__file__).resolve().parents[4] / "state"
            )
            state_dir.mkdir(parents=True, exist_ok=True)
            db_path = state_dir / self.DEFAULT_DB_FILENAME

        self._db_path = db_path
        self._engine = create_engine(
            f"sqlite:///{db_path}",
            echo=False,
            connect_args={
                "check_same_thread": False,
                "timeout": 30,
            },
            pool_pre_ping=True,
        )

        @event.listens_for(self._engine, "connect")
        def set_sqlite_pragma(dbapi_connection, connection_record):
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.execute("PRAGMA busy_timeout=30000")
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

        self._lock = threading.RLock()
        self._initialized = False

    def _ensure_initialized(self) -> None:
        if self._initialized:
            return
        with self._lock:
            if self._initialized:
                return
            SQLModel.metadata.create_all(self._engine)
            with Session(self._engine) as session:
                for index_sql in INDEX_DEFINITIONS:
                    try:
                        session.execute(text(index_sql))
                    except Exception as e:
                        logger.debug(f"Index creation skipped: {e}")
                session.commit()
            self._initialized = True
            logger.info(f"Agent tasks database initialized at {self._db_path}")

    @contextmanager
    def _session(self) -> Generator[Session, None, None]:
        self._ensure_initialized()
        with Session(self._engine, expire_on_commit=False) as session:
            try:
                yield session
                session.commit()
            except Exception:
                session.rollback()
                raise

    # =========================================================================
    # CREATE operations
    # =========================================================================

    def create_task(
        self,
        agent_type: AgentType,
        input_params: Dict[str, Any],
        *,
        idempotency_key: Optional[str] = None,
        user_id: Optional[str] = None,
        priority: int = 0,
        max_attempts: int = 3,
        webhook_url: Optional[str] = None,
        expires_in_hours: int = 24 * 7,
    ) -> AgentTaskModel:
        now = utc_now()
        expires_at = now + timedelta(hours=expires_in_hours) if expires_in_hours > 0 else None

        with self._session() as session:
            if idempotency_key:
                existing = self._find_by_idempotency_key(session, idempotency_key)
                if existing:
                    raise IdempotencyConflictError(existing.task_id)

            task = AgentTaskModel(
                agent_type=agent_type,
                input_params=input_params,
                status=AgentTaskStatus.PENDING,
                idempotency_key=idempotency_key,
                user_id=user_id,
                priority=priority,
                max_attempts=max_attempts,
                webhook_url=webhook_url,
                expires_at=expires_at,
                created_at=now,
            )

            session.add(task)
            try:
                session.flush()
            except IntegrityError:
                if not idempotency_key:
                    raise
                session.rollback()
                existing = self._find_by_idempotency_key(session, idempotency_key)
                if existing:
                    raise IdempotencyConflictError(existing.task_id)
                raise

            self._log_event(
                session,
                task.task_id,
                "created",
                new_status=AgentTaskStatus.PENDING.value,
                data={"input_params": input_params}
            )

            logger.info(f"Created task {task.task_id} of type {agent_type}")
            return task

    def create_or_get_by_idempotency_key(
        self,
        agent_type: AgentType,
        input_params: Dict[str, Any],
        idempotency_key: str,
        _depth: int = 0,
        **kwargs,
    ) -> Tuple[AgentTaskModel, bool]:
        if _depth > 3:
            raise RuntimeError("Failed to create or retrieve task after multiple retries")
        try:
            task = self.create_task(
                agent_type=agent_type,
                input_params=input_params,
                idempotency_key=idempotency_key,
                **kwargs,
            )
            return task, True
        except IdempotencyConflictError as e:
            task = self.get_task(e.existing_task_id)
            if task is None:
                return self.create_or_get_by_idempotency_key(
                    agent_type, input_params, idempotency_key, _depth=_depth + 1, **kwargs
                )
            return task, False

    # =========================================================================
    # READ operations
    # =========================================================================

    def get_task(self, task_id: str) -> Optional[AgentTaskModel]:
        with self._session() as session:
            return session.get(AgentTaskModel, task_id)

    def get_task_or_raise(self, task_id: str) -> AgentTaskModel:
        task = self.get_task(task_id)
        if task is None:
            raise TaskNotFoundError(f"Task {task_id} not found")
        return task

    def list_tasks(
        self,
        *,
        agent_type: Optional[AgentType] = None,
        status: Optional[AgentTaskStatus] = None,
        user_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
        include_expired: bool = False,
    ) -> List[AgentTaskModel]:
        with self._session() as session:
            query = select(AgentTaskModel)
            if agent_type:
                query = query.where(AgentTaskModel.agent_type == agent_type)
            if status:
                query = query.where(AgentTaskModel.status == status)
            if user_id:
                query = query.where(AgentTaskModel.user_id == user_id)
            if not include_expired:
                now = utc_now()
                query = query.where(
                    (AgentTaskModel.expires_at.is_(None)) |
                    (AgentTaskModel.expires_at > now)
                )
            query = query.order_by(AgentTaskModel.created_at.desc())
            query = query.offset(offset).limit(limit)
            return list(session.exec(query).all())

    def count_tasks(
        self,
        *,
        agent_type: Optional[AgentType] = None,
        status: Optional[AgentTaskStatus] = None,
        user_id: Optional[str] = None,
        include_expired: bool = False,
    ) -> int:
        from sqlalchemy import func

        with self._session() as session:
            query = select(func.count()).select_from(AgentTaskModel)
            if agent_type:
                query = query.where(AgentTaskModel.agent_type == agent_type)
            if status:
                query = query.where(AgentTaskModel.status == status)
            if user_id:
                query = query.where(AgentTaskModel.user_id == user_id)
            if not include_expired:
                now = utc_now()
                query = query.where(
                    (AgentTaskModel.expires_at.is_(None)) |
                    (AgentTaskModel.expires_at > now)
                )
            return session.exec(query).one()

    def list_pending_tasks(
        self,
        *,
        agent_type: Optional[AgentType] = None,
        limit: int = 10,
    ) -> List[AgentTaskModel]:
        with self._session() as session:
            query = select(AgentTaskModel).where(
                AgentTaskModel.status == AgentTaskStatus.PENDING
            )
            if agent_type:
                query = query.where(AgentTaskModel.agent_type == agent_type)
            query = query.order_by(
                AgentTaskModel.priority.desc(),
                AgentTaskModel.created_at.asc()
            )
            query = query.limit(limit)
            return list(session.exec(query).all())

    def list_retrying_tasks(
        self,
        *,
        before: Optional[datetime] = None,
        limit: int = 10,
    ) -> List[AgentTaskModel]:
        now = before or utc_now()
        with self._session() as session:
            query = select(AgentTaskModel).where(
                AgentTaskModel.status == AgentTaskStatus.RETRYING,
                AgentTaskModel.next_retry_at <= now,
            ).order_by(
                AgentTaskModel.next_retry_at.asc()
            ).limit(limit)
            return list(session.exec(query).all())

    def get_task_events(
        self,
        task_id: str,
        *,
        limit: int = 100,
    ) -> List[AgentTaskEvent]:
        with self._session() as session:
            query = select(AgentTaskEvent).where(
                AgentTaskEvent.task_id == task_id
            ).order_by(
                AgentTaskEvent.created_at.desc()
            ).limit(limit)
            return list(session.exec(query).all())

    def _find_by_idempotency_key(
        self,
        session: Session,
        idempotency_key: str,
    ) -> Optional[AgentTaskModel]:
        cutoff = utc_now() - timedelta(hours=self.IDEMPOTENCY_WINDOW_HOURS)
        query = select(AgentTaskModel).where(
            AgentTaskModel.idempotency_key == idempotency_key,
            AgentTaskModel.created_at > cutoff,
        )
        return session.exec(query).first()

    # =========================================================================
    # UPDATE operations
    # =========================================================================

    def claim_task(self, task_id: str) -> AgentTaskModel:
        with self._session() as session:
            started_at = utc_now()
            result = session.execute(
                text(
                    "UPDATE agent_tasks "
                    "SET status = :running, started_at = :started_at, "
                    "attempt_count = attempt_count + 1, version = version + 1 "
                    "WHERE task_id = :task_id AND status = :pending"
                ),
                {
                    "running": AgentTaskStatus.RUNNING.name,
                    "started_at": started_at,
                    "task_id": task_id,
                    "pending": AgentTaskStatus.PENDING.name,
                },
            )
            if result.rowcount != 1:
                task = session.get(AgentTaskModel, task_id)
                if task is None:
                    raise TaskNotFoundError(f"Task {task_id} not found")
                raise TaskConflictError(
                    f"Cannot claim task {task_id}: status is {task.status}, expected PENDING"
                )
            task = session.get(AgentTaskModel, task_id)
            assert task is not None
            self._log_event(
                session,
                task_id,
                "started",
                previous_status=AgentTaskStatus.PENDING.value,
                new_status=AgentTaskStatus.RUNNING.value,
                data={"attempt": task.attempt_count},
            )
            logger.info(f"Claimed task {task_id} (attempt {task.attempt_count})")
            return task

    def claim_retry_task(self, task_id: str) -> AgentTaskModel:
        with self._session() as session:
            started_at = utc_now()
            result = session.execute(
                text(
                    "UPDATE agent_tasks "
                    "SET status = :running, started_at = :started_at, "
                    "attempt_count = attempt_count + 1, next_retry_at = NULL, "
                    "version = version + 1 "
                    "WHERE task_id = :task_id AND status = :retrying"
                ),
                {
                    "running": AgentTaskStatus.RUNNING.name,
                    "started_at": started_at,
                    "task_id": task_id,
                    "retrying": AgentTaskStatus.RETRYING.name,
                },
            )
            if result.rowcount != 1:
                task = session.get(AgentTaskModel, task_id)
                if task is None:
                    raise TaskNotFoundError(f"Task {task_id} not found")
                raise TaskConflictError(
                    f"Cannot claim retry for task {task_id}: status is {task.status}, expected RETRYING"
                )
            task = session.get(AgentTaskModel, task_id)
            assert task is not None
            self._log_event(
                session,
                task_id,
                "retry_started",
                previous_status=AgentTaskStatus.RETRYING.value,
                new_status=AgentTaskStatus.RUNNING.value,
                data={"attempt": task.attempt_count},
            )
            logger.info(f"Claimed retry for task {task_id} (attempt {task.attempt_count})")
            return task

    def claim_batch(
        self,
        *,
        limit: int = 5,
        exclude_task_ids: Optional[set] = None,
    ) -> List[AgentTaskModel]:
        started_at = utc_now()
        exclude = exclude_task_ids or set()
        with self._session() as session:
            candidates = list(
                session.exec(
                    select(AgentTaskModel)
                    .where(AgentTaskModel.status == AgentTaskStatus.PENDING)
                    .order_by(
                        AgentTaskModel.priority.desc(),
                        AgentTaskModel.created_at.asc(),
                    )
                    .limit(limit + len(exclude))
                ).all()
            )
            claimed: List[AgentTaskModel] = []
            for task in candidates:
                if task.task_id in exclude:
                    continue
                if len(claimed) >= limit:
                    break
                result = session.execute(
                    text(
                        "UPDATE agent_tasks "
                        "SET status = :running, started_at = :started_at, "
                        "attempt_count = attempt_count + 1, version = version + 1 "
                        "WHERE task_id = :task_id AND status = :pending"
                    ),
                    {
                        "running": AgentTaskStatus.RUNNING.name,
                        "started_at": started_at,
                        "task_id": task.task_id,
                        "pending": AgentTaskStatus.PENDING.name,
                    },
                )
                if result.rowcount == 1:
                    session.expire(task)
                    refreshed = session.get(AgentTaskModel, task.task_id)
                    if refreshed:
                        self._log_event(
                            session,
                            task.task_id,
                            "started",
                            previous_status=AgentTaskStatus.PENDING.value,
                            new_status=AgentTaskStatus.RUNNING.value,
                            data={"attempt": refreshed.attempt_count, "batch_claim": True},
                        )
                        claimed.append(refreshed)
            if claimed:
                logger.info(f"Batch-claimed {len(claimed)} task(s)")
            return claimed

    def update_progress(
        self,
        task_id: str,
        *,
        percent: Optional[int] = None,
        message: Optional[str] = None,
        current_step: Optional[str] = None,
        total_steps: Optional[int] = None,
        current_step_num: Optional[int] = None,
    ) -> AgentTaskModel:
        with self._session() as session:
            task = session.get(AgentTaskModel, task_id)
            if task is None:
                raise TaskNotFoundError(f"Task {task_id} not found")
            if task.status != AgentTaskStatus.RUNNING:
                raise TaskConflictError(
                    f"Cannot update progress for task {task_id}: status is {task.status}, expected RUNNING"
                )
            if percent is not None:
                task.progress_percent = max(task.progress_percent, min(100, max(0, percent)))
            if message is not None:
                task.progress_message = message[:500]
            if current_step is not None:
                task.current_step = current_step[:100]
            if total_steps is not None:
                task.total_steps = total_steps
            if current_step_num is not None:
                task.current_step_num = current_step_num
            task.version += 1
            self._log_event(
                session,
                task_id,
                "progress",
                data={
                    "percent": task.progress_percent,
                    "message": task.progress_message,
                    "step": task.current_step,
                }
            )
            session.add(task)
            return task

    def complete_task(
        self,
        task_id: str,
        result: Dict[str, Any],
        *,
        tokens_input: int = 0,
        tokens_output: int = 0,
        estimated_cost_cents: int = 0,
    ) -> AgentTaskModel:
        with self._session() as session:
            task = session.get(AgentTaskModel, task_id)
            if task is None:
                raise TaskNotFoundError(f"Task {task_id} not found")
            if task.status != AgentTaskStatus.RUNNING:
                raise TaskConflictError(
                    f"Cannot complete task {task_id}: status is {task.status}, expected RUNNING"
                )
            old_status = task.status
            task.status = AgentTaskStatus.COMPLETED
            task.result = _serialize_for_json(result)
            task.progress_percent = 100
            task.progress_message = "Completed"
            task.completed_at = utc_now()
            task.tokens_input = tokens_input
            task.tokens_output = tokens_output
            task.estimated_cost_cents = estimated_cost_cents
            task.version += 1
            self._log_event(
                session,
                task_id,
                "completed",
                previous_status=old_status.value,
                new_status=AgentTaskStatus.COMPLETED.value,
                data={
                    "tokens_input": tokens_input,
                    "tokens_output": tokens_output,
                }
            )
            session.add(task)
            logger.info(f"Completed task {task_id}")
            return task

    def fail_task(
        self,
        task_id: str,
        error_message: str,
        *,
        error_code: Optional[str] = None,
        is_retryable: bool = True,
        tokens_input: int = 0,
        tokens_output: int = 0,
    ) -> AgentTaskModel:
        with self._session() as session:
            task = session.get(AgentTaskModel, task_id)
            if task is None:
                raise TaskNotFoundError(f"Task {task_id} not found")
            if task.status != AgentTaskStatus.RUNNING:
                raise TaskConflictError(
                    f"Cannot fail task {task_id}: status is {task.status}, expected RUNNING"
                )
            old_status = task.status
            task.last_error = error_message[:2000]
            task.tokens_input += tokens_input
            task.tokens_output += tokens_output
            task.is_retryable = is_retryable
            can_retry = is_retryable and task.attempt_count < task.max_attempts
            if can_retry:
                delay_seconds = self._compute_retry_delay(task.attempt_count)
                task.status = AgentTaskStatus.RETRYING
                task.next_retry_at = utc_now() + timedelta(seconds=delay_seconds)
                task.progress_message = f"Retry scheduled in {delay_seconds}s"
                self._log_event(
                    session,
                    task_id,
                    "retry_scheduled",
                    previous_status=old_status.value,
                    new_status=AgentTaskStatus.RETRYING.value,
                    data={
                        "error": error_message[:500],
                        "error_code": error_code,
                        "attempt": task.attempt_count,
                        "next_retry_at": task.next_retry_at,
                    }
                )
                logger.warning(
                    f"Task {task_id} failed (attempt {task.attempt_count}), "
                    f"retry scheduled for {task.next_retry_at}"
                )
            else:
                task.status = AgentTaskStatus.FAILED
                task.error_message = error_message[:2000]
                task.error_code = error_code
                task.completed_at = utc_now()
                self._log_event(
                    session,
                    task_id,
                    "failed",
                    previous_status=old_status.value,
                    new_status=AgentTaskStatus.FAILED.value,
                    data={
                        "error": error_message[:500],
                        "error_code": error_code,
                        "final": True,
                    }
                )
                logger.error(f"Task {task_id} failed permanently: {error_message[:200]}")
            task.version += 1
            session.add(task)
            return task

    def cancel_task(self, task_id: str, reason: Optional[str] = None) -> AgentTaskModel:
        with self._session() as session:
            task = session.get(AgentTaskModel, task_id)
            if task is None:
                raise TaskNotFoundError(f"Task {task_id} not found")
            if not task.can_cancel():
                raise TaskConflictError(
                    f"Cannot cancel task {task_id}: status is {task.status}"
                )
            old_status = task.status
            task.status = AgentTaskStatus.CANCELLED
            task.completed_at = utc_now()
            task.error_message = reason or "Cancelled by user"
            task.version += 1
            self._log_event(
                session,
                task_id,
                "cancelled",
                previous_status=old_status.value,
                new_status=AgentTaskStatus.CANCELLED.value,
                data={"reason": reason}
            )
            session.add(task)
            logger.info(f"Cancelled task {task_id}")
            return task

    # =========================================================================
    # DELETE operations
    # =========================================================================

    def delete_task(self, task_id: str) -> bool:
        with self._session() as session:
            task = session.get(AgentTaskModel, task_id)
            if task is None:
                return False
            if task.is_active():
                raise TaskConflictError(
                    f"Cannot delete active task {task_id}: status is {task.status}"
                )
            session.execute(
                text("DELETE FROM agent_task_events WHERE task_id = :task_id").bindparams(task_id=task_id)
            )
            session.delete(task)
            logger.info(f"Deleted task {task_id}")
            return True

    def cleanup_expired_tasks(self, batch_size: Optional[int] = None) -> int:
        batch_size = batch_size or self.CLEANUP_BATCH_SIZE
        now = utc_now()
        with self._session() as session:
            query = select(AgentTaskModel).where(
                AgentTaskModel.expires_at <= now,
                AgentTaskModel.status.in_([s.value for s in AgentTaskStatus.terminal_statuses()])
            ).limit(batch_size)
            tasks = list(session.exec(query).all())
            for task in tasks:
                session.execute(
                    text("DELETE FROM agent_task_events WHERE task_id = :task_id").bindparams(task_id=task.task_id)
                )
                session.delete(task)
            if tasks:
                logger.info(f"Cleaned up {len(tasks)} expired tasks")
            return len(tasks)

    # =========================================================================
    # Helper methods
    # =========================================================================

    def _log_event(
        self,
        session: Session,
        task_id: str,
        event_type: str,
        *,
        previous_status: Optional[str] = None,
        new_status: Optional[str] = None,
        data: Optional[Dict[str, Any]] = None,
    ) -> AgentTaskEvent:
        event_obj = AgentTaskEvent(
            task_id=task_id,
            event_type=event_type,
            previous_status=previous_status,
            new_status=new_status,
            event_data=_serialize_for_json(data) if data else None,
        )
        session.add(event_obj)
        return event_obj

    def _compute_retry_delay(self, attempt: int) -> int:
        import random
        base_delay = 5
        max_delay = 300
        delay = base_delay * (2 ** (attempt - 1))
        jitter = delay * 0.25 * (random.random() * 2 - 1)
        delay = delay + jitter
        return min(int(delay), max_delay)

    def get_stats(self) -> Dict[str, Any]:
        with self._session() as session:
            stats = {}
            for status in AgentTaskStatus:
                count_query = select(AgentTaskModel).where(
                    AgentTaskModel.status == status
                )
                count = len(list(session.exec(count_query).all()))
                stats[status.value] = count
            stats["total"] = sum(stats.values())
            return stats

    def recover_stale_tasks(
        self,
        stale_threshold_seconds: int = 600,
    ) -> List[AgentTaskModel]:
        cutoff = utc_now() - timedelta(seconds=stale_threshold_seconds)
        recovered = []
        with self._session() as session:
            stale_query = select(AgentTaskModel).where(
                AgentTaskModel.status == AgentTaskStatus.RUNNING,
                AgentTaskModel.started_at < cutoff,
            )
            stale_tasks = list(session.exec(stale_query).all())
            for task in stale_tasks:
                old_status = task.status
                if task.is_retryable and task.attempt_count < task.max_attempts:
                    task.status = AgentTaskStatus.RETRYING
                    task.next_retry_at = utc_now() + timedelta(seconds=30)
                    task.last_error = "Task was interrupted (server restart)"
                else:
                    task.status = AgentTaskStatus.FAILED
                    task.error_message = "Task was interrupted (server restart)"
                    task.error_code = "SERVER_RESTART"
                    task.completed_at = utc_now()
                task.version += 1
                self._log_event(
                    session,
                    task.task_id,
                    "recovered",
                    previous_status=old_status.value,
                    new_status=task.status.value,
                    data={"reason": "server_restart", "stale_seconds": stale_threshold_seconds}
                )
                session.add(task)
                recovered.append(task)
            if recovered:
                logger.info(f"Recovered {len(recovered)} stale tasks on startup")
        return recovered

# Singleton instance
agent_task_repository = AgentTaskRepository()

__all__ = [
    "AgentTaskRepository",
    "agent_task_repository",
    "AgentTaskModel",
    "AgentTaskStatus",
    "AgentTaskEvent",
    "AgentType",
    "INDEX_DEFINITIONS",
    "TaskNotFoundError",
    "TaskConflictError",
    "IdempotencyConflictError",
    "OptimisticLockError",
    "utc_now",
]

"""
Connections Repository - Database connection management, schema introspection, and query execution.

Consolidated module merging db_connection, repository, and schema.
"""

import argparse
import json
import os
import tempfile
import threading
import time
import uuid
from datetime import date, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from backend.app.utils import get_write_operation, is_select_or_with

# Schema cache configuration

STORAGE = os.path.join(tempfile.gettempdir(), "neura_connections.jsonl")

_SCHEMA_CACHE: dict[tuple[str, bool, bool, int], dict] = {}
_SCHEMA_CACHE_LOCK = threading.Lock()
_SCHEMA_CACHE_TTL_SECONDS = max(int(os.getenv("NR_SCHEMA_CACHE_TTL_SECONDS", "30") or "30"), 0)
_SCHEMA_CACHE_MAX_ENTRIES = max(int(os.getenv("NR_SCHEMA_CACHE_MAX_ENTRIES", "32") or "32"), 5)

# Internal helpers

def _strip_quotes(s: str | None) -> str | None:
    if s is None:
        return None
    return s.strip().strip("'\"")

def _sqlite_path_from_url(db_url: str) -> str:
    u = urlparse(db_url)
    raw = (u.netloc + u.path) if u.netloc else (u.path or "")
    if raw.startswith("/") and len(raw) >= 3 and raw[2] == ":":
        raw = raw.lstrip("/")
    return raw.replace("/", os.sep)

def _coerce_value(value: Any) -> Any:
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    return value

def _count_rows(db_path: Path, table: str) -> int:
    loader = get_loader(db_path)
    try:
        frame = loader.frame(table)
        return len(frame)
    except Exception:
        return 0

def _sample_rows(db_path: Path, table: str, limit: int, offset: int = 0) -> list[dict[str, Any]]:
    loader = get_loader(db_path)
    try:
        frame = loader.frame(table)
        sample = frame.iloc[offset : offset + limit]
        rows: list[dict[str, Any]] = []
        for _, row in sample.iterrows():
            rows.append({key: _coerce_value(value) for key, value in row.to_dict().items()})
        return rows
    except Exception:
        return []

def _cache_get(
    cache_key: tuple[str, bool, bool, int],
    *,
    db_path: Path,
) -> dict | None:
    if _SCHEMA_CACHE_TTL_SECONDS <= 0:
        return None
    try:
        cache_mtime = db_path.stat().st_mtime
    except OSError:
        cache_mtime = 0.0
    now = time.time()
    with _SCHEMA_CACHE_LOCK:
        entry = _SCHEMA_CACHE.get(cache_key)
    if not entry:
        return None
    cached_age = now - float(entry.get("ts") or 0.0)
    if entry.get("mtime") == cache_mtime and cached_age <= _SCHEMA_CACHE_TTL_SECONDS:
        return entry.get("data") or {}
    return None

def _cache_set(cache_key: tuple[str, bool, bool, int], *, db_path: Path, data: dict) -> None:
    if _SCHEMA_CACHE_TTL_SECONDS <= 0:
        return
    try:
        cache_mtime = db_path.stat().st_mtime
    except OSError:
        cache_mtime = 0.0
    with _SCHEMA_CACHE_LOCK:
        _SCHEMA_CACHE[cache_key] = {"mtime": cache_mtime, "ts": time.time(), "data": data}
        if len(_SCHEMA_CACHE) > _SCHEMA_CACHE_MAX_ENTRIES:
            oldest = sorted(_SCHEMA_CACHE.items(), key=lambda item: item[1].get("ts") or 0.0)
            for key, _ in oldest[: max(len(_SCHEMA_CACHE) - _SCHEMA_CACHE_MAX_ENTRIES, 0)]:
                _SCHEMA_CACHE.pop(key, None)

# Path resolution

def resolve_db_path(connection_id: str | None, db_url: str | None, db_path: str | None) -> Path:
    # a) connection_id -> lookup in STORAGE
    if connection_id:
        secrets = state_store.get_connection_secrets(connection_id)
        if secrets and secrets.get("database_path"):
            return Path(secrets["database_path"])
        record = state_store.get_connection_record(connection_id)
        if record and record.get("database_path"):
            return Path(record["database_path"])
        if os.path.exists(STORAGE):
            with open(STORAGE, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        rec = json.loads(line)
                        if rec.get("id") == connection_id:
                            cfg = rec.get("cfg") or {}
                            db = cfg.get("database")
                            if db:
                                state_store.upsert_connection(
                                    conn_id=connection_id,
                                    name=cfg.get("name") or f"{cfg.get('db_type') or 'sqlite'}@{Path(db).name}",
                                    db_type=cfg.get("db_type") or "sqlite",
                                    database_path=str(db),
                                    secret_payload={"database": str(db), "db_url": cfg.get("db_url")},
                                )
                                return Path(db)
                    except Exception:
                        continue
        if not db_url and not db_path:
            raise RuntimeError(f"connection_id {connection_id!r} not found in storage")

    # b) db_url (preferred)
    db_url = _strip_quotes(db_url)
    if db_url:
        parsed = urlparse(db_url)
        if parsed.scheme:
            if parsed.scheme.lower() == "sqlite":
                return Path(_sqlite_path_from_url(db_url))
            if len(parsed.scheme) == 1 and db_url[1:3] in (":\\", ":/"):
                return Path(db_url)
            raise RuntimeError(f"resolve_db_path only handles SQLite. Use resolve_connection_ref() for {parsed.scheme} URLs.")
        return Path(db_url)

    # c) db_path (legacy)
    db_path = _strip_quotes(db_path)
    if db_path:
        return Path(db_path)

    # d) env fallback
    env_path = _strip_quotes(os.getenv("DB_PATH"))
    if env_path:
        return Path(env_path)

    raise RuntimeError("No DB specified. Provide --connection-id OR --db-url OR --db-path (or DB_PATH env).")

def resolve_connection_ref(connection_id: str) -> dict:
    """Resolve a connection_id to its type and access info."""
    secrets = state_store.get_connection_secrets(connection_id)
    if not secrets:
        db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
        return {"db_type": "sqlite", "db_path": db_path, "connection_url": None}

    db_type = secrets.get("db_type") or "sqlite"
    sp = secrets.get("secret_payload") or {}
    db_url = sp.get("db_url") or secrets.get("db_url")

    if db_url and db_url.startswith("postgresql"):
        db_type = "postgresql"

    if db_type in ("postgresql", "postgres"):
        return {"db_type": "postgresql", "db_path": None, "connection_url": db_url}
    else:
        database_path = secrets.get("database_path") or sp.get("database")
        if database_path:
            return {"db_type": "sqlite", "db_path": Path(database_path), "connection_url": None}
        db_path = resolve_db_path(connection_id=connection_id, db_url=db_url, db_path=None)
        return {"db_type": "sqlite", "db_path": db_path, "connection_url": None}

# Verification

def verify_sqlite(path) -> None:
    """Raise when the backing database cannot be materialized into DataFrames."""
    if hasattr(path, 'is_postgresql') and path.is_postgresql:
        verify_postgres(path.connection_url)
        return

    db_file = Path(path)
    if not db_file.exists():
        raise FileNotFoundError(f"SQLite DB not found: {path}")
    try:
        loader = SQLiteDataFrameLoader(db_file)
        loader.table_names()
    except Exception as exc:
        raise RuntimeError(f"SQLite->DataFrame load error: {exc}") from exc

# Query execution

def execute_query(
    connection_id: str,
    sql: str,
    limit: int | None = None,
    offset: int = 0,
) -> dict:
    """Execute a SQL query on a connection and return results."""
    conn_ref = resolve_connection_ref(connection_id)
    db_type = conn_ref["db_type"]
    db_path = conn_ref["db_path"]
    connection_url = conn_ref["connection_url"]

    ensure_connection_loaded(
        connection_id,
        db_path=db_path,
        db_type=db_type,
        connection_url=connection_url,
    )

    if not is_select_or_with(sql):
        raise ValueError("Only SELECT queries are allowed")

    write_op = get_write_operation(sql)
    if write_op:
        raise ValueError(f"Query contains prohibited operation: {write_op}")

    final_sql = sql
    if limit is not None:
        limit = int(limit)
        final_sql = f"{sql} LIMIT {limit}"
        if offset:
            offset = int(offset)
            final_sql += f" OFFSET {offset}"

    def coerce_value(val):
        if val is None:
            return None
        if isinstance(val, (date, datetime)):
            return val.isoformat()
        if isinstance(val, bytes):
            return val.decode("utf-8", errors="replace")
        return val

    store = dataframe_store
    result_df = store.execute_query(connection_id, final_sql)

    columns = list(result_df.columns) if not result_df.empty else []
    rows = []
    for _, row in result_df.iterrows():
        rows.append([coerce_value(row[col]) for col in columns])

    return {
        "columns": columns,
        "rows": rows,
        "row_count": len(rows),
    }

# Save connection

def save_connection(cfg: dict) -> str:
    """Persist a minimal record and return a connection_id."""
    cid = cfg.get("id") or str(uuid.uuid4())
    db_type = cfg.get("db_type") or "sqlite"
    database = cfg.get("database")
    db_url = cfg.get("db_url")
    if db_url and not database:
        database = _sqlite_path_from_url(db_url)
    database_path = str(database) if database else ""
    name = cfg.get("name") or f"{db_type}@{Path(database_path).name if database_path else cid}"
    state_store.upsert_connection(
        conn_id=cid,
        name=name,
        db_type=db_type,
        database_path=database_path,
        secret_payload={"database": database_path, "db_url": db_url},
        status=cfg.get("status"),
        latency_ms=cfg.get("latency_ms"),
        tags=cfg.get("tags"),
    )
    return cid

# Schema introspection

def get_connection_schema(
    connection_id: str,
    *,
    include_row_counts: bool = True,
    include_foreign_keys: bool = True,
    sample_rows: int = 0,
) -> dict[str, Any]:
    if not connection_id:
        raise ValueError("connection_id is required")

    db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
    verify_sqlite(db_path)

    cache_key = (connection_id, include_row_counts, include_foreign_keys, int(sample_rows or 0))
    cached = _cache_get(cache_key, db_path=db_path)
    if cached is not None:
        return cached

    loader = get_loader(db_path)
    tables = []
    for table_name in loader.table_names():
        columns = [
            {
                "name": col.get("name"),
                "type": col.get("type"),
                "notnull": bool(col.get("notnull")),
                "pk": bool(col.get("pk")),
                "default": col.get("dflt_value"),
            }
            for col in loader.pragma_table_info(table_name)
        ]
        table_record: dict[str, Any] = {
            "name": table_name,
            "columns": columns,
        }
        if include_foreign_keys:
            table_record["foreign_keys"] = loader.foreign_keys(table_name)
        if include_row_counts:
            table_record["row_count"] = _count_rows(db_path, table_name)
        if sample_rows and sample_rows > 0:
            table_record["sample_rows"] = _sample_rows(db_path, table_name, min(sample_rows, 25))
        tables.append(table_record)

    connection_record = state_store.get_connection_record(connection_id) or {}
    result = {
        "connection_id": connection_id,
        "connection_name": connection_record.get("name"),
        "database": str(db_path),
        "table_count": len(tables),
        "tables": tables,
    }
    _cache_set(cache_key, db_path=db_path, data=result)
    return result

def get_connection_table_preview(
    connection_id: str,
    *,
    table: str,
    limit: int = 10,
    offset: int = 0,
) -> dict[str, Any]:
    if not connection_id:
        raise ValueError("connection_id is required")
    if not table:
        raise ValueError("table is required")

    db_path = resolve_db_path(connection_id=connection_id, db_url=None, db_path=None)
    verify_sqlite(db_path)

    loader = get_loader(db_path)
    tables = loader.table_names()
    if table not in tables:
        raise ValueError(f"Table '{table}' not found")

    safe_limit = max(1, min(int(limit or 10), 200))
    safe_offset = max(0, int(offset or 0))
    columns = [col.get("name") for col in loader.pragma_table_info(table)]
    rows = _sample_rows(db_path, table, safe_limit, safe_offset)
    return {
        "connection_id": connection_id,
        "table": table,
        "columns": columns,
        "rows": rows,
        "row_count": _count_rows(db_path, table),
        "limit": safe_limit,
        "offset": safe_offset,
    }

# Repository class

class ConnectionRepository:
    def resolve_path(self, *, connection_id: str | None, db_url: str | None, db_path: str | None) -> Path:
        return resolve_db_path(connection_id=connection_id, db_url=db_url, db_path=db_path)

    def verify(self, path: Path) -> None:
        verify_sqlite(path)

    def save(self, payload: dict) -> str:
        return save_connection(payload)

    def upsert(self, **kwargs) -> dict:
        return state_store.upsert_connection(**kwargs)

    def list(self) -> list[dict]:
        return state_store.list_connections()

    def get_secrets(self, connection_id: str) -> dict | None:
        return state_store.get_connection_secrets(connection_id)

    def delete(self, connection_id: str) -> bool:
        return state_store.delete_connection(connection_id)

    def record_ping(self, connection_id: str, status: str, detail: str | None, latency_ms: float | None) -> None:
        state_store.record_connection_ping(connection_id, status=status, detail=detail, latency_ms=latency_ms)

__all__ = [
    "ConnectionRepository",
    "get_connection_schema",
    "get_connection_table_preview",
    "resolve_db_path",
    "resolve_connection_ref",
    "verify_sqlite",
    "execute_query",
    "save_connection",
]

# ---- CLI only (safe to import in API) ----
if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="NeuraReport DB resolver")
    parser.add_argument("--connection-id")
    parser.add_argument("--db-url")
    parser.add_argument("--db-path")
    args = parser.parse_args()

    DB_PATH = resolve_db_path(
        connection_id=_strip_quotes(args.connection_id) or _strip_quotes(os.getenv("CONNECTION_ID")),
        db_url=_strip_quotes(args.db_url) or _strip_quotes(os.getenv("DB_URL")),
        db_path=_strip_quotes(args.db_path) or _strip_quotes(os.getenv("DB_PATH")),
    )
    verify_sqlite(DB_PATH)
    print(f"Resolved DB path: {DB_PATH}")

"""
Shared DataFrame helpers for SQL-lite pipelines.

Consolidated module merging sqlite_loader, sqlite_shim, postgres_loader, and store.
"""

import logging
import os
import re
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Mapping, Sequence

import duckdb
import pandas as pd
from sqlalchemy import create_engine, text as sa_text

logger = logging.getLogger("neura.dataframes.loader")

_MAX_TABLE_ROWS = int(os.getenv("NEURA_MAX_TABLE_ROWS", "500000"))
_MAX_TABLE_MB = int(os.getenv("NEURA_MAX_TABLE_MB", "500"))
_MAX_LOADER_CACHE = int(os.getenv("NEURA_MAX_LOADER_CACHE", "20"))

class SQLiteDataFrameLoader:
    """Load SQLite tables into cached pandas DataFrames."""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self._table_names: list[str] | None = None
        self._frames: dict[str, pd.DataFrame] = {}
        self._lock = threading.Lock()
        self._mtime = os.path.getmtime(self.db_path) if self.db_path.exists() else 0.0
        self._table_info_cache: dict[str, list[dict[str, Any]]] = {}
        self._foreign_keys_cache: dict[str, list[dict[str, Any]]] = {}

    def table_names(self) -> list[str]:
        with self._lock:
            if self._table_names is not None:
                return list(self._table_names)
            with sqlite3.connect(str(self.db_path), timeout=300) as con:
                cur = con.execute(
                    "SELECT name FROM sqlite_master "
                    "WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name;"
                )
                tables = [str(row[0]) for row in cur.fetchall() if row and row[0]]
            self._table_names = tables
            return list(self._table_names)

    def _assert_table(self, table_name: str) -> str:
        clean = str(table_name or "").strip()
        if not clean:
            raise ValueError("table_name must be a non-empty string")
        if clean not in self.table_names():
            raise RuntimeError(f"Table {clean!r} not found in {self.db_path}")
        return clean

    def frame(self, table_name: str) -> pd.DataFrame:
        clean = self._assert_table(table_name)
        with self._lock:
            cached = self._frames.get(clean)
            if cached is not None:
                return cached
        df = self._read_table(clean)
        mem_mb = self._estimate_memory_mb(df)
        logger.info(
            "table_loaded",
            extra={"table": clean, "rows": len(df), "memory_mb": round(mem_mb, 2)},
        )
        if mem_mb > _MAX_TABLE_MB:
            logger.warning(
                "table_memory_warning",
                extra={"table": clean, "memory_mb": round(mem_mb, 2), "limit_mb": _MAX_TABLE_MB},
            )
        with self._lock:
            self._frames[clean] = df
        return df

    def frames(self) -> dict[str, pd.DataFrame]:
        for name in self.table_names():
            self.frame(name)
        with self._lock:
            return dict(self._frames)

    def _table_row_count(self, table_name: str) -> int:
        quoted = table_name.replace('"', '""')
        with sqlite3.connect(str(self.db_path), timeout=300) as con:
            return con.execute(f'SELECT COUNT(*) FROM "{quoted}"').fetchone()[0]

    @staticmethod
    def _estimate_memory_mb(df: pd.DataFrame) -> float:
        return df.memory_usage(deep=True).sum() / (1024 * 1024)

    def _read_table(self, table_name: str) -> pd.DataFrame:
        quoted = table_name.replace('"', '""')
        try:
            row_count = self._table_row_count(table_name)
            if row_count > _MAX_TABLE_ROWS:
                logger.warning(
                    "table_row_limit",
                    extra={"table": table_name, "rows": row_count, "limit": _MAX_TABLE_ROWS},
                )
                limit_clause = f" LIMIT {_MAX_TABLE_ROWS}"
            else:
                limit_clause = ""
            with sqlite3.connect(str(self.db_path), timeout=300) as con:
                # Try with rowid first (tables), fall back to without (views)
                try:
                    df = pd.read_sql_query(
                        f'SELECT rowid AS "__rowid__", * FROM "{quoted}"{limit_clause}', con
                    )
                except Exception:
                    df = pd.read_sql_query(
                        f'SELECT * FROM "{quoted}"{limit_clause}', con
                    )
        except Exception as exc:
            raise RuntimeError(f"Failed loading table {table_name!r} into DataFrame: {exc}") from exc
        for col in df.columns:
            if pd.api.types.is_string_dtype(df[col].dtype):
                df[col] = df[col].astype("object")
        if "__rowid__" in df.columns:
            rowid_series = df["__rowid__"].copy()
            if "rowid" not in df.columns:
                df.insert(0, "rowid", rowid_series)
        return df

    def frame_date_filtered(
        self,
        table_name: str,
        date_column: str,
        start_date: str | None = None,
        end_date: str | None = None,
    ) -> pd.DataFrame:
        """Load a table with a date range WHERE clause applied at the SQLite level.

        This bypasses the row_limit truncation by filtering in SQL before loading.
        Returns a fresh (uncached) DataFrame.
        """
        clean = self._assert_table(table_name)
        quoted_table = clean.replace('"', '""')
        quoted_col = date_column.replace('"', '""')

        conditions = []
        params: list[str] = []
        if start_date:
            conditions.append(f'"{quoted_col}" >= ?')
            sd = str(start_date).strip()
            if " " in sd and "T" not in sd:
                sd = sd.replace(" ", "T", 1)
            params.append(sd)
        if end_date:
            conditions.append(f'"{quoted_col}" <= ?')
            ed = str(end_date).strip()
            if " " in ed and "T" not in ed:
                ed = ed.replace(" ", "T", 1)
            if len(ed) == 10:
                ed = ed + "T23:59:59.999999"
            elif len(ed) == 16:
                ed = ed + ":59.999999"
            elif len(ed) == 19:
                ed = ed + ".999999"
            params.append(ed)

        where = f" WHERE {' AND '.join(conditions)}" if conditions else ""

        try:
            with sqlite3.connect(str(self.db_path), timeout=300) as con:
                try:
                    sql = f'SELECT rowid AS "__rowid__", * FROM "{quoted_table}"{where}'
                    df = pd.read_sql_query(sql, con, params=params)
                except Exception:
                    sql = f'SELECT * FROM "{quoted_table}"{where}'
                    df = pd.read_sql_query(sql, con, params=params)
        except Exception as exc:
            raise RuntimeError(
                f"Failed loading table {table_name!r} with date filter: {exc}"
            ) from exc

        logger.info(
            "frame_date_filtered table=%s col=%s start=%s end=%s rows=%d",
            table_name, date_column, start_date, end_date, len(df),
        )

        for col in df.columns:
            if pd.api.types.is_string_dtype(df[col].dtype):
                df[col] = df[col].astype("object")
        if "__rowid__" in df.columns:
            rowid_series = df["__rowid__"].copy()
            if "rowid" not in df.columns:
                df.insert(0, "rowid", rowid_series)
        return df

    def column_names(self, table_name: str) -> list[str]:
        """Return column names using PRAGMA — no data loaded."""
        info = self.pragma_table_info(table_name)
        return [col["name"] for col in info]

    def column_type(self, table_name: str, column_name: str) -> str:
        """Return the SQLite declared type for a column (no data loaded)."""
        info = self.pragma_table_info(table_name)
        for col in info:
            if col["name"] == column_name:
                declared = (col.get("type") or "").upper()
                if "INT" in declared:
                    return "INTEGER"
                if "REAL" in declared or "FLOAT" in declared or "DOUBLE" in declared:
                    return "REAL"
                if "DATE" in declared or "TIME" in declared:
                    return "DATETIME"
                if "BOOL" in declared:
                    return "INTEGER"
                return "TEXT"
        return ""

    def table_info(self, table_name: str) -> list[tuple[str, str]]:
        """Return (name, type) pairs using PRAGMA — no data loaded."""
        info = self.pragma_table_info(table_name)
        return [(col["name"], col.get("type") or "TEXT") for col in info]

    def _load_table_metadata(
        self, table_name: str
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        clean = self._assert_table(table_name)
        with self._lock:
            cached_info = self._table_info_cache.get(clean)
            cached_fks = self._foreign_keys_cache.get(clean)
            if cached_info is not None and cached_fks is not None:
                return cached_info, cached_fks

        quoted = clean.replace("'", "''")
        info_rows: list[dict[str, Any]] = []
        fk_rows: list[dict[str, Any]] = []
        try:
            with sqlite3.connect(str(self.db_path), timeout=300) as con:
                cur = con.execute(f"PRAGMA table_info('{quoted}')")
                info_rows = [
                    {
                        "cid": int(row[0]),
                        "name": str(row[1]),
                        "type": str(row[2] or ""),
                        "notnull": int(row[3] or 0),
                        "dflt_value": row[4],
                        "pk": int(row[5] or 0),
                    }
                    for row in cur.fetchall()
                ]
                cur = con.execute(f"PRAGMA foreign_key_list('{quoted}')")
                fk_rows = [
                    {
                        "id": int(row[0]),
                        "seq": int(row[1]),
                        "table": str(row[2] or ""),
                        "from": str(row[3] or ""),
                        "to": str(row[4] or ""),
                        "on_update": str(row[5] or ""),
                        "on_delete": str(row[6] or ""),
                        "match": str(row[7] or ""),
                    }
                    for row in cur.fetchall()
                ]
        except Exception as exc:
            raise RuntimeError(f"Failed loading metadata for table {clean!r}: {exc}") from exc

        with self._lock:
            self._table_info_cache[clean] = info_rows
            self._foreign_keys_cache[clean] = fk_rows
        return info_rows, fk_rows

    def pragma_table_info(self, table_name: str) -> list[dict[str, Any]]:
        info, _ = self._load_table_metadata(table_name)
        return list(info)

    def foreign_keys(self, table_name: str) -> list[dict[str, Any]]:
        _, fks = self._load_table_metadata(table_name)
        return list(fks)

_LOADER_CACHE: dict[str, SQLiteDataFrameLoader] = {}
_LOADER_CACHE_ACCESS: dict[str, float] = {}
_LOADER_CACHE_LOCK = threading.Lock()

def _evict_oldest_loaders() -> None:
    while len(_LOADER_CACHE) > _MAX_LOADER_CACHE:
        oldest_key = min(_LOADER_CACHE_ACCESS, key=_LOADER_CACHE_ACCESS.get)
        _LOADER_CACHE.pop(oldest_key, None)
        _LOADER_CACHE_ACCESS.pop(oldest_key, None)
        logger.info("loader_cache_evicted", extra={"path": oldest_key})

def get_loader(db_path: Path) -> SQLiteDataFrameLoader:
    key = str(Path(db_path).resolve())
    with _LOADER_CACHE_LOCK:
        loader = _LOADER_CACHE.get(key)
        mtime = os.path.getmtime(key) if os.path.exists(key) else 0.0
        if loader is None or loader._mtime != mtime:
            loader = SQLiteDataFrameLoader(Path(key))
            loader._mtime = mtime
            _LOADER_CACHE[key] = loader
            _evict_oldest_loaders()
        _LOADER_CACHE_ACCESS[key] = time.monotonic()
    return loader

_PARAM_PATTERN = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")
_SQLITE_DATETIME_RE = re.compile(r"(?i)(?<!sqlite_)\bdatetime\s*\(")
_SQLITE_STRFTIME_RE = re.compile(r"(?i)(?<!sqlite_)\bstrftime\s*\(")

_DATETIME_NOW_MODIFIER_RE = re.compile(
    r"""(?ix)\bdatetime\s*\(\s*'now'\s*,\s*'([+-]?\s*\d+)\s+(seconds?|minutes?|hours?|days?|months?|years?)'\s*\)"""
)
_DATETIME_START_OF_RE = re.compile(
    r"""(?ix)\bdatetime\s*\(\s*'now'\s*,\s*'start\s+of\s+(month|year|day)'\s*\)"""
)
_DATE_NOW_RE = re.compile(r"""(?ix)\bDATE\s*\(\s*'now'\s*\)""")
_DATE_NOW_MODIFIER_RE = re.compile(
    r"""(?ix)\bDATE\s*\(\s*'now'\s*,\s*'([+-]?\s*\d+)\s+(seconds?|minutes?|hours?|days?|months?|years?)'\s*\)"""
)
_DATETIME_GENERAL_MODIFIER_RE = re.compile(
    r"(?i)\bdatetime\s*\(\s*((?:[^()]*|\([^()]*\))*?)\s*,\s*'([+-]?\s*\d+)\s+(seconds?|minutes?|hours?|days?|months?|years?)'\s*\)"
)
_SQLITE_DATE_FUNC_RE = re.compile(r"(?i)(?<!sqlite_)\bdate\s*\(")

def _normalize_params(sql: str, params: Any | None) -> tuple[str, Sequence[Any]]:
    if params is None:
        return sql, ()
    if isinstance(params, Mapping):
        ordered: list[Any] = []

        def _repl(match: re.Match[str]) -> str:
            name = match.group(1)
            if name not in params:
                raise KeyError(f"Missing SQL parameter: {name}")
            ordered.append(params[name])
            return "?"

        prepared = _PARAM_PATTERN.sub(_repl, sql)
        return prepared, tuple(ordered)
    if isinstance(params, (list, tuple)):
        return sql, tuple(params)
    return sql, (params,)

def _normalize_unit(unit: str) -> str:
    u = unit.strip().upper().rstrip("S")
    mapping = {"SECOND": "SECOND", "MINUTE": "MINUTE", "HOUR": "HOUR",
               "DAY": "DAY", "MONTH": "MONTH", "YEAR": "YEAR"}
    return mapping.get(u, u)

def _rewrite_datetime_modifier(m: re.Match) -> str:
    raw_amount = m.group(1).replace(" ", "")
    unit = _normalize_unit(m.group(2))
    amount = int(raw_amount)
    if amount >= 0:
        return f"(CURRENT_TIMESTAMP + INTERVAL '{amount}' {unit})"
    else:
        return f"(CURRENT_TIMESTAMP - INTERVAL '{-amount}' {unit})"

def _rewrite_start_of(m: re.Match) -> str:
    unit = m.group(1).lower()
    return f"DATE_TRUNC('{unit}', CURRENT_TIMESTAMP)"

def _rewrite_date_modifier(m: re.Match) -> str:
    raw_amount = m.group(1).replace(" ", "")
    unit = _normalize_unit(m.group(2))
    amount = int(raw_amount)
    if amount >= 0:
        return f"(CURRENT_DATE + INTERVAL '{amount}' {unit})"
    else:
        return f"(CURRENT_DATE - INTERVAL '{-amount}' {unit})"

def _rewrite_datetime_general_modifier(m: re.Match) -> str:
    expr = m.group(1).strip()
    raw_amount = m.group(2).replace(" ", "")
    unit = _normalize_unit(m.group(3))
    amount = int(raw_amount)
    if amount >= 0:
        return f"(TRY_CAST({expr} AS TIMESTAMP) + INTERVAL '{amount}' {unit})"
    else:
        return f"(TRY_CAST({expr} AS TIMESTAMP) - INTERVAL '{-amount}' {unit})"

def _rewrite_sql(sql: str) -> str:
    updated = _DATETIME_NOW_MODIFIER_RE.sub(_rewrite_datetime_modifier, sql)
    updated = _DATETIME_START_OF_RE.sub(_rewrite_start_of, updated)
    updated = _DATE_NOW_MODIFIER_RE.sub(_rewrite_date_modifier, updated)
    updated = _DATE_NOW_RE.sub("CURRENT_DATE", updated)
    for _ in range(5):
        new = _DATETIME_GENERAL_MODIFIER_RE.sub(_rewrite_datetime_general_modifier, updated)
        if new == updated:
            break
        updated = new
    updated = _SQLITE_DATE_FUNC_RE.sub("sqlite_date(", updated)
    updated = _SQLITE_DATETIME_RE.sub("sqlite_datetime(", updated)
    updated = _SQLITE_STRFTIME_RE.sub("sqlite_strftime(", updated)
    return updated

_MISSING_TABLE_RE = re.compile(r'(?:Table|Relation) with name "?(?P<table>[^"\s]+)"? does not exist', re.I)

class DuckDBDataFrameQuery:
    """Execute SQL against in-memory pandas DataFrames via DuckDB."""

    def __init__(self, frames: Mapping[str, pd.DataFrame], loader: SQLiteDataFrameLoader | None = None):
        self._conn = duckdb.connect(database=":memory:")
        self._loader = loader
        self._registered: set[str] = set()
        self._register_frames(frames)
        self._register_sqlite_macros()

    def _register_frames(self, frames: Mapping[str, pd.DataFrame]) -> None:
        for name, frame in frames.items():
            if frame is None:
                continue
            self._register_frame(name, frame)

    def _register_frame(self, name: str, frame: pd.DataFrame) -> None:
        if not name or name in self._registered:
            return
        self._conn.register(name, frame)
        self._registered.add(name)

    def _try_register_missing_table(self, exc: Exception) -> bool:
        if self._loader is None:
            return False
        match = _MISSING_TABLE_RE.search(str(exc))
        if not match:
            return False
        table = match.group("table")
        if not table or table in self._registered:
            return False
        try:
            frame = self._loader.frame(table)
        except Exception:
            return False
        self._register_frame(table, frame)
        return True

    def _register_sqlite_macros(self) -> None:
        self._conn.execute(
            """
            CREATE MACRO IF NOT EXISTS sqlite_datetime(x) AS (
                CASE
                    WHEN x IS NULL THEN NULL
                    WHEN LOWER(CAST(x AS VARCHAR)) = 'now' THEN CURRENT_TIMESTAMP
                    WHEN TRY_CAST(x AS DOUBLE) IS NOT NULL THEN TO_TIMESTAMP(CAST(x AS DOUBLE))
                    ELSE TRY_CAST(x AS TIMESTAMP)
                END
            )
            """
        )
        self._conn.execute(
            """
            CREATE MACRO IF NOT EXISTS sqlite_strftime(fmt, value, modifier := NULL) AS (
                CASE
                    WHEN value IS NULL THEN NULL
                    ELSE STRFTIME(sqlite_datetime(value), fmt)
                END
            )
            """
        )
        self._conn.execute("CREATE MACRO IF NOT EXISTS datetime(x) AS sqlite_datetime(x)")
        self._conn.execute(
            "CREATE MACRO IF NOT EXISTS sqlite_date(x) AS TRY_CAST(x AS DATE)"
        )

    def execute(self, sql: str, params: Any | None = None) -> pd.DataFrame:
        prepared_sql, ordered_params = _normalize_params(sql, params)
        rewritten_sql = _rewrite_sql(prepared_sql)
        attempts = 0
        while True:
            try:
                result = self._conn.execute(rewritten_sql, ordered_params)
                return result.fetchdf()
            except duckdb.Error as exc:
                if attempts < 5 and self._try_register_missing_table(exc):
                    attempts += 1
                    continue
                raise RuntimeError(f"DuckDB execution failed: {exc}") from exc

    def close(self) -> None:
        self._conn.close()

def eager_load_enabled() -> bool:
    flag = os.getenv("NEURA_DATAFRAME_EAGER_LOAD", "false")
    return str(flag).strip().lower() in {"1", "true", "yes"}

class _ShimError(Exception):
    """Base error matching sqlite3.Error."""

class OperationalError(_ShimError):
    """Raised when SQL execution fails."""

# Alias for sqlite3 compat
Error = _ShimError

class Row:
    """Lightweight sqlite3.Row replacement supporting dict + index access."""

    __slots__ = ("_columns", "_values", "_mapping")

    def __init__(self, columns: Sequence[str], values: Sequence[Any]):
        self._columns = list(columns)
        self._values = tuple(values)
        self._mapping = {col: value for col, value in zip(self._columns, self._values)}

    def __getitem__(self, key: int | str) -> Any:
        if isinstance(key, int):
            return self._values[key]
        return self._mapping[key]

    def keys(self) -> list[str]:
        return list(self._columns)

    def __iter__(self):
        return iter(self._values)

    def __len__(self) -> int:
        return len(self._values)

    def __repr__(self) -> str:
        items = ", ".join(f"{col}={self._mapping[col]!r}" for col in self._columns)
        return f"Row({items})"

def _apply_row_factory(columns: list[str], values: Sequence[Any], factory: Any | None):
    if factory is None:
        return tuple(values)
    if factory is Row:
        return Row(columns, values)
    return factory(columns, values)

class DataFrameCursor:
    def __init__(self, connection: "DataFrameConnection"):
        self.connection = connection
        self._df: pd.DataFrame | None = None
        self._columns: list[str] = []
        self._pos = 0
        self.description: list[tuple[str]] | None = None

    def execute(self, sql: str, params: Any | None = None) -> "DataFrameCursor":
        meta_df = self._try_meta_query(sql)
        if meta_df is not None:
            self._df = meta_df
            self._columns = list(meta_df.columns)
            self._pos = 0
            self.description = [(col,) for col in self._columns]
            return self
        try:
            df = self.connection._query.execute(sql, params)
        except Exception as exc:
            raise OperationalError(str(exc)) from exc
        self._df = df
        self._columns = list(df.columns)
        self._pos = 0
        self.description = [(col,) for col in self._columns]
        return self

    def _try_meta_query(self, sql: str) -> pd.DataFrame | None:
        sql_clean = (sql or "").strip()
        pragma_match = re.match(r"(?is)^PRAGMA\s+table_info\(['\"]?(?P<table>[^'\")]+)['\"]?\)\s*;?$", sql_clean)
        if pragma_match:
            table_name = pragma_match.group("table")
            try:
                rows = self.connection._loader.pragma_table_info(table_name)
            except Exception:
                rows = []
            data = [
                (
                    int(row.get("cid", 0)),
                    str(row.get("name", "")),
                    str(row.get("type", "")),
                    int(row.get("notnull", 0)),
                    row.get("dflt_value"),
                    int(row.get("pk", 0)),
                )
                for row in rows
            ]
            return pd.DataFrame(data, columns=["cid", "name", "type", "notnull", "dflt_value", "pk"])

        fk_match = re.match(r"(?is)^PRAGMA\s+foreign_key_list\(['\"]?(?P<table>[^'\")]+)['\"]?\)\s*;?$", sql_clean)
        if fk_match:
            table_name = fk_match.group("table")
            try:
                rows = self.connection._loader.foreign_keys(table_name)
            except Exception:
                rows = []
            data = [
                (
                    int(row.get("id", 0)),
                    int(row.get("seq", 0)),
                    str(row.get("table", "")),
                    str(row.get("from", "")),
                    str(row.get("to", "")),
                    str(row.get("on_update", "")),
                    str(row.get("on_delete", "")),
                    str(row.get("match", "")),
                )
                for row in rows
            ]
            return pd.DataFrame(
                data, columns=["id", "seq", "table", "from", "to", "on_update", "on_delete", "match"]
            )

        if "sqlite_master" in sql_clean.lower():
            names = [name for name in self.connection._loader.table_names() if not name.lower().startswith("sqlite_")]
            data = [(name,) for name in sorted(names)]
            return pd.DataFrame(data, columns=["name"])
        return None

    def fetchone(self):
        if self._df is None:
            return None
        if self._pos >= len(self._df):
            return None
        row = self._df.iloc[self._pos].tolist()
        self._pos += 1
        return _apply_row_factory(self._columns, row, self.connection.row_factory)

    def fetchall(self):
        rows = []
        while True:
            row = self.fetchone()
            if row is None:
                break
            rows.append(row)
        return rows

    def fetchmany(self, size: int = 1):
        if size is None:
            size = 1
        rows = []
        for _ in range(max(0, int(size))):
            row = self.fetchone()
            if row is None:
                break
            rows.append(row)
        return rows

    def __iter__(self):
        while True:
            row = self.fetchone()
            if row is None:
                return
            yield row

class DataFrameConnection:
    def __init__(self, db_path):
        if hasattr(db_path, 'is_postgresql') and db_path.is_postgresql:
            from backend.app.services.legacy_services import get_loader_for_ref
            self.db_path = db_path
            self._loader = get_loader_for_ref(db_path)
        else:
            self.db_path = Path(db_path)
            self._loader = get_loader(self.db_path)
        if eager_load_enabled():
            frames = self._loader.frames()
        else:
            frames = {}
        self._query = DuckDBDataFrameQuery(frames, loader=self._loader)
        self.row_factory: Any | None = None

    def cursor(self) -> DataFrameCursor:
        return DataFrameCursor(self)

    def execute(self, sql: str, params: Any | None = None) -> DataFrameCursor:
        return self.cursor().execute(sql, params)

    def close(self) -> None:
        self._query.close()

    def commit(self) -> None:
        return None

    def rollback(self) -> None:
        return None

    def __enter__(self) -> "DataFrameConnection":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        self.close()

# Type aliases for sqlite3 compatibility
Connection = DataFrameConnection
Cursor = DataFrameCursor

def connect(db_path, **_kwargs) -> DataFrameConnection:
    """sqlite3.connect-compatible entrypoint backed by pandas DataFrames."""
    if hasattr(db_path, 'is_postgresql'):
        return DataFrameConnection(db_path)
    return DataFrameConnection(Path(db_path))

_pg_logger = logging.getLogger("neura.dataframes.postgres")
DEFAULT_ROW_LIMIT = 0  # 0 = unlimited — SQL date-pre-filtering already limits rows loaded

class PostgresDataFrameLoader:
    """Load PostgreSQL tables into cached pandas DataFrames."""

    def __init__(self, connection_url: str, row_limit: int = DEFAULT_ROW_LIMIT):
        self.connection_url = connection_url
        self.row_limit = row_limit
        self._engine = create_engine(
            connection_url,
            connect_args={"connect_timeout": 10},
            pool_pre_ping=True,
            pool_size=2,
            max_overflow=3,
        )
        self._table_names: list[str] | None = None
        self._frames: dict[str, pd.DataFrame] = {}
        self._lock = threading.Lock()
        self._table_info_cache: dict[str, list[dict[str, Any]]] = {}
        self._foreign_keys_cache: dict[str, list[dict[str, Any]]] = {}
        self._mtime: float = 0.0

    def table_names(self) -> list[str]:
        with self._lock:
            if self._table_names is not None:
                return list(self._table_names)

        with self._engine.connect() as conn:
            result = conn.execute(sa_text(
                "SELECT table_schema, table_name "
                "FROM information_schema.tables "
                "WHERE table_type = 'BASE TABLE' "
                "AND table_schema NOT IN ('pg_catalog', 'information_schema') "
                "ORDER BY table_schema, table_name"
            ))
            tables = []
            for row in result:
                schema, name = row[0], row[1]
                if schema == "public":
                    tables.append(name)
                else:
                    tables.append(f"{schema}.{name}")

        with self._lock:
            self._table_names = tables
        return list(tables)

    def _assert_table(self, table_name: str) -> str:
        clean = str(table_name or "").strip()
        if not clean:
            raise ValueError("table_name must be a non-empty string")
        if clean not in self.table_names():
            raise RuntimeError(f"Table {clean!r} not found in PostgreSQL database")
        return clean

    def _parse_table_ref(self, table_name: str) -> tuple[str, str]:
        if "." in table_name:
            parts = table_name.split(".", 1)
            return parts[0], parts[1]
        return "public", table_name

    def frame(self, table_name: str) -> pd.DataFrame:
        clean = self._assert_table(table_name)
        with self._lock:
            cached = self._frames.get(clean)
            if cached is not None:
                return cached
        df = self._read_table(clean)
        with self._lock:
            self._frames[clean] = df
        return df

    def frames(self) -> dict[str, pd.DataFrame]:
        for name in self.table_names():
            self.frame(name)
        with self._lock:
            return dict(self._frames)

    def _read_table(self, table_name: str) -> pd.DataFrame:
        schema, table = self._parse_table_ref(table_name)
        quoted_schema = schema.replace('"', '""')
        quoted_table = table.replace('"', '""')
        sql = f'SELECT * FROM "{quoted_schema}"."{quoted_table}"'
        if self.row_limit:
            sql += f" LIMIT {int(self.row_limit)}"

        try:
            with self._engine.connect() as conn:
                df = pd.read_sql_query(sa_text(sql), conn)
        except Exception as exc:
            raise RuntimeError(f"Failed loading table {table_name!r} into DataFrame: {exc}") from exc

        row_count = len(df)
        if self.row_limit and row_count >= self.row_limit:
            _pg_logger.warning(
                f"Table {table_name!r} hit row limit ({self.row_limit}). "
                f"Data is truncated -- increase row_limit for full access."
            )

        for col in df.columns:
            if pd.api.types.is_string_dtype(df[col].dtype):
                df[col] = df[col].astype("object")
        return df

    def column_type(self, table_name: str, column_name: str) -> str:
        table = self.frame(table_name)
        if column_name not in table.columns:
            return ""
        series = table[column_name]
        if pd.api.types.is_datetime64_any_dtype(series):
            return "TIMESTAMP"
        if pd.api.types.is_integer_dtype(series):
            return "INTEGER"
        if pd.api.types.is_float_dtype(series):
            return "REAL"
        if pd.api.types.is_bool_dtype(series):
            return "BOOLEAN"
        return "TEXT"

    def table_info(self, table_name: str) -> list[tuple[str, str]]:
        table = self.frame(table_name)
        return [(col, str(table[col].dtype)) for col in table.columns]

    def pragma_table_info(self, table_name: str) -> list[dict[str, Any]]:
        info, _ = self._load_table_metadata(table_name)
        return list(info)

    def foreign_keys(self, table_name: str) -> list[dict[str, Any]]:
        _, fks = self._load_table_metadata(table_name)
        return list(fks)

    def _load_table_metadata(
        self, table_name: str,
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        clean = self._assert_table(table_name)
        with self._lock:
            cached_info = self._table_info_cache.get(clean)
            cached_fks = self._foreign_keys_cache.get(clean)
            if cached_info is not None and cached_fks is not None:
                return cached_info, cached_fks

        schema, table = self._parse_table_ref(clean)
        info_rows: list[dict[str, Any]] = []
        fk_rows: list[dict[str, Any]] = []

        try:
            with self._engine.connect() as conn:
                result = conn.execute(sa_text(
                    "SELECT ordinal_position, column_name, data_type, "
                    "is_nullable, column_default "
                    "FROM information_schema.columns "
                    "WHERE table_schema = :schema AND table_name = :table "
                    "ORDER BY ordinal_position"
                ), {"schema": schema, "table": table})

                pk_result = conn.execute(sa_text(
                    "SELECT kcu.column_name "
                    "FROM information_schema.table_constraints tc "
                    "JOIN information_schema.key_column_usage kcu "
                    "  ON tc.constraint_name = kcu.constraint_name "
                    "  AND tc.table_schema = kcu.table_schema "
                    "WHERE tc.constraint_type = 'PRIMARY KEY' "
                    "  AND tc.table_schema = :schema "
                    "  AND tc.table_name = :table"
                ), {"schema": schema, "table": table})
                pk_columns = {r[0] for r in pk_result}

                for row in result:
                    info_rows.append({
                        "cid": int(row[0]) - 1,
                        "name": str(row[1]),
                        "type": str(row[2] or "").upper(),
                        "notnull": 1 if row[3] == "NO" else 0,
                        "dflt_value": row[4],
                        "pk": 1 if row[1] in pk_columns else 0,
                    })

                fk_result = conn.execute(sa_text(
                    "SELECT tc.constraint_name, kcu.column_name, "
                    "ccu.table_name AS ref_table, ccu.column_name AS ref_column, "
                    "rc.update_rule, rc.delete_rule "
                    "FROM information_schema.table_constraints tc "
                    "JOIN information_schema.key_column_usage kcu "
                    "  ON tc.constraint_name = kcu.constraint_name "
                    "  AND tc.table_schema = kcu.table_schema "
                    "JOIN information_schema.constraint_column_usage ccu "
                    "  ON tc.constraint_name = ccu.constraint_name "
                    "JOIN information_schema.referential_constraints rc "
                    "  ON tc.constraint_name = rc.constraint_name "
                    "WHERE tc.constraint_type = 'FOREIGN KEY' "
                    "  AND tc.table_schema = :schema "
                    "  AND tc.table_name = :table"
                ), {"schema": schema, "table": table})

                for i, row in enumerate(fk_result):
                    fk_rows.append({
                        "id": i,
                        "seq": 0,
                        "table": str(row[2] or ""),
                        "from": str(row[1] or ""),
                        "to": str(row[3] or ""),
                        "on_update": str(row[4] or ""),
                        "on_delete": str(row[5] or ""),
                        "match": "",
                    })

        except Exception as exc:
            raise RuntimeError(f"Failed loading metadata for table {clean!r}: {exc}") from exc

        with self._lock:
            self._table_info_cache[clean] = info_rows
            self._foreign_keys_cache[clean] = fk_rows
        return info_rows, fk_rows

    def dispose(self) -> None:
        try:
            self._engine.dispose()
        except Exception:
            pass

def verify_postgres(connection_url: str) -> None:
    """Verify a PostgreSQL database is accessible."""
    engine = create_engine(connection_url, connect_args={"connect_timeout": 5})
    try:
        with engine.connect() as conn:
            conn.execute(sa_text("SELECT 1"))
    except Exception as exc:
        raise RuntimeError(f"PostgreSQL connection failed: {exc}") from exc
    finally:
        engine.dispose()

_PG_LOADER_CACHE: dict[str, PostgresDataFrameLoader] = {}
_PG_LOADER_CACHE_LOCK = threading.Lock()

def get_postgres_loader(connection_url: str) -> PostgresDataFrameLoader:
    with _PG_LOADER_CACHE_LOCK:
        loader = _PG_LOADER_CACHE.get(connection_url)
        if loader is None:
            loader = PostgresDataFrameLoader(connection_url)
            _PG_LOADER_CACHE[connection_url] = loader
    return loader

_store_logger = logging.getLogger("neura.dataframes.store")

def _frames_memory_bytes(frames: dict[str, pd.DataFrame]) -> int:
    """Total memory usage of a collection of DataFrames."""
    return sum(df.memory_usage(deep=True).sum() for df in frames.values()) if frames else 0


class DataFrameStore:
    """Centralized store for managing DataFrames by connection."""

    _instance: DataFrameStore | None = None
    _lock = threading.Lock()

    def __new__(cls) -> "DataFrameStore":
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self) -> None:
        if self._initialized:
            return
        self._loaders: dict[str, SQLiteDataFrameLoader | PostgresDataFrameLoader] = {}
        self._frames_cache: dict[str, dict[str, pd.DataFrame]] = {}
        self._db_paths: dict[str, Path] = {}
        self._connection_urls: dict[str, str] = {}
        self._db_types: dict[str, str] = {}
        self._query_engines: dict[str, DuckDBDataFrameQuery] = {}
        self._store_lock = threading.Lock()
        # Memory limit enforcement
        self._total_memory_bytes: int = 0
        self._max_memory_bytes: int = int(os.getenv("NEURA_DF_MAX_MEMORY_MB", "8192")) * 1024 * 1024
        self._initialized = True
        _store_logger.info("DataFrameStore initialized (memory limit: %d MB)", self._max_memory_bytes // (1024 * 1024))

    def register_connection(
        self,
        connection_id: str,
        db_path: Path | None = None,
        db_type: str = "sqlite",
        connection_url: str | None = None,
    ) -> None:
        is_postgres = db_type in ("postgresql", "postgres")

        with self._store_lock:
            if is_postgres:
                existing_url = self._connection_urls.get(connection_id)
                if existing_url and existing_url == connection_url:
                    _store_logger.debug(f"Connection {connection_id} already registered (PostgreSQL)")
                    return
            else:
                db_path = Path(db_path).resolve()
                existing_path = self._db_paths.get(connection_id)
                if existing_path and existing_path == db_path:
                    loader = self._loaders.get(connection_id)
                    if loader and hasattr(loader, "_mtime"):
                        current_mtime = os.path.getmtime(db_path) if db_path.exists() else 0.0
                        if loader._mtime == current_mtime:
                            _store_logger.debug(f"Connection {connection_id} already registered and up to date")
                            return

            if is_postgres:
                _store_logger.info(f"Loading DataFrames for connection {connection_id} from PostgreSQL")
                loader = get_postgres_loader(connection_url)
            else:
                _store_logger.info(f"Loading DataFrames for connection {connection_id} from {db_path}")
                loader = get_loader(db_path)

            eager = eager_load_enabled()
            frames = loader.frames() if eager else {}

            # Memory limit enforcement
            new_bytes = _frames_memory_bytes(frames)
            old_bytes = _frames_memory_bytes(self._frames_cache.get(connection_id, {}))
            projected = self._total_memory_bytes - old_bytes + new_bytes
            if self._max_memory_bytes > 0 and projected > self._max_memory_bytes:
                raise MemoryError(
                    f"DataFrameStore memory limit exceeded: {projected / (1024*1024):.0f} MB "
                    f"> {self._max_memory_bytes / (1024*1024):.0f} MB. "
                    f"Increase NEURA_DF_MAX_MEMORY_MB or reduce dataset size."
                )

            existing_engine = self._query_engines.get(connection_id)
            if existing_engine:
                try:
                    existing_engine.close()
                except Exception:
                    pass

            self._loaders[connection_id] = loader
            self._frames_cache[connection_id] = frames if frames else {}
            self._db_types[connection_id] = db_type
            if is_postgres:
                self._connection_urls[connection_id] = connection_url
            else:
                self._db_paths[connection_id] = db_path
            self._query_engines[connection_id] = DuckDBDataFrameQuery(frames, loader=loader)
            self._total_memory_bytes = self._total_memory_bytes - old_bytes + new_bytes

            _store_logger.info(
                f"Loaded {len(frames)} tables for connection {connection_id}: {list(frames.keys())} "
                f"(memory: {new_bytes / (1024*1024):.1f} MB, total: {self._total_memory_bytes / (1024*1024):.1f} MB)"
                if frames else f"Registered connection {connection_id} for lazy DataFrame loading"
            )

        _max_conns = int(os.getenv("NEURA_MAX_STORE_CONNECTIONS", "10"))
        self.invalidate_lru_connections(max_connections=_max_conns)

    def get_loader(self, connection_id: str) -> SQLiteDataFrameLoader | None:
        with self._store_lock:
            return self._loaders.get(connection_id)

    def get_frames(self, connection_id: str) -> dict[str, pd.DataFrame]:
        with self._store_lock:
            return self._frames_cache.get(connection_id, {})

    def get_frame(self, connection_id: str, table_name: str) -> pd.DataFrame | None:
        frames = self.get_frames(connection_id)
        return frames.get(table_name)

    def get_query_engine(self, connection_id: str) -> DuckDBDataFrameQuery | None:
        with self._store_lock:
            return self._query_engines.get(connection_id)

    def execute_query(
        self,
        connection_id: str,
        sql: str,
        params: Any = None,
    ) -> pd.DataFrame:
        engine = self.get_query_engine(connection_id)
        if engine is None:
            raise ValueError(f"Connection {connection_id} not registered in DataFrameStore")
        return engine.execute(sql, params)

    def execute_query_to_dicts(
        self,
        connection_id: str,
        sql: str,
        params: Any = None,
    ) -> list[dict[str, Any]]:
        df = self.execute_query(connection_id, sql, params)
        return df.to_dict("records")

    def get_table_names(self, connection_id: str) -> list[str]:
        loader = self.get_loader(connection_id)
        if loader is None:
            return []
        return loader.table_names()

    def get_table_info(self, connection_id: str, table_name: str) -> list[dict[str, Any]]:
        loader = self.get_loader(connection_id)
        if loader is None:
            return []
        return loader.pragma_table_info(table_name)

    def get_foreign_keys(self, connection_id: str, table_name: str) -> list[dict[str, Any]]:
        loader = self.get_loader(connection_id)
        if loader is None:
            return []
        return loader.foreign_keys(table_name)

    def invalidate_connection(self, connection_id: str) -> None:
        with self._store_lock:
            freed_bytes = _frames_memory_bytes(self._frames_cache.get(connection_id, {}))
            engine = self._query_engines.pop(connection_id, None)
            if engine:
                try:
                    engine.close()
                except Exception:
                    pass
            self._loaders.pop(connection_id, None)
            self._frames_cache.pop(connection_id, None)
            self._db_paths.pop(connection_id, None)
            self._connection_urls.pop(connection_id, None)
            self._db_types.pop(connection_id, None)
            self._total_memory_bytes = max(0, self._total_memory_bytes - freed_bytes)
            _store_logger.info(f"Invalidated DataFrames for connection {connection_id} (freed {freed_bytes / (1024*1024):.1f} MB)")

    def is_registered(self, connection_id: str) -> bool:
        with self._store_lock:
            return connection_id in self._loaders

    def get_db_path(self, connection_id: str) -> Path | None:
        with self._store_lock:
            return self._db_paths.get(connection_id)

    def memory_status(self) -> dict[str, Any]:
        with self._store_lock:
            per_conn: dict[str, float] = {}
            total_mb = 0.0
            for conn_id, frames in self._frames_cache.items():
                conn_mb = 0.0
                for df in frames.values():
                    conn_mb += df.memory_usage(deep=True).sum() / (1024 * 1024)
                per_conn[conn_id] = round(conn_mb, 2)
                total_mb += conn_mb
            return {
                "total_memory_mb": round(total_mb, 2),
                "per_connection_mb": per_conn,
                "total_connections": len(self._loaders),
            }

    def invalidate_lru_connections(self, max_connections: int = 10) -> None:
        with self._store_lock:
            if len(self._loaders) <= max_connections:
                return
            conn_ids = list(self._loaders.keys())
            to_evict = conn_ids[: len(conn_ids) - max_connections]
        for conn_id in to_evict:
            self.invalidate_connection(conn_id)
            _store_logger.info(f"LRU evicted connection {conn_id}")

    def status(self) -> dict[str, Any]:
        with self._store_lock:
            return {
                "connections": list(self._loaders.keys()),
                "total_connections": len(self._loaders),
                "tables_per_connection": {
                    conn_id: len(frames)
                    for conn_id, frames in self._frames_cache.items()
                },
                "total_memory_bytes": self._total_memory_bytes,
                "total_memory_mb": round(self._total_memory_bytes / (1024 * 1024), 1),
                "max_memory_mb": round(self._max_memory_bytes / (1024 * 1024), 1),
                "memory_utilization_pct": round(
                    (self._total_memory_bytes / self._max_memory_bytes * 100)
                    if self._max_memory_bytes > 0 else 0.0, 1
                ),
            }

    def clear(self) -> None:
        with self._store_lock:
            for engine in self._query_engines.values():
                try:
                    engine.close()
                except Exception:
                    pass
            self._loaders.clear()
            self._frames_cache.clear()
            self._db_paths.clear()
            self._connection_urls.clear()
            self._db_types.clear()
            self._query_engines.clear()
            self._total_memory_bytes = 0
            _store_logger.info("DataFrameStore cleared")

# Singleton instance
dataframe_store = DataFrameStore()

def get_dataframe_store() -> DataFrameStore:
    return dataframe_store

def ensure_connection_loaded(
    connection_id: str,
    db_path: Path | None = None,
    db_type: str = "sqlite",
    connection_url: str | None = None,
) -> DataFrameStore:
    store = get_dataframe_store()
    if not store.is_registered(connection_id):
        store.register_connection(
            connection_id,
            db_path=db_path,
            db_type=db_type,
            connection_url=connection_url,
        )
    return store

__all__ = [
    "SQLiteDataFrameLoader",
    "DuckDBDataFrameQuery",
    "connect",
    "DataFrameConnection",
    "DataFrameCursor",
    "Row",
    "Error",
    "OperationalError",
    "Connection",
    "Cursor",
    "DataFrameStore",
    "dataframe_store",
    "get_dataframe_store",
    "ensure_connection_loaded",
    "get_loader",
    "eager_load_enabled",
    "PostgresDataFrameLoader",
    "get_postgres_loader",
    "verify_postgres",
]

import base64
import hashlib
import json
import logging
import os
import shutil
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Generator, Iterable, Mapping, Optional, Sequence

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import Column
from sqlalchemy.types import JSON
from sqlmodel import Field, Session, SQLModel, create_engine, select

from backend.app.utils import write_json_atomic
from backend.app.utils import normalize_job_status as _normalize_job_status

logger = logging.getLogger("neura.state.store")

# Configuration constants
STATE_VERSION = 2
MAX_BACKUP_COUNT = 5
MAX_ACTIVITY_LOG_SIZE = 500
MAX_RUN_HISTORY = max(int(os.getenv("NR_RUN_HISTORY_LIMIT", "200") or "200"), 25)


def _compute_checksum(data: dict) -> str:
    """Compute SHA256 checksum of state data."""
    content = json.dumps(data, sort_keys=True, default=str)
    return hashlib.sha256(content.encode()).hexdigest()[:16]

def _normalize_mapping_keys(values: Optional[Iterable[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        text = str(raw or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized

def _normalize_email_list(values: Optional[Iterable[str]]) -> list[str]:
    if not values:
        return []
    seen: set[str] = set()
    normalized: list[str] = []
    for raw in values:
        text = str(raw or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        normalized.append(text)
    return normalized

def _json_roundtrip(value: dict) -> dict:
    if not isinstance(value, dict):
        return {}
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return {}

class _StateSnapshot(SQLModel, table=True):
    __tablename__ = "state_snapshot"

    id: int = Field(default=1, primary_key=True)
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    version: int = Field(default=STATE_VERSION, index=True)
    checksum: str = Field(default="")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

class _StateBackup(SQLModel, table=True):
    __tablename__ = "state_backups"

    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), index=True)
    data: dict = Field(default_factory=dict, sa_column=Column(JSON))
    size_bytes: int = Field(default=0)

class StateStore:
    """
    File-backed store that keeps connection credentials (encrypted), template metadata,
    and the last-used selection for report generation.
    """

    _STATE_FILENAME = "state.json"
    _KEY_FILENAME = ".secret"

    def __init__(self, base_dir: Optional[Path] = None) -> None:
        base = Path(
            os.getenv("NEURA_STATE_DIR")
            or (base_dir if base_dir is not None else Path(__file__).resolve().parents[3] / "state")
        )
        base.mkdir(parents=True, exist_ok=True)
        self._base_dir = base
        self._state_path = self._base_dir / self._STATE_FILENAME
        self._key_path = self._base_dir / self._KEY_FILENAME
        self._fernet: Optional[Fernet] = None
        self._lock = threading.RLock()
        self._cache: Optional[dict] = None
        self._cache_mtime: float = 0.0
        self._cache_enabled = os.getenv("NEURA_STATE_CACHE_ENABLED", "true").lower() in {"1", "true", "yes"}
        self._backups_enabled = os.getenv("NEURA_STATE_BACKUPS_ENABLED", "true").lower() in {"1", "true", "yes"}
        self._backup_interval_seconds = max(
            int(os.getenv("NEURA_STATE_BACKUP_INTERVAL_SECONDS", "60") or "60"),
            0,
        )
        self._last_backup_at = 0.0

    # ------------------------------------------------------------------
    # key management / encryption helpers
    # ------------------------------------------------------------------
    def _normalize_key(self, raw: str) -> bytes:
        key_bytes = raw.encode("utf-8")
        try:
            # raw may already be a fernet key
            Fernet(key_bytes)
            return key_bytes
        except ValueError:
            digest = hashlib.sha256(key_bytes).digest()
            return base64.urlsafe_b64encode(digest)

    def _ensure_key(self) -> Fernet:
        if self._fernet is not None:
            return self._fernet

        key_env = os.getenv("NEURA_STATE_SECRET")
        if key_env:
            key = self._normalize_key(key_env)
        elif self._key_path.exists():
            key = self._key_path.read_text(encoding="utf-8").strip().encode("utf-8")
        else:
            key = Fernet.generate_key()
            self._key_path.write_text(key.decode("utf-8"), encoding="utf-8")
            try:
                os.chmod(self._key_path, 0o600)
            except OSError:
                pass

        self._fernet = Fernet(key)
        return self._fernet

    def _encrypt(self, payload: dict) -> str:
        token = self._ensure_key().encrypt(json.dumps(payload).encode("utf-8"))
        return token.decode("utf-8")

    def _decrypt(self, token: str) -> dict:
        if not token:
            return {}
        try:
            data = self._ensure_key().decrypt(token.encode("utf-8"))
            return json.loads(data.decode("utf-8"))
        except (InvalidToken, json.JSONDecodeError, ValueError):
            return {}

    # ------------------------------------------------------------------
    # state IO helpers
    # ------------------------------------------------------------------
    def _default_state(self) -> dict:
        return {
            "connections": {},
            "templates": {},
            "last_used": {},
            "schedules": {},
            "jobs": {},
            "saved_charts": {},
            "runs": {},
            "activity_log": [],
            "favorites": {"templates": [], "connections": [], "documents": [], "spreadsheets": [], "dashboards": []},
            "user_preferences": {},
            "notifications": [],
            # AI Features
            "saved_queries": {},
            "query_history": [],
            "enrichment_sources": {},
            "enrichment_cache": {},
            "virtual_schemas": {},
            "docqa_sessions": {},
            "synthesis_sessions": {},
            "summaries": {},
            # Phase 1-10 Features
            "documents": {},
            "spreadsheets": {},
            "dashboards": {},
            "dashboard_widgets": {},
            "connectors": {},
            "connector_credentials": {},  # Encrypted credentials
            "workflows": {},
            "workflow_executions": {},
            "brand_kits": {},
            "themes": {},
            "library": {"documents": {}, "collections": {}, "tags": {}},
            "export_jobs": {},
            "docai_results": {},
            # Job system enhancements (state-of-the-art patterns)
            "idempotency_keys": {},  # {key: {job_id, response, request_hash, created_at, expires_at}}
            "dead_letter_jobs": {},  # {job_id: {original_job, failure_history, moved_at}}
        }

    # All collections that MUST be dicts keyed by "id".
    # If any is stored as a list (legacy migration / corruption), it's auto-normalized.
    _DICT_KEYED_COLLECTIONS = (
        "connections", "templates", "schedules", "jobs", "saved_charts", "runs",
        "saved_queries", "enrichment_sources", "enrichment_cache",
        "virtual_schemas", "docqa_sessions", "synthesis_sessions", "summaries",
        "documents", "spreadsheets", "dashboards", "dashboard_widgets",
        "connectors", "connector_credentials", "workflows", "workflow_executions",
        "brand_kits", "themes", "export_jobs", "docai_results",
        "idempotency_keys", "dead_letter_jobs",
    )

    def _apply_defaults(self, state: dict) -> dict:
        # Dict-keyed collections: setdefault + normalize list→dict
        for key in self._DICT_KEYED_COLLECTIONS:
            state.setdefault(key, {})
            if isinstance(state.get(key), list):
                state[key] = {
                    item["id"]: item for item in state[key]
                    if isinstance(item, dict) and "id" in item
                }
        state.setdefault("last_used", {})
        # List-typed collections (order matters, not keyed by id)
        state.setdefault("activity_log", [])
        state.setdefault("notifications", [])
        state.setdefault("query_history", [])
        # Nested dict structures (not id-keyed)
        state.setdefault("favorites", {"templates": [], "connections": [], "documents": [], "spreadsheets": [], "dashboards": []})
        state.setdefault("user_preferences", {})
        state.setdefault("library", {"documents": {}, "collections": {}, "tags": {}})
        return state

    def _read_state(self) -> dict:
        if self._cache_enabled and self._cache is not None:
            if not self._state_path.exists():
                return self._cache
            try:
                mtime = self._state_path.stat().st_mtime
            except OSError:
                return self._cache
            if mtime == self._cache_mtime:
                return self._cache

        if not self._state_path.exists():
            state = self._default_state()
            if self._cache_enabled:
                self._cache = state
                self._cache_mtime = 0.0
            return state
        try:
            raw = json.loads(self._state_path.read_text(encoding="utf-8"))
        except Exception:
            state = self._default_state()
            if self._cache_enabled:
                self._cache = state
                self._cache_mtime = 0.0
            return state
        if not isinstance(raw, dict):
            state = self._default_state()
            if self._cache_enabled:
                self._cache = state
                self._cache_mtime = 0.0
            return state
        state = self._apply_defaults(raw)
        if self._cache_enabled:
            self._cache = state
            try:
                self._cache_mtime = self._state_path.stat().st_mtime
            except OSError:
                self._cache_mtime = time.time()
        return state

    def _write_state(self, state: dict) -> None:
        # Create backup before write
        self._create_backup()
        # Add metadata
        state["_metadata"] = {
            "version": STATE_VERSION,
            "updated_at": utc_now_iso(),
            "checksum": _compute_checksum(state),
        }
        write_json_atomic(self._state_path, state, ensure_ascii=False, indent=2, step="state_store")
        if self._cache_enabled:
            self._cache = state
            try:
                self._cache_mtime = self._state_path.stat().st_mtime
            except OSError:
                self._cache_mtime = time.time()

    def _create_backup(self) -> None:
        """Create a backup of the current state file."""
        if not self._backups_enabled or self._backup_interval_seconds <= 0:
            return
        if not self._state_path.exists():
            return

        now = time.time()
        if self._last_backup_at and (now - self._last_backup_at) < self._backup_interval_seconds:
            return

        backup_dir = self._base_dir / "backups"
        backup_dir.mkdir(exist_ok=True)

        # Create timestamped backup
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        backup_path = backup_dir / f"state_{timestamp}.json"

        try:
            shutil.copy2(self._state_path, backup_path)
            self._last_backup_at = now
        except Exception as e:
            logger.warning(f"Failed to create backup: {e}")

        # Clean up old backups
        self._cleanup_old_backups(backup_dir)

    def _cleanup_old_backups(self, backup_dir: Path) -> None:
        """Remove old backup files, keeping only MAX_BACKUP_COUNT."""
        try:
            backups = sorted(
                backup_dir.glob("state_*.json"),
                key=lambda p: p.stat().st_mtime,
                reverse=True
            )
            for old_backup in backups[MAX_BACKUP_COUNT:]:
                try:
                    old_backup.unlink()
                except Exception:
                    pass
        except Exception as e:
            logger.warning(f"Failed to cleanup old backups: {e}")

    def restore_from_backup(self, backup_name: Optional[str] = None) -> bool:
        """Restore state from a backup file."""
        backup_dir = self._base_dir / "backups"
        if not backup_dir.exists():
            return False

        with self._lock:
            try:
                if backup_name:
                    # Prevent path traversal
                    safe_name = Path(backup_name).name  # strips directory components
                    if safe_name != backup_name or '..' in backup_name:
                        raise ValueError("Invalid backup name")
                    backup_path = backup_dir / safe_name
                else:
                    backups = sorted(
                        backup_dir.glob("state_*.json"),
                        key=lambda p: p.stat().st_mtime,
                        reverse=True
                    )
                    if not backups:
                        return False
                    backup_path = backups[0]

                if not backup_path.exists():
                    return False

                backup_data = json.loads(backup_path.read_text(encoding="utf-8"))
                if not isinstance(backup_data, dict):
                    return False

                shutil.copy2(backup_path, self._state_path)
                logger.info(f"Restored state from backup: {backup_path.name}")
                return True

            except Exception as e:
                logger.error(f"Failed to restore from backup: {e}")
                return False

    def list_backups(self) -> list[dict]:
        """List available backup files."""
        backup_dir = self._base_dir / "backups"
        if not backup_dir.exists():
            return []

        backups = []
        for backup_path in backup_dir.glob("state_*.json"):
            try:
                stat = backup_path.stat()
                backups.append({
                    "name": backup_path.name,
                    "size_bytes": stat.st_size,
                    "created_at": datetime.fromtimestamp(
                        stat.st_mtime, tz=timezone.utc
                    ).isoformat(),
                })
            except Exception:
                pass

        return sorted(backups, key=lambda b: b["created_at"], reverse=True)

    @contextmanager
    def transaction(self) -> Generator[dict, None, None]:
        """Context manager for atomic state transactions."""
        with self._lock:
            state = self._read_state()
            try:
                yield state
                # Sanitize non-JSON-serializable values (datetime, set, etc.)
                # before writing.  Uses the existing _json_roundtrip helper
                # which applies default=str during serialization.
                sanitized = _json_roundtrip(state)
                if sanitized:
                    state.clear()
                    state.update(sanitized)
                self._write_state(state)
            except Exception as e:
                logger.error(f"Transaction failed: {e}")
                raise

    def validate_state(self) -> tuple[bool, list[str]]:
        """Validate state file integrity."""
        errors = []
        with self._lock:
            try:
                state = self._read_state()
            except Exception as e:
                return False, [f"Failed to read state: {e}"]

            required = ["connections", "templates", "schedules", "jobs"]
            for section in required:
                if section not in state:
                    errors.append(f"Missing section: {section}")

        return len(errors) == 0, errors

    def get_stats(self) -> dict:
        """Get state store statistics."""
        with self._lock:
            state = self._read_state()
            return {
                "connections_count": len(state.get("connections", {})),
                "templates_count": len(state.get("templates", {})),
                "schedules_count": len(state.get("schedules", {})),
                "jobs_count": len(state.get("jobs", {})),
                "backups_count": len(self.list_backups()),
                "state_file_exists": self._state_path.exists(),
            }

    # ------------------------------------------------------------------
    # connection helpers
    # ------------------------------------------------------------------
    def list_connections(self) -> list[dict]:
        with self._lock:
            state = self._read_state()
            return [self._sanitize_connection(rec) for rec in state["connections"].values()]

    def get_connection_record(self, conn_id: str) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            return state["connections"].get(conn_id)

    def get_latest_connection(self) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            if not state["connections"]:
                return None
            records = list(state["connections"].values())
            records.sort(key=lambda rec: rec.get("updated_at") or "", reverse=True)
            best = records[0]
            return {
                "id": best.get("id"),
                "database_path": best.get("database_path"),
                "name": best.get("name"),
                "db_type": best.get("db_type"),
            }

    def get_connection_secrets(self, conn_id: str) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            rec = state["connections"].get(conn_id)
            if not rec:
                return None
            secrets = self._decrypt(rec.get("secret") or "")
            fallback = {
                "database_path": rec.get("database_path"),
                "db_type": rec.get("db_type"),
                "name": rec.get("name"),
            }
            if not secrets:
                return fallback if fallback.get("database_path") else None
            secrets["database_path"] = rec.get("database_path")
            secrets["db_type"] = rec.get("db_type")
            secrets["name"] = rec.get("name")
            return secrets

    def upsert_connection(
        self,
        *,
        conn_id: Optional[str],
        name: str,
        db_type: str,
        database_path: str,
        secret_payload: Optional[dict],
        status: Optional[str] = None,
        latency_ms: Optional[float] = None,
        tags: Optional[Iterable[str]] = None,
    ) -> dict:
        conn_id = conn_id or str(uuid.uuid4())
        now = utc_now_iso()
        previous_path: Optional[str] = None
        new_path: Optional[str] = None
        with self._lock:
            state = self._read_state()
            record = state["connections"].get(conn_id, {})
            previous_path = record.get("database_path")
            created_at = record.get("created_at", now)
            # determine secret (reuse previous unless new payload supplied)
            if secret_payload is not None:
                secret_value = self._encrypt(secret_payload)
            else:
                secret_value = record.get("secret") or ""
            if database_path:
                db_path_value = str(database_path)
            else:
                db_path_value = str(record.get("database_path") or "")
            new_path = db_path_value
            record.update(
                {
                    "id": conn_id,
                    "name": name,
                    "db_type": db_type,
                    "database_path": db_path_value,
                    "secret": secret_value,
                    "updated_at": now,
                    "created_at": created_at,
                    "status": status or record.get("status") or "unknown",
                    "last_connected_at": record.get("last_connected_at"),
                    "last_latency_ms": record.get("last_latency_ms"),
                    "tags": sorted(set(tags or record.get("tags") or [])),
                }
            )
            state["connections"][conn_id] = record
            self._write_state(state)
            sanitized = self._sanitize_connection(record)
        if previous_path and new_path and str(previous_path) != str(new_path):
            try:

                dataframe_store.invalidate_connection(conn_id)
            except Exception:
                pass
        return sanitized

    def record_connection_ping(
        self,
        conn_id: str,
        *,
        status: str,
        detail: Optional[str],
        latency_ms: Optional[float],
    ) -> None:
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            record = state["connections"].get(conn_id)
            if not record:
                return
            record["status"] = status
            record["last_connected_at"] = now
            record["last_latency_ms"] = latency_ms
            record["last_detail"] = detail
            record["updated_at"] = now
            state["connections"][conn_id] = record
            self._write_state(state)

    def delete_connection(self, conn_id: str) -> bool:
        with self._lock:
            state = self._read_state()
            if conn_id not in state["connections"]:
                return False
            del state["connections"][conn_id]
            if state.get("last_used", {}).get("connection_id") == conn_id:
                state["last_used"]["connection_id"] = None
            schedules = state.get("schedules") or {}
            schedule_ids = [sid for sid, rec in schedules.items() if rec.get("connection_id") == conn_id]
            for sid in schedule_ids:
                schedules.pop(sid, None)
            state["schedules"] = schedules
            jobs = state.get("jobs") or {}
            job_ids = [jid for jid, rec in jobs.items() if rec.get("connection_id") == conn_id]
            for jid in job_ids:
                jobs.pop(jid, None)
            state["jobs"] = jobs
            runs = state.get("runs") or {}
            run_ids = [rid for rid, rec in runs.items() if rec.get("connection_id") == conn_id]
            for rid in run_ids:
                runs.pop(rid, None)
            state["runs"] = runs
            self._write_state(state)
        try:

            dataframe_store.invalidate_connection(conn_id)
        except Exception:
            pass
        return True

    def _sanitize_connection(self, rec: Dict[str, Any]) -> dict:
        return {
            "id": rec.get("id"),
            "name": rec.get("name"),
            "db_type": rec.get("db_type"),
            "status": rec.get("status") or "unknown",
            "lastConnected": rec.get("last_connected_at"),
            "lastLatencyMs": rec.get("last_latency_ms"),
            "hasCredentials": bool(rec.get("secret")),
            "summary": self._summarize_path(rec.get("database_path")),
            "tags": list(rec.get("tags") or []),
            "createdAt": rec.get("created_at"),
            "updatedAt": rec.get("updated_at"),
            "details": rec.get("last_detail"),
        }

    def _summarize_path(self, path: Optional[str]) -> Optional[str]:
        if not path:
            return None
        try:
            p = Path(path)
            if p.name:
                return p.name
            return str(p)
        except Exception:
            return path

    # ------------------------------------------------------------------
    # template helpers
    # ------------------------------------------------------------------
    def list_templates(self) -> list[dict]:
        with self._lock:
            state = self._read_state()
            return [self._sanitize_template(rec) for rec in state["templates"].values()]

    def get_template_record(self, template_id: str) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            return state["templates"].get(template_id)

    def upsert_template(
        self,
        template_id: str,
        *,
        name: str,
        status: str,
        artifacts: Optional[dict] = None,
        tags: Optional[Iterable[str]] = None,
        connection_id: Optional[str] = None,
        mapping_keys: Optional[Iterable[str]] = None,
        template_type: Optional[str] = None,
        description: Optional[str] = None,
    ) -> dict:
        tid = template_id
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            record = state["templates"].get(tid, {})
            created_at = record.get("created_at", now)
            existing_artifacts = record.get("artifacts") or {}
            merged_artifacts = {**existing_artifacts, **(artifacts or {})}
            kind = template_type or record.get("kind") or "pdf"
            record.update(
                {
                    "id": tid,
                    "name": name,
                    "status": status,
                    "description": description if description is not None else record.get("description"),
                    "artifacts": {k: v for k, v in merged_artifacts.items() if v},
                    "updated_at": now,
                    "created_at": created_at,
                    "tags": sorted(set(tags or record.get("tags") or [])),
                    "last_connection_id": connection_id or record.get("last_connection_id"),
                    "kind": kind,
                }
            )
            if mapping_keys is not None:
                record["mapping_keys"] = _normalize_mapping_keys(mapping_keys)
            elif "mapping_keys" not in record:
                record["mapping_keys"] = []
            state["templates"][tid] = record
            self._write_state(state)
            return self._sanitize_template(record)

    def record_template_run(self, template_id: str, connection_id: Optional[str]) -> None:
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            record = state["templates"].get(template_id)
            if not record:
                return
            record["last_run_at"] = now
            if connection_id:
                record["last_connection_id"] = connection_id
            record["updated_at"] = now
            state["templates"][template_id] = record
            self._write_state(state)

    def delete_template(self, template_id: str) -> bool:
        with self._lock:
            state = self._read_state()
            removed = state["templates"].pop(template_id, None)
            if removed is None:
                return False
            last_used = state.get("last_used") or {}
            if last_used.get("template_id") == template_id:
                last_used["template_id"] = None
                last_used["updated_at"] = utc_now_iso()
                state["last_used"] = last_used
            saved_charts = state.get("saved_charts") or {}
            drop_ids = [sid for sid, rec in saved_charts.items() if rec.get("template_id") == template_id]
            for sid in drop_ids:
                saved_charts.pop(sid, None)
            schedules = state.get("schedules") or {}
            schedule_ids = [sid for sid, rec in schedules.items() if rec.get("template_id") == template_id]
            for sid in schedule_ids:
                schedules.pop(sid, None)
            state["schedules"] = schedules
            jobs = state.get("jobs") or {}
            job_ids = [jid for jid, rec in jobs.items() if rec.get("template_id") == template_id]
            for jid in job_ids:
                jobs.pop(jid, None)
            state["jobs"] = jobs
            runs = state.get("runs") or {}
            run_ids = [rid for rid, rec in runs.items() if rec.get("template_id") == template_id]
            for rid in run_ids:
                runs.pop(rid, None)
            state["runs"] = runs
            self._write_state(state)
            return True

    def update_template_generator(
        self,
        template_id: str,
        *,
        dialect: Optional[str] = None,
        params: Optional[Mapping[str, Any]] = None,
        invalid: Optional[bool] = None,
        needs_user_fix: Optional[Iterable[Any]] = None,
        summary: Optional[Mapping[str, Any]] = None,
        dry_run: Optional[Any] = None,
        cached: Optional[bool] = None,
    ) -> Optional[dict]:
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            record = state["templates"].get(template_id)
            if not record:
                return None
            generator = dict(record.get("generator") or {})
            if dialect is not None:
                generator["dialect"] = dialect
            if params is not None:
                generator["params"] = dict(params)
            if invalid is not None:
                generator["invalid"] = bool(invalid)
            if needs_user_fix is not None:
                cleaned = []
                for item in needs_user_fix:
                    text = str(item).strip()
                    if text:
                        cleaned.append(text)
                generator["needs_user_fix"] = cleaned
            if summary is not None:
                generator["summary"] = dict(summary)
            if dry_run is not None:
                generator["dry_run"] = dry_run
            if cached is not None:
                generator["cached"] = bool(cached)
            generator["updated_at"] = now
            record["generator"] = generator
            record["updated_at"] = now
            state["templates"][template_id] = record
            self._write_state(state)
            return self._sanitize_template(record)

    def _sanitize_template(self, rec: Dict[str, Any]) -> dict:
        artifacts = rec.get("artifacts") or {}
        mapping_keys = rec.get("mapping_keys") or []
        generator_raw = rec.get("generator") or {}
        generator_meta: Optional[dict] = None
        if generator_raw:
            generator_meta = {
                "dialect": generator_raw.get("dialect"),
                "invalid": generator_raw.get("invalid"),
                "needsUserFix": list(generator_raw.get("needs_user_fix") or []),
                "params": generator_raw.get("params"),
                "summary": generator_raw.get("summary"),
                "dryRun": generator_raw.get("dry_run"),
                "cached": generator_raw.get("cached"),
                "updatedAt": generator_raw.get("updated_at"),
            }
            if generator_meta["needsUserFix"] is None:
                generator_meta["needsUserFix"] = []
            generator_meta = {
                key: value
                for key, value in generator_meta.items()
                if value is not None or key in {"invalid", "needsUserFix"}
            }
        return {
            "id": rec.get("id"),
            "name": rec.get("name"),
            "description": rec.get("description"),
            "status": rec.get("status"),
            "kind": rec.get("kind") or "pdf",
            "tags": list(rec.get("tags") or []),
            "createdAt": rec.get("created_at"),
            "updatedAt": rec.get("updated_at"),
            "lastRunAt": rec.get("last_run_at"),
            "lastConnectionId": rec.get("last_connection_id"),
            "mappingKeys": list(mapping_keys),
            "artifacts": {k: v for k, v in artifacts.items() if v},
            "generator": generator_meta,
        }

    def _sanitize_saved_chart(self, rec: Optional[dict]) -> Optional[dict]:
        if not rec:
            return None
        spec = rec.get("spec") or {}
        sanitized_spec = json.loads(json.dumps(spec))
        return {
            "id": rec.get("id"),
            "template_id": rec.get("template_id"),
            "name": rec.get("name"),
            "spec": sanitized_spec,
            "created_at": rec.get("created_at"),
            "updated_at": rec.get("updated_at"),
        }

    def list_saved_charts(self, template_id: str) -> list[dict]:
        with self._lock:
            state = self._read_state()
            charts = [
                self._sanitize_saved_chart(rec)
                for rec in state.get("saved_charts", {}).values()
                if rec and rec.get("template_id") == template_id
            ]
            return [rec for rec in charts if rec]

    def get_saved_chart(self, chart_id: str) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            rec = (state.get("saved_charts") or {}).get(chart_id)
            return self._sanitize_saved_chart(rec)

    def create_saved_chart(self, template_id: str, name: str, spec: Mapping[str, Any]) -> dict:
        now = utc_now_iso()
        chart_id = str(uuid.uuid4())
        spec_payload = json.loads(json.dumps(spec))
        with self._lock:
            state = self._read_state()
            record = {
                "id": chart_id,
                "template_id": template_id,
                "name": name,
                "spec": spec_payload,
                "created_at": now,
                "updated_at": now,
            }
            state.setdefault("saved_charts", {})
            state["saved_charts"][chart_id] = record
            self._write_state(state)
            return self._sanitize_saved_chart(record)

    def update_saved_chart(
        self,
        chart_id: str,
        *,
        name: Optional[str] = None,
        spec: Optional[Mapping[str, Any]] = None,
    ) -> Optional[dict]:
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            record = (state.get("saved_charts") or {}).get(chart_id)
            if not record:
                return None
            if name is not None:
                record["name"] = name
            if spec is not None:
                record["spec"] = json.loads(json.dumps(spec))
            record["updated_at"] = now
            state["saved_charts"][chart_id] = record
            self._write_state(state)
            return self._sanitize_saved_chart(record)

    def delete_saved_chart(self, chart_id: str) -> bool:
        with self._lock:
            state = self._read_state()
            saved = state.get("saved_charts") or {}
            removed = saved.pop(chart_id, None)
            if not removed:
                return False
            self._write_state(state)
            return True

    def _sanitize_schedule(self, rec: Optional[dict]) -> Optional[dict]:
        if not rec:
            return None
        sanitized = dict(rec)
        sanitized["email_recipients"] = _normalize_email_list(rec.get("email_recipients"))
        sanitized["email_subject"] = rec.get("email_subject")
        sanitized["email_message"] = rec.get("email_message")
        key_values = rec.get("key_values")
        sanitized["key_values"] = dict(key_values or {})
        batches = rec.get("batch_ids")
        if isinstance(batches, (list, tuple)):
            sanitized["batch_ids"] = [str(b) for b in batches if str(b).strip()]
        else:
            sanitized["batch_ids"] = []
        sanitized["last_run_artifacts"] = dict(rec.get("last_run_artifacts") or {})
        return sanitized

    def list_schedules(self) -> list[dict]:
        with self._lock:
            state = self._read_state()
            return [self._sanitize_schedule(rec) for rec in state["schedules"].values() if rec]

    def get_schedule(self, schedule_id: str) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            rec = state["schedules"].get(schedule_id)
            return self._sanitize_schedule(rec)

    def create_schedule(
        self,
        *,
        name: Optional[str],
        template_id: str,
        template_name: str,
        template_kind: str,
        connection_id: Optional[str],
        connection_name: Optional[str],
        start_date: str,
        end_date: str,
        key_values: Optional[Mapping[str, Any]],
        batch_ids: Optional[Iterable[str]],
        docx: bool,
        xlsx: bool,
        email_recipients: Optional[Iterable[str]],
        email_subject: Optional[str],
        email_message: Optional[str],
        frequency: str,
        interval_minutes: int,
        run_time: Optional[str] = None,
        next_run_at: str,
        first_run_at: str,
        active: bool = True,
    ) -> dict:
        schedule_id = str(uuid.uuid4())
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            record = {
                "id": schedule_id,
                "name": (name or "").strip() or template_name,
                "template_id": template_id,
                "template_name": template_name,
                "template_kind": template_kind,
                "connection_id": connection_id,
                "connection_name": connection_name,
                "start_date": start_date,
                "end_date": end_date,
                "key_values": dict(key_values or {}),
                "batch_ids": [str(b) for b in (batch_ids or []) if str(b).strip()],
                "docx": bool(docx),
                "xlsx": bool(xlsx),
                "email_recipients": _normalize_email_list(email_recipients),
                "email_subject": (email_subject or "").strip() or None,
                "email_message": (email_message or "").strip() or None,
                "frequency": frequency,
                "interval_minutes": max(int(interval_minutes or 0), 1),
                "run_time": (run_time or "").strip() or None,
                "next_run_at": next_run_at,
                "first_run_at": first_run_at,
                "last_run_at": None,
                "last_run_status": None,
                "last_run_error": None,
                "last_run_artifacts": {},
                "active": bool(active),
                "created_at": now,
                "updated_at": now,
            }
            state["schedules"][schedule_id] = record
            self._write_state(state)
            return self._sanitize_schedule(record)

    def delete_schedule(self, schedule_id: str) -> bool:
        with self._lock:
            state = self._read_state()
            removed = state["schedules"].pop(schedule_id, None)
            if not removed:
                return False
            self._write_state(state)
            return True

    def update_schedule(self, schedule_id: str, **changes: Any) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            record = state["schedules"].get(schedule_id)
            if not record:
                return None
            for key, value in changes.items():
                if key == "email_recipients":
                    record[key] = _normalize_email_list(value)
                elif key in {"email_subject", "email_message"}:
                    record[key] = (value or "").strip() or None
                elif key == "key_values":
                    record[key] = dict(value or {})
                elif key == "batch_ids":
                    record[key] = [str(b) for b in (value or []) if str(b).strip()]
                else:
                    record[key] = value
            record["updated_at"] = utc_now_iso()
            state["schedules"][schedule_id] = record
            self._write_state(state)
            return self._sanitize_schedule(record)

    def record_schedule_run(
        self,
        schedule_id: str,
        *,
        started_at: str,
        finished_at: str,
        status: str,
        next_run_at: Optional[str],
        artifacts: Optional[Mapping[str, Any]] = None,
        error: Optional[str] = None,
    ) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            record = state["schedules"].get(schedule_id)
            if not record:
                return None
            record["last_run_at"] = finished_at
            record["last_run_status"] = status
            record["last_run_error"] = error
            record["last_run_artifacts"] = dict(artifacts or {})
            if next_run_at:
                record["next_run_at"] = next_run_at
            record["updated_at"] = utc_now_iso()
            state["schedules"][schedule_id] = record
            self._write_state(state)
            return self._sanitize_schedule(record)

    # ------------------------------------------------------------------
    # report run history helpers
    # ------------------------------------------------------------------
    def _sanitize_report_run(self, rec: Optional[dict]) -> Optional[dict]:
        if not rec:
            return None
        return {
            "id": rec.get("id"),
            "templateId": rec.get("template_id"),
            "templateName": rec.get("template_name"),
            "templateKind": rec.get("template_kind") or "pdf",
            "connectionId": rec.get("connection_id"),
            "connectionName": rec.get("connection_name"),
            "startDate": rec.get("start_date"),
            "endDate": rec.get("end_date"),
            "batchIds": list(rec.get("batch_ids") or []),
            "keyValues": dict(rec.get("key_values") or {}),
            "status": rec.get("status") or "succeeded",
            "artifacts": dict(rec.get("artifacts") or {}),
            "scheduleId": rec.get("schedule_id"),
            "scheduleName": rec.get("schedule_name"),
            "createdAt": rec.get("created_at"),
            "completedAt": rec.get("completed_at") or rec.get("created_at"),
        }

    def record_report_run(
        self,
        run_id: str,
        *,
        template_id: str,
        template_name: Optional[str],
        template_kind: str,
        connection_id: Optional[str],
        connection_name: Optional[str],
        start_date: str,
        end_date: str,
        batch_ids: Optional[Iterable[str]],
        key_values: Optional[Mapping[str, Any]],
        status: str,
        artifacts: Optional[Mapping[str, Any]] = None,
        schedule_id: Optional[str] = None,
        schedule_name: Optional[str] = None,
        created_at: Optional[str] = None,
    ) -> Optional[dict]:
        if not run_id or not template_id:
            return None
        now = utc_now_iso()
        record = {
            "id": run_id,
            "template_id": template_id,
            "template_name": template_name or template_id,
            "template_kind": template_kind or "pdf",
            "connection_id": connection_id,
            "connection_name": connection_name,
            "start_date": start_date,
            "end_date": end_date,
            "batch_ids": [str(b) for b in (batch_ids or []) if str(b).strip()],
            "key_values": dict(key_values or {}),
            "status": status or "succeeded",
            "artifacts": dict(artifacts or {}),
            "schedule_id": schedule_id,
            "schedule_name": schedule_name,
            "created_at": created_at or now,
            "completed_at": now,
        }
        with self._lock:
            state = self._read_state()
            runs = state.get("runs") or {}
            runs[run_id] = record
            if len(runs) > MAX_RUN_HISTORY:
                ordered = sorted(runs.values(), key=lambda item: item.get("created_at") or "", reverse=True)
                keep_ids = {item.get("id") for item in ordered[:MAX_RUN_HISTORY] if item.get("id")}
                runs = {rid: rec for rid, rec in runs.items() if rid in keep_ids}
            state["runs"] = runs
            self._write_state(state)
            return self._sanitize_report_run(record)

    def list_report_runs(
        self,
        *,
        template_id: Optional[str] = None,
        connection_id: Optional[str] = None,
        schedule_id: Optional[str] = None,
        limit: int = 50,
    ) -> list[dict]:
        with self._lock:
            state = self._read_state()
            runs = list((state.get("runs") or {}).values())
            runs.sort(key=lambda rec: rec.get("created_at") or "", reverse=True)
            filtered: list[dict] = []
            for rec in runs:
                if template_id and rec.get("template_id") != template_id:
                    continue
                if connection_id and rec.get("connection_id") != connection_id:
                    continue
                if schedule_id and rec.get("schedule_id") != schedule_id:
                    continue
                sanitized = self._sanitize_report_run(rec)
                if sanitized:
                    filtered.append(sanitized)
                if limit and len(filtered) >= limit:
                    break
            return filtered

    def get_report_run(self, run_id: str) -> Optional[dict]:
        if not run_id:
            return None
        with self._lock:
            state = self._read_state()
            rec = (state.get("runs") or {}).get(run_id)
            return self._sanitize_report_run(rec)

    def update_report_run_artifacts(self, run_id: str, artifacts_patch: dict) -> Optional[dict]:
        """Merge new artifact keys into an existing run record."""
        if not run_id or not artifacts_patch:
            return None
        with self._lock:
            state = self._read_state()
            runs = state.get("runs") or {}
            rec = runs.get(run_id)
            if not rec:
                return None
            existing = dict(rec.get("artifacts") or {})
            existing.update(artifacts_patch)
            rec["artifacts"] = existing
            runs[run_id] = rec
            state["runs"] = runs
            self._write_state(state)
            return self._sanitize_report_run(rec)

    # ------------------------------------------------------------------
    # last-used helpers
    # ------------------------------------------------------------------
    # Jobs helpers
    # ------------------------------------------------------------------
    def _sanitize_job_step(self, step: Optional[dict]) -> Optional[dict]:
        if not step:
            return None
        return {
            "id": step.get("id"),
            "name": step.get("name"),
            "label": step.get("label") or step.get("name"),
            "status": _normalize_job_status(step.get("status")),
            "progress": step.get("progress"),
            "createdAt": step.get("created_at"),
            "startedAt": step.get("started_at"),
            "finishedAt": step.get("finished_at"),
            "error": step.get("error"),
        }

    def _sanitize_job(self, rec: Optional[dict]) -> Optional[dict]:
        if not rec:
            return None
        steps_raw = rec.get("steps") or []
        steps: list[dict] = []
        for step in steps_raw:
            sanitized = self._sanitize_job_step(step)
            if sanitized:
                steps.append(sanitized)
        return {
            "id": rec.get("id"),
            "type": rec.get("type") or "run_report",
            "status": _normalize_job_status(rec.get("status")),
            "templateId": rec.get("template_id"),
            "templateName": rec.get("template_name"),
            "templateKind": rec.get("template_kind") or "pdf",
            "connectionId": rec.get("connection_id"),
            "scheduleId": rec.get("schedule_id"),
            "correlationId": rec.get("correlation_id"),
            "progress": rec.get("progress") or 0,
            "error": rec.get("error"),
            "result": dict(rec.get("result") or {}),
            "createdAt": rec.get("created_at"),
            "queuedAt": rec.get("queued_at"),
            "startedAt": rec.get("started_at"),
            "finishedAt": rec.get("finished_at"),
            "updatedAt": rec.get("updated_at"),
            "steps": steps,
            # Retry and recovery fields
            "retryCount": rec.get("retry_count") or 0,
            "maxRetries": rec.get("max_retries") or 3,
            "retryAt": rec.get("retry_at"),
            "failureReason": rec.get("failure_reason"),
            "lastHeartbeatAt": rec.get("last_heartbeat_at"),
            "workerId": rec.get("worker_id"),
            # Webhook fields
            "webhookUrl": rec.get("webhook_url"),
            "notificationSentAt": rec.get("notification_sent_at"),
        }

    def create_job(
        self,
        *,
        job_type: str,
        template_id: Optional[str] = None,
        connection_id: Optional[str] = None,
        template_name: Optional[str] = None,
        template_kind: Optional[str] = None,
        schedule_id: Optional[str] = None,
        correlation_id: Optional[str] = None,
        steps: Optional[Iterable[Mapping[str, Any]]] = None,
        meta: Optional[Mapping[str, Any]] = None,
        # New retry configuration parameters
        max_retries: Optional[int] = None,
        retry_backoff_seconds: Optional[int] = None,
        # New webhook parameters
        webhook_url: Optional[str] = None,
        webhook_secret: Optional[str] = None,
        # Priority (for future queue ordering)
        priority: int = 0,
    ) -> dict:
        job_id = str(uuid.uuid4())
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            templates = state.get("templates") or {}
            tpl_record = templates.get(template_id) or {}
            tpl_name = template_name or tpl_record.get("name") or template_id
            tpl_kind = template_kind or tpl_record.get("kind") or "pdf"
            step_records: list[dict] = []
            for raw in steps or []:
                name_raw = raw.get("name") if isinstance(raw, Mapping) else None
                name = str(name_raw or "").strip()
                if not name:
                    continue
                step_id = str(raw.get("id") or uuid.uuid4())
                label_raw = raw.get("label") if isinstance(raw, Mapping) else None
                label = str(label_raw or "").strip() or name
                status_raw = raw.get("status") if isinstance(raw, Mapping) else None
                status = (str(status_raw or "") or "queued").strip().lower() or "queued"
                progress_raw = raw.get("progress") if isinstance(raw, Mapping) else None
                try:
                    progress_val = float(progress_raw)
                except (TypeError, ValueError):
                    progress_val = 0.0
                step_records.append(
                    {
                        "id": step_id,
                        "name": name,
                        "label": label,
                        "status": status,
                        "progress": max(0.0, min(progress_val, 100.0)),
                        "created_at": now,
                        "started_at": None,
                        "finished_at": None,
                        "error": None,
                    }
                )
            jobs = state.get("jobs") or {}
            record = {
                "id": job_id,
                "type": str(job_type or "run_report"),
                "template_id": template_id,
                "template_name": tpl_name,
                "template_kind": tpl_kind,
                "connection_id": connection_id,
                "schedule_id": schedule_id,
                "correlation_id": correlation_id,
                "status": "queued",
                "progress": 0.0,
                "error": None,
                "result": {},
                "steps": step_records,
                "created_at": now,
                "queued_at": now,
                "started_at": None,
                "finished_at": None,
                "updated_at": now,
                "meta": dict(meta or {}),
                # Retry configuration
                "retry_count": 0,
                "max_retries": max_retries if max_retries is not None else self.DEFAULT_MAX_RETRIES,
                "retry_backoff_seconds": retry_backoff_seconds if retry_backoff_seconds is not None else self.DEFAULT_RETRY_BACKOFF_SECONDS,
                "retry_at": None,
                "failure_reason": None,
                # Heartbeat tracking
                "last_heartbeat_at": None,
                "worker_id": None,
                # Webhook configuration
                "webhook_url": webhook_url,
                "webhook_secret": webhook_secret,
                "notification_sent_at": None,
                # Priority
                "priority": max(-10, min(10, priority)),
            }
            jobs[job_id] = record
            state["jobs"] = jobs
            self._write_state(state)
            sanitized = self._sanitize_job(record)
            assert sanitized is not None
            return sanitized

    def list_jobs(
        self,
        *,
        statuses: Optional[Iterable[str]] = None,
        types: Optional[Iterable[str]] = None,
        limit: int = 50,
        active_only: bool = False,
    ) -> list[dict]:
        with self._lock:
            state = self._read_state()
            jobs = list((state.get("jobs") or {}).values())
            # newest first
            jobs.sort(key=lambda rec: rec.get("created_at") or "", reverse=True)
            status_filter = {str(s).strip().lower() for s in (statuses or []) if str(s).strip()}
            type_filter = {str(t).strip() for t in (types or []) if str(t).strip()}
            out: list[dict] = []
            for rec in jobs:
                status_raw = rec.get("status") or ""
                status_norm = str(status_raw).strip().lower()
                if active_only and status_norm in {"succeeded", "failed", "cancelled"}:
                    continue
                if status_filter and status_norm not in status_filter:
                    continue
                type_raw = rec.get("type") or ""
                if type_filter and str(type_raw) not in type_filter:
                    continue
                sanitized = self._sanitize_job(rec)
                if sanitized:
                    out.append(sanitized)
                if limit and len(out) >= limit:
                    break
            return out

    def get_job(self, job_id: str) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            rec = (state.get("jobs") or {}).get(job_id)
            return self._sanitize_job(rec)

    def get_job_meta(self, job_id: str) -> dict:
        with self._lock:
            state = self._read_state()
            rec = (state.get("jobs") or {}).get(job_id) or {}
            meta = rec.get("meta") or {}
            return dict(meta)

    def _update_job_record(self, job_id: str, mutator) -> Optional[dict]:
        with self._lock:
            state = self._read_state()
            jobs = state.get("jobs") or {}
            record = jobs.get(job_id)
            if not record:
                return None
            changed = mutator(record)
            if not changed:
                # still touch updated_at for visibility
                record["updated_at"] = utc_now_iso()
            jobs[job_id] = record
            state["jobs"] = jobs
            self._write_state(state)
            return self._sanitize_job(record)

    def record_job_start(self, job_id: str) -> Optional[dict]:
        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            updated = False
            if not rec.get("started_at"):
                rec["started_at"] = now
                updated = True
            if rec.get("status") != "running":
                rec["status"] = "running"
                updated = True
            if rec.get("progress") is None:
                rec["progress"] = 0.0
            rec["updated_at"] = now
            return updated

        return self._update_job_record(job_id, mutator)

    def record_job_progress(self, job_id: str, progress: float) -> Optional[dict]:
        try:
            value = float(progress)
        except (TypeError, ValueError):
            value = 0.0
        clamped = max(0.0, min(value, 100.0))

        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            prev = rec.get("progress")
            if prev is not None and float(prev) == clamped:
                rec["updated_at"] = now
                return False
            rec["progress"] = clamped
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def record_job_completion(
        self,
        job_id: str,
        *,
        status: str,
        error: Optional[str] = None,
        result: Optional[Mapping[str, Any]] = None,
    ) -> Optional[dict]:
        status_norm = (status or "").strip().lower()
        if status_norm not in {"succeeded", "failed", "cancelled"}:
            status_norm = "failed"

        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            current_status = str(rec.get("status") or "").strip().lower()
            if current_status == "cancelled" and status_norm != "cancelled":
                rec["updated_at"] = now
                return False
            changed = False
            if rec.get("status") != status_norm:
                rec["status"] = status_norm
                changed = True
            if not rec.get("finished_at"):
                rec["finished_at"] = now
                changed = True
            if status_norm == "succeeded" and (rec.get("progress") or 0) < 100:
                rec["progress"] = 100.0
                changed = True
            if error is not None:
                rec["error"] = str(error)
                changed = True
            if result is not None:
                rec["result"] = dict(result)
                changed = True
            rec["updated_at"] = now
            return changed

        return self._update_job_record(job_id, mutator)

    def record_job_step(
        self,
        job_id: str,
        name: str,
        *,
        status: Optional[str] = None,
        error: Optional[str] = None,
        progress: Optional[float] = None,
        label: Optional[str] = None,
    ) -> Optional[dict]:
        step_name = (name or "").strip()
        if not step_name:
            return None
        status_norm = (status or "").strip().lower() if status is not None else None

        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            steps = list(rec.get("steps") or [])
            target = None
            for step in steps:
                if step.get("name") == step_name:
                    target = step
                    break
            if target is None:
                target = {
                    "id": str(uuid.uuid4()),
                    "name": step_name,
                    "label": label or step_name,
                    "status": status_norm or "queued",
                    "progress": 0.0,
                    "created_at": now,
                    "started_at": None,
                    "finished_at": None,
                    "error": None,
                }
                steps.append(target)
            else:
                if label is not None:
                    target["label"] = label
                if status_norm is not None:
                    previous_status = str(target.get("status") or "").strip().lower()
                    target["status"] = status_norm
                    if status_norm == "running" and not target.get("started_at"):
                        target["started_at"] = now
                    if status_norm in {"succeeded", "failed", "cancelled"} and not target.get(
                        "finished_at"
                    ):
                        target["finished_at"] = now
                if error is not None:
                    target["error"] = str(error)
                if progress is not None:
                    try:
                        value = float(progress)
                    except (TypeError, ValueError):
                        value = 0.0
                    target["progress"] = max(0.0, min(value, 100.0))
            rec["steps"] = steps
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def cancel_job(self, job_id: str) -> Optional[dict]:
        return self.record_job_completion(job_id, status="cancelled", error="Cancelled by user", result=None)

    def update_job(self, job_id: str, **updates: Any) -> Optional[dict]:
        """Apply arbitrary field updates to a job record."""
        if not updates:
            return self.get_job(job_id)

        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            for key, value in updates.items():
                rec[key] = value
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def delete_job(self, job_id: str) -> bool:
        """Permanently remove a job record. Returns True if deleted."""
        with self._lock:
            state = self._read_state()
            jobs = state.get("jobs") or {}
            if job_id not in jobs:
                return False
            del jobs[job_id]
            state["jobs"] = jobs
            self._write_state(state)
            return True

    # ------------------------------------------------------------------
    # Job retry and recovery helpers
    # ------------------------------------------------------------------
    DEFAULT_MAX_RETRIES = 3
    DEFAULT_RETRY_BACKOFF_SECONDS = 30
    DEFAULT_HEARTBEAT_TIMEOUT_SECONDS = 120

    def update_job_heartbeat(self, job_id: str, worker_id: Optional[str] = None) -> Optional[dict]:
        """Update the job's heartbeat timestamp to indicate worker is alive."""
        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            rec["last_heartbeat_at"] = now
            if worker_id:
                rec["worker_id"] = worker_id
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def mark_job_for_retry(
        self,
        job_id: str,
        *,
        reason: str,
        retry_at: Optional[str] = None,
        is_retriable: bool = True,
    ) -> Optional[dict]:
        """
        Mark a failed job for retry. Calculates backoff if retry_at not provided.
        Sets status to 'pending_retry' if retriable and under max retries.
        """
        import random

        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            retry_count = int(rec.get("retry_count") or 0)
            max_retries = int(rec.get("max_retries") or self.DEFAULT_MAX_RETRIES)

            # Check if we can retry
            if not is_retriable or retry_count >= max_retries:
                rec["status"] = "failed"
                rec["error"] = f"{reason} (max retries exceeded)" if retry_count >= max_retries else reason
                rec["finished_at"] = now
                rec["updated_at"] = now
                return True

            # Calculate retry time with exponential backoff + jitter
            base_backoff = int(rec.get("retry_backoff_seconds") or self.DEFAULT_RETRY_BACKOFF_SECONDS)
            backoff = base_backoff * (2 ** retry_count)  # 30s, 60s, 120s, 240s
            jitter = random.uniform(0, backoff * 0.2)    # ±20% jitter
            delay = backoff + jitter

            if retry_at:
                computed_retry_at = retry_at
            else:
                retry_time = datetime.now(timezone.utc) + timedelta(seconds=delay)
                computed_retry_at = retry_time.isoformat()

            rec["status"] = "pending_retry"
            rec["retry_count"] = retry_count + 1
            rec["retry_at"] = computed_retry_at
            rec["failure_reason"] = reason
            rec["started_at"] = None  # Reset for next attempt
            rec["last_heartbeat_at"] = None
            rec["worker_id"] = None
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def find_stale_running_jobs(
        self,
        heartbeat_timeout_seconds: Optional[int] = None,
    ) -> list[dict]:
        """
        Find jobs in 'running' state whose heartbeat has expired.
        These are likely orphaned due to worker crash.
        """
        timeout = heartbeat_timeout_seconds or self.DEFAULT_HEARTBEAT_TIMEOUT_SECONDS
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=timeout)
        cutoff_iso = cutoff.isoformat()

        with self._lock:
            state = self._read_state()
            jobs = state.get("jobs") or {}
            stale: list[dict] = []

            for job in jobs.values():
                status = str(job.get("status") or "").strip().lower()
                if status != "running":
                    continue

                # Check heartbeat
                heartbeat = job.get("last_heartbeat_at")
                if heartbeat is None:
                    # No heartbeat ever recorded - check started_at
                    started = job.get("started_at")
                    if started and started < cutoff_iso:
                        stale.append(dict(job))
                elif heartbeat < cutoff_iso:
                    stale.append(dict(job))

            return stale

    def find_jobs_ready_for_retry(self) -> list[dict]:
        """
        Find jobs in 'pending_retry' state whose retry_at time has passed.
        These are ready to be re-queued.
        """
        now_iso = utc_now_iso()

        with self._lock:
            state = self._read_state()
            jobs = state.get("jobs") or {}
            ready: list[dict] = []

            for job in jobs.values():
                status = str(job.get("status") or "").strip().lower()
                if status != "pending_retry":
                    continue

                retry_at = job.get("retry_at")
                if retry_at and retry_at <= now_iso:
                    ready.append(dict(job))

            return ready

    def requeue_job_for_retry(self, job_id: str) -> Optional[dict]:
        """
        Move a job from 'pending_retry' back to 'queued' state.
        Called when retry_at time has passed.
        """
        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            status = str(rec.get("status") or "").strip().lower()
            if status != "pending_retry":
                return False

            rec["status"] = "queued"
            rec["queued_at"] = now
            rec["retry_at"] = None
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def update_job_webhook(
        self,
        job_id: str,
        *,
        webhook_url: Optional[str] = None,
        webhook_secret: Optional[str] = None,
    ) -> Optional[dict]:
        """Update job's webhook configuration."""
        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            if webhook_url is not None:
                rec["webhook_url"] = webhook_url
            if webhook_secret is not None:
                rec["webhook_secret"] = webhook_secret
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def mark_webhook_sent(self, job_id: str) -> Optional[dict]:
        """Mark that webhook notification was sent for this job."""
        def mutator(rec: dict) -> bool:
            now = utc_now_iso()
            rec["notification_sent_at"] = now
            rec["updated_at"] = now
            return True

        return self._update_job_record(job_id, mutator)

    def get_jobs_pending_webhook(self) -> list[dict]:
        """
        Find completed jobs that have a webhook_url but no notification_sent_at.
        These need webhook delivery.
        """
        with self._lock:
            state = self._read_state()
            jobs = state.get("jobs") or {}
            pending: list[dict] = []

            for job in jobs.values():
                status = str(job.get("status") or "").strip().lower()
                if status not in {"succeeded", "failed", "cancelled"}:
                    continue

                webhook_url = job.get("webhook_url")
                if not webhook_url:
                    continue

                if job.get("notification_sent_at"):
                    continue

                pending.append(dict(job))

            return pending

    # ------------------------------------------------------------------
    # Idempotency key management (state-of-the-art pattern)
    # ------------------------------------------------------------------
    IDEMPOTENCY_KEY_TTL_HOURS = 24

    def check_idempotency_key(
        self,
        key: str,
        request_hash: str,
    ) -> tuple[bool, Optional[dict]]:
        """Check if an idempotency key exists and is valid."""
        if not key:
            return False, None

        with self._lock:
            state = self._read_state()
            keys = state.get("idempotency_keys") or {}
            record = keys.get(key)

            if not record:
                return False, None

            # Check if expired
            expires_at = record.get("expires_at")
            if expires_at:
                try:
                    exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    if exp_dt < datetime.now(timezone.utc):
                        # Expired, remove it
                        del keys[key]
                        state["idempotency_keys"] = keys
                        self._write_state(state)
                        return False, None
                except (ValueError, TypeError):
                    pass

            # Check hash match
            stored_hash = record.get("request_hash")
            if stored_hash != request_hash:
                # Hash mismatch - key reused for different request
                return True, None

            return True, record.get("response")

    def store_idempotency_key(
        self,
        key: str,
        job_id: str,
        request_hash: str,
        response: dict,
    ) -> dict:
        """
        Store an idempotency key with its cached response.
        Keys expire after IDEMPOTENCY_KEY_TTL_HOURS hours.
        """
        now = datetime.now(timezone.utc)
        expires_at = now + timedelta(hours=self.IDEMPOTENCY_KEY_TTL_HOURS)

        record = {
            "key": key,
            "job_id": job_id,
            "request_hash": request_hash,
            "response": response,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
        }

        with self._lock:
            state = self._read_state()
            keys = state.get("idempotency_keys") or {}
            keys[key] = record
            state["idempotency_keys"] = keys
            self._write_state(state)
            return record

    def clean_expired_idempotency_keys(self) -> int:
        """Remove expired idempotency keys."""
        now = datetime.now(timezone.utc)
        removed = 0

        with self._lock:
            state = self._read_state()
            keys = state.get("idempotency_keys") or {}

            for key_id in list(keys.keys()):
                record = keys[key_id]
                expires_at = record.get("expires_at")
                if not expires_at:
                    continue
                try:
                    exp_dt = datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
                    if exp_dt < now:
                        del keys[key_id]
                        removed += 1
                except (ValueError, TypeError):
                    pass

            if removed > 0:
                state["idempotency_keys"] = keys
                self._write_state(state)

        return removed

    # ------------------------------------------------------------------
    # Dead Letter Queue management (state-of-the-art pattern)
    # ------------------------------------------------------------------
    def move_job_to_dlq(
        self,
        job_id: str,
        failure_history: Optional[list[dict]] = None,
    ) -> Optional[dict]:
        """Move a permanently failed job to the Dead Letter Queue."""
        now = utc_now_iso()

        with self._lock:
            state = self._read_state()
            jobs = state.get("jobs") or {}
            dlq = state.get("dead_letter_jobs") or {}

            job = jobs.get(job_id)
            if not job:
                return None

            # Build failure history if not provided
            if failure_history is None:
                failure_history = [{
                    "attempt": job.get("retry_count", 0),
                    "error": job.get("error") or "Unknown error",
                    "timestamp": now,
                    "category": "unknown",
                }]

            dlq_record = {
                "id": job_id,
                "original_job": dict(job),
                "failure_history": failure_history,
                "moved_at": now,
                "requeued_at": None,
                "requeue_count": 0,
            }

            dlq[job_id] = dlq_record

            # Update original job to mark it as moved to DLQ
            job["dead_letter_at"] = now
            job["status"] = "failed"
            jobs[job_id] = job

            state["jobs"] = jobs
            state["dead_letter_jobs"] = dlq
            self._write_state(state)

            return dlq_record

    def list_dead_letter_jobs(self, limit: int = 50) -> list[dict]:
        """List jobs in the Dead Letter Queue, newest first."""
        with self._lock:
            state = self._read_state()
            dlq = list((state.get("dead_letter_jobs") or {}).values())
            dlq.sort(key=lambda r: r.get("moved_at") or "", reverse=True)
            return dlq[:limit]

    def get_dead_letter_job(self, job_id: str) -> Optional[dict]:
        """Get a specific DLQ job by ID."""
        with self._lock:
            state = self._read_state()
            return (state.get("dead_letter_jobs") or {}).get(job_id)

    def requeue_from_dlq(self, job_id: str) -> Optional[dict]:
        """Requeue a job from the Dead Letter Queue."""
        now = utc_now_iso()

        with self._lock:
            state = self._read_state()
            dlq = state.get("dead_letter_jobs") or {}

            dlq_record = dlq.get(job_id)
            if not dlq_record:
                return None

            original_job = dlq_record.get("original_job") or {}

            # Create new job from original
            new_job_id = str(uuid.uuid4())
            new_job = dict(original_job)
            new_job["id"] = new_job_id
            new_job["status"] = "queued"
            new_job["progress"] = 0.0
            new_job["error"] = None
            new_job["result"] = {}
            new_job["created_at"] = now
            new_job["queued_at"] = now
            new_job["started_at"] = None
            new_job["finished_at"] = None
            new_job["updated_at"] = now
            new_job["retry_count"] = 0
            new_job["retry_at"] = None
            new_job["failure_reason"] = None
            new_job["last_heartbeat_at"] = None
            new_job["worker_id"] = None
            new_job["dead_letter_at"] = None
            new_job["meta"] = dict(original_job.get("meta") or {})
            new_job["meta"]["requeued_from_dlq"] = job_id
            new_job["meta"]["dlq_requeue_count"] = dlq_record.get("requeue_count", 0) + 1

            # Reset steps
            for step in new_job.get("steps") or []:
                step["status"] = "queued"
                step["progress"] = 0.0
                step["started_at"] = None
                step["finished_at"] = None
                step["error"] = None

            # Update DLQ record
            dlq_record["requeued_at"] = now
            dlq_record["requeue_count"] = dlq_record.get("requeue_count", 0) + 1

            # Save changes
            jobs = state.get("jobs") or {}
            jobs[new_job_id] = new_job
            state["jobs"] = jobs
            dlq[job_id] = dlq_record
            state["dead_letter_jobs"] = dlq
            self._write_state(state)

            return self._sanitize_job(new_job)

    def delete_from_dlq(self, job_id: str) -> bool:
        """Permanently delete a job from the Dead Letter Queue."""
        with self._lock:
            state = self._read_state()
            dlq = state.get("dead_letter_jobs") or {}

            if job_id not in dlq:
                return False

            del dlq[job_id]
            state["dead_letter_jobs"] = dlq
            self._write_state(state)
            return True

    def get_dlq_stats(self) -> dict:
        """Get statistics about the Dead Letter Queue."""
        with self._lock:
            state = self._read_state()
            dlq = state.get("dead_letter_jobs") or {}

            total = len(dlq)
            requeued = sum(1 for r in dlq.values() if r.get("requeued_at"))

            return {
                "total": total,
                "pending": total - requeued,
                "requeued": requeued,
            }

    # ------------------------------------------------------------------
    # last-used helpers
    # ------------------------------------------------------------------
    def get_last_used(self) -> dict:
        with self._lock:
            state = self._read_state()
            data = state.get("last_used") or {}
            return {
                "connection_id": data.get("connection_id"),
                "template_id": data.get("template_id"),
                "updated_at": data.get("updated_at"),
            }

    def set_last_used(self, connection_id: Optional[str], template_id: Optional[str]) -> dict:
        now = utc_now_iso()
        with self._lock:
            state = self._read_state()
            state["last_used"] = {
                "connection_id": connection_id,
                "template_id": template_id,
                "updated_at": now,
            }
            self._write_state(state)
            return state["last_used"]

    # ------------------------------------------------------------------
    # activity log helpers
    # ------------------------------------------------------------------
    def log_activity(
        self,
        *,
        action: str,
        entity_type: str,
        entity_id: Optional[str] = None,
        entity_name: Optional[str] = None,
        details: Optional[Dict[str, Any]] = None,
        user_id: Optional[str] = None,
    ) -> dict:
        """Log an activity event."""
        now = utc_now_iso()
        activity_id = str(uuid.uuid4())
        entry = {
            "id": activity_id,
            "action": action,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "entity_name": entity_name,
            "details": dict(details or {}),
            "user_id": user_id,
            "timestamp": now,
        }
        with self._lock:
            state = self._read_state()
            log = state.get("activity_log") or []
            log.insert(0, entry)
            # Keep only last 500 entries
            if len(log) > 500:
                log = log[:500]
            state["activity_log"] = log
            self._write_state(state)
            return entry

    def get_activity_log(
        self,
        *,
        limit: int = 50,
        offset: int = 0,
        entity_type: Optional[str] = None,
        action: Optional[str] = None,
    ) -> list[dict]:
        """Get activity log with optional filtering."""
        with self._lock:
            state = self._read_state()
            log = state.get("activity_log") or []

            # Filter
            if entity_type:
                log = [e for e in log if e.get("entity_type") == entity_type]
            if action:
                log = [e for e in log if e.get("action") == action]

            # Paginate
            return log[offset : offset + limit]

    def clear_activity_log(self) -> int:
        """Clear all activity log entries. Returns count of entries cleared."""
        with self._lock:
            state = self._read_state()
            count = len(state.get("activity_log") or [])
            state["activity_log"] = []
            self._write_state(state)
            return count

    # ------------------------------------------------------------------
    # favorites helpers
    # ------------------------------------------------------------------
    def get_favorites(self) -> dict:
        """Get all favorites."""
        with self._lock:
            state = self._read_state()
            favorites = state.get("favorites") or {"templates": [], "connections": []}
            return {
                "templates": list(favorites.get("templates") or []),
                "connections": list(favorites.get("connections") or []),
            }

    def add_favorite(self, entity_type: str, entity_id: str) -> bool:
        """Add an item to favorites. Returns True if added, False if already exists."""
        with self._lock:
            state = self._read_state()
            favorites = state.get("favorites") or {}
            items = list(favorites.get(entity_type) or [])
            if entity_id in items:
                return False
            items.append(entity_id)
            favorites[entity_type] = items
            state["favorites"] = favorites
            self._write_state(state)
            return True

    def remove_favorite(self, entity_type: str, entity_id: str) -> bool:
        """Remove an item from favorites. Returns True if removed, False if not found."""
        with self._lock:
            state = self._read_state()
            favorites = state.get("favorites") or {}
            items = list(favorites.get(entity_type) or [])
            if entity_id not in items:
                return False
            items.remove(entity_id)
            favorites[entity_type] = items
            state["favorites"] = favorites
            self._write_state(state)
            return True

    def is_favorite(self, entity_type: str, entity_id: str) -> bool:
        """Check if an item is a favorite."""
        with self._lock:
            state = self._read_state()
            favorites = state.get("favorites") or {}
            items = favorites.get(entity_type) or []
            return entity_id in items

    # ------------------------------------------------------------------
    # user preferences helpers
    # ------------------------------------------------------------------
    def get_user_preferences(self) -> dict:
        """Get user preferences."""
        with self._lock:
            state = self._read_state()
            return dict(state.get("user_preferences") or {})

    def set_user_preference(self, key: str, value: Any) -> dict:
        """Set a single user preference."""
        with self._lock:
            state = self._read_state()
            prefs = dict(state.get("user_preferences") or {})
            prefs[key] = value
            prefs["updated_at"] = utc_now_iso()
            state["user_preferences"] = prefs
            self._write_state(state)
            return prefs

    def update_user_preferences(self, updates: Dict[str, Any]) -> dict:
        """Update multiple user preferences."""
        with self._lock:
            state = self._read_state()
            prefs = dict(state.get("user_preferences") or {})
            prefs.update(updates)
            prefs["updated_at"] = utc_now_iso()
            state["user_preferences"] = prefs
            self._write_state(state)
            return prefs

    # ------------------------------------------------------------------
    # notifications helpers
    # ------------------------------------------------------------------
    MAX_NOTIFICATIONS = 100

    def add_notification(
        self,
        title: str,
        message: str,
        notification_type: str = "info",
        link: Optional[str] = None,
        entity_type: Optional[str] = None,
        entity_id: Optional[str] = None,
    ) -> dict:
        """Add a notification. Returns the created notification."""
        notif = {
            "id": str(uuid.uuid4()),
            "title": title,
            "message": message,
            "type": notification_type,  # info, success, warning, error
            "link": link,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "read": False,
            "created_at": utc_now_iso(),
        }
        with self._lock:
            state = self._read_state()
            notifications = list(state.get("notifications") or [])
            notifications.insert(0, notif)
            # Trim to max size
            state["notifications"] = notifications[: self.MAX_NOTIFICATIONS]
            self._write_state(state)
        return notif

    def get_notifications(
        self,
        limit: int = 50,
        unread_only: bool = False,
    ) -> list:
        """Get notifications, optionally filtered to unread only."""
        with self._lock:
            state = self._read_state()
            notifications = list(state.get("notifications") or [])
            if unread_only:
                notifications = [n for n in notifications if not n.get("read")]
            return notifications[:limit]

    def mark_notification_read(self, notification_id: str) -> bool:
        """Mark a single notification as read. Returns True if found."""
        with self._lock:
            state = self._read_state()
            notifications = list(state.get("notifications") or [])
            found = False
            for n in notifications:
                if n.get("id") == notification_id:
                    n["read"] = True
                    found = True
                    break
            if found:
                state["notifications"] = notifications
                self._write_state(state)
            return found

    def mark_all_notifications_read(self) -> int:
        """Mark all notifications as read. Returns count of notifications marked."""
        with self._lock:
            state = self._read_state()
            notifications = list(state.get("notifications") or [])
            count = 0
            for n in notifications:
                if not n.get("read"):
                    n["read"] = True
                    count += 1
            state["notifications"] = notifications
            self._write_state(state)
            return count

    def delete_notification(self, notification_id: str) -> bool:
        """Delete a notification. Returns True if found and deleted."""
        with self._lock:
            state = self._read_state()
            notifications = list(state.get("notifications") or [])
            original_count = len(notifications)
            notifications = [n for n in notifications if n.get("id") != notification_id]
            if len(notifications) < original_count:
                state["notifications"] = notifications
                self._write_state(state)
                return True
            return False

    def clear_notifications(self) -> int:
        """Clear all notifications. Returns count of notifications cleared."""
        with self._lock:
            state = self._read_state()
            count = len(state.get("notifications") or [])
            state["notifications"] = []
            self._write_state(state)
            return count

    def get_unread_count(self) -> int:
        """Get count of unread notifications."""
        with self._lock:
            state = self._read_state()
            notifications = list(state.get("notifications") or [])
            return sum(1 for n in notifications if not n.get("read"))

    # ------------------------------------------------------------------
    # NL2SQL: Saved Queries
    # ------------------------------------------------------------------
    def save_query(self, query: dict) -> str:
        """Save a query. Returns the query ID."""
        with self._lock:
            state = self._read_state()
            query_id = query.get("id") or str(uuid.uuid4())[:8]
            query["id"] = query_id
            state.setdefault("saved_queries", {})[query_id] = query
            self._write_state(state)
            return query_id

    def list_saved_queries(self) -> list[dict]:
        """List all saved queries."""
        with self._lock:
            state = self._read_state()
            queries = list((state.get("saved_queries") or {}).values())
            return sorted(queries, key=lambda q: q.get("created_at", ""), reverse=True)

    def get_saved_query(self, query_id: str) -> Optional[dict]:
        """Get a saved query by ID."""
        with self._lock:
            state = self._read_state()
            return (state.get("saved_queries") or {}).get(query_id)

    def update_saved_query(self, query_id: str, updates: dict) -> Optional[dict]:
        """Update a saved query."""
        with self._lock:
            state = self._read_state()
            queries = state.get("saved_queries") or {}
            if query_id not in queries:
                return None
            queries[query_id].update(updates)
            queries[query_id]["updated_at"] = utc_now_iso()
            self._write_state(state)
            return queries[query_id]

    def delete_saved_query(self, query_id: str) -> bool:
        """Delete a saved query. Returns True if deleted."""
        with self._lock:
            state = self._read_state()
            queries = state.get("saved_queries") or {}
            if query_id not in queries:
                return False
            del queries[query_id]
            self._write_state(state)
            return True

    def increment_query_run_count(self, query_id: str) -> None:
        """Increment the run count for a saved query."""
        with self._lock:
            state = self._read_state()
            queries = state.get("saved_queries") or {}
            if query_id in queries:
                queries[query_id]["run_count"] = queries[query_id].get("run_count", 0) + 1
                queries[query_id]["last_run_at"] = utc_now_iso()
                self._write_state(state)

    # ------------------------------------------------------------------
    # NL2SQL: Query History
    # ------------------------------------------------------------------
    MAX_QUERY_HISTORY = 200

    def add_query_history(self, entry: dict) -> None:
        """Add an entry to query history."""
        with self._lock:
            state = self._read_state()
            history = list(state.get("query_history") or [])
            history.insert(0, entry)
            # Trim to max size
            state["query_history"] = history[: self.MAX_QUERY_HISTORY]
            self._write_state(state)

    def get_query_history(self, limit: int = 50) -> list[dict]:
        """Get query history entries."""
        with self._lock:
            state = self._read_state()
            history = list(state.get("query_history") or [])
            return history[:limit]

    def clear_query_history(self) -> int:
        """Clear all query history. Returns count cleared."""
        with self._lock:
            state = self._read_state()
            count = len(state.get("query_history") or [])
            state["query_history"] = []
            self._write_state(state)
            return count

    def delete_query_history_entry(self, entry_id: str) -> bool:
        """Delete a single query history entry by ID."""
        if not entry_id:
            return False
        with self._lock:
            state = self._read_state()
            history = list(state.get("query_history") or [])
            if not history:
                return False
            filtered = [h for h in history if h.get("id") != entry_id]
            if len(filtered) == len(history):
                return False
            state["query_history"] = filtered
            self._write_state(state)
            return True

class SQLiteStateStore(StateStore):
    """SQLite-backed state store with JSON persistence and schema versioning."""

    def __init__(self, base_dir: Optional[Path] = None, db_path: Optional[Path] = None) -> None:
        super().__init__(base_dir=base_dir)
        db_override = db_path or os.getenv("NEURA_STATE_DB_PATH")
        if db_override:
            self._db_path = Path(db_override).expanduser()
        else:
            self._db_path = self._base_dir / "state.sqlite3"
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._engine = create_engine(
            f"sqlite:///{self._db_path}",
            connect_args={"check_same_thread": False},
        )
        self._ensure_schema()

    def _ensure_schema(self) -> None:
        SQLModel.metadata.create_all(self._engine)
        with Session(self._engine) as session:
            snapshot = session.get(_StateSnapshot, 1)
            if snapshot is not None:
                return
            state = self._load_initial_state()
            meta = {
                "version": STATE_VERSION,
                "updated_at": utc_now_iso(),
                "checksum": _compute_checksum(state),
            }
            state["_metadata"] = meta
            snapshot = _StateSnapshot(
                id=1,
                data=_json_roundtrip(state),
                version=STATE_VERSION,
                checksum=meta["checksum"],
                updated_at=datetime.now(timezone.utc),
            )
            session.add(snapshot)
            session.commit()

            if self._state_path.exists():
                migrated_path = self._state_path.with_name(self._state_path.name + ".migrated")
                try:
                    if not migrated_path.exists():
                        self._state_path.replace(migrated_path)
                except Exception:
                    pass

    def _load_initial_state(self) -> dict:
        if self._state_path.exists():
            try:
                raw = json.loads(self._state_path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    return self._apply_defaults(raw)
            except Exception:
                pass
        return self._default_state()

    def _snapshot_mtime(self) -> Optional[float]:
        try:
            with Session(self._engine) as session:
                stmt = select(_StateSnapshot.updated_at).where(_StateSnapshot.id == 1)
                updated_at = session.exec(stmt).first()
                if updated_at is None:
                    return None
                return updated_at.timestamp()
        except Exception:
            return None

    def _read_state(self) -> dict:
        if self._cache_enabled and self._cache is not None:
            latest = self._snapshot_mtime()
            if latest is None or latest == self._cache_mtime:
                return self._cache

        with Session(self._engine) as session:
            snapshot = session.get(_StateSnapshot, 1)
            if snapshot is None:
                state = self._default_state()
            else:
                state = snapshot.data if isinstance(snapshot.data, dict) else {}

        state = self._apply_defaults(state)
        if self._cache_enabled:
            self._cache = state
            self._cache_mtime = self._snapshot_mtime() or time.time()
        return state

    def _write_state(self, state: dict) -> None:
        self._create_backup()
        meta = {
            "version": STATE_VERSION,
            "updated_at": utc_now_iso(),
            "checksum": _compute_checksum(state),
        }
        state["_metadata"] = meta
        sanitized = _json_roundtrip(state)
        now = datetime.now(timezone.utc)
        with Session(self._engine) as session:
            with session.begin():
                snapshot = session.get(_StateSnapshot, 1)
                if snapshot is None:
                    snapshot = _StateSnapshot(
                        id=1,
                        data=sanitized,
                        version=STATE_VERSION,
                        checksum=meta["checksum"],
                        updated_at=now,
                    )
                    session.add(snapshot)
                else:
                    snapshot.data = sanitized
                    snapshot.version = STATE_VERSION
                    snapshot.checksum = meta["checksum"]
                    snapshot.updated_at = now

        if self._cache_enabled:
            self._cache = state
            self._cache_mtime = now.timestamp()

    def _create_backup(self) -> None:
        if not self._backups_enabled or self._backup_interval_seconds <= 0:
            return

        now = time.time()
        if self._last_backup_at and (now - self._last_backup_at) < self._backup_interval_seconds:
            return

        with Session(self._engine) as session:
            snapshot = session.get(_StateSnapshot, 1)
            if snapshot is None:
                return
            backup_state = snapshot.data if isinstance(snapshot.data, dict) else {}
            backup_state = _json_roundtrip(backup_state)
            created_at = datetime.now(timezone.utc)
            name = f"state_{created_at.strftime('%Y%m%d_%H%M%S')}"
            size_bytes = len(json.dumps(backup_state, sort_keys=True, default=str).encode("utf-8"))
            backup = _StateBackup(
                name=name,
                created_at=created_at,
                data=backup_state,
                size_bytes=size_bytes,
            )
            session.add(backup)
            session.commit()
            self._last_backup_at = now

            backups = session.exec(
                select(_StateBackup).order_by(_StateBackup.created_at.desc())
            ).all()
            for old_backup in backups[MAX_BACKUP_COUNT:]:
                session.delete(old_backup)
            session.commit()

    def list_backups(self) -> list[dict]:
        with Session(self._engine) as session:
            backups = session.exec(
                select(_StateBackup).order_by(_StateBackup.created_at.desc())
            ).all()
        results = []
        for backup in backups:
            results.append(
                {
                    "name": backup.name,
                    "size_bytes": backup.size_bytes,
                    "created_at": backup.created_at.astimezone(timezone.utc).isoformat(),
                }
            )
        return results

    def restore_from_backup(self, backup_name: Optional[str] = None) -> bool:
        with Session(self._engine) as session:
            if backup_name:
                stmt = select(_StateBackup).where(_StateBackup.name == backup_name)
            else:
                stmt = select(_StateBackup).order_by(_StateBackup.created_at.desc())
            backup = session.exec(stmt).first()
            if backup is None:
                return False
            state = backup.data if isinstance(backup.data, dict) else {}
            meta = {
                "version": STATE_VERSION,
                "updated_at": utc_now_iso(),
                "checksum": _compute_checksum(state),
            }
            state["_metadata"] = meta
            sanitized = _json_roundtrip(state)
            snapshot = session.get(_StateSnapshot, 1)
            if snapshot is None:
                snapshot = _StateSnapshot(
                    id=1,
                    data=sanitized,
                    version=STATE_VERSION,
                    checksum=meta["checksum"],
                    updated_at=datetime.now(timezone.utc),
                )
                session.add(snapshot)
            else:
                snapshot.data = sanitized
                snapshot.version = STATE_VERSION
                snapshot.checksum = meta["checksum"]
                snapshot.updated_at = datetime.now(timezone.utc)
            session.commit()
            if self._cache_enabled:
                self._cache = state
                self._cache_mtime = snapshot.updated_at.timestamp()
            return True

    def get_stats(self) -> dict:
        with self._lock:
            state = self._read_state()
            return {
                "connections_count": len(state.get("connections", {})),
                "templates_count": len(state.get("templates", {})),
                "schedules_count": len(state.get("schedules", {})),
                "jobs_count": len(state.get("jobs", {})),
                "backups_count": len(self.list_backups()),
                "state_file_exists": self._db_path.exists(),
            }

def _build_state_store() -> StateStore:
    backend = os.getenv("NEURA_STATE_BACKEND", "sqlite").strip().lower()
    if backend not in {"sqlite", "file"}:
        logger.warning("state_backend_unknown", extra={"backend": backend})
        backend = "sqlite"
    if backend == "file":
        store = StateStore()
        setattr(store, "backend_name", "file")
        return store
    try:
        store = SQLiteStateStore()
        setattr(store, "backend_name", "sqlite")
        return store
    except Exception as exc:
        logger.error("state_store_sqlite_failed", extra={"error": str(exc)})
        store = StateStore()
        setattr(store, "backend_name", "file")
        setattr(store, "backend_fallback", True)
        return store

class StateStoreProxy:
    def __init__(self, store: StateStore) -> None:
        self._store = store

    def set(self, store: StateStore) -> None:
        self._store = store

    def get(self) -> StateStore:
        return self._store

    def __getattr__(self, name: str) -> Any:  # noqa: ANN401 - proxy
        return getattr(self._store, name)

state_store = StateStoreProxy(_build_state_store())

def set_state_store(store: StateStore) -> None:
    """Swap the underlying global state store (primarily for tests)."""
    state_store.set(store)

# ── sqlite_shim namespace (for legacy imports) ──
import types as _types
sqlite_shim = _types.SimpleNamespace(
    OperationalError=OperationalError,
    Error=Error,
    Row=Row,
    Connection=Connection,
    eager_load_enabled=eager_load_enabled,
)
