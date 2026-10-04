/**
 * D-XPhone Signaling Server v2.0
 * Production-ready: Redis rooms, JWT auth, rate-limit, structured logging,
 * Socket.io Redis adapter (horizontal scale), TURN-ready ICE config helper.
 */
require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const Redis = require('ioredis');
const { createAdapter } = require('@socket.io/redis-adapter');

const logger = require('./src/logger');
const { issueToken, verifyToken, authMiddleware } = require('./src/auth');
const RoomManager = require('./src/rooms');

const PORT = process.env.PORT || 3001;
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '*').split(',').map(s => s.trim());

const app = express();
const server = http.createServer(app);

// ---------- Redis ----------
let redis = null;
let pubClient = null;
let subClient = null;

async function initRedis() {
  const url = process.env.REDIS_URL || 'redis://localhost:6379';
  try {
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        if (times > 5) return null;
        return Math.min(times * 200, 2000);
      },
      lazyConnect: true
    });
    await redis.connect();
    await redis.ping();
    logger.info('Redis connected', { url });

    pubClient = redis.duplicate();
    subClient = redis.duplicate();
    await Promise.all([pubClient.connect(), subClient.connect()]);
    return true;
  } catch (err) {
    logger.warn('Redis unavailable – falling back to in-memory rooms (NOT for production)', {
      error: err.message
    });
    redis = null;
    return false;
  }
}

// ---------- Express ----------
app.use(cors({
  origin: CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS,
  methods: ['GET', 'POST']
}));
app.use(express.json({ limit: '16kb' }));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' }
});
app.use(limiter);

app.get('/health', async (req, res) => {
  const redisOk = redis ? (await redis.ping().then(() => true).catch(() => false)) : false;
  res.json({
    status: 'ok',
    service: 'D-XPhone Signaling Server',
    version: '2.0.0',
    redis: redisOk ? 'connected' : 'fallback-memory',
    uptime: process.uptime()
  });
});

app.get('/', (req, res) => {
  res.json({
    name: 'D-XPhone Signaling Server',
    version: '2.0.0',
    features: ['JWT auth', 'Redis rooms', 'Rate limit', 'Redis adapter', 'TURN-ready']
  });
});

app.post('/token', (req, res) => {
  const { userId, roomId } = req.body || {};
  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  const token = issueToken({ userId, roomId: roomId || null });
  res.json({ token, expiresIn: process.env.JWT_EXPIRES_IN || '2h' });
});

// ---------- Socket.io ----------
const io = new Server(server, {
  cors: {
    origin: CORS_ORIGINS.includes('*') ? true : CORS_ORIGINS,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 30000,
  pingInterval: 15000
});

let roomManager;

async function start() {
  const hasRedis = await initRedis();
  roomManager = new RoomManager(redis);

  if (hasRedis && pubClient && subClient) {
    io.adapter(createAdapter(pubClient, subClient));
    logger.info('Socket.io Redis adapter enabled – ready for horizontal scaling');
  }

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    if (!token && process.env.NODE_ENV !== 'production') {
      socket.user = { userId: `anon-${socket.id.slice(0, 6)}`, purpose: 'dxphone-call' };
      return next();
    }
    const decoded = verifyToken(token);
    if (!decoded) {
      logger.warn('Socket auth failed', { id: socket.id });
      return next(new Error('Unauthorized'));
    }
    socket.user = decoded;
    next();
  });

  io.on('connection', (socket) => {
    logger.info('Client connected', { socketId: socket.id, userId: socket.user?.userId });

    socket.on('join-room', async ({ roomId, userId }) => {
      try {
        if (!roomId || typeof roomId !== 'string' || roomId.length > 64) {
          socket.emit('error', { message: 'Invalid roomId' });
          return;
        }

        const effectiveUserId = userId || socket.user?.userId || socket.id;
        socket.roomId = roomId;
        socket.userId = effectiveUserId;

        await socket.join(roomId);
        const clientsCount = await roomManager.addMember(roomId, socket.id, effectiveUserId);

        logger.info('Joined room', { roomId, socketId: socket.id, clientsCount });

        socket.to(roomId).emit('user-joined', {
          socketId: socket.id,
          userId: effectiveUserId,
          clientsCount
        });

        socket.emit('room-joined', {
          roomId,
          clientsCount,
          isInitiator: clientsCount === 1,
          selfSocketId: socket.id
        });
      } catch (err) {
        logger.error('join-room error', { error: err.message });
        socket.emit('error', { message: 'Failed to join room' });
      }
    });

    socket.on('offer', ({ roomId, offer, to }) => {
      if (!roomId || !offer) return;
      const payload = { offer, from: socket.id, userId: socket.userId };
      if (to) io.to(to).emit('offer', payload);
      else socket.to(roomId).emit('offer', payload);
    });

    socket.on('answer', ({ roomId, answer, to }) => {
      if (!roomId || !answer) return;
      const payload = { answer, from: socket.id, userId: socket.userId };
      if (to) io.to(to).emit('answer', payload);
      else socket.to(roomId).emit('answer', payload);
    });

    socket.on('ice-candidate', ({ roomId, candidate, to }) => {
      if (!candidate) return;
      const payload = { candidate, from: socket.id };
      if (to) io.to(to).emit('ice-candidate', payload);
      else if (roomId) socket.to(roomId).emit('ice-candidate', payload);
    });

    socket.on('toggle-media', ({ roomId, type, enabled }) => {
      if (!roomId) return;
      socket.to(roomId).emit('peer-media-toggle', {
        from: socket.id,
        type,
        enabled
      });
    });

    socket.on('leave-room', async ({ roomId }) => {
      await handleLeave(socket, roomId || socket.roomId);
    });

    socket.on('disconnect', async (reason) => {
      logger.info('Client disconnected', { socketId: socket.id, reason });
      if (socket.roomId) {
        await handleLeave(socket, socket.roomId);
      }
    });
  });

  async function handleLeave(socket, roomId) {
    if (!roomId) return;
    try {
      await socket.leave(roomId);
      const remaining = await roomManager.removeMember(roomId, socket.id);
      socket.to(roomId).emit('user-left', {
        socketId: socket.id,
        userId: socket.userId,
        remaining
      });
      logger.info('Left room', { roomId, socketId: socket.id, remaining });
    } catch (err) {
      logger.error('leave error', { error: err.message });
    }
  }

  server.listen(PORT, () => {
    logger.info(`D-XPhone Signaling Server v2.0 running on port ${PORT}`);
    logger.info(`Health: http://localhost:${PORT}/health`);
  });
}

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});

process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down');
  server.close(() => process.exit(0));
});
