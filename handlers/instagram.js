/**
 * Instagram Session Resolution
 * Maps incoming Instagram Business Account ID to userId.
 */

const { getDb } = require('../lib/firebase');
const { COLLECTIONS } = require('../config/constants');
const { logger } = require('../utils/logger');

async function resolveUserId(normalized) {
  const db = getDb();

  const snap = await db
    .collection(COLLECTIONS.INSTAGRAM_SESSIONS)
    .where('instagramBusinessId', '==', normalized.to)
    .where('connected', '==', true)
    .limit(1)
    .get();

  if (snap.empty) {
    logger.warn('No Instagram session for instagramBusinessId', { igId: normalized.to });
    return null;
  }

  return snap.docs[0].data().userId;
}

module.exports = { resolveUserId };
