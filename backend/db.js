const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'ecommerce.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
    db.configure('busyTimeout', 5000);
    db.run('PRAGMA journal_mode = WAL', (pragmaErr) => {
      if (pragmaErr) {
        console.error('Error setting journal_mode to WAL:', pragmaErr.message);
      } else {
        console.log('SQLite WAL mode enabled.');
      }
    });
    db.run('PRAGMA synchronous = NORMAL', (syncErr) => {
      if (syncErr) {
        console.error('Error setting synchronous to NORMAL:', syncErr.message);
      } else {
        console.log('SQLite synchronous mode set to NORMAL.');
      }
    });
  }
});

// Initialize tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      imageUrl TEXT,
      backImageUrl TEXT,
      images TEXT,
      stock INTEGER DEFAULT 0,
      type TEXT DEFAULT 'local',
      printifyId TEXT,
      fabric TEXT,
      careInstructions TEXT,
      deliveryInfo TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_variants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER NOT NULL,
      printifyVariantId TEXT,
      color TEXT,
      colorHex TEXT,
      size TEXT,
      price REAL,
      cost REAL,
      stockQty INTEGER,
      isEnabled INTEGER DEFAULT 1,
      isAvailable INTEGER DEFAULT 1,
      FOREIGN KEY (productId) REFERENCES products(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customerName TEXT NOT NULL,
      customerEmail TEXT NOT NULL,
      address TEXT NOT NULL,
      totalAmount REAL NOT NULL,
      shippingCost REAL DEFAULT 0,
      promoCode TEXT,
      promoDiscount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending',
      locale TEXT DEFAULT 'he',
      currency TEXT DEFAULT 'ILS',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      promo_code TEXT NOT NULL UNIQUE,
      is_used INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER,
      productId INTEGER,
      variantId INTEGER,
      quantity INTEGER,
      price REAL,
      selectedColor TEXT,
      selectedSize TEXT,
      FOREIGN KEY (orderId) REFERENCES orders(id),
      FOREIGN KEY (productId) REFERENCES products(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      customerName TEXT,
      status TEXT DEFAULT 'bot',
      history TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS processed_webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider TEXT NOT NULL,
      eventId TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(provider, eventId)
    )
  `);

});

// Helper to safely add column if not exists — returns a Promise
const addColumnIfMissing = (tableName, columnName, columnDefinition) => new Promise((resolve) => {
  db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
    if (err) {
      console.error(`Error fetching table info for ${tableName}:`, err.message);
      return resolve();
    }
    const hasColumn = columns && columns.some(c => c.name === columnName);
    if (hasColumn) return resolve();

    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`, (alterErr) => {
      if (alterErr && !/duplicate column name/i.test(alterErr.message)) {
        console.error(`Error adding column ${columnName} to ${tableName}:`, alterErr.message);
      } else {
        console.log(`Successfully added column ${columnName} to ${tableName}`);
      }
      resolve();
    });
  });
});

// Run all column migrations, then create indexes (which depend on the new columns)
(async () => {
  await Promise.all([
    // products
    addColumnIfMissing('products', 'backImageUrl', 'TEXT'),
    addColumnIfMissing('products', 'images', 'TEXT'),
    addColumnIfMissing('products', 'printifyId', 'TEXT'),
    addColumnIfMissing('products', 'fabric', 'TEXT'),
    addColumnIfMissing('products', 'careInstructions', 'TEXT'),
    addColumnIfMissing('products', 'deliveryInfo', 'TEXT'),
    // orders
    addColumnIfMissing('orders', 'promoCode', 'TEXT'),
    addColumnIfMissing('orders', 'promoDiscount', 'REAL DEFAULT 0'),
    addColumnIfMissing('orders', 'emailSent', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('orders', 'emailAttempts', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('orders', 'lastEmailAttemptAt', 'TEXT'),
    // product_variants
    addColumnIfMissing('product_variants', 'imageUrl', 'TEXT'),
    addColumnIfMissing('product_variants', 'stockQty', 'INTEGER'),
    // order_items
    addColumnIfMissing('order_items', 'variantId', 'INTEGER'),
    addColumnIfMissing('order_items', 'selectedColor', 'TEXT'),
    addColumnIfMissing('order_items', 'selectedSize', 'TEXT'),
    // leads
    addColumnIfMissing('leads', 'emailSent', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('leads', 'emailAttempts', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('leads', 'lastEmailAttemptAt', 'TEXT'),
    addColumnIfMissing('leads', 'unsubscribed', 'INTEGER DEFAULT 0'),
  ]);

  // Purge any local placeholder products to prevent non-fulfillment checkout errors
  db.run("DELETE FROM products WHERE type = 'local'", (err) => {
    if (err) console.error("Error purging local products:", err.message);
    else console.log("Purged local mock products successfully.");
  });

  // Create indexes only AFTER all column migrations complete
  db.run(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_leads_unsubscribed_emailSent ON leads(unsubscribed, emailSent, emailAttempts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_emailSent_status ON orders(status, emailSent, emailAttempts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId)`);
})().catch((err) => {
  console.error('Schema migration block failed:', err.message);
});

module.exports = db;
