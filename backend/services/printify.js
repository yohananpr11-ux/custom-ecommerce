const axios = require('axios');
const telegram = require('./telegram');

class PrintifyService {
  constructor() {
    this.token = process.env.PRINTIFY_API_TOKEN;
    this.shopId = process.env.PRINTIFY_SHOP_ID;
    this.baseUrl = 'https://api.printify.com/v1';
  }

  async syncProducts() {
    if (!this.token || this.token === 'YOUR_PRINTIFY_TOKEN') {
      console.warn(`⚠️ Printify token missing. Simulating 50 product sync.`);
      // Insert mock products to DB to simulate
      const db = require('../db');
      for(let i=1; i<=10; i++) {
        db.run(`INSERT INTO products (title, description, price, imageUrl, stock, type) VALUES (?, ?, ?, ?, ?, ?)`,
          [`Premium Street Hoodie v${i}`, `Exclusive Printify collection. Sync mock.`, 300, `https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=400&q=80`, 999, 'printify']);
      }
      return 10; // Mocked 10 products
    }

    try {
      const response = await axios.get(`${this.baseUrl}/shops/${this.shopId}/products.json?limit=50`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      const products = response.data.data;
      const db = require('../db');

      products.forEach(p => {
        const title = p.title;
        const description = p.description;
        const imageUrl = p.images && p.images.length > 0 ? p.images[0].src : '';
        const price = 250; // We'll let pricing engine fix this later
        
        db.run(`INSERT INTO products (title, description, price, imageUrl, stock, type) VALUES (?, ?, ?, ?, ?, ?)`,
          [title, description, price, imageUrl, 999, 'printify']);
      });

      console.log(`✅ Synced ${products.length} products from Printify.`);
      return products.length;
    } catch (error) {
      console.error('❌ Printify sync failed:', error.message);
      throw error;
    }
  }

  async sendOrderToProduction(orderId, customerName, customerEmail, address, items) {
    if (!this.token || this.token === 'YOUR_PRINTIFY_TOKEN') {
      console.warn(`⚠️ Printify token missing. Simulating sending order #${orderId} to Printify.`);
      return { id: `mock_printify_${orderId}`, status: 'simulated' };
    }

    try {
      // Structure the Printify order payload
      const printifyItems = items.map(item => ({
        product_id: item.printifyProductId, // Assuming we store this in our DB later
        variant_id: item.printifyVariantId,
        quantity: item.quantity
      }));

      // A simple parse of the address string (In reality, we'd capture structured address fields in the frontend)
      const addressParts = address.split(',');
      const city = addressParts.length > 1 ? addressParts[1].trim() : 'Tel Aviv';
      const address1 = addressParts[0].trim();

      const payload = {
        external_id: orderId.toString(),
        label: `Order ${orderId}`,
        line_items: printifyItems,
        shipping_method: 1, // Standard
        send_shipping_notification: false,
        address_to: {
          first_name: customerName.split(' ')[0],
          last_name: customerName.split(' ').slice(1).join(' ') || 'Customer',
          email: customerEmail,
          phone: '',
          country: 'IL',
          region: '',
          address1: address1,
          address2: '',
          city: city,
          zip: '0000000'
        }
      };

      const response = await axios.post(`${this.baseUrl}/shops/${this.shopId}/orders.json`, payload, {
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      console.log(`✅ Order sent to Printify successfully: ${response.data.id}`);
      
      // Send the order to production immediately
      await axios.post(`${this.baseUrl}/shops/${this.shopId}/orders/${response.data.id}/send_to_production.json`, {}, {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      });

      return response.data;

    } catch (error) {
      console.error('❌ Failed to send order to Printify:', error.response ? error.response.data : error.message);
      await telegram.notifyError(`Printify Order Submission (Order #${orderId})`, error.message);
      throw error;
    }
  }
}

module.exports = new PrintifyService();
