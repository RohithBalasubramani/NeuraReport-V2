"""
Desktop sidecar entry point for Tauri.

Accepts --port to run on a dynamically chosen port.
Configures environment for single-user desktop mode:
  - SQLite database (no PostgreSQL needed)
  - No Redis/Dramatiq (background tasks disabled)
  - Anonymous API access (no login)
  - Files stored in OS app-data directory
"""
import argparse
import os
import platform
import stat
import subprocess
from pathlib import Path


def get_app_data_dir():
    """Get OS-appropriate app data directory."""
    home = Path.home()
    if platform.system() == "Darwin":
        return home / "Library" / "Application Support" / "com.neurareport.desktop"
    elif platform.system() == "Windows":
        return Path(os.environ.get("APPDATA", home / "AppData" / "Roaming")) / "NeuraReport"
    else:
        return home / ".local" / "share" / "neurareport"


def _clean_stale_locks(data_dir: Path):
    """Remove stale .lock.* files left by previous crashes.

    On Windows, filelock uses lockfile semantics that may leave .lock files
    behind if the process is killed. These stale locks cause subsequent
    report runs to timeout waiting for a lock that will never be released.
    """
    cleaned = 0
    for lock_dir in [data_dir / "uploads", data_dir / "uploads_excel"]:
        if not lock_dir.exists():
            continue
        for lock_file in lock_dir.rglob(".lock.*"):
            try:
                lock_file.unlink()
                cleaned += 1
            except OSError:
                pass
    if cleaned:
        print(f"[DESKTOP] Cleaned {cleaned} stale lock file(s) from previous session", flush=True)


def _seed_smtp_defaults(state_dir: Path):
    """Seed SMTP settings into the state store on first run."""
    import json
    state_path = state_dir / "state.json"
    try:
        if state_path.exists():
            state = json.loads(state_path.read_text(encoding="utf-8"))
        else:
            state = {}
        prefs = state.get("user_preferences", {})
        smtp = prefs.get("smtp", {})
        if smtp.get("host"):
            return  # Already configured
        # Seed with default SMTP config
        prefs["smtp"] = {
            "host": "smtp.gmail.com",
            "port": 587,
            "sender": "rohith@neuract.in",
            "username": "rohith@neuract.in",
            "password": "phhd dkzq gpou njfh",
            "use_tls": True,
        }
        state["user_preferences"] = prefs
        state_path.write_text(json.dumps(state, indent=2, default=str), encoding="utf-8")
        print("[DESKTOP] Seeded default SMTP settings", flush=True)
    except Exception as e:
        print(f"[DESKTOP] SMTP seed skipped: {e}", flush=True)


def _find_chromium_in_dir(d: Path) -> bool:
    """Check if a directory contains an installed Chromium browser."""
    if not d.exists():
        return False
    for pattern in ["chromium-*", "chromium_*"]:
        for entry in d.glob(pattern):
            if entry.is_dir():
                return True
    return False


def _find_system_chromium() -> Path | None:
    """Check common system locations for an existing Playwright Chromium install."""
    candidates = []
    if platform.system() == "Windows":
        for env_var in ["LOCALAPPDATA", "USERPROFILE"]:
            base = os.environ.get(env_var)
            if base:
                candidates.append(Path(base) / "ms-playwright")
                candidates.append(Path(base) / ".cache" / "ms-playwright")
    elif platform.system() == "Darwin":
        candidates.append(Path.home() / "Library" / "Caches" / "ms-playwright")
    else:
        candidates.append(Path.home() / ".cache" / "ms-playwright")

    for candidate in candidates:
        if _find_chromium_in_dir(candidate):
            return candidate
    return None


def _ensure_node_executable(node_path: str) -> None:
    """Ensure the bundled node binary has execute permission (Linux/macOS)."""
    if platform.system() == "Windows":
        return
    p = Path(node_path)
    if p.exists() and not os.access(str(p), os.X_OK):
        try:
            p.chmod(p.stat().st_mode | stat.S_IEXEC | stat.S_IXGRP | stat.S_IXOTH)
            print(f"[DESKTOP] Fixed execute permission on {p.name}", flush=True)
        except OSError as e:
            print(f"[DESKTOP] Could not chmod {p.name}: {e}", flush=True)


def _ensure_playwright_chromium(data_dir: Path):
    """Install Playwright Chromium browser if not present.

    Strategy:
    1. Set PLAYWRIGHT_BROWSERS_PATH to a fixed app-data location (avoids
       all system path and "wrong machine" issues).
    2. Check if Chromium is already there.
    3. Check if Chromium exists in a system location — if so, reuse it.
    4. If not found anywhere, download via the bundled Playwright driver,
       falling back to system Python or npx.
    5. Verify the install by checking the directory exists.

    Falls back gracefully — PDF generation is skipped if unavailable.
    """
    browsers_dir = data_dir / "playwright-browsers"
    browsers_dir.mkdir(parents=True, exist_ok=True)

    # Set THE canonical path BEFORE anything else — overrides all system defaults.
    # This prevents Playwright's PyInstaller detection from setting it to "0".
    # (Playwright's _transport.py uses env.setdefault which won't override this.)
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)

    # ---- Check 1: already in our app-data dir? ----
    if _find_chromium_in_dir(browsers_dir):
        print("[DESKTOP] Playwright Chromium found in app data", flush=True)
        return

    # ---- Check 2: already installed system-wide? ----
    system_dir = _find_system_chromium()
    if system_dir:
        print(f"[DESKTOP] Found system Chromium at {system_dir}", flush=True)
        # Point Playwright to the existing system install instead of downloading
        os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(system_dir)
        return

    # ---- Download Chromium ----
    print("[DESKTOP] Downloading Chromium for PDF generation (first launch, ~130MB)...", flush=True)
    installed = False

    # Method 1: Use Playwright's bundled node.js driver (primary — works in PyInstaller)
    # compute_driver_executable() returns (node_path, cli_js_path) tuple
    if not installed:
        try:
            from playwright._impl._driver import compute_driver_executable, get_driver_env
            node_path, cli_path = compute_driver_executable()

            # Ensure the bundled node binary is executable (Linux/macOS)
            _ensure_node_executable(node_path)

            env = get_driver_env()
            env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)

            print(f"[DESKTOP] Method 1: driver install (node={node_path})", flush=True)
            result = subprocess.run(
                [node_path, cli_path, "install", "chromium"],
                env=env,
                capture_output=True,
                text=True,
                timeout=600,
            )
            if result.returncode == 0:
                print("[DESKTOP] Chromium installed via bundled driver", flush=True)
                installed = True
            else:
                stderr = result.stderr[:500] if result.stderr else "(no stderr)"
                print(f"[DESKTOP] Driver method code {result.returncode}: {stderr}", flush=True)
        except ImportError:
            print("[DESKTOP] Playwright driver not bundled", flush=True)
        except subprocess.TimeoutExpired:
            print("[DESKTOP] Driver install timed out (10min)", flush=True)
        except Exception as e:
            print(f"[DESKTOP] Driver method failed: {type(e).__name__}: {e}", flush=True)

    # Method 2: Try system Python (for Windows machines with Python installed)
    if not installed and platform.system() == "Windows":
        env = os.environ.copy()
        env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)
        for py_cmd in ["py", "python", "python3"]:
            try:
                print(f"[DESKTOP] Method 2: {py_cmd} -m playwright install...", flush=True)
                result = subprocess.run(
                    [py_cmd, "-m", "playwright", "install", "chromium"],
                    env=env,
                    capture_output=True,
                    text=True,
                    timeout=600,
                )
                if result.returncode == 0:
                    print(f"[DESKTOP] Chromium installed via {py_cmd}", flush=True)
                    installed = True
                    break
            except FileNotFoundError:
                continue
            except subprocess.TimeoutExpired:
                print(f"[DESKTOP] {py_cmd} method timed out", flush=True)
                break
            except Exception:
                continue

    # Method 3: Try npx playwright (if Node.js is available on the system)
    if not installed:
        try:
            npx_cmd = "npx.cmd" if platform.system() == "Windows" else "npx"
            env = os.environ.copy()
            env["PLAYWRIGHT_BROWSERS_PATH"] = str(browsers_dir)
            print("[DESKTOP] Method 3: npx playwright install...", flush=True)
            result = subprocess.run(
                [npx_cmd, "playwright", "install", "chromium"],
                env=env,
                capture_output=True,
                text=True,
                timeout=600,
            )
            if result.returncode == 0:
                print("[DESKTOP] Chromium installed via npx", flush=True)
                installed = True
        except FileNotFoundError:
            pass
        except Exception:
            pass

    # ---- Post-install verification ----
    if installed and _find_chromium_in_dir(browsers_dir):
        print("[DESKTOP] Chromium install VERIFIED — PDF generation enabled", flush=True)
    elif installed:
        print("[DESKTOP] WARNING: Install reported success but Chromium dir not found", flush=True)
        print(f"[DESKTOP] Checked: {browsers_dir}", flush=True)
    else:
        print("[DESKTOP] WARNING: Chromium not installed — PDF generation unavailable", flush=True)
        print("[DESKTOP] Reports will still generate HTML and Excel formats", flush=True)
        print("[DESKTOP] To fix manually: pip install playwright && playwright install chromium", flush=True)


def main():
    # Required for multiprocessing in PyInstaller frozen executables on Windows.
    # pdf2docx uses multiprocessing for parallel page conversion; without this
    # call the spawn start-method causes an infinite process loop.
    import multiprocessing
    multiprocessing.freeze_support()

    parser = argparse.ArgumentParser(description="NeuraReport desktop backend")
    parser.add_argument("--port", type=int, default=8000, help="Port to listen on")
    args = parser.parse_args()

    # Resolve data directory
    data_dir = get_app_data_dir()
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "uploads").mkdir(exist_ok=True)
    (data_dir / "uploads_excel").mkdir(exist_ok=True)
    (data_dir / "state").mkdir(exist_ok=True)

    # Logs directory (writable location outside frozen bundle)
    logs_dir = data_dir / "logs"
    logs_dir.mkdir(exist_ok=True)

    # Ensure existing DB files are writable (previous installations may
    # have left them read-only, e.g. when installed to Program Files).
    state_dir = data_dir / "state"
    for f in state_dir.iterdir():
        if f.is_file():
            try:
                mode = f.stat().st_mode
                if not (mode & stat.S_IWRITE):
                    f.chmod(mode | stat.S_IWRITE)
            except OSError:
                pass

    # Desktop-mode environment defaults
    os.environ.setdefault("NEURA_DEBUG", "true")
    os.environ.setdefault("NEURA_ALLOW_ANON_API", "true")
    os.environ.setdefault("NEURA_JWT_SECRET", "desktop-local-secret")
    os.environ.setdefault("NEURA_REDIS_URL", "")
    os.environ.setdefault("NEURA_AGENT_WORKER_DISABLED", "true")
    os.environ.setdefault("NEURA_RECOVERY_DAEMON_DISABLED", "false")
    os.environ.setdefault("NEURA_SCHEDULER_DISABLED", "false")
    os.environ.setdefault("NEURA_METRICS_ENABLED", "false")
    os.environ.setdefault("NEURA_ALLOWED_HOSTS_ALL", "true")
    os.environ.setdefault("UPLOAD_ROOT", str(data_dir / "uploads"))
    os.environ.setdefault("EXCEL_UPLOAD_ROOT", str(data_dir / "uploads_excel"))
    os.environ.setdefault("NEURA_STATE_DIR", str(data_dir / "state"))
    os.environ.setdefault("NEURA_ERROR_LOG", str(logs_dir / "backend_errors.log"))
    os.environ.setdefault("NEURA_LLM_LOG", str(logs_dir / "llm.log"))
    os.environ.setdefault("LLM_RAW_OUTPUT_PATH", str(logs_dir / "llm_raw_outputs.md"))
    os.environ.setdefault(
        "NEURA_DATABASE_URL",
        f"sqlite+aiosqlite:///{data_dir / 'state' / 'neurareport.db'}",
    )

    # Seed default SMTP settings if not already configured
    _seed_smtp_defaults(data_dir / "state")

    # Ensure Playwright Chromium is available for PDF generation
    _ensure_playwright_chromium(data_dir)

    # Clean stale file locks from previous crashes
    _clean_stale_locks(data_dir)

    # Direct import avoids string-based lookup issues with PyInstaller
    from backend.api import app  # noqa: E402
    import logging as _logging
    import uvicorn

    # Suppress noisy uvicorn access-log lines for high-frequency polling
    # endpoints (/api/v1/jobs, /health) that bloat the desktop log file.
    class _QuietAccessFilter(_logging.Filter):
        _NOISY = ("/api/v1/jobs", "/api/v1/health", "/health")
        def filter(self, record: _logging.LogRecord) -> bool:
            msg = record.getMessage()
            return not any(p in msg for p in self._NOISY)

    _logging.getLogger("uvicorn.access").addFilter(_QuietAccessFilter())

    uvicorn.run(
        app,
        host="127.0.0.1",
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    import multiprocessing
    multiprocessing.freeze_support()
    main()
