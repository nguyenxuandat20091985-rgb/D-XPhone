/**
 * Redis-backed room management.
 * Falls back to in-memory Map if Redis is unavailable (dev mode).
 */
const logger = require('./logger');

class RoomManager {
  constructor(redis) {
    this.redis = redis;
    this.memory = new Map(); // fallback
    this.useRedis = !!redis;
    this.ttl = parseInt(process.env.ROOM_TTL_SECONDS || '3600', 10);
  }

  _key(roomId) {
    return `dxphone:room:${roomId}`;
  }

  async addMember(roomId, socketId, userId) {
    if (this.useRedis) {
      const key = this._key(roomId);
      await this.redis.hset(key, socketId, JSON.stringify({ userId, joinedAt: Date.now() }));
      await this.redis.expire(key, this.ttl);
      const count = await this.redis.hlen(key);
      return count;
    }
    if (!this.memory.has(roomId)) this.memory.set(roomId, new Map());
    this.memory.get(roomId).set(socketId, { userId, joinedAt: Date.now() });
    return this.memory.get(roomId).size;
  }

  async removeMember(roomId, socketId) {
    if (this.useRedis) {
      const key = this._key(roomId);
      await this.redis.hdel(key, socketId);
      const count = await this.redis.hlen(key);
      if (count === 0) await this.redis.del(key);
      return count;
    }
    if (!this.memory.has(roomId)) return 0;
    this.memory.get(roomId).delete(socketId);
    const count = this.memory.get(roomId).size;
    if (count === 0) this.memory.delete(roomId);
    return count;
  }

  async getMembers(roomId) {
    if (this.useRedis) {
      const data = await this.redis.hgetall(this._key(roomId));
      return Object.entries(data).map(([socketId, raw]) => {
        const parsed = JSON.parse(raw);
        return { socketId, ...parsed };
      });
    }
    if (!this.memory.has(roomId)) return [];
    return Array.from(this.memory.get(roomId).entries()).map(([socketId, info]) => ({
      socketId,
      ...info
    }));
  }

  async getCount(roomId) {
    if (this.useRedis) {
      return await this.redis.hlen(this._key(roomId));
    }
    return this.memory.has(roomId) ? this.memory.get(roomId).size : 0;
  }
}

module.exports = RoomManager;
