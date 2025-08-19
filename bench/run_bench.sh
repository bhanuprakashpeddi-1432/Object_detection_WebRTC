#!/bin/bash

# WebRTC VLM Detection Benchmark Script
# Usage: ./run_bench.sh -duration 30 -mode server|wasm [-output metrics.json]

set -e

# Default values
DURATION=30
MODE="server"
OUTPUT_FILE="metrics.json"
BENCHMARK_URL="http://localhost:3000"
HELP=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -duration)
      DURATION="$2"
      shift 2
      ;;
    -mode)
      MODE="$2"
      shift 2
      ;;
    -output)
      OUTPUT_FILE="$2"
      shift 2
      ;;
    -url)
      BENCHMARK_URL="$2"
      shift 2
      ;;
    -h|--help)
      HELP=true
      shift
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

if [ "$HELP" = true ]; then
  echo "WebRTC VLM Detection Benchmark Script"
  echo ""
  echo "Usage: $0 [OPTIONS]"
  echo ""
  echo "Options:"
  echo "  -duration SECONDS  Benchmark duration in seconds (default: 30)"
  echo "  -mode MODE         Mode: 'server' or 'wasm' (default: server)"
  echo "  -output FILE       Output file for metrics (default: metrics.json)"
  echo "  -url URL           Base URL for benchmark (default: http://localhost:3000)"
  echo "  -h, --help         Show this help message"
  echo ""
  echo "Examples:"
  echo "  $0 -duration 30 -mode server"
  echo "  $0 -duration 60 -mode wasm -output benchmark_results.json"
  exit 0
fi

echo "🧪 Starting WebRTC VLM Detection Benchmark"
echo "   Duration: ${DURATION} seconds"
echo "   Mode: ${MODE}"
echo "   Output: ${OUTPUT_FILE}"
echo "   URL: ${BENCHMARK_URL}"
echo ""

# Check if the service is running
echo "🔍 Checking if service is running..."
if ! curl -s "${BENCHMARK_URL}/health" > /dev/null; then
  echo "❌ Service not available at ${BENCHMARK_URL}"
  echo "   Please start the service first:"
  echo "   ./start.sh ${MODE}"
  exit 1
fi

echo "✅ Service is running"

# Create benchmark directory if it doesn't exist
mkdir -p "$(dirname "$OUTPUT_FILE")"

# Run the Node.js benchmark script
echo "🚀 Running benchmark..."
node "$(dirname "$0")/benchmark.js" \
  --duration "$DURATION" \
  --mode "$MODE" \
  --output "$OUTPUT_FILE" \
  --url "$BENCHMARK_URL"

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Benchmark completed successfully!"
  echo "📊 Results saved to: $OUTPUT_FILE"
  echo ""
  
  # Display summary if jq is available
  if command -v jq &> /dev/null; then
    echo "📈 Benchmark Summary:"
    echo "   Processed FPS: $(jq -r '.processed_fps' "$OUTPUT_FILE")"
    echo "   Median E2E Latency: $(jq -r '.median_e2e_latency_ms' "$OUTPUT_FILE")ms"
    echo "   P95 E2E Latency: $(jq -r '.p95_e2e_latency_ms' "$OUTPUT_FILE")ms"
    echo "   Frames Processed: $(jq -r '.frames_processed' "$OUTPUT_FILE")"
  else
    echo "💡 Install 'jq' to see benchmark summary"
  fi
else
  echo "❌ Benchmark failed"
  exit 1
fi
