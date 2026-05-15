const cron = require('node-cron');
const db = require('../db');
const telegram = require('./telegram');

class PricingEngine {
  constructor() {
    this.targetProfitMargin = parseFloat(process.env.TARGET_PROFIT_MARGIN || 0.20); // 20%
    this.estimatedTaxRate = parseFloat(process.env.ESTIMATED_TAX_RATE || 0.17); // 17% VAT
    this.paymentFeeRate = parseFloat(process.env.PAYMENT_FEE_RATE || 0.029); // 2.9%
    this.fixedFee = parseFloat(process.env.FIXED_FEE || 1.20); // 1.20 ILS
    this.amortizedSetupCost = parseFloat(process.env.AMORTIZED_SETUP_COST || 5.00); // 5 ILS
    this.exchangeRateUSDILS = 3.75; // Fallback
  }

  async fetchExchangeRate() {
    try {
      // Free exchange rate API (Mocked logic for real-time fetch)
      // const response = await require('axios').get('https://api.exchangerate-api.com/v4/latest/USD');
      // this.exchangeRateUSDILS = response.data.rates.ILS;
      this.exchangeRateUSDILS = 3.76; // Example fetched rate
      console.log(`💱 Updated USD/ILS Exchange Rate: ${this.exchangeRateUSDILS}`);
    } catch (e) {
      console.warn("Failed to fetch exchange rate, using fallback.");
    }
  }

  start() {
    // Run every day at midnight
    cron.schedule('0 0 * * *', async () => {
      console.log('💰 Starting Dynamic Pricing Optimization...');
      await this.runPricingUpdate();
    });
    console.log('📈 Smart Pricing Engine initialized (Target Net Profit: 15%)');
  }

  calculateOptimalPriceNIS(baseCostUSD, shippingCostUSD = 0) {
    const totalCostUSD = baseCostUSD + shippingCostUSD;
    const totalCostNIS = (totalCostUSD * this.exchangeRateUSDILS) + this.fixedFee + this.amortizedSetupCost;
    
    const marginDivisor = 1 - this.estimatedTaxRate - this.targetProfitMargin - this.paymentFeeRate;
    
    let optimalPrice = totalCostNIS / marginDivisor;
    
    // Round to nearest .90 for psychological pricing (e.g. 139.90)
    optimalPrice = Math.ceil(optimalPrice / 10) * 10 - 0.10;
    
    return optimalPrice;
  }

  async runPricingUpdate() {
    await this.fetchExchangeRate();

    // In a fully integrated system, we would fetch current costs from Printify or a local supplier cost table.
    // For this demonstration, we assume cost = $18 for all shirts and $32 for hoodies.
    db.all("SELECT * FROM products", [], (err, products) => {
      if (err) {
        console.error('Pricing update failed reading DB:', err);
        return;
      }

      let updatedCount = 0;

      products.forEach(product => {
        let estimatedCostUSD = 18; // fallback
        if (product.title.toLowerCase().includes('hoodie')) estimatedCostUSD = 32;
        
        const optimalPrice = this.calculateOptimalPriceNIS(estimatedCostUSD, 4.5); // $4.5 average shipping

        // If current price is lower than the optimal price to maintain 15% profit, update it.
        if (Math.abs(product.price - optimalPrice) > 5) { // 5 ILS threshold to avoid micro-updates
          db.run(`UPDATE products SET price = ? WHERE id = ?`, [optimalPrice, product.id]);
          updatedCount++;
          console.log(`Updated price for ${product.title}: ₪${product.price} -> ₪${optimalPrice.toFixed(2)}`);
        }
      });

      if (updatedCount > 0) {
        telegram.sendMessage(`📈 <b>עדכון מחירים אוטומטי</b>\n\nמנוע התמחור זיהה חריגה ביעדי הרווח ועדכן מחירים עבור ${updatedCount} מוצרים כדי לשמור על 20% רווח נקי (שער דולר: ${this.exchangeRateUSDILS}).`);
      }
    });
  }
}

module.exports = new PricingEngine();
