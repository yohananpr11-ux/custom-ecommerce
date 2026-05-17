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
      console.warn(`⚠️ Printify token missing. Simulating 10 product sync.`);
      const db = require('../db');
      for(let i=1; i<=10; i++) {
        db.run(`INSERT INTO products (title, description, price, imageUrl, stock, type) VALUES (?, ?, ?, ?, ?, ?)`,
          [`Premium Street Hoodie v${i}`, `Exclusive Printify collection. Sync mock.`, 300, `https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=400&q=80`, 999, 'printify']);
      }
      return 10;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/shops/${this.shopId}/products.json?limit=50`, {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      const products = response.data.data;
      const db = require('../db');
      let syncedCount = 0;

      for (const p of products) {
        const title = p.title;
        const description = p.description ? p.description.replace(/<[^>]*>/g, '').substring(0, 500) : '';
        
        // ---- IMAGES: Extract front, back, and all mockups ----
        let frontImageUrl = '';
        let backImageUrl = '';
        const allImages = [];

        if (p.images && p.images.length > 0) {
          // Front image: prefer default front
          const frontImg = p.images.find(img => img.position === 'front' && img.is_default);
          frontImageUrl = frontImg ? frontImg.src : '';
          
          // Back image: prefer default back
          const backImg = p.images.find(img => img.position === 'back' && img.is_default);
          backImageUrl = backImg ? backImg.src : '';

          // If no explicit front/back, use first two images
          if (!frontImageUrl && p.images[0]) frontImageUrl = p.images[0].src;
          if (!backImageUrl && p.images[1]) backImageUrl = p.images[1].src;

          // Collect all unique image URLs for the gallery
          const seen = new Set();
          p.images.forEach(img => {
            if (img.src && !seen.has(img.src)) {
              seen.add(img.src);
              allImages.push({ src: img.src, position: img.position || 'other' });
            }
          });
        }

        // ---- VARIANTS: Extract color, size, price, availability ----
        const enabledVariants = p.variants ? p.variants.filter(v => v.is_enabled) : [];
        let baseCostCents = 0;
        if (enabledVariants.length > 0) {
          baseCostCents = Math.min(...enabledVariants.map(v => v.cost || v.price || 0));
        }

        // Use pricing engine for fixed target prices
        const pricingEngine = require('./pricing');
        const baseCostUSD = baseCostCents / 100;
        const retailPrice = pricingEngine.calculateOptimalPriceNIS(baseCostUSD, 4.5, title, 'printify');

        // Detect fabric info from product tags or blueprint
        const fabric = this._detectFabric(title, description);
        const careInstructions = 'Machine wash cold inside out. Tumble dry low. Do not iron directly on print.';
        const deliveryInfo = 'Print-on-demand: 3-5 business days production + 7-14 days international shipping.';

        // ---- UPSERT PRODUCT ----
        const productId = await new Promise((resolve, reject) => {
          db.get(`SELECT id FROM products WHERE title = ? AND type = 'printify'`, [title], (err, existing) => {
            if (err) return reject(err);
            if (existing) {
              db.run(`UPDATE products SET price = ?, imageUrl = ?, backImageUrl = ?, images = ?, description = ?, printifyId = ?, fabric = ?, careInstructions = ?, deliveryInfo = ? WHERE id = ?`,
                [retailPrice, frontImageUrl, backImageUrl, JSON.stringify(allImages), description, p.id, fabric, careInstructions, deliveryInfo, existing.id],
                () => resolve(existing.id));
            } else {
              db.run(`INSERT INTO products (title, description, price, imageUrl, backImageUrl, images, stock, type, printifyId, fabric, careInstructions, deliveryInfo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [title, description, retailPrice, frontImageUrl, backImageUrl, JSON.stringify(allImages), 999, 'printify', p.id, fabric, careInstructions, deliveryInfo],
                function() { resolve(this.lastID); });
            }
          });
        });

        // ---- SYNC VARIANTS ----
        // Clear old variants for this product
        await new Promise(r => db.run(`DELETE FROM product_variants WHERE productId = ?`, [productId], r));

        // Extract unique colors from variant options
        const colorMap = {};
        if (p.options) {
          const colorOption = p.options.find(o => o.type === 'color' || o.name.toLowerCase().includes('color'));
          if (colorOption && colorOption.values) {
            colorOption.values.forEach(v => {
              colorMap[v.id] = { title: v.title, colors: v.colors || [] };
            });
          }
        }

        // Insert each enabled variant
        for (const variant of enabledVariants) {
          const variantTitle = variant.title || '';
          // Parse "Size / Color" format from variant title
          const parts = variantTitle.split('/').map(s => s.trim());
          let size = parts[0] || '';
          let color = parts.length > 1 ? parts[1] : parts[0] || '';
          let colorHex = '#000000';

          // Try to match color from option values
          if (variant.options && variant.options.length > 0) {
            for (const optId of variant.options) {
              if (colorMap[optId]) {
                color = colorMap[optId].title;
                if (colorMap[optId].colors && colorMap[optId].colors.length > 0) {
                  colorHex = colorMap[optId].colors[0];
                }
              }
            }
          }

          const variantCost = (variant.cost || 0) / 100;
          const variantPrice = retailPrice; // Same price for all variants (size-based)
          const isAvailable = variant.is_available !== false ? 1 : 0;

          db.run(`INSERT INTO product_variants (productId, printifyVariantId, color, colorHex, size, price, cost, isEnabled, isAvailable) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`,
            [productId, variant.id, color, colorHex, size, variantPrice, variantCost, isAvailable]);
        }

        syncedCount++;
      }

      console.log(`✅ Synced ${syncedCount} products with variants from Printify.`);
      await telegram.sendMessage(`🔄 <b>סנכרון Printify הושלם!</b>\n\n${syncedCount} מוצרים סונכרנו בהצלחה עם צבעים, מידות ותמונות.`);
      return syncedCount;
    } catch (error) {
      console.error('❌ Printify sync failed:', error.message);
      throw error;
    }
  }

  _detectFabric(title, description) {
    const lower = (title + ' ' + description).toLowerCase();
    if (lower.includes('softstyle') || lower.includes('64000')) return '100% Ring-Spun Cotton (Heathers: Cotton/Polyester blend). Softstyle® fabric.';
    if (lower.includes('bella') || lower.includes('canvas') || lower.includes('3001')) return '100% Airlume Combed & Ring-Spun Cotton, 4.2 oz. Side-seamed. Retail fit.';
    if (lower.includes('heavy blend') || lower.includes('18500') || lower.includes('hoodie')) return '50% Cotton / 50% Polyester, 8.0 oz Heavy Blend™ Fleece. Double-lined hood.';
    return 'Premium quality fabric. See product description for details.';
  }

  async sendOrderToProduction(orderId, customerName, customerEmail, address, items) {
    if (!this.token || this.token === 'YOUR_PRINTIFY_TOKEN') {
      console.warn(`⚠️ Printify token missing. Simulating sending order #${orderId} to Printify.`);
      return { id: `mock_printify_${orderId}`, status: 'simulated' };
    }

    try {
      const printifyItems = items.map(item => ({
        product_id: item.printifyProductId,
        variant_id: item.printifyVariantId,
        quantity: item.quantity
      }));

      const addressParts = address.split(',');
      const city = addressParts.length > 1 ? addressParts[1].trim() : 'Tel Aviv';
      const address1 = addressParts[0].trim();

      const payload = {
        external_id: orderId.toString(),
        label: `Order ${orderId}`,
        line_items: printifyItems,
        shipping_method: 1,
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
      
      await axios.post(`${this.baseUrl}/shops/${this.shopId}/orders/${response.data.id}/send_to_production.json`, {}, {
        headers: { 'Authorization': `Bearer ${this.token}` }
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
