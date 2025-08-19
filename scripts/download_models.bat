@echo off
REM Download pre-trained models for WebRTC VLM Detection (Windows version)

echo 📦 Downloading pre-trained models...

set MODELS_DIR=models
if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"

REM Download YOLOv5n model
set MODEL_FILE=%MODELS_DIR%\yolov5n.onnx
if not exist "%MODEL_FILE%" (
    echo ⬇️  Downloading YOLOv5n model...
    powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx' -OutFile '%MODEL_FILE%'}"
    if errorlevel 1 (
        echo ❌ Failed to download model
        exit /b 1
    )
    echo ✅ YOLOv5n model downloaded
) else (
    echo ✅ YOLOv5n model already exists
)

REM Create quantized version (copy for demo)
set QUANTIZED_MODEL=%MODELS_DIR%\yolov5n-int8.onnx
if not exist "%QUANTIZED_MODEL%" (
    echo 📋 Creating quantized model for WASM mode...
    copy "%MODEL_FILE%" "%QUANTIZED_MODEL%"
    echo 💡 Note: Using standard model as quantized version for demo
) else (
    echo ✅ Quantized model already exists
)

REM Create COCO class labels
set LABELS_FILE=%MODELS_DIR%\coco_classes.txt
if not exist "%LABELS_FILE%" (
    echo 📋 Creating COCO class labels...
    (
        echo person
        echo bicycle
        echo car
        echo motorcycle
        echo airplane
        echo bus
        echo train
        echo truck
        echo boat
        echo traffic light
        echo fire hydrant
        echo stop sign
        echo parking meter
        echo bench
        echo bird
        echo cat
        echo dog
        echo horse
        echo sheep
        echo cow
        echo elephant
        echo bear
        echo zebra
        echo giraffe
        echo backpack
        echo umbrella
        echo handbag
        echo tie
        echo suitcase
        echo frisbee
        echo skis
        echo snowboard
        echo sports ball
        echo kite
        echo baseball bat
        echo baseball glove
        echo skateboard
        echo surfboard
        echo tennis racket
        echo bottle
        echo wine glass
        echo cup
        echo fork
        echo knife
        echo spoon
        echo bowl
        echo banana
        echo apple
        echo sandwich
        echo orange
        echo broccoli
        echo carrot
        echo hot dog
        echo pizza
        echo donut
        echo cake
        echo chair
        echo couch
        echo potted plant
        echo bed
        echo dining table
        echo toilet
        echo tv
        echo laptop
        echo mouse
        echo remote
        echo keyboard
        echo cell phone
        echo microwave
        echo oven
        echo toaster
        echo sink
        echo refrigerator
        echo book
        echo clock
        echo vase
        echo scissors
        echo teddy bear
        echo hair drier
        echo toothbrush
    ) > "%LABELS_FILE%"
)

echo.
echo ✅ Model download completed!
echo 📊 Models available in: %MODELS_DIR%
dir "%MODELS_DIR%"
echo.
echo 🚀 You can now start the demo with:
echo    start.bat server  # For server-side inference
echo    start.bat wasm    # For browser WASM inference
