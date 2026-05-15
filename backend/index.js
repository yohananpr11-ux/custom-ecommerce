const express = require('express');
const cors = require('cors');
const db = require('./db');
const telegram = require('./services/telegram');
const pricingEngine = require('./services/pricing');
const printify = require('./services/printify');
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
    
    // Here we would trigger Printify fulfillment since payment is confirmed
    db.get(`SELECT * FROM orders WHERE id = ?`, [orderId], (err, order) => {
      // In a full implementation, we fetch order items from DB and trigger Printify
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
  }
  
  res.json({received: true});
});

app.use(express.json());

// Pulse Check Route
app.get('/', (req, res) => {
  res.send('Server is running and connected to Meni (Telegram).');
});

// Get all products
app.get('/api/products', (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    res.json(rows);
  });
});

// Get single product
app.get('/api/products/:id', (req, res) => {
  const { id } = req.params;
  db.get("SELECT * FROM products WHERE id = ?", [id], (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
      return;
    }
    if (!row) return res.status(404).json({ error: 'Product not found' });
    res.json(row);
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
    const mockPaymentUrl = \`https://payment.payplus.co.il/mock-checkout/\${orderId}\`;
    res.json({ success: true, paymentUrl: mockPaymentUrl });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to initialize PayPlus checkout' });
  }
});

// Start background cron jobs
pricingEngine.start();

app.listen(PORT, () => {
  console.log(`🚀 Headless E-commerce Backend running on http://localhost:${PORT}`);
});
