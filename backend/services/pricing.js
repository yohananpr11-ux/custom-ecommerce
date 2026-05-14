const cron = require('node-cron');
const db = require('../db');
const telegram = require('./telegram');

class PricingEngine {
  constructor() {
    this.targetProfitMargin = parseFloat(process.env.TARGET_PROFIT_MARGIN || 0.15); // 15%
    this.estimatedTaxRate = parseFloat(process.env.ESTIMATED_TAX_RATE || 0.17); // 17% VAT
    this.paymentFeeRate = parseFloat(process.env.PAYMENT_FEE_RATE || 0.029); // 2.9%
    this.fixedFee = parseFloat(process.env.FIXED_FEE || 1.20); // 1.20 ILS
    this.amortizedSetupCost = parseFloat(process.env.AMORTIZED_SETUP_COST || 5.00); // 5 ILS
  }

  start() {
    // Run every day at midnight
    cron.schedule('0 0 * * *', async () => {
      console.log('💰 Starting Dynamic Pricing Optimization...');
      await this.runPricingUpdate();
    });
    console.log('📈 Smart Pricing Engine initialized (Target Net Profit: 15%)');
  }

  calculateOptimalPrice(baseCost, shippingCost = 0) {
    const totalCost = baseCost + shippingCost + this.fixedFee + this.amortizedSetupCost;
    const marginDivisor = 1 - this.estimatedTaxRate - this.targetProfitMargin - this.paymentFeeRate;
    
    let optimalPrice = totalCost / marginDivisor;
    
    // Round to nearest .90 for psychological pricing (e.g. 139.90)
    optimalPrice = Math.ceil(optimalPrice / 10) * 10 - 0.10;
    
    return optimalPrice;
  }

  runPricingUpdate() {
    // In a fully integrated system, we would fetch current costs from Printify or a local supplier cost table.
    // For this demonstration, we assume cost = 70 ILS for all shirts and 120 ILS for hoodies.
    db.all("SELECT * FROM products", [], (err, products) => {
      if (err) {
        console.error('Pricing update failed reading DB:', err);
        return;
      }

      let updatedCount = 0;

      products.forEach(product => {
        let estimatedCost = 70; // fallback
        if (product.title.toLowerCase().includes('hoodie')) estimatedCost = 120;
        
        const optimalPrice = this.calculateOptimalPrice(estimatedCost, 15); // 15 ILS average shipping

        // If current price is lower than the optimal price to maintain 15% profit, update it.
        if (Math.abs(product.price - optimalPrice) > 5) { // 5 ILS threshold to avoid micro-updates
          db.run(`UPDATE products SET price = ? WHERE id = ?`, [optimalPrice, product.id]);
          updatedCount++;
          console.log(`Updated price for ${product.title}: ₪${product.price} -> ₪${optimalPrice.toFixed(2)}`);
        }
      });

      if (updatedCount > 0) {
        telegram.sendMessage(`📈 <b>עדכון מחירים אוטומטי</b>\n\nמנוע התמחור זיהה חריגה ביעדי הרווח ועדכן מחירים עבור ${updatedCount} מוצרים כדי לשמור על 15% רווח נקי.`);
      }
    });
  }
}

module.exports = new PricingEngine();
