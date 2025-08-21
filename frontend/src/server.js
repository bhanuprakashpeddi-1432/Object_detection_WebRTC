const express = require('express');
const http = require('http');
let https = null;
const fs = require('fs');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const QRCode = require('qrcode');
const os = require('os');

const app = express();
// Will replace with HTTPS server if enabled
let server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// Simple mobile user-agent detection
function isMobileUserAgent(ua = '') {
  return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
}

// Get local IP address
function getLocalIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const interface of interfaces[name]) {
      if (interface.family === 'IPv4' && !interface.internal) {
        return interface.address;
      }
    }
  }
  return 'localhost';
}

const PORT = process.env.PORT || 3000;
const HTTPS_ENABLED = process.env.ENABLE_HTTPS === '1' || process.env.ENABLE_HTTPS === 'true';
const HTTPS_PORT = process.env.HTTPS_PORT ? parseInt(process.env.HTTPS_PORT) : 3443;
const SIGNALING_PORT = 8080;
const localIP = getLocalIP();

// Store connected peers
const peers = new Map();

// Socket.io connection handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);
  
  socket.on('join-room', (data) => {
    const { roomId, role } = data; // role: 'phone' or 'viewer'
    socket.join(roomId);
    peers.set(socket.id, { roomId, role });
    
    console.log(`${role} joined room: ${roomId}`);
    
    // Notify other peers in the room
    socket.to(roomId).emit('peer-joined', { peerId: socket.id, role });
    
    // Send list of existing peers
    const roomPeers = Array.from(peers.entries())
      .filter(([id, peer]) => peer.roomId === roomId && id !== socket.id)
      .map(([id, peer]) => ({ peerId: id, role: peer.role }));
    
    socket.emit('existing-peers', roomPeers);
  });
  
  // WebRTC signaling
  socket.on('signal', (data) => {
    const { targetPeer, signal } = data;
    socket.to(targetPeer).emit('signal', {
      fromPeer: socket.id,
      signal
    });
  });
  
  // ICE candidate exchange
  socket.on('ice-candidate', (data) => {
    const { targetPeer, candidate } = data;
    socket.to(targetPeer).emit('ice-candidate', {
      fromPeer: socket.id,
      candidate
    });
  });
  
  socket.on('disconnect', () => {
    const peer = peers.get(socket.id);
    if (peer) {
      socket.to(peer.roomId).emit('peer-left', { peerId: socket.id });
      peers.delete(socket.id);
    }
    console.log(`Client disconnected: ${socket.id}`);
  });
});

// Root route always serves viewer UI; phone must use explicit /phone (improves clarity)
app.get('/', (req, res) => {
  return res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Explicit phone route (direct access)
app.get('/phone', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/phone.html'));
});

// Static assets AFTER dynamic root handling
app.use(express.static(path.join(__dirname, '../public')));
// Flexible models static path: prefer ../../models (developer mount), fallback to bundled public/models
(() => {
  const primaryModelsPath = path.join(__dirname, '../../models');
  const bundledModelsPath = path.join(__dirname, '../public/models');
  if (fs.existsSync(primaryModelsPath)) {
    app.use('/models', express.static(primaryModelsPath));
    console.log(`📦 Serving models from primary path: ${primaryModelsPath}`);
  } else if (fs.existsSync(bundledModelsPath)) {
    app.use('/models', express.static(bundledModelsPath));
    console.log(`📦 Serving models from bundled path: ${bundledModelsPath}`);
  } else {
    console.warn('⚠ No models directory found (neither ../../models nor public/models). Model loading will fail.');
  }
})();

// API routes
app.get('/api/connection-info', async (req, res) => {
  // Use environment variable for host IP or fall back to dynamic detection
  const networkIP = process.env.HOST_IP || getLocalIP();
  const baseUrl = `http://${networkIP}:${PORT}`;
  const phoneUrl = `${baseUrl}/phone`;
  const phoneParamUrl = `${baseUrl}/?mobile=true`; // fallback style

  try {
    const qrCode = await QRCode.toDataURL(phoneUrl); // Prefer direct /phone page for QR
    res.json({
      url: baseUrl,          // viewer URL
      phoneUrl,              // explicit phone page URL
      phoneParamUrl,         // alternative param-based URL
      qrCode,                // QR encodes phoneUrl
      localIP: networkIP,    // Use actual network IP
      port: PORT
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', mode: process.env.MODE || 'wasm' });
});

// Try enabling HTTPS if requested
if (HTTPS_ENABLED) {
  try {
    const certPath = path.join(__dirname, '../../certs');
    const keyFile = process.env.SSL_KEY || path.join(certPath, 'server.key');
    const certFile = process.env.SSL_CERT || path.join(certPath, 'server.crt');
    if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
      https = require('https');
      const creds = { key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) };
      const httpsServer = https.createServer(creds, app);
      // Attach Socket.IO also to HTTPS server
      const secureIo = socketIo(httpsServer, { cors: { origin: '*', methods: ['GET','POST'] } });
      secureIo.on('connection', (s) => {
        // Mirror primary io handlers by forwarding events to same logic
        io.emit('proxy-info', { info: 'HTTPS socket connected (duplicate signaling not fully implemented)' });
      });
      httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
        console.log(`🔒 HTTPS enabled on port ${HTTPS_PORT}`);
        console.log(`🖥️  Viewer (HTTPS) URL: https://${localIP}:${HTTPS_PORT}`);
        console.log(`📱 Phone (HTTPS) URL: https://${localIP}:${HTTPS_PORT}/phone`);
      });
    } else {
      console.log('⚠ HTTPS requested but certificate files not found. Skipping.');
    }
  } catch (e) {
    console.log('⚠ Failed to initialize HTTPS:', e.message);
  }
}

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌐 HTTP server running on port ${PORT}`);
  console.log(`🖥️  Viewer URL: http://localhost:${PORT}`);
  console.log(`🌐 LAN Viewer URL: http://${localIP}:${PORT}`);
  console.log(`📱 Phone URL: http://${localIP}:${PORT}/phone`);
  if (HTTPS_ENABLED) console.log(`🔐 If certs present also available at https://${localIP}:${HTTPS_PORT}`);
});

module.exports = { app, server, io };
