#!/bin/bash
# Pipeline startup script — ensures clean GPU state before launching vLLM + backend.
# Usage: bash scripts/start_pipeline.sh
set -euo pipefail

VLLM_PORT=8200
BACKEND_PORT=9082
MODEL="Qwen/Qwen3.5-27B-FP8"
MODEL_ALIAS="qwen"
MAX_MODEL_LEN=8192

echo "=== Pipeline Startup ==="

# ── 1. Kill orphaned GPU processes ──
echo "[1/4] Cleaning GPU processes..."
for pid in $(nvidia-smi --query-compute-apps=pid --format=csv,noheader 2>/dev/null); do
    cmdline=$(cat /proc/$pid/cmdline 2>/dev/null | tr '\0' ' ' || true)
    echo "  Killing GPU process $pid: ${cmdline:0:80}"
    kill -9 "$pid" 2>/dev/null || true
done

# ── 2. Kill anything on our ports + conflicting services ──
echo "[2/4] Freeing ports..."
for port in ${VLLM_PORT} ${BACKEND_PORT} 9052 9070 9080 8000 4000; do
    fuser -k ${port}/tcp 2>/dev/null || true
done
sleep 2

# ── 3. Start vLLM ──
echo "[3/4] Starting vLLM on port ${VLLM_PORT}..."
vllm serve "$MODEL" \
    --port "$VLLM_PORT" \
    --served-model-name "$MODEL_ALIAS" "$MODEL" \
    --max-model-len "$MAX_MODEL_LEN" \
    --gpu-memory-utilization 0.90 \
    --disable-log-requests &
VLLM_PID=$!

echo "  vLLM PID: $VLLM_PID — waiting for ready..."
for i in $(seq 1 90); do
    if curl -sf "http://localhost:${VLLM_PORT}/v1/models" > /dev/null 2>&1; then
        echo "  vLLM ready after ~$((i*2))s."
        break
    fi
    if ! kill -0 "$VLLM_PID" 2>/dev/null; then
        echo "  ERROR: vLLM process died. Check GPU memory."
        exit 1
    fi
    sleep 2
done

if ! curl -sf "http://localhost:${VLLM_PORT}/v1/models" > /dev/null 2>&1; then
    echo "  ERROR: vLLM did not start within 180s."
    exit 1
fi

# ── 4. Start backend ──
echo "[4/4] Starting backend on port ${BACKEND_PORT}..."
cd "$(dirname "$0")/.."
LLM_API_BASE="http://localhost:${VLLM_PORT}/v1" \
LLM_MODEL="$MODEL_ALIAS" \
VISION_LLM_ENABLED=true \
VISION_LLM_MODEL=deepseek-ocr \
VISION_LLM_API_BASE=http://localhost:11434/v1 \
VISION_LLM_API_KEY=ollama \
python -m backend &
BACKEND_PID=$!

sleep 3
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "  ERROR: Backend process died."
    exit 1
fi

echo ""
echo "=== Pipeline Ready ==="
echo "  vLLM:    http://localhost:${VLLM_PORT}/v1  (PID $VLLM_PID)"
echo "  Backend: http://localhost:${BACKEND_PORT}   (PID $BACKEND_PID)"
echo ""
echo "To stop: kill $VLLM_PID $BACKEND_PID"
