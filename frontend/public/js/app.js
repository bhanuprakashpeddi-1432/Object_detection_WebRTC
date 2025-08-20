// Main Application Logic
class VLMDetectionApp {
    constructor() {
        this.webrtcClient = null;
        this.detectionEngine = null;
        this.isRunning = false;
        this.isBenchmarking = false;
        
        // UI elements
        this.elements = {
            remoteVideo: document.getElementById('remoteVideo'),
            overlayCanvas: document.getElementById('overlayCanvas'),
            connectionStatus: document.getElementById('connectionStatus'),
            startBtn: document.getElementById('startBtn'),
            stopBtn: document.getElementById('stopBtn'),
            benchBtn: document.getElementById('benchBtn'),
            e2eLatency: document.getElementById('e2eLatency'),
            processingFps: document.getElementById('processingFps'),
            networkLatency: document.getElementById('networkLatency'),
            detectionCount: document.getElementById('detectionCount'),
            connectionUrl: document.getElementById('connectionUrl'),
            qrCode: document.getElementById('qrCode'),
            detectionInfo: document.getElementById('detectionInfo')
        };
        
        // Metrics tracking
        this.metrics = {
            latencies: [],
            networkLatencies: [],
            frameCount: 0,
            startTime: null,
            lastDetectionTime: null
        };
        
        // Canvas context for overlay
        this.overlayCtx = this.elements.overlayCanvas.getContext('2d');
        // Store last detections with pixel coords for click interaction
        this.lastDetections = [];
        
        this.init();
    }
    
    async init() {
        try {
            // Load connection info
            await this.loadConnectionInfo();
            
            // Initialize WebRTC client
            this.webrtcClient = new WebRTCClient();
            this.setupWebRTCCallbacks();
            
            // Initialize detection engine for WASM mode
            if (!this.webrtcClient.isPhone) {
                console.log('[App] Initializing detection engine...');
                this.detectionEngine = new DetectionEngine();
                this.setupDetectionCallbacks();
                
                // Start model loading immediately (don't wait for video connection)
                console.log('[App] Starting early model preloading...');
                this.detectionEngine.initialize().then(() => {
                    console.log('[App] Detection engine initialized, ready:', this.detectionEngine.isReady());
                }).catch(err => {
                    console.error('[App] Detection engine initialization failed:', err);
                });
            } else {
                console.log('[App] Phone mode detected, skipping detection engine');
            }
            
            // Setup UI event listeners
            this.setupUIEventListeners();
            
            console.log('App initialized successfully');
        } catch (error) {
            console.error('Failed to initialize app:', error);
            this.showError('Failed to initialize application: ' + error.message);
        }
    }
    
    async loadConnectionInfo() {
        try {
            const response = await fetch('/api/connection-info');
            const info = await response.json();
            
            this.elements.connectionUrl.textContent = info.url;
            
            if (info.qrCode) {
                this.elements.qrCode.src = info.qrCode;
                this.elements.qrCode.style.display = 'block';
            }
        } catch (error) {
            console.error('Failed to load connection info:', error);
            this.elements.connectionUrl.textContent = 'Failed to load connection info';
        }
    }
    
    setupWebRTCCallbacks() {
        this.webrtcClient.on('onConnectionStateChange', (status, displayStatus, className) => {
            this.elements.connectionStatus.textContent = displayStatus;
            this.elements.connectionStatus.className = `status ${className}`;
        });
        
        this.webrtcClient.on('onRemoteStream', (stream) => {
            console.log('[Viewer] Received remote stream, attaching to video element');
            const videoEl = this.elements.remoteVideo;
            videoEl.srcObject = stream;
            const attemptPlay = () => {
                videoEl.play().catch(e => console.warn('Video play() deferred:', e.message));
            };
            videoEl.onloadedmetadata = () => {
                console.log('[Viewer] Remote video metadata loaded', videoEl.videoWidth, 'x', videoEl.videoHeight);
                attemptPlay();
                this.resizeCanvas();
                if (this.detectionEngine && this.detectionEngine.isReady()) {
                    this.startProcessing();
                }
            };
            // Fallback play attempt in case onloadedmetadata not firing promptly
            setTimeout(attemptPlay, 500);
        });
        
        this.webrtcClient.on('onDataChannelMessage', (data) => {
            this.handleDetectionResults(data);
        });
    }
    
    setupDetectionCallbacks() {
        this.detectionEngine.on('onModelLoad', () => {
            console.log('Detection model loaded');
            this.updateDetectionInfo('Model loaded successfully');
            
            // Start processing if video is ready
            if (this.elements.remoteVideo.srcObject && this.isRunning) {
                this.startProcessing();
            }
        });
        
        this.detectionEngine.on('onDetection', (results) => {
            this.handleDetectionResults(results);
        });
        
        this.detectionEngine.on('onError', (error) => {
            this.showError('Detection error: ' + error);
        });
    }
    
    setupUIEventListeners() {
        this.elements.startBtn.addEventListener('click', () => this.startDemo());
        this.elements.stopBtn.addEventListener('click', () => this.stopDemo());
        this.elements.benchBtn.addEventListener('click', () => this.runBenchmark());
        
        // Handle window resize
        window.addEventListener('resize', () => this.resizeCanvas());
        
        // Handle video resize
        this.elements.remoteVideo.addEventListener('resize', () => this.resizeCanvas());
        // Click detection on overlay canvas
        this.elements.overlayCanvas.addEventListener('click', (e) => this.handleCanvasClick(e));
    }

    handleCanvasClick(event) {
        if (!this.lastDetections || this.lastDetections.length === 0) return;
        const rect = this.elements.overlayCanvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        const hit = this.lastDetections.find(d => x >= d.px.x && x <= d.px.x + d.px.width && y >= d.px.y && y <= d.px.y + d.px.height);
        if (hit) {
            // Highlight the box briefly
            const ctx = this.overlayCtx;
            ctx.save();
            ctx.strokeStyle = '#ffcc00';
            ctx.lineWidth = 3;
            ctx.strokeRect(hit.px.x, hit.px.y, hit.px.width, hit.px.height);
            ctx.restore();
            console.log('[DetectionClick]', hit.label, (hit.score * 100).toFixed(1) + '%', hit);
            this.updateDetectionInfo(`Selected: ${hit.label} ${(hit.score * 100).toFixed(1)}%`);
        }
    }
    
    async startDemo() {
        try {
            this.isRunning = true;
            this.elements.startBtn.disabled = true;
            this.elements.stopBtn.disabled = false;
            
            // Reset metrics
            this.resetMetrics();
            
            if (this.webrtcClient.isPhone) {
                // Phone: start camera
                await this.webrtcClient.startCamera();
                this.updateDetectionInfo('Camera started. Waiting for viewer connection...');
            } else {
                // Viewer: wait for phone connection and start processing
                console.log('[App] Viewer mode - waiting for remote video stream...');
                console.log('[App] Remote video srcObject:', !!this.elements.remoteVideo.srcObject);
                console.log('[App] Detection engine ready:', this.detectionEngine ? this.detectionEngine.isReady() : 'N/A');
                
                this.updateDetectionInfo('Waiting for phone connection...');
                if (this.elements.remoteVideo.srcObject && this.detectionEngine && this.detectionEngine.isReady()) {
                    console.log('[App] Remote video available, starting processing...');
                    this.startProcessing();
                }
            }
        } catch (error) {
            console.error('Failed to start demo:', error);
            this.showError('Failed to start: ' + error.message);
            this.resetUI();
        }
    }
    
    stopDemo() {
        this.isRunning = false;
        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;
        
        // Clear FPS interval
        if (this.fpsInterval) {
            clearInterval(this.fpsInterval);
            this.fpsInterval = null;
        }
        
        if (this.webrtcClient.isPhone) {
            this.webrtcClient.stopCamera();
        }
        
        this.clearOverlay();
        this.updateDetectionInfo('Demo stopped');
    }
    
    startProcessing() {
        console.log('[App] startProcessing called - isRunning:', this.isRunning, 'detectionEngine exists:', !!this.detectionEngine, 'detectionEngine ready:', this.detectionEngine ? this.detectionEngine.isReady() : 'N/A');
        
        if (!this.isRunning || !this.detectionEngine || !this.detectionEngine.isReady()) {
            console.log('[App] startProcessing skipped - conditions not met');
            return;
        }
        
        console.log('[App] Starting video frame processing...');
        this.metrics.startTime = Date.now();
        
        // Start FPS display interval
        this.fpsInterval = setInterval(() => {
            if (this.detectionEngine) {
                const engineFps = this.detectionEngine.getFPS();
                console.log('[App] Detection engine FPS:', engineFps);
                if (engineFps > 0) {
                    this.elements.processingFps.innerHTML = `${engineFps}<span class=\"metric-unit\">fps</span>`;
                }
            }
        }, 1000);
        
        this.processVideoFrame();
    }
    
    async processVideoFrame() {
        if (!this.isRunning || this.webrtcClient.isPhone) {
            console.log('[App] processVideoFrame skipped - isRunning:', this.isRunning, 'isPhone:', this.webrtcClient.isPhone);
            return;
        }
        
        console.log('[App] Processing video frame...');
        
        try {
            const timestamp = Date.now();
            const frameId = await this.detectionEngine.processFrame(
                this.elements.remoteVideo, 
                timestamp
            );
            
            console.log('[App] Frame processed, frameId:', frameId);
            
            // Schedule next frame
            requestAnimationFrame(() => this.processVideoFrame());
        } catch (error) {
            console.error('Error processing frame:', error);
            if (this.isRunning) {
                setTimeout(() => this.processVideoFrame(), 100);
            }
        }
    }
    
    handleDetectionResults(results) {
        if (!this.isRunning) return;
        
        const displayTime = Date.now();
        
        // Calculate latencies
        const e2eLatency = displayTime - results.capture_ts;
        const networkLatency = results.recv_ts - results.capture_ts;
        
        // Update metrics
        this.updateMetrics(e2eLatency, networkLatency, results.detections.length);
        
        // Draw detections
        this.drawDetections(results.detections);
        
        // Update detection info
        this.updateDetectionInfo(
            `Frame: ${results.frame_id} | ` +
            `Detections: ${results.detections.length} | ` +
            `E2E: ${e2eLatency}ms | ` +
            `Net: ${networkLatency}ms`
        );
    }
    
    drawDetections(detections) {
        this.clearOverlay();
        
        if (!detections || detections.length === 0) return;
        
        const ctx = this.overlayCtx;
        const canvas = this.elements.overlayCanvas;
        
        ctx.strokeStyle = '#00ff00';
        ctx.lineWidth = 2;
        ctx.fillStyle = '#00ff00';
        ctx.font = '14px Arial';
        
        detections.forEach(detection => {
            // Convert normalized coordinates to canvas coordinates
            const x = detection.xmin * canvas.width;
            const y = detection.ymin * canvas.height;
            const width = (detection.xmax - detection.xmin) * canvas.width;
            const height = (detection.ymax - detection.ymin) * canvas.height;
            
            // Draw bounding box
            ctx.strokeRect(x, y, width, height);
            
            // Draw label with confidence
            const label = `${detection.label}: ${(detection.score * 100).toFixed(1)}%`;
            const textMetrics = ctx.measureText(label);
            const textHeight = 16;
            
            // Background for text
            ctx.fillStyle = 'rgba(0, 255, 0, 0.8)';
            ctx.fillRect(x, y - textHeight - 2, textMetrics.width + 4, textHeight + 2);
            
            // Text
            ctx.fillStyle = '#000000';
            ctx.fillText(label, x + 2, y - 4);
            ctx.fillStyle = '#00ff00';
        });
    }
    
    clearOverlay() {
        const ctx = this.overlayCtx;
        ctx.clearRect(0, 0, this.elements.overlayCanvas.width, this.elements.overlayCanvas.height);
    }
    
    resizeCanvas() {
        const video = this.elements.remoteVideo;
        const canvas = this.elements.overlayCanvas;
        
        if (video.videoWidth && video.videoHeight) {
            canvas.width = video.offsetWidth;
            canvas.height = video.offsetHeight;
        }
    }
    
    updateMetrics(e2eLatency, networkLatency, detectionCount) {
        this.metrics.latencies.push(e2eLatency);
        this.metrics.networkLatencies.push(networkLatency);
        this.metrics.frameCount++;
        
        // Keep only recent metrics (last 100 frames)
        if (this.metrics.latencies.length > 100) {
            this.metrics.latencies.shift();
            this.metrics.networkLatencies.shift();
        }
        
        // Calculate and display metrics
        const medianE2E = this.calculateMedian(this.metrics.latencies);
        const medianNetwork = this.calculateMedian(this.metrics.networkLatencies);
        
        let fps = 0;
        if (this.metrics.startTime) {
            const elapsed = (Date.now() - this.metrics.startTime) / 1000;
            fps = this.metrics.frameCount / elapsed;
        }
        
        // Update UI
        this.elements.e2eLatency.innerHTML = `${medianE2E}<span class=\"metric-unit\">ms</span>`;
        this.elements.networkLatency.innerHTML = `${medianNetwork}<span class=\"metric-unit\">ms</span>`;
        this.elements.processingFps.innerHTML = `${fps.toFixed(1)}<span class=\"metric-unit\">fps</span>`;
        this.elements.detectionCount.textContent = detectionCount;
    }
    
    calculateMedian(values) {
        if (values.length === 0) return 0;
        
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        
        if (sorted.length % 2 === 0) {
            return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
        } else {
            return Math.round(sorted[middle]);
        }
    }
    
    calculateP95(values) {
        if (values.length === 0) return 0;
        
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.floor(sorted.length * 0.95);
        return Math.round(sorted[index] || sorted[sorted.length - 1]);
    }
    
    async runBenchmark() {
        if (this.isBenchmarking || !this.isRunning) return;
        
        this.isBenchmarking = true;
        this.elements.benchBtn.disabled = true;
        this.elements.benchBtn.textContent = 'Running...';
        
        // Reset metrics for benchmark
        this.resetMetrics();
        
        const duration = 30000; // 30 seconds
        const startTime = Date.now();
        
        console.log('Starting 30-second benchmark...');
        this.updateDetectionInfo('Running 30-second benchmark...');
        
        setTimeout(() => {
            this.finalizeBenchmark();
        }, duration);
    }
    
    finalizeBenchmark() {
        const results = {
            duration_seconds: 30,
            frames_processed: this.metrics.frameCount,
            median_e2e_latency_ms: this.calculateMedian(this.metrics.latencies),
            p95_e2e_latency_ms: this.calculateP95(this.metrics.latencies),
            median_network_latency_ms: this.calculateMedian(this.metrics.networkLatencies),
            p95_network_latency_ms: this.calculateP95(this.metrics.networkLatencies),
            processed_fps: this.metrics.frameCount / 30,
            timestamp: new Date().toISOString(),
            mode: this.webrtcClient.isPhone ? 'phone' : 'viewer'
        };
        
        console.log('Benchmark results:', results);
        
        // Download results as JSON
        this.downloadBenchmarkResults(results);
        
        this.isBenchmarking = false;
        this.elements.benchBtn.disabled = false;
        this.elements.benchBtn.textContent = 'Run Benchmark';
        
        this.updateDetectionInfo(
            `Benchmark complete! ` +
            `Median E2E: ${results.median_e2e_latency_ms}ms, ` +
            `P95 E2E: ${results.p95_e2e_latency_ms}ms, ` +
            `FPS: ${results.processed_fps.toFixed(1)}`
        );
    }
    
    downloadBenchmarkResults(results) {
        const blob = new Blob([JSON.stringify(results, null, 2)], { 
            type: 'application/json' 
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `metrics_${results.timestamp.replace(/[:.]/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    resetMetrics() {
        this.metrics = {
            latencies: [],
            networkLatencies: [],
            frameCount: 0,
            startTime: Date.now(),
            lastDetectionTime: null
        };
    }
    
    resetUI() {
        this.isRunning = false;
        this.elements.startBtn.disabled = false;
        this.elements.stopBtn.disabled = true;
    }
    
    updateDetectionInfo(message) {
        this.elements.detectionInfo.textContent = message;
    }
    
    showError(message) {
        console.error(message);
        this.updateDetectionInfo('Error: ' + message);
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new VLMDetectionApp();
});
