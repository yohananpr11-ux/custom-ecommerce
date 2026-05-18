const cron = require('node-cron');
const db = require('../db');
const telegram = require('./telegram');
const axios = require('axios');

const dbGetAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.get(query, params, (err, row) => {
    if (err) return reject(err);
    resolve(row);
  });
});

const dbAllAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.all(query, params, (err, rows) => {
    if (err) return reject(err);
    resolve(rows || []);
  });
});

const dbRunAsync = (query, params = []) => new Promise((resolve, reject) => {
  db.run(query, params, function onRun(err) {
    if (err) return reject(err);
    resolve(this);
  });
});

class PricingEngine {
  constructor() {
    this.paymentFeeRate = parseFloat(process.env.PAYMENT_FEE_RATE || 0.03); // ~3% payment processing
    this.exchangeRateUSDILS = 3.75; // Fallback
    this.autoExtremeThresholdPct = parseFloat(process.env.AUTO_PRICE_UPDATE_THRESHOLD_PCT || 0.08); // 8%

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

  async ensurePricingStateTable() {
    await dbRunAsync(`
      CREATE TABLE IF NOT EXISTS pricing_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  async getState(key) {
    const row = await dbGetAsync(`SELECT value FROM pricing_state WHERE key = ?`, [key]);
    return row ? row.value : null;
  }

  async setState(key, value) {
    await dbRunAsync(
      `INSERT INTO pricing_state (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = CURRENT_TIMESTAMP`,
      [key, String(value)]
    );
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

  isExtremeRateChange(previousRate, nextRate) {
    if (!previousRate || previousRate <= 0) return false;
    const changePct = Math.abs((nextRate - previousRate) / previousRate);
    return changePct >= this.autoExtremeThresholdPct;
  }

  async getTankTopBaseCostUSD(productId) {
    const row = await dbGetAsync(
      `SELECT MIN(cost) AS minCost FROM product_variants WHERE productId = ? AND isEnabled = 1`,
      [productId]
    );
    const minCost = row && row.minCost != null ? Number(row.minCost) : 0;
    return minCost > 0 ? minCost : 0;
  }

  async sendQuarterlyReviewReminder() {
    const today = new Date().toISOString().slice(0, 10);
    const lastReminderDate = await this.getState('lastQuarterlyReviewReminderDate');
    if (lastReminderDate === today) return;

    await telegram.sendMessage(
      `📊 <b>תזכורת בדיקת מחירון רבעונית</b>\n\n` +
      `מומלץ לבצע בדיקה ידנית למחירון האתר לפי מצב הדולר, עלויות ייצור ושולי רווח.\n` +
      `שער נוכחי: ₪${this.exchangeRateUSDILS.toFixed(4)} לדולר.`
    );
    await this.setState('lastQuarterlyReviewReminderDate', today);
  }

  start() {
    // Initialize state and run startup checks
    this.ensurePricingStateTable()
      .then(() => this.fetchExchangeRate())
      .then(() => this.runPricingUpdate({ force: false, reason: 'startup' }))
      .catch((err) => console.error('Pricing engine startup failed:', err));

    // Run every day at midnight
    cron.schedule('0 0 * * *', async () => {
      console.log('💰 Starting Daily Pricing & Exchange Rate Sync...');
      await this.runPricingUpdate({ force: false, reason: 'daily' });
    });

    // Quarterly reminder for manual structured price review
    cron.schedule('0 9 1 */3 *', async () => {
      try {
        await this.sendQuarterlyReviewReminder();
      } catch (err) {
        console.error('Failed sending quarterly pricing reminder:', err.message);
      }
    });

    console.log('📈 Pricing Engine initialized (USD base targets scaled dynamically to ILS)');
  }

  async runPricingUpdate({ force = false, reason = 'manual' } = {}) {
    await this.ensurePricingStateTable();

    const previousAppliedRateRaw = await this.getState('lastAppliedExchangeRate');
    const previousAppliedRate = previousAppliedRateRaw ? Number(previousAppliedRateRaw) : null;

    await this.fetchExchangeRate();

    // First run initializes baseline and waits for extreme movement before auto repricing.
    if (!previousAppliedRate) {
      await this.setState('lastAppliedExchangeRate', this.exchangeRateUSDILS);
      console.log(`📌 Baseline exchange rate initialized at ${this.exchangeRateUSDILS.toFixed(4)} (${reason}).`);
      return;
    }

    const extremeChange = this.isExtremeRateChange(previousAppliedRate, this.exchangeRateUSDILS);
    if (!force && !extremeChange) {
      const changePct = Math.abs((this.exchangeRateUSDILS - previousAppliedRate) / previousAppliedRate) * 100;
      console.log(
        `⏸️ Exchange-rate change ${changePct.toFixed(2)}% is below threshold ${(this.autoExtremeThresholdPct * 100).toFixed(2)}%. Skipping auto repricing.`
      );
      return;
    }

    const products = await dbAllAsync('SELECT * FROM products', []);
    let updatedCount = 0;

    for (const product of products) {
      const category = this.getProductCategory(product.title || '');
      let targetPrice = null;

      if (category === 'tank') {
        const tankCostUSD = await this.getTankTopBaseCostUSD(product.id);
        if (tankCostUSD > 0) {
          targetPrice = this.calculateOptimalPriceNIS(tankCostUSD, 0, product.title, product.type);
        }
      } else {
        targetPrice = this.getTargetPrice(product.title, product.type);
      }

      if (typeof targetPrice !== 'number' || Number.isNaN(targetPrice)) {
        continue;
      }

      if (Math.abs(Number(product.price || 0) - targetPrice) > 0.01) {
        await dbRunAsync('UPDATE products SET price = ? WHERE id = ?', [targetPrice, product.id]);
        updatedCount += 1;
        console.log(`Updated price for ${product.title}: ₪${Number(product.price || 0).toFixed(2)} -> ₪${targetPrice.toFixed(2)}`);
      }
    }

    await this.setState('lastAppliedExchangeRate', this.exchangeRateUSDILS);

    if (updatedCount > 0) {
      await telegram.sendMessage(
        `📈 <b>עדכון מחירים אוטומטי (שינוי קיצון בשער)</b>\n\n` +
        `שער קודם: ₪${previousAppliedRate.toFixed(4)}\n` +
        `שער חדש: ₪${this.exchangeRateUSDILS.toFixed(4)}\n` +
        `סף עדכון: ${(this.autoExtremeThresholdPct * 100).toFixed(2)}%\n` +
        `עודכנו ${updatedCount} מוצרים.`
      );
    }

    if (updatedCount === 0) {
      console.log('ℹ️ Extreme threshold passed, but no product price needed an update.');
    }
  }
}

module.exports = new PricingEngine();
