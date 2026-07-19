/**
 * API Routes
 * Connect, disconnect, usage, and health endpoints.
 * All routes require Firebase Auth (except health).
 */

const express = require('express');
const { getDb } = require('../lib/firebase');
const { COLLECTIONS, META } = require('../config/constants');
const { logger } = require('../utils/logger');
const fetch = require('node-fetch');

const router = express.Router();
const admin = require('firebase-admin');

router.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'zarea-backend', timestamp: new Date().toISOString() });
});


router.post('/connect/facebook', async (req, res) => {
  try {
    const { userId, pageId, pageName, pageAccessToken } = req.body;

    if (!userId || !pageId || !pageAccessToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const appId = process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    const debugRes = await fetch(
      `${META.GRAPH_BASE_URL}/${META.API_VERSION}/debug_token?input_token=${pageAccessToken}&access_token=${appId}|${appSecret}`
    );
    const debugData = await debugRes.json();

    if (!debugData.data?.is_valid) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    const subRes = await fetch(
      `${META.GRAPH_BASE_URL}/${META.API_VERSION}/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_optins&access_token=${pageAccessToken}`,
      { method: 'POST' }
    );
    const subData = await subRes.json();
    logger.info('Facebook webhook subscription', { pageId, result: subData });

    const db = getDb();
    await db.collection(COLLECTIONS.FACEBOOK_SESSIONS).doc(pageId).set({
      userId,
      connected: true,
      status: 'active',
      pageId,
      pageName: pageName || 'Manual Page',
      pageAccessToken,
      connectedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    res.json({ success: true, pageId });
  } catch (err) {
    logger.error('Connect Facebook error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/connect/instagram', async (req, res) => {
  try {
    const { userId, pageAccessToken } = req.body;

    if (!userId || !pageAccessToken) {
      return res.status(400).json({ error: 'Missing userId or token' });
    }

    const igRes = await fetch(
      `${META.GRAPH_BASE_URL}/${META.API_VERSION}/me?fields=id,name,instagram_business_account&access_token=${pageAccessToken}`
    );
    const igData = await igRes.json();

    if (igData.error) throw new Error(igData.error.message);

    const instagramBusinessId = igData.instagram_business_account?.id;
    const pageId = igData.id;
    const pageName = igData.name;

    if (!instagramBusinessId) {
      throw new Error('No Instagram Business Account linked to this Page');
    }

    const subRes = await fetch(
      `${META.GRAPH_BASE_URL}/${META.API_VERSION}/${pageId}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,messaging_optins,instagram_manage_messages&access_token=${pageAccessToken}`,
      { method: 'POST' }
    );
    const subData = await subRes.json();
    logger.info('Instagram webhook subscription', { pageId, result: subData });

    const db = getDb();
    await db.collection(COLLECTIONS.INSTAGRAM_SESSIONS).doc(instagramBusinessId).set({
      userId,
      connected: true,
      status: 'active',
      instagramBusinessId,
      pageId,
      pageName: pageName || 'Manual Instagram Page',
      pageAccessToken,
      connectedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    res.json({ success: true, pageName, instagramBusinessId });
  } catch (err) {
    logger.error('Connect Instagram error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/connect/whatsapp', async (req, res) => {
  try {
    const { userId, phoneNumberId, accessToken } = req.body;

    if (!userId || !phoneNumberId || !accessToken) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const validateRes = await fetch(
      `${META.GRAPH_BASE_URL}/${META.API_VERSION}/${phoneNumberId}?fields=id,display_phone_number&access_token=${accessToken}`
    );
    const validateData = await validateRes.json();

    if (validateData.error) {
      return res.status(401).json({ error: 'Invalid WhatsApp access token or phoneNumberId' });
    }

    const db = getDb();
    await db.collection(COLLECTIONS.WHATSAPP_SESSIONS).doc(userId).set({
      userId,
      connected: true,
      status: 'active',
      phoneNumberId,
      accessToken,
      displayPhoneNumber: validateData.display_phone_number,
      connectedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    res.json({
      success: true,
      phoneNumberId,
      displayPhoneNumber: validateData.display_phone_number,
    });
  } catch (err) {
    logger.error('Connect WhatsApp error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/disconnect', async (req, res) => {
  try {
    const { userId, platform } = req.body;

    if (!userId || !platform) {
      return res.status(400).json({ error: 'Missing userId or platform' });
    }

    const db = getDb();
    let collectionName;

    switch (platform) {
      case 'whatsapp':
        collectionName = COLLECTIONS.WHATSAPP_SESSIONS;
        break;
      case 'facebook':
        collectionName = COLLECTIONS.FACEBOOK_SESSIONS;
        break;
      case 'instagram':
        collectionName = COLLECTIONS.INSTAGRAM_SESSIONS;
        break;
      default:
        return res.status(400).json({ error: 'Invalid platform' });
    }

    const snap = await db.collection(collectionName).where('userId', '==', userId).get();
    const batch = db.batch();

    for (const doc of snap.docs) {
      const data = doc.data();

      if (data.pageAccessToken && data.pageId) {
        try {
          await fetch(
            `${META.GRAPH_BASE_URL}/${META.API_VERSION}/${data.pageId}/subscribed_apps?access_token=${data.pageAccessToken}`,
            { method: 'DELETE' }
          );
          logger.info(`Unsubscribed ${platform} page from webhooks`, { pageId: data.pageId });
        } catch (e) {
          logger.warn(`Failed to unsubscribe ${platform} page`, { pageId: data.pageId, error: e.message });
        }
      }

      batch.delete(doc.ref);
    }

    await batch.commit();
    res.json({ message: `${platform} disconnected successfully`, deleted: snap.size });
  } catch (err) {
    logger.error('Disconnect error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
