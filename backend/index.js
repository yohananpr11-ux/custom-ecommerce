const express = require('express');
const cors = require('cors');
const axios = require('axios');
const db = require('./db');
const telegram = require('./services/telegram');
const pricingEngine = require('./services/pricing');
const printify = require('./services/printify');
const meniChat = require('./services/meni');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock');

app.use(cors());

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
    await telegram.sendMessage(
      `💰 <b>תשלום התקבל! (${provider})</b>\n\n`
      + `<b>הזמנה:</b> #${orderId}\n`
      + `<b>סכום עסקה:</b> ${amountText}\n`
      + `<b>סה"כ נכנס (שולם):</b> ₪${totalPaid.toFixed(2)}`
    );
  } catch (err) {
    await telegram.sendMessage(`⚠️ <b>תשלום נקלט אבל חישוב סכום מצטבר נכשל</b>\nהזמנה #${orderId}`).catch(() => null);
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
    || (process.env.RENDER_EXTERNAL_URL ? `${process.env.RENDER_EXTERNAL_URL}/api/webhooks/printify` : null);

  if (!PRINTIFY_API_TOKEN || !PRINTIFY_SHOP_ID || !WEBHOOK_URL) {
    return res.status(400).json({
      success: false,
      error: 'Missing required environment variables',
      required: ['PRINTIFY_API_TOKEN', 'PRINTIFY_SHOP_ID', 'PRINTIFY_WEBHOOK_URL or RENDER_EXTERNAL_URL']
    });
  }

  const events = [
    'shop:product:updated',
    'shop:product:deleted',
    'shop:product:published'
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
      const alreadyExists = existingHooks.some((hook) => hook.topic === event && hook.address === WEBHOOK_URL);
      if (alreadyExists) {
        results.push({ topic: event, status: 'skipped', reason: 'already_registered' });
        continue;
      }

      try {
        const createRes = await axios.post(apiUrl, { topic: event, address: WEBHOOK_URL }, { headers });
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
    const orderId = session.client_reference_id;
    const amount = session.amount_total / 100;
    
    console.log(`[Stripe Webhook] Payment successful for Order #${orderId}`);
    
    // Update DB status
    db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);
    await sendPaymentNotification({ provider: 'Stripe', orderId, amountText: `$${amount.toFixed(2)}` });
    
    // Trigger Printify fulfillment since payment is confirmed
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      if (!err && order) {
        if (isSimulationOrder(order)) {
          telegram.sendMessage(`🧪 <b>סימולציה:</b> הזמנה #${orderId} סומנה כ-paid ב-Stripe ללא שליחה ל-Printify.`).catch(() => null);
          return;
        }

        db.all(`SELECT * FROM order_items WHERE orderId = ?`, [orderId], async (err, items) => {
          if (!err && items && items.length > 0) {
            try {
              await printify.sendOrderToProduction(orderId, order.customerName, order.customerEmail, order.address, items);
              telegram.sendMessage(`🏭 <b>הזמנה #${orderId} נשלחה לייצור!</b>\nההזמנה הועברה בהצלחה למפעל ב-Printify.`);
            } catch (pErr) {
              telegram.sendMessage(`🚨 <b>שגיאה בשליחה לייצור</b>\nהזמנה #${orderId} שולמה אבל נכשלה בהעברה ל-Printify.`);
            }
          }
        });
      }
    });
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
    db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);
    const orderTotalAmount = await getOrderTotalAmount(orderId);
    await sendPaymentNotification({ provider: 'PayPlus/Grow', orderId, amountText: `₪${orderTotalAmount.toFixed(2)}` });
    
    // Trigger Printify fulfillment since payment is confirmed
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      if (!err && order) {
        if (isSimulationOrder(order)) {
          telegram.sendMessage(`🧪 <b>סימולציה:</b> הזמנה #${orderId} סומנה כ-paid ב-PayPlus ללא שליחה ל-Printify.`).catch(() => null);
          return;
        }

        db.all(`SELECT * FROM order_items WHERE orderId = ?`, [orderId], async (err, items) => {
          if (!err && items && items.length > 0) {
            try {
              await printify.sendOrderToProduction(orderId, order.customerName, order.customerEmail, order.address, items);
              telegram.sendMessage(`🏭 <b>הזמנה #${orderId} נשלחה לייצור!</b>\nההזמנה הועברה בהצלחה למפעל ב-Printify.`);
            } catch (pErr) {
              telegram.sendMessage(`🚨 <b>שגיאה בשליחה לייצור</b>\nהזמנה #${orderId} שולמה אבל נכשלה בהעברה ל-Printify.`);
            }
          }
        });
      }
    });
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
  db.get("SELECT * FROM products WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) return res.status(404).json({ error: 'Product not found' });
    
    // Parse images JSON
    let imageData = { allImages: [], variantImageMap: {} };
    try { 
      imageData = JSON.parse(row.images || '{}');
      if (!imageData.allImages) imageData.allImages = [];
      if (!imageData.variantImageMap) imageData.variantImageMap = {};
    } catch(e) { }
    
    // Add priceUSD dynamically
    const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
    row.priceUSD = parseFloat((row.price / exchangeRate).toFixed(2));
    
    // Fetch variants for this product
    db.all("SELECT * FROM product_variants WHERE productId = ? AND isEnabled = 1", [id], (err2, variants) => {
      if (err2) variants = [];
      
      // Group variants by color and size, and map images to colors
      const colors = {};
      const sizes = new Set();
      const imagesByColor = {}; // Maps color to its images
      
      (variants || []).forEach(v => {
        if (v.color && !colors[v.color]) {
          colors[v.color] = { hex: v.colorHex || '#000', name: v.color };
          
          // Get images for this color from the variant's imageUrl or variantImageMap
          if (v.imageUrl) {
            imagesByColor[v.color] = [{ src: v.imageUrl, position: 'front' }];
          } else if (imageData.variantImageMap[v.printifyVariantId]) {
            imagesByColor[v.color] = imageData.variantImageMap[v.printifyVariantId];
          } else {
            imagesByColor[v.color] = imageData.allImages;
          }
        }
        if (v.size) sizes.add(v.size);
      });
      
      row.variants = (variants || []).map(v => ({
        ...v,
        priceUSD: parseFloat((v.price / exchangeRate).toFixed(2))
      }));
      row.colors = Object.values(colors);
      row.sizes = Array.from(sizes);
      row.imagesByColor = imagesByColor; // Send color-mapped images to frontend
      row.images = imageData.allImages; // Keep all images as fallback
      
      res.json(row);
    });
  });
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
const createPendingOrder = (customerName, customerEmail, address, items, totalAmount) => {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO orders (customerName, customerEmail, address, totalAmount, status) VALUES (?, ?, ?, ?, ?)`, 
      [customerName, customerEmail, address, totalAmount, 'pending_payment'], 
      function(err) {
        if (err) return reject(err);
        const orderId = this.lastID;
        items.forEach(item => {
          db.run(`INSERT INTO order_items (orderId, productId, quantity, price) VALUES (?, ?, ?, ?)`,
            [orderId, item.id, item.quantity, item.price]);
        });

        telegram.notifyNewOrder(orderId, customerName, totalAmount, items).catch(() => null);

        resolve(orderId);
      });
  });
};

// Checkout via Stripe (USD)
app.post('/api/checkout/stripe', async (req, res) => {
  const { customerName, customerEmail, address, items, totalAmount } = req.body;
  
  try {
    const orderId = await createPendingOrder(customerName, customerEmail, address, items, totalAmount);
    
    // Create Stripe Session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: items.map(item => ({
        price_data: {
          currency: 'usd',
          product_data: { name: item.title },
          unit_amount: Math.round((item.price / 3.7) * 100), // convert NIS to USD cents roughly
        },
        quantity: item.quantity,
      })),
      mode: 'payment',
      success_url: 'https://custom-ecommerce-seven.vercel.app/success?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: 'https://custom-ecommerce-seven.vercel.app/cart',
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
  const { customerName, customerEmail, address, items, totalAmount } = req.body;
  
  try {
    const orderId = await createPendingOrder(customerName, customerEmail, address, items, totalAmount);
    
    // Integration logic for PayPlus
    // Normally we make an axios.post to api.payplus.co.il with payload
    const hasPayPlusKey = process.env.PAYPLUS_API_KEY && process.env.PAYPLUS_API_KEY !== 'YOUR_PAYPLUS_KEY';
    
    if (hasPayPlusKey) {
      // Execute actual PayPlus API call here
    }

    // Return a mocked URL for demonstration if no keys
    const mockPaymentUrl = `https://payment.payplus.co.il/mock-checkout/${orderId}`;
    res.json({ success: true, paymentUrl: mockPaymentUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initialize PayPlus checkout' });
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
