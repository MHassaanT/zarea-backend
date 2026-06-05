/**
 * Lead Qualification Logic
 * Pure JavaScript — zero API cost.
 */

const { logger } = require('../utils/logger');

function qualifyLead(totalMessages, intent) {
  const isSpecific = intent && intent.length > 10 &&
    !['greeting', 'hello', 'hi', 'unknown', 'none'].some((w) =>
      intent.toLowerCase().includes(w)
    );

  let isQualified = false;
  let priority = 'Low';

  if (totalMessages >= 3 && isSpecific) {
    isQualified = true;
    priority = 'High';
  } else if (totalMessages === 2 && isSpecific) {
    priority = 'Medium';
  }

  logger.info('Qualification result', { totalMessages, isQualified, priority, intent });
  return { isQualified, priority };
}

module.exports = { qualifyLead };
