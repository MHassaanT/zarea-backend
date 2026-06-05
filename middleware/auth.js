/**
 * Firebase Auth Middleware
 * Verifies Bearer tokens and enforces userId ownership.
 */

const { getAuth } = require('../lib/firebase');
const { logger } = require('../utils/logger');

async function verifyFirebaseToken(req, res, next) {
  // Skip auth for Meta webhooks (they use HMAC)
  if (req.path === '/webhook' && req.method === 'POST') {
    return next();
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.split('Bearer ')[1] : null;

  if (!token) {
    return res.status(401).json({ error: 'Missing Firebase ID token' });
  }

  try {
    const decoded = await getAuth().verifyIdToken(token);
    req.firebaseUser = decoded;

    const requestedUserId = req.body?.userId || req.query?.userId || req.params?.userId;
    if (requestedUserId && requestedUserId !== decoded.uid) {
      logger.warn('User ID mismatch', { requestedUserId, uid: decoded.uid });
      return res.status(403).json({ error: 'User ID mismatch' });
    }

    next();
  } catch (err) {
    logger.warn('Auth verification failed', { error: err.message });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = { verifyFirebaseToken };
