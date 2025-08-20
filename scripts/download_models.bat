@echo off
REM Download pre-trained models for WebRTC VLM Detection (Windows version)

echo 📦 Downloading pre-trained models for WebRTC Object Detection...

set MODELS_DIR=models
if not exist "%MODELS_DIR%" mkdir "%MODELS_DIR%"

REM Download YOLOv4 ONNX model
set MODEL_FILE=%MODELS_DIR%\yolov4.onnx
if not exist "%MODEL_FILE%" (
    echo ⬇️  Downloading YOLOv4 ONNX model (~245MB)...
    echo 💡 This may take a few minutes depending on your internet connection
    powershell -Command "& {Invoke-WebRequest -Uri 'https://github.com/onnx/models/raw/main/vision/object_detection_segmentation/yolov4/model/yolov4.onnx' -OutFile '%MODEL_FILE%'}"
    if errorlevel 1 (
        echo ❌ Failed to download YOLOv4 model
        echo 💡 Trying alternative download...
        powershell -Command "& {Invoke-WebRequest -Uri 'https://media.githubusercontent.com/media/onnx/models/main/vision/object_detection_segmentation/yolov4/model/yolov4.onnx' -OutFile '%MODEL_FILE%'}"
        if errorlevel 1 (
            echo ❌ All download attempts failed
            echo � Please manually download from: https://github.com/onnx/models/tree/main/vision/object_detection_segmentation/yolov4
            exit /b 1
        )
    )
    echo ✅ YOLOv4 model downloaded successfully
) else (
    echo ✅ YOLOv4 model already exists
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
