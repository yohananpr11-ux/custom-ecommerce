const cron = require('node-cron');
const db = require('../db');
const telegram = require('./telegram');
const axios = require('axios');

class PricingEngine {
  constructor() {
    this.paymentFeeRate = parseFloat(process.env.PAYMENT_FEE_RATE || 0.03); // ~3% payment processing
    this.exchangeRateUSDILS = 3.75; // Fallback

    // Exact target retail prices in ILS (business-critical)
    this.targetPricesILS = {
      'softstyle':   89.90,   // Gildan 64000 basic tee
      'jersey':      119.90,  // Bella+Canvas 3001 premium tee
      'hoodie':      159.90,  // Gildan 18500 hooded sweatshirt
      'tank':        null,    // Tank tops: dynamic pricing based on cost (no fixed target)
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
    if (lower.includes('tank') || lower.includes('tank top')) return 'tank';
    if (lower.includes('tee') || lower.includes('t-shirt') || lower.includes('shirt')) return 'softstyle'; // fallback tee
    return 'softstyle'; // ultimate fallback
  }

  /**
   * Get the fixed target price for a product in ILS (enforces exact business-critical prices)
   */
  getTargetPrice(title, type) {
    const category = this.getProductCategory(title);
    // Tank tops have no fixed price - return null to indicate dynamic pricing
    if (category === 'tank') return null;
    return this.targetPricesILS[category] || 89.90;
  }

  /**
   * Calculate optimal price - fixed targets for tees/hoodies, dynamic for tanks
   */
  calculateOptimalPriceNIS(baseCostUSD, shippingCostUSD = 0, title = '', type = 'printify') {
    if (title) {
      const category = this.getProductCategory(title);
      
      // Tank tops: dynamic pricing based on manufacturing cost
      if (category === 'tank') {
        const costInILS = baseCostUSD * this.exchangeRateUSDILS;
        const profitMarginMultiplier = 2.5;
        const targetPrice = costInILS * profitMarginMultiplier;
        const finalPrice = Math.floor(targetPrice / 10) * 10 + 9.90;
        console.log(`🔧 [TANK PRICING] Title: "${title}" | BaseCost: $${baseCostUSD} | CostILS: ₪${costInILS.toFixed(2)} | Target: ₪${targetPrice.toFixed(2)} | Final: ₪${finalPrice.toFixed(2)}`);
        return finalPrice;
      }
      
      // Fixed prices for tees and hoodies
      const fixedPrice = this.targetPricesILS[category] || 89.90;
      return fixedPrice;
      return fixedPrice;
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
      const res = await axios.get('https://open.er-api.com/v6/latest/USD');
      if (res.data && res.data.rates && res.data.rates.ILS) {
        this.exchangeRateUSDILS = parseFloat(res.data.rates.ILS);
        console.log(`💱 Live USD/ILS Exchange Rate fetched: ${this.exchangeRateUSDILS}`);
      }
    } catch (e) {
      console.warn("Failed to fetch live exchange rate, using fallback 3.75:", e.message);
      this.exchangeRateUSDILS = 3.75;
    }
  }

  start() {
    // Run exchange rate fetch immediately on start
    this.fetchExchangeRate().then(() => this.runPricingUpdate());

    // Run every day at midnight
    cron.schedule('0 0 * * *', async () => {
      console.log('💰 Starting Daily Pricing & Exchange Rate Sync...');
      await this.runPricingUpdate();
    });
    console.log('📈 Pricing Engine initialized (USD base targets scaled dynamically to ILS)');
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
        telegram.sendMessage(`📈 <b>עדכון מחירים אוטומטי</b>\n\nשער הדולר הנוכחי: ₪${this.exchangeRateUSDILS.toFixed(4)}\nעודכנו ${updatedCount} מוצרים למחירי היעד המעודכנים לפי שער הדולר.`);
      }
    });
  }
}

module.exports = new PricingEngine();
