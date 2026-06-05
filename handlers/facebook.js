/**
 * Facebook Session Resolution
 * Maps incoming page ID to userId.
 */

const { getDb } = require('../lib/firebase');
const { COLLECTIONS } = require('../config/constants');
const { logger } = require('../utils/logger');

async function resolveUserId(normalized) {
  const db = getDb();

  const snap = await db
    .collection(COLLECTIONS.FACEBOOK_SESSIONS)
    .where('pageId', '==', normalized.to)
    .where('connected', '==', true)
    .limit(1)
    .get();

  if (snap.empty) {
    logger.warn('No Facebook session for pageId', { pageId: normalized.to });
    return null;
  }

  return snap.docs[0].data().userId;
}

module.exports = { resolveUserId };
