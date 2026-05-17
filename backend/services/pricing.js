const cron = require('node-cron');
const db = require('../db');
const telegram = require('./telegram');

class PricingEngine {
  constructor() {
    // Osek Patur - 0% VAT, payment fee already baked into target prices
    this.paymentFeeRate = parseFloat(process.env.PAYMENT_FEE_RATE || 0.03); // ~3% payment processing
    this.exchangeRateUSDILS = 3.75; // Fallback

    // Fixed target retail prices (ILS) - set by business strategy
    this.targetPrices = {
      'softstyle':   89.90,   // Gildan 64000 basic tee
      'jersey':      119.90,  // Bella+Canvas 3001 premium tee
      'hoodie':      159.90,  // Gildan 18500 hooded sweatshirt
      'local_tee':   89.90,   // Local Drop Shoulder tees
      'local_hoodie': 159.90, // Local hoodies
    };

    // Shipping cost displayed separately at checkout
    this.shippingCostNIS = 29.90;
    this.freeShippingThreshold = 5; // 5+ items = free shipping
  }

  /**
   * Determine the target price category for a product based on its title
   */
  getProductCategory(title) {
    const lower = title.toLowerCase();
    if (lower.includes('softstyle') || lower.includes('gildan 64000') || lower.includes('64000')) return 'softstyle';
    if (lower.includes('jersey') || lower.includes('bella') || lower.includes('canvas') || lower.includes('3001')) return 'jersey';
    if (lower.includes('hoodie') || lower.includes('hooded') || lower.includes('sweatshirt') || lower.includes('18500')) return 'hoodie';
    if (lower.includes('tee') || lower.includes('t-shirt') || lower.includes('shirt')) return 'softstyle'; // fallback tee
    return 'softstyle'; // ultimate fallback
  }

  /**
   * Get the fixed target price for a product
   */
  getTargetPrice(title, type) {
    if (type === 'local') {
      const lower = title.toLowerCase();
      if (lower.includes('hoodie')) return this.targetPrices.local_hoodie;
      return this.targetPrices.local_tee;
    }
    const category = this.getProductCategory(title);
    return this.targetPrices[category];
  }

  /**
   * Calculate optimal price - now uses fixed target prices instead of cost-based formula
   */
  calculateOptimalPriceNIS(baseCostUSD, shippingCostUSD = 0, title = '', type = 'printify') {
    // If we have a title, use fixed target pricing
    if (title) {
      return this.getTargetPrice(title, type);
    }
    // Fallback: cost-based calculation for unknown products
    const totalCostUSD = baseCostUSD + shippingCostUSD;
    const totalCostNIS = totalCostUSD * this.exchangeRateUSDILS;
    const marginDivisor = 1 - this.paymentFeeRate - 0.15; // 15% profit after payment fees
    let optimalPrice = totalCostNIS / marginDivisor;
    optimalPrice = Math.ceil(optimalPrice / 10) * 10 - 0.10;
    return optimalPrice;
  }

  async fetchExchangeRate() {
    try {
      this.exchangeRateUSDILS = 3.76;
      console.log(`💱 Updated USD/ILS Exchange Rate: ${this.exchangeRateUSDILS}`);
    } catch (e) {
      console.warn("Failed to fetch exchange rate, using fallback.");
    }
  }

  start() {
    // Run every day at midnight
    cron.schedule('0 0 * * *', async () => {
      console.log('💰 Starting Pricing Sync...');
      await this.runPricingUpdate();
    });
    console.log('📈 Pricing Engine initialized (Fixed target prices: Tee ₪89.90 / Premium ₪119.90 / Hoodie ₪159.90)');
  }

  async runPricingUpdate() {
    await this.fetchExchangeRate();

    db.all("SELECT * FROM products", [], (err, products) => {
      if (err) {
        console.error('Pricing update failed reading DB:', err);
        return;
      }

      let updatedCount = 0;

      products.forEach(product => {
        const targetPrice = this.getTargetPrice(product.title, product.type);

        if (Math.abs(product.price - targetPrice) > 0.01) {
          db.run(`UPDATE products SET price = ? WHERE id = ?`, [targetPrice, product.id]);
          updatedCount++;
          console.log(`Updated price for ${product.title}: ₪${product.price} -> ₪${targetPrice.toFixed(2)}`);
        }
      });

      if (updatedCount > 0) {
        telegram.sendMessage(`📈 <b>עדכון מחירים</b>\n\n${updatedCount} מוצרים עודכנו למחירי היעד החדשים.`);
      }
    });
  }
}

module.exports = new PricingEngine();
