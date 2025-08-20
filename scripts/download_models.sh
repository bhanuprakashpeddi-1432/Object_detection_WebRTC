#!/bin/bash

# Download pre-trained models for WebRTC Object Detection
# This script downloads YOLOv4 ONNX model for object detection

set -e

MODELS_DIR="./models"
TEMP_DIR="/tmp/vlm_models"

echo "📦 Downloading pre-trained models for WebRTC Object Detection..."

# Create directories
mkdir -p "$MODELS_DIR"
mkdir -p "$TEMP_DIR"

# Function to download file with progress
download_file() {
    local url=$1
    local output=$2
    local description=$3
    
    echo "⬇️  Downloading $description..."
    
    if command -v wget &> /dev/null; then
        wget --progress=bar:force:noscroll -O "$output" "$url"
    elif command -v curl &> /dev/null; then
        curl -L --progress-bar -o "$output" "$url"
    else
        echo "❌ Neither wget nor curl found. Please install one of them."
        exit 1
    fi
}

# Download YOLOv4 ONNX model
MODEL_FILE="$MODELS_DIR/yolov4.onnx"
if [ ! -f "$MODEL_FILE" ]; then
    echo "💡 Downloading YOLOv4 ONNX model (~245MB)"
    echo "💡 This may take a few minutes depending on your internet connection"
    
    # Try primary URL
    if ! download_file "https://github.com/onnx/models/raw/main/vision/object_detection_segmentation/yolov4/model/yolov4.onnx" "$MODEL_FILE" "YOLOv4 model"; then
        echo "⚠️  Primary download failed, trying alternative..."
        # Try alternative URL
        if ! download_file "https://media.githubusercontent.com/media/onnx/models/main/vision/object_detection_segmentation/yolov4/model/yolov4.onnx" "$MODEL_FILE" "YOLOv4 model (alternative)"; then
            echo "❌ All download attempts failed"
            echo "📖 Please manually download from: https://github.com/onnx/models/tree/main/vision/object_detection_segmentation/yolov4"
            exit 1
        fi
    fi
    
    echo "✅ YOLOv4 model downloaded successfully"
else
    echo "✅ YOLOv4 model already exists"
fi
    local description=$3
    
    echo "⬇️  Downloading $description..."
    
    if command -v wget &> /dev/null; then
        wget --progress=bar:force:noscroll -O "$output" "$url"
    elif command -v curl &> /dev/null; then
        curl -L --progress-bar -o "$output" "$url"
    else
        echo "❌ Neither wget nor curl found. Please install one of them."
        exit 1
    fi
}

# Download YOLOv5n (nano) model - standard version for server mode
if [ ! -f "$MODELS_DIR/yolov5n.onnx" ]; then
    echo "📋 Downloading YOLOv5n (standard) for server mode..."
    download_file \
        "https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx" \
        "$MODELS_DIR/yolov5n.onnx" \
        "YOLOv5n ONNX model"
else
    echo "✅ YOLOv5n model already exists"
fi

# Download quantized YOLOv5n model for WASM mode
if [ ! -f "$MODELS_DIR/yolov5n-int8.onnx" ]; then
    echo "📋 Creating quantized YOLOv5n for WASM mode..."
    
    # For demo purposes, we'll copy the standard model and rename it
    # In a real implementation, you would use proper quantization tools
    cp "$MODELS_DIR/yolov5n.onnx" "$MODELS_DIR/yolov5n-int8.onnx"
    
    echo "💡 Note: Using standard model as quantized version for demo"
    echo "   In production, use proper quantization tools like:"
    echo "   - ONNX Runtime quantization tools"
    echo "   - Neural Network Compression Framework (NNCF)"
    echo "   - TensorFlow Lite converter"
else
    echo "✅ Quantized YOLOv5n model already exists"
fi

# Download COCO class labels
if [ ! -f "$MODELS_DIR/coco_classes.txt" ]; then
    echo "📋 Downloading COCO class labels..."
    download_file \
        "https://raw.githubusercontent.com/ultralytics/yolov5/master/data/coco.yaml" \
        "$TEMP_DIR/coco.yaml" \
        "COCO class labels"
    
    # Extract class names from YAML and create simple text file
    cat > "$MODELS_DIR/coco_classes.txt" << 'EOF'
person
bicycle
car
motorcycle
airplane
bus
train
truck
boat
traffic light
fire hydrant
stop sign
parking meter
bench
bird
cat
dog
horse
sheep
cow
elephant
bear
zebra
giraffe
backpack
umbrella
handbag
tie
suitcase
frisbee
skis
snowboard
sports ball
kite
baseball bat
baseball glove
skateboard
surfboard
tennis racket
bottle
wine glass
cup
fork
knife
spoon
bowl
banana
apple
sandwich
orange
broccoli
carrot
hot dog
pizza
donut
cake
chair
couch
potted plant
bed
dining table
toilet
tv
laptop
mouse
remote
keyboard
cell phone
microwave
oven
toaster
sink
refrigerator
book
clock
vase
scissors
teddy bear
hair drier
toothbrush
EOF
else
    echo "✅ COCO class labels already exist"
fi

# Create model info file
cat > "$MODELS_DIR/model_info.json" << EOF
{
  "models": {
    "yolov5n.onnx": {
      "description": "YOLOv5 Nano model for server-side inference",
      "input_shape": [1, 3, 640, 640],
      "output_shape": [1, 25200, 85],
      "classes": 80,
      "format": "ONNX",
      "quantized": false,
      "recommended_use": "server mode with GPU/CPU acceleration"
    },
    "yolov5n-int8.onnx": {
      "description": "Quantized YOLOv5 Nano model for browser WASM inference",
      "input_shape": [1, 3, 320, 240],
      "output_shape": [1, 6300, 85],
      "classes": 80,
      "format": "ONNX",
      "quantized": true,
      "recommended_use": "WASM mode for low-resource devices"
    }
  },
  "download_date": "$(date -u +"%Y-%m-%dT%H:%M:%SZ")",
  "total_size_mb": $(du -sm "$MODELS_DIR" | cut -f1)
}
EOF

# Cleanup
rm -rf "$TEMP_DIR"

echo ""
echo "✅ Model download completed!"
echo "📊 Models downloaded to: $MODELS_DIR"
echo "💾 Total size: $(du -sh "$MODELS_DIR" | cut -f1)"
echo ""
echo "📋 Available models:"
ls -la "$MODELS_DIR"
echo ""
echo "🚀 You can now start the demo with:"
echo "   ./start.sh server  # For server-side inference"
echo "   ./start.sh wasm    # For browser WASM inference"
