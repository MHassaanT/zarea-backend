/**
 * ZareaAI — Shared Constants
 * Single source of truth for collections, plans, and business rules.
 */

const COLLECTIONS = {
  RAW_MESSAGES: 'raw_messages',
  LEADS: 'leads',
  QUALIFIED_LEADS: 'qualified_leads',
  USERS: 'users',
  BUSINESSES: 'businesses',
  BUSINESS_CONTEXT: 'business_context',
  PRODUCT_CATALOG: 'product_catalog',
  BILLING_PLANS: 'billing_plans',
  WEBHOOK_EVENTS: 'webhook_events',
  WHATSAPP_SESSIONS: 'whatsapp_sessions',
  FACEBOOK_SESSIONS: 'facebook_sessions',
  INSTAGRAM_SESSIONS: 'instagram_sessions',
};

const PLANS = {
  starter: {
    id: 'starter',
    name: 'Starter',
    priceMonthly: 2000,
    priceYearly: 22000,
    messagesPerMonth: 100,
    overageRate: 2,
    features: ['whatsapp', 'facebook', 'instagram'],
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 5000,
    priceYearly: 55000,
    messagesPerMonth: 500,
    overageRate: 2,
    features: ['whatsapp', 'facebook', 'instagram', 'priority_support'],
  },
  business: {
    id: 'business',
    name: 'Business',
    priceMonthly: 12000,
    priceYearly: 132000,
    messagesPerMonth: 2000,
    overageRate: 1,
    features: ['whatsapp', 'facebook', 'instagram', 'priority_support', 'multi_agent'],
  },
};

const PLATFORM = {
  WHATSAPP: 'whatsapp',
  FACEBOOK: 'facebook',
  INSTAGRAM: 'instagram',
};

const AI = {
  MODEL_REPLY: 'deepseek/deepseek-chat',
  MODEL_FREE: 'deepseek/deepseek-chat',
  OPENROUTER_URL: 'https://openrouter.ai/api/v1/chat/completions',
  BUNDLE_WINDOW_MS: 8000,
  MAX_RETRY_ATTEMPTS: 5,
  INITIAL_RETRY_DELAY_MS: 1000,
};

const META = {
  API_VERSION: process.env.META_API_VERSION || 'v19.0',
  GRAPH_BASE_URL: 'https://graph.facebook.com',
};

const DEFAULT_BUSINESS_CONTEXT = {
  businessName: 'This Business',
  businessDescription: 'a professional service provider',
  servicesOffered: 'various professional services',
  faqs: '',
  leadQualificationCriteria: 'a client asking about pricing, booking, or a specific service',
  tone: 'professional',
  handoffTrigger: 'when the client requests to speak with a human or mentions an urgent issue',
  industry: 'general',
};

module.exports = {
  COLLECTIONS,
  PLANS,
  PLATFORM,
  AI,
  META,
  DEFAULT_BUSINESS_CONTEXT,
};
