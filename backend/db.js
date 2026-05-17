const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.resolve(__dirname, 'ecommerce.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error connecting to database:', err.message);
  } else {
    console.log('Connected to SQLite database.');
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
      status TEXT DEFAULT 'pending',
      locale TEXT DEFAULT 'he',
      currency TEXT DEFAULT 'ILS',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
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

  // Migrate: add new columns to existing products table if they don't exist
  db.run(`ALTER TABLE products ADD COLUMN backImageUrl TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN images TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN printifyId TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN fabric TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN careInstructions TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN deliveryInfo TEXT`, () => {});
  
  // Migrate: add imageUrl to product_variants table
  db.run(`ALTER TABLE product_variants ADD COLUMN imageUrl TEXT`, () => {});
  db.run(`ALTER TABLE product_variants ADD COLUMN stockQty INTEGER`, () => {});
  
  // Purge any local placeholder products to prevent non-fulfillment checkout errors
  db.run("DELETE FROM products WHERE type = 'local'", (err) => {
    if (err) console.error("Error purging local products:", err.message);
    else console.log("Purged local mock products successfully.");
  });
});

module.exports = db;
