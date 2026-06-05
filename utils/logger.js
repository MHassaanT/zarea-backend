/**
 * Structured Logger with PII Redaction
 * Replaces console.log for production safety.
 */

const winston = require('winston');

const SENSITIVE_KEYS = [
  'pageAccessToken',
  'access_token',
  'accessToken',
  'qr',
  'phoneNumber',
  'email',
  'token',
  'authorization',
  'apiKey',
  'client_secret',
];

function sanitize(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const clone = JSON.parse(JSON.stringify(obj));

  function redact(target) {
    for (const key of Object.keys(target)) {
      if (SENSITIVE_KEYS.includes(key.toLowerCase())) {
        target[key] = '[REDACTED]';
      } else if (typeof target[key] === 'object' && target[key] !== null) {
        redact(target[key]);
      }
    }
  }

  redact(clone);
  return clone;
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

const originalLog = logger.log.bind(logger);
logger.log = (level, message, meta) => {
  if (meta && typeof meta === 'object') {
    meta = sanitize(meta);
  }
  return originalLog(level, message, meta);
};

module.exports = { logger, sanitize };
