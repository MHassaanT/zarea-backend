/**
 * Meta Webhook HMAC-SHA256 Verification
 * Prevents spoofed webhook payloads.
 */

const crypto = require('crypto');
const { logger } = require('../utils/logger');

function rawBodySaver(req, res, buf, encoding) {
  if (buf && buf.length) {
    req.rawBody = buf.toString(encoding || 'utf8');
  }
}

function verifyMetaSignature(req, res, next) {
  const signature = req.headers['x-hub-signature-256'];
  const appSecret = process.env.META_APP_SECRET;

  if (!signature || !appSecret) {
    logger.error('Missing webhook signature configuration');
    return res.status(401).json({ error: 'Missing signature configuration' });
  }

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(req.rawBody, 'utf8')
    .digest('hex');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);

    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      logger.warn('Invalid webhook signature', { ip: req.ip });
      return res.status(403).json({ error: 'Invalid signature' });
    }

    next();
  } catch (e) {
    logger.error('Signature verification error', { error: e.message });
    return res.status(403).json({ error: 'Signature verification failed' });
  }
}

module.exports = { rawBodySaver, verifyMetaSignature };
