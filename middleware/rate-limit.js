/**
 * Express Rate Limiters
 * Protects against abuse and runaway costs.
 */

const rateLimit = require('express-rate-limit');
const { logger } = require('../utils/logger');

const webhookLimiter = rateLimit({
  windowMs: parseInt(process.env.WEBHOOK_RATE_LIMIT_WINDOW_MS, 10) || 60000,
  max: parseInt(process.env.WEBHOOK_RATE_LIMIT_MAX, 10) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('Webhook rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Too many webhook requests' });
  },
});

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.API_RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
  max: parseInt(process.env.API_RATE_LIMIT_MAX, 10) || 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => {
    logger.warn('API rate limit exceeded', { ip: req.ip });
    res.status(429).json({ error: 'Too many API requests' });
  },
});

module.exports = { webhookLimiter, apiLimiter };
