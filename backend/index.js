const express = require('express');
const cors = require('cors');
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
      event = JSON.parse(payload);
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
    
    // Notify Meni
    telegram.sendMessage(`💰 <b>תשלום בדולרים התקבל! (Stripe)</b>\n\nהזמנה #${orderId} שולמה בהצלחה. סכום: $${amount}`);
    
    // Trigger Printify fulfillment since payment is confirmed
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      if (!err && order) {
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
  const orderId = custom_field; // We pass orderId in custom_field during PayPlus creation
  
  if (status === 'success') {
    console.log(`[PayPlus Webhook] Payment successful for Order #${orderId}`);
    db.run(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);
    telegram.sendMessage(`💰 <b>תשלום בשקלים התקבל! (PayPlus/Grow)</b>\n\nהזמנה #${orderId} שולמה בהצלחה דרך אשראי/Bit.`);
    
    // Trigger Printify fulfillment since payment is confirmed
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      if (!err && order) {
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
    
    // Add priceUSD dynamically using the live rate
    const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
    const productsWithUSD = rows.map(r => ({
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
    try { row.images = JSON.parse(row.images || '[]'); } catch(e) { row.images = []; }
    
    // Add priceUSD dynamically
    const exchangeRate = pricingEngine.exchangeRateUSDILS || 3.75;
    row.priceUSD = parseFloat((row.price / exchangeRate).toFixed(2));
    
    // Fetch variants for this product
    db.all("SELECT * FROM product_variants WHERE productId = ? AND isEnabled = 1", [id], (err2, variants) => {
      if (err2) variants = [];
      
      // Group variants by color and size
      const colors = {};
      const sizes = new Set();
      (variants || []).forEach(v => {
        if (v.color && !colors[v.color]) {
          colors[v.color] = { hex: v.colorHex || '#000', name: v.color };
        }
        if (v.size) sizes.add(v.size);
      });
      
      row.variants = (variants || []).map(v => ({
        ...v,
        priceUSD: parseFloat((v.price / exchangeRate).toFixed(2))
      }));
      row.colors = Object.values(colors);
      row.sizes = Array.from(sizes);
      
      res.json(row);
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
  
  // Auto-sync Printify products on startup (critical for Render where DB is ephemeral)
  setTimeout(async () => {
    try {
      const hasPrintifyKey = process.env.PRINTIFY_API_TOKEN && process.env.PRINTIFY_API_TOKEN !== 'YOUR_PRINTIFY_TOKEN';
      if (hasPrintifyKey) {
        console.log('🔄 Auto-syncing Printify products on startup...');
        const count = await printify.syncProducts();
        console.log(`✅ Auto-sync complete: ${count} Printify products loaded.`);
      }
    } catch (err) {
      console.error('⚠️ Auto-sync failed (non-fatal):', err.message);
    }
  }, 3000); // Wait 3s for DB to fully initialize
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled Exception:', err);
  telegram.sendMessage(`🚨 <b>Critical Server Error</b>\n\nRoute: ${req.url}\nError: ${err.message}`).catch(console.error);
  res.status(500).json({ error: 'Internal Server Error' });
});
