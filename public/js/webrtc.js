// ========================================================
// NEXUS WEBRTC ENGINE (Multi-Peer Mesh Voice & Video)
// Handles audio/video streaming, signaling, screen share & visualizer
// ========================================================

class NexusWebRTC {
  constructor() {
    this.localStream = null;
    this.screenStream = null;
    this.peerConnections = new Map(); // peerId -> RTCPeerConnection
    this.remoteStreams = new Map(); // peerId -> MediaStream
    this.callType = 'video'; // 'video' | 'voice'
    this.isCallActive = false;
    this.isAudioMuted = false;
    this.isVideoOff = false;
    this.isScreenSharing = false;
    this.analyser = null;
    this.animFrame = null;

    // Public STUN configuration
    this.rtcConfig = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' }
      ]
    };
  }

  // Safe Media Stream Getter with Secure Context & Browser Permission Diagnostics
  async getMediaStream(constraints) {
    // 1. Standard Modern API
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
      return await navigator.mediaDevices.getUserMedia(constraints);
    }

    // 2. Legacy Browser Fallback
    const legacyGetUserMedia = navigator.getUserMedia ||
      navigator.webkitGetUserMedia ||
      navigator.mozGetUserMedia ||
      navigator.msGetUserMedia;

    if (legacyGetUserMedia) {
      return new Promise((resolve, reject) => {
        legacyGetUserMedia.call(navigator, constraints, resolve, reject);
      });
    }

    // 3. Not Available - Detect if caused by Insecure Context (HTTP on IP address)
    const isLocalhost = ['localhost', '127.0.0.1'].includes(location.hostname);
    const isSecure = window.isSecureContext || location.protocol === 'https:' || isLocalhost;

    if (!isSecure) {
      const origin = `${location.protocol}//${location.host}`;
      throw new Error(`INSECURE_CONTEXT:${origin}`);
    }

    throw new Error('BROWSER_UNSUPPORTED: Browser Anda tidak mendukung API MediaDevices atau izin diblokir.');
  }

  showSecureContextModal(origin) {
    const modal = document.getElementById('secureContextModal');
    const originSpan = document.getElementById('secCtxOriginText');
    if (originSpan) originSpan.textContent = origin;
    if (modal) {
      modal.classList.add('active');
    }
  }

  // Start or Join a Call
  async startCall(callType = 'video') {
    if (this.isCallActive) return;
    this.callType = callType;

    try {
      window.nexusAudio.startCallRingtone();

      const constraints = {
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: callType === 'video' ? {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: 'user'
        } : false
      };

      this.localStream = await this.getMediaStream(constraints);
      this.isCallActive = true;
      this.isAudioMuted = false;
      this.isVideoOff = (callType === 'voice');

      // Setup Local UI and Visualizer
      this.renderCallHUD();
      this.attachLocalStream();
      this.setupAudioVisualizer(this.localStream);

      // Signal server to join call in current room
      window.nexusApp.socket.emit('call:join', { callType: this.callType });
    } catch (err) {
      console.error('Failed to get media devices:', err);
      window.nexusAudio.stopCallRingtone();
      this.endCall(false);

      if (err.message && err.message.startsWith('INSECURE_CONTEXT')) {
        const origin = err.message.split(':')[1] ? err.message.substring(17) : `${location.protocol}//${location.host}`;
        this.showSecureContextModal(origin);
      } else {
        alert(`Gagal mengakses perangkat ${callType === 'video' ? 'Kamera/Mikrofon' : 'Mikrofon'}: ` + (err.message || 'Izin ditolak'));
      }
    }
  }

  // Handle list of existing peers in the call
  async handleAllPeers(peers, callType) {
    window.nexusAudio.stopCallRingtone();
    if (peers.length > 0) {
      window.nexusAudio.playCallConnected();
    }

    for (const peer of peers) {
      await this.createPeerConnection(peer.peerId, peer.username, peer.avatar, true);
    }
  }

  // Create Peer Connection (Initiator creates offer, Receiver waits for offer)
  async createPeerConnection(peerId, username, avatar, isInitiator) {
    if (this.peerConnections.has(peerId)) {
      return this.peerConnections.get(peerId);
    }

    const pc = new RTCPeerConnection(this.rtcConfig);
    this.peerConnections.set(peerId, pc);

    // Add local tracks to connection
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // Handle remote tracks
    pc.ontrack = (event) => {
      console.log(`[WebRTC] Received remote track from ${peerId}:`, event.track.kind);
      let stream = this.remoteStreams.get(peerId);
      if (!stream) {
        stream = new MediaStream();
        this.remoteStreams.set(peerId, stream);
      }
      stream.addTrack(event.track);
      this.renderRemotePeer(peerId, username, avatar, stream);
    };

    // Handle ICE Candidates
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        window.nexusApp.socket.emit('call:signal-candidate', {
          targetPeerId: peerId,
          candidate: event.candidate
        });
      }
    };

    // Connection state changes
    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Peer ${peerId} state:`, pc.connectionState);
      if (['disconnected', 'failed', 'closed'].includes(pc.connectionState)) {
        this.removeRemotePeer(peerId);
      }
    };

    // If initiator, create and send Offer
    if (isInitiator) {
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        window.nexusApp.socket.emit('call:signal-offer', {
          targetPeerId: peerId,
          offer: offer,
          callType: this.callType
        });
      } catch (err) {
        console.error('Error creating offer for peer:', peerId, err);
      }
    }

    return pc;
  }

  // Handle incoming Offer from a peer
  async handleIncomingOffer(fromPeerId, callerName, callerAvatar, offer, callType) {
    if (!this.isCallActive) {
      // Auto prompt to join if user is in the room
      const accept = confirm(`Panggilan ${callType === 'video' ? 'Video' : 'Suara'} dari ${callerName}. Bergabung sekarang?`);
      if (accept) {
        await this.startCall(callType);
      } else {
        return;
      }
    }

    window.nexusAudio.stopCallRingtone();
    window.nexusAudio.playCallConnected();

    const pc = await this.createPeerConnection(fromPeerId, callerName, callerAvatar, false);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      window.nexusApp.socket.emit('call:signal-answer', {
        targetPeerId: fromPeerId,
        answer: answer
      });
    } catch (err) {
      console.error('Error handling incoming offer:', err);
    }
  }

  // Handle incoming Answer from a peer
  async handleIncomingAnswer(fromPeerId, answer) {
    window.nexusAudio.stopCallRingtone();
    window.nexusAudio.playCallConnected();

    const pc = this.peerConnections.get(fromPeerId);
    if (pc) {
      try {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      } catch (err) {
        console.error('Error setting remote description for answer:', err);
      }
    }
  }

  // Handle incoming ICE Candidate
  async handleIncomingCandidate(fromPeerId, candidate) {
    const pc = this.peerConnections.get(fromPeerId);
    if (pc && candidate) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.error('Error adding ICE candidate:', err);
      }
    }
  }

  // Toggle Microphone
  toggleAudio() {
    if (!this.localStream) return;
    const audioTrack = this.localStream.getAudioTracks()[0];
    if (audioTrack) {
      this.isAudioMuted = !this.isAudioMuted;
      audioTrack.enabled = !this.isAudioMuted;
      this.updateControlButtons();
      this.notifyMediaToggle();
    }
  }

  // Toggle Camera
  toggleVideo() {
    if (!this.localStream) return;
    const videoTrack = this.localStream.getVideoTracks()[0];
    if (videoTrack) {
      this.isVideoOff = !this.isVideoOff;
      videoTrack.enabled = !this.isVideoOff;
      const localVideo = document.getElementById('localVideoElement');
      if (localVideo) {
        localVideo.style.display = this.isVideoOff ? 'none' : 'block';
      }
      const localPlaceholder = document.getElementById('localVideoPlaceholder');
      if (localPlaceholder) {
        localPlaceholder.style.display = this.isVideoOff ? 'flex' : 'none';
      }
      this.updateControlButtons();
      this.notifyMediaToggle();
    }
  }

  // Toggle Screen Sharing
  async toggleScreenShare() {
    if (!this.isCallActive) return;

    if (!this.isScreenSharing) {
      try {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
          alert('Fitur Screen Sharing memerlukan koneksi aman (HTTPS / Secure Context).');
          return;
        }

        this.screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' },
          audio: false
        });

        const screenTrack = this.screenStream.getVideoTracks()[0];

        // Replace track on all peer connections
        for (const [peerId, pc] of this.peerConnections.entries()) {
          const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
          if (sender) {
            sender.replaceTrack(screenTrack);
          }
        }

        // Update local preview
        const localVideo = document.getElementById('localVideoElement');
        if (localVideo) {
          localVideo.srcObject = this.screenStream;
          localVideo.style.display = 'block';
        }
        const localPlaceholder = document.getElementById('localVideoPlaceholder');
        if (localPlaceholder) localPlaceholder.style.display = 'none';

        this.isScreenSharing = true;
        this.updateControlButtons();
        this.notifyMediaToggle();

        screenTrack.onended = () => {
          this.stopScreenSharing();
        };
      } catch (err) {
        console.warn('Screen share canceled or failed:', err);
      }
    } else {
      this.stopScreenSharing();
    }
  }

  // Stop screen sharing and revert to camera
  stopScreenSharing() {
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }

    if (this.localStream) {
      const cameraTrack = this.localStream.getVideoTracks()[0];
      for (const [peerId, pc] of this.peerConnections.entries()) {
        const sender = pc.getSenders().find(s => s.track && s.track.kind === 'video');
        if (sender && cameraTrack) {
          sender.replaceTrack(cameraTrack);
        }
      }

      const localVideo = document.getElementById('localVideoElement');
      if (localVideo) {
        localVideo.srcObject = this.localStream;
        localVideo.style.display = this.isVideoOff ? 'none' : 'block';
      }
      const localPlaceholder = document.getElementById('localVideoPlaceholder');
      if (localPlaceholder) {
        localPlaceholder.style.display = this.isVideoOff ? 'flex' : 'none';
      }
    }

    this.isScreenSharing = false;
    this.updateControlButtons();
    this.notifyMediaToggle();
  }

  notifyMediaToggle() {
    window.nexusApp.socket.emit('call:media-toggle', {
      isAudioMuted: this.isAudioMuted,
      isVideoOff: this.isVideoOff,
      isScreenSharing: this.isScreenSharing
    });
  }

  handlePeerMediaToggle(peerId, isAudioMuted, isVideoOff, isScreenSharing) {
    const peerCard = document.getElementById(`peer-card-${peerId}`);
    if (peerCard) {
      const audioIndicator = peerCard.querySelector('.peer-audio-badge');
      if (audioIndicator) {
        audioIndicator.classList.toggle('muted', isAudioMuted);
        audioIndicator.innerHTML = isAudioMuted ? '🔇' : '🎙️';
      }

      const videoEl = peerCard.querySelector('video');
      const placeholder = peerCard.querySelector('.peer-placeholder');
      if (videoEl && placeholder) {
        if (isVideoOff && !isScreenSharing) {
          videoEl.style.display = 'none';
          placeholder.style.display = 'flex';
        } else {
          videoEl.style.display = 'block';
          placeholder.style.display = 'none';
        }
      }
    }
  }

  // End Call & Cleanup
  endCall(notifyServer = true) {
    window.nexusAudio.stopCallRingtone();
    if (this.isCallActive) {
      window.nexusAudio.playCallEnded();
    }

    if (notifyServer && window.nexusApp && window.nexusApp.socket) {
      window.nexusApp.socket.emit('call:leave');
    }

    // Stop all local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach(t => t.stop());
      this.screenStream = null;
    }

    // Close all peer connections
    for (const [peerId, pc] of this.peerConnections.entries()) {
      pc.close();
    }
    this.peerConnections.clear();
    this.remoteStreams.clear();

    if (this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }

    this.isCallActive = false;
    this.isScreenSharing = false;

    // Hide Call HUD
    const callModal = document.getElementById('nexusCallHUD');
    if (callModal) {
      callModal.classList.remove('active');
    }
    const peerGrid = document.getElementById('callPeersGrid');
    if (peerGrid) {
      peerGrid.innerHTML = '';
    }
  }

  // Remove single peer when left
  removeRemotePeer(peerId) {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.remoteStreams.delete(peerId);

    const peerCard = document.getElementById(`peer-card-${peerId}`);
    if (peerCard) {
      peerCard.remove();
    }
    this.updateGridColumns();
  }

  // Render Call HUD and Local Stream Container
  renderCallHUD() {
    const callModal = document.getElementById('nexusCallHUD');
    if (!callModal) return;

    callModal.classList.add('active');
    document.getElementById('callTitleSector').textContent = `SECTOR // ${window.nexusApp.currentRoom.toUpperCase()}`;
    document.getElementById('callTypeBadge').textContent = this.callType === 'video' ? 'VIDEO TRANSMISSION' : 'VOICE STREAM';

    const localVideo = document.getElementById('localVideoElement');
    const localPlaceholder = document.getElementById('localVideoPlaceholder');
    const localUsername = document.getElementById('localUserNameBadge');

    if (localUsername && window.nexusApp.currentUser) {
      localUsername.textContent = `${window.nexusApp.currentUser.username} (YOU)`;
    }

    if (this.callType === 'voice') {
      if (localVideo) localVideo.style.display = 'none';
      if (localPlaceholder) localPlaceholder.style.display = 'flex';
    } else {
      if (localVideo) localVideo.style.display = 'block';
      if (localPlaceholder) localPlaceholder.style.display = 'none';
    }

    this.updateControlButtons();
  }

  attachLocalStream() {
    const localVideo = document.getElementById('localVideoElement');
    if (localVideo && this.localStream) {
      localVideo.srcObject = this.localStream;
      localVideo.muted = true; // prevent echo from local audio
    }
  }

  // Render Remote Peer Box in Call Matrix
  renderRemotePeer(peerId, username, avatar, stream) {
    let peerCard = document.getElementById(`peer-card-${peerId}`);
    const grid = document.getElementById('callPeersGrid');
    if (!grid) return;

    if (!peerCard) {
      peerCard = document.createElement('div');
      peerCard.id = `peer-card-${peerId}`;
      peerCard.className = 'peer-card futuristic-card';

      peerCard.innerHTML = `
        <div class="peer-video-wrapper">
          <video autoplay playsinline></video>
          <div class="peer-placeholder">
            <img src="${avatar || 'https://api.dicebear.com/7.x/bottts/svg?seed=' + peerId}" alt="avatar" class="peer-avatar-glow" />
            <div class="cyber-radar-pulse"></div>
          </div>
          <div class="peer-overlay-hud">
            <span class="peer-name">${username || 'Cyber Peer'}</span>
            <span class="peer-audio-badge">🎙️</span>
          </div>
          <div class="corner-hud-bracket top-left"></div>
          <div class="corner-hud-bracket top-right"></div>
          <div class="corner-hud-bracket bottom-left"></div>
          <div class="corner-hud-bracket bottom-right"></div>
        </div>
      `;
      grid.appendChild(peerCard);
    }

    const videoEl = peerCard.querySelector('video');
    if (videoEl && stream) {
      videoEl.srcObject = stream;
    }

    this.updateGridColumns();
  }

  updateGridColumns() {
    const grid = document.getElementById('callPeersGrid');
    if (!grid) return;
    const count = grid.children.length + 1; // +1 for local video
    if (count <= 1) {
      grid.style.gridTemplateColumns = '1fr';
    } else if (count === 2) {
      grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    } else if (count <= 4) {
      grid.style.gridTemplateColumns = 'repeat(2, 1fr)';
    } else {
      grid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(280px, 1fr))';
    }
  }

  updateControlButtons() {
    const btnAudio = document.getElementById('btnCallToggleAudio');
    const btnVideo = document.getElementById('btnCallToggleVideo');
    const btnScreen = document.getElementById('btnCallScreenShare');

    if (btnAudio) {
      btnAudio.classList.toggle('active-off', this.isAudioMuted);
      btnAudio.innerHTML = this.isAudioMuted 
        ? `<svg viewBox="0 0 24 24" class="hud-icon"><path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-3 0c0-1.66-1.34-3-3-3-.18 0-.35.02-.51.05l3.46 3.46c.03-.16.05-.33.05-.51zM4.41 2.86L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.14 1.77-.45 2.54-.9l4.19 4.18 1.41-1.41L4.41 2.86z"/></svg>`
        : `<svg viewBox="0 0 24 24" class="hud-icon"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;
    }

    if (btnVideo) {
      btnVideo.classList.toggle('active-off', this.isVideoOff);
      btnVideo.innerHTML = this.isVideoOff
        ? `<svg viewBox="0 0 24 24" class="hud-icon"><path fill="currentColor" d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2zM15 16H6c-.55 0-1-.45-1-1V8.27l10 10V16z"/></svg>`
        : `<svg viewBox="0 0 24 24" class="hud-icon"><path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/></svg>`;
    }

    if (btnScreen) {
      btnScreen.classList.toggle('active-sharing', this.isScreenSharing);
    }
  }

  // Futuristic Canvas Audio Visualizer
  setupAudioVisualizer(stream) {
    const canvas = document.getElementById('callAudioVisualizerCanvas');
    if (!canvas || !stream) return;

    try {
      const audioCtx = window.nexusAudio.ctx || new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      this.analyser = audioCtx.createAnalyser();
      this.analyser.fftSize = 64;
      source.connect(this.analyser);

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      const ctx2d = canvas.getContext('2d');

      const drawVisualizer = () => {
        if (!this.isCallActive) return;
        this.animFrame = requestAnimationFrame(drawVisualizer);

        this.analyser.getByteFrequencyData(dataArray);

        ctx2d.clearRect(0, 0, canvas.width, canvas.height);

        const barWidth = (canvas.width / bufferLength) * 1.8;
        let barHeight;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
          barHeight = (dataArray[i] / 255) * canvas.height * 0.85;

          const gradient = ctx2d.createLinearGradient(0, canvas.height - barHeight, 0, canvas.height);
          gradient.addColorStop(0, '#00f0ff');
          gradient.addColorStop(0.5, '#7000ff');
          gradient.addColorStop(1, '#ff007f');

          ctx2d.fillStyle = gradient;
          ctx2d.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);

          x += barWidth;
        }
      };

      drawVisualizer();
    } catch (err) {
      console.warn('Audio visualizer init error:', err);
    }
  }
}

window.nexusWebRTC = new NexusWebRTC();
