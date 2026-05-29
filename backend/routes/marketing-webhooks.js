const express = require('express');
const crypto = require('crypto');

const router = express.Router();

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

router.use(requireMarketingSecret);

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

router.post('/abandoned-cart', (req, res) => {
  const payload = req.body || {};
  const { email, phone } = extractContact(payload);
  const rawItems = (payload.cart && payload.cart.items) || payload.items || [];
  const items = normalizeCartItems(rawItems);
  const totalValue = computeCartValue(payload, items);

  if (!email && !phone) {
    return res.status(400).json({
      success: false,
      error: 'Either customer email or phone is required',
    });
  }

  const campaignContext = {
    trigger: 'abandoned-cart',
    sessionId: pickFirstString(payload.sessionId, payload.cartId, payload.checkoutId),
    email: email || null,
    phone: phone || null,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    totalValue,
    currency: pickFirstString(payload.currency, payload.cart && payload.cart.currency) || 'N/A',
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

  return res.status(202).json({
    success: true,
    accepted: true,
    event: 'abandoned-cart',
    campaignContext,
  });
});

router.post('/welcome-flow', (req, res) => {
  const payload = req.body || {};
  const { email, phone } = extractContact(payload);
  const leadSource = pickFirstString(payload.source, payload.leadSource, payload.utmSource) || 'unknown';

  if (!email && !phone) {
    return res.status(400).json({
      success: false,
      error: 'Either customer email or phone is required',
    });
  }

  const welcomeContext = {
    trigger: 'welcome-flow',
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

  return res.status(202).json({
    success: true,
    accepted: true,
    event: 'welcome-flow',
    welcomeContext,
  });
});

module.exports = router;
