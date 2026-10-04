/**
 * D-XPhone Signaling Server
 * Node.js + Express + Socket.io
 * Handles WebRTC signaling: offer, answer, ice-candidate, join/leave room
 * Designed as an independent modular service
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// CORS configuration - allow frontend origins (adjust in production)
const io = new Server(server, {
  cors: {
    origin: '*', // In production: restrict to your frontend domain(s)
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'D-XPhone Signaling Server', version: '1.0.0' });
});

// Simple API info
app.get('/', (req, res) => {
  res.json({
    name: 'D-XPhone Signaling Server',
    description: 'WebRTC Signaling Service for 1-1 Audio/Video Calls',
    endpoints: {
      health: '/health',
      socket: 'Connect via Socket.io'
    }
  });
});

// In-memory room management (for production use Redis or database)
const rooms = new Map(); // roomId -> Set of socketIds

io.on('connection', (socket) => {
  console.log(`[+] Client connected: ${socket.id}`);

  // Join a call room (1-1)
  socket.on('join-room', ({ roomId, userId }) => {
    if (!roomId) {
      socket.emit('error', { message: 'roomId is required' });
      return;
    }

    socket.join(roomId);
    socket.roomId = roomId;
    socket.userId = userId || socket.id;

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Set());
    }
    rooms.get(roomId).add(socket.id);

    const clientsInRoom = rooms.get(roomId).size;
    console.log(`[Room ${roomId}] ${socket.id} joined. Clients: ${clientsInRoom}`);

    // Notify others in the room that a new peer joined
    socket.to(roomId).emit('user-joined', {
      socketId: socket.id,
      userId: socket.userId,
      clientsCount: clientsInRoom
    });

    // Tell the joiner how many people are already in the room
    socket.emit('room-joined', {
      roomId,
      clientsCount: clientsInRoom,
      isInitiator: clientsInRoom === 1
    });
  });

  // Relay WebRTC Offer
  socket.on('offer', ({ roomId, offer, to }) => {
    console.log(`[Offer] from ${socket.id} to room ${roomId}`);
    if (to) {
      // Direct to specific peer
      io.to(to).emit('offer', {
        offer,
        from: socket.id,
        userId: socket.userId
      });
    } else {
      // Broadcast to room (except sender)
      socket.to(roomId).emit('offer', {
        offer,
        from: socket.id,
        userId: socket.userId
      });
    }
  });

  // Relay WebRTC Answer
  socket.on('answer', ({ roomId, answer, to }) => {
    console.log(`[Answer] from ${socket.id} to room ${roomId}`);
    if (to) {
      io.to(to).emit('answer', {
        answer,
        from: socket.id,
        userId: socket.userId
      });
    } else {
      socket.to(roomId).emit('answer', {
        answer,
        from: socket.id,
        userId: socket.userId
      });
    }
  });

  // Relay ICE Candidate
  socket.on('ice-candidate', ({ roomId, candidate, to }) => {
    if (to) {
      io.to(to).emit('ice-candidate', {
        candidate,
        from: socket.id
      });
    } else {
      socket.to(roomId).emit('ice-candidate', {
        candidate,
        from: socket.id
      });
    }
  });

  // Hang up / leave call
  socket.on('leave-room', ({ roomId }) => {
    handleLeave(socket, roomId);
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log(`[-] Client disconnected: ${socket.id}`);
    if (socket.roomId) {
      handleLeave(socket, socket.roomId);
    }
  });

  // Optional: mute status exchange (for UI sync)
  socket.on('toggle-media', ({ roomId, type, enabled }) => {
    // type: 'audio' | 'video'
    socket.to(roomId).emit('peer-media-toggle', {
      from: socket.id,
      type,
      enabled
    });
  });
});

function handleLeave(socket, roomId) {
  if (!roomId) return;

  socket.leave(roomId);

  if (rooms.has(roomId)) {
    rooms.get(roomId).delete(socket.id);
    if (rooms.get(roomId).size === 0) {
      rooms.delete(roomId);
    }
  }

  // Notify remaining peers
  socket.to(roomId).emit('user-left', {
    socketId: socket.id,
    userId: socket.userId
  });

  console.log(`[Room ${roomId}] ${socket.id} left`);
}

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`  D-XPhone Signaling Server running`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Health: http://localhost:${PORT}/health`);
  console.log(`========================================`);
});
