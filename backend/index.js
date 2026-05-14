const express = require('express');
const cors = require('cors');
const db = require('./db');
const telegram = require('./services/telegram');
const pricingEngine = require('./services/pricing');
const printify = require('./services/printify');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

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

// Checkout / Place Order
app.post('/api/checkout', (req, res) => {
  const { customerName, customerEmail, address, items, totalAmount } = req.body;
  
  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Cart is empty' });
  }

  // Transaction-like logic
  db.run(`INSERT INTO orders (customerName, customerEmail, address, totalAmount, status) VALUES (?, ?, ?, ?, ?)`, 
    [customerName, customerEmail, address, totalAmount, 'paid'], 
    function(err) {
      if (err) {
        return res.status(500).json({ error: 'Failed to create order' });
      }
      
      const orderId = this.lastID;
      
      const localItems = [];
      const printifyItems = [];

      // Insert items and reduce stock
      items.forEach(item => {
        db.run(`INSERT INTO order_items (orderId, productId, quantity, price) VALUES (?, ?, ?, ?)`,
          [orderId, item.id, item.quantity, item.price]);
          
        if (item.type === 'printify') {
          printifyItems.push(item);
        } else {
          localItems.push(item);
          // Only reduce stock for local items
          db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.quantity, item.id]);
        }
      });
      
      // Trigger Telegram Notification
      console.log(`[Order #${orderId}] New order received from ${customerName}. Total: ₪${totalAmount}`);
      telegram.notifyNewOrder(orderId, customerName, totalAmount, items);
      
      // Auto-Fulfill Printify Items
      if (printifyItems.length > 0) {
        printify.sendOrderToProduction(orderId, customerName, customerEmail, address, printifyItems)
          .catch(err => console.error("Printify Fulfillment Error:", err));
      }
      
      res.json({ success: true, orderId, message: 'Order placed successfully!' });
  });
});

// Mock Payment Gateway Route (PayPal / Meshulam / Grow)
app.post('/api/create-payment', (req, res) => {
  const { totalAmount } = req.body;
  // Here we would call the Payment Provider's API to get a checkout session URL
  // Example: const session = await paypal.createOrder(totalAmount);
  
  res.json({ 
    success: true, 
    paymentUrl: 'https://sandbox.paypal.com/checkoutnow?token=MOCK_TOKEN',
    transactionId: `TXN-${Date.now()}`
  });
});

// Start background cron jobs
pricingEngine.start();

app.listen(PORT, () => {
  console.log(`🚀 Headless E-commerce Backend running on http://localhost:${PORT}`);
});
