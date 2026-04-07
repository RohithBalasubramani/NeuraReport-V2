"""
Background daemon that pre-builds ``hydration_cache.json`` when session state
changes, so the ``/hydrate`` endpoint can serve cached data instantly.

Usage::

    from backend.app.services.hydration_daemon import hydration_daemon

    # In lifespan startup:
    await hydration_daemon.start()

    # On session state change (session.py, hermes_agent.py):
    hydration_daemon.notify(session_id, str(template_dir), connection_id, "state:mapped")

    # In lifespan shutdown:
    await hydration_daemon.stop()
"""
from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

logger = logging.getLogger(__name__)


class HydrationDaemon:
    """Async worker that rebuilds hydration caches in the background."""

    _MAX_QUEUE = 64

    def __init__(self) -> None:
        self._queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=self._MAX_QUEUE)
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        """Start the background worker loop."""
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._worker(), name="hydration-daemon")
            logger.info("hydration_daemon_started")

    async def stop(self) -> None:
        """Graceful shutdown — cancel the worker and wait."""
        if self._task and not self._task.done():
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            logger.info("hydration_daemon_stopped")

    def notify(
        self,
        session_id: str,
        template_dir: str,
        connection_id: str | None = None,
        reason: str = "",
    ) -> None:
        """Enqueue a cache rebuild request.  Non-blocking, drops if full."""
        try:
            self._queue.put_nowait({
                "session_id": session_id,
                "template_dir": template_dir,
                "connection_id": connection_id,
                "reason": reason,
            })
        except asyncio.QueueFull:
            logger.debug("hydration_daemon: queue full, dropping %s", reason)

    # ── internals ─────────────────────────────────────────────────────

    async def _worker(self) -> None:
        """Drain the queue, rebuild caches one at a time."""
        while True:
            item = await self._queue.get()
            try:
                await asyncio.to_thread(self._rebuild, item)
            except Exception:
                logger.warning(
                    "hydration_daemon: rebuild failed for %s",
                    item.get("session_id", "?"),
                    exc_info=True,
                )
            finally:
                self._queue.task_done()

    @staticmethod
    def _rebuild(item: dict) -> None:
        """Synchronous: read artifacts → write hydration_cache.json."""
        from backend.app.services.chat.session import ChatSession
        from backend.app.services.hydration import build_hydration_payload

        tdir = Path(item["template_dir"])
        if not tdir.exists():
            return

        try:
            session = ChatSession.load(tdir)
        except FileNotFoundError:
            return

        # Session isolation: verify the session_id matches
        if session.session_id != item["session_id"]:
            logger.warning(
                "hydration_daemon: session_id mismatch in %s (expected %s, got %s)",
                tdir.name, item["session_id"], session.session_id,
            )
            return

        payload = build_hydration_payload(session)

        cache_path = tdir / "hydration_cache.json"
        tmp = cache_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False))
        tmp.rename(cache_path)

        logger.debug(
            "hydration_daemon: rebuilt cache for %s (%s)",
            item["session_id"], item.get("reason", ""),
        )


# Module-level singleton — import once, use everywhere
hydration_daemon = HydrationDaemon()
