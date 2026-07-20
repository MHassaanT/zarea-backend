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
  const waAppSecret = process.env.META_WA_APP_SECRET;

  if (!signature) {
    logger.error('Missing webhook signature');
    return res.status(401).json({ error: 'Missing signature' });
  }

  if (!appSecret && !waAppSecret) {
    logger.error('Missing webhook signature configuration');
    return res.status(500).json({ error: 'Missing signature configuration' });
  }

  const rawBody = req.body;

  let isValid = false;

  // Check against Facebook App Secret
  if (appSecret) {
    const expectedFb = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBufFb = Buffer.from(expectedFb);
    if (sigBuf.length === expBufFb.length && crypto.timingSafeEqual(sigBuf, expBufFb)) {
      isValid = true;
    }
  }

  // Check against WhatsApp App Secret
  if (!isValid && waAppSecret) {
    const expectedWa = 'sha256=' + crypto.createHmac('sha256', waAppSecret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBufWa = Buffer.from(expectedWa);
    if (sigBuf.length === expBufWa.length && crypto.timingSafeEqual(sigBuf, expBufWa)) {
      isValid = true;
    }
  }

  if (!isValid) {
    logger.warn('Invalid webhook signature', { ip: req.ip });
    return res.status(403).json({ error: 'Invalid signature' });
  }

  next();
}

module.exports = { rawBodySaver, verifyMetaSignature };
