"""Add pgvector-backed document_chunks table for RAG retrieval.

Revision ID: 002_document_chunks
Revises: 001_initial
Create Date: 2026-02-15
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa
from sqlalchemy.types import JSON

try:
    from pgvector.sqlalchemy import Vector  # type: ignore
except Exception:  # pragma: no cover
    Vector = None  # type: ignore


revision = "002_document_chunks"
down_revision = "001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    dialect = bind.dialect.name

    if dialect == "postgresql":
        if Vector is None:  # pragma: no cover
            raise RuntimeError("pgvector is required for PostgreSQL migrations")
        op.execute("CREATE EXTENSION IF NOT EXISTS vector")
        embedding_col = sa.Column("embedding", Vector(384), nullable=True)  # type: ignore[misc]
        metadata_col = sa.Column("metadata", sa.dialects.postgresql.JSONB, nullable=True, server_default=sa.text("'{}'::jsonb"))
    else:
        # SQLite/dev: store embeddings as JSON arrays; vector search is disabled in code paths.
        embedding_col = sa.Column("embedding", JSON, nullable=True)
        metadata_col = sa.Column("metadata", JSON, nullable=True, server_default=sa.text("'{}'"))

    op.create_table(
        "document_chunks",
        sa.Column("id", sa.BigInteger, primary_key=True, autoincrement=True),
        sa.Column("doc_id", sa.String(255), nullable=False),
        sa.Column("chunk_index", sa.Integer, nullable=False, server_default="0"),
        sa.Column("content", sa.Text, nullable=False),
        embedding_col,
        sa.Column("source", sa.String(500), nullable=True),
        metadata_col,
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("doc_id", "chunk_index", name="uq_document_chunks_doc_chunk"),
    )
    op.create_index("idx_document_chunks_doc_id", "document_chunks", ["doc_id"])

    if dialect == "postgresql":
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_document_chunks_fts "
            "ON document_chunks USING gin(to_tsvector('english', content))"
        )
        # HNSW index for cosine similarity search (pgvector).
        op.execute(
            "CREATE INDEX IF NOT EXISTS idx_document_chunks_embedding_cosine "
            "ON document_chunks USING hnsw (embedding vector_cosine_ops) "
            "WITH (m = 16, ef_construction = 64)"
        )


def downgrade() -> None:
    op.drop_index("idx_document_chunks_doc_id", table_name="document_chunks")
    op.drop_table("document_chunks")
