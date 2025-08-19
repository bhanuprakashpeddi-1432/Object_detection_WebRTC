#!/bin/bash

# WebRTC VLM Multi-Object Detection Demo
# Usage: ./start.sh [server|wasm] [--gpu]
# Usage: ./start.sh [server|wasm] [--gpu] [--ngrok]

set -e

MODE=${1:-server}
USE_NGROK=false
GPU_ENABLED=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    server|wasm)
      MODE="$1"
      shift
      ;;
    --gpu)
      --ngrok)
        USE_NGROK=true
        shift
        ;;
      GPU_ENABLED=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [server|wasm] [--gpu]"
      echo ""
      echo "Modes:"
      echo "  server  - Run inference on server (default)"
      echo "  wasm    - Run inference in browser using WASM"
      echo ""
      echo "Options:"
      echo "  --gpu   - Enable GPU acceleration (server mode only)"
      echo "  -h      - Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

echo "🚀 Starting WebRTC VLM Detection Demo in $MODE mode..."

# Export environment variables
export MODE=$MODE
export GPU_ENABLED=$GPU_ENABLED

# Download models if they don't exist
if [ ! -d "./models" ] || [ -z "$(ls -A ./models)" ]; then
  echo "📦 Downloading models..."
  ./scripts/download_models.sh
fi

# Start services based on mode
if [ "$MODE" = "wasm" ]; then
  echo "🌐 Starting WASM mode (browser inference)..."
  docker-compose --profile wasm up --build
else
  echo "🖥️  Starting server mode (server inference)..."
  docker-compose --profile server up --build
fi

# Optionally start ngrok (http) tunnel for phone access outside LAN
if [ "$USE_NGROK" = true ]; then
  if ! command -v ngrok >/dev/null 2>&1; then
    echo "❌ ngrok not installed. Install from https://ngrok.com/download or remove --ngrok flag.";
    wait
    exit 1
  fi
  echo "🌐 Starting ngrok tunnel (http 3000)..."
  ngrok http 3000 > /dev/null &
  NGROK_PID=$!
  # Give ngrok a moment then fetch public URL
  sleep 3
  API_URL="http://127.0.0.1:4040/api/tunnels"/http
  PUBLIC_URL=$(curl -s http://127.0.0.1:4040/api/tunnels | grep -Eo 'https://[a-zA-Z0-9.-]+.ngrok-free.app')
  echo "🔗 Public URL (share with phone): ${PUBLIC_URL:-'(unavailable – check ngrok dashboard)'}"
  echo "Press Ctrl+C to stop (this will also terminate background services)."
fi

wait
