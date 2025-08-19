#!/bin/bash

# Setup script for WebRTC VLM Detection Demo
# This script prepares the environment and downloads required dependencies

set -e

echo "🚀 Setting up WebRTC VLM Detection Demo..."

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker Desktop first:"
    echo "   https://www.docker.com/products/docker-desktop"
    exit 1
fi

# Check if Docker Compose is available
if ! command -v docker-compose &> /dev/null; then
    echo "❌ Docker Compose is not installed. Please install Docker Compose:"
    echo "   https://docs.docker.com/compose/install/"
    exit 1
fi

echo "✅ Docker and Docker Compose are available"

# Check if Node.js is installed (for benchmark)
if command -v node &> /dev/null; then
    echo "✅ Node.js is available"
    
    # Install benchmark dependencies
    echo "📦 Installing benchmark dependencies..."
    cd bench
    npm install
    cd ..
else
    echo "⚠️  Node.js not found. Benchmark functionality will be limited."
    echo "   Install Node.js from: https://nodejs.org/"
fi

# Make scripts executable
echo "🔧 Making scripts executable..."
chmod +x start.sh
chmod +x scripts/download_models.sh
chmod +x bench/run_bench.sh

# Download models
echo "📦 Downloading pre-trained models..."
./scripts/download_models.sh

# Create initial metrics.json template
echo "📊 Creating metrics template..."
cat > metrics.json << 'EOF'
{
  "note": "This file will be overwritten by benchmark results",
  "last_updated": null,
  "benchmark_data": null
}
EOF

echo ""
echo "✅ Setup completed successfully!"
echo ""
echo "🚀 Quick Start:"
echo "   ./start.sh server  # Start with server-side inference"
echo "   ./start.sh wasm    # Start with browser WASM inference"
echo ""
echo "📱 Phone Connection:"
echo "   1. Start the demo with one of the commands above"
echo "   2. Open your phone browser and scan the QR code"
echo "   3. Or navigate to the displayed URL"
echo ""
echo "🧪 Benchmarking:"
echo "   ./bench/run_bench.sh -duration 30 -mode server"
echo ""
echo "📖 For more information, see README.md"
