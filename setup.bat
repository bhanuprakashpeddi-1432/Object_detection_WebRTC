@echo off
REM Setup script for WebRTC VLM Detection Demo (Windows)
REM This script prepares the environment and downloads required dependencies

echo 🚀 Setting up WebRTC VLM Detection Demo...

REM Check if Docker is installed
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker is not installed. Please install Docker Desktop first:
    echo    https://www.docker.com/products/docker-desktop
    exit /b 1
)

REM Check if Docker Compose is available
docker-compose --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker Compose is not installed. Please install Docker Compose:
    echo    https://docs.docker.com/compose/install/
    exit /b 1
)

echo ✅ Docker and Docker Compose are available

REM Check if Node.js is installed (for benchmark)
node --version >nul 2>&1
if not errorlevel 1 (
    echo ✅ Node.js is available
    
    REM Install benchmark dependencies
    echo 📦 Installing benchmark dependencies...
    cd bench
    npm install
    cd ..
) else (
    echo ⚠️  Node.js not found. Benchmark functionality will be limited.
    echo    Install Node.js from: https://nodejs.org/
)

REM Download models (using Git Bash if available, otherwise manual instructions)
echo 📦 Downloading pre-trained models...
where bash >nul 2>&1
if not errorlevel 1 (
    bash scripts/download_models.sh
) else (
    echo ⚠️  Bash not found. Please run the following manually:
    echo    1. Create models directory
    echo    2. Download YOLOv5n.onnx from: https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx
    echo    3. Place it in the models/ directory
    if not exist models mkdir models
)

REM Create initial metrics.json template
echo 📊 Creating metrics template...
echo { > metrics.json
echo   "note": "This file will be overwritten by benchmark results", >> metrics.json
echo   "last_updated": null, >> metrics.json
echo   "benchmark_data": null >> metrics.json
echo } >> metrics.json

echo.
echo ✅ Setup completed successfully!
echo.
echo 🚀 Quick Start:
echo    start.bat server  # Start with server-side inference
echo    start.bat wasm    # Start with browser WASM inference
echo.
echo 📱 Phone Connection:
echo    1. Start the demo with one of the commands above
echo    2. Open your phone browser and scan the QR code
echo    3. Or navigate to the displayed URL
echo.
echo 🧪 Benchmarking:
echo    bash bench/run_bench.sh -duration 30 -mode server
echo.
echo 📖 For more information, see README.md
