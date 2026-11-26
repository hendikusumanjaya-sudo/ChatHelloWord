const express = require('express');
const http = require('http');
const https = require('https');
const path = require('path');
const fs = require('fs');
const { Server } = require('socket.io');
const multer = require('multer');
const cors = require('cors');

const app = express();

const PORT = process.env.PORT || 3000;

// Check SSL certificates for Secure Context (HTTPS)
const sslKeyPath = path.join(__dirname, 'ssl', 'key.pem');
const sslCertPath = path.join(__dirname, 'ssl', 'cert.pem');
const hasSSL = fs.existsSync(sslKeyPath) && fs.existsSync(sslCertPath);
const useHttps = process.env.USE_HTTPS === 'true' || (process.env.USE_HTTPS !== 'false' && hasSSL);

let server;
let protocol = 'http';

if (useHttps && hasSSL) {
  try {
    const sslOptions = {
      key: fs.readFileSync(sslKeyPath),
      cert: fs.readFileSync(sslCertPath)
    };
    server = https.createServer(sslOptions, app);
    protocol = 'https';
    console.log('🔒 SSL Certificates loaded. Running in HTTPS Secure Context.');
  } catch (err) {
    console.warn('⚠️ Gagal membaca SSL cert, kembali ke HTTP:', err.message);
    server = http.createServer(app);
    protocol = 'http';
  }
} else {
  server = http.createServer(app);
  protocol = 'http';
}

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  },
  maxHttpBufferSize: 50 * 1024 * 1024 // 50MB
});

// Ensure upload directory exists
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Configure Multer for File/Image/Video Uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
    cb(null, `${baseName}-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 100 * 1024 * 1024 } // 100 MB max limit
});

// Helper to determine media classification
function getMediaCategory(mimetype, originalname) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  
  const ext = path.extname(originalname).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp'].includes(ext)) return 'image';
  if (['.mp4', '.webm', '.ogg', '.mov', '.avi', '.mkv'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.ogg', '.m4a', '.aac', '.flac'].includes(ext)) return 'audio';
  return 'file';
}

// Upload API Endpoint
app.post('/api/upload', upload.single('mediaFile'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: 'Tidak ada file yang diunggah.' });
  }

  const mediaType = getMediaCategory(req.file.mimetype, req.file.originalname);
  const fileUrl = `/uploads/${req.file.filename}`;

  res.json({
    success: true,
    file: {
      url: fileUrl,
      filename: req.file.filename,
      originalName: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      type: mediaType
    }
  });
});

// In-memory application state
const connectedUsers = new Map(); // socket.id -> { id, username, avatar, room, inCall: false }
const roomMessages = new Map(); // roomName -> array of messages (last 100)
const activeCalls = new Map(); // roomName -> Set of socketIds in call

const DEFAULT_ROOMS = [
  { id: 'general-nexus', name: 'General Nexus', desc: 'Saluran komunikasi utama multi-sektor', icon: 'zap' },
  { id: 'cyber-lounge', name: 'Cyber Lounge', desc: 'Ruang santai & diskusi informal', icon: 'coffee' },
  { id: 'tech-core', name: 'Tech Core', desc: 'Pengembangan teknologi & arsitektur sistem', icon: 'cpu' },
  { id: 'command-center', name: 'Command Center', desc: 'Koordinasi operasi strategis', icon: 'shield' }
];

let availableRooms = [...DEFAULT_ROOMS];

// Helper to get users in a room
function getUsersInRoom(room) {
  const users = [];
  for (const [id, user] of connectedUsers.entries()) {
    if (user.room === room) {
      users.push({
        id: user.id,
        username: user.username,
        avatar: user.avatar,
        inCall: user.inCall || false
      });
    }
  }
  return users;
}

// Socket.io Real-time Communication
io.on('connection', (socket) => {
  console.log(`[Socket Connected] ID: ${socket.id}`);

  // User Join Event
  socket.on('user:join', ({ username, avatar, room }) => {
    const assignedRoom = room || 'general-nexus';
    const userProfile = {
      id: socket.id,
      username: username || `CyberAgent_${socket.id.slice(0, 4)}`,
      avatar: avatar || `https://api.dicebear.com/7.x/bottts/svg?seed=${socket.id}`,
      room: assignedRoom,
      inCall: false
    };

    connectedUsers.set(socket.id, userProfile);
    socket.join(assignedRoom);

    console.log(`[User Joined] ${userProfile.username} entered ${assignedRoom}`);

    // Send initial data to the joined user
    socket.emit('init:data', {
      user: userProfile,
      rooms: availableRooms,
      history: roomMessages.get(assignedRoom) || [],
      usersInRoom: getUsersInRoom(assignedRoom)
    });

    // Notify others in room
    socket.to(assignedRoom).emit('user:joined', {
      user: userProfile,
      usersInRoom: getUsersInRoom(assignedRoom)
    });

    // Send system message
    const joinMessage = {
      id: 'sys_' + Date.now(),
      system: true,
      text: `${userProfile.username} telah terkoneksi ke jaringan nexus.`,
      timestamp: new Date().toISOString()
    };
    io.to(assignedRoom).emit('chat:message', joinMessage);
  });

  // Switch Room Event
  socket.on('room:switch', ({ newRoom }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const oldRoom = user.room;
    socket.leave(oldRoom);
    
    // Clean up call status if leaving
    if (user.inCall) {
      user.inCall = false;
      const callPeers = activeCalls.get(oldRoom);
      if (callPeers) {
        callPeers.delete(socket.id);
        socket.to(oldRoom).emit('call:peer-left', { peerId: socket.id });
      }
    }

    // Notify old room
    socket.to(oldRoom).emit('user:left', {
      userId: socket.id,
      username: user.username,
      usersInRoom: getUsersInRoom(oldRoom)
    });

    // Join new room
    user.room = newRoom;
    socket.join(newRoom);

    // Make sure room is in availableRooms if custom
    if (!availableRooms.some(r => r.id === newRoom)) {
      availableRooms.push({
        id: newRoom,
        name: newRoom.replace(/-/g, ' ').toUpperCase(),
        desc: 'Custom Transmission Sector',
        icon: 'hash'
      });
      io.emit('rooms:updated', availableRooms);
    }

    // Send new room data to user
    socket.emit('room:switched', {
      room: newRoom,
      history: roomMessages.get(newRoom) || [],
      usersInRoom: getUsersInRoom(newRoom)
    });

    // Notify new room
    socket.to(newRoom).emit('user:joined', {
      user: user,
      usersInRoom: getUsersInRoom(newRoom)
    });

    // Send system message to new room
    const switchMsg = {
      id: 'sys_' + Date.now(),
      system: true,
      text: `${user.username} bergabung ke sektor ${newRoom}.`,
      timestamp: new Date().toISOString()
    };
    io.to(newRoom).emit('chat:message', switchMsg);
  });

  // Create Room Event
  socket.on('room:create', ({ roomId, roomName, roomDesc }) => {
    const cleanId = (roomId || roomName).toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!availableRooms.some(r => r.id === cleanId)) {
      const newRoomObj = {
        id: cleanId,
        name: roomName || cleanId,
        desc: roomDesc || 'Custom Sector',
        icon: 'radio'
      };
      availableRooms.push(newRoomObj);
      io.emit('rooms:updated', availableRooms);
      socket.emit('room:created', { room: newRoomObj });
    }
  });

  // Chat Message Event
  socket.on('chat:send', (messageData) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const message = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
      senderId: socket.id,
      senderName: user.username,
      senderAvatar: user.avatar,
      room: user.room,
      text: messageData.text || '',
      attachment: messageData.attachment || null, // { url, filename, originalName, size, mimetype, type }
      timestamp: new Date().toISOString(),
      reactions: {}
    };

    if (!roomMessages.has(user.room)) {
      roomMessages.set(user.room, []);
    }
    const history = roomMessages.get(user.room);
    history.push(message);
    if (history.length > 150) history.shift();

    io.to(user.room).emit('chat:message', message);
  });

  // Typing Indicator
  socket.on('chat:typing', ({ isTyping }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    socket.to(user.room).emit('chat:user-typing', {
      userId: socket.id,
      username: user.username,
      isTyping
    });
  });

  // Message Reaction
  socket.on('chat:react', ({ messageId, reaction }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    const history = roomMessages.get(user.room) || [];
    const msg = history.find(m => m.id === messageId);
    if (msg) {
      if (!msg.reactions[reaction]) {
        msg.reactions[reaction] = [];
      }
      const idx = msg.reactions[reaction].indexOf(user.username);
      if (idx > -1) {
        msg.reactions[reaction].splice(idx, 1);
        if (msg.reactions[reaction].length === 0) delete msg.reactions[reaction];
      } else {
        msg.reactions[reaction].push(user.username);
      }
      io.to(user.room).emit('chat:reaction-updated', {
        messageId,
        reactions: msg.reactions
      });
    }
  });

  // ==========================================
  // WEBRTC VOICE & VIDEO CALL SIGNALING
  // ==========================================
  
  // User initiates or joins a call in their room
  socket.on('call:join', ({ callType }) => { // callType: 'voice' | 'video'
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    user.inCall = true;
    const room = user.room;

    if (!activeCalls.has(room)) {
      activeCalls.set(room, new Set());
    }
    const callPeers = activeCalls.get(room);

    // Get all existing participants in this call
    const existingPeers = Array.from(callPeers).map(peerId => {
      const peerUser = connectedUsers.get(peerId);
      return {
        peerId,
        username: peerUser ? peerUser.username : 'Unknown',
        avatar: peerUser ? peerUser.avatar : ''
      };
    });

    // Add current user to active call
    callPeers.add(socket.id);

    // Send the list of existing peers to the newly joined peer
    socket.emit('call:all-peers', {
      peers: existingPeers,
      callType: callType || 'video'
    });

    // Notify room that user started/joined call
    io.to(room).emit('call:status-update', {
      room,
      callPeers: Array.from(callPeers),
      usersInRoom: getUsersInRoom(room)
    });

    console.log(`[Call Join] ${user.username} joined ${callType} call in ${room}. Peers count: ${callPeers.size}`);
  });

  // WebRTC Signaling: Relay Offer to specific peer
  socket.on('call:signal-offer', ({ targetPeerId, offer, callType }) => {
    const user = connectedUsers.get(socket.id);
    socket.to(targetPeerId).emit('call:incoming-offer', {
      fromPeerId: socket.id,
      callerName: user ? user.username : 'CyberAgent',
      callerAvatar: user ? user.avatar : '',
      offer,
      callType
    });
  });

  // WebRTC Signaling: Relay Answer back to caller peer
  socket.on('call:signal-answer', ({ targetPeerId, answer }) => {
    socket.to(targetPeerId).emit('call:incoming-answer', {
      fromPeerId: socket.id,
      answer
    });
  });

  // WebRTC Signaling: ICE Candidate exchange
  socket.on('call:signal-candidate', ({ targetPeerId, candidate }) => {
    socket.to(targetPeerId).emit('call:incoming-candidate', {
      fromPeerId: socket.id,
      candidate
    });
  });

  // WebRTC Media Status (Mic/Cam toggle, Screen sharing)
  socket.on('call:media-toggle', ({ isAudioMuted, isVideoOff, isScreenSharing }) => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;
    socket.to(user.room).emit('call:peer-media-toggle', {
      peerId: socket.id,
      isAudioMuted,
      isVideoOff,
      isScreenSharing
    });
  });

  // WebRTC Call Leave
  socket.on('call:leave', () => {
    const user = connectedUsers.get(socket.id);
    if (!user) return;

    user.inCall = false;
    const room = user.room;
    const callPeers = activeCalls.get(room);

    if (callPeers) {
      callPeers.delete(socket.id);
      if (callPeers.size === 0) {
        activeCalls.delete(room);
      }
    }

    socket.to(room).emit('call:peer-left', { peerId: socket.id });
    io.to(room).emit('call:status-update', {
      room,
      callPeers: callPeers ? Array.from(callPeers) : [],
      usersInRoom: getUsersInRoom(room)
    });

    console.log(`[Call Leave] ${user.username} left call in ${room}`);
  });

  // Disconnection handler
  socket.on('disconnect', () => {
    const user = connectedUsers.get(socket.id);
    if (user) {
      const room = user.room;

      // Clean up call
      const callPeers = activeCalls.get(room);
      if (callPeers && callPeers.has(socket.id)) {
        callPeers.delete(socket.id);
        socket.to(room).emit('call:peer-left', { peerId: socket.id });
      }

      connectedUsers.delete(socket.id);

      socket.to(room).emit('user:left', {
        userId: socket.id,
        username: user.username,
        usersInRoom: getUsersInRoom(room)
      });

      // System notification
      const leaveMsg = {
        id: 'sys_' + Date.now(),
        system: true,
        text: `${user.username} terputus dari jaringan.`,
        timestamp: new Date().toISOString()
      };
      io.to(room).emit('chat:message', leaveMsg);

      io.to(room).emit('call:status-update', {
        room,
        callPeers: callPeers ? Array.from(callPeers) : [],
        usersInRoom: getUsersInRoom(room)
      });
    }
    console.log(`[Socket Disconnected] ID: ${socket.id}`);
  });
});

server.listen(PORT, () => {
  console.log(`===============================================`);
  console.log(`⚡ NEXUS FUTURISTIC CHAT SERVER IS OPERATIONAL`);
  console.log(`📡 PROTOCOL: ${protocol.toUpperCase()}`);
  console.log(`📡 URL: ${protocol}://localhost:${PORT}`);
  console.log(`🚀 Audio & Video WebRTC Mesh Ready`);
  console.log(`💾 File, Image & Video Uploads Ready`);
  if (protocol === 'https') {
    console.log(`🔒 HTTPS aktif: Secure Context terpenuhi untuk akses IP publik!`);
  } else {
    console.log(`ℹ️ HTTP aktif: Untuk WebRTC via IP tanpa HTTPS, aktifkan flag Chrome:`);
    console.log(`   chrome://flags/#unsafely-treat-insecure-origin-as-secure`);
  }
  console.log(`===============================================`);
});
