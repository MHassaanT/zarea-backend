/**
 * Atomic Usage Counter
 * Tracks per-user message quotas with Firestore transactions.
 */

const { getDb } = require('../lib/firebase');
const { PLANS, COLLECTIONS } = require('../config/constants');
const { logger } = require('../utils/logger');

const admin = require('firebase-admin');

async function checkAndIncrementUsage(userId) {
  const db = getDb();
  const counterRef = db.collection(COLLECTIONS.USAGE_COUNTERS).doc(userId);

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(counterRef);
    const now = admin.firestore.Timestamp.now();

    let data = snap.exists
      ? snap.data()
      : {
          userId,
          monthlyCount: 0,
          totalCount: 0,
          currentPlan: 'starter',
          billingCycleStart: now,
          overageThisMonth: 0,
        };

    const cycleStart = data.billingCycleStart.toDate();
    const cycleEnd = new Date(cycleStart);
    cycleEnd.setMonth(cycleEnd.getMonth() + 1);

    if (now.toDate() > cycleEnd) {
      data.monthlyCount = 0;
      data.overageThisMonth = 0;
      data.billingCycleStart = now;
      logger.info('Billing cycle reset', { userId });
    }

    const plan = PLANS[data.currentPlan] || PLANS.starter;
    const limit = plan.messagesPerMonth;

    if (data.monthlyCount >= limit) {
      return {
        allowed: false,
        reason: 'quota_exceeded',
        current: data.monthlyCount,
        limit,
        planId: data.currentPlan,
      };
    }

    transaction.set(
      counterRef,
      {
        monthlyCount: admin.firestore.FieldValue.increment(1),
        totalCount: admin.firestore.FieldValue.increment(1),
        lastUpdated: now,
        userId,
        currentPlan: data.currentPlan,
        billingCycleStart: data.billingCycleStart,
        overageThisMonth: data.overageThisMonth,
      },
      { merge: true }
    );

    return {
      allowed: true,
      current: data.monthlyCount + 1,
      limit,
      planId: data.currentPlan,
    };
  });
}

async function getUsage(userId) {
  const db = getDb();
  const snap = await db.collection(COLLECTIONS.USAGE_COUNTERS).doc(userId).get();

  if (!snap.exists) {
    return {
      monthlyCount: 0,
      limit: PLANS.starter.messagesPerMonth,
      percentage: 0,
      planName: PLANS.starter.name,
      overage: 0,
    };
  }

  const data = snap.data();
  const plan = PLANS[data.currentPlan] || PLANS.starter;

  return {
    monthlyCount: data.monthlyCount || 0,
    limit: plan.messagesPerMonth,
    percentage: Math.round(((data.monthlyCount || 0) / plan.messagesPerMonth) * 100),
    planName: plan.name,
    overage: data.overageThisMonth || 0,
    billingCycleStart: data.billingCycleStart,
  };
}

async function updateUserPlan(userId, planId) {
  const db = getDb();
  const validPlans = Object.keys(PLANS);

  if (!validPlans.includes(planId)) {
    throw new Error(`Invalid plan: ${planId}`);
  }

  await db.collection(COLLECTIONS.USAGE_COUNTERS).doc(userId).set(
    {
      currentPlan: planId,
      planChangedAt: admin.firestore.Timestamp.now(),
    },
    { merge: true }
  );

  logger.info('Plan updated', { userId, planId });
}

module.exports = { checkAndIncrementUsage, getUsage, updateUserPlan, PLANS };
