/**
 * Atomic Message Save with Bundling
 * Uses Firestore transactions to prevent race conditions.
 */

const { getDb } = require('../lib/firebase');
const { COLLECTIONS, AI } = require('../config/constants');
const { logger } = require('../utils/logger');

const admin = require('firebase-admin');

async function saveMessage(normalized, userId) {
  const db = getDb();
  const rawRef = db.collection(COLLECTIONS.RAW_MESSAGES);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const query = rawRef
        .where('userId', '==', userId)
        .where('from', '==', normalized.from)
        .where('platform', '==', normalized.platform)
        .orderBy('timestamp', 'desc')
        .limit(1);

      const snap = await transaction.get(query);

      if (!snap.empty) {
        const recentDoc = snap.docs[0];
        const recentData = recentDoc.data();
        const now = Date.now();
        const docTime = recentData.timestamp.toMillis();

        if (recentData.processed === false && now - docTime < AI.BUNDLE_WINDOW_MS) {
          const newBody = (recentData.body || '') + '\n' + (normalized.body || '');
          transaction.update(recentDoc.ref, {
            body: newBody,
            timestamp: admin.firestore.Timestamp.now(),
          });
          return { action: 'bundled', id: recentDoc.id };
        }
      }

      const newDocRef = rawRef.doc();
      transaction.set(newDocRef, {
        timestamp: admin.firestore.Timestamp.now(),
        userId,
        phoneNumber: normalized.from,
        from: normalized.from,
        to: normalized.to,
        type: 'chat',
        body: normalized.body || null,
        isGroup: false,
        platform: normalized.platform,
        wwebId: normalized.messageId,
        processed: false,
        isLead: null,
        replyPending: false,
        autoReplyText: null,
        senderName: normalized.senderName,
      });

      return { action: 'created', id: newDocRef.id };
    });

    logger.info(`Message ${result.action}`, {
      id: result.id.substring(0, 8),
      userId,
      platform: normalized.platform,
    });

    return result;
  } catch (error) {
    logger.error('Message save transaction failed', { userId, error: error.message });
    throw error;
  }
}

module.exports = { saveMessage };
