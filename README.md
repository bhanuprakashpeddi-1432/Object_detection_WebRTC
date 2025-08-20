# WebRTC Real-Time Object Detection

A real-time object detection system that streams video from mobile devices to desktop viewers via WebRTC. Features dual inference modes: **WASM** (browser-based) and **Server** (Python backend).

![Architecture](https://img.shields.io/badge/WebRTC-Real--Time-blue) ![ONNX](https://img.shields.io/badge/ONNX-Runtime-green) ![Docker](https://img.shields.io/badge/Docker-Compose-blue)

## 🚀 Features

- **🎥 Real-time Video Streaming**: WebRTC P2P connection from mobile to desktop
- **🧠 Dual Inference Modes**: 
  - **WASM Mode**: Browser-based inference using ONNX Runtime Web
  - **Server Mode**: Python backend with GPU acceleration support
- **📱 Mobile Optimized**: Responsive interface with camera controls
- **⚡ Low Latency**: Optimized for real-time performance
- **🐳 Docker Ready**: One-command deployment with Docker Compose
- **🎯 YOLO Detection**: YOLOv4/YOLOv5 models with 80 COCO classes

## 📋 Prerequisites

- **Docker & Docker Compose** (recommended)
- **Node.js 18+** (for manual setup)
- **Python 3.8+** (for server mode)
- **Modern browser** with WebRTC support
- **Mobile device** with camera
- **Local network** connectivity

## 🛠️ Quick Start

### Step 1: Clone Repository
```bash
git clone https://github.com/bhanuprakashpeddi-1432/Object_detection_WebRTC.git
cd Object_detection_WebRTC
```

### Step 2: Download Models
```bash
# Download required ONNX models (YOLOv4 ~245MB)
./scripts/download_models.sh    # Linux/macOS
./scripts/download_models.bat   # Windows

# Or manually download:
cd models
wget https://github.com/onnx/models/raw/main/vision/object_detection_segmentation/yolov4/model/yolov4.onnx
```

### Step 3: Choose Deployment Mode

#### WASM Mode (Browser Inference)
```bash
# Build and start WASM profile
docker compose build
docker compose --profile wasm up -d

# Or use convenience script
./start.sh wasm     # Linux/macOS
./start.bat wasm    # Windows
```

#### Server Mode (Python Backend)
```bash
# Build and start server profile  
docker compose build
docker compose --profile server up -d

# Or use convenience script
./start.sh server   # Linux/macOS
./start.bat server  # Windows
```

### Manual Setup (Alternative)

```bash
# 1. Download models first
./scripts/download_models.sh

# 2. Frontend setup
cd frontend
npm install
npm start

# 3. Server setup (for server mode only)
cd ../server
pip install -r requirements.txt
python app.py
```

## 🌐 Access the Application

1. **Desktop Viewer**: http://localhost:3000
2. **Mobile Camera**: 
   - Scan QR code from desktop viewer
   - Or visit: http://[YOUR_IP]:3000/phone
3. **HTTPS Access**: https://localhost:3443 (requires certificates)

## 🏗️ Architecture

### WASM Mode
```
┌─────────────────┐    WebRTC Video    ┌─────────────────┐
│  Mobile Device  │ ──────────────────► │  Desktop Viewer │
│   (Camera)      │                     │  (WASM Inference)│
└─────────────────┘                     └─────────────────┘
         │                                       │
         │                                       │
         └─────────── WebSocket ─────────────────┘
                   (Signaling Server)
```

### Server Mode
```
┌─────────────────┐    WebRTC Video    ┌─────────────────┐
│  Mobile Device  │ ──────────────────► │  Desktop Viewer │
│   (Camera)      │                     │   (Display)     │
└─────────────────┘                     └─────────────────┘
         │                                       │
         │                                       ▼
         │                              ┌─────────────────┐
         │                              │  Python Server  │
         │                              │  (Inference)    │
         │                              └─────────────────┘
         │                                       │
         └─────────── WebSocket ─────────────────┘
                   (Signaling Server)
```

## 📁 Project Structure

```
webrtc-vlm-detection/
├── frontend/                 # Main web application
│   ├── public/              # Static assets
│   │   ├── js/              # Client-side JavaScript
│   │   │   ├── app.js       # Main application logic
│   │   │   ├── detection-engine.js  # WASM inference engine
│   │   │   └── webrtc-client.js     # WebRTC client
│   │   ├── css/             # Stylesheets
│   │   ├── index.html       # Desktop viewer
│   │   └── phone.html       # Mobile interface
│   ├── src/                 # Server source
│   │   ├── server.js        # Signaling server
│   │   └── shared/          # Shared utilities
│   └── package.json         # Dependencies
├── server/                  # Python inference server
│   ├── app.py              # Flask application
│   ├── detection.py        # Detection logic
│   └── requirements.txt    # Python dependencies
├── models/                 # ONNX model files
│   ├── yolov4.onnx        # Main detection model
│   └── coco_classes.txt   # Class labels
├── docker/                # Docker configurations
│   ├── Dockerfile.frontend
│   └── Dockerfile.server
├── docker-compose.yml     # Docker orchestration
├── start.sh / start.bat   # Launch scripts
└── README.md             # This file
```

## 🔧 Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `HTTPS_PORT` | HTTPS port | `3443` |
| `NODE_ENV` | Environment | `development` |
| `ENABLE_HTTPS` | Enable HTTPS | `false` |
| `MODEL_PATH` | Model directory | `./models` |

### Docker Compose Profiles

- **`wasm`**: Frontend + Signaling (browser inference)
- **`server`**: Frontend + Signaling + Python Server

### Detection Configuration

Edit `frontend/public/js/detection-engine.js`:

```javascript
// Detection thresholds
this.confidenceThreshold = 0.1;  // Confidence threshold (0.0-1.0)
this.nmsThreshold = 0.45;         // Non-maximum suppression
this.inputSize = 416;             // Model input size (YOLOv4: 416x416)
```

## 🎮 Usage Guide

### Desktop Interface

1. **Start Detection**: Begin real-time object detection
2. **Stop Detection**: Pause detection processing
3. **Confidence Slider**: Adjust detection sensitivity
4. **FPS Monitor**: View real-time performance metrics
5. **QR Code**: For easy mobile connection

### Mobile Interface

1. **Start Camera**: Activate camera and begin streaming
2. **Switch Camera**: Toggle front/rear cameras
3. **Connection Status**: WebRTC connection indicator
4. **Video Controls**: Pause/resume streaming

### Detection Features

- **Real-time Overlays**: Bounding boxes with class labels
- **80 Object Classes**: Full COCO dataset support
- **Performance Metrics**: FPS and latency monitoring
- **Confidence Filtering**: Adjustable detection thresholds

## 🚀 Deployment Modes

### WASM Mode Benefits
- ✅ **No backend required** - runs entirely in browser
- ✅ **Lower latency** - no network roundtrip for inference
- ✅ **Privacy friendly** - video never leaves device
- ✅ **Scalable** - no server resources needed
- ⚠️ **Limited by** browser performance and model size

### Server Mode Benefits
- ✅ **GPU acceleration** - faster inference with CUDA
- ✅ **Larger models** - support for bigger, more accurate models
- ✅ **Batch processing** - handle multiple streams
- ✅ **Model flexibility** - easy model swapping
- ⚠️ **Requires** Python backend and network bandwidth

## 🐛 Troubleshooting

### Common Issues

1. **Camera Access Denied**
   ```bash
   # Solution: Use HTTPS or enable camera permissions
   # Add certificates to certs/ folder
   cp server.crt server.key certs/
   ENABLE_HTTPS=1 docker compose --profile wasm up -d
   ```

2. **WebRTC Connection Failed**
   ```bash
   # Check network connectivity
   docker compose logs signaling
   
   # Verify ports are available
   netstat -tulpn | grep :3000
   ```

3. **Model Loading Issues**
   ```bash
   # Check model file exists
   ls -la models/yolov4.onnx
   
   # Verify model file size (should be ~245MB)
   du -h models/yolov4.onnx
   ```

4. **Performance Issues**
   ```bash
   # Monitor resource usage
   docker stats
   
   # Check browser console for errors
   # Reduce confidence threshold for fewer detections
   ```

### Debug Commands

```bash
# View container logs
docker compose logs -f

# Check container status
docker compose ps

# Restart services
docker compose restart

# Clean rebuild
docker compose down
docker compose build --no-cache
docker compose --profile wasm up -d
```

## 🔒 Security & Production

### Development vs Production

**Development** (Current):
- HTTP connections allowed
- Self-signed certificates
- Debug logging enabled
- No authentication

**Production Recommendations**:
- HTTPS only (valid certificates)
- Authentication system
- Rate limiting
- Error monitoring
- Load balancing

### HTTPS Setup

```bash
# Generate certificates (development only)
mkdir -p certs
openssl req -x509 -newkey rsa:4096 -keyout certs/server.key -out certs/server.crt -days 365 -nodes

# Enable HTTPS
ENABLE_HTTPS=1 docker compose --profile wasm up -d
```

## 📊 Performance Benchmarks

| Mode | Model | Avg Latency | FPS | Memory |
|------|-------|-------------|-----|--------|
| WASM | YOLOv4 | ~100ms | 8-12 | 1.2GB |
| Server | YOLOv4 | ~50ms | 15-20 | 2.0GB |
| Server + GPU | YOLOv4 | ~20ms | 30-40 | 3.5GB |

## 🤝 Contributing

1. **Fork** the repository
2. **Create** feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** changes (`git commit -m 'Add amazing feature'`)
4. **Push** to branch (`git push origin feature/amazing-feature`)
5. **Open** Pull Request

### Development Setup

```bash
# Install development dependencies
cd frontend && npm install --include=dev
cd ../server && pip install -r requirements-dev.txt

# Run tests
npm test
python -m pytest

# Lint code
npm run lint
python -m flake8
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **[ONNX Runtime](https://onnxruntime.ai/)** - Cross-platform ML inference
- **[YOLOv4](https://arxiv.org/abs/2004.10934)** - Object detection model
- **[WebRTC](https://webrtc.org/)** - Real-time communication
- **[Docker](https://www.docker.com/)** - Containerization platform
- **[Socket.IO](https://socket.io/)** - WebSocket communication

## 📞 Support

**Issues & Questions:**
- 🐛 [GitHub Issues](https://github.com/bhanuprakashpeddi-1432/Object_detection_WebRTC/issues)
- 📖 Check troubleshooting section above
- 🔍 Review browser console logs
- 📋 Include system specs and error messages

**Documentation:**
- 📚 [WebRTC Documentation](https://webrtc.org/getting-started/)
- 🧠 [ONNX Runtime Web](https://onnxruntime.ai/docs/get-started/with-javascript.html)
- 🐳 [Docker Compose Reference](https://docs.docker.com/compose/)

---

> **⚠️ Note**: This is a development/demonstration project. For production deployment, implement proper security measures, authentication, and optimization based on your specific requirements.
