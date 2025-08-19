# WebRTC VLM Multi-Object Detection Demo

**Real-time multi-object detection on live video streamed from a phone via WebRTC, returns detection bounding boxes + labels to the browser, overlays them in near real-time.**

## 🚀 One-Command Start Instructions

**Server Mode (Python + ONNX Runtime):**
```bash
docker-compose --profile server up --build
```

**WASM Mode (Browser-side inference):**
```bash
docker-compose --profile wasm up --build
```

**Using convenience script:**
```bash
./start.sh server  # Server-side inference
./start.sh wasm    # Browser-side inference (WASM)
```

## 📱 Phone-Join Instructions

1. **Same Network Connection:**
   - Desktop (viewer): Open http://localhost:3000
   - Phone (camera publisher): Open http://[YOUR_IP]:3000/phone  (must include /phone)

2. **Using ngrok (if phones can't reach laptop directly):**
   ```bash
   ./start.sh server --ngrok
   # Copy the ngrok URL to your phone
   ```

3. **QR Code Access:**
   - QR code displayed in the viewer encodes the phone URL (including /phone)
   - Scan with phone camera; accept camera permission prompt

## 🔁 Mode Switch

1. Start the demo using the command above
2. Open your phone's browser (Chrome on Android, Safari on iOS)
3. Navigate to one of these URLs:
   - **QR Code**: Scan the QR code in the viewer UI
   - **Local Network (viewer)**: `http://[YOUR_IP]:3000`
   - **Local Network (phone)**: `http://[YOUR_IP]:3000/phone`
   - **Localhost** (if on same device): `http://localhost:3000`

## 🎯 Modes

### Server Mode (`MODE=server`)
- Object detection runs on the server using ONNX Runtime
- Higher accuracy with larger models
- Requires more computational resources
- Supports GPU acceleration with `--gpu` flag

### WASM Mode (`MODE=wasm`)
- Object detection runs in the browser using WASM
- Lower resource usage, runs on modest laptops
- Uses quantized models optimized for browser execution
- Target: 10-15 FPS at 320×240 resolution

## 📊 Benchmarking

Run a 30-second benchmark to measure performance (ensure both viewer & phone pages are active, or use automated script):

```bash
./bench/run_bench.sh -duration 30 -mode server
# OR
./bench/run_bench.sh -duration 30 -mode wasm
```

This generates or downloads `metrics.json` with:
- Median & P95 end-to-end latency
- Processed FPS
- Network uplink/downlink bandwidth

## 🏗️ Architecture

```
Phone Browser → WebRTC → Signaling Server → Processing (Server/WASM) → Results → Overlay
```

### Components:
- **Signaling Server**: WebRTC connection management (Node.js)
- **Server Mode**: Python inference server with ONNX Runtime
- **WASM Mode**: Browser-based inference with onnxruntime-web
- **Frontend**: Video display and bounding box overlay (HTML5 Canvas)

## 🔧 API Contract

Detection results are sent as JSON messages:

```json
{
  "frame_id": "frame_12345",
  "capture_ts": 1690000000000,
  "recv_ts": 1690000000100,
  "inference_ts": 1690000000150,
  "detections": [
    {
      "label": "person",
      "score": 0.93,
      "xmin": 0.12,
      "ymin": 0.08,
      "xmax": 0.34,
      "ymax": 0.67
    }
  ]
}
```

Coordinates are normalized [0..1] relative to frame dimensions.

## 🎥 Demo Video

Add Loom link here (1 minute: phone stream, overlays, metrics, one-line improvement).

## 📋 Requirements

- Docker & Docker Compose
- Modern browser with WebRTC support
- For server mode: Python 3.9+, ONNX Runtime
- For WASM mode: Node.js 16+

## 🛠️ Development

### Project Structure
```
├── frontend/           # Browser-based WASM inference
├── server/            # Python inference server
├── docker/            # Dockerfiles
├── bench/             # Benchmarking scripts
├── models/            # Pre-trained models
├── scripts/           # Utility scripts
├── docker-compose.yml
├── start.sh
└── README.md
```

### Local Development
```bash
# Install dependencies
cd server && pip install -r requirements.txt
cd frontend && npm install

# Start signaling server
cd frontend && npm run dev

# Start inference server (server mode)
cd server && python app.py
```

## 🐛 Troubleshooting

### Common Issues:

1. **Camera not detected**: Ensure phone browser has camera permissions
2. **Connection failed**: Check firewall settings and network connectivity
3. **Poor performance**: Try WASM mode or enable GPU acceleration
4. **Model not found**: Run `./scripts/download_models.sh`

### Network Issues:
- Ensure ports 3000, 8000, 8001, 8080 are available
- For remote connections, use your machine's IP address
- Check WebRTC connectivity through firewalls

### Performance Tips:
- Use WiFi connection for phone
- Close other applications to free resources
- Enable GPU acceleration in server mode if available
- Adjust frame rate and resolution in browser settings

## 📈 Performance Metrics

Typical performance on modern hardware:

**Server Mode:**
- E2E Latency: 150-300ms (median), 400-600ms (P95)
- FPS: 15-25
- CPU Usage: 60-80%

**WASM Mode:**
- E2E Latency: 100-200ms (median), 250-400ms (P95)  
- FPS: 10-15
- CPU Usage: 40-60%

## 🔒 Security / HTTPS Notes

For iOS Safari camera access over LAN you generally need HTTPS (or use a tunneling service providing HTTPS):

```bash
# Generate self-signed cert (development only)
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 365 -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost" 
# Start with HTTPS enabled
ENABLE_HTTPS=1 docker-compose --profile wasm up --build
```

Then open: https://YOUR_LAN_IP:3443 (viewer) and https://YOUR_LAN_IP:3443/phone (phone). Accept the self-signed certificate warning once.

Alternatively run with ngrok to obtain a trusted public HTTPS URL:

```bash
./start.sh wasm --ngrok
```

The script will print a public URL you can open on the phone.

## 🔬 Quantized Model Note
`yolov5n-int8.onnx` is presently a placeholder copy of `yolov5n.onnx` for demo simplicity. Replace with a truly quantized export using ONNX Runtime quantization (`python -m onnxruntime.quantization.quantize_dynamic`).

- This is a demo application - not production ready
- WebRTC connections use STUN/TURN for NAT traversal
- No authentication or encryption beyond WebRTC built-ins
- Local network access only by default
