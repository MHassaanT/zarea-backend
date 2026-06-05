/**
 * Firebase Admin Initialization
 * Single init point shared across all modules.
 */

const admin = require('firebase-admin');
let db = null;

function initializeFirebase() {
  try {
    const base64Key = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    if (!base64Key) {
      throw new Error('Missing FIREBASE_SERVICE_ACCOUNT_BASE64');
    }

    const serviceAccount = JSON.parse(
      Buffer.from(base64Key, 'base64').toString('utf-8')
    );

    if (admin.apps.length === 0) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
    }

    db = admin.firestore();
    console.log('🔥 [Firebase] Admin initialized');
    return db;
  } catch (error) {
    console.error('❌ [Firebase] Init error:', error.message);
    process.exit(1);
  }
}

function getDb() {
  if (!db) {
    throw new Error('Firebase not initialized. Call initializeFirebase() first.');
  }
  return db;
}

function getAuth() {
  return admin.auth();
}

module.exports = { initializeFirebase, getDb, getAuth };
