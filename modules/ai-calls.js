/**
 * OpenRouter API Calls
 * Classification, extraction, and reply generation.
 */

const fetch = require('node-fetch');
const { AI } = require('../config/constants');
const { logger } = require('../utils/logger');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';

async function openRouterRequest(systemPrompt, userMessage, model, jsonMode = false, maxRetries = AI.MAX_RETRY_ATTEMPTS) {
  if (!OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not set');
  }

  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ],
    max_tokens: jsonMode ? 300 : 1000,
    ...(jsonMode && { response_format: { type: 'json_object' } }),
  };

  let delay = AI.INITIAL_RETRY_DELAY_MS;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(AI.OPENROUTER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://zarea.site',
          'X-Title': 'ZareaAI',
        },
        body: JSON.stringify(body),
      });

      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;
        logger.warn(`OpenRouter rate limited. Retry ${attempt}/${maxRetries} in ${waitMs}ms`);
        await sleep(waitMs);
        delay *= 2;
        continue;
      }

      if (response.status >= 500) {
        logger.warn(`OpenRouter server error ${response.status}. Retry ${attempt}/${maxRetries}`);
        await sleep(delay);
        delay *= 2;
        continue;
      }

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenRouter error ${response.status}: ${errText}`);
      }

      const result = await response.json();
      const text = result.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error('OpenRouter returned empty content');
      return text;

    } catch (networkError) {
      if (attempt === maxRetries) throw networkError;
      logger.warn(`OpenRouter network error. Retry ${attempt}/${maxRetries}`, { error: networkError.message });
      await sleep(delay);
      delay *= 2;
    }
  }

  throw new Error('OpenRouter: Max retries exceeded');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseAIJson(text) {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    cleaned = cleaned.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim();
  }
  return JSON.parse(cleaned);
}

async function callAIForClassification(messageBody, userId, businessContext) {
  if (!OPENROUTER_API_KEY) {
    return { isLead: false, intent: 'API Key Missing' };
  }

  const systemPrompt =
    `You are a lead classifier for ${businessContext.businessName} (${businessContext.businessDescription}). ` +
    `Services: ${businessContext.servicesOffered}. ` +
    `Is the client message a genuine business inquiry (pricing, service, consultation)? ` +
    `Or is it spam, a greeting with no intent, or a system message? ` +
    `Reply ONLY with valid JSON, no markdown. Schema: { "isLead": boolean, "intent": string }`;

  try {
    const text = await openRouterRequest(systemPrompt, `Message: "${messageBody}"`, AI.MODEL_FREE, true);
    const result = parseAIJson(text);
    logger.info('Classification result', { userId, isLead: result.isLead, intent: result.intent });
    return result;
  } catch (error) {
    logger.error('Classification failed', { userId, error: error.message });
    return { isLead: false, intent: 'Classification Error' };
  }
}

async function callAIForExtraction(messageBody) {
  if (!OPENROUTER_API_KEY) {
    return { name: null, email: null };
  }

  const systemPrompt =
    `Extract the full name and email address from the message. ` +
    `If either is missing or ambiguous, return null for that field. ` +
    `Reply ONLY with valid JSON. Schema: { "name": string|null, "email": string|null }`;

  try {
    const text = await openRouterRequest(systemPrompt, `Message: "${messageBody}"`, AI.MODEL_FREE, true);
    return parseAIJson(text);
  } catch (error) {
    return { name: null, email: null };
  }
}

async function callAIForReply(messageBody, intent, isReturningClient, isQualified, missingName, missingEmail, totalMessages, userId, businessContext, catalogTable = null) {
  if (!OPENROUTER_API_KEY) {
    return 'Reply failed: API Key Missing.';
  }

  let stage = 1;
  if (isQualified && !missingName && !missingEmail) stage = 3;
  else if (isQualified && (missingName || missingEmail)) stage = 2;

  const tone =
    businessContext.tone === 'friendly' ? 'Use a warm, friendly tone.' :
    businessContext.tone === 'casual' ? 'Use a casual, conversational tone.' :
    'Use a professional, courteous tone.';

  const handoff = businessContext.handoffTrigger
    ? `Escalate to a human when: ${businessContext.handoffTrigger}.`
    : 'Offer to connect with a team member when the client is fully qualified.';

  const base =
    `You are an AI assistant for ${businessContext.businessName}: ${businessContext.businessDescription}. ` +
    `Services: ${businessContext.servicesOffered}. ${tone} ` +
    `Stage ${stage} rules: ` +
    `Stage 1 = answer helpfully, build rapport, do NOT offer to connect to a human. ` +
    `Stage 2 = acknowledge the query but ask for contact details first, do NOT answer the specific question yet. ` +
    `Stage 3 = ${handoff} ` +
    `NEVER offer human handoff unless in Stage 3. ` +
    (businessContext.faqs ? `FAQs: ${businessContext.faqs} ` : '') +
    (catalogTable ? `Product catalog: ${catalogTable} ` : '');

  let systemPrompt;
  if (stage === 2) {
    const missing = (missingName && missingEmail) ? 'full name and email address'
      : missingName ? 'full name'
      : 'email address';
    systemPrompt = `${base} Politely acknowledge the client's question, then ask for their ${missing} before you can continue. Two sentences max.`;
  } else if (stage === 3) {
    systemPrompt = `${base} Thank the client, confirm their details are saved, and tell them a specialist will follow up about: ${intent}.`;
  } else {
    systemPrompt = `${base} Answer concisely (3-4 points max). The client has sent ${totalMessages} messages so far.`;
  }

  try {
    return await openRouterRequest(systemPrompt, `Client message: "${messageBody}"`, AI.MODEL_REPLY, false);
  } catch (error) {
    return 'Thank you for your message. We are currently experiencing high volume but will reply shortly!';
  }
}

module.exports = { callAIForClassification, callAIForExtraction, callAIForReply };
