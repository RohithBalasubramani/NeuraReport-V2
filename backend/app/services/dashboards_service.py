from __future__ import annotations
"""
Dashboard Service - Persistent dashboard CRUD via StateStore.

Replaces the in-memory dict storage from the routes layer with proper
state-store-backed persistence.  All dashboards survive server restarts.

Design Principles:
- State store atomic transactions for all writes
- Thread-safe via StateStore's internal RLock
- Timestamps are ISO-8601 UTC, generated server-side
- Dashboard IDs are UUID4 strings
"""


import copy
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.repositories import state_store
from backend.app.common import utc_now, utc_now_iso

logger = logging.getLogger("neura.dashboards.service")




class DashboardService:
    """Persistent dashboard CRUD backed by the NeuraReport state store."""

    # ── Create ──────────────────────────────────────────────────────────

    def create_dashboard(
        self,
        *,
        name: str,
        description: Optional[str] = None,
        widgets: Optional[List[Dict[str, Any]]] = None,
        filters: Optional[List[Dict[str, Any]]] = None,
        theme: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a new dashboard and persist it.

        Returns the full dashboard dict including generated ``id`` and
        timestamps.
        """
        dashboard_id = str(uuid.uuid4())
        now = utc_now_iso()

        dashboard: Dict[str, Any] = {
            "id": dashboard_id,
            "name": name,
            "description": description,
            "widgets": widgets or [],
            "filters": filters or [],
            "theme": theme,
            "refresh_interval": None,
            "metadata": {},
            "created_at": now,
            "updated_at": now,
        }

        with state_store.transaction() as state:
            state.setdefault("dashboards", {})
            state["dashboards"][dashboard_id] = dashboard

        logger.info(
            "dashboard_created",
            extra={"event": "dashboard_created", "dashboard_id": dashboard_id, "dashboard_name": name},
        )
        return dashboard

    # ── Read ────────────────────────────────────────────────────────────

    def get_dashboard(self, dashboard_id: str) -> Optional[Dict[str, Any]]:
        """Return a single dashboard by ID, or ``None`` if missing."""
        with state_store.transaction() as state:
            dashboard = state.get("dashboards", {}).get(dashboard_id)
            if dashboard is None:
                return None
            result = copy.deepcopy(dashboard)
            result.setdefault("metadata", {})
            return result

    def list_dashboards(
        self,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> Dict[str, Any]:
        """Return paginated list of dashboards, newest-updated first."""
        with state_store.transaction() as state:
            dashboards = copy.deepcopy(list(state.get("dashboards", {}).values()))

        # Ensure every dashboard has a metadata key (backfill for pre-existing)
        for d in dashboards:
            d.setdefault("metadata", {})
        dashboards.sort(key=lambda d: d.get("updated_at", ""), reverse=True)
        return {
            "dashboards": dashboards[offset : offset + limit],
            "total": len(dashboards),
            "limit": limit,
            "offset": offset,
        }

    # ── Update ──────────────────────────────────────────────────────────

    def update_dashboard(
        self,
        dashboard_id: str,
        *,
        name: Optional[str] = None,
        description: Optional[str] = None,
        widgets: Optional[List[Dict[str, Any]]] = None,
        filters: Optional[List[Dict[str, Any]]] = None,
        theme: Optional[str] = None,
        refresh_interval: Optional[int] = None,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update an existing dashboard.  Returns ``None`` if not found."""
        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            dashboard = dashboards.get(dashboard_id)
            if dashboard is None:
                return None

            if name is not None:
                dashboard["name"] = name
            if description is not None:
                dashboard["description"] = description
            if widgets is not None:
                dashboard["widgets"] = widgets
            if filters is not None:
                dashboard["filters"] = filters
            if theme is not None:
                dashboard["theme"] = theme
            if refresh_interval is not None:
                dashboard["refresh_interval"] = refresh_interval
            if metadata is not None:
                dashboard["metadata"] = metadata

            dashboard["updated_at"] = utc_now_iso()
            state["dashboards"][dashboard_id] = dashboard

        logger.info(
            "dashboard_updated",
            extra={"event": "dashboard_updated", "dashboard_id": dashboard_id},
        )
        return dashboard

    # ── Delete ──────────────────────────────────────────────────────────

    def delete_dashboard(self, dashboard_id: str) -> bool:
        """Delete a dashboard.  Returns ``True`` if removed, ``False`` if absent."""
        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            if dashboard_id not in dashboards:
                return False
            del dashboards[dashboard_id]

            # Also remove any widgets that reference this dashboard
            widgets = state.get("dashboard_widgets", {})
            orphan_ids = [
                wid for wid, w in widgets.items()
                if w.get("dashboard_id") == dashboard_id
            ]
            for wid in orphan_ids:
                del widgets[wid]

            # Remove from favorites
            favs = state.get("favorites", {})
            dash_favs = favs.get("dashboards", [])
            if dashboard_id in dash_favs:
                dash_favs.remove(dashboard_id)

        logger.info(
            "dashboard_deleted",
            extra={"event": "dashboard_deleted", "dashboard_id": dashboard_id},
        )
        return True

    # ── Favorites ───────────────────────────────────────────────────────

    def toggle_favorite(self, dashboard_id: str) -> bool:
        """Toggle favorite status.  Returns new ``is_favorite`` state."""
        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            if dashboard_id not in dashboards:
                raise ValueError(f"Dashboard {dashboard_id} not found")

            favs = state.setdefault("favorites", {})
            dash_favs: list = favs.setdefault("dashboards", [])

            if dashboard_id in dash_favs:
                dash_favs.remove(dashboard_id)
                is_fav = False
            else:
                dash_favs.append(dashboard_id)
                is_fav = True

        return is_fav

    def is_favorite(self, dashboard_id: str) -> bool:
        """Check whether a dashboard is favourited."""
        with state_store.transaction() as state:
            favs = state.get("favorites", {})
            return dashboard_id in favs.get("dashboards", [])

    # ── Templates ────────────────────────────────────────────────────────

    def list_templates(self) -> List[Dict[str, Any]]:
        """Return all saved dashboard templates."""
        with state_store.transaction() as state:
            templates = state.get("dashboard_templates", {})
            return copy.deepcopy(list(templates.values()))

    def get_template(self, template_id: str) -> Optional[Dict[str, Any]]:
        """Return a single dashboard template by ID, or ``None``."""
        with state_store.transaction() as state:
            template = state.get("dashboard_templates", {}).get(template_id)
            return copy.deepcopy(template) if template else None

    def save_template(self, template: Dict[str, Any]) -> None:
        """Persist a dashboard template."""
        with state_store.transaction() as state:
            state.setdefault("dashboard_templates", {})
            state["dashboard_templates"][template["id"]] = template
        logger.info(
            "dashboard_template_saved",
            extra={"event": "dashboard_template_saved", "template_id": template["id"]},
        )

    # ── Stats ───────────────────────────────────────────────────────────

    def get_stats(self) -> Dict[str, Any]:
        """Return dashboard-related statistics."""
        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            total_widgets = sum(
                len(d.get("widgets", []))
                for d in dashboards.values()
            )
            favs = state.get("favorites", {})
            total_favs = sum(len(v) for v in favs.values())

        return {
            "total_dashboards": len(dashboards),
            "total_widgets": total_widgets,
            "total_favorites": total_favs,
        }



# ── Originally: snapshot_service.py ──

"""
Snapshot Service - Dashboard snapshot generation and storage.

Generates point-in-time snapshots of dashboards for export, sharing,
and audit trails.  Snapshots are stored as metadata in the state store;
the actual rendered bytes (PNG/PDF) are stored on the filesystem under
the uploads directory.

Design Principles:
- Snapshot metadata persisted in state store
- Rendered files stored on disk (not in JSON state)
- Snapshots are immutable once created
- Retention policy: keep last N snapshots per dashboard
"""

import hashlib
import html as html_mod
import json
import logging
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.app.repositories import state_store
from backend.app.services.config import get_settings

try:
    from backend.app.services.infra_services import render_html_to_png as _render_png
except ImportError:  # pragma: no cover
    _render_png = None  # type: ignore[assignment]

logger = logging.getLogger("neura.dashboards.snapshot_service")

MAX_SNAPSHOTS_PER_DASHBOARD = 20




class SnapshotService:
    """Generate and manage dashboard snapshots."""

    def _snapshots_dir(self) -> Path:
        """Return (and lazily create) the snapshots directory."""
        settings = get_settings()
        base = settings.uploads_dir / "dashboard_snapshots"
        base.mkdir(parents=True, exist_ok=True)
        return base

    # ── Create snapshot ──────────────────────────────────────────────────

    def create_snapshot(
        self,
        dashboard_id: str,
        *,
        format: str = "png",
        title: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Create a snapshot record for a dashboard.

        The actual rendering (Playwright / wkhtmltoimage) is delegated
        to the render service if available.  This method stores the
        metadata and returns it immediately so callers can poll or
        stream the result.

        Raises ``ValueError`` if the dashboard does not exist.
        """
        if format not in ("png", "pdf"):
            raise ValueError(f"Unsupported snapshot format: {format}")

        snapshot_id = str(uuid.uuid4())
        now = utc_now_iso()

        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            dashboard = dashboards.get(dashboard_id)
            if dashboard is None:
                raise ValueError(f"Dashboard {dashboard_id} not found")

            # Capture current dashboard state as frozen data
            frozen = json.loads(json.dumps(dashboard, default=str))

            # Compute a content hash so identical dashboards produce
            # the same fingerprint (useful for deduplication).
            content_hash = hashlib.sha256(
                json.dumps(frozen, sort_keys=True).encode()
            ).hexdigest()[:16]

            snapshot: Dict[str, Any] = {
                "id": snapshot_id,
                "dashboard_id": dashboard_id,
                "title": title or f"Snapshot of {dashboard.get('name', 'Dashboard')}",
                "format": format,
                "status": "pending",
                "content_hash": content_hash,
                "file_path": None,
                "file_size_bytes": None,
                "dashboard_data": frozen,
                "created_at": now,
            }

            snapshots = state.setdefault("dashboard_snapshots", {})
            snapshots[snapshot_id] = snapshot

            # Enforce retention limit per dashboard
            dash_snaps = [
                s for s in snapshots.values()
                if s.get("dashboard_id") == dashboard_id
            ]
            if len(dash_snaps) > MAX_SNAPSHOTS_PER_DASHBOARD:
                dash_snaps.sort(key=lambda s: s.get("created_at", ""))
                to_remove = dash_snaps[: len(dash_snaps) - MAX_SNAPSHOTS_PER_DASHBOARD]
                for old in to_remove:
                    snapshots.pop(old["id"], None)

        logger.info(
            "snapshot_created",
            extra={
                "event": "snapshot_created",
                "snapshot_id": snapshot_id,
                "dashboard_id": dashboard_id,
                "format": format,
            },
        )
        return snapshot

    # ── Mark rendered ───────────────────────────────────────────────────

    def mark_rendered(
        self,
        snapshot_id: str,
        *,
        file_path: str,
        file_size_bytes: int,
    ) -> Optional[Dict[str, Any]]:
        """Update snapshot after rendering completes.

        Called by the render pipeline once the file is written to disk.
        """
        with state_store.transaction() as state:
            snapshots = state.get("dashboard_snapshots", {})
            snapshot = snapshots.get(snapshot_id)
            if snapshot is None:
                return None

            snapshot["status"] = "completed"
            snapshot["file_path"] = file_path
            snapshot["file_size_bytes"] = file_size_bytes
            state["dashboard_snapshots"][snapshot_id] = snapshot

        return snapshot

    def mark_failed(self, snapshot_id: str, *, error: str) -> Optional[Dict[str, Any]]:
        """Mark a snapshot as failed."""
        with state_store.transaction() as state:
            snapshots = state.get("dashboard_snapshots", {})
            snapshot = snapshots.get(snapshot_id)
            if snapshot is None:
                return None

            snapshot["status"] = "failed"
            snapshot["error"] = error
            state["dashboard_snapshots"][snapshot_id] = snapshot

        return snapshot

    # ── Read ────────────────────────────────────────────────────────────

    def get_snapshot(self, snapshot_id: str) -> Optional[Dict[str, Any]]:
        """Return a snapshot by ID."""
        with state_store.transaction() as state:
            return state.get("dashboard_snapshots", {}).get(snapshot_id)

    def list_snapshots(
        self,
        dashboard_id: str,
        *,
        limit: int = 20,
    ) -> List[Dict[str, Any]]:
        """Return snapshots for a dashboard, newest first."""
        with state_store.transaction() as state:
            all_snaps = state.get("dashboard_snapshots", {}).values()
            filtered = [
                s for s in all_snaps
                if s.get("dashboard_id") == dashboard_id
            ]

        filtered.sort(key=lambda s: s.get("created_at", ""), reverse=True)
        return filtered[:limit]

    # ── Delete ──────────────────────────────────────────────────────────

    def delete_snapshot(self, snapshot_id: str) -> bool:
        """Delete a snapshot record and its file (if any)."""
        file_path: Optional[str] = None

        with state_store.transaction() as state:
            snapshots = state.get("dashboard_snapshots", {})
            snapshot = snapshots.pop(snapshot_id, None)
            if snapshot is None:
                return False
            file_path = snapshot.get("file_path")

        # Best-effort file cleanup
        if file_path:
            try:
                p = Path(file_path)
                if p.exists():
                    p.unlink()
            except OSError as exc:
                logger.warning(
                    "snapshot_file_cleanup_failed",
                    extra={"snapshot_id": snapshot_id, "error": str(exc)},
                )

        return True

    # ── Render ──────────────────────────────────────────────────────────

    def render_snapshot(self, snapshot_id: str) -> Dict[str, Any]:
        """Render a pending snapshot to its target format.

        Generates a simple HTML representation of the dashboard,
        renders it to PNG via Playwright (if available), and updates
        the snapshot record.

        Returns the updated snapshot dict.
        Raises ``RuntimeError`` if the renderer is unavailable.
        """
        snapshot = self.get_snapshot(snapshot_id)
        if snapshot is None:
            raise ValueError(f"Snapshot {snapshot_id} not found")

        if snapshot.get("status") != "pending":
            return snapshot  # already rendered or failed

        fmt = snapshot.get("format", "png")
        if fmt != "png":
            self.mark_failed(snapshot_id, error=f"Rendering format '{fmt}' not yet supported (only PNG)")
            return self.get_snapshot(snapshot_id) or snapshot

        if _render_png is None:
            self.mark_failed(snapshot_id, error="Playwright renderer not available")
            return self.get_snapshot(snapshot_id) or snapshot

        dashboard_data = snapshot.get("dashboard_data", {})
        out_dir = self._snapshots_dir()
        out_path = out_dir / f"{snapshot_id}.png"

        # Generate HTML to a temp file, render, then clean up
        html_content = _dashboard_to_html(dashboard_data)
        tmp_html = None
        try:
            tmp_fd = tempfile.NamedTemporaryFile(
                suffix=".html", dir=str(out_dir), delete=False, mode="w", encoding="utf-8",
            )
            tmp_html = Path(tmp_fd.name)
            tmp_fd.write(html_content)
            tmp_fd.close()

            _render_png(tmp_html, out_path)

            file_size = out_path.stat().st_size
            self.mark_rendered(
                snapshot_id,
                file_path=str(out_path),
                file_size_bytes=file_size,
            )
            logger.info(
                "snapshot_rendered",
                extra={
                    "event": "snapshot_rendered",
                    "snapshot_id": snapshot_id,
                    "file_size_bytes": file_size,
                },
            )
        except Exception as exc:
            self.mark_failed(snapshot_id, error="Snapshot rendering failed")
            logger.exception(
                "snapshot_render_failed",
                extra={
                    "event": "snapshot_render_failed",
                    "snapshot_id": snapshot_id,
                },
            )
        finally:
            if tmp_html and tmp_html.exists():
                try:
                    tmp_html.unlink()
                except OSError:
                    pass

        return self.get_snapshot(snapshot_id) or snapshot


def _dashboard_to_html(dashboard_data: Dict[str, Any]) -> str:
    """Generate a minimal HTML representation of a dashboard for rendering."""
    name = html_mod.escape(dashboard_data.get("name", "Dashboard"))
    desc = html_mod.escape(dashboard_data.get("description", "") or "")
    widgets = dashboard_data.get("widgets", [])

    widget_cards = []
    for w in widgets:
        config = w.get("config", {})
        w_title = html_mod.escape(config.get("title", "Widget"))
        w_type = html_mod.escape(config.get("type", "unknown"))
        # Cast to int to prevent CSS injection via non-integer values
        col_span = int(w.get("w", 4))
        row_span = int(w.get("h", 3))
        widget_cards.append(
            f'<div class="widget" style="grid-column: span {col_span}; '
            f'grid-row: span {row_span};">'
            f'<h3>{w_title}</h3>'
            f'<span class="badge">{w_type}</span>'
            f'</div>'
        )

    widgets_html = "\n".join(widget_cards) if widget_cards else "<p>No widgets configured.</p>"

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{name}</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
         margin: 40px; background: #f5f5f5; color: #333; }}
  h1 {{ margin-bottom: 4px; }}
  .desc {{ color: #666; margin-bottom: 24px; }}
  .grid {{ display: grid; grid-template-columns: repeat(12, 1fr);
           gap: 16px; }}
  .widget {{ background: #fff; border: 1px solid #ddd; border-radius: 8px;
             padding: 16px; min-height: 80px; }}
  .widget h3 {{ margin: 0 0 8px; font-size: 14px; }}
  .badge {{ display: inline-block; background: #e0e7ff; color: #3730a3;
            padding: 2px 8px; border-radius: 4px; font-size: 12px; }}
</style>
</head>
<body>
<h1>{name}</h1>
<p class="desc">{desc}</p>
<div class="grid">
{widgets_html}
</div>
</body>
</html>"""



# ── Originally: embed_service.py ──

"""
Embed Service - Dashboard embedding via short-lived tokens.

Generates signed tokens that allow read-only dashboard access
without API-key authentication.  Tokens are stored in state so they
can be revoked and their usage audited.

Design Principles:
- HMAC-SHA256 signed tokens (no external JWT library required)
- Configurable TTL (1-720 hours)
- Per-dashboard token revocation
- Usage counting for analytics
- Tokens validated by constant-time comparison
"""

import hashlib
import hmac
import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from backend.app.repositories import state_store
from backend.app.services.config import get_settings

logger = logging.getLogger("neura.dashboards.embed_service")

MAX_TOKENS_PER_DASHBOARD = 50




def _now_dt() -> datetime:
    return datetime.now(timezone.utc)


class EmbedService:
    """Generate and validate dashboard embed tokens."""

    def _signing_key(self) -> str:
        """Return the HMAC signing key (derived from JWT secret)."""
        settings = get_settings()
        return settings.jwt_secret.get_secret_value()

    def _sign_token(self, payload: str) -> str:
        """Create HMAC-SHA256 signature for a payload string."""
        key = self._signing_key().encode("utf-8")
        return hmac.new(key, payload.encode("utf-8"), hashlib.sha256).hexdigest()

    # ── Generate token ──────────────────────────────────────────────────

    def generate_embed_token(
        self,
        dashboard_id: str,
        *,
        expires_hours: int = 24,
        label: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Generate a new embed token for a dashboard.

        Returns a dict containing the token, embed URL, and metadata.
        Raises ``ValueError`` if the dashboard does not exist or
        ``expires_hours`` is out of range.
        """
        if not (1 <= expires_hours <= 720):
            raise ValueError("expires_hours must be between 1 and 720")

        token_id = str(uuid.uuid4())
        raw_token = secrets.token_urlsafe(32)
        now = _now_dt()
        expires_at = now + timedelta(hours=expires_hours)

        # Sign the token so we can verify without a DB lookup (optional fast path)
        signature = self._sign_token(f"{token_id}:{raw_token}:{dashboard_id}")
        full_token = f"{token_id}.{raw_token}.{signature[:16]}"

        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            if dashboard_id not in dashboards:
                raise ValueError(f"Dashboard {dashboard_id} not found")

            tokens = state.setdefault("dashboard_embed_tokens", {})

            record: Dict[str, Any] = {
                "id": token_id,
                "dashboard_id": dashboard_id,
                "token_hash": hashlib.sha256(full_token.encode()).hexdigest(),
                "label": label or f"Embed token for {dashboards[dashboard_id].get('name', 'Dashboard')}",
                "expires_at": expires_at.isoformat(),
                "created_at": utc_now_iso(),
                "revoked": False,
                "access_count": 0,
                "last_accessed_at": None,
            }
            tokens[token_id] = record

            # Enforce per-dashboard token limit (remove oldest expired first)
            dash_tokens = [
                t for t in tokens.values()
                if t.get("dashboard_id") == dashboard_id
            ]
            if len(dash_tokens) > MAX_TOKENS_PER_DASHBOARD:
                dash_tokens.sort(key=lambda t: t.get("created_at", ""))
                to_remove = dash_tokens[: len(dash_tokens) - MAX_TOKENS_PER_DASHBOARD]
                for old in to_remove:
                    tokens.pop(old["id"], None)

        logger.info(
            "embed_token_generated",
            extra={
                "event": "embed_token_generated",
                "token_id": token_id,
                "dashboard_id": dashboard_id,
                "expires_hours": expires_hours,
            },
        )

        return {
            "token_id": token_id,
            "embed_token": full_token,
            "embed_url": f"/embed/dashboard/{dashboard_id}?token={full_token}",
            "expires_at": expires_at.isoformat(),
            "expires_hours": expires_hours,
            "dashboard_id": dashboard_id,
        }

    # ── Validate token ──────────────────────────────────────────────────

    def validate_token(self, token: str) -> Optional[Dict[str, Any]]:
        """Validate an embed token.

        Returns the token record if valid, ``None`` if invalid/expired/revoked.
        Also increments the access counter.
        """
        token_hash = hashlib.sha256(token.encode()).hexdigest()

        with state_store.transaction() as state:
            tokens = state.get("dashboard_embed_tokens", {})

            for record in tokens.values():
                if not hmac.compare_digest(record.get("token_hash", ""), token_hash):
                    continue

                # Found matching token
                if record.get("revoked"):
                    return None

                expires_at = record.get("expires_at", "")
                if expires_at:
                    try:
                        exp_dt = datetime.fromisoformat(expires_at)
                        if _now_dt() > exp_dt:
                            return None
                    except (ValueError, TypeError):
                        return None

                # Update access stats
                record["access_count"] = record.get("access_count", 0) + 1
                record["last_accessed_at"] = utc_now_iso()

                return {
                    "token_id": record["id"],
                    "dashboard_id": record["dashboard_id"],
                    "label": record.get("label"),
                    "expires_at": record.get("expires_at"),
                }

        return None

    # ── Revoke token ────────────────────────────────────────────────────

    def revoke_token(self, token_id: str) -> bool:
        """Revoke an embed token.  Returns ``True`` if revoked."""
        with state_store.transaction() as state:
            tokens = state.get("dashboard_embed_tokens", {})
            record = tokens.get(token_id)
            if record is None:
                return False
            record["revoked"] = True

        logger.info(
            "embed_token_revoked",
            extra={"event": "embed_token_revoked", "token_id": token_id},
        )
        return True

    def revoke_all_for_dashboard(self, dashboard_id: str) -> int:
        """Revoke all tokens for a dashboard.  Returns count revoked."""
        count = 0
        with state_store.transaction() as state:
            tokens = state.get("dashboard_embed_tokens", {})
            for record in tokens.values():
                if (
                    record.get("dashboard_id") == dashboard_id
                    and not record.get("revoked")
                ):
                    record["revoked"] = True
                    count += 1
        return count

    # ── List tokens ─────────────────────────────────────────────────────

    def list_tokens(
        self,
        dashboard_id: str,
        *,
        include_revoked: bool = False,
    ) -> List[Dict[str, Any]]:
        """List embed tokens for a dashboard."""
        with state_store.transaction() as state:
            tokens = state.get("dashboard_embed_tokens", {}).values()
            filtered = [
                {
                    "token_id": t["id"],
                    "dashboard_id": t["dashboard_id"],
                    "label": t.get("label"),
                    "expires_at": t.get("expires_at"),
                    "revoked": t.get("revoked", False),
                    "access_count": t.get("access_count", 0),
                    "created_at": t.get("created_at"),
                    "last_accessed_at": t.get("last_accessed_at"),
                }
                for t in tokens
                if t.get("dashboard_id") == dashboard_id
                and (include_revoked or not t.get("revoked"))
            ]

        filtered.sort(key=lambda t: t.get("created_at", ""), reverse=True)
        return filtered



# ── Originally: widget_service.py ──

"""
Widget Service - Dashboard widget management via StateStore.

Handles adding, updating, removing, and reordering widgets within
dashboards.  Widget data is stored inside the parent dashboard record
(``dashboard["widgets"]`` list) for atomicity.

Design Principles:
- Widgets are embedded in dashboard records (no separate orphan risk)
- Widget IDs are UUID4 strings
- Position/size validated within sensible bounds
- Thread-safe via StateStore transactions
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from backend.app.repositories import state_store

logger = logging.getLogger("neura.dashboards.widget_service")

# Grid constraints (12-column layout)
MAX_GRID_COLS = 12
MAX_GRID_ROWS = 100
MIN_WIDGET_SIZE = 1
MAX_WIDGET_W = 12
MAX_WIDGET_H = 20




def _clamp(value: int, lo: int, hi: int) -> int:
    return max(lo, min(hi, value))


class WidgetService:
    """Manage widgets embedded within dashboard records."""

    # ── Add widget ──────────────────────────────────────────────────────

    def add_widget(
        self,
        dashboard_id: str,
        *,
        config: Dict[str, Any],
        x: int = 0,
        y: int = 0,
        w: int = 4,
        h: int = 3,
    ) -> Dict[str, Any]:
        """Add a widget to a dashboard.  Returns the new widget dict.

        Raises ``ValueError`` if the dashboard does not exist.
        """
        widget_id = str(uuid.uuid4())
        widget: Dict[str, Any] = {
            "id": widget_id,
            "config": config,
            "x": _clamp(x, 0, MAX_GRID_COLS - 1),
            "y": _clamp(y, 0, MAX_GRID_ROWS - 1),
            "w": _clamp(w, MIN_WIDGET_SIZE, MAX_WIDGET_W),
            "h": _clamp(h, MIN_WIDGET_SIZE, MAX_WIDGET_H),
        }

        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            dashboard = dashboards.get(dashboard_id)
            if dashboard is None:
                raise ValueError(f"Dashboard {dashboard_id} not found")

            dashboard.setdefault("widgets", []).append(widget)
            dashboard["updated_at"] = utc_now_iso()
            state["dashboards"][dashboard_id] = dashboard

        logger.info(
            "widget_added",
            extra={
                "event": "widget_added",
                "dashboard_id": dashboard_id,
                "widget_id": widget_id,
            },
        )
        return widget

    # ── Update widget ───────────────────────────────────────────────────

    def update_widget(
        self,
        dashboard_id: str,
        widget_id: str,
        *,
        config: Optional[Dict[str, Any]] = None,
        x: Optional[int] = None,
        y: Optional[int] = None,
        w: Optional[int] = None,
        h: Optional[int] = None,
    ) -> Optional[Dict[str, Any]]:
        """Update a widget.  Returns updated widget or ``None`` if not found."""
        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            dashboard = dashboards.get(dashboard_id)
            if dashboard is None:
                return None

            widgets: List[Dict[str, Any]] = dashboard.get("widgets", [])
            for widget in widgets:
                if widget.get("id") == widget_id:
                    if config is not None:
                        widget["config"] = config
                    if x is not None:
                        widget["x"] = _clamp(x, 0, MAX_GRID_COLS - 1)
                    if y is not None:
                        widget["y"] = _clamp(y, 0, MAX_GRID_ROWS - 1)
                    if w is not None:
                        widget["w"] = _clamp(w, MIN_WIDGET_SIZE, MAX_WIDGET_W)
                    if h is not None:
                        widget["h"] = _clamp(h, MIN_WIDGET_SIZE, MAX_WIDGET_H)

                    dashboard["updated_at"] = utc_now_iso()
                    state["dashboards"][dashboard_id] = dashboard

                    logger.info(
                        "widget_updated",
                        extra={
                            "event": "widget_updated",
                            "dashboard_id": dashboard_id,
                            "widget_id": widget_id,
                        },
                    )
                    return widget

        return None

    # ── Delete widget ───────────────────────────────────────────────────

    def delete_widget(self, dashboard_id: str, widget_id: str) -> bool:
        """Remove a widget.  Returns ``True`` if removed, ``False`` if absent."""
        with state_store.transaction() as state:
            dashboards = state.get("dashboards", {})
            dashboard = dashboards.get(dashboard_id)
            if dashboard is None:
                return False

            original = dashboard.get("widgets", [])
            filtered = [w for w in original if w.get("id") != widget_id]

            if len(filtered) == len(original):
                return False

            dashboard["widgets"] = filtered
            dashboard["updated_at"] = utc_now_iso()
            state["dashboards"][dashboard_id] = dashboard

        logger.info(
            "widget_deleted",
            extra={
                "event": "widget_deleted",
                "dashboard_id": dashboard_id,
                "widget_id": widget_id,
            },
        )
        return True

    # ── Get widget ──────────────────────────────────────────────────────

    def get_widget(
        self, dashboard_id: str, widget_id: str
    ) -> Optional[Dict[str, Any]]:
        """Return a single widget from a dashboard."""
        with state_store.transaction() as state:
            dashboard = state.get("dashboards", {}).get(dashboard_id)
            if dashboard is None:
                return None
            for widget in dashboard.get("widgets", []):
                if widget.get("id") == widget_id:
                    return widget
        return None

    # ── List widgets ────────────────────────────────────────────────────

    def list_widgets(self, dashboard_id: str) -> Optional[List[Dict[str, Any]]]:
        """Return all widgets for a dashboard, or ``None`` if dashboard missing."""
        with state_store.transaction() as state:
            dashboard = state.get("dashboards", {}).get(dashboard_id)
            if dashboard is None:
                return None
            return list(dashboard.get("widgets", []))

    # ── Reorder widgets ─────────────────────────────────────────────────

    def reorder_widgets(
        self,
        dashboard_id: str,
        widget_ids: List[str],
    ) -> bool:
        """Reorder widgets according to the provided ID list.

        Widget IDs not in ``widget_ids`` are appended at the end.
        Returns ``False`` if dashboard not found.
        """
        with state_store.transaction() as state:
            dashboard = state.get("dashboards", {}).get(dashboard_id)
            if dashboard is None:
                return False

            existing = {w["id"]: w for w in dashboard.get("widgets", [])}
            ordered: List[Dict[str, Any]] = []
            seen: set[str] = set()

            for wid in widget_ids:
                if wid in existing and wid not in seen:
                    ordered.append(existing[wid])
                    seen.add(wid)

            # Append any widgets not mentioned in the new order
            for wid, w in existing.items():
                if wid not in seen:
                    ordered.append(w)

            dashboard["widgets"] = ordered
            dashboard["updated_at"] = utc_now_iso()
            state["dashboards"][dashboard_id] = dashboard

        return True
