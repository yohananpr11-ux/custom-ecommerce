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
    this.autoExtremeThresholdPct = this.normalizeExtremeThreshold(process.env.AUTO_PRICE_UPDATE_THRESHOLD_PCT); // default 8%

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

  normalizeExtremeThreshold(rawValue) {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || parsed <= 0) return 0.08;

    // Support both formats:
    // 8 / 10 => 0.08 / 0.10
    // 0.08 / 0.10 => unchanged
    if (parsed >= 1) {
      return parsed / 100;
    }
    return parsed;
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
      `📊 <b>Quarterly Pricing Review Reminder</b>\n\n` +
      `It is recommended to run a manual pricing review based on FX rate, production costs, and margin targets.\n` +
      `Current USD/ILS rate: ₪${this.exchangeRateUSDILS.toFixed(4)} per USD.`
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

    const changePct = Math.abs((this.exchangeRateUSDILS - previousAppliedRate) / previousAppliedRate) * 100;

    const products = await dbAllAsync('SELECT * FROM products', []);
    const plannedUpdates = [];

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

      const currentPrice = Number(product.price || 0);
      if (Math.abs(currentPrice - targetPrice) > 0.01) {
        plannedUpdates.push({
          productId: product.id,
          title: product.title,
          fromPrice: currentPrice,
          toPrice: targetPrice,
        });
      }
    }

    if (plannedUpdates.length > 0) {
      await telegram.sendMessage(
        `⚠️ <b>Pre-Alert: Automatic pricing update will run</b>\n\n` +
        `Reason: ${reason}\n` +
        `FX change: ${changePct.toFixed(2)}%\n` +
        `Previous rate: ₪${previousAppliedRate.toFixed(4)}\n` +
        `New rate: ₪${this.exchangeRateUSDILS.toFixed(4)}\n` +
        `Configured threshold: ${(this.autoExtremeThresholdPct * 100).toFixed(2)}%\n` +
        `Products expected to update: ${plannedUpdates.length}`
      );
    }

    let updatedCount = 0;

    for (const planned of plannedUpdates) {
      await dbRunAsync('UPDATE products SET price = ? WHERE id = ?', [planned.toPrice, planned.productId]);
      updatedCount += 1;
      console.log(`Updated price for ${planned.title}: ₪${planned.fromPrice.toFixed(2)} -> ₪${planned.toPrice.toFixed(2)}`);
    }

    await this.setState('lastAppliedExchangeRate', this.exchangeRateUSDILS);

    await telegram.sendMessage(
      `📈 <b>Automatic Pricing Update Summary</b>\n\n` +
      `Reason: ${reason}\n` +
      `FX change: ${changePct.toFixed(2)}%\n` +
      `Previous rate: ₪${previousAppliedRate.toFixed(4)}\n` +
      `New rate: ₪${this.exchangeRateUSDILS.toFixed(4)}\n` +
      `Update threshold: ${(this.autoExtremeThresholdPct * 100).toFixed(2)}%\n` +
      `Planned updates: ${plannedUpdates.length}\n` +
      `Applied updates: ${updatedCount}`
    );

    if (updatedCount === 0) {
      console.log('ℹ️ Extreme threshold passed, but no product price needed an update.');
    }
  }
}

module.exports = new PricingEngine();
