/**
 * WhatsApp Session Resolution
 * Maps incoming phone_number_id to userId.
 */

const { getDb } = require('../lib/firebase');
const { COLLECTIONS } = require('../config/constants');
const { logger } = require('../utils/logger');

async function resolveUserId(normalized) {
  const db = getDb();

  const snap = await db
    .collection(COLLECTIONS.WHATSAPP_SESSIONS)
    .where('phoneNumberId', '==', normalized.to)
    .where('connected', '==', true)
    .limit(1)
    .get();

  if (snap.empty) {
    logger.warn('No WhatsApp session for phoneNumberId', { phoneNumberId: normalized.to });
    return null;
  }

  return snap.docs[0].data().userId;
}

module.exports = { resolveUserId };
