"""Initial schema: agent tasks, events, users, vector embeddings.

Revision ID: 001_initial
Revises:
Create Date: 2026-02-15

Creates the foundational database tables for NeuraReport:
- agent_tasks: Persistent AI agent task queue
- agent_task_events: Audit trail for task state changes
- auth_users: User authentication (managed by fastapi-users)
- document_embeddings: Vector storage for RAG (pgvector)
- user_roles: RBAC role assignments
- mfa_credentials: MFA/TOTP secrets and recovery codes
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.types import JSON

# revision identifiers, used by Alembic
revision = "001_initial"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # --- Agent Tasks ---
    op.create_table(
        "agent_tasks",
        sa.Column("task_id", sa.String(32), primary_key=True),
        sa.Column("agent_type", sa.String(30), nullable=False, index=True),
        sa.Column("status", sa.String(20), nullable=False, server_default="pending", index=True),
        sa.Column("input_params", JSON, nullable=False, server_default="{}"),
        sa.Column("result", JSON, nullable=True),
        sa.Column("error_message", sa.String(2000), nullable=True),
        sa.Column("error_code", sa.String(50), nullable=True),
        sa.Column("is_retryable", sa.Boolean, nullable=False, server_default=sa.text("1")),
        sa.Column("idempotency_key", sa.String(64), nullable=True, index=True),
        sa.Column("user_id", sa.String(64), nullable=True, index=True),
        sa.Column("progress_percent", sa.Integer, nullable=False, server_default="0"),
        sa.Column("progress_message", sa.String(500), nullable=True),
        sa.Column("current_step", sa.String(100), nullable=True),
        sa.Column("total_steps", sa.Integer, nullable=True),
        sa.Column("current_step_num", sa.Integer, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True, index=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True, index=True),
        sa.Column("attempt_count", sa.Integer, nullable=False, server_default="0"),
        sa.Column("max_attempts", sa.Integer, nullable=False, server_default="3"),
        sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(2000), nullable=True),
        sa.Column("tokens_input", sa.Integer, nullable=False, server_default="0"),
        sa.Column("tokens_output", sa.Integer, nullable=False, server_default="0"),
        sa.Column("estimated_cost_cents", sa.Integer, nullable=False, server_default="0"),
        sa.Column("priority", sa.Integer, nullable=False, server_default="0", index=True),
        sa.Column("webhook_url", sa.String(2000), nullable=True),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
    )

    # --- Agent Task Events ---
    op.create_table(
        "agent_task_events",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("task_id", sa.String(32), sa.ForeignKey("agent_tasks.task_id"), nullable=False, index=True),
        sa.Column("event_type", sa.String(50), nullable=False, index=True),
        sa.Column("event_data", JSON, nullable=True),
        sa.Column("previous_status", sa.String(20), nullable=True),
        sa.Column("new_status", sa.String(20), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now(), index=True),
    )

    # --- User Roles (RBAC) ---
    op.create_table(
        "user_roles",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(64), nullable=False, index=True),
        sa.Column("role", sa.String(30), nullable=False),
        sa.Column("assigned_by", sa.String(64), nullable=True),
        sa.Column("assigned_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("user_id", "role", name="uq_user_role"),
    )

    # --- MFA Credentials ---
    op.create_table(
        "mfa_credentials",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(64), nullable=False, unique=True, index=True),
        sa.Column("totp_secret_encrypted", sa.Text, nullable=False),
        sa.Column("is_enabled", sa.Boolean, nullable=False, server_default=sa.text("0")),
        sa.Column("recovery_codes_hash", JSON, nullable=True),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # --- Document Embeddings (for RAG / vector search) ---
    op.create_table(
        "document_embeddings",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("document_id", sa.String(64), nullable=False, index=True),
        sa.Column("chunk_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("text_content", sa.Text, nullable=False),
        sa.Column("embedding", JSON, nullable=True),  # Stored as JSON array; use pgvector in PostgreSQL
        sa.Column("model", sa.String(100), nullable=True),
        sa.Column("metadata", JSON, nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("document_id", "chunk_index", name="uq_doc_chunk"),
    )

    # --- Composite indexes for performance ---
    op.create_index(
        "idx_events_task_time",
        "agent_task_events",
        ["task_id", sa.text("created_at DESC")],
    )


def downgrade() -> None:
    op.drop_index("idx_events_task_time", table_name="agent_task_events")
    op.drop_table("document_embeddings")
    op.drop_table("mfa_credentials")
    op.drop_table("user_roles")
    op.drop_table("agent_task_events")
    op.drop_table("agent_tasks")
