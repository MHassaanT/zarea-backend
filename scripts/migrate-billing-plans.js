const admin = require("firebase-admin");
admin.initializeApp();
const db = admin.firestore();

async function migrateBillingPlans() {
  console.log("Starting billing_plans migration...");
  const plansSnapshot = await db.collection("billing_plans").get();
  let updatedCount = 0;
  
  for (const doc of plansSnapshot.docs) {
    const data = doc.data();
    const userId = doc.id;
    let updates = {};

    // 1. Resolve missing SafePay dates
    if (data.paymentProvider === "safepay") {
      if (!data.startedAt) {
        const subDoc = await db.collection("users").doc(userId).collection("subscriptions").doc("current").get();
        if (subDoc.exists && subDoc.data().trialStartedAt) {
          updates.startedAt = subDoc.data().trialStartedAt;
        }
      }
      
      // Derive renewsAt from endsAt for active SafePay subs if missing
      if (data.status === "active" && !data.renewsAt && data.endsAt) {
        updates.renewsAt = data.endsAt; 
      }
    }

    // 2. Normalize Currency and Pricing Based on Region
    if (data.region === "PK") {
      updates.currency = "PKR";
      // Normalize to base PKR amounts rather than GBP conversions
      if (data.planType && data.planType.toLowerCase() === "monthly") {
        updates.currentPrice = 1500;
      }
      if (data.planType && data.planType.toLowerCase() === "annual") {
        updates.currentPrice = 16500;
      }
    } else if (data.region === "WW" || data.paymentProvider === "paddle") {
      updates.currency = "GBP";
    }

    // 3. Apply updates if needed
    if (Object.keys(updates).length > 0) {
      try {
        await doc.ref.update(updates);
        console.log(`[Success] Updated user ${userId}`, updates);
        updatedCount++;
      } catch (error) {
        console.error(`[Error] Failed to update user ${userId}:`, error);
      }
    }
  }
  
  console.log(`Migration complete. Successfully updated ${updatedCount} records.`);
}

migrateBillingPlans().catch(console.error);
