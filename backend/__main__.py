"""Allow `python -m backend` to start the server."""
import uvicorn

uvicorn.run("backend.api:app", host="0.0.0.0", port=9082, log_level="info")
