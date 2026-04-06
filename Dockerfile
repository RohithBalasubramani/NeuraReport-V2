# ============================================================
# Stage 1: Build Frontend (React + Vite)
# ============================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /build

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY frontend/ ./
RUN npm run build
# Output: /build/dist/

# ============================================================
# Stage 2: Install Python Dependencies
# ============================================================
FROM python:3.11-slim AS backend-builder

WORKDIR /build

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# ============================================================
# Stage 3: Final Production Image
# ============================================================
FROM python:3.11-slim AS production

RUN groupadd -r neurareport && useradd -r -g neurareport neurareport

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    libffi8 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from builder
COPY --from=backend-builder /install /usr/local

# Copy backend application code
COPY backend/ ./backend/

# Copy built frontend assets
COPY --from=frontend-builder /build/dist ./static

# Create state directory
RUN mkdir -p /app/state && chown neurareport:neurareport /app/state

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

USER neurareport

EXPOSE 8000

CMD ["uvicorn", "backend.api:app", "--host", "0.0.0.0", "--port", "8000"]
