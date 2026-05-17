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

  // Migrate: add new columns to existing products table if they don't exist
  db.run(`ALTER TABLE products ADD COLUMN backImageUrl TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN images TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN printifyId TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN fabric TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN careInstructions TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN deliveryInfo TEXT`, () => {});
  
  // Seed initial local products if empty
  db.get("SELECT COUNT(*) AS count FROM products", (err, row) => {
    if (row && row.count === 0) {
      const stmt = db.prepare("INSERT INTO products (title, description, price, imageUrl, backImageUrl, stock, type, fabric, careInstructions, deliveryInfo) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
      stmt.run(
        "Drop Shoulder Premium Tee - Black",
        "Heavyweight 240 GSM, 100% Cotton. Boxy fit with drop shoulders for a modern silhouette.",
        89.90,
        "https://images.unsplash.com/photo-1583743814966-8936f5b7be1a?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&w=800&q=80",
        50, 'local',
        '100% Combed Ring-Spun Cotton, 240 GSM Heavyweight',
        'Machine wash cold. Tumble dry low. Do not bleach.',
        'Standard delivery: 5-7 business days. Express: 2-3 business days.'
      );
      stmt.run(
        "Drop Shoulder Premium Tee - White",
        "Heavyweight 240 GSM, 100% Cotton. Boxy fit with drop shoulders for a modern silhouette.",
        89.90,
        "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1562157873-818bc0726f68?auto=format&fit=crop&w=800&q=80",
        30, 'local',
        '100% Combed Ring-Spun Cotton, 240 GSM Heavyweight',
        'Machine wash cold. Tumble dry low. Do not bleach.',
        'Standard delivery: 5-7 business days. Express: 2-3 business days.'
      );
      stmt.run(
        "Essential Heavyweight Hoodie",
        "400 GSM Fleece. Perfect modern proportions with kangaroo pocket and adjustable drawcord hood.",
        159.90,
        "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=800&q=80",
        "https://images.unsplash.com/photo-1578768079470-9e3e27916e8c?auto=format&fit=crop&w=800&q=80",
        20, 'local',
        '80% Cotton / 20% Polyester, 400 GSM Heavyweight Fleece',
        'Machine wash cold inside out. Tumble dry low. Do not iron print.',
        'Standard delivery: 5-7 business days. Express: 2-3 business days.'
      );
      stmt.finalize();
      console.log('Database seeded with initial premium products.');
    }
  });
});

module.exports = db;
