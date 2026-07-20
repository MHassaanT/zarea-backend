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

// ─── Facebook & Instagram OAuth via JS SDK ───
router.post('/oauth/facebook-instagram', async (req, res) => {
  try {
    const { userId, accessToken } = req.body;
    if (!userId || !accessToken) {
      return res.status(400).json({ error: 'Missing userId or accessToken' });
    }

    const appId = process.env.META_APP_ID || process.env.NEXT_PUBLIC_META_APP_ID;
    const appSecret = process.env.META_APP_SECRET;

    // 1. Debug the token
    const debugRes = await fetch(
      `${META.GRAPH_BASE_URL}/${META.API_VERSION}/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`
    );
    const debugData = await debugRes.json();

    if (!debugData.data?.is_valid) {
      return res.status(401).json({ error: 'Invalid access token' });
    }

    // Check required scopes
    const scopes = debugData.data?.scopes || [];
    const requiredScopes = ['pages_show_list', 'pages_messaging', 'instagram_basic', 'instagram_manage_messages'];
    const missingScopes = requiredScopes.filter(s => !scopes.includes(s));
    
    if (missingScopes.length > 0) {
      logger.warn('Missing scopes', { userId, missing: missingScopes });
      // Don't fail — some scopes might be optional, just log it
    }

    // 2. Get user's pages
    const pagesRes = await fetch(
      `${META.GRAPH_BASE_URL}/${META.API_VERSION}/me/accounts?fields=id,name,access_token,instagram_business_account&access_token=${accessToken}`
    );
    const pagesData = await pagesRes.json();

    if (!pagesData?.data || pagesData.data.length === 0) {
      const dbg = debugData.data?.scopes ? debugData.data.scopes.join(', ') : 'none';
      return res.status(400).json({ 
        error: `No pages found. Scopes granted: [${dbg}]. Meta Response: ${JSON.stringify(pagesData)}`,
        details: 'Please ensure you are an Admin of a Facebook Page and granted permission during login.'
      });
    }

    logger.info('Found pages', { userId, count: pagesData.data.length });

    const results = { facebook: [], instagram: [] };
    const db = getDb();

    for (const page of pagesData.data) {
      // 3. Subscribe page to webhooks
      const webhookFields = ['messages', 'messaging_postbacks', 'messaging_optins'].join(',');
      const subRes = await fetch(
        `${META.GRAPH_BASE_URL}/${META.API_VERSION}/${page.id}/subscribed_apps?subscribed_fields=${webhookFields}&access_token=${page.access_token}`,
        { method: 'POST' }
      );
      const subData = await subRes.json();
      
      if (subData.error) {
        logger.error('Webhook subscription failed', { pageId: page.id, error: subData.error });
        continue;
      }

      // 4. Save Facebook session
      await db.collection(COLLECTIONS.FACEBOOK_SESSIONS).doc(page.id).set({
        userId,
        connected: true,
        status: 'active',
        pageId: page.id,
        pageName: page.name,
        pageAccessToken: page.access_token,
        connectedAt: admin.firestore.Timestamp.now(),
      }, { merge: true });

      results.facebook.push({ pageId: page.id, pageName: page.name });

      // 5. Save Instagram if linked
      let igId = page.instagram_business_account?.id;
      
      // Fallback: Query the page directly using the page access token (Graph API quirk)
      if (!igId) {
        const igCheckUrl = `${META.GRAPH_BASE_URL}/${META.API_VERSION}/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`;
        const igCheckRes = await fetch(igCheckUrl);
        const igCheckData = await igCheckRes.json();
        if (igCheckData.instagram_business_account?.id) {
          igId = igCheckData.instagram_business_account.id;
        }
      }

      if (igId) {
        await db.collection(COLLECTIONS.INSTAGRAM_SESSIONS).doc(igId).set({
          userId,
          connected: true,
          status: 'active',
          instagramBusinessId: igId,
          pageId: page.id,
          pageName: page.name,
          pageAccessToken: page.access_token,
          connectedAt: admin.firestore.Timestamp.now(),
        }, { merge: true });

        results.instagram.push({ 
          instagramBusinessId: igId,
          pageName: page.name 
        });
      }
    }

    res.json({ 
      success: true, 
      message: 'Meta accounts connected successfully',
      facebook: results.facebook,
      instagram: results.instagram 
    });

  } catch (err) {
    logger.error('OAuth Facebook-Instagram error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── WhatsApp OAuth via JS SDK ───
router.post('/oauth/whatsapp', async (req, res) => {
  try {
    const { userId, accessToken: shortLivedToken } = req.body;
    if (!userId || !shortLivedToken) {
      return res.status(400).json({ error: 'Missing userId or accessToken' });
    }

    logger.info('WhatsApp OAuth token received', { userId });
    
    const appId = process.env.META_WA_APP_ID;
    const appSecret = process.env.META_WA_APP_SECRET;

    if (!appId || !appSecret) {
      throw new Error('WhatsApp App credentials (META_WA_APP_ID, META_WA_APP_SECRET) not configured on backend.');
    }

    // 1. Exchange short-lived token for long-lived access token
    const tokenUrl = `${META.GRAPH_BASE_URL}/${META.API_VERSION}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortLivedToken}`;
    const tokenRes = await fetch(tokenUrl);
    const tokenData = await tokenRes.json();

    if (tokenData.error) {
      logger.error('WA Token exchange failed', { error: tokenData.error });
      return res.status(400).json({ 
        error: `Token exchange failed: ${tokenData.error.message}`, 
        details: tokenData.error 
      });
    }

    const accessToken = tokenData.access_token;

    // 2. Debug token to get WABA ID
    const debugUrl = `${META.GRAPH_BASE_URL}/${META.API_VERSION}/debug_token?input_token=${accessToken}&access_token=${appId}|${appSecret}`;
    const debugRes = await fetch(debugUrl);
    const debugData = await debugRes.json();

    if (!debugData.data?.is_valid) {
      return res.status(401).json({ error: 'Exchanged access token is invalid' });
    }

    // Find WABA ID from granular scopes
    const granularScopes = debugData.data.granular_scopes || [];
    const wbmScope = granularScopes.find(s => s.scope === 'whatsapp_business_management' || s.scope === 'whatsapp_business_messaging');
    
    let wabaId = null;
    if (wbmScope && wbmScope.target_ids && wbmScope.target_ids.length > 0) {
      wabaId = wbmScope.target_ids[0];
    }

    // Fallback if not found in granular scopes
    if (!wabaId) {
      const waAccountsRes = await fetch(`${META.GRAPH_BASE_URL}/${META.API_VERSION}/me/client_wa_accounts?access_token=${accessToken}`);
      const waAccountsData = await waAccountsRes.json();
      if (waAccountsData.data && waAccountsData.data.length > 0) {
        wabaId = waAccountsData.data[0].id;
      }
    }

    if (!wabaId) {
      return res.status(400).json({ error: 'Could not resolve WhatsApp Business Account ID. Please ensure the business was correctly linked.' });
    }

    // 3. Get Phone Number ID
    const phonesRes = await fetch(`${META.GRAPH_BASE_URL}/${META.API_VERSION}/${wabaId}/phone_numbers?access_token=${accessToken}`);
    const phonesData = await phonesRes.json();

    if (!phonesData.data || phonesData.data.length === 0) {
      return res.status(400).json({ error: 'No phone numbers found in the WhatsApp Business Account.' });
    }

    // Just grab the first phone number for now (can be expanded to let user select later)
    const phoneData = phonesData.data[0];
    const phoneNumberId = phoneData.id;
    const displayPhoneNumber = phoneData.display_phone_number;

    // 4. Save to Firestore
    const db = getDb();
    await db.collection(COLLECTIONS.WHATSAPP_SESSIONS).doc(userId).set({
      userId,
      connected: true,
      status: 'active',
      wabaId,
      phoneNumberId,
      displayPhoneNumber,
      accessToken,
      connectedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    logger.info('WhatsApp connected successfully', { userId, phoneNumberId });

    res.json({ 
      success: true, 
      message: 'WhatsApp connected successfully.',
      phoneNumberId,
      displayPhoneNumber
    });

  } catch (err) {
    logger.error('OAuth WhatsApp error', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
