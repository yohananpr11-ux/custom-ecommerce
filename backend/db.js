const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// DB_PATH override lets a persistent-disk mount (production) or an isolated
// throwaway file (tests) replace the default in-repo location without any
// change to default behavior when unset.
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.resolve(__dirname, 'ecommerce.db');

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
      priceUSD REAL,
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
      firstName TEXT,
      lastName TEXT,
      phone TEXT,
      addressLine1 TEXT,
      addressLine2 TEXT,
      city TEXT,
      region TEXT,
      postalCode TEXT,
      country TEXT,
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
    CREATE TABLE IF NOT EXISTS abandoned_carts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      cart_fingerprint TEXT NOT NULL,
      items_json TEXT,
      source TEXT DEFAULT 'web',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(email, cart_fingerprint)
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

  // Design jobs — Human-in-the-Loop product creation pipeline.
  // Lifecycle: awaiting_approval → (published | rejected)
  // Created by /api/admin/design/create-draft, mutated by publish/reject endpoints.
  db.run(`
    CREATE TABLE IF NOT EXISTS design_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      printifyProductId TEXT NOT NULL,
      blueprintId INTEGER NOT NULL,
      printProviderId INTEGER NOT NULL,
      productType TEXT NOT NULL DEFAULT 'tee',
      title TEXT,
      priceILS REAL NOT NULL,
      mockupUrl TEXT,
      sourceImageRef TEXT,
      status TEXT NOT NULL DEFAULT 'awaiting_approval',
      requestedBy TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      decidedAt DATETIME,
      publishedProductId INTEGER,
      lastError TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS product_images (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      design_job_id INTEGER,
      product_variant_id INTEGER,
      view TEXT NOT NULL,
      url TEXT NOT NULL,
      is_custom_mockup INTEGER DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (design_job_id) REFERENCES design_jobs(id),
      FOREIGN KEY (product_variant_id) REFERENCES product_variants(id),
      UNIQUE(design_job_id, view),
      UNIQUE(product_variant_id, view)
    )
  `);

  // Durable per-order-per-supplier fulfillment state — the source of truth
  // for supplier-write idempotency (create-order / send-to-production).
  // order_items.fulfillment_status remains the UI/reporting-facing summary;
  // this table is what a retry/crash-recovery path actually reconciles
  // against. One row per (orderId, supplierId) — never more, enforced by
  // the UNIQUE constraint, since one supplier order can bundle multiple
  // local order_items.
  //
  // state values: pending, reconciling, created, submitting, submitted,
  // create_failed, submit_failed, reconcile_required.
  db.run(`
    CREATE TABLE IF NOT EXISTS supplier_fulfillments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      supplierId TEXT NOT NULL,
      externalId TEXT NOT NULL,
      supplierOrderId TEXT,
      state TEXT NOT NULL DEFAULT 'pending',
      lastErrorCode TEXT,
      attemptCount INTEGER NOT NULL DEFAULT 0,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (orderId) REFERENCES orders(id),
      UNIQUE(orderId, supplierId)
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
    addColumnIfMissing('products', 'priceUSD', 'REAL'),
    // Phase 3: Multi-Vendor — supplier routing
    addColumnIfMissing('products', 'supplier_id', "TEXT NOT NULL DEFAULT 'printify'"),
    // Direct-access token gate for hidden (type='local', supplier_id='manual')
    // products — see GET /api/products/:id. NULL for every ordinary product;
    // only ever set by scripts/manual-payment-test-product.js.
    addColumnIfMissing('products', 'access_token_hash', 'TEXT'),
    addColumnIfMissing('products', 'access_token_expires_at', 'DATETIME'),
    // orders
    addColumnIfMissing('orders', 'promoCode', 'TEXT'),
    addColumnIfMissing('orders', 'promoDiscount', 'REAL DEFAULT 0'),
    addColumnIfMissing('orders', 'emailSent', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('orders', 'emailAttempts', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('orders', 'lastEmailAttemptAt', 'TEXT'),
    addColumnIfMissing('orders', 'firstName', 'TEXT'),
    addColumnIfMissing('orders', 'lastName', 'TEXT'),
    addColumnIfMissing('orders', 'phone', 'TEXT'),
    addColumnIfMissing('orders', 'addressLine1', 'TEXT'),
    addColumnIfMissing('orders', 'addressLine2', 'TEXT'),
    addColumnIfMissing('orders', 'city', 'TEXT'),
    addColumnIfMissing('orders', 'region', 'TEXT'),
    addColumnIfMissing('orders', 'postalCode', 'TEXT'),
    addColumnIfMissing('orders', 'country', 'TEXT'),
    // Backfill columns that CREATE TABLE declares but legacy DBs were created without
    // (locale/currency added for i18n checkout; shippingCost added for transparency).
    addColumnIfMissing('orders', 'shippingCost', 'REAL DEFAULT 0'),
    addColumnIfMissing('orders', 'locale', "TEXT DEFAULT 'he'"),
    addColumnIfMissing('orders', 'currency', "TEXT DEFAULT 'ILS'"),
    // Immutable expected-payment snapshot, set once at PayPal order-creation
    // time and never recomputed — capture-time verification compares against
    // these stored values instead of trusting the capture response's own
    // currency or re-deriving an amount with a possibly-different exchange
    // rate. NULL on orders created before this column existed (legacy orders
    // fail closed at capture time rather than being silently trusted).
    addColumnIfMissing('orders', 'expected_payment_currency', 'TEXT'),
    addColumnIfMissing('orders', 'expected_payment_amount', 'REAL'),
    // design_jobs
    addColumnIfMissing('design_jobs', 'lastError', 'TEXT'),
    // product_variants
    addColumnIfMissing('product_variants', 'imageUrl', 'TEXT'),
    addColumnIfMissing('product_variants', 'stockQty', 'INTEGER'),
    // order_items
    addColumnIfMissing('order_items', 'variantId', 'INTEGER'),
    addColumnIfMissing('order_items', 'selectedColor', 'TEXT'),
    addColumnIfMissing('order_items', 'selectedSize', 'TEXT'),
    // Phase 3: Multi-Vendor — per-item supplier snapshot + fulfillment tracking
    addColumnIfMissing('order_items', 'supplier_id',        'TEXT'),
    addColumnIfMissing('order_items', 'fulfillment_status', "TEXT DEFAULT 'pending'"),
    addColumnIfMissing('order_items', 'fulfillment_ref',    'TEXT'),
    // leads
    addColumnIfMissing('leads', 'emailSent', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('leads', 'emailAttempts', 'INTEGER DEFAULT 0'),
    addColumnIfMissing('leads', 'lastEmailAttemptAt', 'TEXT'),
    addColumnIfMissing('leads', 'unsubscribed', 'INTEGER DEFAULT 0'),
  ]);

  // Local/mock placeholder products (type='local') are never purged here.
  // Startup must never delete catalog rows -- see
  // scripts/purge-local-placeholder-products.js for the explicit,
  // opt-in-only cleanup this used to run unconditionally on every boot.

  // Create indexes only AFTER all column migrations complete
  db.run(`CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_abandoned_carts_email_updated ON abandoned_carts(email, updated_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_leads_unsubscribed_emailSent ON leads(unsubscribed, emailSent, emailAttempts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_orders_emailSent_status ON orders(status, emailSent, emailAttempts)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_orderId ON order_items(orderId)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_product_images_design_job_view ON product_images(design_job_id, view)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_product_images_variant_view ON product_images(product_variant_id, view)`);
  // Phase 3: Multi-Vendor indexes
  db.run(`CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_order_items_supplier ON order_items(supplier_id, fulfillment_status)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_supplier_fulfillments_state ON supplier_fulfillments(supplierId, state)`);
})().catch((err) => {
  console.error('Schema migration block failed:', err.message);
});

module.exports = db;
