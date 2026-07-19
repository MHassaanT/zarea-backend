/**
 * AI Processor
 * Listens for unprocessed messages, classifies, qualifies, extracts, and generates replies.
 * Enforces usage quotas before expensive AI calls.
 */

const { getDb } = require('../lib/firebase');
const { COLLECTIONS, DEFAULT_BUSINESS_CONTEXT } = require('../config/constants');
const { callAIForClassification, callAIForExtraction, callAIForReply } = require('./ai-calls');
const { qualifyLead } = require('./qualify-logic');
const { logger } = require('../utils/logger');

const admin = require('firebase-admin');

let unsubscribe = null;

function startAiProcessor() {
  const db = getDb();
  const q = db.collection(COLLECTIONS.RAW_MESSAGES).where('processed', '==', false);

  logger.info('AI Processor: Listening for unprocessed messages');

  unsubscribe = q.onSnapshot(
    async (snapshot) => {
      const changes = snapshot.docChanges().filter((c) => c.type === 'added');

      for (const change of changes) {
        const doc = change.doc;
        const message = doc.data();
        const docId = doc.id;
        const userId = message.userId || 'unknown_user';

        try {
          await processMessage(doc, message, docId, userId);
        } catch (err) {
          logger.error('Message processing failed', { docId, userId, error: err.message });
          await db.collection(COLLECTIONS.RAW_MESSAGES).doc(docId).update({
            processed: true,
            status: 'error',
            errorReason: err.message,
          });
        }
      }
    },
    (error) => {
      logger.error('🔥 AI Processor listener died', { error: error.message });
      setTimeout(() => {
        logger.info('Restarting AI Processor...');
        startAiProcessor();
      }, 5000);
    }
  );
}

async function processMessage(doc, message, docId, userId) {
  const db = getDb();
  logger.info('Processing message', { docId: docId.substring(0, 10), userId });

  const businessContext = await getBusinessContext(userId);

  const classification = await callAIForClassification(message.body, userId, businessContext);

  const errorIntents = ['Classification Error', 'API Error', 'API Key Missing', 'No Candidate', 'No JSON Part'];
  if (errorIntents.includes(classification.intent)) {
    logger.warn('Classification API failure', { userId, intent: classification.intent });
    await db.collection(COLLECTIONS.RAW_MESSAGES).doc(docId).update({
      processed: true,
      status: 'pending_retry',
      errorReason: classification.intent,
    });
    return;
  }

  let autoReplyText = null;
  let isReturningClient = false;
  let totalMessagesFromClient = 0;
  let isQualified = false;
  let leadPriority = 'Low';
  let qualifiedLeadRecord = null;

  if (classification.isLead) {
    const existingLeads = await db
      .collection(COLLECTIONS.LEADS)
      .where('userId', '==', userId)
      .orderBy('timestamp', 'desc')
      .limit(1)
      .get();

    isReturningClient = !existingLeads.empty;
    if (isReturningClient) {
      totalMessagesFromClient = existingLeads.docs[0].data().messageCount || 1;
    }
    totalMessagesFromClient += 1;

    const existingQualified = await db
      .collection(COLLECTIONS.QUALIFIED_LEADS)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    if (!existingQualified.empty) {
      qualifiedLeadRecord = existingQualified.docs[0];
      isQualified = true;
      leadPriority = qualifiedLeadRecord.data().priority || 'High';
    }
  }

  if (classification.isLead && !isQualified) {
    const qualResult = qualifyLead(totalMessagesFromClient, classification.intent);
    isQualified = qualResult.isQualified;
    leadPriority = qualResult.priority;
  }

  let missingName = true;
  let missingEmail = true;

  if (isQualified) {
    const extracted = await callAIForExtraction(message.body);
    let updates = {};

    if (qualifiedLeadRecord) {
      const curName = qualifiedLeadRecord.data().name;
      const curEmail = qualifiedLeadRecord.data().email;

      if (!curName && extracted.name) updates.name = extracted.name;
      else if (curName) missingName = false;

      if (!curEmail && extracted.email) updates.email = extracted.email;
      else if (curEmail) missingEmail = false;

      missingName = missingName && !updates.name;
      missingEmail = missingEmail && !updates.email;

      if (Object.keys(updates).length > 0) {
        await qualifiedLeadRecord.ref.update(updates);
      }
    } else if (extracted.name || extracted.email) {
      missingName = !extracted.name;
      missingEmail = !extracted.email;
    }
  }

  const newLead = classification.isLead && !isReturningClient;

  let updateData = {
    processed: true,
    status: 'success',
    isLead: classification.isLead,
    newLead,
    userId,
    phoneNumber: message.phoneNumber || 'unknown_phone',
    intent: classification.intent,
    messageCount: totalMessagesFromClient,
    isQualified,
    priority: leadPriority,
  };

  if (classification.isLead) {
    const catalogTable = await getProductCatalog(userId);
    autoReplyText = await callAIForReply(
      message.body,
      classification.intent,
      isReturningClient,
      isQualified,
      missingName,
      missingEmail,
      totalMessagesFromClient,
      userId,
      businessContext,
      catalogTable
    );

    if (autoReplyText) {
      autoReplyText += '\n\n*Note: You are talking to an AI Agent. It can make mistakes.*';
    }

    updateData.replyPending = true;
    updateData.autoReplyText = autoReplyText;

    if (isQualified && !qualifiedLeadRecord) {
      await db.collection(COLLECTIONS.QUALIFIED_LEADS).add({
        userId,
        phoneNumber: message.phoneNumber || 'unknown_phone',
        rawMessageId: docId,
        contactId: message.from,
        intent: classification.intent,
        lastMessageBody: message.body,
        priority: leadPriority,
        messageCount: totalMessagesFromClient,
        autoReplyText,
        timestamp: admin.firestore.Timestamp.now(),
        name: missingName ? null : 'Extracted',
        email: missingEmail ? null : 'Extracted',
      });
    }

    if (newLead) {
      await db.collection(COLLECTIONS.LEADS).add({
        userId,
        phoneNumber: message.phoneNumber || 'unknown_phone',
        contactId: message.from,
        intent: classification.intent,
        firstMessageBody: message.body,
        messageCount: totalMessagesFromClient,
        timestamp: admin.firestore.Timestamp.now(),
      });
    }
  }

  await db.collection(COLLECTIONS.RAW_MESSAGES).doc(docId).update(updateData);
  logger.info('Message processed', { docId: docId.substring(0, 10), userId, isLead: classification.isLead });
}

async function getBusinessContext(userId) {
  const db = getDb();
  try {
    const contextDoc = await db.collection(COLLECTIONS.BUSINESS_CONTEXT).doc(userId).get();
    if (contextDoc.exists) return contextDoc.data();

    const userDoc = await db.collection(COLLECTIONS.USERS).doc(userId).get();
    if (userDoc.exists && userDoc.data().businessContext) return userDoc.data().businessContext;
  } catch (err) {
    logger.warn('Could not fetch business context', { userId, error: err.message });
  }
  return DEFAULT_BUSINESS_CONTEXT;
}

async function getProductCatalog(userId) {
  const db = getDb();
  try {
    const snap = await db
      .collection(COLLECTIONS.PRODUCT_CATALOG)
      .where('businessId', '==', userId)
      .limit(1)
      .get();

    if (snap.empty) return null;

    const data = snap.docs[0].data();
    if (!data.columns || !data.rows || data.rows.length === 0) return null;

    let table = 'Product Catalog:\n';
    table += '| ' + data.columns.join(' | ') + ' |\n';
    table += '| ' + data.columns.map(() => '---').join(' | ') + ' |\n';
    data.rows.forEach((row) => {
      table += '| ' + data.columns.map((col) => row[col] || '-').join(' | ') + ' |\n';
    });
    return table;
  } catch (err) {
    logger.warn('Could not fetch product catalog', { userId, error: err.message });
    return null;
  }
}

function stopAiProcessor() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
    logger.info('AI Processor stopped');
  }
}

module.exports = { startAiProcessor, stopAiProcessor };
