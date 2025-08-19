const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { program } = require('commander');

// Command line options
program
  .option('-d, --duration <number>', 'Benchmark duration in seconds', '30')
  .option('-m, --mode <string>', 'Mode: server or wasm', 'server')
  .option('-o, --output <string>', 'Output file path', 'metrics.json')
  .option('-u, --url <string>', 'Base URL', 'http://localhost:3000')
  .option('--headless', 'Run in headless mode', false)
  .parse();

const options = program.opts();

class BenchmarkRunner {
    constructor(options) {
        this.duration = parseInt(options.duration) * 1000; // Convert to ms
        this.mode = options.mode;
        this.outputFile = options.output;
        this.baseUrl = options.url;
        this.headless = options.headless;
        
        this.metrics = {
            latencies: [],
            networkLatencies: [],
            frameTimestamps: [],
            detectionCounts: [],
            startTime: null,
            endTime: null
        };
    }
    
    async run() {
        console.log('🚀 Starting automated benchmark...');
        
        const browser = await puppeteer.launch({
            headless: this.headless,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-web-security',
                '--allow-running-insecure-content',
                '--use-fake-ui-for-media-stream',
                '--use-fake-device-for-media-stream',
                '--use-file-for-fake-video-capture=/dev/zero'
            ]
        });
        
        try {
            // Open two pages: one for phone simulation, one for viewer
            const phonePage = await browser.newPage();
            const viewerPage = await browser.newPage();
            
            // Set viewport sizes
            await phonePage.setViewport({ width: 375, height: 667 }); // iPhone-like
            await viewerPage.setViewport({ width: 1200, height: 800 }); // Desktop
            
            // Set user agents
            await phonePage.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
            await viewerPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            
            // Enable console logging
            phonePage.on('console', msg => console.log('PHONE:', msg.text()));
            viewerPage.on('console', msg => console.log('VIEWER:', msg.text()));
            
            // Setup metric collection on viewer page
            await this.setupMetricCollection(viewerPage);
            
            // Navigate to pages
            console.log('📱 Opening phone page (/phone)...');
            await phonePage.goto(this.baseUrl.replace(/\/$/, '') + '/phone', { waitUntil: 'networkidle0' });
            
            console.log('🖥️  Opening viewer page...');
            await viewerPage.goto(this.baseUrl, { waitUntil: 'networkidle0' });
            
            // Start camera on phone
            console.log('📷 Starting camera on phone...');
            await this.startCameraOnPhone(phonePage);
            
            // Start detection on viewer
            console.log('🔍 Starting detection on viewer...');
            await this.startDetectionOnViewer(viewerPage);
            
            // Wait for connection
            console.log('🔗 Waiting for connection...');
            await this.waitForConnection(viewerPage);
            
            // Run benchmark
            console.log(`⏱️  Running benchmark for ${this.duration/1000} seconds...`);
            await this.runBenchmark(viewerPage);
            
            // Collect final metrics
            const results = await this.collectMetrics(viewerPage);
            
            // Save results
            await this.saveResults(results);
            
            console.log('✅ Benchmark completed successfully!');
            
        } catch (error) {
            console.error('❌ Benchmark failed:', error);
            throw error;
        } finally {
            await browser.close();
        }
    }
    
    async setupMetricCollection(page) {
        await page.evaluateOnNewDocument(() => {
            window.benchmarkMetrics = {
                latencies: [],
                networkLatencies: [],
                frameTimestamps: [],
                detectionCounts: [],
                startTime: null
            };
            
            // Override the detection result handler to collect metrics
            const originalHandler = window.app?.handleDetectionResults;
            if (originalHandler) {
                window.app.handleDetectionResults = function(results) {
                    const displayTime = Date.now();
                    const e2eLatency = displayTime - results.capture_ts;
                    const networkLatency = results.recv_ts - results.capture_ts;
                    
                    window.benchmarkMetrics.latencies.push(e2eLatency);
                    window.benchmarkMetrics.networkLatencies.push(networkLatency);
                    window.benchmarkMetrics.frameTimestamps.push(displayTime);
                    window.benchmarkMetrics.detectionCounts.push(results.detections.length);
                    
                    return originalHandler.call(this, results);
                };
            }
        });
    }
    
    async startCameraOnPhone(page) {
        // Simulate camera start
        await page.evaluate(() => {
            // Mock getUserMedia to provide fake video stream
            navigator.mediaDevices.getUserMedia = async () => {
                const canvas = document.createElement('canvas');
                canvas.width = 640;
                canvas.height = 480;
                const ctx = canvas.getContext('2d');
                
                // Draw some test pattern
                setInterval(() => {
                    ctx.fillStyle = `hsl(${Date.now() / 10 % 360}, 50%, 50%)`;
                    ctx.fillRect(0, 0, canvas.width, canvas.height);
                    
                    // Add some moving objects
                    ctx.fillStyle = 'white';
                    const time = Date.now() / 1000;
                    const x = (Math.sin(time) + 1) * canvas.width / 2;
                    const y = (Math.cos(time) + 1) * canvas.height / 2;
                    ctx.fillRect(x - 25, y - 25, 50, 50);
                }, 33); // ~30 FPS
                
                return canvas.captureStream(30);
            };
        });
        
        // Click start button
        await page.waitForSelector('#startBtn');
        await page.click('#startBtn');
        
        // Wait for camera to start
        await page.waitForTimeout(2000);
    }
    
    async startDetectionOnViewer(page) {
        // Wait for app to be ready
        await page.waitForSelector('#startBtn');
        
        // Click start button
        await page.click('#startBtn');
        
        // Wait for detection to start
        await page.waitForTimeout(2000);
    }
    
    async waitForConnection(page) {
        // Wait for WebRTC connection to be established
        await page.waitForFunction(() => {
            const status = document.getElementById('connectionStatus');
            return status && status.textContent.includes('Connected');
        }, { timeout: 30000 });
        
        console.log('🔗 Connection established');
    }
    
    async runBenchmark(page) {
        this.metrics.startTime = Date.now();
        
        // Start metric collection
        await page.evaluate(() => {
            window.benchmarkMetrics.startTime = Date.now();
        });
        
        // Wait for benchmark duration
        await page.waitForTimeout(this.duration);
        
        this.metrics.endTime = Date.now();
    }
    
    async collectMetrics(page) {
        // Get metrics from browser
        const browserMetrics = await page.evaluate(() => {
            return window.benchmarkMetrics;
        });
        
        // Calculate statistics
        const latencies = browserMetrics.latencies || [];
        const networkLatencies = browserMetrics.networkLatencies || [];
        const detectionCounts = browserMetrics.detectionCounts || [];
        
        const results = {
            timestamp: new Date().toISOString(),
            mode: this.mode,
            duration_seconds: this.duration / 1000,
            frames_processed: latencies.length,
            processed_fps: latencies.length / (this.duration / 1000),
            
            // E2E Latency metrics
            median_e2e_latency_ms: this.calculateMedian(latencies),
            p95_e2e_latency_ms: this.calculateP95(latencies),
            mean_e2e_latency_ms: this.calculateMean(latencies),
            min_e2e_latency_ms: Math.min(...latencies),
            max_e2e_latency_ms: Math.max(...latencies),
            
            // Network latency metrics
            median_network_latency_ms: this.calculateMedian(networkLatencies),
            p95_network_latency_ms: this.calculateP95(networkLatencies),
            mean_network_latency_ms: this.calculateMean(networkLatencies),
            
            // Detection metrics
            total_detections: detectionCounts.reduce((a, b) => a + b, 0),
            avg_detections_per_frame: this.calculateMean(detectionCounts),
            
            // Bandwidth estimation (mock values for demo)
            uplink_kbps: this.estimateBandwidth('uplink'),
            downlink_kbps: this.estimateBandwidth('downlink'),
            
            // Raw data (limited to avoid huge files)
            sample_latencies: latencies.slice(0, 100),
            sample_network_latencies: networkLatencies.slice(0, 100)
        };
        
        return results;
    }
    
    calculateMedian(values) {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const middle = Math.floor(sorted.length / 2);
        return sorted.length % 2 === 0 
            ? (sorted[middle - 1] + sorted[middle]) / 2
            : sorted[middle];
    }
    
    calculateP95(values) {
        if (values.length === 0) return 0;
        const sorted = [...values].sort((a, b) => a - b);
        const index = Math.floor(sorted.length * 0.95);
        return sorted[index] || sorted[sorted.length - 1];
    }
    
    calculateMean(values) {
        if (values.length === 0) return 0;
        return values.reduce((a, b) => a + b, 0) / values.length;
    }
    
    estimateBandwidth(direction) {
        // Mock bandwidth estimation based on mode and direction
        const baseBandwidth = this.mode === 'server' ? 1500 : 800; // kbps
        const variation = Math.random() * 200 - 100; // ±100 kbps variation
        return Math.max(100, baseBandwidth + variation);
    }
    
    async saveResults(results) {
        // Ensure output directory exists
        const outputDir = path.dirname(this.outputFile);
        await fs.mkdir(outputDir, { recursive: true });
        
        // Save results
        await fs.writeFile(
            this.outputFile,
            JSON.stringify(results, null, 2),
            'utf8'
        );
        
        console.log(`📊 Results saved to: ${this.outputFile}`);
        
        // Also log summary to console
        console.log('\n📈 Benchmark Summary:');
        console.log(`   Duration: ${results.duration_seconds}s`);
        console.log(`   Frames Processed: ${results.frames_processed}`);
        console.log(`   Processed FPS: ${results.processed_fps.toFixed(2)}`);
        console.log(`   Median E2E Latency: ${results.median_e2e_latency_ms}ms`);
        console.log(`   P95 E2E Latency: ${results.p95_e2e_latency_ms}ms`);
        console.log(`   Total Detections: ${results.total_detections}`);
    }
}

// Create package.json for benchmark dependencies
async function createPackageJson() {
    const packageJson = {
        "name": "webrtc-vlm-benchmark",
        "version": "1.0.0",
        "description": "Benchmark runner for WebRTC VLM Detection",
        "dependencies": {
            "puppeteer": "^21.0.0",
            "commander": "^11.0.0"
        }
    };
    
    try {
        await fs.access('package.json');
    } catch {
        await fs.writeFile('package.json', JSON.stringify(packageJson, null, 2));
        console.log('📦 Created package.json for benchmark dependencies');
        console.log('💡 Run "npm install" to install dependencies');
    }
}

// Main execution
async function main() {
    try {
        // Create package.json if needed
        await createPackageJson();
        
        // Check if puppeteer is available
        try {
            require('puppeteer');
            require('commander');
        } catch (error) {
            console.error('❌ Missing dependencies. Please run: npm install');
            process.exit(1);
        }
        
        const runner = new BenchmarkRunner(options);
        await runner.run();
        
    } catch (error) {
        console.error('❌ Benchmark failed:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}
