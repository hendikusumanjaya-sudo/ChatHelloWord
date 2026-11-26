// ========================================================
// NEXUS APPLICATION LOGIC
// Real-time Chat, Multer File Upload, Room Roster, UI Bindings
// ========================================================

class NexusApp {
  constructor() {
    this.socket = null;
    this.currentUser = null;
    this.currentRoom = 'general-nexus';
    this.allRooms = [];
    this.usersInRoom = [];
    this.typingTimeout = null;
    this.pendingFile = null;
  }

  init() {
    // Connect to Socket.IO Server
    this.socket = io();

    this.setupSocketListeners();
    this.setupUIEventListeners();

    // Check stored user or generate random profile
    const savedName = localStorage.getItem('nexus_username');
    const savedAvatar = localStorage.getItem('nexus_avatar');
    const initialName = savedName || `Agent_${Math.floor(1000 + Math.random() * 9000)}`;
    const initialAvatar = savedAvatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${initialName}`;

    // Join default room
    this.socket.emit('user:join', {
      username: initialName,
      avatar: initialAvatar,
      room: this.currentRoom
    });
  }

  setupSocketListeners() {
    // Initial data from server upon connection
    this.socket.on('init:data', ({ user, rooms, history, usersInRoom }) => {
      this.currentUser = user;
      this.allRooms = rooms;
      this.usersInRoom = usersInRoom;
      this.currentRoom = user.room;

      this.updateProfileUI();
      this.renderRoomsList();
      this.renderUsersRoster();
      this.renderMessageHistory(history);
      this.updateSectorBar();
    });

    // Room update broadcast
    this.socket.on('rooms:updated', (rooms) => {
      this.allRooms = rooms;
      this.renderRoomsList();
    });

    // Room switched response
    this.socket.on('room:switched', ({ room, history, usersInRoom }) => {
      this.currentRoom = room;
      this.usersInRoom = usersInRoom;
      this.renderRoomsList();
      this.renderUsersRoster();
      this.renderMessageHistory(history);
      this.updateSectorBar();
    });

    // User joined room
    this.socket.on('user:joined', ({ user, usersInRoom }) => {
      this.usersInRoom = usersInRoom;
      this.renderUsersRoster();
      window.nexusAudio.playJoin();
    });

    // User left room
    this.socket.on('user:left', ({ userId, username, usersInRoom }) => {
      this.usersInRoom = usersInRoom;
      this.renderUsersRoster();
    });

    // Incoming Chat Message
    this.socket.on('chat:message', (message) => {
      this.appendMessage(message);
      if (message.system) {
        // system notification
      } else if (message.senderId !== this.socket.id) {
        window.nexusAudio.playReceive();
      }
    });

    // Typing Status update
    this.socket.on('chat:user-typing', ({ userId, username, isTyping }) => {
      const typingEl = document.getElementById('chatTypingIndicator');
      if (!typingEl) return;

      if (isTyping) {
        typingEl.innerHTML = `<span class="typing-pulse"></span> <span class="typing-name">${username}</span> sedang mentransmisikan data...`;
        typingEl.style.display = 'flex';
      } else {
        typingEl.innerHTML = '';
        typingEl.style.display = 'none';
      }
    });

    // Message Reaction update
    this.socket.on('chat:reaction-updated', ({ messageId, reactions }) => {
      this.updateReactionsUI(messageId, reactions);
    });

    // Call status update
    this.socket.on('call:status-update', ({ room, callPeers, usersInRoom }) => {
      if (room === this.currentRoom) {
        this.usersInRoom = usersInRoom;
        this.renderUsersRoster();
      }
    });

    // ==========================================
    // WEBRTC SIGNALING ROUTING
    // ==========================================
    this.socket.on('call:all-peers', ({ peers, callType }) => {
      window.nexusWebRTC.handleAllPeers(peers, callType);
    });

    this.socket.on('call:incoming-offer', ({ fromPeerId, callerName, callerAvatar, offer, callType }) => {
      window.nexusWebRTC.handleIncomingOffer(fromPeerId, callerName, callerAvatar, offer, callType);
    });

    this.socket.on('call:incoming-answer', ({ fromPeerId, answer }) => {
      window.nexusWebRTC.handleIncomingAnswer(fromPeerId, answer);
    });

    this.socket.on('call:incoming-candidate', ({ fromPeerId, candidate }) => {
      window.nexusWebRTC.handleIncomingCandidate(fromPeerId, candidate);
    });

    this.socket.on('call:peer-media-toggle', ({ peerId, isAudioMuted, isVideoOff, isScreenSharing }) => {
      window.nexusWebRTC.handlePeerMediaToggle(peerId, isAudioMuted, isVideoOff, isScreenSharing);
    });

    this.socket.on('call:peer-left', ({ peerId }) => {
      window.nexusWebRTC.removeRemotePeer(peerId);
    });
  }

  setupUIEventListeners() {
    // Sound FX Mute Toggle
    const btnSound = document.getElementById('btnToggleSound');
    if (btnSound) {
      btnSound.addEventListener('click', () => {
        const isMuted = window.nexusAudio.toggleMute();
        btnSound.classList.toggle('active-sound', !isMuted);
        btnSound.title = isMuted ? 'Aktifkan Suara Sci-Fi' : 'Senyapkan Suara Sci-Fi';
        btnSound.innerHTML = isMuted ? '🔇' : '🔊';
      });
    }

    // Call Actions
    const btnVoiceCall = document.getElementById('btnStartVoiceCall');
    if (btnVoiceCall) {
      btnVoiceCall.addEventListener('click', () => {
        window.nexusAudio.playClick();
        window.nexusWebRTC.startCall('voice');
      });
    }

    const btnVideoCall = document.getElementById('btnStartVideoCall');
    if (btnVideoCall) {
      btnVideoCall.addEventListener('click', () => {
        window.nexusAudio.playClick();
        window.nexusWebRTC.startCall('video');
      });
    }

    // In-Call HUD Controls
    const btnCallAudio = document.getElementById('btnCallToggleAudio');
    if (btnCallAudio) {
      btnCallAudio.addEventListener('click', () => {
        window.nexusAudio.playClick();
        window.nexusWebRTC.toggleAudio();
      });
    }

    const btnCallVideo = document.getElementById('btnCallToggleVideo');
    if (btnCallVideo) {
      btnCallVideo.addEventListener('click', () => {
        window.nexusAudio.playClick();
        window.nexusWebRTC.toggleVideo();
      });
    }

    const btnCallScreen = document.getElementById('btnCallScreenShare');
    if (btnCallScreen) {
      btnCallScreen.addEventListener('click', () => {
        window.nexusAudio.playClick();
        window.nexusWebRTC.toggleScreenShare();
      });
    }

    const btnCallEnd = document.getElementById('btnCallEnd');
    if (btnCallEnd) {
      btnCallEnd.addEventListener('click', () => {
        window.nexusWebRTC.endCall(true);
      });
    }

    // Chat Form Send
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        await this.handleSendMessage();
      });

      // Typing notification
      chatInput.addEventListener('input', () => {
        this.socket.emit('chat:typing', { isTyping: true });
        clearTimeout(this.typingTimeout);
        this.typingTimeout = setTimeout(() => {
          this.socket.emit('chat:typing', { isTyping: false });
        }, 1200);
      });
    }

    // Attachment Input & Button
    const btnAttach = document.getElementById('btnAttachFile');
    const fileInput = document.getElementById('mediaFileInput');
    if (btnAttach && fileInput) {
      btnAttach.addEventListener('click', () => {
        window.nexusAudio.playClick();
        fileInput.click();
      });

      fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.setPendingFile(e.target.files[0]);
        }
      });
    }

    // Remove Pending Attachment
    const btnRemovePending = document.getElementById('btnRemovePendingFile');
    if (btnRemovePending) {
      btnRemovePending.addEventListener('click', () => {
        this.clearPendingFile();
      });
    }

    // Drag and Drop Upload Support
    const chatArea = document.querySelector('.nexus-chat-area');
    if (chatArea) {
      ['dragenter', 'dragover'].forEach(eventName => {
        chatArea.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          chatArea.classList.add('drag-active');
        }, false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        chatArea.addEventListener(eventName, (e) => {
          e.preventDefault();
          e.stopPropagation();
          chatArea.classList.remove('drag-active');
        }, false);
      });

      chatArea.addEventListener('drop', (e) => {
        if (e.dataTransfer.files && e.dataTransfer.files[0]) {
          this.setPendingFile(e.dataTransfer.files[0]);
        }
      });
    }

    // Lightbox Close
    const lightbox = document.getElementById('nexusLightbox');
    const btnCloseLightbox = document.getElementById('btnCloseLightbox');
    if (lightbox && btnCloseLightbox) {
      btnCloseLightbox.addEventListener('click', () => {
        lightbox.classList.remove('active');
      });
      lightbox.addEventListener('click', (e) => {
        if (e.target === lightbox) {
          lightbox.classList.remove('active');
        }
      });
    }

    // Custom Room Creation Modal
    const btnOpenRoomModal = document.getElementById('btnOpenCreateRoomModal');
    const roomModal = document.getElementById('createRoomModal');
    const btnCloseRoomModal = document.getElementById('btnCloseRoomModal');
    const formCreateRoom = document.getElementById('formCreateRoom');

    if (btnOpenRoomModal && roomModal) {
      btnOpenRoomModal.addEventListener('click', () => {
        window.nexusAudio.playClick();
        roomModal.classList.add('active');
      });
    }
    if (btnCloseRoomModal && roomModal) {
      btnCloseRoomModal.addEventListener('click', () => {
        roomModal.classList.remove('active');
      });
    }
    if (formCreateRoom) {
      formCreateRoom.addEventListener('submit', (e) => {
        e.preventDefault();
        const roomName = document.getElementById('newRoomNameInput').value.trim();
        const roomDesc = document.getElementById('newRoomDescInput').value.trim();
        if (roomName) {
          this.socket.emit('room:create', { roomName, roomDesc });
          formCreateRoom.reset();
          roomModal.classList.remove('active');
        }
      });
    }

    // Profile Edit Modal
    const btnEditProfile = document.getElementById('btnEditProfile');
    const profileModal = document.getElementById('profileEditModal');
    const btnCloseProfileModal = document.getElementById('btnCloseProfileModal');
    const formEditProfile = document.getElementById('formEditProfile');

    if (btnEditProfile && profileModal) {
      btnEditProfile.addEventListener('click', () => {
        window.nexusAudio.playClick();
        document.getElementById('editUsernameInput').value = this.currentUser.username;
        profileModal.classList.add('active');
      });
    }
    if (btnCloseProfileModal && profileModal) {
      btnCloseProfileModal.addEventListener('click', () => {
        profileModal.classList.remove('active');
      });
    }
    if (formEditProfile) {
      formEditProfile.addEventListener('submit', (e) => {
        e.preventDefault();
        const newName = document.getElementById('editUsernameInput').value.trim();
        const selectedAvatar = document.querySelector('.avatar-choice-option.selected');
        const newAvatar = selectedAvatar ? selectedAvatar.dataset.avatarUrl : this.currentUser.avatar;

        if (newName) {
          this.currentUser.username = newName;
          this.currentUser.avatar = newAvatar;
          localStorage.setItem('nexus_username', newName);
          localStorage.setItem('nexus_avatar', newAvatar);

          this.updateProfileUI();
          this.socket.emit('user:join', {
            username: newName,
            avatar: newAvatar,
            room: this.currentRoom
          });
          profileModal.classList.remove('active');
        }
      });
    }

    // Preset Avatar selector
    document.querySelectorAll('.avatar-choice-option').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('.avatar-choice-option').forEach(opt => opt.classList.remove('selected'));
        el.classList.add('selected');
      });
    });

    // Mobile Sidebar Toggle
    const btnMobileSidebar = document.getElementById('btnMobileSidebarToggle');
    const sidebar = document.querySelector('.nexus-sidebar');
    if (btnMobileSidebar && sidebar) {
      btnMobileSidebar.addEventListener('click', () => {
        sidebar.classList.toggle('mobile-open');
      });
    }
  }

  // Set file ready to be uploaded with next message
  setPendingFile(file) {
    this.pendingFile = file;
    const tray = document.getElementById('pendingAttachmentTray');
    const nameEl = document.getElementById('pendingFileName');
    const iconEl = document.getElementById('pendingFileIcon');

    if (tray && nameEl) {
      nameEl.textContent = `${file.name} (${this.formatBytes(file.size)})`;
      if (file.type.startsWith('image/')) iconEl.textContent = '🖼️';
      else if (file.type.startsWith('video/')) iconEl.textContent = '🎬';
      else if (file.type.startsWith('audio/')) iconEl.textContent = '🎵';
      else iconEl.textContent = '📁';

      tray.classList.add('active');
    }
  }

  clearPendingFile() {
    this.pendingFile = null;
    const fileInput = document.getElementById('mediaFileInput');
    if (fileInput) fileInput.value = '';
    const tray = document.getElementById('pendingAttachmentTray');
    if (tray) tray.classList.remove('active');
  }

  // Handle Send Message (text + optional file upload)
  async handleSendMessage() {
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text && !this.pendingFile) return;

    let attachmentData = null;

    if (this.pendingFile) {
      try {
        const progressBar = document.getElementById('pendingProgressBar');
        if (progressBar) progressBar.style.width = '50%';

        const formData = new FormData();
        formData.append('mediaFile', this.pendingFile);

        const res = await fetch('/api/upload', {
          method: 'POST',
          body: formData
        });
        const data = await res.json();

        if (progressBar) progressBar.style.width = '100%';

        if (data.success) {
          attachmentData = data.file;
        } else {
          alert('Gagal mengunggah file: ' + data.message);
          return;
        }
      } catch (err) {
        console.error('Upload error:', err);
        alert('Terjadi kesalahan saat mengunggah file');
        return;
      }
    }

    // Emit chat message
    this.socket.emit('chat:send', {
      text,
      attachment: attachmentData
    });

    window.nexusAudio.playSend();

    input.value = '';
    this.clearPendingFile();
  }

  // Render Rooms in Sidebar
  renderRoomsList() {
    const container = document.getElementById('roomsListContainer');
    if (!container) return;

    container.innerHTML = '';
    this.allRooms.forEach(room => {
      const roomItem = document.createElement('div');
      roomItem.className = `room-item ${room.id === this.currentRoom ? 'active' : ''}`;
      roomItem.innerHTML = `
        <span class="room-icon">#</span>
        <div class="room-details">
          <div class="room-name">${room.name}</div>
          <div class="room-meta-desc">${room.desc || 'Sector'}</div>
        </div>
      `;

      roomItem.addEventListener('click', () => {
        if (room.id !== this.currentRoom) {
          window.nexusAudio.playClick();
          this.switchRoom(room.id);
        }
      });

      container.appendChild(roomItem);
    });
  }

  switchRoom(roomId) {
    if (window.nexusWebRTC.isCallActive) {
      const leaveCall = confirm('Anda sedang dalam panggilan. Berpindah sektor akan mengakhiri panggilan saat ini. Lanjutkan?');
      if (leaveCall) {
        window.nexusWebRTC.endCall(true);
      } else {
        return;
      }
    }
    this.socket.emit('room:switch', { newRoom: roomId });
  }

  // Render Users Roster in Sidebar
  renderUsersRoster() {
    const container = document.getElementById('agentsRosterContainer');
    const countBadge = document.getElementById('agentsOnlineCount');
    if (!container) return;

    container.innerHTML = '';
    if (countBadge) countBadge.textContent = this.usersInRoom.length;

    this.usersInRoom.forEach(user => {
      const isSelf = this.currentUser && user.id === this.currentUser.id;
      const agentItem = document.createElement('div');
      agentItem.className = 'agent-item';
      agentItem.innerHTML = `
        <img src="${user.avatar}" alt="avatar" class="agent-avatar" />
        <span class="agent-name">${user.username} ${isSelf ? '(YOU)' : ''}</span>
        ${user.inCall ? '<span class="agent-call-badge">LIVE CALL</span>' : ''}
      `;
      container.appendChild(agentItem);
    });
  }

  // Render Message History
  renderMessageHistory(history) {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;
    container.innerHTML = '';

    history.forEach(msg => {
      this.appendMessage(msg, false);
    });

    this.scrollToBottom();
  }

  // Append Single Message
  appendMessage(message, scroll = true) {
    const container = document.getElementById('chatMessagesContainer');
    if (!container) return;

    if (message.system) {
      const sysEl = document.createElement('div');
      sysEl.className = 'message-system';
      sysEl.innerHTML = `<span>⚡</span> <span>${this.escapeHTML(message.text)}</span>`;
      container.appendChild(sysEl);
      if (scroll) this.scrollToBottom();
      return;
    }

    const isOutgoing = this.currentUser && message.senderId === this.socket.id;
    const msgEl = document.createElement('div');
    msgEl.className = `message-bubble-wrapper ${isOutgoing ? 'outgoing' : ''}`;
    msgEl.id = `msg-${message.id}`;

    const timeStr = new Date(message.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    let attachmentHTML = '';
    if (message.attachment) {
      attachmentHTML = this.generateAttachmentHTML(message.attachment);
    }

    let reactionsHTML = this.generateReactionsHTML(message.id, message.reactions || {});

    msgEl.innerHTML = `
      <img src="${message.senderAvatar}" alt="avatar" class="message-avatar" />
      <div class="message-content-box">
        <div class="message-header-meta">
          <span class="message-sender">${this.escapeHTML(message.senderName)}</span>
          <span class="message-timestamp">${timeStr}</span>
        </div>
        <div class="message-card">
          ${message.text ? `<div class="message-text">${this.formatMessageText(message.text)}</div>` : ''}
          ${attachmentHTML}
          <div class="quick-reaction-picker">
            <button class="quick-reaction-btn" data-reaction="🔥">🔥</button>
            <button class="quick-reaction-btn" data-reaction="👍">👍</button>
            <button class="quick-reaction-btn" data-reaction="❤️">❤️</button>
            <button class="quick-reaction-btn" data-reaction="⚡">⚡</button>
            <button class="quick-reaction-btn" data-reaction="🚀">🚀</button>
          </div>
          <div class="corner-hud-bracket top-left"></div>
          <div class="corner-hud-bracket top-right"></div>
          <div class="corner-hud-bracket bottom-left"></div>
          <div class="corner-hud-bracket bottom-right"></div>
        </div>
        <div class="message-reactions-row" id="reactions-${message.id}">
          ${reactionsHTML}
        </div>
      </div>
    `;

    // Bind Quick Reaction clicks
    msgEl.querySelectorAll('.quick-reaction-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const reaction = btn.dataset.reaction;
        this.socket.emit('chat:react', { messageId: message.id, reaction });
      });
    });

    container.appendChild(msgEl);
    if (scroll) this.scrollToBottom();
  }

  // Generate HTML for different Attachment Media Types
  generateAttachmentHTML(att) {
    if (att.type === 'image') {
      return `
        <div class="message-attachment-container">
          <div class="attachment-image-card" onclick="window.nexusApp.openLightbox('${att.url}', 'image')">
            <img src="${att.url}" alt="${this.escapeHTML(att.originalName)}" loading="lazy" />
            <div class="attachment-hover-badge">EXPAND ⤢</div>
          </div>
        </div>
      `;
    } else if (att.type === 'video') {
      return `
        <div class="message-attachment-container">
          <div class="attachment-video-card">
            <video controls playsinline preload="metadata">
              <source src="${att.url}" type="${att.mimetype}">
              Browser Anda tidak mendukung pemutaran video.
            </video>
          </div>
        </div>
      `;
    } else if (att.type === 'audio') {
      return `
        <div class="message-attachment-container">
          <div class="attachment-audio-card">
            <audio controls preload="metadata">
              <source src="${att.url}" type="${att.mimetype}">
              Browser Anda tidak mendukung pemutaran audio.
            </audio>
          </div>
        </div>
      `;
    } else {
      return `
        <div class="message-attachment-container">
          <a href="${att.url}" target="_blank" download="${this.escapeHTML(att.originalName)}" class="attachment-file-card">
            <div class="file-type-icon">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
            </div>
            <div class="file-meta-col">
              <div class="file-title">${this.escapeHTML(att.originalName)}</div>
              <div class="file-size">${this.formatBytes(att.size)}</div>
            </div>
            <div class="btn-file-dl">
              <svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
            </div>
          </a>
        </div>
      `;
    }
  }

  // Reactions HTML generator
  generateReactionsHTML(messageId, reactions) {
    let html = '';
    for (const [reaction, users] of Object.entries(reactions)) {
      if (users.length > 0) {
        const isUserReacted = this.currentUser && users.includes(this.currentUser.username);
        html += `
          <span class="reaction-badge ${isUserReacted ? 'user-reacted' : ''}" 
                onclick="window.nexusApp.socket.emit('chat:react', { messageId: '${messageId}', reaction: '${reaction}' })"
                title="${users.join(', ')}">
            ${reaction} ${users.length}
          </span>
        `;
      }
    }
    return html;
  }

  updateReactionsUI(messageId, reactions) {
    const reactionsRow = document.getElementById(`reactions-${messageId}`);
    if (reactionsRow) {
      reactionsRow.innerHTML = this.generateReactionsHTML(messageId, reactions);
    }
  }

  openLightbox(url, type = 'image') {
    const lightbox = document.getElementById('nexusLightbox');
    const container = document.getElementById('lightboxMediaContainer');
    if (!lightbox || !container) return;

    if (type === 'image') {
      container.innerHTML = `<img src="${url}" alt="Fullscreen Media" />`;
    } else {
      container.innerHTML = `<video src="${url}" controls autoplay playsinline></video>`;
    }

    lightbox.classList.add('active');
  }

  updateProfileUI() {
    if (!this.currentUser) return;
    const callsign = document.getElementById('userCallsign');
    const avatar = document.getElementById('userAvatarImg');
    if (callsign) callsign.textContent = this.currentUser.username;
    if (avatar) avatar.src = this.currentUser.avatar;
  }

  updateSectorBar() {
    const sectorId = document.getElementById('currentSectorId');
    const sectorBadge = document.getElementById('headerSectorBadge');
    const activeRoomObj = this.allRooms.find(r => r.id === this.currentRoom);
    const roomTitle = activeRoomObj ? activeRoomObj.name : this.currentRoom;

    if (sectorId) sectorId.textContent = roomTitle.toUpperCase();
    if (sectorBadge) sectorBadge.textContent = roomTitle.toUpperCase();
  }

  scrollToBottom() {
    const container = document.getElementById('chatMessagesContainer');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  escapeHTML(str) {
    return (str || '').replace(/[&<>'"]/g, 
      tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
  }

  formatMessageText(text) {
    const safe = this.escapeHTML(text);
    // Convert links to clickable futuristic links
    return safe.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:var(--neon-cyan);text-decoration:underline;">$1</a>');
  }

  formatBytes(bytes) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }
}

// Instantiate and start app on page load
window.addEventListener('DOMContentLoaded', () => {
  window.nexusApp = new NexusApp();
  window.nexusApp.init();
});
