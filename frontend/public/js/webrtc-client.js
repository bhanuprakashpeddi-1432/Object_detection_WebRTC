// WebRTC Client for VLM Detection
class WebRTCClient {
    constructor() {
        this.socket = null;
        this.peerConnection = null;
        this.localStream = null;
        this.remoteStream = null;
        this.dataChannel = null;
        this.isPhone = this.detectMobileDevice();
        this.roomId = 'detection-room';
        this.role = this.isPhone ? 'phone' : 'viewer';
        this.targetPeerId = null;
        
        // Configuration for WebRTC
        this.rtcConfig = {
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ]
        };
        
        this.callbacks = {
            onConnectionStateChange: null,
            onRemoteStream: null,
            onDataChannelMessage: null
        };
        
        this.init();
    }
    
    detectMobileDevice() {
        return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    }
    
    init() {
        this.socket = io();
        this.setupSocketListeners();
    }
    
    setupSocketListeners() {
        this.socket.on('connect', () => {
            console.log('Connected to signaling server');
            this.updateConnectionStatus('connecting');
            this.socket.emit('join-room', { roomId: this.roomId, role: this.role });
        });
        
        this.socket.on('disconnect', () => {
            console.log('Disconnected from signaling server');
            this.updateConnectionStatus('disconnected');
        });

        this.socket.io.on('error', (err) => {
            console.error('[Socket.IO] transport error:', err);
        });
        this.socket.io.on('reconnect_attempt', (n) => console.warn('[Socket.IO] reconnect attempt', n));
        this.socket.io.on('reconnect_failed', () => console.error('[Socket.IO] reconnect failed'));
        this.socket.io.on('ping', () => console.log('[Socket.IO] ping'));
        this.socket.io.on('pong', (latency) => console.log('[Socket.IO] pong latency', latency));
        
        this.socket.on('peer-joined', (data) => {
            console.log(`Peer joined: ${data.peerId} (${data.role})`);
            if (this.role === 'viewer' && data.role === 'phone') {
                this.targetPeerId = data.peerId;
                this.createPeerConnection();
                this.createOffer();
            } else if (this.role === 'phone' && data.role === 'viewer') {
                this.targetPeerId = data.peerId;
            }
        });
        
        this.socket.on('existing-peers', (peers) => {
            console.log('Existing peers:', peers);
            if (this.role === 'viewer') {
                const phonePeer = peers.find(p => p.role === 'phone');
                if (phonePeer) {
                    this.targetPeerId = phonePeer.peerId;
                    this.createPeerConnection();
                    this.createOffer();
                }
            } else if (this.role === 'phone') {
                const viewerPeer = peers.find(p => p.role === 'viewer');
                if (viewerPeer) {
                    this.targetPeerId = viewerPeer.peerId;
                }
            }
        });
        
        this.socket.on('signal', async (data) => {
            const { fromPeer, signal } = data;
            
            if (!this.peerConnection) {
                this.createPeerConnection();
            }
            
            if (signal.type === 'offer') {
                await this.handleOffer(signal);
            } else if (signal.type === 'answer') {
                await this.handleAnswer(signal);
            }
        });
        
        this.socket.on('ice-candidate', async (data) => {
            const { fromPeer, candidate } = data;
            if (this.peerConnection && candidate) {
                try {
                    await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                } catch (error) {
                    console.error('Error adding ICE candidate:', error);
                }
            }
        });
        
        this.socket.on('peer-left', (data) => {
            console.log(`Peer left: ${data.peerId}`);
            this.cleanup();
        });
    }
    
    createPeerConnection() {
        this.peerConnection = new RTCPeerConnection(this.rtcConfig);
        
        // Handle ICE candidates
        this.peerConnection.onicecandidate = (event) => {
            if (event.candidate && this.targetPeerId) {
                this.socket.emit('ice-candidate', {
                    targetPeer: this.targetPeerId,
                    candidate: event.candidate
                });
            }
        };
        
        // Handle connection state changes
        this.peerConnection.onconnectionstatechange = () => {
            console.log('Connection state:', this.peerConnection.connectionState);
            this.updateConnectionStatus(this.peerConnection.connectionState);
        };
        
        // Handle remote stream
        this.peerConnection.ontrack = (event) => {
            console.log('Received remote track');
            this.remoteStream = event.streams[0];
            if (this.callbacks.onRemoteStream) {
                this.callbacks.onRemoteStream(this.remoteStream);
            }
        };
        
        // Handle data channel (for receiving detection results)
        this.peerConnection.ondatachannel = (event) => {
            const channel = event.channel;
            this.setupDataChannel(channel);
        };
        
        // Create data channel if we're the initiator (viewer)
        if (this.role === 'viewer') {
            this.dataChannel = this.peerConnection.createDataChannel('detections', {
                ordered: true
            });
            this.setupDataChannel(this.dataChannel);
        }
    }
    
    setupDataChannel(channel) {
        channel.onopen = () => {
            console.log('Data channel opened');
        };
        
        channel.onclose = () => {
            console.log('Data channel closed');
        };
        
        channel.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (this.callbacks.onDataChannelMessage) {
                    this.callbacks.onDataChannelMessage(data);
                }
            } catch (error) {
                console.error('Error parsing data channel message:', error);
            }
        };
        
        this.dataChannel = channel;
    }
    
    async createOffer() {
        try {
            const offer = await this.peerConnection.createOffer({
                offerToReceiveVideo: true,
                offerToReceiveAudio: false
            });
            
            await this.peerConnection.setLocalDescription(offer);
            if (!this.targetPeerId) {
                console.warn('createOffer: targetPeerId not set yet');
                return;
            }
            this.socket.emit('signal', {
                targetPeer: this.targetPeerId,
                signal: offer
            });
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }
    
    async handleOffer(offer) {
        try {
            await this.peerConnection.setRemoteDescription(offer);
            
            // Add local stream if we're the phone
            if (this.role === 'phone' && this.localStream) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
            
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setLocalDescription(answer);
            
            if (!this.targetPeerId) {
                console.warn('handleOffer: targetPeerId missing, cannot send answer');
                return;
            }
            this.socket.emit('signal', {
                targetPeer: this.targetPeerId,
                signal: answer
            });
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }
    
    async handleAnswer(answer) {
        try {
            await this.peerConnection.setRemoteDescription(answer);
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
    
    async startCamera() {
        if (this.role !== 'phone') {
            console.warn('Only phone can start camera');
            return false;
        }
        
        try {
            // Check if we're in a secure context (required for camera on mobile)
            if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
                console.warn('Camera access may be blocked - not in secure context');
            }
            
            // Check if getUserMedia is available
            if (!navigator.mediaDevices) {
                throw new Error('navigator.mediaDevices is not available');
            }
            
            if (!navigator.mediaDevices.getUserMedia) {
                throw new Error('getUserMedia is not supported in this browser');
            }

            // Mobile-friendly camera constraints
            const constraints = {
                video: {
                    width: { ideal: 640, max: 1280 },
                    height: { ideal: 480, max: 520 },
                    frameRate: { ideal: 15, max: 30 }
                },
                audio: false
            };

            // Add facingMode for mobile devices
            if (this.isPhone) {
                constraints.video.facingMode = { ideal: 'environment' }; // Back camera
            }

            console.log('Requesting camera access with constraints:', constraints);
            this.localStream = await navigator.mediaDevices.getUserMedia(constraints);
            
            // Add stream to peer connection if it exists
            if (this.peerConnection) {
                this.localStream.getTracks().forEach(track => {
                    this.peerConnection.addTrack(track, this.localStream);
                });
            }
            
            console.log('Camera access granted successfully');
            return true;
        } catch (error) {
            console.error('Error accessing camera:', error);
            
            // Try with simpler constraints if the first attempt fails
            if (error.name === 'OverconstrainedError' || error.name === 'NotSupportedError') {
                console.log('Trying with basic constraints...');
                try {
                    this.localStream = await navigator.mediaDevices.getUserMedia({
                        video: true,
                        audio: false
                    });
                    
                    if (this.peerConnection) {
                        this.localStream.getTracks().forEach(track => {
                            this.peerConnection.addTrack(track, this.localStream);
                        });
                    }
                    
                    console.log('Camera access granted with basic constraints');
                    return true;
                } catch (fallbackError) {
                    console.error('Fallback camera access failed:', fallbackError);
                    throw fallbackError;
                }
            }
            
            throw error;
        }
    }
    
    stopCamera() {
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }
    }
    
    sendDetectionResults(results) {
        if (this.dataChannel && this.dataChannel.readyState === 'open') {
            this.dataChannel.send(JSON.stringify(results));
        }
    }
    
    getTargetPeerId() {
        return this.targetPeerId;
    }
    
    updateConnectionStatus(status) {
        let displayStatus = status;
        let className = 'disconnected';
        
        switch (status) {
            case 'connected':
                displayStatus = 'Connected';
                className = 'connected';
                break;
            case 'connecting':
                displayStatus = 'Connecting...';
                className = 'connecting';
                break;
            case 'disconnected':
                displayStatus = 'Disconnected';
                className = 'disconnected';
                break;
            case 'failed':
                displayStatus = 'Connection Failed';
                className = 'disconnected';
                break;
        }
        
        if (this.callbacks.onConnectionStateChange) {
            this.callbacks.onConnectionStateChange(status, displayStatus, className);
        }
    }
    
    cleanup() {
        this.stopCamera();
        
        if (this.dataChannel) {
            this.dataChannel.close();
            this.dataChannel = null;
        }
        
        if (this.peerConnection) {
            this.peerConnection.close();
            this.peerConnection = null;
        }
        
        this.remoteStream = null;
        this.updateConnectionStatus('disconnected');
    }
    
    // Public API
    on(event, callback) {
        this.callbacks[event] = callback;
    }
    
    isConnected() {
        return this.peerConnection && 
               this.peerConnection.connectionState === 'connected';
    }
    
    isMobile() {
        return this.isPhone;
    }
    
    getRole() {
        return this.role;
    }
}

// Export for use in other scripts
window.WebRTCClient = WebRTCClient;
