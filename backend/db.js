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
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      paid_at DATETIME
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
      alerted INTEGER DEFAULT 0,
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

  // First-party visitor/session telemetry (PR #34). One row per browser
  // session; session_id is the idempotency key -- a reload/refresh reuses
  // the same session_id client-side, so re-inserting it is always a no-op
  // (see visitor-telemetry.js's INSERT OR IGNORE + changes-count check,
  // which is also what decides whether an owner notification fires).
  // Deliberately holds no raw IP and no fingerprinting data.
  db.run(`
    CREATE TABLE IF NOT EXISTS visitor_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_id TEXT NOT NULL,
      session_id TEXT NOT NULL UNIQUE,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      landing_path TEXT,
      referrer TEXT,
      source TEXT,
      device_category TEXT,
      ua_classification TEXT NOT NULL DEFAULT 'human',
      is_human INTEGER NOT NULL DEFAULT 0,
      notified INTEGER NOT NULL DEFAULT 0
    )
  `);

  // Structured, deduped customer-impacting technical issues (PR #34).
  // `signature` is a deterministic string built from type+route+a truncated
  // safe message -- the UNIQUE constraint is what makes recordIssue's
  // upsert-or-increment idempotent and is also reused verbatim as
  // owner-notifications' dedupKey, so a repeated failure increments
  // occurrence_count here without ever bypassing that module's own
  // cooldown. No tokens, passwords, request bodies, or payment data are
  // ever stored in `message` -- see technical-issues.js for sanitization.
  db.run(`
    CREATE TABLE IF NOT EXISTS technical_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      signature TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'WARNING',
      route TEXT,
      message TEXT,
      session_id TEXT,
      order_id INTEGER,
      first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      occurrence_count INTEGER NOT NULL DEFAULT 1
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

  // Daily owner report execution history (PR #36).
  // Ensures restart-safe, duplicate-safe daily reports at 22:00 Europe/Jerusalem.
  // One row per (report_type, report_date).
  db.run(`
    CREATE TABLE IF NOT EXISTS daily_owner_reports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      report_type TEXT NOT NULL DEFAULT 'daily_summary',
      report_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at DATETIME,
      sent_at DATETIME,
      payload_summary TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(report_type, report_date)
    )
  `);

});

// Helper to safely add column if not exists — returns a Promise
const addColumnIfMissing = (tableName, columnName, columnDefinition, { critical = false } = {}) => new Promise((resolve, reject) => {
  db.all(`PRAGMA table_info(${tableName})`, (err, columns) => {
    if (err) {
      console.error(`Error fetching table info for ${tableName}:`, err.message);
      if (critical) return reject(err);
      return resolve();
    }
    const hasColumn = columns && columns.some(c => c.name === columnName);
    if (hasColumn) return resolve();

    db.run(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`, (alterErr) => {
      if (alterErr && !/duplicate column name/i.test(alterErr.message)) {
        console.error(`Error adding column ${columnName} to ${tableName}:`, alterErr.message);
        if (critical) return reject(alterErr);
      } else {
        console.log(`Successfully added column ${columnName} to ${tableName}`);
      }
      resolve();
    });
  });
});

// Initialize tables and run all column migrations and index creations in strict sequence
const readyPromise = new Promise((resolveReady, rejectReady) => {
  db.serialize(() => {
    db.run('PRAGMA user_version', (pragmaErr) => {
      if (pragmaErr) return rejectReady(pragmaErr);

      (async () => {
        try {
          await Promise.all([
            // products
            addColumnIfMissing('products', 'backImageUrl', 'TEXT'),
            addColumnIfMissing('products', 'images', 'TEXT'),
            addColumnIfMissing('products', 'printifyId', 'TEXT'),
            addColumnIfMissing('products', 'fabric', 'TEXT'),
            addColumnIfMissing('products', 'careInstructions', 'TEXT'),
            addColumnIfMissing('products', 'deliveryInfo', 'TEXT'),
            addColumnIfMissing('products', 'priceUSD', 'REAL'),
            addColumnIfMissing('products', 'is_hidden', 'INTEGER DEFAULT 0'),
            // Phase 3: Multi-Vendor — supplier routing
            addColumnIfMissing('products', 'supplier_id', "TEXT NOT NULL DEFAULT 'printify'"),
            // Direct-access token gate for hidden (type='local', supplier_id='manual')
            // products — see GET /api/products/:id. NULL for every ordinary product;
            // only ever set by scripts/manual-payment-test-product.js.
            addColumnIfMissing('products', 'access_token_hash', 'TEXT'),
            addColumnIfMissing('products', 'access_token_expires_at', 'DATETIME'),
            // Manual-supplier stock reservation lease -- see reserveManualProductStock
            // in index.js. Deliberately lives on the product row itself, not on any
            // orders/order_items row, so a reservation can always be reclaimed even
            // if the process crashes before an order row for it ever exists (between
            // resolveValidatedOrderItems reserving stock and createPendingOrder's own
            // orders INSERT). NULL for every ordinary product and whenever no manual
            // product currently has an outstanding reservation.
            addColumnIfMissing('products', 'stock_reservation_qty', 'INTEGER'),
            addColumnIfMissing('products', 'stock_reservation_expires_at', 'DATETIME'),
            // orders
            // Populated at /api/paypal/create-order time with the real PayPal order
            // id. Used only by capture-order's pre-capture reservation check for
            // manual-supplier orders (see the matching comment there) -- looking a
            // client-supplied PayPal orderID up against this column lets that check
            // find the local order and re-verify its status BEFORE ever calling
            // PayPal's real capture endpoint, instead of only after (when a real
            // charge has already happened). Harmless/unused for every other order.
            addColumnIfMissing('orders', 'paypal_order_id', 'TEXT'),
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
            addColumnIfMissing('orders', 'paid_at', 'DATETIME', { critical: true }),
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
            addColumnIfMissing('abandoned_carts', 'alerted', 'INTEGER DEFAULT 0'),
            // technical_issues (PR #34 follow-up: durable notification/cooldown
            // state, so a repeated issue stays suppressed across a process
            // restart instead of relying on owner-notifications' in-memory-only
            // cooldown Map). last_notified_at is NULL until the first successful
            // (or attempted) notification; notified_count is separate from
            // occurrence_count, which keeps incrementing on every sighting
            // regardless of whether an alert was actually sent.
            addColumnIfMissing('technical_issues', 'last_notified_at', 'DATETIME'),
            addColumnIfMissing('technical_issues', 'notified_count', 'INTEGER NOT NULL DEFAULT 0'),
          ]);

          // Create indexes only AFTER all column migrations complete
          db.serialize(() => {
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
            // PR #34: visitor telemetry + technical issues indexes.
            // idx_visitor_sessions_session_id is implied by the UNIQUE constraint above
            // (SQLite auto-creates a unique index for it) -- not duplicated here.
            db.run(`CREATE INDEX IF NOT EXISTS idx_visitor_sessions_visitor_id ON visitor_sessions(visitor_id)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_visitor_sessions_started_at ON visitor_sessions(started_at)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_technical_issues_last_seen ON technical_issues(last_seen_at)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_technical_issues_type ON technical_issues(type)`);
            db.run(`CREATE INDEX IF NOT EXISTS idx_technical_issues_last_notified ON technical_issues(last_notified_at)`);

            // Enforces at the SQLite engine level what application code (checkout's
            // printifyId guard, the sync duplicate-detection in
            // services/printify-sync-helpers.js) can only ever police on its own:
            // that two products can never share one real Printify identity. Partial
            // index -- printifyId IS NULL or blank/whitespace-only is explicitly
            // exempted, so any number of un-synced local rows remain unaffected; only
            // a genuine non-empty duplicate is rejected.
            db.run(
              `CREATE UNIQUE INDEX IF NOT EXISTS idx_products_printifyId_unique
                 ON products(printifyId)
                 WHERE printifyId IS NOT NULL AND TRIM(printifyId) != ''`,
              (err) => {
                if (err) {
                  console.error(
                    `Printify printifyId uniqueness index not active: duplicate printifyId values already exist in products, so this database-level protection could not be enabled. index not active -- run the global duplicate scan (SELECT printifyId, COUNT(*) AS c, GROUP_CONCAT(id) FROM products WHERE printifyId IS NOT NULL AND TRIM(printifyId) != '' GROUP BY printifyId HAVING c > 1) and resolve every duplicate, then restart. Underlying error: ${err.message}`
                  );
                }

                // Data migration: Product copy sanitization & soft-launch catalog cleanup
                db.serialize(() => {
                  // 1. Hide products 17, 18, 19, 20, 21 from customer-facing storefront for soft-launch
                  db.run(`UPDATE products SET is_hidden = 1 WHERE id IN (17, 18, 19, 20, 21)`);

                  // 2. Product 16: Ensure truthful JONO copy
                  db.run(
                    `UPDATE products
                     SET description = 'Elevate your aesthetic with our premium Six-sided Grinding Cuban Link Chain. Meticulously engineered with six flat-cut facets per link to capture the light. Crafted in solid hypoallergenic stainless steel and plated in a deep, premium gold/silver finish. A flagship staple of the JONO jewelry line.'
                     WHERE id = 16`
                  );

                  // 3. Products 22, 23, 24: Ensure truthful JONO copy
                  db.run(
                    `UPDATE products
                     SET description = 'JONO Premium Street Hoodie Drop. Heavyweight cotton fleece with tailored silhouette.'
                     WHERE id = 22`
                  );
                  db.run(
                    `UPDATE products
                     SET description = 'JONO Premium Street Hoodie Drop v2. Heavyweight cotton fleece with tailored silhouette.'
                     WHERE id = 23`
                  );
                  db.run(
                    `UPDATE products
                     SET description = 'JONO Premium Street Hoodie Drop v3. Heavyweight cotton fleece with tailored silhouette.'
                     WHERE id = 24`,
                    (migErr) => {
                      if (migErr) {
                        console.error('Product copy sanitization migration error:', migErr.message);
                      }
                      resolveReady();
                    }
                  );
                });
              }
            );
          });
        } catch (migrationErr) {
          console.error('Schema migration block failed:', migrationErr.message);
          rejectReady(migrationErr);
        }
      })();
    });
  });
});

readyPromise.catch((err) => {
  console.error('Schema migration block failed:', err.message);
});

db.readyPromise = readyPromise;
module.exports = db;
module.exports.dbPath = dbPath;
module.exports.readyPromise = readyPromise;
