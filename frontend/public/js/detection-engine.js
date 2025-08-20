// WASM-based Object Detection Engine
class DetectionEngine {
    constructor() {
        this.session = null;
        this.modelLoaded = false;
        // Default to YOLOv4 settings (will be confirmed/overridden after model load)
        this.inputSize = 416; // YOLOv4 default
        this.inputLayout = 'NHWC'; // YOLOv4 default
        this.inputShape = [1, 416, 416, 3]; // NHWC for YOLOv4
        this.outputShape = null; // Will derive after first run
        this.inputDType = 'float32'; // default, may change to float16 based on model
        this.classes = this.getCocoClasses();
        this.frameQueue = [];
        this.maxQueueSize = 3; // Backpressure control
        this.isProcessing = false;
        
        // Detection configuration
        this.confidenceThreshold = 0.1; // Very low threshold for debugging - was 0.25
        this.nmsThreshold = 0.45; // Configurable NMS threshold
        
        // Reusable offscreen canvas for preprocessing to avoid realloc each frame
        this.preprocessCanvas = document.createElement('canvas');
        this.preprocessCtx = this.preprocessCanvas.getContext('2d', { willReadFrequently: true });
        
        console.log('[DetectionEngine] Constructor initialized with defaults - inputSize:', this.inputSize, 'shape:', this.inputShape);
        
        // Performance tracking
        this.frameCount = 0;
        this.lastFpsUpdate = 0;
        this.fps = 0;
        
        this.callbacks = {
            onDetection: null,
            onModelLoad: null,
            onError: null
        };
    }
    
    async initialize() {
        try {
            console.log('Initializing ONNX Runtime...');
            
            // Configure ONNX Runtime for WASM with optimizations
            ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/';
            ort.env.wasm.numThreads = 1; // Force single-threading to avoid cross-origin isolation issues
            ort.env.wasm.simd = true;    // Enable SIMD for better performance
            ort.env.wasm.proxy = false;  // Disable proxy mode for faster loading
            ort.env.logLevel = 'warning'; // Reduce logging overhead
            
            // Enable browser caching for faster subsequent loads
            if ('caches' in window) {
                console.log('[DetectionEngine] Browser cache available for model caching');
            }
            
            // Load models in order of preference (only available models)
            const candidateModels = [
                'models/yolov4.onnx',   // ~245MB - only available model
            ];

            let lastErr = null;
        for (const url of candidateModels) {
                try {
                    console.log('Attempting model load:', url);
                    
                    // Start progress tracking
                    const startTime = Date.now();
                    console.log('[DetectionEngine] Starting ONNX session creation...');
                    
                    // Update UI with loading progress
                    this.updateLoadingProgress('Downloading model...');
                    
                    // Pre-fetch the model file to track download progress
                    console.log('[DetectionEngine] Pre-fetching model file...');
                    const response = await fetch(url);
                    if (!response.ok) {
                        throw new Error(`Failed to fetch model: ${response.status} ${response.statusText}`);
                    }
                    
                    const contentLength = response.headers.get('content-length');
                    const totalSize = contentLength ? parseInt(contentLength) : 0;
                    console.log(`[DetectionEngine] Model size: ${(totalSize / 1024 / 1024).toFixed(1)}MB`);
                    
                    this.updateLoadingProgress(`Loading ${(totalSize / 1024 / 1024).toFixed(1)}MB model...`);
                    
                    // Get model as ArrayBuffer directly
                    const modelArrayBuffer = await response.arrayBuffer();
                    const downloadTime = Date.now() - startTime;
                    console.log(`[DetectionEngine] Model downloaded in ${downloadTime}ms`);
                    
                    // Create session with optimized settings
                    const sessionStartTime = Date.now();
                    console.log('[DetectionEngine] Creating ONNX session...');
                    this.updateLoadingProgress('Initializing neural network...');
                    
                    this.session = await ort.InferenceSession.create(modelArrayBuffer, {
                        executionProviders: ['wasm'],
                        graphOptimizationLevel: 'extended', // Use extended optimization
                        enableCpuMemArena: false,           // Disable memory arena for faster loading
                        enableMemPattern: false,            // Disable memory pattern for faster loading
                        executionMode: 'sequential',        // Sequential mode for single-threaded
                        intraOpNumThreads: 1,
                        interOpNumThreads: 1,
                        optimizedModelFilePath: undefined,  // Don't save optimized model to disk
                        logId: 'detection-session',         // Add session ID for debugging
                        logSeverityLevel: 3                 // WARNING level (reduce logging overhead)
                    });
                    
                    const sessionTime = Date.now() - sessionStartTime;
                    const totalTime = Date.now() - startTime;
                    console.log(`[DetectionEngine] Session created in ${sessionTime}ms`);
                    console.log(`[DetectionEngine] Total model loading time: ${totalTime}ms`);
                    
                    this.updateLoadingProgress(`Model loaded in ${(totalTime/1000).toFixed(1)}s`);
                    
                    // Capture dynamic input / output names
                    this.inputName = this.session.inputNames[0];
                    this.outputName = this.session.outputNames[0];
                    this.outputNames = this.session.outputNames;
                    console.log('Model IO names:', this.inputName, '->', this.outputName, ' (total outputs:', this.outputNames.length, ')');
                    
                    // Log current state before detection
                    console.log('[DetectionEngine] Before model detection - inputSize:', this.inputSize, 'layout:', this.inputLayout, 'shape:', this.inputShape);
                    
                    // Check if this is YOLOv4 by checking model path first
                    if (url.includes('yolov4')) {
                        this.modelType = 'yolov4';
                        this.inputSize = 416;
                        this.inputLayout = 'NHWC';
                        this.inputShape = [1, 416, 416, 3];
                        console.log('[DetectionEngine] Detected YOLOv4 from path, forced input shape:', this.inputShape);
                    } else {
                        // Try to read input metadata for other models
                        try {
                            const meta = this.session.inputMetadata?.[this.inputName];
                            if (meta && Array.isArray(meta.dimensions)) {
                                // Expect [N, C, H, W] or [N, H, W, C]
                                const dims = meta.dimensions;
                                // Detect layout (NCHW vs NHWC)
                                let h, w, c;
                                if (dims.length === 4) {
                                    if (dims[1] === 3) {
                                        // NCHW
                                        h = dims[2] > 0 ? dims[2] : null;
                                        w = dims[3] > 0 ? dims[3] : null;
                                        c = dims[1];
                                        this.inputLayout = 'NCHW';
                                    } else if (dims[3] === 3) {
                                        // NHWC
                                        h = dims[1] > 0 ? dims[1] : null;
                                        w = dims[2] > 0 ? dims[2] : null;
                                        c = dims[3];
                                        this.inputLayout = 'NHWC';
                                    } else {
                                        this.inputLayout = 'NCHW';
                                    }
                                }
                                if (h && w && h === w && h !== this.inputSize) {
                                    console.log(`[DetectionEngine] Adjusting input size from ${this.inputSize} -> ${h} (layout ${this.inputLayout||'NCHW'})`);
                                    this.inputSize = h;
                                    this.inputShape = this.inputLayout === 'NHWC'
                                        ? [1, this.inputSize, this.inputSize, 3]
                                        : [1, 3, this.inputSize, this.inputSize];
                                } else if ((!h || !w) && this.inputSize !== 640) {
                                    console.log('[DetectionEngine] Dynamic input dims detected, switching inputSize to 640');
                                    this.inputSize = 640;
                                    this.inputShape = this.inputLayout === 'NHWC'
                                        ? [1, this.inputSize, this.inputSize, 3]
                                        : [1, 3, this.inputSize, this.inputSize];
                                }
                                if (!this.inputLayout) this.inputLayout = 'NCHW';
                                if (meta.type && typeof meta.type === 'string') {
                                    if (meta.type.toLowerCase() === 'float16' || meta.type.toLowerCase() === 'float_16') {
                                        console.log('[DetectionEngine] Model expects float16 input');
                                        this.inputDType = 'float16';
                                    } else if (meta.type.toLowerCase() !== 'float' && meta.type.toLowerCase() !== 'float32') {
                                        console.warn('[DetectionEngine] Unexpected input dtype', meta.type, '— continuing with float32 unless run fails');
                                    }
                                }
                            }
                        } catch (metaErr) {
                            console.warn('Unable to parse input metadata; continuing with size', this.inputSize, metaErr.message);
                        }
                        
                        // Alternative YOLOv4 detection by output structure (fallback)
                        if (this.outputNames.length === 3) {
                            const om = this.session.outputMetadata;
                            const multi = this.outputNames.every(n => om[n] && om[n].dimensions && om[n].dimensions.length === 5);
                            if (multi) {
                                this.modelType = 'yolov4';
                                console.log('[DetectionEngine] Detected YOLOv4 multi-scale model');
                                // YOLOv4 always uses NHWC 416x416x3 - override any previous detection
                                this.inputSize = 416;
                                this.inputLayout = 'NHWC';
                                this.inputShape = [1, 416, 416, 3];
                                console.log('[DetectionEngine] Forced YOLOv4 input shape:', this.inputShape);
                            }
                        }
                    }
                    lastErr = null;
                    break;
                } catch (e) {
                    console.error('[DetectionEngine] Model load failed for', url, '- Error:', e.message);
                    console.error('[DetectionEngine] Full error:', e);
                    lastErr = e;
                }
            }
            if (lastErr) throw lastErr;
            
            this.modelLoaded = true;
            console.log('Model loaded successfully');
            
            // Log final configuration before warmup
            console.log('[DetectionEngine] Final config before warmup - inputSize:', this.inputSize, 'layout:', this.inputLayout, 'shape:', this.inputShape);
            
            // Warmup run (zeros) to reduce first-frame latency & catch shape issues early
            try {
                console.log('[DetectionEngine] Starting warmup with shape:', this.inputShape);
                const totalSize = this.inputShape.reduce((a,b)=>a*b,1);
                const warmupData = new Float32Array(totalSize);
                let warmTensor;
                if (this.inputDType === 'float16') {
                    const f16 = this.float32ToFloat16Array(warmupData);
                    warmTensor = new ort.Tensor('float16', f16, this.inputShape);
                } else {
                    warmTensor = new ort.Tensor('float32', warmupData, this.inputShape);
                }
                const feeds = {}; feeds[this.inputName] = warmTensor;
                const warmout = await this.session.run(feeds);
                const firstOutName = Object.keys(warmout)[0];
                console.log('[DetectionEngine] Warmup complete. First output name:', firstOutName, 'dims:', warmout[firstOutName].dims);
            } catch (we) {
                console.warn('[DetectionEngine] Warmup failed, attempting fallback:', we.message);
                const originalError = we;
                // Fallback 1: try alternate layout but KEEP the correct input size for YOLOv4
                let attempted = false;
                try {
                    // For YOLOv4, don't change the layout - it must be NHWC 416x416x3
                    if (this.modelType === 'yolov4') {
                        console.log('[DetectionEngine] YOLOv4 detected, skipping layout fallback');
                    } else if (this.inputSize && this.inputSize > 0) {
                        if (this.inputLayout === 'NHWC') {
                            this.inputLayout = 'NCHW';
                            this.inputShape = [1, 3, this.inputSize, this.inputSize];
                            console.log('[DetectionEngine] Retrying warmup with alternate layout NCHW', this.inputShape);
                        } else {
                            this.inputLayout = 'NHWC';
                            this.inputShape = [1, this.inputSize, this.inputSize, 3];
                            console.log('[DetectionEngine] Retrying warmup with alternate layout NHWC', this.inputShape);
                        }
                        const totalSize2 = this.inputShape.reduce((a,b)=>a*b,1);
                        const warmupData2 = new Float32Array(totalSize2);
                        let warmTensor2;
                        if (this.inputDType === 'float16') {
                            const f16b = this.float32ToFloat16Array(warmupData2);
                            warmTensor2 = new ort.Tensor('float16', f16b, this.inputShape);
                        } else {
                            warmTensor2 = new ort.Tensor('float32', warmupData2, this.inputShape);
                        }
                        const feeds2 = {}; feeds2[this.inputName] = warmTensor2;
                        const warmout2 = await this.session.run(feeds2);
                        const firstOutName2 = Object.keys(warmout2)[0];
                        console.log('[DetectionEngine] Warmup fallback succeeded. Layout:', this.inputLayout, 'Output dims:', warmout2[firstOutName2].dims);
                        attempted = true;
                    }
                } catch (altLayoutErr) {
                    console.warn('[DetectionEngine] Alternate layout warmup failed:', altLayoutErr.message);
                }
                // Fallback 2: if float16, downgrade to float32
                if (!attempted && this.inputDType === 'float16') {
                    try {
                        this.inputDType = 'float32';
                        console.log('[DetectionEngine] Retrying warmup with float32 dtype');
                        const totalSize3 = this.inputShape.reduce((a,b)=>a*b,1);
                        const warmupData3 = new Float32Array(totalSize3);
                        const warmTensor3 = new ort.Tensor('float32', warmupData3, this.inputShape);
                        const feeds3 = {}; feeds3[this.inputName] = warmTensor3;
                        const warmout3 = await this.session.run(feeds3);
                        const firstOutName3 = Object.keys(warmout3)[0];
                        console.log('[DetectionEngine] Warmup (dtype fallback) succeeded. Output dims:', warmout3[firstOutName3].dims);
                        attempted = true;
                    } catch (dtypeErr) {
                        console.warn('[DetectionEngine] Dtype fallback warmup failed:', dtypeErr.message);
                    }
                }
                if (!attempted) {
                    console.warn('[DetectionEngine] All warmup attempts failed. Proceeding anyway. Initial error:', originalError.message);
                }
            }
            
            if (this.callbacks.onModelLoad) {
                this.callbacks.onModelLoad();
            }
            
            return true;
        } catch (error) {
            console.error('Failed to initialize detection engine:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError('Model loading failed: ' + error.message);
            }
            return false;
        }
    }
    
    async processFrame(videoElement, timestamp) {
        if (!this.modelLoaded || this.isProcessing) {
            return null;
        }
        
        // Implement backpressure: drop frames if queue is full
        if (this.frameQueue.length >= this.maxQueueSize) {
            this.frameQueue.shift(); // Remove oldest frame
        }
        
        const frameData = {
            videoElement,
            timestamp,
            frameId: `frame_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
        };
        
        this.frameQueue.push(frameData);
        this.processQueue();
        
        return frameData.frameId;
    }
    
    async processQueue() {
        if (this.isProcessing || this.frameQueue.length === 0) {
            return;
        }
        
        this.isProcessing = true;
        
        try {
            const frameData = this.frameQueue.shift();
            const result = await this.runInference(frameData);
            
            if (result && this.callbacks.onDetection) {
                this.callbacks.onDetection(result);
            }
            
            this.updateFPS();
        } catch (error) {
            console.error('Error processing frame:', error);
            if (this.callbacks.onError) {
                this.callbacks.onError('Processing error: ' + error.message);
            }
        }
        
        this.isProcessing = false;
        
        // Process next frame if queue has items
        if (this.frameQueue.length > 0) {
            setTimeout(() => this.processQueue(), 0);
        }
    }
    
    async runInference(frameData) {
        const { videoElement, timestamp, frameId } = frameData;
        const captureTs = timestamp;
        const recvTs = Date.now();
        
        console.log('[DetectionEngine] Starting inference for frame:', frameId);
        
        try {
            // Prepare input tensor
            const inputTensor = await this.prepareInput(videoElement);
            if (!inputTensor) {
                console.warn('[DetectionEngine] Skipping frame: input tensor not ready (video dims?)');
                return null;
            }
            console.log('[DetectionEngine] Input tensor prepared, shape:', inputTensor.dims);
            
            const inferenceStart = Date.now();
            
            // Run inference
            const feeds = {};
            feeds[this.inputName || 'images'] = inputTensor;
            console.log('[DetectionEngine] Running inference with input name:', this.inputName);
            
            const results = await this.session.run(feeds);
            console.log('[DetectionEngine] Inference completed, output keys:', Object.keys(results));
            
            let detections = [];
            if (this.modelType === 'yolov4') {
                console.log('[DetectionEngine] Processing YOLOv4 outputs...');
                detections = this.processYolov4Outputs(results);
            } else {
                const output = results[this.outputName || 'output0'];
                if (!output) {
                    console.warn('Inference returned no output tensor. Keys:', Object.keys(results));
                    return null;
                }
                console.log('[DetectionEngine] Processing generic YOLO output...');
                // Process output (YOLOv5-like single tensor)
                detections = this.processOutput(output);
            }
            
            console.log('[DetectionEngine] Raw detections found:', detections.length);
            const inferenceTs = Date.now();
            
            return {
                frame_id: frameId,
                capture_ts: captureTs,
                recv_ts: recvTs,
                inference_ts: inferenceTs,
                detections: detections
            };
        } catch (error) {
            console.error('Inference error:', error);
            return null;
        }
    }
    
    async prepareInput(videoElement) {
    // Reuse canvas for preprocessing (simple resize whole frame to square)
        const canvas = this.preprocessCanvas;
        const ctx = this.preprocessCtx;
        canvas.width = this.inputSize;
        canvas.height = this.inputSize;

        const vw = videoElement.videoWidth || videoElement.width;
        const vh = videoElement.videoHeight || videoElement.height;
        if (!vw || !vh) return null;
    // Direct stretch resize (avoids coordinate remap mismatch for overlay)
    ctx.drawImage(videoElement, 0, 0, vw, vh, 0, 0, this.inputSize, this.inputSize);
    // Record transform info (might use later if switching back to crop/letterbox)
    this.lastTransform = { type: 'stretch', srcW: vw, srcH: vh };

        const imageData = ctx.getImageData(0, 0, this.inputSize, this.inputSize);
        const { data } = imageData;
        
    // Convert to RGB and normalize [0-255] -> [0-1] into float32 staging buffer
    const [batch, dim2, dim3, dim4] = this.inputShape;
    const channels = this.inputLayout === 'NHWC' ? dim4 : dim2;
    const height = this.inputLayout === 'NHWC' ? dim2 : dim3;
    const width = this.inputLayout === 'NHWC' ? dim3 : dim4;
    const inputF32 = new Float32Array(batch * channels * height * width);
        
        if (this.inputLayout === 'NCHW') {
            for (let c = 0; c < channels; c++) {
                for (let h = 0; h < height; h++) {
                    for (let w = 0; w < width; w++) {
                        const pixelIndex = (h * width + w) * 4;
                        const tensorIndex = c * height * width + h * width + w;
                        const value = data[pixelIndex + c] / 255.0;
                        inputF32[tensorIndex] = value;
                    }
                }
            }
        } else { // NHWC
            let offset = 0;
            for (let h = 0; h < height; h++) {
                for (let w = 0; w < width; w++) {
                    const pixelIndex = (h * width + w) * 4;
                    inputF32[offset++] = data[pixelIndex + 0] / 255.0;
                    inputF32[offset++] = data[pixelIndex + 1] / 255.0;
                    inputF32[offset++] = data[pixelIndex + 2] / 255.0;
                }
            }
        }
        if (this.inputDType === 'float16') {
            const f16 = this.float32ToFloat16Array(inputF32);
            return new ort.Tensor('float16', f16, this.inputShape);
        }
        return new ort.Tensor('float32', inputF32, this.inputShape);
    }

    processYolov4Outputs(results) {
        // YOLOv4 multi-scale decoding using typical anchors
        const anchors = [
            [12,16], [19,36], [40,28],
            [36,75], [76,55], [72,146],
            [142,110], [192,243], [459,401]
        ];
        const strides = [8,16,32];
        const numAnchorsPerScale = 3;
        const confidenceThreshold = this.confidenceThreshold; // Use configurable threshold
        const nmsThreshold = this.nmsThreshold; // Use configurable threshold
        const sigmoid = (v) => 1 / (1 + Math.exp(-v));
        const detections = [];
        // Order output names so larger grid last (not critical)
        const outs = this.outputNames.map(n => results[n]).filter(t => !!t);
        outs.forEach((tensor, scaleIndex) => {
            const dims = tensor.dims; // [1, S, S, 3, 85]
            if (dims.length !== 5) return;
            const S = dims[1];
            const data = tensor.data;
            const stride = strides[scaleIndex] || (this.inputSize / S);
            for (let y = 0; y < S; y++) {
                for (let x = 0; x < S; x++) {
                    for (let a = 0; a < numAnchorsPerScale; a++) {
                        const anchorIndex = scaleIndex * numAnchorsPerScale + a;
                        const anchor = anchors[anchorIndex];
                        const offset = (((y * S) + x) * numAnchorsPerScale + a) * 85;
                        const tx = data[offset + 0];
                        const ty = data[offset + 1];
                        const tw = data[offset + 2];
                        const th = data[offset + 3];
                        const to = data[offset + 4];
                        const objectness = sigmoid(to);
                        
                        // Early exit if objectness is too low
                        if (objectness < 0.3) continue; // Pre-filter with higher threshold
                        
                        // Class scores
                        let bestClass = 0; let bestProb = 0;
                        for (let c = 0; c < 80; c++) {
                            const p = sigmoid(data[offset + 5 + c]);
                            if (p > bestProb) { bestProb = p; bestClass = c; }
                        }
                        const confidence = objectness * bestProb;
                        
                        // Debug: log confidence values for first few detections
                        if (detections.length < 5) {
                            console.log(`[Debug] Objectness: ${objectness.toFixed(4)}, Best class prob: ${bestProb.toFixed(4)}, Final confidence: ${confidence.toFixed(4)}, Threshold: ${confidenceThreshold}`);
                        }
                        
                        if (confidence < confidenceThreshold) continue;
                        
                        // Decode box
                        const bx = ( (sigmoid(tx) + x) * stride );
                        const by = ( (sigmoid(ty) + y) * stride );
                        const bw = ( Math.exp(tw) * anchor[0] );
                        const bh = ( Math.exp(th) * anchor[1] );
                        const xmin = Math.max(0, (bx - bw/2) / this.inputSize);
                        const ymin = Math.max(0, (by - bh/2) / this.inputSize);
                        const xmax = Math.min(1, (bx + bw/2) / this.inputSize);
                        const ymax = Math.min(1, (by + bh/2) / this.inputSize);
                        
                        // Filter out degenerate boxes
                        if (xmax <= xmin || ymax <= ymin) continue;
                        
                        // Filter out boxes that are too small (likely false positives)
                        const boxWidth = xmax - xmin;
                        const boxHeight = ymax - ymin;
                        if (boxWidth < 0.02 || boxHeight < 0.02) continue; // Minimum 2% of image size
                        if (xmax <= xmin || ymax <= ymin) continue;
                        detections.push({
                            label: this.classes[bestClass] || `class_${bestClass}`,
                            score: confidence,
                            xmin, ymin, xmax, ymax
                        });
                    }
                }
            }
        });
        
        console.log(`[DetectionEngine] Raw detections: ${detections.length}, after NMS filtering: will be calculated`);
        const filtered = this.applyNMS(detections, nmsThreshold);
        console.log(`[DetectionEngine] Final detections after NMS: ${filtered.length}`);
        return filtered;
    }
    
    processOutput(output) {
        const data = output.data;
        const dims = output.dims;
        if (!dims || dims.length < 3) {
            console.warn('[DetectionEngine] Unexpected output dims', dims);
            return [];
        }
        const batch = dims[0];
        const anchors = dims[1];
        const features = dims[2];
        if (!anchors || !features) return [];

        const detections = [];
        const confidenceThreshold = this.confidenceThreshold; // Use configurable threshold
        const nmsThreshold = this.nmsThreshold; // Use configurable threshold

        const sigmoid = (v) => 1 / (1 + Math.exp(-v));

        for (let i = 0; i < anchors; i++) {
            const offset = i * features;
            // Raw predictions
            let x = data[offset + 0];
            let y = data[offset + 1];
            let w = data[offset + 2];
            let h = data[offset + 3];
            let objectness = data[offset + 4];

            // Apply sigmoid to objectness (YOLO outputs are often logits)
            objectness = sigmoid(objectness);
            if (objectness < confidenceThreshold) continue;

            // Class scores
            let bestClass = 0;
            let maxClassProb = 0;
            for (let c = 5; c < features; c++) {
                const p = sigmoid(data[offset + c]);
                if (p > maxClassProb) {
                    maxClassProb = p;
                    bestClass = c - 5;
                }
            }

            const confidence = objectness * maxClassProb;
            
            // Debug: log confidence values for first few detections
            if (detections.length < 5) {
                console.log(`[Debug Generic] Objectness: ${objectness.toFixed(4)}, Max class prob: ${maxClassProb.toFixed(4)}, Final confidence: ${confidence.toFixed(4)}, Threshold: ${confidenceThreshold}`);
            }
            
            if (confidence < confidenceThreshold) continue;

            // Coordinates assumed in pixels relative to input size (exported YOLOv5 ONNX)
            const scale = this.inputSize;
            const xmin = Math.max(0, (x - w / 2) / scale);
            const ymin = Math.max(0, (y - h / 2) / scale);
            const xmax = Math.min(1, (x + w / 2) / scale);
            const ymax = Math.min(1, (y + h / 2) / scale);

            if (xmax <= xmin || ymax <= ymin) continue; // Skip invalid boxes

            detections.push({
                label: this.classes[bestClass] || `class_${bestClass}`,
                score: confidence,
                xmin,
                ymin,
                xmax,
                ymax
            });
        }

        console.log(`[DetectionEngine] Generic output processing: ${detections.length} detections before NMS`);
        const pruned = this.applyNMS(detections, nmsThreshold);
        console.log(`[DetectionEngine] Final detections after NMS: ${pruned.length}`);
        if (pruned.length === 0) {
            // Helpful debug once in a while
            if (Math.random() < 0.05) {
                console.log('[DetectionEngine] No detections this frame (anchors:', anchors, 'features:', features, 'inputSize:', this.inputSize, ')');
            }
        }
        return pruned;
    }

    // Utility: convert a Float32Array to a Uint16Array containing IEEE 754 binary16 values
    float32ToFloat16Array(f32) {
        const len = f32.length;
        const out = new Uint16Array(len);
        for (let i = 0; i < len; i++) {
            out[i] = this.float32ToFloat16(f32[i]);
        }
        return out;
    }

    float32ToFloat16(val) {
        // Based on standard float32 -> float16 conversion
        if (isNaN(val)) return 0;
        const floatView = new Float32Array(1);
        const int32View = new Int32Array(floatView.buffer);
        floatView[0] = val;
        const x = int32View[0];
        const sign = (x >> 16) & 0x8000; // sign only
        const mantissa = x & 0x7fffff;
        let exp = (x >> 23) & 0xff;
        if (exp === 0xff) { // NaN or Inf
            if (mantissa) return sign | 0x7e00; // NaN
            return sign | 0x7c00; // Inf
        }
        exp = exp - 127 + 15;
        if (exp >= 0x1f) { // overflow -> Inf
            return sign | 0x7c00;
        } else if (exp <= 0) {
            if (exp < -10) {
                return sign; // too small -> 0
            }
            // subnormal
            const sub = (mantissa | 0x800000) >> (1 - exp);
            return sign | (sub + 0x1000 >> 13);
        }
        return sign | (exp << 10) | (mantissa + 0x1000 >> 13);
    }
    
    applyNMS(detections, threshold) {
        // Sort by confidence
        detections.sort((a, b) => b.score - a.score);
        
        const keep = [];
        const used = new Set();
        
        for (let i = 0; i < detections.length; i++) {
            if (used.has(i)) continue;
            
            keep.push(detections[i]);
            used.add(i);
            
            for (let j = i + 1; j < detections.length; j++) {
                if (used.has(j)) continue;
                
                const iou = this.calculateIoU(detections[i], detections[j]);
                if (iou > threshold) {
                    used.add(j);
                }
            }
        }
        
        return keep;
    }
    
    calculateIoU(box1, box2) {
        const xLeft = Math.max(box1.xmin, box2.xmin);
        const yTop = Math.max(box1.ymin, box2.ymin);
        const xRight = Math.min(box1.xmax, box2.xmax);
        const yBottom = Math.min(box1.ymax, box2.ymax);
        
        if (xRight < xLeft || yBottom < yTop) return 0;
        
        const intersection = (xRight - xLeft) * (yBottom - yTop);
        const area1 = (box1.xmax - box1.xmin) * (box1.ymax - box1.ymin);
        const area2 = (box2.xmax - box2.xmin) * (box2.ymax - box2.ymin);
        const union = area1 + area2 - intersection;
        
        return intersection / union;
    }
    
    // Method to update detection thresholds dynamically
    updateThresholds(confidence = null, nms = null) {
        if (confidence !== null && confidence >= 0 && confidence <= 1) {
            this.confidenceThreshold = confidence;
            console.log(`[DetectionEngine] Updated confidence threshold to ${confidence}`);
        }
        if (nms !== null && nms >= 0 && nms <= 1) {
            this.nmsThreshold = nms;
            console.log(`[DetectionEngine] Updated NMS threshold to ${nms}`);
        }
    }
    
    updateFPS() {
        this.frameCount++;
        const now = Date.now();
        
        if (now - this.lastFpsUpdate >= 1000) {
            this.fps = this.frameCount;
            this.frameCount = 0;
            this.lastFpsUpdate = now;
        }
    }
    
    getFPS() {
        return this.fps;
    }
    
    getCocoClasses() {
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
        ];
    }
    
    // Public API
    on(event, callback) {
        this.callbacks[event] = callback;
    }
    
    isReady() {
        return this.modelLoaded;
    }
    
    getQueueLength() {
        return this.frameQueue.length;
    }
    
    // Quick method to adjust confidence threshold dynamically
    setConfidenceThreshold(threshold) {
        this.confidenceThreshold = threshold;
        console.log(`[DetectionEngine] Confidence threshold updated to: ${threshold}`);
    }
    
    // Update loading progress in UI
    updateLoadingProgress(message) {
        // Try to update the detectionInfo element if available
        const detectionInfo = document.getElementById('detectionInfo');
        if (detectionInfo) {
            detectionInfo.textContent = message;
        }
        console.log(`[DetectionEngine] Loading: ${message}`);
    }
}

// Export for use in other scripts
window.DetectionEngine = DetectionEngine;
