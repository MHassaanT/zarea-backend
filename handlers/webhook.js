/**
 * Webhook Payload Normalizer
 * Converts Meta's platform-specific payloads into a unified schema.
 */

const { logger } = require('../utils/logger');

function normalizePayload(body) {
  const object = body.object;

  if (object === 'whatsapp_business_account') {
    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const msg = value?.messages?.[0];

    if (!msg || msg.type !== 'text') return null;

    return {
      platform: 'whatsapp',
      from: msg.from,
      to: value.metadata?.phone_number_id,
      body: msg.text?.body,
      messageId: msg.id,
      timestamp: parseInt(msg.timestamp, 10) * 1000,
      senderName: value.contacts?.[0]?.profile?.name || null,
    };
  }

  if (object === 'page') {
    const entry = body.entry?.[0];
    const event = entry?.messaging?.[0];

    if (!event?.message?.text) return null;

    return {
      platform: 'facebook',
      from: event.sender.id,
      to: event.recipient.id,
      body: event.message.text,
      messageId: event.message.mid,
      timestamp: event.timestamp,
      senderName: null,
    };
  }

  if (object === 'instagram') {
    const entry = body.entry?.[0];
    const event = entry?.messaging?.[0];

    if (!event?.message?.text) return null;

    return {
      platform: 'instagram',
      from: event.sender.id,
      to: event.recipient.id,
      body: event.message.text,
      messageId: event.message.mid,
      timestamp: event.timestamp,
      senderName: null,
    };
  }

  logger.warn('Unknown webhook object type', { object });
  return null;
}

module.exports = { normalizePayload };
