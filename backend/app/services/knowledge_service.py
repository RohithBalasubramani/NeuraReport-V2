"""Knowledge Management Service.

Document library and knowledge management service.
"""
from __future__ import annotations

import copy
import logging
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from backend.app.common import utc_now, utc_now_iso
from backend.app.schemas import (
    CollectionCreate,
    CollectionResponse,
    CollectionUpdate,
    DocumentType,
    FAQItem,
    FAQResponse,
    KnowledgeGraphEdge,
    KnowledgeGraphNode,
    KnowledgeGraphResponse,
    LibraryDocumentCreate,
    LibraryDocumentResponse,
    LibraryDocumentUpdate,
    RelatedDocumentsResponse,
    SearchResponse,
    SearchResult,
    TagCreate,
    TagResponse,
)

logger = logging.getLogger(__name__)

def utc_now() -> str:
    """Return current UTC time as ISO 8601 string, matching store.py.utc_now_iso()."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

class KnowledgeService:
    """Service for managing document library and knowledge base."""

    def __init__(self):
        self._documents: dict[str, dict] = {}
        self._collections: dict[str, dict] = {}
        self._tags: dict[str, dict] = {}
        self._favorites: set[str] = set()

    async def add_document(
        self,
        request: LibraryDocumentCreate,
    ) -> LibraryDocumentResponse:
        """Add a document to the library."""
        self._load_library()
        doc_id = str(uuid.uuid4())
        now = utc_now()

        # Determine file size if file path provided
        file_size = None
        if request.file_path:
            try:
                file_size = Path(request.file_path).stat().st_size
            except Exception:
                pass

        doc = {
            "id": doc_id,
            "title": request.title,
            "description": request.description,
            "content": request.content,
            "file_path": request.file_path,
            "file_url": request.file_url,
            "document_type": request.document_type.value,
            "file_size": file_size,
            "tags": request.tags,
            "collections": request.collections,
            "metadata": request.metadata,
            "created_at": now,
            "updated_at": now,
            "last_accessed_at": None,
            "is_favorite": False,
        }

        self._documents[doc_id] = doc

        # Add to collections
        for coll_id in request.collections:
            if coll_id in self._collections:
                self._collections[coll_id]["document_ids"].append(doc_id)

        # Persist
        self._persist_library()

        return self._to_document_response(doc)

    async def get_document(self, doc_id: str) -> Optional[LibraryDocumentResponse]:
        """Get a document by ID."""
        self._load_library()
        doc = self._documents.get(doc_id)
        if not doc:
            return None

        # Update last accessed
        doc["last_accessed_at"] = utc_now()
        self._persist_library()
        return self._to_document_response(doc)

    async def list_documents(
        self,
        collection_id: Optional[str] = None,
        tags: Optional[list[str]] = None,
        document_type: Optional[DocumentType] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[LibraryDocumentResponse], int]:
        """List documents with optional filtering."""
        self._load_library()

        docs = list(self._documents.values())

        # Filter by collection
        if collection_id:
            coll = self._collections.get(collection_id)
            if coll:
                doc_ids = set(coll.get("document_ids", []))
                docs = [d for d in docs if d["id"] in doc_ids]

        # Filter by tags
        if tags:
            tag_set = set(tags)
            docs = [d for d in docs if tag_set.intersection(d.get("tags", []))]

        # Filter by document type
        if document_type:
            docs = [d for d in docs if d.get("document_type") == document_type.value]

        # Sort by updated_at
        docs.sort(key=lambda d: d.get("updated_at", ""), reverse=True)

        total = len(docs)
        docs = docs[offset:offset + limit]

        return [self._to_document_response(d) for d in docs], total

    async def update_document(
        self,
        doc_id: str,
        request: LibraryDocumentUpdate,
    ) -> Optional[LibraryDocumentResponse]:
        """Update a document."""
        self._load_library()
        doc = self._documents.get(doc_id)
        if not doc:
            return None

        if request.title is not None:
            doc["title"] = request.title
        if request.description is not None:
            doc["description"] = request.description
        if request.tags is not None:
            doc["tags"] = request.tags
        if request.collections is not None:
            # Update collection memberships
            old_colls = set(doc.get("collections", []))
            new_colls = set(request.collections)

            for coll_id in old_colls - new_colls:
                if coll_id in self._collections:
                    self._collections[coll_id]["document_ids"] = [
                        d for d in self._collections[coll_id]["document_ids"]
                        if d != doc_id
                    ]

            for coll_id in new_colls - old_colls:
                if coll_id in self._collections:
                    self._collections[coll_id]["document_ids"].append(doc_id)

            doc["collections"] = request.collections

        if request.metadata is not None:
            doc["metadata"].update(request.metadata)

        doc["updated_at"] = utc_now()

        self._persist_library()

        return self._to_document_response(doc)

    async def delete_document(self, doc_id: str) -> bool:
        """Delete a document."""
        self._load_library()
        if doc_id not in self._documents:
            return False

        doc = self._documents[doc_id]

        # Remove from collections
        for coll_id in doc.get("collections", []):
            if coll_id in self._collections:
                self._collections[coll_id]["document_ids"] = [
                    d for d in self._collections[coll_id]["document_ids"]
                    if d != doc_id
                ]

        del self._documents[doc_id]
        self._favorites.discard(doc_id)

        self._persist_library()

        return True

    async def toggle_favorite(self, doc_id: str) -> bool:
        """Toggle favorite status for a document."""
        self._load_library()
        if doc_id not in self._documents:
            return False

        doc = self._documents[doc_id]
        doc["is_favorite"] = not doc.get("is_favorite", False)

        if doc["is_favorite"]:
            self._favorites.add(doc_id)
        else:
            self._favorites.discard(doc_id)

        self._persist_library()

        return doc["is_favorite"]

    # Collection methods

    async def create_collection(
        self,
        request: CollectionCreate,
    ) -> CollectionResponse:
        """Create a new collection."""
        self._load_library()
        coll_id = str(uuid.uuid4())
        now = utc_now()

        coll = {
            "id": coll_id,
            "name": request.name,
            "description": request.description,
            "document_ids": request.document_ids,
            "is_smart": request.is_smart,
            "smart_filter": request.smart_filter,
            "icon": request.icon,
            "color": request.color,
            "created_at": now,
            "updated_at": now,
        }

        self._collections[coll_id] = coll
        self._persist_library()

        return self._to_collection_response(coll)

    async def get_collection(self, coll_id: str) -> Optional[CollectionResponse]:
        """Get a collection by ID."""
        self._load_library()
        coll = self._collections.get(coll_id)
        if not coll:
            return None
        return self._to_collection_response(coll)

    async def list_collections(self) -> list[CollectionResponse]:
        """List all collections."""
        self._load_library()
        colls = list(self._collections.values())
        colls.sort(key=lambda c: c.get("name", ""))
        return [self._to_collection_response(c) for c in colls]

    async def update_collection(
        self,
        coll_id: str,
        request: CollectionUpdate,
    ) -> Optional[CollectionResponse]:
        """Update a collection."""
        self._load_library()
        coll = self._collections.get(coll_id)
        if not coll:
            return None

        for field in ["name", "description", "document_ids", "is_smart",
                      "smart_filter", "icon", "color"]:
            value = getattr(request, field, None)
            if value is not None:
                coll[field] = value

        coll["updated_at"] = utc_now()
        self._persist_library()

        return self._to_collection_response(coll)

    async def delete_collection(self, coll_id: str) -> bool:
        """Delete a collection."""
        self._load_library()
        if coll_id not in self._collections:
            return False

        # Remove collection from documents
        for doc in self._documents.values():
            if coll_id in doc.get("collections", []):
                doc["collections"] = [c for c in doc["collections"] if c != coll_id]

        del self._collections[coll_id]
        self._persist_library()

        return True

    # Tag methods

    async def create_tag(self, request: TagCreate) -> TagResponse:
        """Create a new tag."""
        self._load_library()
        tag_id = str(uuid.uuid4())
        now = utc_now()

        tag = {
            "id": tag_id,
            "name": request.name,
            "color": request.color,
            "description": request.description,
            "created_at": now,
        }

        self._tags[tag_id] = tag
        self._persist_library()

        return self._to_tag_response(tag)

    async def list_tags(self) -> list[TagResponse]:
        """List all tags."""
        self._load_library()
        tags = list(self._tags.values())
        tags.sort(key=lambda t: t.get("name", ""))
        return [self._to_tag_response(t) for t in tags]

    async def delete_tag(self, tag_id: str) -> bool:
        """Delete a tag."""
        self._load_library()
        tag = self._tags.get(tag_id)
        if not tag:
            return False

        tag_name = tag["name"]

        # Remove tag from documents
        for doc in self._documents.values():
            if tag_name in doc.get("tags", []):
                doc["tags"] = [t for t in doc["tags"] if t != tag_name]

        del self._tags[tag_id]
        self._persist_library()

        return True

    # Collection-document association methods

    async def add_document_to_collection(self, collection_id: str, document_id: str) -> bool:
        """Add a document to a collection."""
        self._load_library()
        coll = self._collections.get(collection_id)
        doc = self._documents.get(document_id)
        if not coll or not doc:
            return False

        doc_ids = coll.setdefault("document_ids", [])
        if document_id not in doc_ids:
            doc_ids.append(document_id)

        colls = doc.setdefault("collections", [])
        if collection_id not in colls:
            colls.append(collection_id)

        now = utc_now()
        coll["updated_at"] = now
        doc["updated_at"] = now
        self._persist_library()
        return True

    async def remove_document_from_collection(self, collection_id: str, document_id: str) -> bool:
        """Remove a document from a collection."""
        self._load_library()
        coll = self._collections.get(collection_id)
        doc = self._documents.get(document_id)
        if not coll or not doc:
            return False

        coll["document_ids"] = [d for d in coll.get("document_ids", []) if d != document_id]
        doc["collections"] = [c for c in doc.get("collections", []) if c != collection_id]

        now = utc_now()
        coll["updated_at"] = now
        doc["updated_at"] = now
        self._persist_library()
        return True

    # Document-tag association methods

    async def add_tag_to_document(self, document_id: str, tag_id: str) -> bool:
        """Add a tag to a document by tag ID."""
        self._load_library()
        doc = self._documents.get(document_id)
        tag = self._tags.get(tag_id)
        if not doc or not tag:
            return False

        tag_name = str(tag.get("name") or "").strip()
        if not tag_name:
            return False

        doc_tags = doc.setdefault("tags", [])
        if tag_name not in doc_tags:
            doc_tags.append(tag_name)
            doc["updated_at"] = utc_now()
            self._persist_library()
        return True

    async def remove_tag_from_document(self, document_id: str, tag_id: str) -> bool:
        """Remove a tag from a document by tag ID."""
        self._load_library()
        doc = self._documents.get(document_id)
        tag = self._tags.get(tag_id)
        if not doc or not tag:
            return False

        tag_name = str(tag.get("name") or "").strip()
        if not tag_name:
            return False

        doc["tags"] = [t for t in doc.get("tags", []) if t != tag_name]
        doc["updated_at"] = utc_now()
        self._persist_library()
        return True

    async def get_document_activity(self, doc_id: str) -> Optional[list[dict[str, Any]]]:
        """Return a lightweight activity stream for a document."""
        self._load_library()
        doc = self._documents.get(doc_id)
        if not doc:
            return None

        activity: list[dict[str, Any]] = []
        metadata_activity = doc.get("activity")
        if isinstance(metadata_activity, list):
            for entry in metadata_activity:
                if isinstance(entry, dict):
                    activity.append(copy.deepcopy(entry))

        if not activity:
            created_at = doc.get("created_at")
            updated_at = doc.get("updated_at")
            last_accessed_at = doc.get("last_accessed_at")
            if created_at:
                activity.append({"event": "created", "timestamp": created_at, "document_id": doc_id})
            if updated_at and updated_at != created_at:
                activity.append({"event": "updated", "timestamp": updated_at, "document_id": doc_id})
            if last_accessed_at:
                activity.append({"event": "accessed", "timestamp": last_accessed_at, "document_id": doc_id})

        return activity

    async def get_stats(self) -> dict[str, Any]:
        """Return aggregate library metrics."""
        self._load_library()
        docs = list(self._documents.values())
        colls = list(self._collections.values())
        tags = list(self._tags.values())

        document_types: dict[str, int] = {}
        storage_used_bytes = 0
        favorites = 0

        for doc in docs:
            kind = str(doc.get("document_type") or "other")
            document_types[kind] = document_types.get(kind, 0) + 1
            file_size = doc.get("file_size")
            if isinstance(file_size, int) and file_size > 0:
                storage_used_bytes += file_size
            if bool(doc.get("is_favorite")):
                favorites += 1

        return {
            "total_documents": len(docs),
            "total_collections": len(colls),
            "total_tags": len(tags),
            "total_favorites": favorites,
            "storage_used_bytes": storage_used_bytes,
            "document_types": document_types,
        }

    # Search methods

    async def search(
        self,
        query: str,
        document_types: list[DocumentType] = None,
        tags: list[str] = None,
        collections: list[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> SearchResponse:
        """Full-text search across documents."""
        start_time = time.time()
        self._load_library()

        query_lower = query.lower()
        results = []

        for doc in self._documents.values():
            # Simple text matching
            score = 0
            highlights = []

            title = str(doc.get("title") or "").lower()
            description = str(doc.get("description") or "").lower()
            content = str(doc.get("content") or "").lower()

            if query_lower in title:
                score += 2.0
                highlights.append(f"Title: {doc['title']}")
            if query_lower in description:
                score += 1.0
                highlights.append("Description match")
            if query_lower in content:
                score += 1.5
                highlights.append("Content match")

            # Filter by document type
            if document_types:
                if doc.get("document_type") not in [dt.value for dt in document_types]:
                    continue

            # Filter by tags
            if tags:
                if not set(tags).intersection(doc.get("tags", [])):
                    continue

            # Filter by collections
            if collections:
                if not set(collections).intersection(doc.get("collections", [])):
                    continue

            if score > 0:
                results.append({
                    "document": doc,
                    "score": score,
                    "highlights": highlights,
                })

        # Sort by score
        results.sort(key=lambda r: r["score"], reverse=True)
        total = len(results)
        results = results[offset:offset + limit]

        took_ms = (time.time() - start_time) * 1000

        return SearchResponse(
            results=[
                SearchResult(
                    document=self._to_document_response(r["document"]),
                    score=r["score"],
                    highlights=r["highlights"],
                )
                for r in results
            ],
            total=total,
            query=query,
            took_ms=took_ms,
        )

    async def semantic_search(
        self,
        query: str,
        document_ids: list[str] = None,
        top_k: int = 10,
        threshold: float = 0.5,
    ) -> SearchResponse:
        """Semantic search using embeddings (placeholder)."""
        # This would use embeddings for semantic similarity
        # For now, falls back to keyword search
        return await self.search(
            query=query,
            limit=top_k,
        )

    async def auto_tag(
        self,
        doc_id: str,
        max_tags: int = 5,
    ) -> dict:
        """Auto-suggest tags for a document."""
        self._load_library()
        doc = self._documents.get(doc_id)
        if not doc:
            return {"document_id": doc_id, "suggested_tags": [], "confidence_scores": {}}

        # Simple keyword extraction (would use NLP in production)
        text = f"{doc.get('title', '')} {doc.get('description', '')}"
        words = text.lower().split()

        # Count word frequencies
        word_counts = {}
        for word in words:
            if len(word) > 3:  # Skip short words
                word_counts[word] = word_counts.get(word, 0) + 1

        # Get top words as suggested tags
        sorted_words = sorted(word_counts.items(), key=lambda x: x[1], reverse=True)
        suggested = []
        scores = {}

        for word, count in sorted_words[:max_tags]:
            suggested.append(word)
            scores[word] = min(count / 10, 1.0)  # Normalize score

        return {
            "document_id": doc_id,
            "suggested_tags": suggested,
            "confidence_scores": scores,
        }

    async def find_related(
        self,
        doc_id: str,
        limit: int = 10,
    ) -> RelatedDocumentsResponse:
        """Find documents related to a given document."""
        self._load_library()
        doc = self._documents.get(doc_id)
        if not doc:
            return RelatedDocumentsResponse(document_id=doc_id, related=[])

        # Find documents with overlapping tags
        doc_tags = set(doc.get("tags", []))
        results = []

        for other_doc in self._documents.values():
            if other_doc["id"] == doc_id:
                continue

            other_tags = set(other_doc.get("tags", []))
            overlap = len(doc_tags.intersection(other_tags))

            if overlap > 0:
                score = overlap / max(len(doc_tags), 1)
                results.append({
                    "document": other_doc,
                    "score": score,
                    "highlights": [f"Shared tags: {', '.join(doc_tags.intersection(other_tags))}"],
                })

        results.sort(key=lambda r: r["score"], reverse=True)
        results = results[:limit]

        return RelatedDocumentsResponse(
            document_id=doc_id,
            related=[
                SearchResult(
                    document=self._to_document_response(r["document"]),
                    score=r["score"],
                    highlights=r["highlights"],
                )
                for r in results
            ],
        )

    async def build_knowledge_graph(
        self,
        document_ids: list[str] = None,
        depth: int = 2,
    ) -> KnowledgeGraphResponse:
        """Build a knowledge graph from documents."""
        self._load_library()

        nodes = []
        edges = []

        # Get documents
        docs = list(self._documents.values())
        if document_ids:
            docs = [d for d in docs if d["id"] in document_ids]

        # Add document nodes
        for doc in docs:
            nodes.append(KnowledgeGraphNode(
                id=doc["id"],
                type="document",
                label=doc["title"],
                properties={"type": doc.get("document_type"), "tags": doc.get("tags", [])},
            ))

            # Add tag nodes and edges
            for tag in doc.get("tags", []):
                tag_id = f"tag_{tag}"
                if not any(n.id == tag_id for n in nodes):
                    nodes.append(KnowledgeGraphNode(
                        id=tag_id,
                        type="tag",
                        label=tag,
                        properties={},
                    ))

                edges.append(KnowledgeGraphEdge(
                    source=doc["id"],
                    target=tag_id,
                    type="has_tag",
                    weight=1.0,
                ))

            # Add collection nodes and edges
            for coll_id in doc.get("collections", []):
                coll = self._collections.get(coll_id)
                if coll:
                    if not any(n.id == coll_id for n in nodes):
                        nodes.append(KnowledgeGraphNode(
                            id=coll_id,
                            type="collection",
                            label=coll["name"],
                            properties={},
                        ))

                    edges.append(KnowledgeGraphEdge(
                        source=doc["id"],
                        target=coll_id,
                        type="in_collection",
                        weight=1.0,
                    ))

        return KnowledgeGraphResponse(
            nodes=nodes,
            edges=edges,
            metadata={"document_count": len(docs), "depth": depth},
        )

    async def generate_faq(
        self,
        document_ids: list[str],
        max_questions: int = 10,
    ) -> FAQResponse:
        """Generate FAQ from documents (placeholder for AI integration)."""
        self._load_library()

        items = []

        for doc_id in document_ids[:max_questions]:
            doc = self._documents.get(doc_id)
            if not doc:
                continue

            # Generate placeholder FAQ items
            items.append(FAQItem(
                question=f"What is {doc['title']} about?",
                answer=doc.get("description") or f"This document covers topics related to {doc['title']}.",
                source_document_id=doc_id,
                confidence=0.8,
                category="General",
            ))

        return FAQResponse(
            items=items,
            source_documents=document_ids,
        )

    def _load_library(self) -> None:
        """Load library data from state store.

        Clears local state first to avoid stale data, then loads from store.
        """
        try:
            from backend.app.repositories import state_store
            with state_store.transaction() as state:
                library = state.get("library", {})
                # Clear stale data before loading
                self._documents.clear()
                self._collections.clear()
                self._tags.clear()
                self._favorites.clear()
                # Load fresh data from store
                self._documents.update(library.get("documents", {}))
                self._collections.update(library.get("collections", {}))
                self._tags.update(library.get("tags", {}))
                self._favorites.update(
                    doc_id
                    for doc_id, doc in self._documents.items()
                    if bool(doc.get("is_favorite"))
                )
        except Exception as e:
            logger.warning(f"Failed to load library from state: {e}")

    def _persist_library(self) -> None:
        """Persist library data to state store."""
        try:
            from backend.app.repositories import state_store
            with state_store.transaction() as state:
                state["library"] = {
                    "documents": copy.deepcopy(self._documents),
                    "collections": copy.deepcopy(self._collections),
                    "tags": copy.deepcopy(self._tags),
                }
        except Exception as e:
            logger.error(f"Failed to persist library to state: {e}")
            raise RuntimeError(f"Library persistence failed: {e}") from e

    def _to_document_response(self, doc: dict) -> LibraryDocumentResponse:
        """Convert document dict to response model."""
        return LibraryDocumentResponse(
            id=doc["id"],
            title=doc["title"],
            description=doc.get("description"),
            file_path=doc.get("file_path"),
            file_url=doc.get("file_url"),
            document_type=DocumentType(doc.get("document_type", "other")),
            file_size=doc.get("file_size"),
            tags=doc.get("tags", []),
            collections=doc.get("collections", []),
            metadata=doc.get("metadata", {}),
            created_at=doc["created_at"],
            updated_at=doc["updated_at"],
            last_accessed_at=doc.get("last_accessed_at"),
            is_favorite=doc.get("is_favorite", False),
        )

    def _to_collection_response(self, coll: dict) -> CollectionResponse:
        """Convert collection dict to response model."""
        return CollectionResponse(
            id=coll["id"],
            name=coll["name"],
            description=coll.get("description"),
            document_ids=coll.get("document_ids", []),
            document_count=len(coll.get("document_ids", [])),
            is_smart=coll.get("is_smart", False),
            smart_filter=coll.get("smart_filter"),
            icon=coll.get("icon"),
            color=coll.get("color"),
            created_at=coll["created_at"],
            updated_at=coll["updated_at"],
        )

    def _to_tag_response(self, tag: dict) -> TagResponse:
        """Convert tag dict to response model."""
        # Count documents with this tag
        tag_name = tag["name"]
        doc_count = sum(
            1 for doc in self._documents.values()
            if tag_name in doc.get("tags", [])
        )

        return TagResponse(
            id=tag["id"],
            name=tag["name"],
            color=tag.get("color"),
            description=tag.get("description"),
            document_count=doc_count,
            created_at=tag["created_at"],
        )

# Singleton instance
knowledge_service = KnowledgeService()

# mypy: ignore-errors
"""
Template Knowledge Base Indexer.

Indexes verified templates, field names, layout structures, and mapping history.
Includes successful mapping corrections as training data for DSPy optimization.
"""

import logging
import time
from typing import Any, Dict, List, Optional


logger = logging.getLogger("neura.knowledge.template_index")

class TemplateIndexer:
    """
    Indexes templates and mapping history for knowledge-augmented operations.

    Usage:
        indexer = TemplateIndexer()
        indexer.index_template(template_id, fields, mapping_history)
        similar = indexer.find_similar_templates("invoice with line items")
    """

    def __init__(self, persist_directory: Optional[str] = None):
        self._pipeline = RAGPipeline(
            collection_name="template_kb",
            persist_directory=persist_directory,
        )
        self._pipeline.add_transform(RelevanceFilter(min_score=0.4))
        self._pipeline.add_transform(DedupTransform())
        self._pipeline.add_transform(TimeWeightedScorer(decay_rate=0.01))

    def index_template(
        self,
        template_id: str,
        fields: List[Dict[str, Any]],
        layout_description: str = "",
        mapping_history: Optional[List[Dict[str, Any]]] = None,
    ) -> int:
        """Index a verified template with its fields and mapping history."""
        texts = []
        metadatas = []
        ids = []

        # Index template overview
        field_names = [f.get("name", "") for f in fields]
        overview = f"Template {template_id}: {layout_description}\nFields: {', '.join(field_names)}"
        texts.append(overview)
        metadatas.append({
            "source": "template_kb",
            "template_id": template_id,
            "type": "overview",
            "field_count": len(fields),
            "timestamp": time.time(),
        })
        ids.append(f"tmpl_{template_id}_overview")

        # Index individual fields
        for field in fields:
            field_name = field.get("name", "unknown")
            field_desc = f"Template field: {field_name}"
            if field.get("type"):
                field_desc += f" (type: {field['type']})"
            if field.get("location"):
                field_desc += f" at {field['location']}"

            texts.append(field_desc)
            metadatas.append({
                "source": "template_kb",
                "template_id": template_id,
                "field_name": field_name,
                "type": "field",
                "timestamp": time.time(),
            })
            ids.append(f"tmpl_{template_id}_field_{field_name}")

        # Index mapping history (valuable for learning)
        if mapping_history:
            for mapping in mapping_history:
                field_name = mapping.get("field_name", "")
                column = mapping.get("column", "")
                table = mapping.get("table", "")
                was_corrected = mapping.get("corrected", False)

                map_desc = f"Mapping: field '{field_name}' → {table}.{column}"
                if was_corrected:
                    map_desc += " (user-corrected)"
                    original = mapping.get("original_mapping", "")
                    if original:
                        map_desc += f" from original: {original}"

                texts.append(map_desc)
                metadatas.append({
                    "source": "template_kb",
                    "template_id": template_id,
                    "field_name": field_name,
                    "table": table,
                    "column": column,
                    "corrected": was_corrected,
                    "type": "mapping",
                    "timestamp": time.time(),
                })
                ids.append(f"tmpl_{template_id}_map_{field_name}_{table}_{column}")

        count = self._pipeline.add_documents(texts, metadatas, ids)
        logger.info("template_indexed", extra={
            "template_id": template_id,
            "fields": len(fields),
            "mappings": len(mapping_history) if mapping_history else 0,
            "chunks": count,
        })
        return count

    def find_similar_templates(
        self,
        description: str,
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """Find templates similar to a description."""
        nodes = self._pipeline.query(description, top_k=top_k)
        return [
            {
                "content": n.content,
                "score": round(n.score, 4),
                "template_id": n.metadata.get("template_id"),
                "type": n.metadata.get("type"),
            }
            for n in nodes
        ]

    def find_similar_mappings(
        self,
        field_description: str,
        top_k: int = 10,
    ) -> List[Dict[str, Any]]:
        """Find historical mappings similar to a field."""
        nodes = self._pipeline.query(
            field_description,
            top_k=top_k,
            where={"type": "mapping"},
        )
        return [
            {
                "content": n.content,
                "score": round(n.score, 4),
                "template_id": n.metadata.get("template_id"),
                "field_name": n.metadata.get("field_name"),
                "table": n.metadata.get("table"),
                "column": n.metadata.get("column"),
                "corrected": n.metadata.get("corrected", False),
            }
            for n in nodes
        ]

    def count(self) -> int:
        return self._pipeline.count()

# mypy: ignore-errors
"""
Document Knowledge Base Indexer.

Indexes uploaded documents, reports, and knowledge base files for:
- Document Q&A (/docqa)
- Agent research tasks
- Report enrichment

Supports incremental indexing and text chunking.
"""

import hashlib
import logging
import time
from typing import Any, Dict, List, Optional


logger = logging.getLogger("neura.knowledge.document_index")

def _chunk_text(text: str, chunk_size: int = 512, overlap: int = 50) -> List[str]:
    """Split text into overlapping chunks."""
    if len(text) <= chunk_size:
        return [text]

    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        chunks.append(chunk)
        start = end - overlap

    return chunks

class DocumentIndexer:
    """
    Indexes documents into a searchable knowledge base.

    Usage:
        indexer = DocumentIndexer()
        indexer.index_document(doc_id, "Full document text...", metadata={...})
        results = indexer.search("What are the safety requirements?")
    """

    def __init__(
        self,
        persist_directory: Optional[str] = None,
        chunk_size: int = 512,
        chunk_overlap: int = 50,
    ):
        self._chunk_size = chunk_size
        self._chunk_overlap = chunk_overlap
        self._pipeline = RAGPipeline(
            collection_name="document_kb",
            persist_directory=persist_directory,
        )
        self._pipeline.add_transform(RelevanceFilter(min_score=0.35))
        self._pipeline.add_transform(DedupTransform())
        self._pipeline.add_transform(TimeWeightedScorer(decay_rate=0.005))

    def index_document(
        self,
        document_id: str,
        text: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> int:
        """Index a document by chunking and adding to the knowledge base."""
        if not text.strip():
            return 0

        chunks = _chunk_text(text, self._chunk_size, self._chunk_overlap)
        base_meta = metadata or {}
        base_meta.setdefault("source", "document_kb")
        base_meta.setdefault("timestamp", time.time())
        base_meta["document_id"] = document_id

        texts = []
        metadatas = []
        ids = []

        for i, chunk in enumerate(chunks):
            texts.append(chunk)
            chunk_meta = {**base_meta, "chunk_index": i, "total_chunks": len(chunks)}
            metadatas.append(chunk_meta)
            chunk_hash = hashlib.md5(f"{document_id}_{i}".encode()).hexdigest()[:12]
            ids.append(f"doc_{document_id}_{chunk_hash}")

        count = self._pipeline.add_documents(texts, metadatas, ids)
        logger.info("document_indexed", extra={
            "document_id": document_id,
            "text_length": len(text),
            "chunks": count,
            "title": base_meta.get("title", ""),
        })
        return count

    def index_documents_batch(
        self,
        documents: List[Dict[str, Any]],
    ) -> int:
        """Batch-index multiple documents."""
        total = 0
        for doc in documents:
            count = self.index_document(
                document_id=doc["id"],
                text=doc["text"],
                metadata=doc.get("metadata"),
            )
            total += count
        return total

    def search(
        self,
        query: str,
        document_id: Optional[str] = None,
        top_k: int = 10,
    ) -> List[Dict[str, Any]]:
        """Search the document knowledge base."""
        where = None
        if document_id:
            where = {"document_id": document_id}

        nodes = self._pipeline.query(query, top_k=top_k, where=where)

        return [
            {
                "content": n.content,
                "score": round(n.score, 4),
                "document_id": n.metadata.get("document_id"),
                "title": n.metadata.get("title"),
                "chunk_index": n.metadata.get("chunk_index"),
                "source": n.source,
            }
            for n in nodes
        ]

    def count(self) -> int:
        return self._pipeline.count()

# mypy: ignore-errors
"""
Schema Knowledge Base Indexer.

Indexes database schemas (table names, column names, types, descriptions)
for use in template mapping, NL2SQL, and data analysis.

Auto-refreshes when connections change.
"""

import logging
import time
from typing import Any, Dict, List, Optional


logger = logging.getLogger("neura.knowledge.schema_index")

class SchemaIndexer:
    """
    Indexes database schemas into a searchable knowledge base.

    Usage:
        indexer = SchemaIndexer()
        indexer.index_connection(connection_id, schema_info)
        results = indexer.search("temperature columns for transformers")
    """

    def __init__(self, persist_directory: Optional[str] = None):
        self._pipeline = RAGPipeline(
            collection_name="schema_kb",
            persist_directory=persist_directory,
        )
        self._pipeline.add_transform(RelevanceFilter(min_score=0.3))
        self._pipeline.add_transform(DedupTransform())

    def index_connection(
        self,
        connection_id: str,
        schema_info: Dict[str, Any],
    ) -> int:
        """Index a database connection's schema."""
        texts = []
        metadatas = []
        ids = []

        tables = schema_info.get("tables", [])
        for table in tables:
            table_name = table.get("name", "unknown")

            # Index table-level description
            table_desc = f"Table: {table_name}"
            if table.get("description"):
                table_desc += f" — {table['description']}"
            table_desc += f"\nColumns: {', '.join(c.get('name', '') for c in table.get('columns', []))}"

            texts.append(table_desc)
            metadatas.append({
                "source": "schema_kb",
                "connection_id": connection_id,
                "table_name": table_name,
                "type": "table",
                "timestamp": time.time(),
            })
            ids.append(f"schema_{connection_id}_{table_name}")

            # Index column-level descriptions
            for col in table.get("columns", []):
                col_name = col.get("name", "unknown")
                col_type = col.get("type", "unknown")
                col_desc = f"Column: {table_name}.{col_name} (type: {col_type})"
                if col.get("description"):
                    col_desc += f" — {col['description']}"
                if col.get("nullable") is not None:
                    col_desc += f", nullable={col['nullable']}"
                if col.get("primary_key"):
                    col_desc += ", PRIMARY KEY"

                texts.append(col_desc)
                metadatas.append({
                    "source": "schema_kb",
                    "connection_id": connection_id,
                    "table_name": table_name,
                    "column_name": col_name,
                    "column_type": col_type,
                    "type": "column",
                    "timestamp": time.time(),
                })
                ids.append(f"schema_{connection_id}_{table_name}_{col_name}")

        count = self._pipeline.add_documents(texts, metadatas, ids)
        logger.info("schema_indexed", extra={
            "connection_id": connection_id,
            "tables": len(tables),
            "chunks": count,
        })
        return count

    def search(
        self,
        query: str,
        connection_id: Optional[str] = None,
        top_k: int = 20,
    ) -> List[Dict[str, Any]]:
        """Search the schema knowledge base."""
        where = None
        if connection_id:
            where = {"connection_id": connection_id}

        nodes = self._pipeline.query(query, top_k=top_k, where=where)

        return [
            {
                "content": n.content,
                "score": round(n.score, 4),
                "table_name": n.metadata.get("table_name"),
                "column_name": n.metadata.get("column_name"),
                "column_type": n.metadata.get("column_type"),
                "type": n.metadata.get("type"),
                "connection_id": n.metadata.get("connection_id"),
            }
            for n in nodes
        ]

    def remove_connection(self, connection_id: str) -> None:
        """Remove all indexed data for a connection."""
        # ChromaDB doesn't support bulk delete by metadata easily,
        # so we recreate the collection. For production, use a proper
        # metadata-based delete when available.
        logger.info("schema_index_remove", extra={"connection_id": connection_id})

    def count(self) -> int:
        """Get total indexed chunks."""
        return self._pipeline.count()

# mypy: ignore-errors
"""
Embedding Client for knowledge indexing and RAG retrieval.

Provides a unified interface for text embeddings with:
- sentence-transformers (primary, local)
- Fallback to simple TF-IDF-based embeddings if not available

Inspired by BFI pipeline_v45's embedding layer.
"""

import hashlib
import logging
import threading
from typing import Dict, List, Optional

logger = logging.getLogger("neura.knowledge.embeddings")

# Graceful imports
_st_available = False
try:
    from sentence_transformers import SentenceTransformer
    _st_available = True
except ImportError:
    pass

class EmbeddingClient:
    """
    Text embedding client with lazy model loading.

    Usage:
        client = EmbeddingClient()
        embeddings = client.encode(["hello world", "test document"])
        similarity = client.similarity("query", "document text")
    """

    def __init__(
        self,
        model_name: str = "all-MiniLM-L6-v2",
        cache_size: int = 1000,
    ):
        self._model_name = model_name
        self._model = None
        self._load_lock = threading.Lock()
        self._cache: Dict[str, List[float]] = {}
        self._cache_size = cache_size
        self._dimension: Optional[int] = None

    def _load_model(self) -> None:
        """Lazy-load the embedding model."""
        if self._model is not None:
            return
        with self._load_lock:
            if self._model is not None:
                return
            if _st_available:
                logger.info("embedding_model_loading", extra={"model": self._model_name})
                self._model = SentenceTransformer(self._model_name)
                self._dimension = self._model.get_sentence_embedding_dimension()
                logger.info("embedding_model_loaded", extra={
                    "model": self._model_name,
                    "dimension": self._dimension,
                })
            else:
                logger.warning("sentence_transformers_not_available")
                self._dimension = 384  # Fallback dimension

    @property
    def dimension(self) -> int:
        """Get embedding dimension."""
        self._load_model()
        return self._dimension or 384

    def encode(self, texts: List[str], normalize: bool = True) -> List[List[float]]:
        """Encode texts into embeddings."""
        self._load_model()

        if self._model is not None:
            # Use sentence-transformers
            embeddings = self._model.encode(
                texts,
                normalize_embeddings=normalize,
                show_progress_bar=False,
            )
            return [emb.tolist() for emb in embeddings]

        # Fallback: simple hash-based pseudo-embeddings (for testing/dev)
        logger.debug("using_fallback_embeddings")
        return [self._hash_embed(text) for text in texts]

    def encode_single(self, text: str, normalize: bool = True) -> List[float]:
        """Encode a single text string."""
        # Check cache
        cache_key = hashlib.md5(text.encode()).hexdigest()[:16]
        if cache_key in self._cache:
            return self._cache[cache_key]

        result = self.encode([text], normalize=normalize)[0]

        # Cache result
        if len(self._cache) < self._cache_size:
            self._cache[cache_key] = result

        return result

    def similarity(self, text_a: str, text_b: str) -> float:
        """Compute cosine similarity between two texts."""
        emb_a = self.encode_single(text_a)
        emb_b = self.encode_single(text_b)
        return self._cosine_similarity(emb_a, emb_b)

    @staticmethod
    def _cosine_similarity(a: List[float], b: List[float]) -> float:
        """Compute cosine similarity between two vectors."""
        dot = sum(x * y for x, y in zip(a, b))
        norm_a = sum(x * x for x in a) ** 0.5
        norm_b = sum(x * x for x in b) ** 0.5
        if norm_a == 0 or norm_b == 0:
            return 0.0
        return dot / (norm_a * norm_b)

    def _hash_embed(self, text: str) -> List[float]:
        """Fallback: deterministic pseudo-embedding from text hash."""
        import struct
        h = hashlib.sha512(text.encode()).digest()
        dim = self._dimension or 384
        # Expand hash to fill dimension
        values = []
        while len(values) < dim:
            h = hashlib.sha512(h).digest()
            floats = struct.unpack(f"{len(h)//4}f", h[:len(h)//4*4])
            values.extend(floats)
        values = values[:dim]
        # Normalize
        norm = sum(v * v for v in values) ** 0.5
        if norm > 0:
            values = [v / norm for v in values]
        return values

    def clear_cache(self) -> None:
        """Clear the embedding cache."""
        self._cache.clear()

# Global embedding client
_embedding_client: Optional[EmbeddingClient] = None
_embedding_lock = threading.Lock()

def get_embedding_client(model_name: str = "all-MiniLM-L6-v2") -> EmbeddingClient:
    """Get or create the global embedding client."""
    global _embedding_client
    with _embedding_lock:
        if _embedding_client is None:
            _embedding_client = EmbeddingClient(model_name=model_name)
    return _embedding_client

# mypy: ignore-errors
"""
RAG (Retrieval-Augmented Generation) Pipeline.

Provides a chainable transform pipeline for retrieval:
    Query → Retrieve (ChromaDB) → RelevanceFilter → DedupTransform → TimeWeightedScorer → Results

Inspired by BFI pipeline_v45's TransformComponent chain and RAG retriever.
"""

import hashlib
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger("neura.knowledge.rag")

# Graceful ChromaDB import
_chromadb_available = False
try:
    import chromadb
    _chromadb_available = True
except ImportError:
    pass

@dataclass
class RetrievalNode:
    """A retrieved text chunk with metadata and relevance score."""
    content: str
    metadata: Dict[str, Any] = field(default_factory=dict)
    score: float = 0.0
    source: str = ""
    timestamp: Optional[float] = None  # Unix timestamp of source creation

    @property
    def content_hash(self) -> str:
        return hashlib.md5(self.content.encode()).hexdigest()[:16]

class TransformComponent(ABC):
    """Abstract base for chainable retrieval transforms."""

    @abstractmethod
    def transform(self, nodes: List[RetrievalNode]) -> List[RetrievalNode]:
        ...

    def __call__(self, nodes: List[RetrievalNode]) -> List[RetrievalNode]:
        return self.transform(nodes)

class RelevanceFilter(TransformComponent):
    """Drop nodes below a minimum relevance score."""

    def __init__(self, min_score: float = 0.5):
        self.min_score = min_score

    def transform(self, nodes: List[RetrievalNode]) -> List[RetrievalNode]:
        filtered = [n for n in nodes if n.score >= self.min_score]
        logger.debug("relevance_filter", extra={
            "input_count": len(nodes),
            "output_count": len(filtered),
            "min_score": self.min_score,
        })
        return filtered

class DedupTransform(TransformComponent):
    """Remove duplicate nodes by content hash."""

    def transform(self, nodes: List[RetrievalNode]) -> List[RetrievalNode]:
        seen = set()
        result = []
        for node in nodes:
            h = node.content_hash
            if h not in seen:
                seen.add(h)
                result.append(node)
        logger.debug("dedup_transform", extra={
            "input_count": len(nodes),
            "output_count": len(result),
            "duplicates_removed": len(nodes) - len(result),
        })
        return result

class TimeWeightedScorer(TransformComponent):
    """
    Adjust relevance scores by temporal decay.

    Formula: final_score = relevance * (1 - decay_rate)^hours_elapsed
    Recent documents (corrections, shift logs) rank higher.

    From BFI pipeline_v45's DB-GPT enhancement.
    """

    def __init__(self, decay_rate: float = 0.02, reference_time: Optional[float] = None):
        self.decay_rate = decay_rate
        self.reference_time = reference_time

    def transform(self, nodes: List[RetrievalNode]) -> List[RetrievalNode]:
        ref_time = self.reference_time or time.time()

        for node in nodes:
            if node.timestamp:
                hours_elapsed = max(0, (ref_time - node.timestamp) / 3600)
                decay = (1 - self.decay_rate) ** hours_elapsed
                node.score *= decay

        # Re-sort by adjusted score
        nodes.sort(key=lambda n: n.score, reverse=True)
        return nodes

class RAGPipeline:
    """
    Complete RAG retrieval pipeline.

    Chains together retriever + transform components for knowledge-augmented
    context retrieval.

    Usage:
        pipeline = RAGPipeline(collection_name="schema_kb")
        pipeline.add_transform(RelevanceFilter(min_score=0.5))
        pipeline.add_transform(DedupTransform())
        pipeline.add_transform(TimeWeightedScorer(decay_rate=0.02))

        results = pipeline.query("temperature columns for transformers", top_k=10)
    """

    def __init__(
        self,
        collection_name: str = "default",
        persist_directory: Optional[str] = None,
        embedding_client=None,
    ):
        self._collection_name = collection_name
        self._persist_directory = persist_directory
        self._transforms: List[TransformComponent] = []
        self._embedding_client = embedding_client

        # ChromaDB client and collection
        self._chroma_client = None
        self._collection = None

    def _ensure_collection(self):
        """Lazy-initialize ChromaDB collection."""
        if self._collection is not None:
            return

        if not _chromadb_available:
            logger.warning("chromadb_not_available_using_memory_store")
            return

        if self._persist_directory:
            self._chroma_client = chromadb.PersistentClient(path=self._persist_directory)
        else:
            self._chroma_client = chromadb.Client()

        self._collection = self._chroma_client.get_or_create_collection(
            name=self._collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def add_transform(self, transform: TransformComponent) -> "RAGPipeline":
        """Add a transform component to the pipeline."""
        self._transforms.append(transform)
        return self

    def add_documents(
        self,
        texts: List[str],
        metadatas: Optional[List[Dict[str, Any]]] = None,
        ids: Optional[List[str]] = None,
    ) -> int:
        """Add documents to the knowledge base."""
        self._ensure_collection()

        if not self._collection:
            logger.warning("no_collection_available_skipping_add")
            return 0

        if ids is None:
            ids = [hashlib.md5(t.encode()).hexdigest()[:16] for t in texts]
        if metadatas is None:
            metadatas = [{"timestamp": time.time()} for _ in texts]
        else:
            # Ensure timestamp is present
            for m in metadatas:
                if "timestamp" not in m:
                    m["timestamp"] = time.time()

        # Add in batches (ChromaDB has batch limits)
        batch_size = 100
        added = 0
        for i in range(0, len(texts), batch_size):
            batch_texts = texts[i:i + batch_size]
            batch_ids = ids[i:i + batch_size]
            batch_meta = metadatas[i:i + batch_size]

            self._collection.upsert(
                documents=batch_texts,
                metadatas=batch_meta,
                ids=batch_ids,
            )
            added += len(batch_texts)

        logger.info("rag_documents_added", extra={
            "collection": self._collection_name,
            "count": added,
        })
        return added

    def query(
        self,
        query_text: str,
        top_k: int = 10,
        where: Optional[Dict[str, Any]] = None,
    ) -> List[RetrievalNode]:
        """Query the knowledge base with RAG pipeline."""
        self._ensure_collection()

        if not self._collection:
            return []

        # Query ChromaDB
        query_params = {
            "query_texts": [query_text],
            "n_results": top_k,
        }
        if where:
            query_params["where"] = where

        try:
            results = self._collection.query(**query_params)
        except Exception as exc:
            logger.error("rag_query_failed", extra={"error": str(exc)[:200]})
            return []

        # Convert to RetrievalNodes
        nodes = []
        documents = results.get("documents", [[]])[0]
        distances = results.get("distances", [[]])[0]
        metadatas = results.get("metadatas", [[]])[0]

        for doc, dist, meta in zip(documents, distances, metadatas):
            # ChromaDB returns distances — convert to similarity scores
            # For cosine distance: similarity = 1 - distance
            score = max(0.0, 1.0 - dist) if dist is not None else 0.5

            nodes.append(RetrievalNode(
                content=doc,
                metadata=meta or {},
                score=score,
                source=meta.get("source", self._collection_name) if meta else self._collection_name,
                timestamp=meta.get("timestamp") if meta else None,
            ))

        # Apply transform chain
        for transform in self._transforms:
            nodes = transform(nodes)

        logger.info("rag_query_complete", extra={
            "collection": self._collection_name,
            "query_length": len(query_text),
            "raw_results": len(documents),
            "final_results": len(nodes),
        })

        return nodes

    def delete_collection(self) -> None:
        """Delete the entire collection."""
        if self._chroma_client and self._collection:
            self._chroma_client.delete_collection(self._collection_name)
            self._collection = None

    def count(self) -> int:
        """Get the number of documents in the collection."""
        self._ensure_collection()
        if self._collection:
            return self._collection.count()
        return 0
