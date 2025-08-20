import asyncio
import json
import logging
import time
import uuid
from typing import Dict, List, Optional
import os
import cv2
import numpy as np
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

# Configure logging first
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Try to import ONNX Runtime with fallback
try:
    import onnxruntime as ort
    ONNX_AVAILABLE = True
    logger.info("ONNX Runtime loaded successfully")
except ImportError as e:
    logger.warning(f"ONNX Runtime import failed: {e}")
    logger.warning("Falling back to mock inference")
    ort = None
    ONNX_AVAILABLE = False

from aiortc import RTCPeerConnection, RTCSessionDescription, MediaStreamTrack
from aiortc.contrib.media import MediaRecorder
import uvicorn
from contextlib import asynccontextmanager

class DetectionServer:
    def __init__(self):
        self.session = None
        self.model_loaded = False
        # Defaults (will be overridden after inspecting model input)
        self.model_width = 640
        self.model_height = 640
        self.input_layout = 'NCHW'  # or 'NHWC'
        self.confidence_threshold = 0.5
        self.nms_threshold = 0.4
        self.classes = self._get_coco_classes()
        # Performance tracking
        self.frame_count = 0
        self.processing_times = []
        # Coordinate transform tracking (for letterbox preprocessing)
        self.last_scale = 1.0
        self.last_dw = 0
        self.last_dh = 0

    async def initialize(self):
        """Initialize the ONNX Runtime session"""
        if not ONNX_AVAILABLE:
            logger.warning("ONNX Runtime not available, using mock inference")
            self.model_loaded = False
            return
            
        try:
            logger.info("Loading ONNX model...")
            
            # Use CPU provider for broader compatibility
            providers = ['CPUExecutionProvider']
            
            # Try to use CUDA if available and enabled
            if ort.get_available_providers().__contains__('CUDAExecutionProvider'):
                providers.insert(0, 'CUDAExecutionProvider')
                logger.info("CUDA provider available")
            
            # Use YOLOv4 model to match frontend expectations
            # YOLOv4 converted TF -> ONNX typically has input name like 'input_1:0' and shape [batch,416,416,3] (NHWC)
            # YOLOv5 models usually have shape [1,3,640,640] (NCHW) or dynamic dims.
            model_path = os.getenv('MODEL_PATH', "/app/models/yolov4.onnx")
            if not os.path.exists(model_path):
                # Fallback to yolov4 if present
                alt = "/app/models/yolov4.onnx"
                if os.path.exists(alt):
                    logger.warning(f"Primary model {model_path} missing, falling back to {alt}")
                    model_path = alt
                else:
                    logger.error(f"Model path {model_path} not found and no fallback available")
            self.session = ort.InferenceSession(
                model_path,
                providers=providers
            )
            
            # Inspect input metadata to configure preprocessing dynamically
            try:
                inp = self.session.get_inputs()[0]
                shape = list(inp.shape)
                # Remove batch dim if present
                if len(shape) == 4:
                    # Detect layout
                    if shape[1] == 3 and shape[2] > 0 and shape[3] > 0:
                        # NCHW
                        self.input_layout = 'NCHW'
                        self.model_height = int(shape[2]) if shape[2] > 0 else 640
                        self.model_width = int(shape[3]) if shape[3] > 0 else self.model_height
                    elif shape[3] == 3 and shape[1] > 0 and shape[2] > 0:
                        # NHWC
                        self.input_layout = 'NHWC'
                        self.model_height = int(shape[1]) if shape[1] > 0 else 416
                        self.model_width = int(shape[2]) if shape[2] > 0 else self.model_height
                    else:
                        # Fallback: assume square
                        self.model_height = self.model_width = 640
                        self.input_layout = 'NCHW'
                else:
                    # Unexpected rank; fallback
                    self.model_height = self.model_width = 640
                    self.input_layout = 'NCHW'
                logger.info(f"Configured model input layout={self.input_layout} size={self.model_width}x{self.model_height}")
            except Exception as meta_err:
                logger.warning(f"Failed to parse input metadata, using defaults: {meta_err}")
                self.model_height = self.model_width = 640
                self.input_layout = 'NCHW'

            self.model_loaded = True
            logger.info(f"Model loaded successfully with providers: {self.session.get_providers()}")
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            logger.warning("Falling back to mock inference")
            self.model_loaded = False
    
    def preprocess_frame(self, frame: np.ndarray) -> np.ndarray:
        """Preprocess video frame according to detected model layout with proper YOLOv4 letterboxing"""
        if self.input_layout == 'NHWC' and self.model_width == 416:
            # YOLOv4 preprocessing with letterboxing (from instructions)
            h, w = frame.shape[:2]
            target_h, target_w = self.model_height, self.model_width
            
            # Calculate scale factor
            scale = min(target_w/w, target_h/h)
            nw, nh = int(scale * w), int(scale * h)
            
            # Resize image
            resized = cv2.resize(frame, (nw, nh))
            
            # Create padded image with gray background (128)
            padded = np.full(shape=[target_h, target_w, 3], fill_value=128.0, dtype=np.uint8)
            dw, dh = (target_w - nw) // 2, (target_h - nh) // 2
            padded[dh:nh+dh, dw:nw+dw, :] = resized
            
            # BGR -> RGB and normalize
            rgb = cv2.cvtColor(padded, cv2.COLOR_BGR2RGB)
            img = rgb.astype(np.float32) / 255.0
            
            # Add batch dimension (keep NHWC format)
            img = np.expand_dims(img, axis=0)
            
            # Store transform info for coordinate conversion
            self.last_scale = scale
            self.last_dw = dw
            self.last_dh = dh
            
        else:
            # Generic preprocessing for other models (NCHW)
            resized = cv2.resize(frame, (self.model_width, self.model_height))
            rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
            img = rgb.astype(np.float32) / 255.0
            if self.input_layout == 'NCHW':
                img = np.transpose(img, (2, 0, 1))  # HWC -> CHW
            img = np.expand_dims(img, axis=0)
            
            # For stretch resize, store simple scale factors
            self.last_scale = min(self.model_width/frame.shape[1], self.model_height/frame.shape[0])
            self.last_dw = 0
            self.last_dh = 0
            
        return img
    
    def postprocess_output(self, output: np.ndarray, orig_width: int, orig_height: int) -> List[Dict]:
        """Process YOLO output and return detections with proper coordinate conversion"""
        detections = []
        
        # Check if this looks like YOLOv4 multi-scale output (3 tensors)
        if isinstance(output, list) and len(output) == 3:
            # YOLOv4 multi-scale processing would go here
            # For now, use the first output tensor
            output = output[0]
        
        # Handle single output tensor (standard YOLO format)
        # Output format: [batch, num_detections, 85] where 85 = 4 (bbox) + 1 (objectness) + 80 (classes)
        if len(output.shape) == 3:
            batch_detections = output[0]  # Remove batch dimension
        else:
            batch_detections = output
            
        for detection in batch_detections:
            # Extract confidence scores
            scores = detection[5:]
            class_id = np.argmax(scores)
            confidence = detection[4] * scores[class_id]
            
            if confidence < self.confidence_threshold:
                continue
            
            # Extract bounding box coordinates (center format)
            x_center, y_center, width, height = detection[:4]
            
            # Convert center format to corner format in model coordinates
            x1 = x_center - width / 2
            y1 = y_center - height / 2
            x2 = x_center + width / 2
            y2 = y_center + height / 2
            
            # Convert from model coordinates to original image coordinates
            if hasattr(self, 'last_scale') and hasattr(self, 'last_dw') and hasattr(self, 'last_dh'):
                # Remove padding offset
                x1 = (x1 - self.last_dw) / self.last_scale
                y1 = (y1 - self.last_dh) / self.last_scale
                x2 = (x2 - self.last_dw) / self.last_scale
                y2 = (y2 - self.last_dh) / self.last_scale
                
                # Clip to original image bounds
                x1 = max(0, min(orig_width - 1, x1))
                y1 = max(0, min(orig_height - 1, y1))
                x2 = max(0, min(orig_width - 1, x2))
                y2 = max(0, min(orig_height - 1, y2))
                
                # Convert to normalized coordinates [0,1]
                xmin = x1 / orig_width
                ymin = y1 / orig_height
                xmax = x2 / orig_width
                ymax = y2 / orig_height
            else:
                # Fallback: assume direct normalization
                xmin = max(0, x1 / self.model_width)
                ymin = max(0, y1 / self.model_height)
                xmax = min(1, x2 / self.model_width)
                ymax = min(1, y2 / self.model_height)
            
            # Skip invalid boxes
            if xmax <= xmin or ymax <= ymin:
                continue
                
            detections.append({
                'label': self.classes[class_id],
                'score': float(confidence),
                'xmin': float(xmin),
                'ymin': float(ymin),
                'xmax': float(xmax),
                'ymax': float(ymax)
            })
        
        # Apply Non-Maximum Suppression
        return self._apply_nms(detections)
    
    def _apply_nms(self, detections: List[Dict], threshold: float = None) -> List[Dict]:
        """Apply Non-Maximum Suppression to remove overlapping detections"""
        if threshold is None:
            threshold = self.nms_threshold
        
        if not detections:
            return []
        
        # Sort by confidence score
        detections.sort(key=lambda x: x['score'], reverse=True)
        
        keep = []
        while detections:
            # Keep the detection with highest confidence
            current = detections.pop(0)
            keep.append(current)
            
            # Remove detections with high IoU
            detections = [
                det for det in detections
                if self._calculate_iou(current, det) < threshold
            ]
        
        return keep
    
    def _calculate_iou(self, box1: Dict, box2: Dict) -> float:
        """Calculate Intersection over Union of two bounding boxes"""
        # Calculate intersection
        x_left = max(box1['xmin'], box2['xmin'])
        y_top = max(box1['ymin'], box2['ymin'])
        x_right = min(box1['xmax'], box2['xmax'])
        y_bottom = min(box1['ymax'], box2['ymax'])
        
        if x_right < x_left or y_bottom < y_top:
            return 0.0
        
        intersection = (x_right - x_left) * (y_bottom - y_top)
        
        # Calculate union
        area1 = (box1['xmax'] - box1['xmin']) * (box1['ymax'] - box1['ymin'])
        area2 = (box2['xmax'] - box2['xmin']) * (box2['ymax'] - box2['ymin'])
        union = area1 + area2 - intersection
        
        return intersection / union if union > 0 else 0.0
    
    async def process_frame(self, frame: np.ndarray, frame_id: str, capture_ts: int) -> Dict:
        """Process a single frame and return detection results"""
        recv_ts = int(time.time() * 1000)
        
        # If model is not loaded, return mock detections
        if not self.model_loaded:
            return self._create_mock_detection(frame_id, capture_ts, recv_ts)
        
        try:
            # Preprocess frame
            input_data = self.preprocess_frame(frame)
            
            # Run inference
            inference_start = time.time()
            
            # Get input name from model
            input_name = self.session.get_inputs()[0].name
            outputs = self.session.run(None, {input_name: input_data})
            
            inference_ts = int(time.time() * 1000)
            
            # Postprocess results
            detections = self.postprocess_output(
                outputs[0], 
                frame.shape[1], 
                frame.shape[0]
            )
            
            # Track performance
            processing_time = time.time() - inference_start
            self.processing_times.append(processing_time)
            self.frame_count += 1
            
            # Keep only recent processing times
            if len(self.processing_times) > 100:
                self.processing_times.pop(0)
            
            return {
                'frame_id': frame_id,
                'capture_ts': capture_ts,
                'recv_ts': recv_ts,
                'inference_ts': inference_ts,
                'detections': detections
            }
            
        except Exception as e:
            logger.error(f"Error processing frame: {e}")
            return {
                'frame_id': frame_id,
                'capture_ts': capture_ts,
                'recv_ts': recv_ts,
                'inference_ts': int(time.time() * 1000),
                'detections': []
            }
    
    def get_performance_stats(self) -> Dict:
        """Get current performance statistics"""
        if not self.processing_times:
            return {
                'avg_processing_time_ms': 0,
                'fps': 0,
                'frames_processed': 0
            }
        
        avg_time = np.mean(self.processing_times)
        fps = 1.0 / avg_time if avg_time > 0 else 0
        
        return {
            'avg_processing_time_ms': avg_time * 1000,
            'fps': fps,
            'frames_processed': self.frame_count
        }
    
    def _create_mock_detection(self, frame_id: str, capture_ts: int, recv_ts: int) -> Dict:
        """Create mock detection result when ONNX Runtime is not available"""
        current_ts = int(time.time() * 1000)
        return {
            'frame_id': frame_id,
            'capture_ts': capture_ts,
            'recv_ts': recv_ts,
            'inference_ts': current_ts,
            'send_ts': current_ts,
            'detections': [
                {
                    'bbox': [100, 100, 200, 200],  # x1, y1, x2, y2
                    'confidence': 0.95,
                    'label': 'person',
                    'class_id': 0
                }
            ],
            'performance': {
                'avg_processing_time_ms': 5.0,
                'fps': 20.0,
                'frames_processed': self.frame_count + 1
            }
        }
    
    def _get_coco_classes(self) -> List[str]:
        """Get COCO dataset class names"""
        return [
            'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck',
            'boat', 'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench',
            'bird', 'cat', 'dog', 'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra',
            'giraffe', 'backpack', 'umbrella', 'handbag', 'tie', 'suitcase', 'frisbee',
            'skis', 'snowboard', 'sports ball', 'kite', 'baseball bat', 'baseball glove',
            'skateboard', 'surfboard', 'tennis racket', 'bottle', 'wine glass', 'cup',
            'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
            'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch',
            'potted plant', 'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse',
            'remote', 'keyboard', 'cell phone', 'microwave', 'oven', 'toaster', 'sink',
            'refrigerator', 'book', 'clock', 'vase', 'scissors', 'teddy bear', 'hair drier',
            'toothbrush'
        ]

# Global detection server instance
detection_server = DetectionServer()

# WebRTC connection management
class WebRTCHandler:
    def __init__(self):
        self.connections: Dict[str, RTCPeerConnection] = {}
        self.data_channels: Dict[str, any] = {}
    
    async def create_connection(self, connection_id: str) -> RTCPeerConnection:
        """Create a new WebRTC peer connection"""
        pc = RTCPeerConnection()
        self.connections[connection_id] = pc
        
        @pc.on("datachannel")
        def on_datachannel(channel):
            logger.info(f"Data channel created: {channel.label}")
            self.data_channels[connection_id] = channel
        
        @pc.on("track")
        def on_track(track):
            logger.info(f"Track received: {track.kind}")
            if track.kind == "video":
                asyncio.create_task(self._process_video_track(track, connection_id))
        
        return pc
    
    async def _process_video_track(self, track: MediaStreamTrack, connection_id: str):
        """Process incoming video track frames"""
        logger.info("Starting video processing...")
        
        while True:
            try:
                frame = await track.recv()
                
                # Convert frame to numpy array
                img = frame.to_ndarray(format="bgr24")
                
                # Generate frame ID and capture timestamp
                frame_id = f"frame_{int(time.time() * 1000)}_{uuid.uuid4().hex[:8]}"
                capture_ts = int(time.time() * 1000)  # Current time as capture time
                
                # Process frame
                if detection_server.model_loaded:
                    results = await detection_server.process_frame(img, frame_id, capture_ts)
                    
                    # Send results via data channel
                    if connection_id in self.data_channels:
                        channel = self.data_channels[connection_id]
                        if channel.readyState == "open":
                            channel.send(json.dumps(results))
                
            except Exception as e:
                logger.error(f"Error processing video frame: {e}")
                break
        
        logger.info("Video processing ended")
    
    async def close_connection(self, connection_id: str):
        """Close a WebRTC connection"""
        if connection_id in self.connections:
            await self.connections[connection_id].close()
            del self.connections[connection_id]
        
        if connection_id in self.data_channels:
            del self.data_channels[connection_id]

# Global WebRTC handler
webrtc_handler = WebRTCHandler()

# FastAPI app with lifespan management
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting detection server...")
    await detection_server.initialize()
    yield
    # Shutdown
    logger.info("Shutting down detection server...")

app = FastAPI(title="WebRTC VLM Detection Server", lifespan=lifespan)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# WebSocket endpoint for signaling
@app.websocket("/ws/{connection_id}")
async def websocket_endpoint(websocket: WebSocket, connection_id: str):
    await websocket.accept()
    logger.info(f"WebSocket connection established: {connection_id}")
    
    try:
        # Create WebRTC connection
        pc = await webrtc_handler.create_connection(connection_id)
        
        while True:
            # Receive signaling message
            data = await websocket.receive_text()
            message = json.loads(data)
            
            if message["type"] == "offer":
                # Handle offer
                offer = RTCSessionDescription(
                    sdp=message["sdp"],
                    type=message["type"]
                )
                await pc.setRemoteDescription(offer)
                
                # Create answer
                answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                
                # Send answer
                await websocket.send_text(json.dumps({
                    "type": "answer",
                    "sdp": pc.localDescription.sdp
                }))
            
            elif message["type"] == "ice-candidate":
                # Handle ICE candidate
                candidate = message["candidate"]
                await pc.addIceCandidate(candidate)
    
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected: {connection_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        await webrtc_handler.close_connection(connection_id)

# Health check endpoint
@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "model_loaded": detection_server.model_loaded,
        "performance": detection_server.get_performance_stats()
    }

# Performance metrics endpoint
@app.get("/metrics")
async def get_metrics():
    return detection_server.get_performance_stats()

if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )
