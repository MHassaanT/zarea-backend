/**
 * ZareaAI — Unified Backend
 * Single service for WhatsApp, Facebook, Instagram webhooks + AI processing + replies.
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');

const { initializeFirebase } = require('./lib/firebase');
const { verifyFirebaseToken } = require('./middleware/auth');
const { rawBodySaver, verifyMetaSignature } = require('./middleware/meta-verify');
const { webhookLimiter, apiLimiter } = require('./middleware/rate-limit');

const { normalizePayload } = require('./handlers/webhook');
const { saveMessage } = require('./handlers/save-message');
const whatsappResolver = require('./handlers/whatsapp');
const facebookResolver = require('./handlers/facebook');
const instagramResolver = require('./handlers/instagram');
const apiRoutes = require('./handlers/api-routes');
const oauthRoutes = require('./handlers/oauth-routes');

const { startAiProcessor, stopAiProcessor } = require('./modules/ai-processor');
const { startReplyExecutor, stopReplyExecutor } = require('./modules/reply-executor');
const { logger } = require('./utils/logger');

const PORT = process.env.PORT || 4000;
const app = express();
app.use(cors());

// ─── 1. Meta Webhook Verification (GET) ───
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    logger.info('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

// ─── 2. Meta Webhook Receiver (POST) ───
app.post('/webhook',
  webhookLimiter,
  express.raw({ type: 'application/json' }),
  verifyMetaSignature,
  async (req, res) => {
    res.status(200).send('EVENT_RECEIVED');

    try {
      const payload = JSON.parse(req.body);
      const normalized = normalizePayload(payload);

      if (!normalized) {
        logger.debug('Webhook payload normalized to null — ignored');
        return;
      }

      let userId = null;
      switch (normalized.platform) {
        case 'whatsapp':
          userId = await whatsappResolver.resolveUserId(normalized);
          break;
        case 'facebook':
          userId = await facebookResolver.resolveUserId(normalized);
          break;
        case 'instagram':
          userId = await instagramResolver.resolveUserId(normalized);
          break;
      }

      if (!userId) {
        logger.warn('No session found for incoming message', {
          platform: normalized.platform,
          to: normalized.to,
        });
        return;
      }

      await saveMessage(normalized, userId);
    } catch (err) {
      logger.error('Webhook processing error', { error: err.message });
    }
  }
);

// ─── 3. JSON parsing for all other routes ───
app.use(express.json());

app.get('/health', (req, res) => {
    return res.status(200).send('OK');
});

// ─── 4. Firebase Auth for API routes ───
app.use(verifyFirebaseToken);

// ─── 5. Rate limiting for API routes ───
app.use('/api', apiLimiter);

// ─── 6. API Routes ───
app.use('/api', apiRoutes);
app.use('/api/oauth', oauthRoutes);

// ─── 7. Root health ───
app.get('/', (req, res) => {
  res.json({
    status: 'running',
    service: 'zarea-backend',
    version: '2.0.0',
    platforms: ['whatsapp', 'facebook', 'instagram'],
    timestamp: new Date().toISOString(),
  });
});

app.get('/health', (req, res) => {
    return res.status(200).send('OK');
});

// ─── 8. Graceful shutdown ───
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received — shutting down gracefully');
  stopAiProcessor();
  stopReplyExecutor();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received — shutting down gracefully');
  stopAiProcessor();
  stopReplyExecutor();
  process.exit(0);
});

// ─── 9. Bootstrap ───
(async () => {
  try {
    await initializeFirebase();
    startAiProcessor();
    startReplyExecutor();

    app.listen(PORT, () => {
      logger.info(`🌍 ZareaAI Unified Backend running on port ${PORT}`);
    });
  } catch (err) {
    logger.error('Fatal bootstrap error', { error: err.message });
    process.exit(1);
  }
})();
