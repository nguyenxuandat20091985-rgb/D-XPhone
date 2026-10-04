const jwt = require('jsonwebtoken');
const logger = require('./logger');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me-in-production-32chars';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '2h';

function issueToken(payload = {}) {
  return jwt.sign(
    {
      ...payload,
      purpose: 'dxphone-call'
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    logger.warn('JWT verify failed', { error: err.message });
    return null;
  }
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  req.user = decoded;
  next();
}

module.exports = { issueToken, verifyToken, authMiddleware };
