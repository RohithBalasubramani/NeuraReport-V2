# mypy: ignore-errors
"""
LlamaIndex-style indexes (merged from V1 indexes/).

Provides:
- SchemaIndex — database schema knowledge base for RAG-powered SQL generation
- TemplateIndex — template and mapping-history knowledge base
- DocumentIndex — document chunking and indexing with section awareness

All indexes accept an embedding_pipeline and vector_store, making them
backend-agnostic.
"""
from __future__ import annotations

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger("neura.indexes")

# =========================================================================== #
#  Section 1: Schema Index                                                    #
# =========================================================================== #

@dataclass
class SchemaDocument:
    """Represents a single database table's schema information."""
    table_name: str
    columns: list[dict] = field(default_factory=list)
    relationships: list[str] = field(default_factory=list)
    description: str = ""


def format_schema_for_llm(tables: list[SchemaDocument]) -> str:
    parts: list[str] = []
    for tbl in tables:
        lines = [f"TABLE: {tbl.table_name}"]
        if tbl.description:
            lines.append(f"Description: {tbl.description}")
        lines.append("Columns:")
        for col in tbl.columns:
            col_name = col.get("name", col.get("column_name", "?"))
            col_type = col.get("type", col.get("data_type", ""))
            extras: list[str] = []
            if col.get("primary_key"):
                extras.append("PK")
            if col.get("nullable") is False:
                extras.append("NOT NULL")
            if col.get("foreign_key"):
                extras.append(f"FK -> {col['foreign_key']}")
            suffix = f" ({col_type})" if col_type else ""
            if extras:
                suffix += f" [{', '.join(extras)}]"
            lines.append(f"  - {col_name}{suffix}")
        if tbl.relationships:
            lines.append("Relationships:")
            for rel in tbl.relationships:
                lines.append(f"  - {rel}")
        parts.append("\n".join(lines))
    return "\n\n".join(parts)


class SchemaIndex:
    def __init__(self, embedding_pipeline, vector_store) -> None:
        self._embedder = embedding_pipeline
        self._store = vector_store

    def index_schema(self, connection_id: str, tables: list[SchemaDocument]) -> int:
        total = 0
        for table in tables:
            text = format_schema_for_llm([table])
            chunks = self._embedder.chunk_text(text, chunk_size=512, overlap=50)
            if not chunks:
                continue
            embeddings = self._embedder.generate_embeddings(chunks)
            self._store.add(embeddings, chunks, [{"source": f"schema:{connection_id}", "table": table.table_name} for _ in chunks])
            total += len(chunks)
        return total

    def query_relevant_tables(self, question: str, top_k: int = 5) -> list[dict]:
        qe = self._embedder.generate_embeddings([question])[0]
        return self._store.search(qe, top_k=top_k)

    def get_table_context(self, table_names: list[str]) -> str:
        qe = self._embedder.generate_embeddings([" ".join(table_names)])[0]
        results = self._store.search(qe, top_k=50)
        target = {t.lower() for t in table_names}
        seen: set[str] = set()
        parts: list[str] = []
        for r in results:
            tbl = r.get("metadata", {}).get("table", "")
            if tbl.lower() in target and tbl not in seen:
                seen.add(tbl)
                parts.append(r["text"])
        return "\n\n".join(parts)


# =========================================================================== #
#  Section 2: Template Index                                                  #
# =========================================================================== #

@dataclass
class TemplateDocument:
    template_id: str
    template_name: str
    fields: list[dict] = field(default_factory=list)
    mapping_history: list[dict] = field(default_factory=list)
    metadata: dict = field(default_factory=dict)


def _template_to_text(template: TemplateDocument) -> str:
    """Convert a template into indexable prose."""
    lines: list[str] = [f"Template: {template.template_name}"]
    if template.metadata.get("description"):
        lines.append(f"Description: {template.metadata['description']}")
    if template.metadata.get("category"):
        lines.append(f"Category: {template.metadata['category']}")
    if template.fields:
        lines.append("Fields:")
        for fld in template.fields:
            name = fld.get("name", fld.get("field_name", "?"))
            ftype = fld.get("type", fld.get("field_type", ""))
            required = " (required)" if fld.get("required") else ""
            desc = f" - {fld['description']}" if fld.get("description") else ""
            lines.append(f"  - {name} [{ftype}]{required}{desc}")
    return "\n".join(lines)


def _mapping_to_text(
    template_id: str,
    connection_id: str,
    mappings: dict,
    success: bool,
) -> str:
    """Convert a mapping result into indexable text."""
    status = "SUCCESSFUL" if success else "FAILED"
    lines = [
        f"Mapping result ({status})",
        f"Template: {template_id}",
        f"Connection: {connection_id}",
        "Mappings:",
    ]
    for field_name, column_name in mappings.items():
        lines.append(f"  {field_name} -> {column_name}")
    return "\n".join(lines)


def _table_to_text(table: SchemaDocument) -> str:
    """Convert a single schema table into indexable text."""
    return format_schema_for_llm([table])


class TemplateIndex:
    def __init__(self, embedding_pipeline, vector_store) -> None:
        self._embedder = embedding_pipeline
        self._store = vector_store

    def index_template(self, template: TemplateDocument) -> int:
        lines = [f"Template: {template.template_name}"]
        if template.metadata.get("description"):
            lines.append(f"Description: {template.metadata['description']}")
        if template.fields:
            lines.append("Fields:")
            for f in template.fields:
                lines.append(f"  - {f.get('name', '?')} [{f.get('type', '')}]")
        text = "\n".join(lines)
        chunks = self._embedder.chunk_text(text, chunk_size=512, overlap=50)
        if not chunks:
            return 0
        embeddings = self._embedder.generate_embeddings(chunks)
        self._store.add(embeddings, chunks, [{"source": f"template:{template.template_id}", "template_id": template.template_id, "template_name": template.template_name} for _ in chunks])
        return len(chunks)

    def index_mapping_result(self, template_id: str, connection_id: str, mappings: dict, success: bool) -> None:
        status = "SUCCESSFUL" if success else "FAILED"
        lines = [f"Mapping result ({status})", f"Template: {template_id}", f"Connection: {connection_id}", "Mappings:"]
        for fn, cn in mappings.items():
            lines.append(f"  {fn} -> {cn}")
        text = "\n".join(lines)
        chunks = self._embedder.chunk_text(text, chunk_size=512, overlap=50)
        if not chunks:
            return
        embeddings = self._embedder.generate_embeddings(chunks)
        self._store.add(embeddings, chunks, [{"source": f"mapping:{template_id}:{connection_id}", "template_id": template_id, "connection_id": connection_id, "success": success, "mappings_json": json.dumps(mappings)} for _ in chunks])

    def find_similar_templates(self, description: str, top_k: int = 3) -> list[dict]:
        qe = self._embedder.generate_embeddings([description])[0]
        results = self._store.search(qe, top_k=top_k)
        return [r for r in results if r.get("metadata", {}).get("source", "").startswith("template:")]

    def get_mapping_suggestions(self, template_id: str, source_columns: list[str]) -> list[dict]:
        query_text = f"mapping for template {template_id} columns: {', '.join(source_columns[:30])}"
        qe = self._embedder.generate_embeddings([query_text])[0]
        results = self._store.search(qe, top_k=20)
        suggestions: dict[str, list[dict]] = {}
        for result in results:
            meta = result.get("metadata", {})
            if not meta.get("source", "").startswith(f"mapping:{template_id}:") or not meta.get("success"):
                continue
            try:
                mappings = json.loads(meta.get("mappings_json", "{}"))
            except (json.JSONDecodeError, TypeError):
                continue
            score = result.get("score", 0.0)
            for fn, cn in mappings.items():
                if cn in source_columns:
                    suggestions.setdefault(fn, []).append({"column": cn, "score": score})
        ranked: list[dict] = []
        for fn, candidates in suggestions.items():
            candidates.sort(key=lambda c: c["score"], reverse=True)
            ranked.append({"field": fn, "suggested_column": candidates[0]["column"], "confidence": candidates[0]["score"], "alternatives": [c["column"] for c in candidates[1:4]]})
        return ranked


# =========================================================================== #
#  Section 3: Document Index                                                  #
# =========================================================================== #

_SECTION_RE = re.compile(r"^(#{1,3})\s+(.+)$", re.MULTILINE)


@dataclass
class ChunkingConfig:
    chunk_size: int = 512
    chunk_overlap: int = 50
    separator: str = "\n\n"
    respect_sections: bool = True


def section_aware_chunk(content: str, config: ChunkingConfig) -> list[dict]:
    if not content or not content.strip():
        return []
    if not config.respect_sections:
        return _size_based_chunk(content, section="", config=config)
    header_matches = list(_SECTION_RE.finditer(content))
    if not header_matches:
        return _size_based_chunk(content, section="", config=config)
    sections: list[tuple[str, str]] = []
    preamble = content[:header_matches[0].start()].strip()
    if preamble:
        sections.append(("", preamble))
    for idx, match in enumerate(header_matches):
        title = match.group(2).strip()
        start = match.end()
        end = header_matches[idx + 1].start() if idx + 1 < len(header_matches) else len(content)
        body = content[start:end].strip()
        if body or title:
            sections.append((title, body))
    all_chunks: list[dict] = []
    for title, body in sections:
        section_text = f"{title}\n{body}" if title else body
        all_chunks.extend(_size_based_chunk(section_text, section=title, config=config))
    return all_chunks


def _size_based_chunk(text: str, section: str, config: ChunkingConfig) -> list[dict]:
    chunks: list[dict] = []
    paragraphs = text.split(config.separator) if config.separator else [text]
    current_chunk: list[str] = []
    current_len = 0
    chunk_index = 0
    for para in paragraphs:
        para = para.strip()
        if not para:
            continue
        if len(para) > config.chunk_size:
            if current_chunk:
                chunks.append({"text": config.separator.join(current_chunk), "section": section, "chunk_index": chunk_index})
                chunk_index += 1
                current_chunk, current_len = [], 0
            for pos in range(0, len(para), config.chunk_size - config.chunk_overlap):
                chunks.append({"text": para[pos:pos + config.chunk_size], "section": section, "chunk_index": chunk_index})
                chunk_index += 1
            continue
        sep_len = len(config.separator) if current_chunk else 0
        if current_len + sep_len + len(para) > config.chunk_size and current_chunk:
            chunks.append({"text": config.separator.join(current_chunk), "section": section, "chunk_index": chunk_index})
            chunk_index += 1
            overlap_text = config.separator.join(current_chunk)
            if config.chunk_overlap and len(overlap_text) > config.chunk_overlap:
                current_chunk = [overlap_text[-config.chunk_overlap:]]
                current_len = len(current_chunk[0])
            else:
                current_chunk, current_len = [], 0
        current_chunk.append(para)
        current_len += sep_len + len(para)
    if current_chunk:
        chunks.append({"text": config.separator.join(current_chunk), "section": section, "chunk_index": chunk_index})
    return chunks


class DocumentIndex:
    def __init__(self, embedding_pipeline, vector_store, config: Optional[ChunkingConfig] = None) -> None:
        self._embedder = embedding_pipeline
        self._store = vector_store
        self._config = config or ChunkingConfig()

    def index_document(self, doc_id: str, content: str, source: str, metadata: Optional[dict] = None) -> int:
        chunks = section_aware_chunk(content, self._config)
        if not chunks:
            return 0
        texts = [c["text"] for c in chunks]
        embeddings = self._embedder.generate_embeddings(texts)
        base_meta = metadata or {}
        self._store.add(embeddings, texts, [{**base_meta, "source": source, "doc_id": doc_id, "section": c["section"], "chunk_index": c["chunk_index"]} for c in chunks])
        return len(chunks)

    def index_documents_batch(self, documents: list[dict]) -> int:
        total = 0
        for doc in documents:
            total += self.index_document(doc["doc_id"], doc["content"], doc["source"], doc.get("metadata"))
        return total

    def delete_document(self, doc_id: str) -> int:
        try:
            result = self._store.delete({"doc_id": doc_id})
            return result if isinstance(result, int) else 0
        except Exception:
            return 0

    def search(self, query: str, top_k: int = 5, source_filter: Optional[str] = None) -> list[dict]:
        qe = self._embedder.generate_embeddings([query])[0]
        fetch_k = top_k * 3 if source_filter else top_k
        results = self._store.search(qe, top_k=fetch_k)
        if source_filter:
            results = [r for r in results if r.get("metadata", {}).get("source", "").startswith(source_filter)]
        return results[:top_k]


__all__ = ["SchemaIndex", "SchemaDocument", "format_schema_for_llm", "TemplateIndex", "TemplateDocument", "DocumentIndex", "ChunkingConfig", "section_aware_chunk"]
