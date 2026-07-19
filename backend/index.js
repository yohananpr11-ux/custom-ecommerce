require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const crypto = require('crypto');
const db = require('./db');
const telegram = require('./services/telegram');
const pricingEngine = require('./services/pricing');
const printify = require('./services/printify');
if (printify.token === 'YOUR_PRINTIFY_TOKEN_ROTATED') {
  printify.token = 'YOUR_PRINTIFY_TOKEN';
  process.env.PRINTIFY_API_TOKEN = 'YOUR_PRINTIFY_TOKEN';
}
const { validatePaypalCaptureAgainstExpectation } = require('./lib/paypal-capture-validation');
const designPipeline = require('./services/design-pipeline');
const mockupPipeline = require('./services/mockups');
const meniChat = require('./services/meni');
const emailService = require('./services/emailService');
const feedsRouter = require('./routes/feeds');
const cartsRouter = require('./routes/carts');
const marketingWebhooksRouter = require('./routes/marketing-webhooks');
const adminReportsRouter = require('./routes/admin-reports');
const { seedHardwareCatalog } = require('./seed_cj_product.cjs');
// Phase 3: Multi-Vendor fulfillment router
const fulfillment = require('./services/fulfillment');

const app = express();
const PORT = process.env.PORT || 4000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');
const PAYPAL_API_BASE = 'https://api-m.paypal.com';
const PAYPAL_SUPPORTED_CURRENCIES = new Set(['USD', 'ILS']);
const ENGLISH_SHIPPING_TEXT_REGEX = /^[A-Za-z0-9\s.,'\-/#()]+$/;
const DEFAULT_USD_CONVERSION_RATE = 3.6;

const resolveUsdPrice = (price, storedPriceUSD = null) => {
  const stored = Number(storedPriceUSD);
  if (Number.isFinite(stored) && stored > 0) {
    return Number(stored.toFixed(2));
  }

  const exchangeRate = pricingEngine.exchangeRateUSDILS || DEFAULT_USD_CONVERSION_RATE;
  return parseFloat((Number(price || 0) / exchangeRate).toFixed(2));
};

const hasConfiguredValue = (value) => {
  const normalized = String(value || '').trim();
  if (!normalized) return false;
  return !/(YOUR_|CHANGE_ME|placeholder|example|mock)/i.test(normalized);
};

const hasPayPalCheckoutConfig = () => (
  hasConfiguredValue(process.env.PAYPAL_CLIENT_ID)
  && hasConfiguredValue(process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET)
);

const hasStripeCheckoutConfig = () => {
  const key = String(process.env.STRIPE_SECRET_KEY || '').trim();
  return key.startsWith('sk_') && hasConfiguredValue(key);
};

const hasPayPlusCheckoutConfig = () => (
  hasConfiguredValue(process.env.PAYPLUS_API_KEY)
  && hasConfiguredValue(process.env.PAYPLUS_SECRET_KEY)
);

const isPrintifySyncEnabled = () => process.env.ENABLE_PRINTIFY_SYNC === 'true';

// ISO-3166 alpha-2 codes for countries Printify supports for shipping (subset of common destinations).
const PRINTIFY_SUPPORTED_COUNTRIES = new Set([
  'IL','US','GB','CA','AU','DE','FR','IT','ES','NL','BE','SE','NO','DK','FI','CH','AT','IE',
  'PT','PL','CZ','GR','RO','HU','LU','NZ','JP','SG','HK','KR','BR','MX','AR','CL','ZA','IN',
  'AE','SA','TR','RU','UA','BG','HR','SI','SK','LT','LV','EE','IS','MT','CY','MY','TH','ID','PH','VN','TW','EG','MA',
]);

const REGION_REQUIRED_COUNTRIES = new Set(['US','CA','AU']);

// Soft phone validation: must contain at least 7 digits after stripping non-digits, max 20.
const isValidPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length >= 7 && digits.length <= 20;
};

// Structured shipping validator. Backward-compatible: also accepts legacy single-string address.
const validateShippingDetails = (input = {}) => {
  // Legacy 3-arg shape: validateShippingDetails(name, email, address)
  if (typeof input === 'string') {
    const [a, b, c] = arguments;
    input = { customerName: a, customerEmail: b, address: c };
  }

  const trim = (v) => String(v == null ? '' : v).trim();
  const firstName = trim(input.firstName);
  const lastName  = trim(input.lastName);
  const customerName = trim(input.customerName) || `${firstName} ${lastName}`.trim();
  const customerEmail = trim(input.customerEmail || input.email);
  const phone = trim(input.phone);
  const addressLine1 = trim(input.addressLine1 || input.address1);
  const addressLine2 = trim(input.addressLine2 || input.address2);
  const city = trim(input.city);
  const region = trim(input.region || input.state);
  const postalCode = trim(input.postalCode || input.zip);
  const countryRaw = trim(input.country).toUpperCase();
  const country = countryRaw.length === 2 ? countryRaw : 'IL';

  // Legacy: a single "address" string was passed
  const legacyAddress = trim(input.address);

  // Email format
  if (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
    throw new Error('Valid email is required');
  }

  // Name (combined)
  if (!customerName) {
    throw new Error('Full name is required');
  }
  if (!ENGLISH_SHIPPING_TEXT_REGEX.test(customerName) || !/[A-Za-z]/.test(customerName)) {
    throw new Error('Shipping name must be in English only');
  }

  // Country
  if (!country || !PRINTIFY_SUPPORTED_COUNTRIES.has(country)) {
    throw new Error('A valid shipping country must be selected');
  }

  // Structured-mode validation (preferred path)
  const hasStructured = addressLine1 || city || postalCode || phone;
  if (hasStructured) {
    if (!addressLine1) throw new Error('Street address is required');
    if (!city) throw new Error('City is required');
    if (!postalCode) throw new Error('Postal/ZIP code is required');
    if (!phone || !isValidPhone(phone)) {
      throw new Error('A valid phone number is required (carriers may contact you for delivery)');
    }
    if (REGION_REQUIRED_COUNTRIES.has(country) && !region) {
      throw new Error(`State/Region is required for ${country}`);
    }

    // English-only on address fields (Printify/carriers are not consistent with non-Latin)
    for (const [label, value] of [['Street address', addressLine1], ['Address line 2', addressLine2], ['City', city], ['State/Region', region]]) {
      if (value && (!ENGLISH_SHIPPING_TEXT_REGEX.test(value) || !/[A-Za-z0-9]/.test(value))) {
        throw new Error(`${label} must be in English (Latin) characters only`);
      }
    }
  } else {
    // Legacy single-string address fallback (transitional — should be removed once frontend ships)
    if (!legacyAddress) throw new Error('Shipping address is required');
    if (!ENGLISH_SHIPPING_TEXT_REGEX.test(legacyAddress) || !/[A-Za-z]/.test(legacyAddress)) {
      throw new Error('Shipping address must be in English only');
    }
  }

  // Build a readable single-line address for the legacy "address" column
  const compactAddress = hasStructured
    ? [addressLine1, addressLine2, city, region, postalCode, country].filter(Boolean).join(', ')
    : legacyAddress;

  return {
    customerName,
    customerEmail,
    address: compactAddress,
    firstName: firstName || (customerName.split(' ')[0] || ''),
    lastName: lastName || (customerName.split(' ').slice(1).join(' ') || ''),
    phone,
    addressLine1,
    addressLine2,
    city,
    region,
    postalCode,
    country,
  };
};

const normalizePayPalCurrency = (currency) => {
  const normalized = String(currency || '').toUpperCase();
  return PAYPAL_SUPPORTED_CURRENCIES.has(normalized) ? normalized : 'ILS';
};

const getPayPalAccessToken = async () => {
  const clientId = process.env.PAYPAL_CLIENT_ID;
  const clientSecret = process.env.PAYPAL_CLIENT_SECRET || process.env.PAYPAL_SECRET;

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
const FREE_SHIPPING_THRESHOLD_NIS = 249;

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
  const shippingCost = subtotalAfterDiscounts >= FREE_SHIPPING_THRESHOLD_NIS
    ? 0
    : (subtotalAfterDiscounts > 0 ? SHIPPING_COST_NIS : 0);
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

const upsertDesignJobImageAsync = ({ designJobId, view, url, isCustomMockup }) => dbRunAsync(
  `INSERT INTO product_images (design_job_id, product_variant_id, view, url, is_custom_mockup, createdAt, updatedAt)
   VALUES (?, NULL, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
   ON CONFLICT(design_job_id, view)
   DO UPDATE SET
     url = excluded.url,
     is_custom_mockup = excluded.is_custom_mockup,
     updatedAt = CURRENT_TIMESTAMP`,
  [designJobId, view, url, isCustomMockup ? 1 : 0]
);

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

    const product = await dbGetAsync(`SELECT id, title, price, priceUSD, printifyId, supplier_id FROM products WHERE id = ?`, [productId]);
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

    // SECURITY: price must always come from the trusted product/variant record
    // in the database — never from the client-supplied rawItem.price. A prior
    // version fell back to trusting the client price for any item without a
    // matched variant (e.g. jewelry SKUs with no color/size), allowing an
    // attacker to check out at an arbitrary price.
    const resolvedPrice = (resolvedVariant && Number.isFinite(Number(resolvedVariant.price)))
      ? Number(resolvedVariant.price)
      : Number(product.price);

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
      // Phase 3: snapshot supplier_id at order-creation time
      supplier_id: product.supplier_id || 'printify',
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
    await telegram.sendMessage(`⚠️ <b>Payment captured but cumulative total calculation failed</b>\nOrder #${orderId}`).catch(() => null);
  }
};

const processPaidOrderFulfillment = async (orderId, providerTag) => {
  const order = await dbGetAsync(`SELECT * FROM orders WHERE id = ?`, [orderId]);
  if (!order) return;

  // Phase 3.4 (hardened): atomic claim via a single UPDATE...RETURNING. This
  // both claims eligible rows and reports exactly which ones THIS invocation
  // won, in one statement — SQLite serializes writers, so once one
  // invocation's UPDATE commits, a second concurrent invocation's WHERE
  // clause matches zero of those same rows (they're no longer NULL/pending).
  // Replaces a prior SELECT-then-UPDATE-by-id pattern where two concurrent
  // invocations could both see the same "pending" rows before either UPDATE
  // landed, and both proceed to dispatch the same items. Verified: reverting
  // to that old pattern makes tests/fulfillment-concurrency.test.js fail
  // (double-dispatch reproduced), confirming this fix and that test are real.
  const claimed = await dbAllAsync(
    `UPDATE order_items
     SET fulfillment_status = 'processing'
     WHERE orderId = ? AND (fulfillment_status IS NULL OR fulfillment_status = 'pending')
     RETURNING id`,
    [orderId]
  );
  if (!claimed.length) return;

  const claimedIds = claimed.map((row) => row.id);
  const items = await dbAllAsync(
    `SELECT oi.*, p.title, oi.supplier_id, p.printifyId AS printifyProductId, pv.printifyVariantId
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.productId
     LEFT JOIN product_variants pv ON pv.id = oi.variantId
     WHERE oi.id IN (${claimedIds.map(() => '?').join(',')})`,
    claimedIds
  );

  const subtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
  const shipping = subtotal >= FREE_SHIPPING_THRESHOLD_NIS ? 0 : (subtotal > 0 ? SHIPPING_COST_NIS : 0);
  const total = Number(order.totalAmount) || 0;
  const discount = Math.max(0, roundCurrency(subtotal + shipping - total));

  const emailItems = items.map((item) => ({
    title: item.title || 'Drip Street Item',
    color: item.selectedColor || null,
    size: item.selectedSize || null,
    quantity: item.quantity,
    price: item.price,
  }));

  if (isSimulationOrder(order)) {
    await telegram.sendMessage(`🧪 <b>Simulation:</b> Order #${orderId} marked as paid via ${providerTag} without sending to Printify.`).catch(() => null);
    
    // Increment attempts
    await dbRunAsync(`UPDATE orders SET emailAttempts = COALESCE(emailAttempts, 0) + 1 WHERE id = ?`, [orderId]).catch(() => null);

    // Send email confirmation for simulation orders to facilitate testing and validation
    await emailService.sendOrderConfirmationEmail(
      order.customerEmail,
      orderId,
      order.customerName,
      emailItems,
      { subtotal: roundCurrency(subtotal), shipping, discount, total },
      order.address
    ).then(async (res) => {
      if (res && res.ok) {
        await dbRunAsync(`UPDATE orders SET emailSent = 1 WHERE id = ?`, [orderId]);
      }
    }).catch((e) => console.error(`[email] failed to send order confirmation email for #${orderId}:`, e.message));
    return;
  }

  // Build structured shipping object for Printify from the stored order row.
  // Falls back to splitting the legacy "address" string for orders created before the structured-shipping migration.
  const fallbackParts = String(order.address || '').split(',').map((part) => part.trim()).filter(Boolean);
  const shippingDestination = {
    customerName: order.customerName || `${order.firstName || ''} ${order.lastName || ''}`.trim(),
    customerEmail: order.customerEmail,
    firstName: order.firstName || (String(order.customerName || '').split(' ')[0] || 'Customer'),
    lastName: order.lastName || (String(order.customerName || '').split(' ').slice(1).join(' ') || 'Customer'),
    phone: order.phone || '',
    addressLine1: order.addressLine1 || fallbackParts[0] || '',
    addressLine2: order.addressLine2 || '',
    city: order.city || fallbackParts[1] || '',
    region: order.region || '',
    postalCode: order.postalCode || '',
    country: (order.country || 'IL').toUpperCase(),
  };

  try {
    // Phase 3: Multi-Vendor — route items to the correct supplier(s)
    await fulfillment.routeOrderToSupplier(orderId, shippingDestination, items);

    // Increment attempts
    await dbRunAsync(`UPDATE orders SET emailAttempts = COALESCE(emailAttempts, 0) + 1 WHERE id = ?`, [orderId]).catch(() => null);

    await emailService.sendOrderConfirmationEmail(
      order.customerEmail,
      orderId,
      order.customerName,
      emailItems,
      { subtotal: roundCurrency(subtotal), shipping, discount, total },
      order.address
    ).then(async (res) => {
      if (res && res.ok) {
        await dbRunAsync(`UPDATE orders SET emailSent = 1 WHERE id = ?`, [orderId]);
      }
    }).catch((e) => console.error(`[email] failed to send order confirmation email for #${orderId}:`, e.message));
  } catch (pErr) {
    // Phase 3.4: Revert lock to 'failed' and store error details for admin triage
    await dbRunAsync(
      `UPDATE order_items SET fulfillment_status = 'failed', fulfillment_ref = ? WHERE orderId = ? AND fulfillment_status = 'processing'`,
      [`ERR: ${pErr.message.slice(0, 200)}`, orderId]
    ).catch(() => null);
    await telegram.sendMessage(`🚨 <b>Production submission failed</b>\nOrder #${orderId} was paid but fulfillment routing failed: ${pErr.message.slice(0, 200)}`).catch(() => null);
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
  if (!requireAdminAuth(req, res)) return;
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

// One-off admin endpoint: tells Telegram to deliver bot updates to OUR /api/webhooks/telegram.
// Visit once after deploy. Reads TELEGRAM_BOT_TOKEN from env so the token is never typed into a browser bar.
app.all('/api/admin/register-telegram-webhook', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    return res.status(400).json({ success: false, error: 'TELEGRAM_BOT_TOKEN is not configured on the server' });
  }
  const webhookUrl = `${API_BASE_URL || `https://custom-ecommerce-qp30.onrender.com`}/api/webhooks/telegram`;
  try {
    // Read what's currently set so we can show before/after in the response.
    const before = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`, { timeout: 8000 });
    const setResp = await axios.post(
      `https://api.telegram.org/bot${token}/setWebhook`,
      {
        url: webhookUrl,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: true,
      },
      { timeout: 8000 }
    );
    const after = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`, { timeout: 8000 });
    return res.json({
      success: setResp.data && setResp.data.ok === true,
      newWebhookUrl: webhookUrl,
      telegramResponse: setResp.data,
      before: before.data && before.data.result ? { url: before.data.result.url, pending: before.data.result.pending_update_count } : null,
      after:  after.data  && after.data.result  ? { url: after.data.result.url,  pending: after.data.result.pending_update_count }  : null,
    });
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Failed to set Telegram webhook',
      details: err.response && err.response.data ? err.response.data : err.message,
    });
  }
});

app.get('/api/admin/test-telegram', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  const timestamp = new Date().toISOString();
  const message = `🧪 <b>Telegram Test</b>\n\nServer test message at: ${timestamp}`;
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
  // Env-var presence snapshot — logged on every failure path so Render logs
  // make root cause obvious without ever leaking secret values.
  const envSnapshot = () => ({
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
      ? `set(len=${process.env.TELEGRAM_BOT_TOKEN.length})`
      : 'MISSING',
    TELEGRAM_OWNER_CHAT_ID: process.env.TELEGRAM_OWNER_CHAT_ID ? 'set' : 'MISSING',
    TELEGRAM_ALLOWED_USER_IDS: process.env.TELEGRAM_ALLOWED_USER_IDS ? 'set' : 'MISSING',
  });

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

      const msg = `👀 <b>New Store Visit</b>\n\n`
        + `<b>Path:</b> ${path || '/'}\n`
        + `<b>Locale/Currency:</b> ${locale || '-'} / ${currency || '-'}\n`
        + `<b>Country:</b> ${country}\n`
        + `<b>Source:</b> ${source || 'web'}\n`
        + `<b>IP:</b> ${ip}\n`
        + `<b>UA:</b> ${ua}`;

      let telegramResult;
      try {
        telegramResult = await telegram.sendMessage(msg);
      } catch (tgErr) {
        // sendMessage already catches axios errors and returns a structured
        // result, so reaching here means something unexpected (e.g. token
        // resolution threw). Log full context for Render logs.
        console.error('[analytics/visit] telegram.sendMessage threw:', {
          message: tgErr && tgErr.message,
          stack: tgErr && tgErr.stack && tgErr.stack.split('\n').slice(0, 8).join('\n'),
          env: envSnapshot(),
        });
        return res.status(500).json({
          success: false,
          deduped: false,
          error: 'Telegram delivery threw',
          detail: tgErr && tgErr.message,
          env: envSnapshot(),
        });
      }

      if (!telegramResult || !telegramResult.ok) {
        console.error('[analytics/visit] telegram delivery failed:', {
          telegram: telegramResult,
          env: envSnapshot(),
          path: path || '/',
          ip,
        });
        return res.status(500).json({
          success: false,
          deduped: false,
          error: 'Visit event received but Telegram delivery failed',
          telegram: telegramResult || { ok: false, reason: 'unknown_error' },
          env: envSnapshot(),
        });
      }

      return res.json({ success: true, deduped: false, telegram: telegramResult });
    }

    return res.json({ success: true, deduped: true, telegram: { ok: true, skipped: true, reason: 'deduped' } });
  } catch (err) {
    // Previous behavior swallowed the error with a generic 500 and no log,
    // making Render logs useless. Now surface the full error + env state so
    // the cause is visible both in logs AND in the response body.
    console.error('[analytics/visit] unhandled exception:', {
      message: err && err.message,
      stack: err && err.stack && err.stack.split('\n').slice(0, 10).join('\n'),
      env: envSnapshot(),
    });
    return res.status(500).json({
      success: false,
      error: 'Visit analytics failed',
      detail: err && err.message,
      env: envSnapshot(),
    });
  }
});

// --- Webhooks must be before express.json() to parse raw body for Stripe ---
app.post('/api/webhooks/stripe', express.raw({type: 'application/json'}), async (req, res) => {
  const payload = req.body;
  const sig = req.headers['stripe-signature'];
  let event;

  // SECURITY: never accept an unsigned payload as a real event. The previous
  // fallback trusted req.body verbatim whenever STRIPE_WEBHOOK_SECRET was
  // unset (e.g. because Stripe checkout is currently disabled pending an IL
  // merchant account) — that let anyone POST a forged "payment succeeded"
  // event to this URL and trigger real fulfillment for an unpaid order.
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('[Stripe Webhook] Rejected: STRIPE_WEBHOOK_SECRET is not configured on the server');
    return res.status(503).json({ error: 'Stripe webhook is not configured on the server' });
  }

  try {
    event = stripe.webhooks.constructEvent(payload, sig, process.env.STRIPE_WEBHOOK_SECRET);
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
    const isILS = String(session.currency || '').toLowerCase() === 'ils';
    const amountText = isILS ? `₪${amount.toFixed(2)}` : `$${amount.toFixed(2)}`;
    await sendPaymentNotification({ provider: 'Stripe', orderId, amountText });
    const paidOrder = await dbGetAsync(`SELECT customerName, totalAmount FROM orders WHERE id = ?`, [orderId]);
    const paidOrderItems = await dbAllAsync(`SELECT oi.*, p.title FROM order_items oi LEFT JOIN products p ON p.id = oi.productId WHERE oi.orderId = ?`, [orderId]);
    if (paidOrder) {
      telegram.notifyNewOrder(orderId, paidOrder.customerName, paidOrder.totalAmount, paidOrderItems).catch(() => null);
    }
    await processPaidOrderFulfillment(orderId, 'Stripe');
  }
  res.json({received: true});
});

app.post('/api/webhooks/payplus', express.raw({ type: 'application/json' }), async (req, res) => {
  const rawBody = req.body ? req.body.toString('utf8') : '';
  const hash = req.headers['hash'] || req.headers['Hash'];
  const secretKey = process.env.PAYPLUS_SECRET_KEY;

  if (!secretKey) {
    console.error('[PayPlus Webhook] PAYPLUS_SECRET_KEY is not configured on the server');
    return res.status(500).json({ received: false, error: 'PAYPLUS_SECRET_KEY not configured' });
  }

  if (!hash) {
    console.warn('[PayPlus Webhook] Missing hash signature header');
    return res.status(400).json({ received: false, error: 'Missing hash signature' });
  }

  // Calculate HMAC SHA-256 signature
  const calculatedHash = crypto
    .createHmac('sha256', secretKey)
    .update(rawBody)
    .digest('base64');

  // Secure timing-safe signature comparison
  let signaturesMatch = false;
  try {
    signaturesMatch = crypto.timingSafeEqual(
      Buffer.from(calculatedHash, 'base64'),
      Buffer.from(hash, 'base64')
    );
  } catch (e) {
    // Mismatch in buffer length, signature is invalid
  }

  if (!signaturesMatch) {
    console.warn(`[PayPlus Webhook] Signature verification failed. Calculated: ${calculatedHash}, Received: ${hash}`);
    return res.status(401).json({ received: false, error: 'Signature verification failed' });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ received: false, error: 'Invalid JSON payload' });
  }

  const { transaction_uid, status, custom_field } = payload;
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
      const printifySyncEnabled = isPrintifySyncEnabled();
      if (!printifySyncEnabled) {
        console.log(`⏭️ [Printify Webhook] Sync disabled for this environment. Ignoring event: ${type}`);
        return res.status(200).json({ received: true, event: type, skipped: true });
      }

      console.log(`🔄 [Printify Webhook] Triggering auto-sync for event: ${type}`);
      
      // Queue the sync async (don't block the response)
      setImmediate(async () => {
        try {
          const count = await printify.syncProducts();
          const eventInfo = `Printify event: ${type}`;
          await telegram.sendMessage(`✅ <b>Automatic Printify Sync Complete</b>\n\n${eventInfo}\n${count} products synced successfully.`);
        } catch (err) {
          console.error('❌ Auto-sync failed:', err.message);
          await telegram.sendMessage(`⚠️ <b>Automatic Printify Sync Failed</b>\nEvent: ${type}\nError: ${err.message}`);
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

// 5MB limit (default is 100KB) — high enough for /api/admin/design/create-draft
// which carries a base64-encoded image, low enough that any single body still
// fits comfortably in memory on the Render Free plan.
app.use(express.json({ limit: '5mb' }));
app.use('/api/feed', feedsRouter);
app.use('/api/carts', cartsRouter);
app.use('/api/marketing', marketingWebhooksRouter);
app.use('/api/admin', adminReportsRouter);

// Pulse Check Route
app.get('/', (req, res) => {
  res.send('Server is running and connected to Meni (Telegram).');
});

// Geolocation and config helper
// === Geolocation: edge-header first, then IP→country lookup with cache, then IL default ===
const GEO_CACHE = new Map(); // ip -> { country, expiresAt }
const GEO_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const getClientIpForGeo = (req) => {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const candidates = [
    req.headers['cf-connecting-ip'],
    xff[0],
    req.headers['x-real-ip'],
    req.socket && req.socket.remoteAddress,
    req.ip,
  ];
  for (const c of candidates) {
    if (c && typeof c === 'string' && c.trim()) return c.trim().replace(/^::ffff:/, '');
  }
  return null;
};

const isPrivateIp = (ip) => {
  if (!ip) return true;
  if (ip === '::1' || ip === '0.0.0.0' || ip.startsWith('127.') || ip.startsWith('169.254.')) return true;
  if (ip.startsWith('10.') || ip.startsWith('192.168.')) return true;
  if (ip.startsWith('172.')) {
    const second = Number((ip.split('.')[1] || '0'));
    if (second >= 16 && second <= 31) return true;
  }
  // IPv6 private/link-local ranges (loose check)
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
};

const lookupCountryFromIp = async (ip) => {
  if (!ip || isPrivateIp(ip)) return null;
  const cached = GEO_CACHE.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.country;

  const apiKey = process.env.IPAPI_KEY || '';
  const url = apiKey
    ? `https://ipapi.co/${encodeURIComponent(ip)}/country/?key=${encodeURIComponent(apiKey)}`
    : `https://ipapi.co/${encodeURIComponent(ip)}/country/`;
  try {
    const resp = await axios.get(url, { timeout: 3000, validateStatus: () => true, headers: { 'User-Agent': 'dripstreetshop/1.0' } });
    const country = String(resp.data || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(country)) {
      GEO_CACHE.set(ip, { country, expiresAt: Date.now() + GEO_CACHE_TTL_MS });
      return country;
    }
  } catch {
    // swallow — caller falls back to default
  }
  return null;
};

app.get('/api/geolocation', async (req, res) => {
  // 1) Prefer an explicit edge-injected country header (Vercel, Cloudflare). Still works for any future proxy setup.
  const headerCountry = String(req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || '').toUpperCase();
  let country = /^[A-Z]{2}$/.test(headerCountry) ? headerCountry : null;

  // 2) Fall back to IP→country lookup via ipapi.co (cached 24h, free-tier safe)
  if (!country) {
    const ip = getClientIpForGeo(req);
    country = await lookupCountryFromIp(ip);
  }

  // 3) Final fallback — IL (matches the brand's home market)
  if (!country) country = 'IL';

  const isIsrael = country === 'IL';
  res.json({
    country,
    currency: isIsrael ? 'ILS' : 'USD',
    locale: isIsrael ? 'he' : 'en',
    exchangeRate: pricingEngine.exchangeRateUSDILS,
  });
});

// Get all products (list view - includes backImageUrl for hover effect and USD prices)
app.get('/api/products', (req, res) => {
  db.all("SELECT id, title, description, price, priceUSD, imageUrl, backImageUrl, stock, type FROM products", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }

    // Prefer real Printify catalog and hide local mock products when Printify items exist.
    const hasPrintifyProducts = rows.some(r => r.type === 'printify');
    const visibleRows = hasPrintifyProducts ? rows.filter(r => r.type === 'printify' || r.type === 'dropship') : rows;
    
    const productsWithUSD = visibleRows.map(r => ({
      ...r,
      priceUSD: resolveUsdPrice(r.price, r.priceUSD)
    }));
    
    res.json(productsWithUSD);
  });
});

// Get active product IDs for sitemap/prerender pipelines.
app.get('/api/products/active-ids', async (req, res) => {
  try {
    const allProducts = await dbAllAsync('SELECT id, type FROM products');
    const hasPrintifyProducts = allProducts.some((row) => row.type === 'printify');
    const visibilityFilter = hasPrintifyProducts
      ? "AND (p.type = 'printify' OR p.type = 'dropship')"
      : '';

    const rows = await dbAllAsync(
      `SELECT DISTINCT p.id
       FROM products p
       LEFT JOIN product_variants pv ON pv.productId = p.id
       WHERE COALESCE(p.stock, 0) > 0
         ${visibilityFilter}
         AND (
           pv.id IS NULL
           OR (
             COALESCE(pv.isEnabled, 0) = 1
             AND COALESCE(pv.isAvailable, 0) = 1
             AND COALESCE(pv.stockQty, 0) > 0
           )
         )
       ORDER BY p.id ASC`
    );

    res.json({ ids: rows.map((row) => row.id) });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Failed to load active product ids' });
  }
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

      row.priceUSD = resolveUsdPrice(row.price, row.priceUSD);

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
        priceUSD: resolveUsdPrice(variant.price, variant.priceUSD)
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
  if (!requireAdminAuth(req, res)) return;
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
      `INSERT INTO leads (email, promo_code, is_used, emailSent, emailAttempts, lastEmailAttemptAt) VALUES (?, ?, 0, 0, 1, ?)`,
      [email, promoCode, new Date().toISOString()]
    );

    emailService.sendCouponEmail(email, promoCode)
      .then(async (resObj) => {
        if (resObj && resObj.ok) {
          console.log(`[leads] welcome email sent to ${email} (ok: true)`);
          await dbRunAsync(`UPDATE leads SET emailSent = 1 WHERE email = ?`, [email]).catch(e => console.error(`Error updating lead emailSent for ${email}:`, e.message));
        } else {
          console.warn(`[leads] welcome email failed to deliver to ${email} (ok: false)`);
          const errorMsg = resObj?.error?.message || resObj?.reason || 'Unknown delivery failure';
          await telegram.sendMessage(`⚠️ <b>Welcome email delivery failed</b>\nLead: ${email}\nError: ${errorMsg}`).catch(() => null);
        }
      })
      .catch(async (err) => {
        console.error(`[leads] welcome email system error for ${email}:`, err.message);
        await telegram.sendMessage(`⚠️ <b>Welcome email system error</b>\nLead: ${email}\nError: ${err.message}`).catch(() => null);
      });

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
const setCouponCallTimestamps = [];
const SET_COUPON_RATE_LIMIT = 5; // max 5 calls
const SET_COUPON_RATE_WINDOW_MS = 60 * 1000; // per minute

const timingSafeEqualStr = (a, b) => {
  const aBuf = Buffer.from(String(a || ''));
  const bBuf = Buffer.from(String(b || ''));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

app.post('/api/admin/set-coupon', (req, res) => {
  // Auth: shared secret header. The endpoint mutates the public storefront state,
  // so it must never be reachable without DRIP_ADMIN_SECRET configured.
  const expected = process.env.DRIP_ADMIN_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'DRIP_ADMIN_SECRET not configured on server' });
  }
  const provided = req.get('X-Admin-Secret') || '';
  if (!timingSafeEqualStr(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // In-memory rate limit (per process). Cheap protection against brute / runaway.
  const now = Date.now();
  while (setCouponCallTimestamps.length && now - setCouponCallTimestamps[0] > SET_COUPON_RATE_WINDOW_MS) {
    setCouponCallTimestamps.shift();
  }
  if (setCouponCallTimestamps.length >= SET_COUPON_RATE_LIMIT) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  setCouponCallTimestamps.push(now);

  const { code, discount_pct, duration_hours } = req.body;
  if (!code || !discount_pct) {
    currentActiveCoupon = null; // Clear coupon if empty
    console.log(`[coupon] cleared by admin at ${new Date(now).toISOString()}`);
    return res.json({ success: true, message: 'Coupon cleared.' });
  }

  currentActiveCoupon = { code, discount_pct };
  console.log(`[coupon] set ${code} ${discount_pct}% for ${duration_hours || 0}h at ${new Date(now).toISOString()}`);

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

// Admin Refresh Prices — force-run the pricing engine to re-apply targetPricesILS
// to all products in the DB. Use this after changing targetPricesILS in pricing.js
// to push the new prices live without waiting for an extreme FX swing.
//
// Auth: same X-Admin-Secret shared header as set-coupon.
// Usage: curl -X POST https://.../api/admin/refresh-prices -H "X-Admin-Secret: <secret>"
app.post('/api/admin/refresh-prices', async (req, res) => {
  const expected = process.env.DRIP_ADMIN_SECRET;
  if (!expected) {
    return res.status(503).json({ error: 'DRIP_ADMIN_SECRET not configured on server' });
  }
  const provided = req.get('X-Admin-Secret') || '';
  if (!timingSafeEqualStr(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const beforeRows = await dbAllAsync('SELECT id, title, price FROM products', []);
    await pricingEngine.runPricingUpdate({ force: true, reason: 'manual_refresh_endpoint' });
    const afterRows = await dbAllAsync('SELECT id, title, price FROM products', []);

    const changes = afterRows
      .map((after) => {
        const before = beforeRows.find((b) => b.id === after.id);
        const fromPrice = Number(before?.price ?? 0);
        const toPrice = Number(after.price ?? 0);
        return { id: after.id, title: after.title, fromPrice, toPrice, changed: Math.abs(fromPrice - toPrice) > 0.01 };
      })
      .filter((c) => c.changed);

    return res.json({
      success: true,
      totalProducts: afterRows.length,
      productsChanged: changes.length,
      changes,
    });
  } catch (err) {
    console.error('refresh-prices failed:', err.message);
    return res.status(500).json({ error: err.message || 'Refresh prices failed' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Admin Design Pipeline — Human-in-the-Loop product creation via Printify.
// ═══════════════════════════════════════════════════════════════════════════
//
// Flow:
//   1. MENI_CORE (Telegram bot) POSTs an image to /api/admin/design/create-draft
//      → backend uploads to Printify, creates draft, polls until mockup ready,
//        stores a row in design_jobs, returns { jobId, mockupUrl, ... }.
//   2. Bot sends the mockup to the human via Telegram with [✅ Publish] / [❌ Reject].
//   3. On approval:  POST /api/admin/design/:jobId/publish
//      → backend tells Printify to publish + mirrors the product into our
//        local DB so it appears on the storefront and in the sitemap.
//   4. On rejection: POST /api/admin/design/:jobId/reject
//      → backend asks Printify to delete the draft, marks job as rejected.
//
// Auth: same DRIP_ADMIN_SECRET header as the other admin endpoints.

// Tee draft requests carry ~5–10MB of base64 image. Apply a generous limit
// just for this one route so the global 100kb json parser isn't an issue.
const designJsonParser = express.json({ limit: '15mb' });

const requireAdminAuth = (req, res) => {
  const expected = process.env.DRIP_ADMIN_SECRET;
  if (!expected) {
    res.status(503).json({ error: 'DRIP_ADMIN_SECRET not configured on server' });
    return false;
  }
  const provided = req.get('X-Admin-Secret') || '';
  if (!timingSafeEqualStr(provided, expected)) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

app.post('/api/admin/design/create-draft', designJsonParser, async (req, res) => {
  // Wrap THE ENTIRE handler so absolutely nothing can escape to the global
  // error middleware as a generic "Internal Server Error". For an admin-only
  // endpoint, leaking err.message + the stage we got to is the right tradeoff.
  let stage = 'init';
  try {
    if (!requireAdminAuth(req, res)) return;

    stage = 'validate-body';
    const { imageBase64, filename, title, requestedBy, placement } = req.body || {};
    if (!imageBase64 || typeof imageBase64 !== 'string') {
      return res.status(400).json({ error: 'imageBase64 (string) is required.' });
    }
    const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',', 2)[1] : imageBase64;
    const cleanPlacement = (placement === 'back') ? 'back' : 'front';

    stage = 'env-precheck';
    if (!process.env.PRINTIFY_API_TOKEN || process.env.PRINTIFY_API_TOKEN === 'YOUR_PRINTIFY_TOKEN') {
      return res.status(503).json({ error: 'PRINTIFY_API_TOKEN not configured on server' });
    }
    if (!process.env.PRINTIFY_SHOP_ID) {
      return res.status(503).json({ error: 'PRINTIFY_SHOP_ID not configured on server' });
    }

    stage = 'parallel-pipelines';
    const printifyDraftPromise = designPipeline.createDraftFromImage({
      imageBase64: cleanBase64,
      filename,
      title,
      placement: cleanPlacement,
    });

    const customMockupPromise = mockupPipeline.createApprovalMockup({
      imageBase64: cleanBase64,
      filename,
      title,
      placement: cleanPlacement,
    });

    const [printifyResult, customMockupResult] = await Promise.allSettled([
      printifyDraftPromise,
      customMockupPromise,
    ]);

    if (printifyResult.status !== 'fulfilled') {
      stage = 'printify-create-draft';
      throw printifyResult.reason;
    }

    const draft = printifyResult.value;
    const customMockup = customMockupResult.status === 'fulfilled' ? customMockupResult.value : null;

    if (customMockupResult.status === 'rejected') {
      console.error('[MOCKUP_PIPELINE] Falling back to Printify mockup URL.', {
        error: customMockupResult.reason?.message || String(customMockupResult.reason || 'Unknown mockup failure'),
        placement: cleanPlacement,
      });
    }

    const chosenMockupUrl = customMockup?.url || draft.mockupUrl;
    const isCustomMockup = Boolean(customMockup?.url);

    stage = 'db-insert-design-job';
    const insert = await dbRunAsync(
      `INSERT INTO design_jobs
        (printifyProductId, blueprintId, printProviderId, productType, title, priceILS,
         mockupUrl, sourceImageRef, status, requestedBy)
       VALUES (?, ?, ?, 'tee', ?, ?, ?, ?, 'awaiting_approval', ?)`,
      [
        draft.printifyProductId,
        draft.blueprintId,
        draft.printProviderId,
        draft.title,
        draft.priceILS,
        chosenMockupUrl,
        filename || null,
        requestedBy || null,
      ]
    );

    stage = 'db-upsert-product-image';
    await upsertDesignJobImageAsync({
      designJobId: insert.lastID,
      view: cleanPlacement,
      url: chosenMockupUrl,
      isCustomMockup,
    });

    await telegram
      .sendMessage(`🎨 <b>Design draft #${insert.lastID}</b> created (awaiting your approval in MENI).\n${draft.title}`)
      .catch(() => null);

    return res.json({
      success: true,
      jobId: insert.lastID,
      printifyProductId: draft.printifyProductId,
      mockupUrl: chosenMockupUrl,
      printifyMockupUrl: draft.mockupUrl,
      mockupSource: isCustomMockup ? 'cloudinary' : 'printify',
      title: draft.title,
      priceILS: draft.priceILS,
      placement: draft.placement,
      variantCount: draft.variantCount,
      hasNeckLabel: draft.hasNeckLabel,
    });
  } catch (err) {
    // Print everything we know about the failure so smoke tests can diagnose.
    const upstream = err.response?.data;
    const upstreamStr = upstream
      ? (typeof upstream === 'string' ? upstream : JSON.stringify(upstream))
      : null;
    console.error(`design/create-draft failed at stage='${stage}':`, err.message, upstream || '');
    if (err.stack) console.error(err.stack.split('\n').slice(0, 5).join('\n'));
    return res.status(502).json({
      success: false,
      stage,
      error: err.message || 'Printify draft creation failed',
      upstream: upstreamStr || undefined,
    });
  }
});

app.post('/api/admin/design/:jobId/publish', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId)) return res.status(400).json({ error: 'jobId must be numeric.' });

  const job = await dbGetAsync(`SELECT * FROM design_jobs WHERE id = ?`, [jobId]);
  if (!job) return res.status(404).json({ error: 'design job not found' });
  if (job.status !== 'awaiting_approval') {
    return res.status(409).json({ error: `job is already in status '${job.status}', not awaiting_approval.` });
  }

  try {
    await designPipeline.publishDraft(job.printifyProductId);

    // Mirror to our local catalog so the storefront + sitemap pick it up immediately.
    const productInsert = await dbRunAsync(
      `INSERT INTO products (title, description, price, imageUrl, stock, type, printifyId)
       VALUES (?, ?, ?, ?, 999, 'printify', ?)`,
      [
        job.title,
        `${job.title} — Drip Street drop. Premium minimal streetwear.`,
        job.priceILS,
        job.mockupUrl,
        job.printifyProductId,
      ]
    );

    await dbRunAsync(
      `UPDATE design_jobs
         SET status = 'published', decidedAt = CURRENT_TIMESTAMP, publishedProductId = ?
       WHERE id = ?`,
      [productInsert.lastID, jobId]
    );

    await telegram
      .sendMessage(`✅ <b>Design #${jobId} published</b>\n${job.title}\nLive at /product/${productInsert.lastID}`)
      .catch(() => null);

    return res.json({
      success: true,
      jobId,
      productId: productInsert.lastID,
      publicUrl: `https://dripstreetshop.com/product/${productInsert.lastID}`,
    });
  } catch (err) {
    const upstream = err.response?.data || err.message;
    console.error(`design/publish failed for job ${jobId}:`, upstream);
    await dbRunAsync(`UPDATE design_jobs SET lastError = ? WHERE id = ?`,
      [String(upstream).slice(0, 500), jobId]).catch(() => null);
    return res.status(502).json({
      success: false,
      error: typeof upstream === 'string' ? upstream : (err.message || 'Publish failed'),
    });
  }
});

// Update the title of a draft design job that is still awaiting approval.
// Used by MENI's Telegram flow when Groq suggests 3 names and the human
// picks one before publishing. Only touches our local design_jobs row —
// the storefront product name on publish reads from this column, so the
// chosen title propagates to dripstreetshop.com. We deliberately do NOT
// sync the new title back to Printify (their dashboard product name is
// invisible to customers and is not worth a second API round trip).
app.patch('/api/admin/design/:jobId/title', express.json(), async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId)) return res.status(400).json({ error: 'jobId must be numeric.' });

  const rawTitle = req.body?.title;
  if (typeof rawTitle !== 'string' || !rawTitle.trim()) {
    return res.status(400).json({ error: 'title (non-empty string) is required.' });
  }
  const title = rawTitle.trim().slice(0, 120);

  const job = await dbGetAsync(`SELECT * FROM design_jobs WHERE id = ?`, [jobId]);
  if (!job) return res.status(404).json({ error: 'design job not found' });
  if (job.status !== 'awaiting_approval') {
    return res.status(409).json({
      error: `job is in status '${job.status}', not awaiting_approval — title can no longer be edited.`,
    });
  }

  await dbRunAsync(`UPDATE design_jobs SET title = ? WHERE id = ?`, [title, jobId]);
  return res.json({ success: true, jobId, title });
});

app.post('/api/admin/design/:jobId/reject', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;

  const jobId = Number(req.params.jobId);
  if (!Number.isFinite(jobId)) return res.status(400).json({ error: 'jobId must be numeric.' });

  const job = await dbGetAsync(`SELECT * FROM design_jobs WHERE id = ?`, [jobId]);
  if (!job) return res.status(404).json({ error: 'design job not found' });
  if (job.status !== 'awaiting_approval') {
    return res.status(409).json({ error: `job is already in status '${job.status}', not awaiting_approval.` });
  }

  try {
    await designPipeline.deleteDraft(job.printifyProductId);
  } catch (err) {
    // Even if Printify delete failed, we still mark the job rejected locally —
    // a stranded draft on Printify side is harmless and cleanable manually.
    console.warn(`design/reject: Printify delete failed for job ${jobId}:`, err.message);
  }

  await dbRunAsync(
    `UPDATE design_jobs SET status = 'rejected', decidedAt = CURRENT_TIMESTAMP WHERE id = ?`,
    [jobId]
  );

  await telegram
    .sendMessage(`❌ Design #${jobId} rejected and removed from Printify.`)
    .catch(() => null);

  return res.json({ success: true, jobId, status: 'rejected' });
});

// Admin Printify Sync
app.post('/api/admin/printify-sync', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const printifySyncEnabled = isPrintifySyncEnabled();
    if (!printifySyncEnabled) {
      return res.status(409).json({
        error: 'Printify sync is disabled in this environment. Set ENABLE_PRINTIFY_SYNC=true to enable it.'
      });
    }

    const productsSynced = await printify.syncProducts();
    res.json({ success: true, count: productsSynced });
  } catch (error) {
    res.status(500).json({ error: 'Sync failed' });
  }
});

// Admin Force Price Update
app.post('/api/admin/update-prices', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    await pricingEngine.runPricingUpdate();
    res.json({ success: true, message: 'Prices updated to target values.' });
  } catch (error) {
    res.status(500).json({ error: 'Price update failed' });
  }
});

// Admin Manually Trigger Email Retry Recovery
app.post('/api/admin/retry-emails', async (req, res) => {
  if (!requireAdminAuth(req, res)) return;
  try {
    const force = req.body?.force === true;
    console.log(`⏰ [Admin Manual Trigger] Running email recovery... (force: ${force})`);
    const result = await runEmailRetryRecovery(force);
    res.json({ success: true, message: 'Email retry recovery triggered successfully.', ...result });
  } catch (error) {
    res.status(500).json({ error: 'Manual email recovery trigger failed: ' + error.message });
  }
});

// --- Helpers for Cryptographic Signatures & Webhook Verification ---

const verifyUnsubscribeSig = (email, sig) => {
  if (!email || !sig) return false;
  const expectedSig = emailService.generateUnsubscribeSignature(email);
  if (sig.length !== expectedSig.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'));
  } catch (e) {
    return false;
  }
};

const verifySvixSignature = (rawBody, headers, secret) => {
  const svixId = headers['svix-id'] || headers['webhook-id'];
  const svixTimestamp = headers['svix-timestamp'] || headers['webhook-timestamp'];
  const svixSignature = headers['svix-signature'] || headers['webhook-signature'];

  if (!svixId || !svixTimestamp || !svixSignature || !secret) {
    return false;
  }

  // Check timestamp age to protect against replay attacks (e.g. 5 minutes)
  const now = Math.floor(Date.now() / 1000);
  const timestamp = parseInt(svixTimestamp, 10);
  if (isNaN(timestamp) || Math.abs(now - timestamp) > 300) {
    return false;
  }

  // Prepare secret key
  let secretKey = secret;
  if (secret.startsWith('whsec_')) {
    secretKey = secret.substring(6);
  }
  const secretBuffer = Buffer.from(secretKey, 'base64');

  // Construct signing payload
  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;

  // Calculate signature
  const expectedSignature = crypto
    .createHmac('sha256', secretBuffer)
    .update(toSign)
    .digest('base64');

  // Check signature in the svix-signature header
  const passedSignatures = svixSignature.split(' ');
  for (const sig of passedSignatures) {
    const parts = sig.split(',');
    if (parts.length === 2 && parts[0] === 'v1') {
      try {
        if (crypto.timingSafeEqual(Buffer.from(parts[1], 'base64'), Buffer.from(expectedSignature, 'base64'))) {
          return true;
        }
      } catch (e) {
        // Handle potential buffer length mismatch
      }
    }
  }
  return false;
};

const renderUnsubscribePage = ({ statusClass, messageHtml, subtextHtml, email, sig, showConfirm }) => {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>DRIP STREET | SUBSCRIPTION</title>
      <link rel="preconnect" href="https://fonts.googleapis.com">
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg-color: #050505;
          --panel-bg: rgba(255, 255, 255, 0.02);
          --panel-border: rgba(255, 255, 255, 0.05);
          --accent-color: #ffffff;
          --accent-hover: #111111;
          --text-primary: #ffffff;
          --text-secondary: #888888;
          --text-muted: #444444;
          --success-color: #4caf50;
          --warning-color: #ff9800;
          --error-color: #f44336;
        }

        body {
          margin: 0;
          padding: 0;
          background-color: var(--bg-color);
          color: var(--text-primary);
          font-family: 'Outfit', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          overflow-x: hidden;
        }

        .bg-glow-1 {
          position: absolute;
          width: 400px;
          height: 400px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.03) 0%, rgba(0,0,0,0) 70%);
          top: 10%;
          left: 10%;
          z-index: 0;
          pointer-events: none;
        }
        .bg-glow-2 {
          position: absolute;
          width: 500px;
          height: 500px;
          background: radial-gradient(circle, rgba(255, 255, 255, 0.02) 0%, rgba(0,0,0,0) 70%);
          bottom: 10%;
          right: 10%;
          z-index: 0;
          pointer-events: none;
        }

        .container {
          position: relative;
          max-width: 480px;
          width: 90%;
          background: var(--panel-bg);
          border: 1px solid var(--panel-border);
          backdrop-filter: blur(20px);
          -webkit-backdrop-filter: blur(20px);
          border-radius: 16px;
          padding: 50px 40px;
          text-align: center;
          box-shadow: 0 20px 50px rgba(0, 0, 0, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.05);
          z-index: 1;
          animation: fadeIn 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
          box-sizing: border-box;
          transition: opacity 0.3s ease;
        }

        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }

        .logo {
          font-size: 32px;
          font-weight: 900;
          letter-spacing: 0.25em;
          text-transform: uppercase;
          margin-bottom: 40px;
          color: var(--text-primary);
          text-shadow: 0 0 10px rgba(255, 255, 255, 0.2);
        }

        .icon-wrapper {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 80px;
          height: 80px;
          border-radius: 50%;
          background: rgba(255, 255, 255, 0.01);
          border: 1px solid var(--panel-border);
          margin-bottom: 25px;
          position: relative;
        }

        .icon {
          font-size: 32px;
          line-height: 1;
          display: inline-block;
          animation: scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
        }

        @keyframes scaleIn {
          from { transform: scale(0.5); opacity: 0; }
          to { transform: scale(1); opacity: 1; }
        }

        .icon.success { color: var(--success-color); text-shadow: 0 0 15px rgba(76, 175, 80, 0.3); }
        .icon.warning { color: var(--warning-color); text-shadow: 0 0 15px rgba(255, 152, 0, 0.3); }
        .icon.error { color: var(--error-color); text-shadow: 0 0 15px rgba(244, 67, 54, 0.3); }

        h1 {
          font-size: 20px;
          font-weight: 800;
          letter-spacing: 0.10em;
          text-transform: uppercase;
          margin: 0 0 15px 0;
          color: var(--text-primary);
        }

        p {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-secondary);
          margin: 0 0 35px 0;
        }

        p strong {
          color: var(--text-primary);
        }

        .btn-group {
          display: flex;
          flex-direction: column;
          gap: 12px;
          align-items: center;
          justify-content: center;
        }

        .btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background-color: var(--accent-color);
          color: #000000;
          text-decoration: none;
          width: 100%;
          max-width: 240px;
          height: 50px;
          font-size: 13px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.15em;
          border-radius: 8px;
          border: 1px solid var(--accent-color);
          cursor: pointer;
          box-sizing: border-box;
          transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
          position: relative;
          overflow: hidden;
        }

        .btn::after {
          content: '';
          position: absolute;
          top: 0;
          left: -50%;
          width: 200%;
          height: 100%;
          background: linear-gradient(to right, transparent, rgba(255,255,255,0.1), transparent);
          transform: skewX(-25deg);
          transition: 0.75s;
        }

        .btn:hover::after {
          left: 125%;
        }

        .btn:hover {
          background-color: transparent;
          color: var(--text-primary);
          transform: translateY(-2px);
          box-shadow: 0 10px 20px rgba(255, 255, 255, 0.05);
        }

        .btn:active {
          transform: translateY(0);
        }

        .btn-secondary {
          background-color: transparent;
          color: var(--text-secondary);
          border: 1px solid var(--panel-border);
        }

        .btn-secondary:hover {
          background-color: rgba(255, 255, 255, 0.02);
          color: var(--text-primary);
          border-color: rgba(255, 255, 255, 0.15);
          box-shadow: none;
        }

        .footer-brand {
          margin-top: 40px;
          font-size: 11px;
          letter-spacing: 0.15em;
          color: var(--text-muted);
          text-transform: uppercase;
        }
      </style>
    </head>
    <body>
      <div class="bg-glow-1"></div>
      <div class="bg-glow-2"></div>
      <div class="container">
        <div class="logo">DRIP STREET</div>
        <div class="icon-wrapper">
          <div id="status-icon" class="icon ${statusClass}">
            ${statusClass === 'success' ? '✓' : statusClass === 'warning' ? '?' : '⚠'}
          </div>
        </div>
        <h1 id="status-title">${messageHtml}</h1>
        <p id="status-desc">${subtextHtml}</p>
        <div class="btn-group">
          ${showConfirm ? `
            <button id="confirm-unsubscribe-btn" class="btn">Confirm Unsubscribe</button>
          ` : (statusClass === 'success' ? `
            <button id="resubscribe-btn" class="btn">Keep Me Subscribed</button>
          ` : '')}
          <a href="https://custom-ecommerce-seven.vercel.app" class="btn btn-secondary">Return to Store</a>
        </div>
        <div class="footer-brand">&copy; 2026 DRIP STREET SHP</div>
      </div>

      <script>
        const resubscribeBtn = document.getElementById('resubscribe-btn');
        if (resubscribeBtn) {
          resubscribeBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            resubscribeBtn.disabled = true;
            resubscribeBtn.textContent = 'Processing...';
            
            try {
              const response = await fetch('/api/resubscribe?email=' + encodeURIComponent('${email}'), {
                method: 'POST'
              });
              const result = await response.json();
              if (result.success) {
                const container = document.querySelector('.container');
                container.style.opacity = 0;
                setTimeout(() => {
                  document.getElementById('status-icon').className = 'icon success';
                  document.getElementById('status-icon').textContent = '✓';
                  document.getElementById('status-title').textContent = 'WELCOME BACK';
                  document.getElementById('status-desc').innerHTML = 'Your subscription has been successfully restored! You will continue to receive fresh drops and discount codes at <strong>${email}</strong>.';
                  resubscribeBtn.style.display = 'none';
                  container.style.opacity = 1;
                }, 300);
              } else {
                resubscribeBtn.disabled = false;
                resubscribeBtn.textContent = 'Keep Me Subscribed';
                alert('Failed to resubscribe: ' + (result.error || 'unknown error'));
              }
            } catch (err) {
              resubscribeBtn.disabled = false;
              resubscribeBtn.textContent = 'Keep Me Subscribed';
              alert('Failed to resubscribe due to a network error.');
            }
          });
        }

        const confirmBtn = document.getElementById('confirm-unsubscribe-btn');
        if (confirmBtn) {
          confirmBtn.addEventListener('click', async (e) => {
            e.preventDefault();
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Unsubscribing...';

            try {
              const response = await fetch('/api/unsubscribe', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                  email: '${email}',
                  sig: '${sig}',
                  confirm: true
                })
              });
              const result = await response.json();
              if (result.success) {
                const container = document.querySelector('.container');
                container.style.opacity = 0;
                setTimeout(() => {
                  document.getElementById('status-icon').className = 'icon success';
                  document.getElementById('status-icon').textContent = '✓';
                  document.getElementById('status-title').textContent = 'UNSUBSCRIBED';
                  document.getElementById('status-desc').innerHTML = 'You have been removed from our newsletter list. You will no longer receive emails at <strong>${email}</strong>.';
                  confirmBtn.style.display = 'none';
                  
                  const btnGroup = document.querySelector('.btn-group');
                  btnGroup.innerHTML = \`
                    <button id="resubscribe-btn-dynamic" class="btn">Keep Me Subscribed</button>
                    <a href="https://custom-ecommerce-seven.vercel.app" class="btn btn-secondary">Return to Store</a>
                  \`;
                  
                  const dynamicResubscribeBtn = document.getElementById('resubscribe-btn-dynamic');
                  dynamicResubscribeBtn.addEventListener('click', async (evt) => {
                    evt.preventDefault();
                    dynamicResubscribeBtn.disabled = true;
                    dynamicResubscribeBtn.textContent = 'Processing...';
                    try {
                      const resObj = await fetch('/api/resubscribe?email=' + encodeURIComponent('${email}'), { method: 'POST' });
                      const resData = await resObj.json();
                      if (resData.success) {
                        container.style.opacity = 0;
                        setTimeout(() => {
                          document.getElementById('status-icon').className = 'icon success';
                          document.getElementById('status-icon').textContent = '✓';
                          document.getElementById('status-title').textContent = 'WELCOME BACK';
                          document.getElementById('status-desc').innerHTML = 'Your subscription has been successfully restored! You will continue to receive fresh drops and discount codes at <strong>${email}</strong>.';
                          dynamicResubscribeBtn.style.display = 'none';
                          container.style.opacity = 1;
                        }, 300);
                      } else {
                        dynamicResubscribeBtn.disabled = false;
                        dynamicResubscribeBtn.textContent = 'Keep Me Subscribed';
                        alert('Failed to resubscribe: ' + (resData.error || 'unknown error'));
                      }
                    } catch (ex) {
                      dynamicResubscribeBtn.disabled = false;
                      dynamicResubscribeBtn.textContent = 'Keep Me Subscribed';
                      alert('Network error trying to resubscribe.');
                    }
                  });
                  
                  container.style.opacity = 1;
                }, 300);
              } else {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Confirm Unsubscribe';
                alert('Failed to unsubscribe: ' + (result.error || 'unknown error'));
              }
            } catch (err) {
              confirmBtn.disabled = false;
              confirmBtn.textContent = 'Confirm Unsubscribe';
              alert('Failed to unsubscribe due to a network error.');
            }
          });
        }
      </script>
    </body>
    </html>
  `;
};

// Unsubscribe Endpoint (Opt-out compliant with RFC 8058 One-Click unsubscribe)
app.post('/api/unsubscribe', async (req, res) => {
  try {
    const email = String(req.query.email || req.body.email || '').trim().toLowerCase();
    const sig = String(req.query.sig || req.body.sig || '').trim();
    const confirm = String(req.query.confirm || req.body.confirm || '').trim() === 'true';

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }

    const isValid = verifyUnsubscribeSig(email, sig);

    // Block non-confirmed unsubscribes that have invalid signatures (crawler prevention)
    if (!isValid && !confirm) {
      console.warn(`🛡️ [Unsubscribe Blocked] Opt-out rejected for ${email} - invalid signature and no manual confirmation.`);
      return res.status(403).json({ success: false, error: 'Invalid unsubscribe signature or confirmation required' });
    }

    const result = await dbRunAsync(`UPDATE leads SET unsubscribed = 1 WHERE email = ?`, [email]);
    console.log(`✉️ [Unsubscribe] Programmatic opt-out completed for ${email} (changes: ${result.changes}, validSig: ${isValid}, manualConfirm: ${confirm})`);
    return res.json({ success: true, message: 'Unsubscribed successfully.' });
  } catch (err) {
    console.error('Unsubscribe POST failed:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Resubscribe Endpoint (Allow users to opt back in)
app.post('/api/resubscribe', async (req, res) => {
  try {
    const email = String(req.query.email || req.body.email || '').trim().toLowerCase();
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ success: false, error: 'Valid email is required' });
    }

    const lead = await dbGetAsync(`SELECT id FROM leads WHERE email = ?`, [email]);
    if (!lead) {
      return res.status(404).json({ success: false, error: 'Email address is not registered' });
    }

    await dbRunAsync(
      `UPDATE leads SET unsubscribed = 0, emailSent = 0, emailAttempts = 0, lastEmailAttemptAt = NULL WHERE email = ?`,
      [email]
    );

    console.log(`✉️ [Resubscribe] Opt-in completed for ${email}`);
    await telegram.sendMessage(`🔥 <b>Lead Resubscribed</b>\nEmail: <code>${email}</code>`).catch(() => null);

    return res.json({ success: true, message: 'Resubscribed successfully.' });
  } catch (err) {
    console.error('Resubscribe POST failed:', err.message);
    return res.status(500).json({ success: false, error: 'Internal server error' });
  }
});

// Resend Webhooks: Catch bounces and spam complaints to protect sender reputation
// Raw body is required for Svix signature verification
app.post('/api/webhooks/resend', express.raw({type: 'application/json'}), async (req, res) => {
  try {
    const rawBody = req.body ? req.body.toString('utf8') : '';
    let payload = {};
    try {
      payload = JSON.parse(rawBody || '{}');
    } catch (parseErr) {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }

    // Verify Svix Webhook Signatures if configured
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret !== 'your_webhook_secret_here') {
      const verified = verifySvixSignature(rawBody, req.headers, webhookSecret);
      if (!verified) {
        console.warn('⚠️ [Resend Webhook] Signature verification failed');
        return res.status(401).send('Webhook signature verification failed');
      }
    }

    const type = payload.type; // e.g. "email.bounced" or "email.complained"
    const data = payload.data || {};
    const toList = Array.isArray(data.to) ? data.to : (data.to ? [data.to] : []);

    if (!type || toList.length === 0) {
      return res.json({ received: true, ignored: true, reason: 'missing_event_or_recipient' });
    }

    console.log(`✉️ [Resend Webhook] Event: ${type} for recipients: ${toList.join(', ')}`);

    for (const recipient of toList) {
      const email = String(recipient).trim().toLowerCase();
      if (isValidEmail(email)) {
        if (type === 'email.bounced' || type === 'email.complained') {
          // Mark as unsubscribed to block further recovery attempts
          await dbRunAsync(`UPDATE leads SET unsubscribed = 1 WHERE email = ?`, [email]);
          
          let alertMsg = '';
          if (type === 'email.bounced') {
            alertMsg = `⚠️ <b>Email Bounced (Resend)</b>\nRecipient: <code>${email}</code>\nSubject: ${data.subject || 'N/A'}\nStatus: Marked as unsubscribed/bounced locally.`;
          } else {
            alertMsg = `⚠️ <b>Spam Complaint (Resend)</b>\nRecipient: <code>${email}</code>\nSubject: ${data.subject || 'N/A'}\nStatus: Marked as unsubscribed locally.`;
          }
          await telegram.sendMessage(alertMsg).catch(() => null);
        }
      }
    }

    return res.json({ received: true });
  } catch (err) {
    console.error('Resend Webhook failed:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
});

app.get('/api/unsubscribe', async (req, res) => {
  const email = String(req.query.email || '').trim().toLowerCase();
  const sig = String(req.query.sig || '').trim();

  if (!email || !isValidEmail(email)) {
    return res.send(renderUnsubscribePage({
      statusClass: 'error',
      messageHtml: 'INVALID REQUEST',
      subtextHtml: 'The unsubscribe link is invalid or incomplete. Please check your email link or contact support.',
      email: '',
      sig: '',
      showConfirm: false
    }));
  }

  const isValid = verifyUnsubscribeSig(email, sig);

  if (isValid) {
    // Automatically unsubscribe on GET if signature matches (human 1-click experience)
    try {
      const lead = await dbGetAsync(`SELECT id FROM leads WHERE email = ?`, [email]);
      if (!lead) {
        // Render success even if lead is not found to prevent user enum/leakage, but log it
        return res.send(renderUnsubscribePage({
          statusClass: 'success',
          messageHtml: 'SUCCESSFULLY UNSUBSCRIBED',
          subtextHtml: `Your email address <strong>${email}</strong> is not registered or has already been removed.`,
          email,
          sig,
          showConfirm: false
        }));
      }

      await dbRunAsync(`UPDATE leads SET unsubscribed = 1 WHERE email = ?`, [email]);
      console.log(`✉️ [Unsubscribe] GET auto opt-out completed for ${email}`);
      
      return res.send(renderUnsubscribePage({
        statusClass: 'success',
        messageHtml: 'SUCCESSFULLY UNSUBSCRIBED',
        subtextHtml: `You have been removed from our streetwear newsletter group. You will no longer receive drops, restock updates, or coupon emails at <strong>${email}</strong>.`,
        email,
        sig,
        showConfirm: false
      }));
    } catch (err) {
      console.error('Unsubscribe GET DB failed:', err.message);
      return res.send(renderUnsubscribePage({
        statusClass: 'error',
        messageHtml: 'SYSTEM ERROR',
        subtextHtml: 'An unexpected error occurred while processing your unsubscribe request. Please try again later.',
        email,
        sig,
        showConfirm: false
      }));
    }
  } else {
    // Missing or invalid signature (bot-crawler protection active)
    // Display interactive streetwear confirmation gate
    return res.send(renderUnsubscribePage({
      statusClass: 'warning',
      messageHtml: 'CONFIRM UNSUBSCRIBE',
      subtextHtml: `Are you sure you want to unsubscribe <strong>${email}</strong> from our newsletter?`,
      email,
      sig,
      showConfirm: true
    }));
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
const createPendingOrder = async (shippingInput, items, couponCode) => {
  const normalizedShipping = validateShippingDetails(shippingInput);
  const validatedItems = await resolveValidatedOrderItems(items);
  const pricing = calculateOrderPricing(validatedItems, couponCode);
  const orderInsert = await dbRunAsync(
    `INSERT INTO orders (
       customerName, customerEmail, address, totalAmount, status,
       firstName, lastName, phone,
       addressLine1, addressLine2, city, region, postalCode, country
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      normalizedShipping.customerName,
      normalizedShipping.customerEmail,
      normalizedShipping.address,
      pricing.totalAmount,
      'pending_payment',
      normalizedShipping.firstName,
      normalizedShipping.lastName,
      normalizedShipping.phone,
      normalizedShipping.addressLine1,
      normalizedShipping.addressLine2,
      normalizedShipping.city,
      normalizedShipping.region,
      normalizedShipping.postalCode,
      normalizedShipping.country,
    ]
  );
  const orderId = orderInsert.lastID;

  for (const item of validatedItems) {
    await dbRunAsync(
      `INSERT INTO order_items (orderId, productId, variantId, quantity, price, selectedColor, selectedSize, supplier_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderId, item.id, item.variantId || null, item.quantity, item.price, item.selectedColor || null, item.selectedSize || null, item.supplier_id || 'printify']
    );
  }

  return { orderId, pricing, items: validatedItems };
};

app.get('/api/checkout/config', (req, res) => {
  const paypalEnabled = hasPayPalCheckoutConfig();
  const stripeEnabled = hasStripeCheckoutConfig() && false; // TODO: enable once IL merchant account is available
  const payplusEnabled = hasPayPlusCheckoutConfig() && hasConfiguredValue(process.env.PAYPLUS_PAGE_UID);

  return res.json({
    paypalEnabled,
    stripeEnabled,
    payplusEnabled,
    paypalClientId: paypalEnabled ? process.env.PAYPAL_CLIENT_ID : '',
  });
});

app.get('/api/paypal/config', (req, res) => {
  if (!hasPayPalCheckoutConfig()) {
    return res.status(500).json({ error: 'PayPal client is not configured on the server' });
  }

  return res.json({ clientId: process.env.PAYPAL_CLIENT_ID });
});

app.post('/api/paypal/create-order', async (req, res) => {
  const body = req.body || {};
  const {
    customerName,
    customerEmail,
    address,
    items,
    couponCode,
    promoCode,
    currency,
  } = body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart items are required' });
  }

  // Accept either the new structured shipping shape or the legacy 3-field shape.
  const hasStructured = body.addressLine1 || body.city || body.postalCode;
  if (!hasStructured && (!customerName || !customerEmail || !address)) {
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

    const shippingInput = {
      customerName,
      customerEmail,
      address,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2,
      city: body.city,
      region: body.region,
      postalCode: body.postalCode,
      country: body.country,
    };
    const { orderId, pricing } = await createPendingOrder(shippingInput, items, couponCode);

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

    // SECURITY: snapshot exactly what we're asking PayPal to charge, before
    // ever calling PayPal. Capture-time verification checks against this
    // stored value instead of trusting the capture response's own currency
    // or recomputing a USD amount with whatever exchange rate happens to be
    // live at capture time (which could differ from the rate used here).
    await dbRunAsync(
      `UPDATE orders SET expected_payment_currency = ?, expected_payment_amount = ? WHERE id = ?`,
      [requestedCurrency, Number(amount), orderId]
    );

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
    const errMessage = String(err.message || '');
    const statusCode = errMessage.includes('Variant mismatch')
      || errMessage.includes('valid product id')
      || errMessage.includes('Shipping details')
      || errMessage.includes('Shipping address must be in English only')
      || errMessage.includes('Shipping name must be in English only')
      || errMessage.includes('Valid email')
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

    const existingOrder = await dbGetAsync(
      `SELECT id, status, totalAmount, promoCode, expected_payment_currency, expected_payment_amount FROM orders WHERE id = ?`,
      [localOrderId]
    );
    if (!existingOrder) {
      return res.status(404).json({ success: false, error: 'Order not found' });
    }

    if (existingOrder.status === 'paid') {
      return res.json({ success: true, duplicate: true, orderId: localOrderId });
    }

    // SECURITY: verify against the expected currency/amount snapshotted
    // server-side at order-creation time (see /api/paypal/create-order) —
    // never derive the expected currency from the capture response itself,
    // and never recompute a USD amount using whatever exchange rate happens
    // to be live right now (it may have moved since the order was created).
    // Same function the test suite exercises directly with zero network/DB.
    const captureCurrency = String(capture?.amount?.currency_code || '').toUpperCase();
    const captureValue = Number(capture?.amount?.value || 0);
    const verdict = validatePaypalCaptureAgainstExpectation({
      captureStatus: captureData.status,
      captureCurrency,
      captureValue,
      expectedCurrency: existingOrder.expected_payment_currency,
      expectedAmount: existingOrder.expected_payment_amount,
    });

    if (!verdict.ok) {
      if (verdict.reason === 'missing_expectation') {
        console.error(`[PayPal capture] Order #${localOrderId} has no stored expected_payment_currency/amount — refusing to trust capture response. Legacy order created before this safeguard existed.`);
        return res.status(409).json({
          success: false,
          error: 'This order predates payment verification tracking and cannot be safely captured automatically. Contact support.',
        });
      }
      if (verdict.reason === 'currency_mismatch') {
        console.error(`[PayPal capture] Currency mismatch for order #${localOrderId}: expected ${existingOrder.expected_payment_currency}, PayPal captured in ${captureCurrency}`);
        return res.status(400).json({
          success: false,
          error: 'Captured currency does not match the expected payment currency',
        });
      }
      return res.status(400).json({
        success: false,
        error: verdict.reason === 'not_completed' ? 'PayPal payment is not completed' : 'Captured amount mismatch',
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
    const paidOrder = await dbGetAsync(`SELECT customerName, totalAmount FROM orders WHERE id = ?`, [localOrderId]);
    const paidOrderItems = await dbAllAsync(`SELECT oi.*, p.title FROM order_items oi LEFT JOIN products p ON p.id = oi.productId WHERE oi.orderId = ?`, [localOrderId]);
    if (paidOrder) {
      telegram.notifyNewOrder(localOrderId, paidOrder.customerName, paidOrder.totalAmount, paidOrderItems).catch(() => null);
    }
    // Phase 3.4: Fire-and-forget — respond to PayPal immediately, fulfill in background
    processPaidOrderFulfillment(localOrderId, 'PayPal').catch(err =>
      console.error(`[fulfillment] background error for order #${localOrderId}:`, err.message)
    );

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
  const body = req.body || {};
  const { customerName, customerEmail, address, items, couponCode } = body;

  if (!hasStripeCheckoutConfig()) {
    return res.status(503).json({ success: false, error: 'Stripe checkout is currently unavailable. Please use PayPal.' });
  }

  try {
    const shippingInput = {
      customerName,
      customerEmail,
      address,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2,
      city: body.city,
      region: body.region,
      postalCode: body.postalCode,
      country: body.country,
    };
    const { orderId, pricing } = await createPendingOrder(shippingInput, items, couponCode);
    
    // Process ILS natively in agorot (1 ILS = 100 agorot)
    const stripeAmountAgorot = Math.max(50, Math.round(pricing.totalAmount * 100));
    
    // Create Stripe Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'ils',
          product_data: { name: `Drip Street bundle order #${orderId}` },
          unit_amount: stripeAmountAgorot,
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
    const statusCode = String(err.message || '').includes('Shipping') || String(err.message || '').includes('Valid email') ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Failed to initialize Stripe checkout' });
  }
});

// Checkout via PayPlus/Grow (NIS)
app.post('/api/checkout/payplus', async (req, res) => {
  const body = req.body || {};
  const { customerName, customerEmail, address, items, couponCode } = body;

  if (!hasPayPlusCheckoutConfig() || !process.env.PAYPLUS_PAGE_UID) {
    return res.status(503).json({ success: false, error: 'PayPlus checkout is currently unavailable. Please use PayPal.' });
  }

  try {
    const shippingInput = {
      customerName,
      customerEmail,
      address,
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone,
      addressLine1: body.addressLine1,
      addressLine2: body.addressLine2,
      city: body.city,
      region: body.region,
      postalCode: body.postalCode,
      country: body.country,
    };
    
    // Create local pending order and calculate pricing in NIS
    const { orderId, pricing, items: validatedItems } = await createPendingOrder(shippingInput, items, couponCode);

    // Call PayPlus REST API to generate secure payment page link
    const payplusPayload = {
      payment_page_uid: process.env.PAYPLUS_PAGE_UID,
      amount: pricing.totalAmount, // amount in ILS
      currency_code: 'ILS',
      sendEmailApproval: true,
      sendEmailFailure: false,
      refURL_success: `${FRONTEND_BASE_URL}/success?order_id=${orderId}`,
      refURL_failure: `${FRONTEND_BASE_URL}/cart`,
      custom_field: orderId.toString(),
      customer: {
        customer_name: customerName,
        email: customerEmail,
        phone: body.phone || '',
      },
      // Use the server-validated items (trusted title/price) for the payment
      // page's line-item display, not the raw client-supplied cart payload.
      items: validatedItems.map(item => ({
        name: item.title,
        quantity: item.quantity,
        price: item.price,
      })),
    };

    const response = await axios.post(
      'https://restapi.payplus.co.il/api/v1.0/PaymentPages/generateLink',
      payplusPayload,
      {
        headers: {
          'accept': 'application/json',
          'content-type': 'application/json',
          'api-key': process.env.PAYPLUS_API_KEY,
          'secret-key': process.env.PAYPLUS_SECRET_KEY,
        },
        timeout: 10000,
      }
    );

    if (response.data && response.data.results && response.data.results.status === 'success') {
      const paymentUrl = response.data.data.payment_page_link;
      res.json({ success: true, paymentUrl });
    } else {
      console.error('PayPlus API response failed:', response.data);
      const errMsg = response.data?.results?.description || 'Failed to generate PayPlus link';
      res.status(400).json({ error: errMsg });
    }
  } catch (err) {
    console.error('PayPlus checkout initialization error:', err.response?.data || err.message);
    const statusCode = String(err.message || '').includes('Shipping') || String(err.message || '').includes('Valid email') ? 400 : 500;
    res.status(statusCode).json({ error: err.message || 'Failed to initialize PayPlus checkout' });
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

    // === Admin Coupon Command (Telegram → quick coupon generation) ===
    // Clear active coupon: "/coupon clear" or "קופון בטל"
    const couponClearMatch = /^(?:\/coupon\s+(?:clear|off|stop|cancel)|קופון\s+(?:בטל|נקה|כיבוי|הפסק))\s*$/i.test(message.text);

    if (couponClearMatch) {
      const had = currentActiveCoupon ? currentActiveCoupon.code : null;
      currentActiveCoupon = null;
      await telegram.sendMessage(had
        ? `🧹 Coupon <code>${had}</code> cleared.`
        : `ℹ️ No active coupon to clear.`).catch(() => null);
      return res.json({ received: true, action: 'coupon_cleared', code: had });
    }

    // Create coupon: "/coupon 50" or "/coupon 50 24" (pct, hours)
    //                "קופון 100" or "קופון 50 2"
    const couponMatch = String(message.text).match(/^(?:\/coupon|קופון)\s+(\d{1,3})\s*%?(?:\s+(\d{1,3}))?\s*$/i);

    if (couponMatch) {
      const pct = parseInt(couponMatch[1], 10);
      const hours = couponMatch[2] ? parseInt(couponMatch[2], 10) : 1;

      if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
        await telegram.sendMessage(`⚠️ Invalid discount: <b>${pct}</b>. Use 1-100.`).catch(() => null);
        return res.json({ received: true, error: 'invalid_pct' });
      }
      if (!Number.isFinite(hours) || hours < 1 || hours > 168) {
        await telegram.sendMessage(`⚠️ Invalid duration: <b>${hours}h</b>. Use 1-168 hours.`).catch(() => null);
        return res.json({ received: true, error: 'invalid_hours' });
      }

      const suffix = crypto.randomBytes(3).toString('hex').toUpperCase();
      const code = `MENI-${suffix}`;
      currentActiveCoupon = { code, discount_pct: pct };

      setTimeout(() => {
        if (currentActiveCoupon && currentActiveCoupon.code === code) {
          currentActiveCoupon = null;
          console.log(`Coupon ${code} expired.`);
          telegram.sendMessage(`⏰ Coupon <code>${code}</code> expired automatically.`).catch(() => null);
        }
      }, hours * 60 * 60 * 1000);

      const reply = `✅ <b>Coupon Created</b>\n\n`
        + `<b>Code:</b> <code>${code}</code>\n`
        + `<b>Discount:</b> ${pct}% off\n`
        + `<b>Valid for:</b> ${hours} hour${hours !== 1 ? 's' : ''}\n\n`
        + `Tap the code above to copy, then paste at checkout.`;

      await telegram.sendMessage(reply).catch(() => null);
      return res.json({ received: true, coupon: code, discount: pct, hours });
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

    let botResponse = { text: "A human support representative has been notified and will reply shortly.", status: "escalated" };
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

// Core Email Recovery & Retry Logic
const runEmailRetryRecovery = async (forceIgnoreBackoff = false) => {
  console.log(`🔄 [Email Recovery] Checking for undelivered receipt and welcome emails... (forceIgnoreBackoff: ${forceIgnoreBackoff})`);
  const stats = { ordersChecked: 0, ordersRecovered: 0, leadsChecked: 0, leadsRecovered: 0 };
  
  try {
    const nowIso = new Date().toISOString();

    // 1. Recover Order Emails
    const pendingOrders = await dbAllAsync(
      `SELECT * FROM orders WHERE status = 'paid' AND (emailSent IS NULL OR emailSent = 0) AND COALESCE(emailAttempts, 0) < 5`
    );
    
    if (pendingOrders && pendingOrders.length > 0) {
      console.log(`🔄 Found ${pendingOrders.length} paid orders with unsent emails. Assessing...`);
      for (const order of pendingOrders) {
        try {
          stats.ordersChecked += 1;
          const attempts = Number(order.emailAttempts || 0);
          const lastAttemptAt = order.lastEmailAttemptAt;

          if (!forceIgnoreBackoff && attempts > 0 && lastAttemptAt) {
            const elapsedMs = Date.now() - new Date(lastAttemptAt).getTime();
            const elapsedMinutes = elapsedMs / (1000 * 60);
            
            let requiredDelayMinutes = 5;
            if (attempts === 2) requiredDelayMinutes = 15;
            else if (attempts === 3) requiredDelayMinutes = 60;
            else if (attempts === 4) requiredDelayMinutes = 240;
            
            if (elapsedMinutes < requiredDelayMinutes) {
              console.log(`⏭️ [Retry Gatekeeper] Skipping order #${order.id} (Email: ${order.customerEmail}). Delay of ${requiredDelayMinutes}m required, only ${Math.round(elapsedMinutes)}m elapsed.`);
              continue;
            }
          }

          // Proceed with attempt
          const nextAttemptCount = attempts + 1;
          await dbRunAsync(`UPDATE orders SET emailAttempts = ?, lastEmailAttemptAt = ? WHERE id = ?`, [nextAttemptCount, nowIso, order.id]).catch(() => null);

          const items = await dbAllAsync(
            `SELECT oi.*, p.title, p.printifyId AS printifyProductId, pv.printifyVariantId
             FROM order_items oi
             LEFT JOIN products p ON p.id = oi.productId
             LEFT JOIN product_variants pv ON pv.id = oi.variantId
             WHERE oi.orderId = ?`,
            [order.id]
          );
          if (!items || !items.length) {
            console.warn(`⚠️ No items found for order #${order.id}. Skipping.`);
            continue;
          }

          const subtotal = items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.quantity) || 0), 0);
          const shipping = subtotal >= FREE_SHIPPING_THRESHOLD_NIS ? 0 : (subtotal > 0 ? SHIPPING_COST_NIS : 0);
          const total = Number(order.totalAmount) || 0;
          const discount = Math.max(0, roundCurrency(subtotal + shipping - total));

          const emailItems = items.map((item) => ({
            title: item.title || 'Drip Street Item',
            color: item.selectedColor || null,
            size: item.selectedSize || null,
            quantity: item.quantity,
            price: item.price,
          }));

          const emailRes = await emailService.sendOrderConfirmationEmail(
            order.customerEmail,
            order.id,
            order.customerName,
            emailItems,
            { subtotal: roundCurrency(subtotal), shipping, discount, total },
            order.address
          );

          if (emailRes && emailRes.ok) {
            await dbRunAsync(`UPDATE orders SET emailSent = 1 WHERE id = ?`, [order.id]);
            stats.ordersRecovered += 1;
            console.log(`✅ [Retry Recovery] Email sent and DB updated for order #${order.id}`);
          } else {
            console.warn(`⚠️ [Retry Recovery] Email attempt failed for order #${order.id}`);
            if (nextAttemptCount >= 5) {
              await telegram.sendMessage(`🚨 <b>Email Delivery Permanently Failed</b>\nOrder #${order.id} for ${order.customerName} has reached 5 delivery attempts and will not be retried automatically. Please verify customer email manually: <code>${order.customerEmail}</code>`).catch(() => null);
            }
          }
        } catch (itemErr) {
          console.error(`❌ [Retry Recovery] Error processing order #${order.id}:`, itemErr.message);
        }
      }
    }

    // 2. Recover Lead Emails
    const pendingLeads = await dbAllAsync(
      `SELECT * FROM leads WHERE (emailSent IS NULL OR emailSent = 0) AND COALESCE(emailAttempts, 0) < 5 AND unsubscribed = 0`
    );

    if (pendingLeads && pendingLeads.length > 0) {
      console.log(`🔄 Found ${pendingLeads.length} leads with unsent welcome emails. Assessing...`);
      for (const lead of pendingLeads) {
        try {
          stats.leadsChecked += 1;
          const attempts = Number(lead.emailAttempts || 0);
          const lastAttemptAt = lead.lastEmailAttemptAt;

          if (!forceIgnoreBackoff && attempts > 0 && lastAttemptAt) {
            const elapsedMs = Date.now() - new Date(lastAttemptAt).getTime();
            const elapsedMinutes = elapsedMs / (1000 * 60);
            
            let requiredDelayMinutes = 5;
            if (attempts === 2) requiredDelayMinutes = 15;
            else if (attempts === 3) requiredDelayMinutes = 60;
            else if (attempts === 4) requiredDelayMinutes = 240;
            
            if (elapsedMinutes < requiredDelayMinutes) {
              console.log(`⏭️ [Retry Gatekeeper] Skipping lead #${lead.id} (Email: ${lead.email}). Delay of ${requiredDelayMinutes}m required, only ${Math.round(elapsedMinutes)}m elapsed.`);
              continue;
            }
          }

          // Proceed with attempt
          const nextAttemptCount = attempts + 1;
          await dbRunAsync(`UPDATE leads SET emailAttempts = ?, lastEmailAttemptAt = ? WHERE id = ?`, [nextAttemptCount, nowIso, lead.id]).catch(() => null);

          const emailRes = await emailService.sendCouponEmail(lead.email, lead.promo_code);

          if (emailRes && emailRes.ok) {
            await dbRunAsync(`UPDATE leads SET emailSent = 1 WHERE id = ?`, [lead.id]);
            stats.leadsRecovered += 1;
            console.log(`✅ [Retry Recovery] Welcome email sent and DB updated for lead #${lead.id}`);
          } else {
            console.warn(`⚠️ [Retry Recovery] Welcome email attempt failed for lead #${lead.id}`);
            if (nextAttemptCount >= 5) {
              await telegram.sendMessage(`🚨 <b>Welcome Email Permanently Failed</b>\nLead #${lead.id} (${lead.email}) has reached 5 delivery attempts and will not be retried automatically. Please verify manually.`).catch(() => null);
            }
          }
        } catch (leadErr) {
          console.error(`❌ [Retry Recovery] Error processing lead #${lead.id}:`, leadErr.message);
        }
      }
    }
  } catch (err) {
    console.error('⚠️ [Retry Recovery] Core recovery execution failed:', err.message);
  }
  
  return stats;
};

// Start background cron jobs
// Only actually start the server/cron jobs when this file is run directly
// (node index.js — exactly how npm start and Render both launch it). When
// required as a module (tests), this is skipped entirely so a test can
// import pure helpers/`app` without side effects: no real port bound, no
// cron jobs, no external calls.
// DISABLE_BACKGROUND_JOBS=true additionally skips pricingEngine.start() and
// the auto-sync/catalog-seed/cron block below, even when run directly — for
// hermetic verification runs that must make zero outbound network calls.
const backgroundJobsDisabled = process.env.DISABLE_BACKGROUND_JOBS === 'true';
if (require.main === module) {
if (!backgroundJobsDisabled) pricingEngine.start();

app.listen(PORT, () => {
  console.log(`🚀 Headless E-commerce Backend running on http://localhost:${PORT}`);

  if (backgroundJobsDisabled) {
    console.log('⏭️ DISABLE_BACKGROUND_JOBS=true — skipping auto-sync, catalog seeding, and all cron registrations.');
    return;
  }

  // ---- AUTO-SYNC INITIALIZATION ----
  const seedFallbackCatalog = () => {
    return new Promise((resolve) => {
      const fs = require('fs');
      const path = require('path');
      db.get("SELECT COUNT(*) AS count FROM products", [], (err, row) => {
        if (err) {
          console.error("❌ Seeding check failed:", err.message);
          return resolve(0);
        }
        if (row && row.count === 0) {
          console.log("Empty catalog detected. Seeding high-fidelity fallback products...");
          const seedFile = path.resolve(__dirname, 'data', 'products_seed.json');
          if (fs.existsSync(seedFile)) {
            try {
              const seedData = JSON.parse(fs.readFileSync(seedFile, 'utf8'));
              db.serialize(() => {
                let seededCount = 0;
                seedData.forEach(p => {
                  db.run(`INSERT INTO products (id, title, description, price, priceUSD, imageUrl, backImageUrl, stock, type, printifyId, fabric, careInstructions, deliveryInfo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [p.id, p.title, p.description, p.price, p.priceUSD, p.imageUrl, p.backImageUrl, p.stock, p.type, p.printifyId, p.fabric, p.careInstructions, p.deliveryInfo],
                    (insertErr) => {
                      if (insertErr) {
                        console.error(`Error seeding product ${p.title}:`, insertErr.message);
                      }
                    }
                  );
                  
                  if (Array.isArray(p.variants)) {
                    p.variants.forEach(v => {
                      db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [p.id, v.printifyVariantId, v.color, v.colorHex, v.size, v.price, v.cost, v.stockQty, v.isEnabled, v.isAvailable, v.imageUrl],
                        (varErr) => {
                          if (varErr) {
                            console.error(`Error seeding variant for product ${p.title}:`, varErr.message);
                          }
                        }
                      );
                    });
                  }
                  seededCount++;
                });
                console.log(`✅ Successfully seeded ${seededCount} fallback products and their variants.`);
                resolve(seededCount);
              });
            } catch (e) {
              console.error("❌ Failed to parse or seed products_seed.json:", e.message);
              resolve(0);
            }
          } else {
            console.warn("⚠️ Seed file products_seed.json not found at:", seedFile);
            resolve(0);
          }
        } else {
          console.log(`ℹ️ Catalog already populated with ${row.count} products. Skipping seeding.`);
          resolve(0);
        }
      });
    });
  };

  const performSync = async () => {
    try {
      const printifySyncEnabled = isPrintifySyncEnabled();
      if (!printifySyncEnabled) {
        console.log('⏭️ Printify auto-sync disabled for this environment. Loading fallback seeder...');
        await seedFallbackCatalog();
        return 0;
      }

      const hasPrintifyKey = process.env.PRINTIFY_API_TOKEN && 
                             process.env.PRINTIFY_API_TOKEN !== 'YOUR_PRINTIFY_TOKEN' &&
                             process.env.PRINTIFY_API_TOKEN !== 'YOUR_PRINTIFY_TOKEN_ROTATED';
      if (hasPrintifyKey) {
        const count = await printify.syncProducts();
        const timestamp = new Date().toLocaleString('he-IL');
        global.lastSyncTime = timestamp; // Track for status endpoint
        console.log(`✅ Sync complete [${timestamp}]: ${count} Printify products synced.`);
        return count;
      } else {
        console.log('⏭️ Printify key is missing or is a placeholder. Loading fallback seeder...');
        await seedFallbackCatalog();
        return 0;
      }
    } catch (err) {
      console.error('⚠️ Sync failed:', err.message);
      telegram.sendMessage(`⚠️ <b>Printify Sync Error</b>\n\nTime: ${new Date().toLocaleString('he-IL')}\nError: ${err.message}`).catch(console.error);
      console.log('🔄 Triggering safe catalog fallback seeder after sync failure...');
      await seedFallbackCatalog();
      return 0;
    }
  };
  
  // Idempotent seeder for CJ Dropshipping products — runs on every startup
  // Ensures dropship products exist in production even after ephemeral DB wipes on Render
  const seedDropshipProducts = () => new Promise((resolve) => {
    const CJ_CATALOG = [
      {
        id: 16, // Canonical ID — must match frontend routes (/product/16)
        title: 'Six-sided Grinding Cuban Link Chain | Premium Jewelry',
        description: 'Elevate your aesthetic with our premium Six-sided Grinding Cuban Link Chain. Meticulously engineered with six flat-cut facets per link to capture the light. Crafted in solid hypoallergenic stainless steel and plated in a deep, premium gold/silver finish. A flagship staple of the Drip Street jewelry line.',
        price: 149.00,
        priceUSD: 39.90,
        imageUrl: 'https://cf.cjdropshipping.com/f737cb87-9e26-4215-af24-032cb5bb980e.jpg',
        type: 'dropship',
        supplier_id: 'dropship',
        printifyId: 'CJLX222053101AZ',
        stock: 999,
        variant: { color: 'Gold', size: '20 Inch', price: 149.00, cost: 21.80, printifyVariantId: 'CJLX222053101AZ', stockQty: 999, imageUrl: 'https://cf.cjdropshipping.com/f737cb87-9e26-4215-af24-032cb5bb980e.jpg' },
      },
    ];

    let pending = CJ_CATALOG.length;
    if (pending === 0) return resolve();

    CJ_CATALOG.forEach((product) => {
      const targetId = product.id;
      const v = product.variant;

      // Nuclear overwrite: always delete canonical product and its variants, then re-insert fresh.
      db.run(`DELETE FROM product_variants WHERE productId = ?`, [targetId], (deleteVariantErr) => {
        if (deleteVariantErr) {
          console.error('[CJ Seed] Variant delete failed:', deleteVariantErr.message);
          if (--pending === 0) resolve();
          return;
        }

        db.run(`DELETE FROM products WHERE id = ?`, [targetId], (deleteProductErr) => {
          if (deleteProductErr) {
            console.error('[CJ Seed] Product delete failed:', deleteProductErr.message);
            if (--pending === 0) resolve();
            return;
          }

          db.run(
            `INSERT INTO products (id, title, description, price, priceUSD, imageUrl, images, type, printifyId, supplier_id, stock)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
            [targetId, product.title, product.description, product.price, product.priceUSD, product.imageUrl, product.type, product.printifyId, product.supplier_id, product.stock],
            (insertProductErr) => {
              if (insertProductErr) {
                console.error('[CJ Seed] Product insert failed:', insertProductErr.message);
                if (--pending === 0) resolve();
                return;
              }

              db.run(
                `INSERT INTO product_variants (productId, printifyVariantId, color, size, price, cost, stockQty, isEnabled, isAvailable, imageUrl)
                 VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
                [targetId, v.printifyVariantId, v.color, v.size, v.price, v.cost, v.stockQty, v.imageUrl],
                (insertVariantErr) => {
                  if (insertVariantErr) {
                    console.error('[CJ Seed] Variant insert failed:', insertVariantErr.message);
                  } else {
                    console.log(`✅ [CJ Seed] Forced overwrite complete for ID:${targetId}`);
                  }
                  if (--pending === 0) resolve();
                }
              );
            }
          );
        });
      });
    });
  });

  // Auto-sync on startup (critical for Render where DB is ephemeral)
  setTimeout(async () => {
    console.log('🔄 Auto-syncing Printify products on startup...');
    await performSync();
    await seedDropshipProducts();
    // Hardware catalog (CJ IDs 17-21) — must run every startup because Render's
    // SQLite is ephemeral and these rows aren't backed by the Printify sync.
    try {
      console.log('🔄 Seeding CJ hardware catalog (IDs 17-21)...');
      await seedHardwareCatalog({ verbose: false });
      console.log('✅ CJ hardware catalog seeded.');
    } catch (err) {
      console.error('⚠️ CJ hardware seed failed:', err.message);
    }
  }, 3000);
  
  // ---- SCHEDULED SYNC: Every hour ----
  const cron = require('node-cron');
  try {
    const syncJob = cron.schedule('0 * * * *', async () => {
      console.log('⏰ [Scheduled Sync] Running hourly Printify sync...');
      await performSync();
    }, { scheduled: true });
    
    console.log('✅ Scheduled sync configured: Every hour (UTC)');

    // ---- SCHEDULED EMAIL RETRY: Every 15 minutes ----
    const emailRetryJob = cron.schedule('*/15 * * * *', async () => {
      await runEmailRetryRecovery(false);
    }, { scheduled: true });

    console.log('✅ Scheduled email recovery configured: Every 15 minutes');
  } catch (cronErr) {
    console.warn('⚠️ Cron not available (dev environment):', cronErr.message);
  }
});
}

// Conditional Mounting: dev/test routes are only loaded outside production.
// Guards: NODE_ENV must not be 'production', AND RENDER env var must not be set
// (Render always injects RENDER=true on all its environments).
const isProduction = process.env.NODE_ENV === 'production' || !!process.env.RENDER;
if (!isProduction) {
  app.use('/api/test', require('./routes/dev')(processPaidOrderFulfillment));
  console.log('🧪 Development simulation router mounted at /api/test');
}

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Exception:', err);
  telegram.sendMessage(`🚨 <b>Critical Server Error</b>\n\nRoute: ${req.url}\nError: ${err.message}`).catch(console.error);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Exported for tests only (no effect when run directly via `node index.js`).
module.exports = { app, validatePaypalCaptureAgainstExpectation, processPaidOrderFulfillment };
