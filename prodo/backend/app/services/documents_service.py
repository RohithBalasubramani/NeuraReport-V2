from __future__ import annotations
"""
Document Service - Core document editing operations.
"""



import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from pydantic import BaseModel

from backend.app.schemas import DocumentContent as SchemaDocumentContent

from backend.app.services.config import get_settings

logger = logging.getLogger("neura.documents")


def _utcnow() -> datetime:
    """Get current UTC time with timezone info."""
    return datetime.now(timezone.utc)


DocumentContent = SchemaDocumentContent


class Document(BaseModel):
    """Document model."""

    id: str
    name: str
    content: DocumentContent | dict[str, Any]
    content_type: str = "tiptap"  # tiptap, html, markdown
    version: int = 1
    created_at: str
    updated_at: str
    owner_id: Optional[str] = None
    is_template: bool = False
    track_changes_enabled: bool = False
    collaboration_enabled: bool = False
    tags: list[str] = []
    metadata: dict[str, Any] = {}


class DocumentVersion(BaseModel):
    """Document version for history tracking."""

    id: str
    document_id: str
    version: int
    content: DocumentContent | dict[str, Any]
    created_at: str
    created_by: Optional[str] = None
    change_summary: Optional[str] = None


class DocumentComment(BaseModel):
    """Document comment model."""

    id: str
    document_id: str
    selection_start: int
    selection_end: int
    text: str
    author_id: Optional[str] = None
    author_name: Optional[str] = None
    created_at: str
    resolved: bool = False
    replies: list["DocumentComment"] = []


class DocumentService:
    """Service for document CRUD operations."""

    def __init__(self, state_store=None, uploads_root: Optional[Path] = None):
        self._state_store = state_store
        base_root = get_settings().uploads_root
        self._uploads_root = uploads_root or (base_root / "documents")
        self._uploads_root.mkdir(parents=True, exist_ok=True)
        # Lock for file operations to prevent race conditions
        self._lock = threading.Lock()

    def _normalize_content(self, content: Optional[Any]) -> dict[str, Any]:
        """Normalize incoming content payloads to a plain dict."""
        if content is None:
            return {"type": "doc", "content": []}
        if isinstance(content, DocumentContent):
            return content.model_dump()
        if hasattr(content, "model_dump"):
            return content.model_dump()
        if isinstance(content, dict):
            return content
        return {"type": "doc", "content": []}

    def create(
        self,
        name: str,
        content: Optional[DocumentContent] = None,
        owner_id: Optional[str] = None,
        is_template: bool = False,
        metadata: Optional[dict] = None,
    ) -> Document:
        """Create a new document."""
        now = _utcnow().isoformat()
        doc = Document(
            id=str(uuid.uuid4()),
            name=name,
            content=self._normalize_content(content),
            created_at=now,
            updated_at=now,
            owner_id=owner_id,
            is_template=is_template,
            metadata=metadata or {},
        )
        with self._lock:
            self._save_document(doc)
        logger.info(f"Created document: {doc.id}")
        return doc

    def get(self, document_id: str) -> Optional[Document]:
        """Get a document by ID."""
        doc_path = self._get_document_path(document_id)
        if not doc_path:
            return None
        with self._lock:
            if not doc_path.exists():
                return None
            try:
                with open(doc_path, encoding="utf-8") as f:
                    data = json.load(f)
            except FileNotFoundError:
                return None
        return Document(**data)

    def update(
        self,
        document_id: str,
        name: Optional[str] = None,
        content: Optional[DocumentContent] = None,
        metadata: Optional[dict] = None,
        create_version: bool = True,
    ) -> Optional[Document]:
        """Update an existing document."""
        with self._lock:
            doc = self._get_unlocked(document_id)
            if not doc:
                return None

            # Create version snapshot before update
            if create_version:
                self._create_version(doc)

            # Update fields
            if name is not None:
                doc.name = name
            if content is not None:
                doc.content = DocumentContent(**self._normalize_content(content))
            if metadata is not None:
                doc.metadata.update(metadata)

            doc.updated_at = _utcnow().isoformat()
            doc.version += 1

            self._save_document(doc)
            logger.info(f"Updated document: {doc.id} to version {doc.version}")
            return doc

    def _get_unlocked(self, document_id: str) -> Optional[Document]:
        """Get document without acquiring lock (for internal use when lock is held)."""
        doc_path = self._get_document_path(document_id)
        if not doc_path or not doc_path.exists():
            return None
        with open(doc_path, encoding="utf-8") as f:
            data = json.load(f)
        return Document(**data)

    def delete(self, document_id: str) -> bool:
        """Delete a document."""
        with self._lock:
            doc_path = self._get_document_path(document_id)
            if not doc_path or not doc_path.exists():
                return False
            doc_path.unlink()
            # Also delete versions and comments
            doc_dir = self._get_document_dir(document_id)
            if doc_dir and doc_dir.exists():
                import shutil
                # Delete versions subdirectory
                versions_dir = doc_dir / "versions"
                if versions_dir.exists():
                    shutil.rmtree(versions_dir)
                # Delete comments subdirectory
                comments_dir = doc_dir / "comments"
                if comments_dir.exists():
                    shutil.rmtree(comments_dir)
            logger.info(f"Deleted document: {document_id}")
            return True

    def list_documents(
        self,
        owner_id: Optional[str] = None,
        is_template: Optional[bool] = None,
        tags: Optional[list[str]] = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[Document], int]:
        """List documents with optional filters."""
        documents = []
        # Collect file paths first under lock to avoid concurrent modification issues
        with self._lock:
            doc_files = list(self._uploads_root.glob("**/document.json"))

        for doc_file in doc_files:
            try:
                with open(doc_file, encoding="utf-8") as f:
                    data = json.load(f)
                doc = Document(**data)

                # Apply filters
                if owner_id and doc.owner_id != owner_id:
                    continue
                if is_template is not None and doc.is_template != is_template:
                    continue
                if tags and not any(t in doc.tags for t in tags):
                    continue

                documents.append(doc)
            except FileNotFoundError:
                # File was deleted between glob and read - skip it
                continue
            except Exception as e:
                logger.warning(f"Error loading document from {doc_file}: {e}")

        # Sort by updated_at descending
        documents.sort(key=lambda d: d.updated_at, reverse=True)
        return documents[offset:offset + limit], len(documents)

    def get_versions(self, document_id: str) -> list[DocumentVersion]:
        """Get all versions of a document."""
        versions_root = self._get_document_dir(document_id)
        if not versions_root:
            return []
        versions_dir = versions_root / "versions"
        if not versions_dir.exists():
            return []

        versions = []
        for version_file in versions_dir.glob("*.json"):
            try:
                with open(version_file, encoding="utf-8") as f:
                    data = json.load(f)
                versions.append(DocumentVersion(**data))
            except Exception as e:
                logger.warning(f"Error loading version from {version_file}: {e}")

        versions.sort(key=lambda v: v.version, reverse=True)
        return versions

    def add_comment(
        self,
        document_id: str,
        selection_start: int,
        selection_end: int,
        text: str,
        author_id: Optional[str] = None,
        author_name: Optional[str] = None,
    ) -> Optional[DocumentComment]:
        """Add a comment to a document."""
        with self._lock:
            doc = self._get_unlocked(document_id)
            if not doc:
                return None

            comment = DocumentComment(
                id=str(uuid.uuid4()),
                document_id=document_id,
                selection_start=selection_start,
                selection_end=selection_end,
                text=text,
                author_id=author_id,
                author_name=author_name,
                created_at=_utcnow().isoformat(),
            )

            self._save_comment(comment)
            logger.info(f"Added comment {comment.id} to document {document_id}")
            return comment

    def get_comments(self, document_id: str) -> list[DocumentComment]:
        """Get all comments for a document."""
        comments_root = self._get_document_dir(document_id)
        if not comments_root:
            return []
        comments_dir = comments_root / "comments"
        if not comments_dir.exists():
            return []

        comments = []
        for comment_file in comments_dir.glob("*.json"):
            try:
                with open(comment_file, encoding="utf-8") as f:
                    data = json.load(f)
                comments.append(DocumentComment(**data))
            except Exception as e:
                logger.warning(f"Error loading comment from {comment_file}: {e}")

        comments.sort(key=lambda c: c.created_at)
        return comments

    def resolve_comment(self, document_id: str, comment_id: str) -> bool:
        """Mark a comment as resolved."""
        comments = self.get_comments(document_id)
        for comment in comments:
            if comment.id == comment_id:
                comment.resolved = True
                self._save_comment(comment)
                return True
        return False

    def delete_comment(self, document_id: str, comment_id: str) -> bool:
        """Delete a comment from a document."""
        with self._lock:
            comments_dir = self._uploads_root / document_id / "comments"
            if not comments_dir.exists():
                return False
            comment_path = comments_dir / f"{comment_id}.json"
            if not comment_path.exists():
                return False
            comment_path.unlink()
            logger.info(f"Deleted comment {comment_id} from document {document_id}")
            return True

    def _get_document_path(self, document_id: str) -> Optional[Path]:
        """Get path to document JSON file."""
        doc_dir = self._get_document_dir(document_id)
        if not doc_dir:
            return None
        return doc_dir / "document.json"

    def _get_document_dir(self, document_id: str) -> Optional[Path]:
        normalized = self._normalize_id(document_id)
        if not normalized:
            return None
        return self._uploads_root / normalized

    def _normalize_id(self, document_id: str) -> Optional[str]:
        try:
            return str(uuid.UUID(str(document_id)))
        except (ValueError, TypeError):
            return None

    def _save_document(self, doc: Document) -> None:
        """Save document to disk."""
        doc_dir = self._uploads_root / doc.id
        doc_dir.mkdir(parents=True, exist_ok=True)
        doc_path = doc_dir / "document.json"
        with open(doc_path, "w", encoding="utf-8") as f:
            json.dump(doc.model_dump(), f, indent=2, ensure_ascii=False)

    def _create_version(self, doc: Document) -> DocumentVersion:
        """Create a version snapshot of a document."""
        version = DocumentVersion(
            id=str(uuid.uuid4()),
            document_id=doc.id,
            version=doc.version,
            content=doc.content,
            created_at=_utcnow().isoformat(),
        )

        versions_dir = self._uploads_root / doc.id / "versions"
        versions_dir.mkdir(parents=True, exist_ok=True)
        version_path = versions_dir / f"v{doc.version}.json"
        with open(version_path, "w", encoding="utf-8") as f:
            json.dump(version.model_dump(), f, indent=2, ensure_ascii=False)

        return version

    def _save_comment(self, comment: DocumentComment) -> None:
        """Save comment to disk."""
        comments_dir = self._uploads_root / comment.document_id / "comments"
        comments_dir.mkdir(parents=True, exist_ok=True)
        comment_path = comments_dir / f"{comment.id}.json"
        with open(comment_path, "w", encoding="utf-8") as f:
            json.dump(comment.model_dump(), f, indent=2, ensure_ascii=False)



# ── Originally: pdf_operations.py ──

"""
PDF Operations Service - PDF manipulation operations.
"""


import logging
import os
import uuid
from pathlib import Path
from typing import Optional, Sequence

from pydantic import BaseModel

from backend.app.services.config import get_settings

logger = logging.getLogger("neura.pdf_operations")


class PageInfo(BaseModel):
    """PDF page information."""

    page_number: int
    width: float
    height: float
    rotation: int = 0


class WatermarkConfig(BaseModel):
    """Watermark configuration."""

    text: str
    position: str = "center"  # center, diagonal, top, bottom
    font_size: int = 48
    opacity: float = 0.3
    color: str = "#808080"
    rotation: float = -45  # For diagonal


class RedactionRegion(BaseModel):
    """Region to redact in PDF."""

    page: int
    x: float
    y: float
    width: float
    height: float
    color: str = "#000000"


class PDFMergeResult(BaseModel):
    """Result of PDF merge operation."""

    output_path: str
    page_count: int
    source_files: list[str]


class PDFOperationsService:
    """Service for PDF manipulation operations."""

    def __init__(self, output_dir: Optional[Path] = None):
        base_root = get_settings().uploads_root
        self._output_dir = output_dir or (base_root / "pdf_outputs")
        self._output_dir.mkdir(parents=True, exist_ok=True)

    def _validate_pdf_input(
        self,
        pdf_path: Path,
        *,
        required_pages: Optional[list[int]] = None,
        operation: str = "process",
    ) -> None:
        """Validate a PDF file before performing operations.

        Centralizes file-existence, readability, corruption, and page-bounds
        checks that previously failed deep inside PyMuPDF with opaque errors.

        Args:
            pdf_path: Path to the PDF file
            required_pages: If specified, validate these page numbers exist
            operation: Name of the operation (for error messages)

        Raises:
            FileNotFoundError: If the file does not exist
            PermissionError: If the file is not readable
            ValueError: If the file is not a valid PDF or pages are out of range
        """
        if not pdf_path.exists():
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")

        if not os.access(pdf_path, os.R_OK):
            raise PermissionError(f"PDF file not readable: {pdf_path}")

        if pdf_path.stat().st_size == 0:
            raise ValueError(f"PDF file is empty: {pdf_path}")

        # Validate PDF header
        try:
            with open(pdf_path, "rb") as f:
                header = f.read(5)
                if header != b"%PDF-":
                    raise ValueError(
                        f"File does not appear to be a valid PDF (bad header): {pdf_path}"
                    )
        except (OSError, IOError) as e:
            raise ValueError(f"Cannot read PDF file: {pdf_path}: {e}") from e

        # Validate page numbers if specified
        if required_pages is not None:
            import fitz
            doc = None
            try:
                doc = fitz.open(str(pdf_path))
                total = doc.page_count
                for page_num in required_pages:
                    if page_num < 0 or page_num >= total:
                        raise ValueError(
                            f"Page {page_num} out of range for {operation} "
                            f"(PDF has {total} pages, valid range: 0-{total - 1})"
                        )
            except ValueError:
                raise
            except Exception as e:
                raise ValueError(f"Cannot open PDF for validation: {pdf_path}: {e}") from e
            finally:
                if doc:
                    doc.close()

    def get_page_info(self, pdf_path: Path) -> list[PageInfo]:
        """Get information about all pages in a PDF."""
        self._validate_pdf_input(pdf_path, operation="get_page_info")
        import fitz  # PyMuPDF

        doc = None
        try:
            doc = fitz.open(str(pdf_path))
            pages = []
            for i, page in enumerate(doc):
                rect = page.rect
                pages.append(PageInfo(
                    page_number=i,
                    width=rect.width,
                    height=rect.height,
                    rotation=page.rotation,
                ))
            return pages
        except Exception as e:
            logger.error(f"Error getting page info: {e}")
            raise
        finally:
            if doc:
                doc.close()

    def reorder_pages(
        self,
        pdf_path: Path,
        new_order: list[int],
        output_path: Optional[Path] = None,
    ) -> Path:
        """Reorder pages in a PDF according to new_order list."""
        self._validate_pdf_input(pdf_path, required_pages=new_order, operation="reorder_pages")
        import fitz

        doc = None
        new_doc = None
        try:
            doc = fitz.open(str(pdf_path))

            # Validate page numbers
            total_pages = doc.page_count
            for page_num in new_order:
                if page_num < 0 or page_num >= total_pages:
                    raise ValueError(f"Invalid page number: {page_num}")

            # Create new document with reordered pages
            new_doc = fitz.open()
            for page_num in new_order:
                new_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

            # Save to output path
            if output_path is None:
                output_path = self._output_dir / f"{uuid.uuid4()}_reordered.pdf"

            new_doc.save(str(output_path))
            logger.info(f"Reordered pages to: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Error reordering pages: {e}")
            raise
        finally:
            if new_doc:
                new_doc.close()
            if doc:
                doc.close()

    def add_watermark(
        self,
        pdf_path: Path,
        config: WatermarkConfig,
        output_path: Optional[Path] = None,
    ) -> Path:
        """Add a watermark to all pages of a PDF."""
        self._validate_pdf_input(pdf_path, operation="add_watermark")
        import fitz

        doc = None
        try:
            doc = fitz.open(str(pdf_path))

            for page in doc:
                rect = page.rect

                # Calculate position
                if config.position == "center":
                    point = fitz.Point(rect.width / 2, rect.height / 2)
                elif config.position == "diagonal":
                    point = fitz.Point(rect.width / 2, rect.height / 2)
                elif config.position == "top":
                    point = fitz.Point(rect.width / 2, 50)
                elif config.position == "bottom":
                    point = fitz.Point(rect.width / 2, rect.height - 50)
                else:
                    point = fitz.Point(rect.width / 2, rect.height / 2)

                # Parse color
                color = self._hex_to_rgb(config.color)

                rotate = 0
                morph = None
                if config.position == "diagonal":
                    angle = config.rotation or -45
                    morph = (point, fitz.Matrix(1, 1).prerotate(angle))

                page.insert_text(
                    point,
                    config.text,
                    fontsize=config.font_size,
                    color=color,
                    rotate=rotate,
                    morph=morph,
                    overlay=True,
                )

                # Apply opacity by setting blend mode
                # Note: PyMuPDF doesn't directly support opacity for text
                # For true opacity, would need to use pikepdf

            # Save to output path
            if output_path is None:
                output_path = self._output_dir / f"{uuid.uuid4()}_watermarked.pdf"

            doc.save(str(output_path))
            logger.info(f"Added watermark to: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Error adding watermark: {e}")
            raise
        finally:
            if doc:
                doc.close()

    def redact_regions(
        self,
        pdf_path: Path,
        regions: list[RedactionRegion],
        output_path: Optional[Path] = None,
    ) -> Path:
        """Redact specified regions in a PDF."""
        self._validate_pdf_input(pdf_path, operation="redact_regions")
        import fitz

        doc = None
        try:
            doc = fitz.open(str(pdf_path))

            for region in regions:
                if region.page < 0 or region.page >= doc.page_count:
                    continue

                page = doc[region.page]
                rect = fitz.Rect(
                    region.x,
                    region.y,
                    region.x + region.width,
                    region.y + region.height,
                )

                # Add redaction annotation
                page.add_redact_annot(rect, fill=self._hex_to_rgb(region.color))

            # Apply redactions
            for page in doc:
                page.apply_redactions()

            # Save to output path
            if output_path is None:
                output_path = self._output_dir / f"{uuid.uuid4()}_redacted.pdf"

            doc.save(str(output_path))
            logger.info(f"Applied redactions to: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Error applying redactions: {e}")
            raise
        finally:
            if doc:
                doc.close()

    def merge_pdfs(
        self,
        pdf_paths: Sequence[Path],
        output_path: Optional[Path] = None,
    ) -> PDFMergeResult:
        """Merge multiple PDFs into one."""
        import fitz

        merged_doc = None
        try:
            merged_doc = fitz.open()
            source_files = []

            for pdf_path in pdf_paths:
                try:
                    self._validate_pdf_input(pdf_path, operation="merge_pdfs")
                except (FileNotFoundError, PermissionError, ValueError) as e:
                    logger.warning(f"Skipping invalid PDF in merge: {e}")
                    continue

                doc = None
                try:
                    doc = fitz.open(str(pdf_path))
                    merged_doc.insert_pdf(doc)
                    source_files.append(str(pdf_path))
                finally:
                    if doc:
                        doc.close()

            # Save to output path
            if output_path is None:
                output_path = self._output_dir / f"{uuid.uuid4()}_merged.pdf"

            merged_doc.save(str(output_path))
            page_count = merged_doc.page_count

            logger.info(f"Merged {len(source_files)} PDFs to: {output_path}")
            return PDFMergeResult(
                output_path=str(output_path),
                page_count=page_count,
                source_files=source_files,
            )
        except Exception as e:
            logger.error(f"Error merging PDFs: {e}")
            raise
        finally:
            if merged_doc:
                merged_doc.close()

    def split_pdf(
        self,
        pdf_path: Path,
        page_ranges: list[tuple[int, int]],
        output_dir: Optional[Path] = None,
    ) -> list[Path]:
        """Split a PDF into multiple files based on page ranges."""
        self._validate_pdf_input(pdf_path, operation="split_pdf")
        import fitz

        doc = None
        try:
            doc = fitz.open(str(pdf_path))
            output_dir = output_dir or self._output_dir
            output_paths = []

            for i, (start, end) in enumerate(page_ranges):
                # Validate range
                start = max(0, start)
                end = min(doc.page_count - 1, end)

                if start > end:
                    continue

                # Create new document with range
                new_doc = None
                try:
                    new_doc = fitz.open()
                    new_doc.insert_pdf(doc, from_page=start, to_page=end)

                    output_path = output_dir / f"{uuid.uuid4()}_split_{i+1}.pdf"
                    new_doc.save(str(output_path))
                    output_paths.append(output_path)
                finally:
                    if new_doc:
                        new_doc.close()

            logger.info(f"Split PDF into {len(output_paths)} files")
            return output_paths
        except Exception as e:
            logger.error(f"Error splitting PDF: {e}")
            raise
        finally:
            if doc:
                doc.close()

    def rotate_pages(
        self,
        pdf_path: Path,
        rotation: int,
        pages: Optional[list[int]] = None,
        output_path: Optional[Path] = None,
    ) -> Path:
        """Rotate pages in a PDF."""
        self._validate_pdf_input(pdf_path, operation="rotate_pages")
        import fitz

        doc = None
        try:
            doc = fitz.open(str(pdf_path))

            # Normalize rotation to 0, 90, 180, or 270
            rotation = rotation % 360
            if rotation not in [0, 90, 180, 270]:
                rotation = 0

            # Rotate specified pages or all pages
            pages_to_rotate = pages if pages else list(range(doc.page_count))

            for page_num in pages_to_rotate:
                if 0 <= page_num < doc.page_count:
                    page = doc[page_num]
                    page.set_rotation(rotation)

            # Save to output path
            if output_path is None:
                output_path = self._output_dir / f"{uuid.uuid4()}_rotated.pdf"

            doc.save(str(output_path))
            logger.info(f"Rotated pages to: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Error rotating pages: {e}")
            raise
        finally:
            if doc:
                doc.close()

    def extract_pages(
        self,
        pdf_path: Path,
        pages: list[int],
        output_path: Optional[Path] = None,
    ) -> Path:
        """Extract specific pages from a PDF."""
        self._validate_pdf_input(pdf_path, operation="extract_pages")
        import fitz

        doc = None
        new_doc = None
        try:
            doc = fitz.open(str(pdf_path))
            new_doc = fitz.open()

            for page_num in pages:
                if 0 <= page_num < doc.page_count:
                    new_doc.insert_pdf(doc, from_page=page_num, to_page=page_num)

            # Save to output path
            if output_path is None:
                output_path = self._output_dir / f"{uuid.uuid4()}_extracted.pdf"

            new_doc.save(str(output_path))
            logger.info(f"Extracted {len(pages)} pages to: {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Error extracting pages: {e}")
            raise
        finally:
            if new_doc:
                new_doc.close()
            if doc:
                doc.close()

    def _hex_to_rgb(self, hex_color: str) -> tuple[float, float, float]:
        """Convert hex color to RGB tuple (0-1 range)."""
        hex_color = hex_color.lstrip("#")
        r = int(hex_color[0:2], 16) / 255
        g = int(hex_color[2:4], 16) / 255
        b = int(hex_color[4:6], 16) / 255
        return (r, g, b)



# ── Originally: collaboration.py ──

"""
Collaboration Service - Real-time document collaboration using Y.js.
"""


import json
import logging
import threading
import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel
from fastapi import WebSocket, WebSocketDisconnect

logger = logging.getLogger("neura.collaboration")


def _utcnow() -> datetime:
    """Get current UTC time with timezone info."""
    return datetime.now(timezone.utc)


class CollaborationSession(BaseModel):
    """Collaboration session model."""

    id: str
    document_id: str
    created_at: str
    participants: list[str] = []
    websocket_url: Optional[str] = None
    is_active: bool = True


class CollaboratorPresence(BaseModel):
    """Collaborator presence information."""

    user_id: str
    user_name: str
    cursor_position: Optional[int] = None
    selection_start: Optional[int] = None
    selection_end: Optional[int] = None
    color: str = "#3B82F6"  # Default blue
    last_seen: str


class CollaborationService:
    """Service for real-time collaboration."""

    # Color palette for collaborators
    COLORS = [
        "#3B82F6",  # Blue
        "#10B981",  # Green
        "#F59E0B",  # Amber
        "#EF4444",  # Red
        "#8B5CF6",  # Violet
        "#EC4899",  # Pink
        "#06B6D4",  # Cyan
        "#84CC16",  # Lime
    ]

    def __init__(self, websocket_base_url: str = "ws://localhost:8500"):
        self._sessions: dict[str, CollaborationSession] = {}
        self._presence: dict[str, dict[str, CollaboratorPresence]] = {}
        self._websocket_base_url = websocket_base_url
        self._color_index = 0
        # Thread lock for protecting shared state
        self._lock = threading.Lock()

    def set_websocket_base_url(self, websocket_base_url: str) -> None:
        """Update the base URL used to build websocket session links."""
        if not websocket_base_url:
            return
        with self._lock:
            self._websocket_base_url = websocket_base_url
            for session in self._sessions.values():
                if session.is_active:
                    session.websocket_url = f"{self._websocket_base_url}/ws/collab/{session.document_id}"

    def start_session(
        self,
        document_id: str,
        user_id: Optional[str] = None,
    ) -> CollaborationSession:
        """Start a new collaboration session for a document."""
        with self._lock:
            # Check if session already exists
            for session in self._sessions.values():
                if session.document_id == document_id and session.is_active:
                    if user_id:
                        self._join_session_unlocked(session.id, user_id)
                    return session

            # Create new session
            session = CollaborationSession(
                id=str(uuid.uuid4()),
                document_id=document_id,
                created_at=_utcnow().isoformat(),
                websocket_url=f"{self._websocket_base_url}/ws/collab/{document_id}",
            )

            self._sessions[session.id] = session
            self._presence[session.id] = {}

            if user_id:
                self._join_session_unlocked(session.id, user_id)

            logger.info(f"Started collaboration session {session.id} for document {document_id}")
            return session

    def _join_session_unlocked(
        self,
        session_id: str,
        user_id: str,
        user_name: Optional[str] = None,
    ) -> Optional[CollaboratorPresence]:
        """Join session without acquiring lock (for internal use when lock is already held)."""
        if session_id not in self._sessions:
            return None

        session = self._sessions[session_id]
        if user_id not in session.participants:
            session.participants.append(user_id)

        # Create presence
        presence = CollaboratorPresence(
            user_id=user_id,
            user_name=user_name or f"User {user_id[:8]}",
            color=self._get_next_color_unlocked(),
            last_seen=_utcnow().isoformat(),
        )

        self._presence[session_id][user_id] = presence
        logger.info(f"User {user_id} joined session {session_id}")
        return presence

    def join_session(
        self,
        session_id: str,
        user_id: str,
        user_name: Optional[str] = None,
    ) -> Optional[CollaboratorPresence]:
        """Join an existing collaboration session."""
        with self._lock:
            return self._join_session_unlocked(session_id, user_id, user_name)

    def leave_session(self, session_id: str, user_id: str) -> bool:
        """Leave a collaboration session."""
        with self._lock:
            if session_id not in self._sessions:
                return False

            session = self._sessions[session_id]
            if user_id in session.participants:
                session.participants.remove(user_id)

            if user_id in self._presence.get(session_id, {}):
                del self._presence[session_id][user_id]

            # End session if no participants
            if not session.participants:
                self._end_session_unlocked(session_id)

            logger.info(f"User {user_id} left session {session_id}")
            return True

    def _end_session_unlocked(self, session_id: str) -> bool:
        """End session without acquiring lock (for internal use)."""
        if session_id not in self._sessions:
            return False

        self._sessions[session_id].is_active = False
        logger.info(f"Ended collaboration session {session_id}")
        return True

    def end_session(self, session_id: str) -> bool:
        """End a collaboration session."""
        with self._lock:
            return self._end_session_unlocked(session_id)

    def update_presence(
        self,
        session_id: str,
        user_id: str,
        cursor_position: Optional[int] = None,
        selection_start: Optional[int] = None,
        selection_end: Optional[int] = None,
    ) -> Optional[CollaboratorPresence]:
        """Update a collaborator's presence."""
        with self._lock:
            if session_id not in self._presence:
                return None
            if user_id not in self._presence[session_id]:
                return None

            presence = self._presence[session_id][user_id]
            if cursor_position is not None:
                presence.cursor_position = cursor_position
            if selection_start is not None:
                presence.selection_start = selection_start
            if selection_end is not None:
                presence.selection_end = selection_end
            presence.last_seen = _utcnow().isoformat()

            return presence

    def get_session(self, session_id: str) -> Optional[CollaborationSession]:
        """Get a collaboration session by ID."""
        with self._lock:
            return self._sessions.get(session_id)

    def get_session_by_document(self, document_id: str) -> Optional[CollaborationSession]:
        """Get active session for a document."""
        with self._lock:
            for session in self._sessions.values():
                if session.document_id == document_id and session.is_active:
                    return session
            return None

    def get_presence(self, session_id: str) -> list[CollaboratorPresence]:
        """Get all collaborator presence for a session."""
        with self._lock:
            if session_id not in self._presence:
                return []
            return list(self._presence[session_id].values())

    def _get_next_color_unlocked(self) -> str:
        """Get next color from palette (without lock)."""
        color = self.COLORS[self._color_index % len(self.COLORS)]
        self._color_index += 1
        return color

    def _get_next_color(self) -> str:
        """Get next color from palette."""
        with self._lock:
            return self._get_next_color_unlocked()


# WebSocket handler for Y.js synchronization
class YjsWebSocketHandler:
    """WebSocket handler for Y.js document synchronization."""

    def __init__(self, collaboration_service: CollaborationService):
        self._collab_service = collaboration_service
        self._connections: dict[str, set] = {}  # document_id -> set of websockets

    async def handle_connection(
        self,
        websocket: WebSocket,
        document_id: str,
        user_id: str,
    ):
        """Handle a new WebSocket connection for collaboration."""
        # Initialize connection set for document
        if document_id not in self._connections:
            self._connections[document_id] = set()

        await websocket.accept()
        self._connections[document_id].add(websocket)

        # Get or create session
        session = self._collab_service.start_session(document_id, user_id)

        try:
            async for message in websocket.iter_bytes():
                await self._handle_message(websocket, document_id, user_id, message)
        except WebSocketDisconnect:
            pass
        finally:
            self._connections[document_id].discard(websocket)
            self._collab_service.leave_session(session.id, user_id)

    async def _handle_message(
        self,
        websocket,
        document_id: str,
        user_id: str,
        message: bytes,
    ):
        """Handle incoming Y.js sync message."""
        # Broadcast to all other connections for this document
        if document_id in self._connections:
            for conn in self._connections[document_id]:
                if conn != websocket:
                    try:
                        if isinstance(message, bytes):
                            await conn.send_bytes(message)
                        else:
                            await conn.send_text(str(message))
                    except Exception as e:
                        logger.warning(f"Failed to send to connection: {e}")

    async def broadcast_presence(self, document_id: str, presence_data: dict):
        """Broadcast presence update to all connections."""
        if document_id not in self._connections:
            return

        message = json.dumps({"type": "presence", "data": presence_data})
        for conn in self._connections[document_id]:
            try:
                await conn.send_text(message)
            except Exception as e:
                logger.warning(f"Failed to broadcast presence: {e}")


# ============================================================================
# PDF Digital Signing Service
# ============================================================================

import hashlib
import io


class PDFSigningService:
    """Service for adding digital signatures to PDFs."""

    def __init__(self):
        self._certificates: dict[str, dict] = {}

    async def sign_pdf(
        self,
        pdf_content: bytes,
        *,
        signer_name: str,
        reason: Optional[str] = None,
        location: Optional[str] = None,
        contact_info: Optional[str] = None,
        certificate_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """Add a digital signature to a PDF document."""
        try:
            import fitz  # PyMuPDF
        except ImportError:
            logger.warning("PyMuPDF not available, using basic signature")
            return self._add_basic_signature(
                pdf_content, signer_name, reason, location, contact_info
            )

        try:
            doc = fitz.open(stream=pdf_content, filetype="pdf")
            page = doc[0]

            rect = fitz.Rect(
                page.rect.width - 200,
                page.rect.height - 80,
                page.rect.width - 20,
                page.rect.height - 20,
            )

            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
            sig_text = f"Digitally signed by: {signer_name}\n"
            if reason:
                sig_text += f"Reason: {reason}\n"
            if location:
                sig_text += f"Location: {location}\n"
            sig_text += f"Date: {timestamp}"

            page.add_freetext_annot(
                rect,
                sig_text,
                fontsize=8,
                fontname="helv",
                text_color=(0, 0, 0.5),
                fill_color=(0.95, 0.95, 1),
                border_color=(0, 0, 0.5),
            )

            content_hash = hashlib.sha256(pdf_content).hexdigest()
            signature_hash = hashlib.sha256(
                f"{signer_name}{timestamp}{content_hash}".encode()
            ).hexdigest()

            metadata = doc.metadata
            metadata["keywords"] = f"signed,{signature_hash[:16]}"
            doc.set_metadata(metadata)

            output = io.BytesIO()
            doc.save(output)
            doc.close()

            return {
                "success": True,
                "signed_pdf": output.getvalue(),
                "signature": {
                    "signer": signer_name,
                    "reason": reason,
                    "location": location,
                    "contact": contact_info,
                    "timestamp": timestamp,
                    "hash": signature_hash,
                    "algorithm": "SHA-256",
                },
            }

        except Exception:
            logger.exception("PDF signing failed")
            return {"success": False, "error": "PDF signing failed"}

    def _add_basic_signature(
        self,
        pdf_content: bytes,
        signer_name: str,
        reason: Optional[str],
        location: Optional[str],
        contact_info: Optional[str],
    ) -> dict[str, Any]:
        """Add a basic signature without PyMuPDF (metadata only)."""
        timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
        content_hash = hashlib.sha256(pdf_content).hexdigest()
        signature_hash = hashlib.sha256(
            f"{signer_name}{timestamp}{content_hash}".encode()
        ).hexdigest()

        return {
            "success": True,
            "signed_pdf": pdf_content,
            "signature": {
                "signer": signer_name,
                "reason": reason,
                "location": location,
                "contact": contact_info,
                "timestamp": timestamp,
                "hash": signature_hash,
                "algorithm": "SHA-256",
                "type": "metadata_only",
            },
        }

    async def verify_signature(
        self,
        pdf_content: bytes,
        signature_hash: str,
    ) -> dict[str, Any]:
        """Verify a PDF signature."""
        try:
            import fitz
            doc = fitz.open(stream=pdf_content, filetype="pdf")
            metadata = doc.metadata
            doc.close()

            keywords = metadata.get("keywords", "")
            if f"signed,{signature_hash[:16]}" in keywords:
                return {"valid": True, "message": "Signature verified"}

            return {"valid": False, "message": "Signature not found or invalid"}

        except Exception:
            logger.exception("Signature verification failed")
            return {"valid": False, "error": "Signature verification failed"}

    def register_certificate(self, certificate_id: str, certificate_data: dict) -> None:
        """Register a certificate for signing."""
        self._certificates[certificate_id] = certificate_data

    def list_certificates(self) -> list[dict]:
        """List registered certificates."""
        return [
            {"id": cid, **{k: v for k, v in data.items() if k != "private_key"}}
            for cid, data in self._certificates.items()
        ]


pdf_signing_service = PDFSigningService()
