const cron = require('node-cron');
const db = require('../db');
const telegram = require('./telegram');
const axios = require('axios');

class PricingEngine {
  constructor() {
    this.paymentFeeRate = parseFloat(process.env.PAYMENT_FEE_RATE || 0.03); // ~3% payment processing
    this.exchangeRateUSDILS = 3.75; // Fallback

    // Fixed base target retail prices (USD) - set by business strategy to secure USD margins
    this.targetPricesUSD = {
      'softstyle':   23.97,   // Gildan 64000 basic tee (~$24)
      'jersey':      31.97,   // Bella+Canvas 3001 premium tee (~$32)
      'hoodie':      42.64,   // Gildan 18500 hooded sweatshirt (~$42.6)
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
   * Get the fixed target price for a product in ILS (scaled by exchange rate)
   */
  getTargetPrice(title, type) {
    const category = this.getProductCategory(title);
    const usdPrice = this.targetPricesUSD[category] || 23.97;
    const rawILS = usdPrice * this.exchangeRateUSDILS;
    
    // Round to nearest 10 and subtract 0.10 for nice commercial finish (e.g. 89.90, 119.90, 159.90)
    const base = Math.round(rawILS / 10) * 10;
    return base - 0.10;
  }

  /**
   * Calculate optimal price - uses fixed target prices instead of cost-based formula
   */
  calculateOptimalPriceNIS(baseCostUSD, shippingCostUSD = 0, title = '', type = 'printify') {
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
