'use strict';

const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const dbPath = path.resolve(__dirname, 'ecommerce.db');
const logFilePath = 'C:\\Users\\yohan\\.gemini\\antigravity\\brain\\54a94844-d4d8-4cd2-bb37-a5e3db12a4e9\\.system_generated\\tasks\\task-2070.log';

console.log('==================================================================');
console.log('⚡ Drip Street - Live End-to-End Checkout Monitor ⚡');
console.log('==================================================================');
console.log(`Database Path: ${dbPath}`);
console.log(`Log File Path: ${logFilePath}`);
console.log('------------------------------------------------------------------');

// Connect to SQLite Database
const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READONLY, (err) => {
  if (err) {
    console.error('❌ Error connecting to database:', err.message);
    process.exit(1);
  }
  console.log('✅ Connected to SQLite database.');
});

// State tracking
let knownOrders = new Set();
let logFileSize = 0;

// Initialize log file size
try {
  if (fs.existsSync(logFilePath)) {
    const stats = fs.statSync(logFilePath);
    logFileSize = stats.size;
    console.log(`✅ Log monitor initialized (current size: ${logFileSize} bytes).`);
  } else {
    console.log('⚠️ Log file not found yet. Waiting for backend to write logs...');
  }
} catch (e) {
  console.warn('⚠️ Log monitor file check failed:', e.message);
}

console.log('------------------------------------------------------------------');
console.log('👀 MONITOR ACTIVE: Standing by for PayPal capture callbacks...');
console.log('==================================================================\n');

// 1. Database Poller
setInterval(() => {
  db.all(
    `SELECT o.id as orderId, o.customerName, o.totalAmount, o.status,
            oi.id as itemId, oi.productId, oi.selectedSize, oi.selectedColor,
            oi.fulfillment_status, oi.fulfillment_ref, oi.supplier_id
     FROM orders o
     JOIN order_items oi ON o.id = oi.orderId
     WHERE oi.productId = 16
     ORDER BY o.createdAt DESC
     LIMIT 5`,
    [],
    (err, rows) => {
      if (err) {
        console.error('❌ DB Poll Error:', err.message);
        return;
      }

      for (const row of rows) {
        const key = `${row.orderId}-${row.itemId}-${row.fulfillment_status}-${row.fulfillment_ref}`;
        if (!knownOrders.has(key)) {
          knownOrders.add(key);

          console.log(`\n──────────────────────────────────────────────────────────────────`);
          console.log(`📦 Order #${row.orderId} (Customer: ${row.customerName})`);
          console.log(`💰 Total Amount: ₪${row.totalAmount} · Status: [${row.status.toUpperCase()}]`);
          console.log(`💎 Item: Product #${row.productId} (${row.selectedColor || 'N/A'} / ${row.selectedSize || 'N/A'})`);
          console.log(`🚚 Supplier: ${row.supplier_id} · Status: [${(row.fulfillment_status || 'PENDING').toUpperCase()}]`);
          console.log(`🔗 Ref: ${row.fulfillment_ref || 'None'}`);
          console.log(`──────────────────────────────────────────────────────────────────`);

          if (row.fulfillment_status === 'submitted') {
            console.log('\n🎉 SUCCESS! EVERYTHING GREEN! Order successfully pushed to CJ Dropshipping.');
            console.log(`👉 CJ Reference ID: ${row.fulfillment_ref}`);
            console.log('==================================================================');
          } else if (row.fulfillment_status === 'failed') {
            console.log('\n❌ FAILED! Order fulfillment failed. See reference for details.');
            console.log(`👉 Error details: ${row.fulfillment_ref}`);
            console.log('==================================================================');
          }
        }
      }
    }
  );
}, 1000);

// 2. Log File Watcher / Poller
setInterval(() => {
  try {
    if (!fs.existsSync(logFilePath)) return;

    const stats = fs.statSync(logFilePath);
    if (stats.size > logFileSize) {
      const stream = fs.createReadStream(logFilePath, {
        start: logFileSize,
        end: stats.size
      });

      stream.on('data', (chunk) => {
        const lines = chunk.toString('utf8').split('\n');
        for (const line of lines) {
          const cleanLine = line.trim();
          if (!cleanLine) continue;

          // Highlight specific events
          if (cleanLine.includes('capture-order') || cleanLine.includes('PayPal') && cleanLine.includes('capture')) {
            console.log(`[PayPal Event] 💳 ${cleanLine}`);
          } else if (cleanLine.includes('fulfillment_status = \'processing\'') || cleanLine.includes('Atomic lock')) {
            console.log(`[Lock Event] 🔒 ${cleanLine}`);
          } else if (cleanLine.includes('dropship') || cleanLine.includes('cjdropshipping')) {
            if (cleanLine.includes('Raw API Response')) {
              console.log(`[CJ API Response] 📥 CJ Payload resolved.`);
            } else if (cleanLine.includes('submitted successfully') || cleanLine.includes('Ref=')) {
              console.log(`[CJ Success] 🎉 ${cleanLine}`);
            } else {
              console.log(`[CJ Dropship] 🚚 ${cleanLine}`);
            }
          } else if (cleanLine.includes('routeOrderToSupplier')) {
            console.log(`[Router Event] 🔀 ${cleanLine}`);
          }
        }
      });

      logFileSize = stats.size;
    }
  } catch (e) {
    // Ignore transient read errors during hot writes
  }
}, 500);
