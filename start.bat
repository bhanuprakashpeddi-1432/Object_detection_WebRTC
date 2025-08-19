@echo off
REM WebRTC VLM Multi-Object Detection Demo (Windows)
REM Usage: start.bat [server|wasm] [--gpu]

setlocal enabledelayedexpansion

set MODE=server
set GPU_ENABLED=false

REM Parse arguments
:parse
if "%~1"=="" goto :main
if "%~1"=="server" (
    set MODE=server
    shift
    goto :parse
)
if "%~1"=="wasm" (
    set MODE=wasm
    shift
    goto :parse
)
if "%~1"=="--gpu" (
    set GPU_ENABLED=true
    shift
    goto :parse
)
if "%~1"=="-h" goto :help
if "%~1"=="--help" goto :help
echo Unknown option %~1
exit /b 1

:help
echo Usage: %0 [server^|wasm] [--gpu]
echo.
echo Modes:
echo   server  - Run inference on server (default)
echo   wasm    - Run inference in browser using WASM
echo.
echo Options:
echo   --gpu   - Enable GPU acceleration (server mode only)
echo   -h      - Show this help message
exit /b 0

:main
echo 🚀 Starting WebRTC VLM Detection Demo in %MODE% mode...

REM Check if Docker is available
docker --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Docker not found. Please install Docker Desktop.
    exit /b 1
)

REM Download models if they don't exist
if not exist "models" mkdir models
if not exist "models\yolov5n.onnx" (
    echo 📦 Downloading models...
    bash scripts/download_models.sh
    if errorlevel 1 (
        echo ❌ Failed to download models
        exit /b 1
    )
)

REM Start services based on mode
if "%MODE%"=="wasm" (
    echo 🌐 Starting WASM mode (browser inference)...
    docker-compose --profile wasm up --build
) else (
    echo 🖥️  Starting server mode (server inference)...
    docker-compose --profile server up --build
)
