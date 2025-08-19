<div align="center">

# WebRTC Multi‑Object Detection
Stream phone camera → real‑time object detection (WASM or Server) → live overlay + metrics.

</div>

---

## Docker deployment (recommended)

Prefer running the demo with Docker Compose — images are provided for the signaling/frontend and the optional server backend. This is the quickest, most reproducible way to run the demo on your machine or CI.

- Build and start the recommended WASM profile (viewer + signaling, inference in browser):

Linux / macOS:
```bash
docker compose build
docker compose --profile wasm up -d
```

Windows (PowerShell):
```powershell
docker compose build; docker compose --profile wasm up -d
```

- To run the server inference profile (viewer + signaling + Python server):

Linux / macOS:
```bash
docker compose build
docker compose --profile server up -d
```

Windows (PowerShell):
```powershell
docker compose build; docker compose --profile server up -d
```

- Notes:
   - The viewer is served on port 3000 (HTTP) and 3443 (HTTPS when enabled). Ensure these ports are available or stop conflicting containers.
   - To enable HTTPS (development only) place `server.crt`/`server.key` in a `certs/` folder and set `ENABLE_HTTPS=1` in the environment before starting the stack, or use the launcher script with `--ngrok` (see below) for a public HTTPS URL.
   - To stop the demo: `docker compose down` (or `docker compose --profile wasm down`).


## 1. Overview
Phone browser sends live video to a desktop viewer over WebRTC. The viewer runs object detection either:
1. In‑browser (WASM: onnxruntime‑web) – default
2. On a Python container (Server mode)

Detections (labels + boxes) draw over the video. Benchmark mode measures median / P95 latency & FPS.

---

## 2. Features
| Area | Feature |
|------|---------|
| Streaming | WebRTC peer connection (phone → viewer) |
| Inference | Dual mode: `wasm` or `server` |
| Performance | 320×320 center crop, frame drop (freshest only) |
| Metrics | Live cards + 30s benchmark → `metrics.json` |
| Deployment | Docker Compose profiles (`wasm`, `server`) + helper scripts |
| Remote Access | Optional HTTPS & `--ngrok` flag |
| Models | YOLOv5n baseline + placeholder int8 copy |

---

## 3. Quick Start
Linux / macOS:
```bash
git clone <your-repo-url>
cd webrtc-vlm-detection
./start.sh wasm      # start WASM inference mode
# or
./start.sh server    # start server inference mode
```
Windows (PowerShell):
```powershell
git clone <your-repo-url>
cd webrtc-vlm-detection
./start.bat wasm
./start.bat server
```
Then:
1. Open viewer: http://localhost:3000
2. Phone (same Wi‑Fi): http://<LAN-IP>:3000/phone  (QR code shown in viewer)
3. Phone: Start Camera → Viewer: Start Detection.
If iOS blocks camera (HTTP) use HTTPS or `--ngrok` (see section 8).

---

## 4. Repository Layout
```
bench/               Benchmark automation (Puppeteer)
docker/              Dockerfiles
frontend/            Viewer + phone pages + signaling server
models/              ONNX models (yolov5n + placeholder int8)
scripts/             Model download helpers
server/              Python inference service
start.sh|start.bat   Launch scripts
docker-compose.yml   Orchestration (profiles: wasm, server)
report.md            Design & rationale
```

---

## 5. Modes
| Mode  | Runs Where | Use When | Pros | Tradeoffs |
|-------|------------|----------|------|-----------|
| wasm  | Browser    | Simplicity / privacy | Zero extra latency hop | CPU bound, small models |
| server| Python svc | Need larger / optimized models | Potential GPU, custom ops | Adds network hop |

Switch modes without changing the phone page.

---

## 6. Launch & Switch
```bash
./start.sh wasm
./start.sh server
```
Stop services: `docker compose down`.

---

## 7. Phone Access
| Scenario | Action |
|----------|--------|
| Same LAN | http://<LAN-IP>:3000/phone |
| QR Code  | Scan code displayed on viewer page |
| Firewall / mobile data | `./start.sh wasm --ngrok` (copy HTTPS URL + /phone) |
| iOS (needs HTTPS) | Use self‑signed cert (below) or ngrok |

Always include `/phone` for the phone page.

---

## 8. HTTPS & ngrok
Self‑signed (development only):
```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
  -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
ENABLE_HTTPS=1 ./start.sh wasm
```
Open: https://<LAN-IP>:3443 (viewer) and https://<LAN-IP>:3443/phone (phone). Accept warning.

ngrok tunnel:
```bash
./start.sh wasm --ngrok
```
Use printed HTTPS URL (append `/phone` if not included).

---

## 9. Models
Included: `yolov5n.onnx` + `yolov5n-int8.onnx` (placeholder duplicate). Real dynamic quantization example:
```bash
python -m onnxruntime.quantization.quantize_dynamic \
  --model_input yolov5n.onnx --model_output yolov5n-int8.onnx \
  --optimize_model
```
Replace model files in `models/` and restart containers to swap.

---

## 10. Processing Flow
```
Phone Camera → WebRTC → Viewer (WASM inference & overlay)
             OR
Phone → WebRTC → Server (inference) → Viewer (overlay)
```
Backpressure: only newest frame processed (old frames dropped) for lower latency.

---

## 11. Benchmarking
Viewer UI: click Benchmark (30 s) → downloads/updates `metrics.json`.
CLI:
```bash
./bench/run_bench.sh -duration 30 -mode wasm
./bench/run_bench.sh -duration 30 -mode server
```
Outputs: median & P95 end‑to‑end latency, FPS (bandwidth currently placeholder – roadmap).

---

## 12. Detection JSON Schema
```json
{
  "frame_id": "frame_123",
  "capture_ts": 1690000000000,
  "recv_ts": 1690000000100,
  "inference_ts": 1690000000150,
  "detections": [
    { "label": "person", "score": 0.93, "xmin": 0.12, "ymin": 0.08, "xmax": 0.34, "ymax": 0.67 }
  ]
}
```
Coordinates normalized [0..1]. In WASM mode this object is generated locally.

---

## 13. Metrics & Targets
| Metric | Definition | Target (WASM) | Target (Server) |
|--------|------------|---------------|-----------------|
| End‑to‑End Latency | display_ts − capture_ts (approx in WASM) | 100–220 ms median | 150–300 ms median |
| P95 Latency | 95th percentile of E2E | < 420 ms | < 600 ms |
| Processing FPS | processed frames per second | 10–15 | 15–25 |
| Inference Latency | inference_ts − recv_ts | < ~70 ms | < ~50 ms |

Planned: real capture timestamps from phone + true bandwidth via `getStats()`.

---

## 14. Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|
| No camera prompt | Opened root instead of /phone | Use http://<LAN-IP>:3000/phone |
| iOS camera blocked | Insecure HTTP | Use HTTPS or ngrok |
| No detections | Model not loaded / threshold high | Refresh, check console logs |
| Port 3000 busy | Previous container running | `docker ps`, stop & restart |
| metrics.json missing bandwidth | Not implemented | Add getStats (roadmap) |

Performance tips: stable Wi‑Fi, close heavy apps, start with WASM, keep model small.

---

## 15. Development
```bash
# Optional local (outside Docker)
cd server && pip install -r requirements.txt
cd frontend && npm install

# Rebuild images after code/model changes
docker compose build
```
Run containers again with `./start.sh wasm` or `./start.sh server`.

---

## 16. Design Choices (Summary)
| Aspect | Choice | Rationale |
|--------|-------|-----------|
| Transport | WebRTC + Socket.IO | Low latency + simple signaling |
| Input Size | 320×320 | Balanced speed & accuracy |
| Backpressure | Drop oldest frame | Keeps latency low & boxes fresh |
| Model | YOLOv5n | Small, broadly known baseline |
| WASM Runtime | onnxruntime‑web | Portable, no native build |
| Metrics | UI + script benchmark | Reproducible measurement |

See `report.md` for deeper detail.

---

## 17. Roadmap / Next Improvements
1. Real phone capture timestamp via data channel
2. Real bandwidth stats (`RTCPeerConnection.getStats()`)
3. Genuine quantized / WebGPU or WebNN model variant
4. Completed server round‑trip (phone → server → viewer) path default
5. Adaptive frame skipping / dynamic resolution
6. Multi‑session + authentication & authorization
7. Optional GPU (CUDA) build profile

---

## 18. License
Add license text (e.g. MIT) here.

---

## 19. Support
Open an issue or PR for questions and improvements.

Enjoy building! 🔧
<div align="center">

# WebRTC Multi‑Object Detection Demo

Real‑time multi‑object detection on live video streamed from a phone (browser only) to a desktop viewer via WebRTC. Inference runs either:

1. In the browser (WASM mode, low‑resource, onnxruntime‑web)
2. On a server container (server mode, Python + ONNX Runtime CPU/GPU)

Detections (labels + bounding boxes) overlay live with performance metrics & a 30‑second benchmark tool.

</div>

---

## ✨ Key Features

- Phone → Viewer WebRTC live video (no native app; just browser)
- Dual inference modes: `wasm` (on-device) or `server` (Python backend)
- Low‑resource strategy: 320×320 input, frame queue with drop‑oldest backpressure, reduced FPS target
- Dynamic model load with fallback path & small YOLOv5n variant placeholder quantized model
- Benchmark script + in‑page benchmark (median & P95 latencies, FPS)
- Optional HTTPS & ngrok tunneling for iOS / remote phone access

---

## 🚀 Quick Start (Most Users)

```bash
# Clone
git clone <your-repo-url>
cd webrtc-vlm-detection

# Start low-resource WASM mode (phone + viewer)
./start.sh wasm

# In a second terminal (or same after start) if you want server mode instead:
./start.sh server
```

Then:
1. Open the **viewer**: http://localhost:3000
2. On your phone (same LAN), open: http://<your-laptop-LAN-IP>:3000/phone  (or scan the QR code visible in viewer)
3. Tap **Start Camera** on phone; click **Start Detection** on viewer.

> iOS Safari on a non‑HTTPS LAN origin may block camera. Use the HTTPS section or `--ngrok` below.

---

## 📁 Project Layout

```
bench/                Benchmark runner (Puppeteer)
docker/               Dockerfiles (signaling, server, frontend)
frontend/             Signaling + static frontend (viewer & phone pages)
models/               ONNX model files (download or copied into image)
scripts/              Utility scripts (model download)
server/               Python inference server (server mode)
start.sh              Unified launcher (modes + optional ngrok)
docker-compose.yml    Orchestration (profiles: wasm, server, legacy)
report.md             Design & technical details
```

---

## 🧪 Modes

| Mode   | Inference Location | When to Use | Pros | Tradeoffs |
|--------|--------------------|-------------|------|-----------|
| wasm   | Browser (viewer)   | Low power / no Python | Simple deploy, stays local | CPU bound, limited optimizations |
| server | Python container   | More compute / GPU    | Potentially faster / heavier models | Needs server resources & network latency |

Start with WASM; switch to server once image pipeline confirmed.

---

## 📱 Phone Join

2. **ngrok Tunnel (if LAN blocked / mobile data)**
    ./start.sh wasm --ngrok   # or server --ngrok
    # Copy printed https://*.ngrok-free.app URL -> open <url>/phone on phone
    ```
3. **QR Code**
    - Viewer shows QR embedding `http://<LAN-IP>:3000/phone`
    - Scan → open → tap Start Camera
4. **HTTPS (iOS Safari)**
    - See HTTPS section below for self‑signed cert or use `--ngrok`.

Phone always uses the `/phone` path; viewer always base `/`.
---

## 🔁 Switching Modes
```bash
./start.sh wasm
./start.sh server
```
Environment variable `MODE` is set automatically.
---
## 🧠 Model Notes

## 🔬 Automated Benchmark Script
- For a real quantized model:
   ```bash
   <div align="center">

   # WebRTC Multi‑Object Detection
   Real‑time multi‑object detection streamed from a phone browser to a desktop viewer via WebRTC. Run inference either in the browser (WASM) or on a Python server container. Detections (labels + boxes) render live with performance metrics and a 30‑second benchmark.

   </div>

   ---

   ## 1. Features
   * Phone → Viewer low‑latency WebRTC (no native app)
   * Two inference modes: `wasm` (onnxruntime‑web) or `server` (Python ONNX Runtime)
   * Low‑resource pipeline: 320×320 center crop, frame queue with drop‑oldest backpressure
   * On‑page & automated benchmark (median / P95 latency, FPS)
   * Optional HTTPS & ngrok for iOS / remote access
   * Simple model swap (YOLOv5n baseline + placeholder quantized copy)

   ---

   ## 2. Quick Start

   Linux / macOS:
   ```bash
   git clone <your-repo-url>
   cd webrtc-vlm-detection
   ./start.sh wasm      # start signaling + viewer (WASM inference)
   # or
   ./start.sh server    # start signaling + server inference stack
   ```

   Windows (PowerShell):
   ```powershell
   git clone <your-repo-url>
   cd webrtc-vlm-detection
   ./start.bat wasm
   # or
   ./start.bat server
   ```

   Then:
   1. Desktop viewer: http://localhost:3000
   2. Phone (same Wi‑Fi): http://<LAN-IP>:3000/phone  (scan the QR in viewer if easier)
   3. Phone: tap Start Camera → Desktop: click Start Detection.

   Note: iOS Safari usually requires HTTPS (see section 7) or ngrok.

   ---

   ## 3. Project Layout
   ```
   bench/               Benchmark (Puppeteer automation)
   docker/              Dockerfiles
   frontend/            Viewer + phone pages + signaling server
   models/              ONNX models (yolov5n + placeholder int8 copy)
   scripts/             Helper scripts (model download)
   server/              Python inference service (server mode)
   start.sh|start.bat   Unified launcher
   docker-compose.yml   Orchestration (profiles: wasm, server)
   report.md            Design / rationale
   ```

   ---

   ## 4. Modes
   | Mode | Where Inference Runs | Use When | Pros | Tradeoffs |
   |------|----------------------|---------|------|-----------|
   | wasm | Browser (viewer)     | Simplicity, local only | Minimal setup, private | CPU bound, small models |
   | server | Python container   | Need more performance | Larger / optimized models, potential GPU | Network hop adds latency |

   Default recommendation: validate with `wasm`, then experiment with `server`.

   ---

   ## 5. Phone Join (Publisher)
   1. Same LAN (first test): `http://<LAN-IP>:3000/phone` (viewer at `http://localhost:3000`)
   2. ngrok (firewall / mobile data): `./start.sh wasm --ngrok` (copy printed https URL + append `/phone`)
   3. QR Code: scan from viewer page; it encodes the phone URL
   4. HTTPS (iOS): use self‑signed cert or ngrok (see section 7)

   Always include `/phone` for the phone; viewer uses the root `/`.

   ---

   ## 6. Switch Modes
   ```bash
   ./start.sh wasm
   ./start.sh server
   ```
   Environment variable `MODE` is set automatically inside containers.

   ---

   ## 7. HTTPS & Remote Access
   Self‑signed (dev only):
   ```bash
   mkdir -p certs
   openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
      -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
   ENABLE_HTTPS=1 ./start.sh wasm
   ```
   Open viewer: https://<LAN-IP>:3443  and phone: https://<LAN-IP>:3443/phone (accept warning).
<div align="center">

# WebRTC Multi‑Object Detection
Real‑time multi‑object detection from a phone browser to a desktop viewer using WebRTC.

</div>

---

## 1. Overview
Phone sends live video via WebRTC. Viewer receives stream and runs object detection either:
1. In the browser (WASM / onnxruntime‑web)
2. On a Python server container (server mode)

Detections (labels + bounding boxes) overlay on the video with live metrics and an optional 30‑second benchmark.

---

## 2. Features
* Two inference modes: `wasm` (default) or `server`
* Low‑resource pipeline (320×320 center crop, frame queue + drop‑oldest)
* Automatic model hosting (YOLOv5n baseline + placeholder int8 copy)
* Benchmark: median & P95 latency, FPS (bandwidth placeholder)
* Optional HTTPS + ngrok tunnel for iOS/remote

---

## 3. Quick Start
Linux / macOS:
```bash
git clone <your-repo-url>
cd webrtc-vlm-detection
./start.sh wasm   # start WASM mode
# or
./start.sh server # start server mode
```
Windows (PowerShell):
```powershell
git clone <your-repo-url>
cd webrtc-vlm-detection
./start.bat wasm
./start.bat server
```
Then:
1. Viewer (desktop): http://localhost:3000
2. Phone (same Wi‑Fi): http://<LAN-IP>:3000/phone  (QR code available in viewer)
3. Phone: Start Camera → Viewer: Start Detection.
Note (iOS): needs HTTPS or ngrok (see section 7).

---

## 4. Project Structure
```
bench/               Benchmark automation (Puppeteer)
docker/              Dockerfiles
frontend/            Viewer + phone pages + signaling
models/              ONNX models (yolov5n + placeholder int8)
scripts/             Helper scripts (model download)
server/              Python inference service
start.sh|start.bat   Unified launcher
docker-compose.yml   Orchestration (profiles: wasm, server)
report.md            Design & rationale
```

---

## 5. Modes
| Mode  | Inference Location | Use When | Pros | Tradeoffs |
|-------|--------------------|----------|------|-----------|
| wasm  | Browser (viewer)   | Simplicity & privacy | No server hop, easy start | CPU bound, small models |
| server| Python container   | Need speed / larger models | Potential GPU, optimization | Network latency, more setup |

---

## 6. Phone Join (Publisher)
1. Same LAN: `http://<LAN-IP>:3000/phone` (viewer stays at `http://localhost:3000`)
2. ngrok: `./start.sh wasm --ngrok` (copy HTTPS URL, append /phone if needed)
3. QR Code: scan code on viewer page
4. HTTPS (iOS): use self‑signed cert or ngrok (section 7)

Always include `/phone` for the phone page.

---

## 7. HTTPS & ngrok
Self‑signed (dev only):
```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
   -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
ENABLE_HTTPS=1 ./start.sh wasm
```
Open: https://<LAN-IP>:3443 (viewer) and https://<LAN-IP>:3443/phone (phone) → accept warning.
<div align="center">

# WebRTC Multi‑Object Detection
A clear, end‑to‑end demo: stream phone camera → run object detection (WASM or Server) → overlay detections & metrics in the browser.

</div>

---

<div align="center">

# WebRTC Multi‑Object Detection
A clear, end‑to‑end demo: stream phone camera → run object detection (WASM or Server) → overlay detections & metrics in the browser.

</div>

---

## 1. Overview
Live video from a phone browser is sent to a desktop viewer using WebRTC. Detection runs:
1. In the viewer (WASM: onnxruntime‑web)
2. Or in a Python server container (Server mode)

You can switch modes without changing the phone page.

---

## 2. Features
| Category | Highlight |
|----------|-----------|
| Streaming | WebRTC peer connection (phone → viewer) |
| Inference | Dual mode: `wasm` (default) or `server` |
| Performance | 320×320 center crop + frame drop (freshest frame) |
| Metrics | Median / P95 latency, FPS (benchmark + live) |
| Deployment | Docker Compose profiles (`wasm`, `server`) |
| Remote Access | Optional HTTPS + ngrok flag |
| Models | YOLOv5n + placeholder int8 copy (easy swap) |

---

## 3. Quick Start
Linux / macOS:
```bash
git clone <your-repo-url>
cd webrtc-vlm-detection
./start.sh wasm      # start signaling + viewer (WASM inference)
# or
./start.sh server    # start signaling + server inference
```
Windows (PowerShell):
```powershell
git clone <your-repo-url>
cd webrtc-vlm-detection
./start.bat wasm
./start.bat server
```
Open viewer: http://localhost:3000
Open phone (same Wi‑Fi): http://<LAN-IP>:3000/phone (or scan QR shown in viewer)
Phone: tap Start Camera → Viewer: click Start Detection.
If iOS blocks camera (HTTP), use HTTPS or `--ngrok` (see section 7).

---

## 4. Directory Layout
```
bench/               Benchmark automation (Puppeteer)
docker/              Dockerfiles
frontend/            Viewer + phone pages + signaling server
models/              ONNX models (yolov5n, placeholder int8)
scripts/             Model download / helpers
server/              Python inference server
start.sh|start.bat   Launch scripts
docker-compose.yml   Orchestration (profiles)
report.md            Design details
```

---

## 5. Modes
| Mode  | Inference Site | Use When | Pros | Tradeoffs |
|-------|-----------------|----------|------|-----------|
| wasm  | Browser (viewer)| Easiest start, privacy | No extra backend latency | CPU bound, small models |
| server| Python container| Need heavier / optimized models | Potential GPU / optimizations | Adds network hop |

Switch via launcher (section 6). Start with `wasm` to validate pipeline.

---

## 6. Start / Switch Modes
```bash
./start.sh wasm
./start.sh server
```
Stop: `docker compose down` (or Ctrl+C if foreground). Environment variable `MODE` is set internally.

---

## 7. Phone Access Options
| Scenario | URL / Action |
|----------|--------------|
| Same LAN (default) | http://<LAN-IP>:3000/phone |
| QR Code | Scan QR on viewer page (encodes above URL) |
| HTTPS (iOS) | Generate self‑signed cert or use ngrok |
| Remote / mobile data | `./start.sh wasm --ngrok` and open printed https URL + `/phone` |

Always include `/phone` for the phone page; viewer stays at `/`.

---

## 8. HTTPS & ngrok
Self‑signed (development only):
```bash
mkdir -p certs
openssl req -x509 -nodes -newkey rsa:2048 -days 365 \
   -keyout certs/server.key -out certs/server.crt -subj "/CN=localhost"
ENABLE_HTTPS=1 ./start.sh wasm
```
Visit: https://<LAN-IP>:3443 and https://<LAN-IP>:3443/phone (accept warning).

ngrok tunnel:
```bash
./start.sh wasm --ngrok
```
Use printed HTTPS URL (append `/phone` if needed).

---

## 9. Models
Provided: `yolov5n.onnx` + `yolov5n-int8.onnx` (placeholder duplicate). For real dynamic quantization:
```bash
python -m onnxruntime.quantization.quantize_dynamic \
   --model_input yolov5n.onnx --model_output yolov5n-int8.onnx \
   --optimize_model
```
Swap models by replacing files in `models/` and restarting containers.

---

## 10. Processing Flow
```
Phone Camera → WebRTC → Viewer (WASM inference & overlay)
                   OR
Phone → WebRTC → Server (inference) → Viewer (overlay)
```
Backpressure: newest frame only (old frames dropped). Crop & resize to 320×320 to reduce compute.

---

## 11. Benchmarking
In viewer: click Benchmark (runs 30 s) → downloads/updates `metrics.json`.
CLI (headless):
```bash
./bench/run_bench.sh -duration 30 -mode wasm
./bench/run_bench.sh -duration 30 -mode server
```
Outputs median / P95 latency + FPS. (Bandwidth metric is a placeholder until getStats integration.)

---

## 12. Detection JSON Schema
```json
{
   "frame_id": "frame_123",
   "capture_ts": 1690000000000,
   "recv_ts": 1690000000100,
   "inference_ts": 1690000000150,
   "detections": [
      { "label": "person", "score": 0.93, "xmin": 0.12, "ymin": 0.08, "xmax": 0.34, "ymax": 0.67 }
   ]
}
```
Coordinates normalized [0..1]. In current WASM path this object is built locally (no round trip).

---

## 13. Metrics Definitions & Targets
| Metric | Definition | Target (WASM) | Target (Server) |
|--------|------------|---------------|-----------------|
| End‑to‑End Latency | display_ts − capture_ts (approx in WASM) | 100–220 ms median | 150–300 ms median |
| P95 Latency | 95th percentile of E2E | < 420 ms | < 600 ms |
| Processing FPS | processed frames / s | 10–15 | 15–25 |
| Inference Latency | inference_ts − recv_ts | < ~70 ms | < ~50 ms |

Improvement planned: real capture timestamp from phone via data channel, plus real bandwidth via getStats.

---

## 14. Troubleshooting
| Symptom | Cause | Fix |
|---------|-------|-----|
| No camera prompt | Opened root instead of /phone | Use http://<LAN-IP>:3000/phone |
| iOS blocks camera | Insecure HTTP | Use HTTPS or ngrok |
| No detections drawn | Model not loaded / threshold too high | Refresh, check console logs |
| Port 3000 busy | Previous container active | `docker ps`, stop/remove, restart |
| metrics.json lacks bandwidth | Not yet implemented | Add getStats collection (future) |

Performance tips: close heavy apps, stable Wi‑Fi, start with WASM, keep model small.

---

## 15. Development
```bash
# (Optional) server mode dependencies outside Docker
cd server && pip install -r requirements.txt

# Frontend deps (if editing locally)
cd frontend && npm install

# Rebuild containers after changes
docker compose build
```

---

## 16. Design Choices (Summary)
| Aspect | Choice | Reason |
|--------|-------|--------|
| Transport | WebRTC + Socket.IO | Low latency media + simple signaling |
| Input Size | 320×320 | Balanced speed & accuracy for demo |
| Backpressure | Drop oldest frame | Prefer freshest view |
| Model | YOLOv5n | Small, common baseline |
| Runtime (WASM) | onnxruntime‑web | No native build step |
| Metrics | Script + UI | Repeatable benchmarking |

See `report.md` for deeper detail.

---

## 17. Next Improvements
1. Real capture timestamps via data channel
2. Real bandwidth stats (getStats)
3. Genuine quantized / WebGPU model variant
4. Server inference round‑trip finalized
5. Adaptive frame skipping based on latency
6. Multi‑session management + auth
7. Optional GPU (CUDA) profile

---

## 18. License
Add license text (e.g. MIT) here.

---

## 19. Support
Open an issue or PR with questions or improvements.

Enjoy building! 🔧
