const express = require('express');
const db = require('../db');

const dbGetAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.get(sql, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
});

const dbAllAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.all(sql, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows);
  });
});

const dbRunAsync = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function (err) {
    if (err) reject(err);
    else resolve(this);
  });
});

module.exports = function (processPaidOrderFulfillment) {
  const router = express.Router();

  // POST /api/test/simulate-dropship-fulfillment
  // Triggers a complete paid checkout sequence for dropshipped jewelry end-to-end
  router.post('/simulate-dropship-fulfillment', async (req, res) => {
    try {
      const mockEmail = req.body.email || 'customer-jewel@dripstreetshop.com';
      const mockName = req.body.name || 'John Doe';
      const mockPhone = req.body.phone || '555-0199';
      const mockAddress = req.body.address || '100 Broadway';
      const mockCity = req.body.city || 'New York';
      const mockState = req.body.region || 'NY';
      const mockZip = req.body.postalCode || '10005';
      const mockCountry = req.body.country || 'US';

      // Seed/retrieve the jewelry product
      const product = await dbGetAsync(`SELECT * FROM products WHERE supplier_id = 'dropship' ORDER BY id DESC LIMIT 1`);
      if (!product) {
        return res.status(400).json({ error: 'No dropship jewelry product found. Please run the seed script first.' });
      }

      const variant = await dbGetAsync(`SELECT * FROM product_variants WHERE productId = ? LIMIT 1`, [product.id]);
      if (!variant) {
        return res.status(400).json({ error: 'No product variants found for this jewelry product.' });
      }

      console.log(`[Simulation] Found dropship product: ID=${product.id}, SKU=${variant.printifyVariantId}`);

      // Create mock order in the DB
      const orderInsert = await dbRunAsync(
        `INSERT INTO orders (
          customerName, customerEmail, address, status,
          firstName, lastName, phone, addressLine1, addressLine2, city, region, postalCode, country,
          totalAmount
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mockName,
          mockEmail,
          `${mockAddress}, ${mockCity}, ${mockState}, ${mockZip}, ${mockCountry}`,
          'pending',
          mockName.split(' ')[0] || 'John',
          mockName.split(' ').slice(1).join(' ') || 'Doe',
          mockPhone,
          mockAddress,
          '',
          mockCity,
          mockState,
          mockZip,
          mockCountry,
          product.price
        ]
      );

      const orderId = orderInsert.lastID;
      console.log(`[Simulation] Mock order #${orderId} created.`);

      // Insert mock order item
      await dbRunAsync(
        `INSERT INTO order_items (orderId, productId, variantId, quantity, price, selectedColor, selectedSize, supplier_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, product.id, variant.id, 1, product.price, variant.color, variant.size, product.supplier_id || 'dropship']
      );

      console.log(`[Simulation] Mock order items for order #${orderId} inserted.`);

      // Now update status to paid (to trigger fulfillment flow)
      await dbRunAsync(`UPDATE orders SET status = 'paid' WHERE id = ?`, [orderId]);

      console.log(`[Simulation] Executing processPaidOrderFulfillment for order #${orderId}...`);
      // Run the full checkout-to-fulfillment pipeline!
      await processPaidOrderFulfillment(orderId, 'Simulated-PayPal');

      // Fetch the updated order item status to return in response
      const updatedItems = await dbAllAsync(`SELECT * FROM order_items WHERE orderId = ?`, [orderId]);

      return res.json({
        success: true,
        message: 'Fulfillment flow executed end-to-end.',
        orderId,
        items: updatedItems
      });
    } catch (err) {
      console.error('[Simulation] Failed:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  return router;
};
