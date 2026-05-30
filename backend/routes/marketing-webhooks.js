const express = require('express');
const crypto = require('crypto');

const router = express.Router();
const intakeRateMap = new Map();
const intakeDedupMap = new Map();

const INTAKE_WINDOW_MS = 10 * 60 * 1000;
const INTAKE_MAX_HITS = 10;
const INTAKE_DEDUP_TTL_MS = 45 * 60 * 1000;

const cleanupExpiredEntries = (store, nowTs) => {
  for (const [key, value] of store.entries()) {
    if (!value || (typeof value.expiresAt === 'number' && value.expiresAt <= nowTs)) {
      store.delete(key);
    }
  }
};

const getClientIp = (req) => {
  const forwardedFor = String(req.headers['x-forwarded-for'] || '');
  if (forwardedFor) {
    const first = forwardedFor.split(',').map((entry) => entry.trim()).find(Boolean);
    if (first) return first;
  }
  return req.ip || req.socket?.remoteAddress || 'unknown';
};

const getRateLimitBucket = (req) => {
  const ip = getClientIp(req);
  const sessionId = String(req.body?.sessionId || req.body?.checkoutId || 'anon').trim().slice(0, 80);
  return `${ip}::${sessionId}`;
};

const isRateLimited = (req) => {
  const nowTs = Date.now();
  cleanupExpiredEntries(intakeRateMap, nowTs);

  const bucket = getRateLimitBucket(req);
  const existing = intakeRateMap.get(bucket);

  if (!existing || existing.expiresAt <= nowTs) {
    intakeRateMap.set(bucket, { hits: 1, expiresAt: nowTs + INTAKE_WINDOW_MS });
    return false;
  }

  if (existing.hits >= INTAKE_MAX_HITS) {
    return true;
  }

  existing.hits += 1;
  intakeRateMap.set(bucket, existing);
  return false;
};

const timingSafeEqualStr = (a, b) => {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const requireMarketingSecret = (req, res, next) => {
  const expected = String(process.env.MARKETING_SECRET || '').trim();
  const provided = String(req.get('X-Marketing-Secret') || '').trim();

  if (!expected || !timingSafeEqualStr(provided, expected)) {
    return res.status(401).json({ success: false, error: 'Unauthorized' });
  }

  return next();
};

const pickFirstString = (...values) => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return '';
};

const normalizeCartItems = (items) => {
  if (!Array.isArray(items)) return [];

  return items.map((item, index) => {
    const quantity = Math.max(1, Number(item && item.quantity) || 1);
    const unitPrice = Number(item && (item.price ?? item.unitPrice ?? item.amount)) || 0;

    return {
      id: item && (item.id ?? item.productId ?? null),
      title: pickFirstString(item && item.title, item && item.name) || `Item ${index + 1}`,
      quantity,
      unitPrice,
      lineTotal: Number((quantity * unitPrice).toFixed(2)),
    };
  });
};

const computeCartValue = (payload, items) => {
  const payloadTotal = Number(
    payload && (
      payload.totalValue
      ?? payload.total
      ?? payload.orderTotal
      ?? (payload.cart && (payload.cart.totalValue ?? payload.cart.total))
    )
  );

  if (Number.isFinite(payloadTotal) && payloadTotal > 0) {
    return Number(payloadTotal.toFixed(2));
  }

  const computed = items.reduce((sum, item) => sum + item.lineTotal, 0);
  return Number(computed.toFixed(2));
};

const extractContact = (payload = {}) => {
  const customer = payload.customer || {};
  const profile = payload.profile || {};

  const email = pickFirstString(
    payload.email,
    payload.customerEmail,
    customer.email,
    profile.email
  ).toLowerCase();

  const phone = pickFirstString(
    payload.phone,
    payload.customerPhone,
    customer.phone,
    profile.phone
  );

  return { email, phone };
};

const isLikelyBotPayload = (payload = {}) => {
  // Honeypot fields expected to stay empty in the storefront form.
  const honeypots = [payload.website, payload.company, payload.nickname];
  return honeypots.some((value) => String(value || '').trim().length > 0);
};

const shouldDedupAbandonedEvent = (payload = {}, email = '', phone = '') => {
  const nowTs = Date.now();
  cleanupExpiredEntries(intakeDedupMap, nowTs);

  const eventKey = [
    String(payload.sessionId || payload.checkoutId || '').trim().slice(0, 120),
    email,
    phone,
    String(payload.currency || '').trim().toUpperCase(),
    String(Number(payload.totalValue || payload.total || 0).toFixed(2)),
  ].join('::');

  if (!eventKey.replace(/[:]/g, '')) return false;
  if (intakeDedupMap.has(eventKey)) return true;

  intakeDedupMap.set(eventKey, { expiresAt: nowTs + INTAKE_DEDUP_TTL_MS });
  return false;
};

const shouldDedupWelcomeEvent = (payload = {}, email = '', phone = '') => {
  const nowTs = Date.now();
  cleanupExpiredEntries(intakeDedupMap, nowTs);

  const eventKey = [
    'welcome',
    email,
    phone,
    String(payload.source || payload.leadSource || payload.utmSource || '').trim().toLowerCase(),
    String(payload.locale || payload.language || '').trim().toLowerCase(),
  ].join('::');

  if (!eventKey.replace(/[:]/g, '')) return false;
  if (intakeDedupMap.has(eventKey)) return true;

  intakeDedupMap.set(eventKey, { expiresAt: nowTs + INTAKE_DEDUP_TTL_MS });
  return false;
};

const dispatchAbandonedCart = (payload = {}, source = 'secure-webhook') => {
  const { email, phone } = extractContact(payload);
  const rawItems = (payload.cart && payload.cart.items) || payload.items || [];
  const items = normalizeCartItems(rawItems).slice(0, 20);
  const totalValue = computeCartValue(payload, items);

  if (!email && !phone) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'Either customer email or phone is required',
      },
    };
  }

  const campaignContext = {
    trigger: 'abandoned-cart',
    source,
    sessionId: pickFirstString(payload.sessionId, payload.cartId, payload.checkoutId),
    email: email || null,
    phone: phone || null,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    totalValue,
    currency: pickFirstString(payload.currency, payload.cart && payload.cart.currency) || 'N/A',
    triggerReason: pickFirstString(payload.triggerReason, payload.reason) || 'unspecified',
  };

  console.log('[marketing] abandoned-cart webhook received:', campaignContext);
  console.log('[marketing] Simulate EMAIL campaign trigger:', {
    flow: 'abandoned_cart_recovery_v1',
    channel: 'email',
    recipient: email || 'missing-email',
    totalValue,
    items,
  });

  if (phone) {
    console.log('[marketing] Simulate SMS campaign trigger:', {
      flow: 'abandoned_cart_sms_nudge_v1',
      channel: 'sms',
      recipient: phone,
      totalValue,
    });
  }

  return {
    ok: true,
    status: 202,
    body: {
      success: true,
      accepted: true,
      event: 'abandoned-cart',
      campaignContext,
    },
    email,
    phone,
  };
};

const dispatchWelcomeFlow = (payload = {}, source = 'secure-webhook') => {
  const { email, phone } = extractContact(payload);
  const leadSource = pickFirstString(payload.source, payload.leadSource, payload.utmSource) || 'unknown';

  if (!email && !phone) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: 'Either customer email or phone is required',
      },
    };
  }

  const welcomeContext = {
    trigger: 'welcome-flow',
    source,
    email: email || null,
    phone: phone || null,
    firstName: pickFirstString(payload.firstName, payload.customer && payload.customer.firstName) || null,
    locale: pickFirstString(payload.locale, payload.language) || 'en',
    leadSource,
  };

  console.log('[marketing] welcome-flow webhook received:', welcomeContext);
  console.log('[marketing] Simulate EMAIL campaign trigger:', {
    flow: 'welcome_series_day0_v1',
    channel: 'email',
    recipient: email || 'missing-email',
    leadSource,
  });

  if (phone) {
    console.log('[marketing] Simulate SMS campaign trigger:', {
      flow: 'welcome_sms_day0_v1',
      channel: 'sms',
      recipient: phone,
      leadSource,
    });
  }

  return {
    ok: true,
    status: 202,
    body: {
      success: true,
      accepted: true,
      event: 'welcome-flow',
      welcomeContext,
    },
    email,
    phone,
  };
};

router.post('/intake/abandoned-cart', (req, res) => {
  const payload = req.body || {};

  if (isLikelyBotPayload(payload)) {
    return res.status(202).json({ success: true, accepted: true, ignored: true });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }

  const result = dispatchAbandonedCart(payload, 'storefront-intake');
  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }

  if (shouldDedupAbandonedEvent(payload, result.email, result.phone)) {
    return res.status(202).json({ success: true, accepted: true, deduped: true });
  }

  return res.status(result.status).json(result.body);
});

router.post('/intake/welcome-flow', (req, res) => {
  const payload = req.body || {};

  if (isLikelyBotPayload(payload)) {
    return res.status(202).json({ success: true, accepted: true, ignored: true });
  }

  if (isRateLimited(req)) {
    return res.status(429).json({ success: false, error: 'Too many requests' });
  }

  const result = dispatchWelcomeFlow(payload, 'storefront-intake');
  if (!result.ok) {
    return res.status(result.status).json(result.body);
  }

  if (shouldDedupWelcomeEvent(payload, result.email, result.phone)) {
    return res.status(202).json({ success: true, accepted: true, deduped: true });
  }

  return res.status(result.status).json(result.body);
});

router.use(requireMarketingSecret);

router.post('/abandoned-cart', (req, res) => {
  const result = dispatchAbandonedCart(req.body || {}, 'secure-webhook');
  return res.status(result.status).json(result.body);
});

router.post('/welcome-flow', (req, res) => {
  const result = dispatchWelcomeFlow(req.body || {}, 'secure-webhook');
  return res.status(result.status).json(result.body);
});

module.exports = router;
