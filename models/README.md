# Models Directory

This directory contains the object detection models used by the WebRTC detection system.

## Required Files

### YOLOv4 ONNX Model
- **File**: `yolov4.onnx`
- **Size**: ~245 MB
- **Description**: Pre-trained YOLOv4 model for object detection

### COCO Classes
- **File**: `coco_classes.txt` ✅ (included)
- **Description**: List of 80 object classes from the COCO dataset

## Download Instructions

The YOLOv4 ONNX model is too large for GitHub (>100MB limit). Download it using one of these methods:

### Option 1: Download Script (Recommended)
```bash
# From project root directory
./scripts/download_models.sh    # Linux/macOS
./scripts/download_models.bat   # Windows
```

### Option 2: Manual Download
```bash
# Download YOLOv4 ONNX model
cd models
wget https://github.com/onnx/models/raw/main/vision/object_detection_segmentation/yolov4/model/yolov4.onnx

# Verify file size (should be ~245 MB)
ls -lh yolov4.onnx
```

### Option 3: Convert from PyTorch
If you have a PyTorch YOLOv4 model:
```bash
# Install dependencies
pip install torch torchvision onnx

# Convert model (example script)
python scripts/convert_yolo_to_onnx.py --input yolov4.pt --output yolov4.onnx
```

## Model Information

### YOLOv4 Specifications
- **Input Size**: 416x416x3 (NHWC format)
- **Output**: Multiple detection layers
- **Classes**: 80 COCO classes
- **Architecture**: Darknet-53 backbone
- **Precision**: Float32

### Supported Formats
- ✅ **ONNX**: `.onnx` (recommended)
- ⚠️ **PyTorch**: `.pt` (requires conversion)
- ⚠️ **TensorFlow**: `.pb` (requires conversion)

## Alternative Models

You can also use other YOLO models by placing them in this directory:

### YOLOv5 Models (smaller, faster)
```bash
# Download YOLOv5n (7MB)
wget https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5n.onnx

# Download YOLOv5s (28MB)  
wget https://github.com/ultralytics/yolov5/releases/download/v7.0/yolov5s.onnx
```

### Model Comparison
| Model | Size | Speed | Accuracy |
|-------|------|-------|----------|
| YOLOv5n | 7MB | Fast | Good |
| YOLOv5s | 28MB | Medium | Better |
| YOLOv4 | 245MB | Slow | Best |

## Usage Notes

1. **WASM Mode**: Smaller models (YOLOv5n/s) load faster in browsers
2. **Server Mode**: Can handle larger models with better performance
3. **GPU Acceleration**: Server mode supports CUDA for faster inference
4. **Model Switching**: Edit `detection-engine.js` to change model priority

## Troubleshooting

### Model Not Found
```
Error: Cannot find model file
```
**Solution**: Ensure `yolov4.onnx` exists in this directory

### Model Too Large
```
Error: Model loading timeout
```
**Solution**: Use smaller model (YOLOv5n) or increase timeout

### Format Issues
```
Error: Unsupported model format
```
**Solution**: Ensure model is in ONNX format (.onnx extension)

## File Structure
```
models/
├── README.md           # This file
├── .gitkeep           # Keep directory in git
├── coco_classes.txt   # Class labels (included)
└── yolov4.onnx       # Main model (download required)
```

---

**Note**: Large model files are excluded from git to keep repository size manageable. Always ensure models are downloaded before running the application.
