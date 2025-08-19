import asyncio
import json
import logging
import time
import uuid
from typing import Dict, List, Optional
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
        self.input_shape = (320, 240)  # Width, Height for low-resource mode
        self.confidence_threshold = 0.5
        self.nms_threshold = 0.4
        self.classes = self._get_coco_classes()
        
        # Performance tracking
        self.frame_count = 0
        self.processing_times = []
        
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
            
            model_path = "/app/models/yolov5n.onnx"
            self.session = ort.InferenceSession(
                model_path,
                providers=providers
            )
            
            self.model_loaded = True
            logger.info(f"Model loaded successfully with providers: {self.session.get_providers()}")
            
        except Exception as e:
            logger.error(f"Failed to load model: {e}")
            logger.warning("Falling back to mock inference")
            self.model_loaded = False
    
    def preprocess_frame(self, frame: np.ndarray) -> np.ndarray:
        """Preprocess video frame for inference"""
        # Resize to target dimensions
        resized = cv2.resize(frame, self.input_shape)
        
        # Convert BGR to RGB
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        
        # Normalize to [0, 1] and convert to float32
        normalized = rgb.astype(np.float32) / 255.0
        
        # Convert to NCHW format (batch, channels, height, width)
        transposed = np.transpose(normalized, (2, 0, 1))
        
        # Add batch dimension
        batched = np.expand_dims(transposed, axis=0)
        
        return batched
    
    def postprocess_output(self, output: np.ndarray, orig_width: int, orig_height: int) -> List[Dict]:
        """Process YOLO output and return detections"""
        detections = []
        
        # YOLO output format: [batch, num_detections, 85]
        # 85 = 4 (bbox) + 1 (objectness) + 80 (classes)
        for detection in output[0]:
            # Extract confidence scores
            scores = detection[5:]
            class_id = np.argmax(scores)
            confidence = detection[4] * scores[class_id]
            
            if confidence < self.confidence_threshold:
                continue
            
            # Extract and convert bounding box coordinates
            x_center, y_center, width, height = detection[:4]
            
            # Convert from model coordinates to normalized coordinates
            x_center /= self.input_shape[0]  # Normalize by model width
            y_center /= self.input_shape[1]  # Normalize by model height
            width /= self.input_shape[0]
            height /= self.input_shape[1]
            
            # Convert center format to corner format
            xmin = max(0, x_center - width / 2)
            ymin = max(0, y_center - height / 2)
            xmax = min(1, x_center + width / 2)
            ymax = min(1, y_center + height / 2)
            
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
