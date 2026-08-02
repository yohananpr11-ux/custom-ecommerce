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

    // Printify IL shipping cost absorbed per order.
    // We charge ₪29.90 shipping; Printify charges ~$14 to ship to Israel.
    // The gap is the net shipping cost we absorb, in ILS.
    this.printifyShippingCostUSD = 14; // Printify → Israel per order

    // Smart Pricing constants (2026-06-08):
    // Formula: R = (maxVariantCostILS + shippingGapILS) / (1 - netMargin - paymentFee)
    // Applied per-product using the MAX variant cost so every size/color is profitable.
    this.printifyNetMarginTarget = 0.30;

    // Shipping cost displayed separately at checkout
    this.shippingCostNIS = 29.90;
    this.freeShippingThresholdNIS = 249; // cart subtotal >= 249 ILS = free shipping
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
   * Universal Smart Pricing formula — works for any supplier:
   *
   *   shippingGap = max(supplierShipping - ourShippingCharge, 0)
   *     • Positive gap: we absorb a shipping deficit (e.g. Printify IL = $14 > ₪29.9/$7.97 we charge)
   *     • Zero gap: supplier ships cheaper than we charge (e.g. CJ jewelry) — no deficit to absorb
   *
   *   formulaPrice = (maxVariantCostILS + shippingGapILS) / (1 - netMargin - paymentFee)
   *
   *   finalPrice = max(formulaPrice, minRetailPriceILS || 0)
   *     • minRetailPriceILS: market-positioning floor set per product in seed/admin
   *       For jewelry/accessories this prevents formula from pricing below market value
   *       For apparel (minRetailPriceILS = NULL) formula is the price
   *
   * @param {number} baseCostUSD      MAX enabled variant cost in USD (not min)
   * @param {number} supplierShipUSD  What the supplier charges us to ship per order to Israel
   * @param {string} title            Product title (for logging)
   * @param {number} minRetailILS     Market floor in ILS (null = no floor, formula wins)
   */
  calculateOptimalPriceNIS(baseCostUSD, supplierShipUSD = 0, title = '', minRetailILS = null) {
    const costILS = baseCostUSD * this.exchangeRateUSDILS;
    const shippingGapILS = Math.max(supplierShipUSD * this.exchangeRateUSDILS - this.shippingCostNIS, 0);
    const formulaPrice = (costILS + shippingGapILS) / (1 - this.printifyNetMarginTarget - this.paymentFeeRate);
    const rawPrice = Math.ceil(formulaPrice / 10) * 10 - 0.10;
    const finalPrice = minRetailILS != null ? Math.max(rawPrice, minRetailILS) : rawPrice;
    console.log(`💰 [SMART PRICING] "${(title||'').substring(0,30)}" | MaxCost:$${baseCostUSD.toFixed(2)} ShipGap:₪${shippingGapILS.toFixed(1)} Formula:₪${rawPrice.toFixed(2)} Floor:₪${minRetailILS||0} → ₪${finalPrice.toFixed(2)}`);
    return finalPrice;
  }

  async getMaxVariantCostUSD(productId) {
    const row = await dbGetAsync(
      `SELECT MAX(cost) AS maxCost FROM product_variants WHERE productId = ? AND isEnabled = 1`,
      [productId]
    );
    const maxCost = row && row.maxCost != null ? Number(row.maxCost) : 0;
    return maxCost > 0 ? maxCost : 0;
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

    // Universal: all products regardless of supplier
    const products = await dbAllAsync('SELECT id, title, price, supplierShippingCostUSD, minRetailPriceILS FROM products', []);
    const plannedUpdates = [];

    for (const product of products) {
      const maxCostUSD = await this.getMaxVariantCostUSD(product.id);
      if (maxCostUSD <= 0) continue;
      const supplierShipUSD = Number(product.supplierShippingCostUSD || 0);
      const minRetailILS = product.minRetailPriceILS != null ? Number(product.minRetailPriceILS) : null;
      const targetPrice = this.calculateOptimalPriceNIS(maxCostUSD, supplierShipUSD, product.title, minRetailILS);

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
