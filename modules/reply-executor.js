/**
 * Reply Executor
 * Listens for replyPending messages and sends via the correct platform API.
 */

const { getDb } = require('../lib/firebase');
const { COLLECTIONS, META } = require('../config/constants');
const { logger } = require('../utils/logger');
const fetch = require('node-fetch');

const admin = require('firebase-admin');

let unsubscribe = null;

function startReplyExecutor() {
  const db = getDb();
  const q = db
    .collection(COLLECTIONS.RAW_MESSAGES)
    .where('replyPending', '==', true);

  logger.info('Reply Executor: Listening for pending replies');

  unsubscribe = q.onSnapshot(
    async (snapshot) => {
      const changes = snapshot.docChanges().filter(
        (c) => c.type === 'added' || c.type === 'modified'
      );

      for (const change of changes) {
        const doc = change.doc;
        const msg = doc.data();

        if (!msg.autoReplyText || !msg.from || !msg.userId) continue;

        try {
          switch (msg.platform) {
            case 'whatsapp':
              await sendWhatsAppReply(msg, doc.ref);
              break;
            case 'facebook':
              await sendFacebookReply(msg, doc.ref);
              break;
            case 'instagram':
              await sendInstagramReply(msg, doc.ref);
              break;
            default:
              logger.warn('Unknown platform for reply', { platform: msg.platform, docId: doc.id });
          }
        } catch (err) {
          logger.error('Reply send failed', { platform: msg.platform, docId: doc.id, error: err.message });
        }
      }
    },
    (error) => {
      logger.error('🔥 Reply Executor listener died', { error: error.message });
      setTimeout(() => {
        logger.info('Restarting Reply Executor...');
        startReplyExecutor();
      }, 5000);
    }
  );
}

async function sendWhatsAppReply(msg, docRef) {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.WHATSAPP_SESSIONS).doc(msg.userId).get();

  if (!snap.exists) {
    logger.warn('No WhatsApp session found', { userId: msg.userId });
    return;
  }

  const { accessToken, phoneNumberId } = snap.data();
  if (!accessToken || !phoneNumberId) {
    logger.warn('Incomplete WhatsApp session', { userId: msg.userId });
    return;
  }

  const url = `${META.GRAPH_BASE_URL}/${META.API_VERSION}/${phoneNumberId}/messages`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: msg.from,
      type: 'text',
      text: { body: msg.autoReplyText },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`WhatsApp send failed: ${res.status} ${err}`);
  }

  await docRef.update({
    replyPending: false,
    replySentAt: admin.firestore.Timestamp.now(),
  });

  logger.info('WhatsApp reply sent', { userId: msg.userId, to: msg.from.substring(0, 10) });
}

async function sendFacebookReply(msg, docRef) {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.FACEBOOK_SESSIONS).doc(msg.to).get();

  if (!snap.exists) {
    logger.warn('No Facebook session found', { pageId: msg.to, userId: msg.userId });
    return;
  }

  const { pageAccessToken } = snap.data();
  if (!pageAccessToken) {
    logger.warn('No Facebook page access token', { userId: msg.userId });
    return;
  }

  const url = `${META.GRAPH_BASE_URL}/${META.API_VERSION}/me/messages?access_token=${pageAccessToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: msg.from },
      message: { text: msg.autoReplyText },
    }),
  });

  const result = await res.json();
  if (result.error) throw new Error(result.error.message);

  await docRef.update({
    replyPending: false,
    replySentAt: admin.firestore.Timestamp.now(),
  });

  logger.info('Facebook reply sent', { userId: msg.userId, to: msg.from.substring(0, 10) });
}

async function sendInstagramReply(msg, docRef) {
  const db = getDb();
  const sessionId = msg.instagramBusinessId || msg.to;
  const snap = await db.collection(COLLECTIONS.INSTAGRAM_SESSIONS).doc(sessionId).get();

  if (!snap.exists) {
    logger.warn('No Instagram session found', { sessionId, userId: msg.userId });
    return;
  }

  const { pageAccessToken } = snap.data();
  if (!pageAccessToken) {
    logger.warn('No Instagram page access token', { sessionId });
    return;
  }

  const url = `${META.GRAPH_BASE_URL}/${META.API_VERSION}/me/messages?access_token=${pageAccessToken}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: msg.from },
      message: { text: msg.autoReplyText },
    }),
  });

  const result = await res.json();
  if (result.error) throw new Error(result.error.message);

  await docRef.update({
    replyPending: false,
    replySentAt: admin.firestore.Timestamp.now(),
  });

  logger.info('Instagram reply sent', { userId: msg.userId, to: msg.from.substring(0, 10) });
}

function stopReplyExecutor() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    logger.info('Reply Executor stopped');
  }
}

module.exports = { startReplyExecutor, stopReplyExecutor };
