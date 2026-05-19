const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const db = require('./db');
const telegram = require('./services/telegram');
const pricingEngine = require('./services/pricing');
const printify = require('./services/printify');
const meniChat = require('./services/meni');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');
const PAYPAL_API_BASE = 'https://api-m.paypal.com';
const PAYPAL_SUPPORTED_CURRENCIES = new Set(['USD', 'ILS']);

const normalizePayPalCurrency = (currency) => {
  const normalized = String(currency || '').toUpperCase();
  return PAYPAL_SUPPORTED_CURRENCIES.has(normalized) ? normalized : 'ILS';
};

const getPayPalAccessToken = async () => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error('PayPal credentials are missing from environment variables');
  }

  const authHeader = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await axios.post(
    `${PAYPAL_API_BASE}/v1/oauth2/token`,
    'grant_type=client_credentials',
    {
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    }
  );

  return response.data.access_token;
};

const createPayPalOrder = async (accessToken, payload) => {
  const response = await axios.post(
    `${PAYPAL_API_BASE}/v2/checkout/orders`,
    payload,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
};

const capturePayPalOrder = async (accessToken, orderID) => {
  const response = await axios.post(
    `${PAYPAL_API_BASE}/v2/checkout/orders/${orderID}/capture`,
    {},
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      }
    }
  );

  return response.data;
};

const normalizeUrl = (value) => {
  if (!value || typeof value !== 'string') return null;
  return value.trim().replace(/\/$/, '');
};

const DEFAULT_FRONTEND_URL = 'https://custom-ecommerce-seven.vercel.app';
const FRONTEND_BASE_URL = normalizeUrl(
  process.env.FRONTEND_BASE_URL
  || process.env.PUBLIC_APP_URL
  || process.env.APP_BASE_URL
  || DEFAULT_FRONTEND_URL
);

const API_BASE_URL = normalizeUrl(
  process.env.API_BASE_URL
  || process.env.RENDER_EXTERNAL_URL
  || `http://localhost:${PORT}`
);

const CORS_ALLOWED_ORIGINS = Array.from(new Set([
  FRONTEND_BASE_URL,
  'https://dripstreetshop.com',
  'https://www.dripstreetshop.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  ...String(process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => normalizeUrl(origin))
    .filter(Boolean)
]));

app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ALLOWED_ORIGINS.includes(normalizeUrl(origin))) {
      return callback(null, true);
    }

    return callback(new Error(`CORS blocked for origin: ${origin}`));
  }
}));

const visitNotificationCache = new Map();
const VISIT_CACHE_TTL_MS = 30 * 60 * 1000;

const isSimulationOrder = (order) => {
  if (!order) return false;
  const email = (order.customerEmail || '').toLowerCase();
  const name = (order.customerName || '').toLowerCase();
  const addr = (order.address || '').toLowerCase();
  return email.includes('loadtest+') || email.includes('+sim') || name.includes('[sim]') || addr.includes('[sim]');
};

const getClientIp = (req) => {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || (req.socket && req.socket.remoteAddress) || 'unknown';
};

const getOrderTotalAmount = (orderId) => new Promise((resolve, reject) => {
  db.get(`SELECT totalAmount FROM orders WHERE id = ?`, [orderId], (err, row) => {
    if (err) return reject(err);
    resolve(row && typeof row.totalAmount === 'number' ? row.totalAmount : 0);
  });
});

const BUNDLE_ITEM_PRICE_NIS = 229;
const BUNDLE_ITEM_COUNT = 3;
const SHIPPING_COST_NIS = 29.90;
const FREE_SHIPPING_THRESHOLD = 5;

const expandOrderUnits = (items = []) => {
  const units = [];
  items.forEach((item) => {
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.price) || 0;
    for (let index = 0; index < quantity; index += 1) {
      units.push({ unitPrice });
    }
  });

  return units.sort((a, b) => b.unitPrice - a.unitPrice);
};

const isTeeProduct = (product = {}) => {
  if (!product || !product.title) return false;
  const title = (product.title || '').toLowerCase();
  // Exclude hoodies, sweatshirts, and tank tops - they don't qualify for bundle
  if (title.includes('hoodie') || title.includes('sweatshirt') || title.includes('tank')) {
    return false;
  }
  // Include only actual t-shirts/tees
  return (title.includes('tee') || title.includes('t-shirt') || title.includes('shirt'));
};

const expandOrderUnitsForBundle = (items = []) => {
  const units = [];
  items.forEach((item) => {
    if (!isTeeProduct(item)) return;
    const quantity = Number(item.quantity) || 0;
    const unitPrice = Number(item.price) || 0;
    for (let index = 0; index < quantity; index += 1) {
      units.push({ unitPrice });
    }
  });
  return units.sort((a, b) => b.unitPrice - a.unitPrice);
};

const calculateOrderPricing = (items = [], couponCode = null) => {
  const teeUnits = expandOrderUnitsForBundle(items);
  const teeCount = teeUnits.length;
  const totalQuantity = items.reduce((sum, item) => sum + (item.quantity || 0), 0);
  const bundleSets = Math.floor(teeCount / BUNDLE_ITEM_COUNT);
  const bundleUnitsCount = bundleSets * BUNDLE_ITEM_COUNT;
  const teeSubtotal = teeUnits.reduce((sum, unit) => sum + unit.unitPrice, 0);
  const nonTeeSubtotal = items.filter(item => !isTeeProduct(item)).reduce((sum, item) => sum + (item.price * item.quantity), 0);
  const baseSubtotal = teeSubtotal + nonTeeSubtotal;
  const remainderTeesSubtotal = teeUnits.slice(bundleUnitsCount).reduce((sum, unit) => sum + unit.unitPrice, 0);
  const subtotalAfterBundle = (bundleSets * BUNDLE_ITEM_PRICE_NIS) + remainderTeesSubtotal + nonTeeSubtotal;
  const bundleDiscount = Math.max(0, baseSubtotal - subtotalAfterBundle);
  const couponDiscount = currentActiveCoupon && couponCode && currentActiveCoupon.code === couponCode
    ? Math.max(0, subtotalAfterBundle * (Number(currentActiveCoupon.discount_pct) / 100))
    : 0;
  const subtotalAfterDiscounts = Math.max(0, subtotalAfterBundle - couponDiscount);
  const shippingCost = totalQuantity >= FREE_SHIPPING_THRESHOLD ? 0 : (totalQuantity > 0 ? SHIPPING_COST_NIS : 0);
  const totalAmount = Math.max(0, subtotalAfterDiscounts + shippingCost);

  return {
    totalQuantity,
    bundleSets,
    bundleDiscount,
    couponDiscount,
    shippingCost,
    baseSubtotal,
    subtotalAfterDiscounts,
    totalAmount,
  };
};

const dbGetAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.get(query, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

const dbAllAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.all(query, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows || []);
  });
});

const dbRunAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function(err) {
    if (err) return reject(err);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEAD_PROMO_DISCOUNT_RATE = 0.10;

const normalizePromoCode = (value) => String(value || '').trim().toUpperCase();

const isValidEmail = (value) => EMAIL_REGEX.test(String(value || '').trim().toLowerCase());

const roundCurrency = (value) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const generatePromoCode = () => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let index = 0; index < 6; index += 1) {
    const randomIndex = crypto.randomInt(0, chars.length);
    suffix += chars[randomIndex];
  }
  return `DRP-${suffix}`;
};

const getLeadByPromoCode = async (promoCode) => {
  const normalized = normalizePromoCode(promoCode);
  if (!normalized) return null;
  return dbGetAsync(`SELECT id, email, promo_code, is_used FROM leads WHERE promo_code = ?`, [normalized]);
};

const validateLeadPromoCode = async (promoCode) => {
  const normalized = normalizePromoCode(promoCode);
  if (!normalized) return null;
  const lead = await getLeadByPromoCode(normalized);
  if (!lead || Number(lead.is_used) === 1) return null;
  return lead;
};

const consumeLeadPromoCode = async (promoCode) => {
  const normalized = normalizePromoCode(promoCode);
  if (!normalized) return;
  await dbRunAsync(`UPDATE leads SET is_used = 1 WHERE promo_code = ?`, [normalized]);
};

const normalizeVariantValue = (value) => String(value || '').trim().toLowerCase();

const resolveValidatedOrderItems = async (items = []) => {
  const validatedItems = [];

  for (const rawItem of items) {
    const productId = Number(rawItem && rawItem.id);
    const quantity = Math.max(1, Number(rawItem && rawItem.quantity) || 1);

    if (!productId) {
      throw new Error('Each order item must include a valid product id');
    }

    const product = await dbGetAsync(`SELECT id, title, price, printifyId FROM products WHERE id = ?`, [productId]);
    if (!product) {
      throw new Error(`Product ${productId} was not found`);
    }

    const selectedColor = rawItem && rawItem.selectedColor ? String(rawItem.selectedColor).trim() : null;
    const selectedSize = rawItem && rawItem.selectedSize ? String(rawItem.selectedSize).trim() : null;
    let resolvedVariant = null;

    if (selectedColor || selectedSize || rawItem.variantId) {
      const productVariants = await dbAllAsync(
        `SELECT id, printifyVariantId, color, size, price, isEnabled, isAvailable
         FROM product_variants
         WHERE productId = ?`,
        [productId]
      );

      resolvedVariant = productVariants.find((variant) => (
        normalizeVariantValue(variant.color) === normalizeVariantValue(selectedColor)
        && normalizeVariantValue(variant.size) === normalizeVariantValue(selectedSize)
        && Number(variant.isEnabled) !== 0
        && Number(variant.isAvailable) !== 0
      )) || null;

      if (!resolvedVariant) {
        throw new Error(`Variant mismatch for product ${productId}: ${selectedColor || '-'} / ${selectedSize || '-'}`);
      }
    }

    const resolvedPrice = Number.isFinite(Number(resolvedVariant && resolvedVariant.price))
      ? Number(resolvedVariant.price)
      : Number(rawItem && rawItem.price);

    validatedItems.push({
      ...rawItem,
      id: product.id,
      title: product.title,
      quantity,
      price: Number.isFinite(resolvedPrice) ? resolvedPrice : Number(product.price) || 0,
      selectedColor,
      selectedSize,
      variantId: resolvedVariant ? resolvedVariant.id : null,
      printifyProductId: product.printifyId || null,
      printifyVariantId: resolvedVariant ? resolvedVariant.printifyVariantId : null,
    });
  }

  return validatedItems;
};

const reserveWebhookEvent = async (provider, eventId) => {
  if (!provider || !eventId) return true;
  const result = await dbRunAsync(
    `INSERT OR IGNORE INTO processed_webhooks (provider, eventId) VALUES (?, ?)`,
    [provider, eventId]
  );
  return result.changes > 0;
};

const getOrderItemSummary = async (orderId) => {
  const rows = await dbAllAsync(
    `SELECT oi.quantity, oi.selectedColor, oi.selectedSize, p.title
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.productId
     WHERE oi.orderId = ?
     ORDER BY oi.id ASC`,
    [orderId]
  );

  if (!rows.length) return { totalItems: 0, firstItemLabel: 'N/A' };
  const totalItems = rows.reduce((sum, row) => sum + (Number(row.quantity) || 0), 0);
  const first = rows[0];
  const firstItemLabel = `${first.quantity || 1}x ${first.title || 'Item'}${first.selectedColor ? ` (${first.selectedColor}` : ''}${first.selectedSize ? ` / ${first.selectedSize}` : ''}${first.selectedColor ? ')' : ''}`;
  return { totalItems, firstItemLabel };
};

const getPaidRevenueTotal = () => new Promise((resolve, reject) => {
  db.get(`SELECT COALESCE(SUM(totalAmount), 0) AS totalPaid FROM orders WHERE status = 'paid'`, [], (err, row) => {
    if (err) return reject(err);
    const totalPaid = row && typeof row.totalPaid === 'number' ? row.totalPaid : 0;
    resolve(totalPaid);
  });
});

const sendPaymentNotification = async ({ provider, orderId, amountText }) => {
  try {
    const totalPaid = await getPaidRevenueTotal();
    const itemSummary = await getOrderItemSummary(orderId);
    await telegram.sendMessage(
      `🛍️ <b>NEW ORDER RECEIVED</b>\n\n`
      + `<b>Order:</b> #${orderId}\n`
      + `<b>Provider:</b> ${provider}\n`
      + `<b>Total:</b> ${amountText}\n`
      + `<b>Items:</b> ${itemSummary.totalItems}\n`
      + `<b>Top Item:</b> ${itemSummary.firstItemLabel}\n`
      + `<b>Total Revenue:</b> ₪${totalPaid.toFixed(2)}`
    );
  } catch (err) {
    await telegram.sendMessage(`⚠️ <b>תשלום נקלט אבל חישוב סכום מצטבר נכשל</b>\nהזמנה #${orderId}`).catch(() => null);
  }
};

const processPaidOrderFulfillment = async (orderId, providerTag) => {
  const order = await dbGetAsync(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  if (!order) return;

  if (isSimulationOrder(order)) {
    await telegram.sendMessage(`🧪 <b>סימולציה:</b> הזמנה #${orderId} סומנה כ-paid ב-${providerTag} ללא שליחה ל-Printify.`).catch(() => null);
    return;
  }

  const items = await dbAllAsync(
    `SELECT oi.*, p.printifyId AS printifyProductId, pv.printifyVariantId
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.productId
     LEFT JOIN product_variants pv ON pv.id = oi.variantId
     WHERE oi.orderId = ?`,
    [orderId]
  );
  if (!items.length) return;

  try {
    await printify.sendOrderToProduction(orderId, order.customerName, order.customerEmail, order.address, items);
    await telegram.sendMessage(`🏭 <b>הזמנה #${orderId} נשלחה לייצור!</b>\nההזמנה הועברה בהצלחה למפעל ב-Printify.`);
  } catch (pErr) {
    await telegram.sendMessage(`🚨 <b>שגיאה בשליחה לייצור</b>\nהזמנה #${orderId} שולמה אבל נכשלה בהעברה ל-Printify.`);
  }
};

const parsePrintifyPayload = (rawBody) => {
  if (!rawBody) return {};
  if (typeof rawBody === 'object') return rawBody;
  if (Buffer.isBuffer(rawBody)) {
    const text = rawBody.toString('utf8').trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  if (typeof rawBody === 'string') {
    const text = rawBody.trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  return {};
};

// Temporary Admin Endpoint: Register Printify webhooks from Render env vars.
// Keep this route high in the file to avoid being shadowed by other routing logic.
const registerWebhooksHandler = async (req, res) => {
  const PRINTIFY_API_TOKEN = process.env.PRINTIFY_API_TOKEN || process.env.PRINTIFY_TOKEN;
  const PRINTIFY_SHOP_ID = process.env.PRINTIFY_SHOP_ID;
  const WEBHOOK_URL = process.env.PRINTIFY_WEBHOOK_URL
    || (API_BASE_URL ? `${API_BASE_URL}/api/webhooks/printify` : null);

  if (!PRINTIFY_API_TOKEN || !PRINTIFY_SHOP_ID || !WEBHOOK_URL) {
    return res.status(400).json({
      success: false,
      error: 'Missing required environment variables',
      required: ['PRINTIFY_API_TOKEN', 'PRINTIFY_SHOP_ID', 'PRINTIFY_WEBHOOK_URL or RENDER_EXTERNAL_URL']
    });
  }

  const events = [
    'product:created',
    'product:updated',
    'product:deleted'
  ];

  const apiUrl = `https://api.printify.com/v1/shops/${PRINTIFY_SHOP_ID}/webhooks.json`;
  const headers = {
    Authorization: `Bearer ${PRINTIFY_API_TOKEN}`,
    'Content-Type': 'application/json'
  };

  const results = [];

  try {
    let webhookProbe;
    try {
      const probe = await axios.get(WEBHOOK_URL, { timeout: 7000 });
      webhookProbe = { reachable: true, status: probe.status };
    } catch (probeErr) {
      webhookProbe = {
        reachable: false,
        details: probeErr.response && probeErr.response.status
          ? `HTTP ${probeErr.response.status}`
          : probeErr.message
      };
    }

    const existingRes = await axios.get(apiUrl, { headers });
    const existingHooks = Array.isArray(existingRes.data) ? existingRes.data : [];

    for (const event of events) {
      const alreadyExists = existingHooks.some((hook) => hook.topic === event && hook.url === WEBHOOK_URL);
      if (alreadyExists) {
        results.push({ topic: event, status: 'skipped', reason: 'already_registered' });
        continue;
      }

      try {
        const createRes = await axios.post(apiUrl, { topic: event, url: WEBHOOK_URL }, { headers });
        results.push({
          topic: event,
          status: 'created',
          webhookId: createRes.data && createRes.data.id ? createRes.data.id : null
        });
      } catch (err) {
        results.push({
          topic: event,
          status: 'failed',
          error: err.response && err.response.data ? err.response.data : err.message
        });
      }
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    return res.status(failed ? 207 : 200).json({
      success: failed === 0,
      webhookUrl: WEBHOOK_URL,
      webhookProbe,
      results
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to query existing Printify webhooks',
      details: err.response && err.response.data ? err.response.data : err.message
    });
  }
};

app.all('/api/admin/register-webhooks', registerWebhooksHandler);

app.get('/api/admin/test-telegram', async (req, res) => {
  const timestamp = new Date().toISOString();
  const message = `🧪 <b>בדיקת טלגרם</b>\n\nהודעת בדיקה מהשרת בזמן: ${timestamp}`;
  const result = await telegram.sendMessage(message);

  if (!result || !result.ok) {
    return res.status(500).json({
      success: false,
      error: 'Telegram test message failed',
      telegram: result || { ok: false, reason: 'unknown_error' }
    });
  }

  return res.json({ success: true, telegram: result });
});

app.post('/api/analytics/visit', express.json(), async (req, res) => {
  try {
    const { sessionId, path, locale, currency, source } = req.body || {};
    const ip = getClientIp(req);
    const ua = (req.headers['user-agent'] || 'unknown').slice(0, 120);
    const country = req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || 'Unknown';
    const cacheKey = `${sessionId || 'anon'}|${ip}|${path || '/'}`;
    const now = Date.now();

    for (const [key, timestamp] of visitNotificationCache.entries()) {
      if (now - timestamp > VISIT_CACHE_TTL_MS) visitNotificationCache.delete(key);
    }

    const lastNotifiedAt = visitNotificationCache.get(cacheKey);
    if (!lastNotifiedAt || now - lastNotifiedAt > VISIT_CACHE_TTL_MS) {
      visitNotificationCache.set(cacheKey, now);

      const msg = `👀 <b>כניסה חדשה לחנות</b>\n\n`
        + `<b>Path:</b> ${path || '/'}\n`
        + `<b>Locale/Currency:</b> ${locale || '-'} / ${currency || '-'}\n`
        + `<b>Country:</b> ${country}\n`
        + `<b>Source:</b> ${source || 'web'}\n`
        + `<b>IP:</b> ${ip}\n`
        + `<b>UA:</b> ${ua}`;

      const telegramResult = await telegram.sendMessage(msg);
      if (!telegramResult || !telegramResult.ok) {
        return res.status(500).json({
          success: false,
          deduped: false,
          error: 'Visit event received but Telegram delivery failed',
          telegram: telegramResult || { ok: false, reason: 'unknown_error' }
        });
      }

      return res.json({ success: true, deduped: false, telegram: telegramResult });
    }

    return res.json({ success: true, deduped: true, telegram: { ok: true, skipped: true, reason: 'deduped' } });
  } catch (err) {
    return res.status(500).json({ success: false, error: 'Visit analytics failed' });
  }
});

// --- Webhooks must be before express.json() to parse raw body for Stripe ---
app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const payload = req.body;
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    // If we have a real secret, verify the signature. Otherwise, mock verification for testing.
    if (process.env.STRIPE_WEBHOOK_SECRET) {
      event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } else {
      event = JSON.parse(payload.toString('utf8'));
    }
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const orderId = Number(session.client_reference_id);
    const amount = (session.amount_total || 0) / 100;
    const stripeEventId = event.id || session.id;

    if (!orderId || Number.isNaN(orderId)) {
      return res.json({ received: true, ignored: true, reason: 'invalid_order_id' });
    }

    const canProcess = await reserveWebhookEvent('stripe', stripeEventId);
    if (!canProcess) {
      return res.json({ received: true, duplicate: true, provider: 'stripe', eventId: stripeEventId });
    }
    
    console.log(`[Stripe Webhook] Payment successful for Order #${orderId}`);

    const existingOrder = await dbGetAsync(`SELECT id, status FROM orders WHERE id = ?`, [orderId]);
    if (!existingOrder) {
      return res.json({ received: true, ignored: true, reason: 'order_not_found' });
    }

    if (existingOrder.status === 'paid') {
      return res.json({ received: true, duplicate: true, provider: 'stripe', reason: 'already_paid' });
    }

    await dbRunAsync(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);
    await sendPaymentNotification({ provider: 'Stripe', orderId, amountText: `$${amount.toFixed(2)}` });
    await processPaidOrderFulfillment(orderId, 'Stripe');
  }
  res.json({received: true});
});

app.post('/api/webhooks/payplus', express.json(), async (req, res) => {
  const { transaction_uid, status, custom_field } = req.body;
  const orderId = Number(custom_field); // We pass orderId in custom_field during PayPlus creation

  if (!orderId || Number.isNaN(orderId)) {
    return res.status(400).json({ received: false, error: 'Invalid or missing custom_field(orderId)' });
  }
  
  if (status === 'success') {
    console.log(`[PayPlus Webhook] Payment successful for Order #${orderId}`);
    const eventId = transaction_uid || `payplus:${orderId}:${status}`;
    const canProcess = await reserveWebhookEvent('payplus', eventId);
    if (!canProcess) {
      return res.json({ received: true, duplicate: true, provider: 'payplus' });
    }

    const existingOrder = await dbGetAsync(`SELECT id, status FROM orders WHERE id = ?`, [orderId]);
    if (!existingOrder) {
      return res.json({ received: true, ignored: true, reason: 'order_not_found' });
    }

    if (existingOrder.status === 'paid') {
      return res.json({ received: true, duplicate: true, provider: 'payplus', reason: 'already_paid' });
    }

    await dbRunAsync(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);
    const orderTotalAmount = await getOrderTotalAmount(orderId);
    await sendPaymentNotification({ provider: 'PayPlus/Grow', orderId, amountText: `₪${orderTotalAmount.toFixed(2)}` });

    await processPaidOrderFulfillment(orderId, 'PayPlus');
  }
  
  res.json({received: true});
});

// --- Printify Webhook: Auto-sync when shop products change ---
// Accept GET/HEAD for provider validation pings and POST for event payloads.
app.all('/api/webhooks/printify', express.text({ type: '*/*' }), async (req, res) => {
  try {
    if (req.method === 'HEAD') {
      return res.status(200).end();
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        received: true,
        validation: true,
        endpoint: '/api/webhooks/printify'
      });
    }

    const payload = parsePrintifyPayload(req.body);
    const type = payload.type || req.headers['x-printify-topic'] || 'validation';
    const sourceBody = typeof req.body === 'string' ? req.body : JSON.stringify(payload || {});
    const derivedId = payload.id || payload.event_id || req.headers['x-printify-event-id'] || req.headers['x-request-id'];
    const eventId = derivedId
      ? String(derivedId)
      : `hash:${crypto.createHash('sha256').update(`${type}:${sourceBody}`).digest('hex')}`;

    const canProcess = await reserveWebhookEvent('printify', eventId);
    if (!canProcess) {
      return res.status(200).json({ received: true, duplicate: true, event: type });
    }
    
    console.log(`[Printify Webhook] Event: ${type}`);
    
    // Events that indicate inventory/product changes
    if (type && (type.includes('product') || type.includes('variant') || type.includes('inventory'))) {
      console.log(`🔄 [Printify Webhook] Triggering auto-sync for event: ${type}`);
      
      // Queue the sync async (don't block the response)
      setImmediate(async () => {
        try {
          const count = await printify.syncProducts();
          const eventInfo = `Printify event: ${type}`;
          await telegram.sendMessage(`✅ <b>Sync אוטומטי מ-Printify!</b>\n\n${eventInfo}\n${count} מוצרים סונכרנו בהצלחה.`);
        } catch (err) {
          console.error('❌ Auto-sync failed:', err.message);
          await telegram.sendMessage(`⚠️ <b>Sync אוטומטי נכשל</b>\nEvent: ${type}\nError: ${err.message}`);
        }
      });
    }
    
    res.status(200).json({ received: true, event: type });
  } catch (err) {
    console.error('Printify webhook error:', err.message);
    // Return 200 to avoid webhook validation retries due to transient parsing issues.
    res.status(200).json({ received: false, error: 'Webhook parse error' });
  }
});

app.use(express.json());

// Pulse Check Route
app.get('/', (req, res) => {
  res.send('Server is running and connected to Meni (Telegram).');
});

// Geolocation and config helper
app.get('/api/geolocation', (req, res) => {
  const country = req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || 'IL';
  const isIsrael = country === 'IL';
  res.json({
    country,
    currency: isIsrael ? 'ILS' : 'USD',
    locale: isIsrael ? 'he' : 'en',
    exchangeRate: pricingEngine.exchangeRateUSDILS
  });
});

// Get all products (list view - includes backImageUrl for hover effect and dynamic USD prices)
app.get('/api/products', (req, res) => {
  db.all("SELECT id, title, description, price, imageUrl, backImageUrl, stock, type FROM products", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // Prefer real Printify catalog and hide local mock products when Printify items exist.
    const hasPrintifyProducts = rows.some(r => r.type === 'printify');
    const visibleRows = hasPrintifyProducts ? rows.filter(r => r.type === 'printify') : rows;
    
    // Add priceUSD dynamically using the live rate
    const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
    const productsWithUSD = visibleRows.map(r => ({
      ...r,
      priceUSD: parseFloat((r.price / exchangeRate).toFixed(2))
    }));
    
    res.json(productsWithUSD);
  });
});

// Get single product with full details + variants (for PDP)
app.get('/api/products/:id', (req, res) => {
  const { id } = req.params;

  const enrichLiveVariantInventory = async (variants, printifyId) => {
    const liveSnapshot = await printify.getLiveProductSnapshot(printifyId);
    if (!liveSnapshot || !Array.isArray(liveSnapshot.variants)) {
      return { variants, liveUpdatedAt: null };
    }

    const mapByPrintifyVariantId = new Map(
      liveSnapshot.variants
        .filter((variant) => variant && variant.printifyVariantId)
        .map((variant) => [String(variant.printifyVariantId), variant])
    );

    const mergedVariants = variants.map((variant) => {
      const liveVariant = mapByPrintifyVariantId.get(String(variant.printifyVariantId || ''));
      if (!liveVariant) return variant;
      return {
        ...variant,
        stockQty: liveVariant.stockQty,
        isAvailable: liveVariant.isAvailable,
        isEnabled: liveVariant.isEnabled,
      };
    });

    return {
      variants: mergedVariants,
      liveUpdatedAt: liveSnapshot.updatedAt || null,
    };
  };

  const buildOperationalNotice = (variants, liveUpdatedAt) => {
    const stockValues = variants
      .map((variant) => Number(variant.stockQty))
      .filter((value) => Number.isFinite(value));

    const inStockVariantCount = variants.filter((variant) => Number(variant.isAvailable) !== 0).length;
    const lowStockVariantCount = stockValues.filter((value) => value > 0 && value < 5).length;
    const allOutOfStock = inStockVariantCount === 0 || (stockValues.length > 0 && stockValues.every((value) => value === 0));

    const productionRangeDays = allOutOfStock ? [4, 8] : [2, 5];
    const shippingRangeDays = allOutOfStock ? [10, 16] : [7, 14];

    return {
      syncedAt: liveUpdatedAt || new Date().toISOString(),
      isLiveInventory: Boolean(liveUpdatedAt),
      allOutOfStock,
      lowStockVariantCount,
      inStockVariantCount,
      productionRangeDays,
      shippingRangeDays,
    };
  };

  (async () => {
    try {
      const row = await dbGetAsync("SELECT * FROM products WHERE id = ?", [id]);
      if (!row) return res.status(404).json({ error: 'Product not found' });

      let imageData = { allImages: [], variantImageMap: {} };
      try {
        imageData = JSON.parse(row.images || '{}');
        if (!imageData.allImages) imageData.allImages = [];
        if (!imageData.variantImageMap) imageData.variantImageMap = {};
      } catch {
        imageData = { allImages: [], variantImageMap: {} };
      }

      const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
      row.priceUSD = parseFloat((row.price / exchangeRate).toFixed(2));

      const storedVariants = await dbAllAsync("SELECT * FROM product_variants WHERE productId = ? AND isEnabled = 1", [id]);
      const { variants: mergedVariants, liveUpdatedAt } = await enrichLiveVariantInventory(storedVariants || [], row.printifyId);

      const colors = {};
      const sizes = new Set();
      const imagesByColor = {};

      mergedVariants.forEach((variant) => {
        if (variant.color && !colors[variant.color]) {
          colors[variant.color] = { hex: variant.colorHex || '#000', name: variant.color };
          if (variant.imageUrl) {
            imagesByColor[variant.color] = [{ src: variant.imageUrl, position: 'front' }];
          } else if (imageData.variantImageMap[variant.printifyVariantId]) {
            imagesByColor[variant.color] = imageData.variantImageMap[variant.printifyVariantId];
          } else {
            imagesByColor[variant.color] = imageData.allImages;
          }
        }

        if (variant.size) sizes.add(variant.size);
      });

      row.variants = mergedVariants.map((variant) => ({
        ...variant,
        priceUSD: parseFloat((variant.price / exchangeRate).toFixed(2))
      }));
      row.colors = Object.values(colors);
      row.sizes = Array.from(sizes);
      row.imagesByColor = imagesByColor;
      row.images = imageData.allImages;
      row.operationalNotice = buildOperationalNotice(row.variants, liveUpdatedAt);

      return res.json(row);
    } catch (error) {
      return res.status(500).json({ error: error.message || 'Failed to load product' });
    }
  })();
});

// Get last sync status
app.get('/api/admin/sync-status', (req, res) => {
  const db = require('./db');
  db.all("SELECT type, COUNT(*) as count, MAX(id) as latestId FROM products GROUP BY type", [], (err, rows) => {
    const stats = {};
    if (rows) {
      rows.forEach(r => {
        stats[r.type] = r.count;
      });
    }
    
    res.json({
      lastSyncTime: global.lastSyncTime || 'Never',
      nextSyncTime: 'Every hour (UTC)',
      statistics: stats,
      webhook: '/api/webhooks/printify (Printify can send events here)'
    });
  });
});

// Active Coupon State (In-Memory for simplicity, could be DB)
let currentActiveCoupon = null;

// Get Active Coupon
app.get('/api/coupons/active', (req, res) => {
  res.json({ coupon: currentActiveCoupon });
});

app.post('/api/leads', async (req, res) => {
  try {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address' });
    }

    const existingLead = await dbGetAsync(`SELECT id FROM leads WHERE email = ?`, [email]);
    if (existingLead) {
      return res.status(400).json({ error: 'This email is already registered' });
    }

    let promoCode = null;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const candidate = generatePromoCode();
      const existingCode = await dbGetAsync(`SELECT id FROM leads WHERE promo_code = ?`, [candidate]);
      if (!existingCode) {
        promoCode = candidate;
        break;
      }
    }

    if (!promoCode) {
      return res.status(500).json({ error: 'Failed to generate promo code' });
    }

    await dbRunAsync(
      `INSERT INTO leads (email, promo_code, is_used) VALUES (?, ?, 0)`,
      [email, promoCode]
    );

    await telegram.sendMessage(`🔥 <b>New Lead</b>: ${email} | <b>Code Generated</b>: ${promoCode}`).catch(() => null);

    return res.json({ success: true, promoCode });
  } catch (err) {
    if (String(err.message || '').includes('UNIQUE constraint failed: leads.email')) {
      return res.status(400).json({ error: 'This email is already registered' });
    }

    console.error('Lead registration failed:', err.message);
    return res.status(500).json({ error: 'Lead registration failed' });
  }
});

app.post('/api/promo/validate', async (req, res) => {
  try {
    const promoCode = normalizePromoCode(req.body?.promoCode);
    if (!promoCode) {
      return res.status(400).json({ valid: false, error: 'Promo code is required' });
    }

    const lead = await validateLeadPromoCode(promoCode);
    if (!lead) {
      return res.status(400).json({ valid: false, error: 'Promo code is invalid or already used' });
    }

    return res.json({ valid: true, promoCode: lead.promo_code, discountRate: LEAD_PROMO_DISCOUNT_RATE });
  } catch (err) {
    console.error('Promo validation failed:', err.message);
    return res.status(500).json({ valid: false, error: 'Promo validation failed' });
  }
});

// Admin Set Coupon (Triggered by Meni Telegram Webhook)
app.post('/api/admin/set-coupon', (req, res) => {
  const { code, discount_pct, duration_hours } = req.body;
  if (!code || !discount_pct) {
    currentActiveCoupon = null; // Clear coupon if empty
    return res.json({ success: true, message: 'Coupon cleared.' });
  }

  currentActiveCoupon = { code, discount_pct };
  
  // Clear coupon after duration
  if (duration_hours) {
    setTimeout(() => {
      if (currentActiveCoupon && currentActiveCoupon.code === code) {
        currentActiveCoupon = null;
        console.log(`Coupon ${code} expired.`);
      }
    }, duration_hours * 60 * 60 * 1000);
  }

  res.json({ success: true, message: `Coupon ${code} set to ${discount_pct}% off.` });
});

// Admin Printify Sync
app.post('/api/admin/printify-sync', async (req, res) => {
  try {
    const productsSynced = await printify.syncProducts();
    res.json({ success: true, count: productsSynced });
  } catch (error) {
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Admin Force Price Update
app.post('/api/admin/update-prices', async (req, res) => {
  try {
    await pricingEngine.runPricingUpdate();
    res.json({ success: true, message: 'Prices updated to target values.' });
  } catch (error) {
    res.status(500).json({ error: 'Price update failed' });
  }
});

// Contact Form Endpoint
app.post('/api/contact', async (req, res) => {
  const { name, email, message } = req.body;
  if (!name || !email || !message) return res.status(400).json({ error: 'Missing fields' });
  
  await telegram.notifySupportMessage(name, email, message);
  res.json({ success: true, message: 'Message sent to Meni.' });
});

// General Order Creation Helper
const createPendingOrder = async (customerName, customerEmail, address, items, couponCode) => {
  const validatedItems = await resolveValidatedOrderItems(items);
  const pricing = calculateOrderPricing(validatedItems, couponCode);
  const orderInsert = await dbRunAsync(
    `INSERT INTO orders (customerName, customerEmail, address, totalAmount, status) VALUES (?, ?, ?, ?, ?)`,
    [customerName, customerEmail, address, pricing.totalAmount, 'pending_payment']
  );
  const orderId = orderInsert.lastID;

  for (const item of validatedItems) {
    await dbRunAsync(
      `INSERT INTO order_items (orderId, productId, variantId, quantity, price, selectedColor, selectedSize) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [orderId, item.id, item.variantId || null, item.quantity, item.price, item.selectedColor || null, item.selectedSize || null]
    );
  }

  telegram.notifyNewOrder(orderId, customerName, pricing.totalAmount, validatedItems).catch(() => null);

  return { orderId, pricing, items: validatedItems };
};

app.get('/api/paypal/config', (req, res) => {
  if (!process.env.PAYPAL_CLIENT_ID) {
    return res.status(500).json({ error: 'PayPal client is not configured on the server' });
  }

  return res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
});

app.post('/api/paypal/create-order', async (req, res) => {
  const {
    customerName,
    customerEmail,
    address,
    items,
    couponCode,
    promoCode,
    currency,
  } = req.body || {};

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart items are required' });
  }

  if (!customerName || !customerEmail || !address) {
    return res.status(400).json({ error: 'Shipping details are required' });
  }

  try {
    const requestedCurrency = normalizePayPalCurrency(currency);
    const normalizedPromoCode = normalizePromoCode(promoCode);
    let validatedLeadPromo = null;
    if (normalizedPromoCode) {
      validatedLeadPromo = await validateLeadPromoCode(normalizedPromoCode);
      if (!validatedLeadPromo) {
        return res.status(400).json({ error: 'Promo code is invalid or already used' });
      }
    }

    const { orderId, pricing } = await createPendingOrder(customerName, customerEmail, address, items, couponCode);

    const promoDiscountAmount = validatedLeadPromo
      ? roundCurrency(pricing.totalAmount * LEAD_PROMO_DISCOUNT_RATE)
      : 0;
    const discountedTotal = Math.max(0, roundCurrency(pricing.totalAmount - promoDiscountAmount));

    if (validatedLeadPromo) {
      await dbRunAsync(
        `UPDATE orders SET totalAmount = ?, promoCode = ?, promoDiscount = ? WHERE id = ?`,
        [discountedTotal, validatedLeadPromo.promo_code, promoDiscountAmount, orderId]
      );
    }

    const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
    const totalInRequestedCurrency = requestedCurrency === 'USD'
      ? (discountedTotal / exchangeRate)
      : discountedTotal;

    const amount = totalInRequestedCurrency.toFixed(2);
    const accessToken = await getPayPalAccessToken();
    const paypalOrder = await createPayPalOrder(accessToken, {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: String(orderId),
          custom_id: String(orderId),
          amount: {
            currency_code: requestedCurrency,
            value: amount,
          },
          description: `Drip Street order #${orderId}`,
        },
      ],
      application_context: {
        user_action: 'PAY_NOW',
      },
    });

    return res.json({
      success: true,
      orderID: paypalOrder.id,
      orderId,
      currency: requestedCurrency,
      amount,
      promoCode: validatedLeadPromo ? validatedLeadPromo.promo_code : null,
    });
  } catch (err) {
    console.error('PayPal create-order failed:', err.response?.data || err.message);
    const statusCode = String(err.message || '').includes('Variant mismatch') || String(err.message || '').includes('valid product id')
      ? 400
      : 500;
    return res.status(statusCode).json({ error: err.message || 'Failed to create PayPal order' });
  }
});

app.post('/api/paypal/capture-order', async (req, res) => {
  const { orderID } = req.body || {};

  if (!orderID || typeof orderID !== 'string') {
    return res.status(400).json({ error: 'Valid orderID is required' });
  }

  try {
    const accessToken = await getPayPalAccessToken();
    const captureData = await capturePayPalOrder(accessToken, orderID);

    if (captureData.status !== 'COMPLETED') {
      return res.status(400).json({
        success: false,
        error: 'PayPal payment is not completed',
        status: captureData.status,
      });
    }

    const purchaseUnit = captureData.purchase_units && captureData.purchase_units[0];
    const capture = purchaseUnit?.payments?.captures?.[0];
    const localOrderId = Number(purchaseUnit?.custom_id || purchaseUnit?.reference_id);

    if (!localOrderId || Number.isNaN(localOrderId)) {
      return res.status(400).json({ success: false, error: 'Could not map PayPal order to local order' });
    }

    const existingOrder = await dbGetAsync(`SELECT id, status, totalAmount, promoCode FROM orders WHERE id = ?`, [localOrderId]);
    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (existingOrder.status === 'paid') {
      return res.json({ success: true, duplicate: true, orderId: localOrderId });
    }

    const captureCurrency = String(capture?.amount?.currency_code || '').toUpperCase();
    const captureValue = Number(capture?.amount?.value || 0);
    const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
    const expectedValue = captureCurrency === 'USD'
      ? (Number(existingOrder.totalAmount || 0) / exchangeRate)
      : Number(existingOrder.totalAmount || 0);

    if (!Number.isFinite(captureValue) || Math.abs(captureValue - expectedValue) > 0.02) {
      return res.status(400).json({
        success: false,
        error: 'Captured amount mismatch',
      });
    }

    const captureId = capture?.id || orderID;
    const canProcess = await reserveWebhookEvent('paypal', captureId);
    if (!canProcess) {
      return res.json({ success: true, duplicate: true, orderId: localOrderId });
    }

    await dbRunAsync(`UPDATE orders SET status = 'paid' WHERE id = ?`, [localOrderId]);

    if (existingOrder.promoCode) {
      await consumeLeadPromoCode(existingOrder.promoCode);
    }

    const amountText = captureCurrency === 'USD'
      ? `$${captureValue.toFixed(2)}`
      : `₪${captureValue.toFixed(2)}`;

    await sendPaymentNotification({ provider: 'PayPal', orderId: localOrderId, amountText });
    await processPaidOrderFulfillment(localOrderId, 'PayPal');

    return res.json({
      success: true,
      orderId: localOrderId,
      status: captureData.status,
    });
  } catch (err) {
    console.error('PayPal capture-order failed:', err.response?.data || err.message);
    return res.status(500).json({ error: 'Failed to capture PayPal order' });
  }
});

// Checkout via Stripe (USD)
app.post('/api/checkout/stripe', async (req, res) => {
  const { customerName, customerEmail, address, items, couponCode } = req.body;
  
  try {
    const { orderId, pricing } = await createPendingOrder(customerName, customerEmail, address, items, couponCode);
    const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
    const stripeAmountCents = Math.max(50, Math.round((pricing.totalAmount / exchangeRate) * 100));
    
    // Create Stripe Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: `Drip Street bundle order #${orderId}` },
          unit_amount: stripeAmountCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      success_url: `${FRONTEND_BASE_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_BASE_URL}/cart`,
      client_reference_id: orderId.toString(),
      customer_email: customerEmail,
    });

    res.json({ success: true, paymentUrl: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initialize Stripe checkout' });
  }
});

// Checkout via PayPlus/Grow (NIS)
app.post('/api/checkout/payplus', async (req, res) => {
  const { customerName, customerEmail, address, items, couponCode } = req.body;
  
  try {
    const { orderId, pricing } = await createPendingOrder(customerName, customerEmail, address, items, couponCode);
    
    // Integration logic for PayPlus
    // Normally we make an axios.post to api.payplus.co.il with payload
    const hasPayPlusKey = process.env.PAYPLUS_API_KEY && process.env.PAYPLUS_API_KEY !== 'YOUR_PAYPLUS_KEY';
    
    if (hasPayPlusKey) {
      // Execute actual PayPlus API call here
    }

    // Return a mocked URL for demonstration if no keys
    const mockPaymentUrl = `https://payment.payplus.co.il/mock-checkout/${orderId}`;
    res.json({ success: true, paymentUrl: mockPaymentUrl, amount: pricing.totalAmount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initialize PayPlus checkout' });
  }
});

const extractSessionIdFromText = (text) => {
  const value = String(text || '');
  const match = value.match(/session_[a-z0-9_-]+/i);
  return match ? match[0] : null;
};

const appendAdminReplyToSession = async (sessionId, messageText) => {
  if (!sessionId || !messageText) return false;

  const session = await dbGetAsync("SELECT * FROM chat_sessions WHERE id = ?", [sessionId]);
  if (!session) return false;

  let history = [];
  try {
    history = JSON.parse(session.history || '[]');
  } catch {
    history = [];
  }

  history.push({ sender: 'bot', text: messageText, timestamp: new Date().toISOString(), source: 'admin_telegram' });
  await dbRunAsync("UPDATE chat_sessions SET history = ?, status = 'escalated', updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [JSON.stringify(history), sessionId]);
  return true;
};

app.post('/api/webhooks/telegram', async (req, res) => {
  try {
    const update = req.body || {};
    const message = update.message;
    if (!message || !message.text) {
      return res.json({ received: true, ignored: true, reason: 'no_text_message' });
    }

    if (telegram.chatId && String(message.chat?.id || '') !== String(telegram.chatId)) {
      return res.json({ received: true, ignored: true, reason: 'unauthorized_chat' });
    }

    const commandMatch = String(message.text).match(/^\/reply\s+(session_[a-z0-9_-]+)\s+([\s\S]+)/i);
    const sessionId = commandMatch
      ? commandMatch[1]
      : extractSessionIdFromText(message.reply_to_message?.text) || extractSessionIdFromText(message.text);

    if (!sessionId) {
      return res.json({ received: true, ignored: true, reason: 'missing_session_id' });
    }

    const replyText = commandMatch
      ? commandMatch[2].trim()
      : String(message.text || '').replace(sessionId, '').trim();

    if (!replyText) {
      return res.json({ received: true, ignored: true, reason: 'missing_reply_text' });
    }

    const updated = await appendAdminReplyToSession(sessionId, replyText);
    return res.json({ received: true, routed: updated, sessionId });
  } catch (err) {
    console.error('Telegram webhook routing failed:', err.message);
    return res.status(500).json({ received: false, error: 'telegram_webhook_failed' });
  }
});

// Chat bot APIs
app.post('/api/chat/message', (req, res) => {
  const { sessionId, message, customerName } = req.body;
  if (!sessionId || !message) return res.status(400).json({ error: 'Missing parameters' });

  // Get or Create session in DB
  db.get("SELECT * FROM chat_sessions WHERE id = ?", [sessionId], async (err, session) => {
    let history = [];
    if (session) {
      try { history = JSON.parse(session.history || '[]'); } catch(e) { history = []; }
    }
    
    // Add user message to history
    history.push({ sender: 'user', text: message, timestamp: new Date().toISOString() });

    let botResponse = { text: "נציג אנושי עודכן והוא יחזור אליך בהקדם.", status: "escalated" };
    if (!session || session.status !== 'escalated') {
      botResponse = await meniChat.processMessage(sessionId, message, customerName);
    }
    
    history.push({ sender: 'bot', text: botResponse.text, timestamp: new Date().toISOString() });

    // Save session back to DB
    const status = botResponse.status || 'bot';
    const historyJSON = JSON.stringify(history);
    
    if (session) {
      db.run("UPDATE chat_sessions SET history = ?, status = ?, updatedAt = CURRENT_TIMESTAMP WHERE id = ?", [historyJSON, status, sessionId]);
    } else {
      db.run("INSERT INTO chat_sessions (id, customerName, status, history) VALUES (?, ?, ?, ?)", [sessionId, customerName || 'Guest', status, historyJSON]);
    }

    res.json({
      text: botResponse.text,
      status: status,
      history: history
    });
  });
});

app.get('/api/chat/history/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  db.get("SELECT * FROM chat_sessions WHERE id = ?", [sessionId], (err, session) => {
    if (err) return res.status(500).json({ error: err.message });
    if (!session) return res.json({ history: [], status: 'bot' });
    
    try {
      const history = JSON.parse(session.history || '[]');
      res.json({ history, status: session.status });
    } catch(e) {
      res.json({ history: [], status: 'bot' });
    }
  });
});

// Start background cron jobs
pricingEngine.start();

app.listen(PORT, () => {
  console.log(`🚀 Headless E-commerce Backend running on http://localhost:${PORT}`);
  
  // ---- AUTO-SYNC INITIALIZATION ----
  const performSync = async () => {
    try {
      const hasPrintifyKey = process.env.PRINTIFY_API_TOKEN && process.env.PRINTIFY_API_TOKEN !== 'YOUR_PRINTIFY_TOKEN';
      if (hasPrintifyKey) {
        const count = await printify.syncProducts();
        const timestamp = new Date().toLocaleString('he-IL');
        global.lastSyncTime = timestamp; // Track for status endpoint
        console.log(`✅ Sync complete [${timestamp}]: ${count} Printify products synced.`);
        return count;
      }
    } catch (err) {
      console.error('⚠️ Sync failed:', err.message);
      telegram.sendMessage(`⚠️ <b>Printify Sync Error</b>\n\nTime: ${new Date().toLocaleString('he-IL')}\nError: ${err.message}`).catch(console.error);
    }
  };
  
  // Auto-sync on startup (critical for Render where DB is ephemeral)
  setTimeout(async () => {
    console.log('🔄 Auto-syncing Printify products on startup...');
    await performSync();
  }, 3000);
  
  // ---- SCHEDULED SYNC: Every hour ----
  const cron = require('node-cron');
  try {
    const syncJob = cron.schedule('0 * * * *', async () => {
      console.log('⏰ [Scheduled Sync] Running hourly Printify sync...');
      await performSync();
    }, { scheduled: true });
    
    console.log('✅ Scheduled sync configured: Every hour (UTC)');
  } catch (cronErr) {
    console.warn('⚠️ Cron not available (dev environment):', cronErr.message);
  }
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Exception:', err);
  telegram.sendMessage(`🚨 <b>Critical Server Error</b>\n\nRoute: ${req.url}\nError: ${err.message}`).catch(console.error);
  res.status(500).json({ error: 'Internal Server Error' });
});
