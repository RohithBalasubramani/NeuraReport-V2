#!/bin/bash
cd /home/rohith/neurareport-v2-prodo
exec backend/.venv/bin/python3 -m uvicorn backend.api:app --host 0.0.0.0 --port 8500
