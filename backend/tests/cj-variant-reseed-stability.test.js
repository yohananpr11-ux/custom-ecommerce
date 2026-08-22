'use strict';

const test =
  require('node:test');

const assert =
  require('node:assert/strict');

const fs =
  require('node:fs');

const os =
  require('node:os');

const path =
  require('node:path');

const { mock } =
  require('node:test');

const tmpDir =
  fs.mkdtempSync(
    path.join(
      os.tmpdir(),
      'cj-variant-reseed-'
    )
  );

process.env.DB_PATH =
  path.join(
    tmpDir,
    'isolated.db'
  );

process.env.NODE_ENV =
  'test';

process.env.HERMETIC_TEST_MODE =
  'true';

process.env.DISABLE_BACKGROUND_JOBS =
  'true';

process.env.ENABLE_PRINTIFY_SYNC =
  'false';

process.env.CJ_API_KEY =
  'synthetic-never-sent';

process.env.PRINTIFY_API_TOKEN =
  '';

process.env.TELEGRAM_BOT_TOKEN =
  '';

process.env.RESEND_API_KEY =
  '';

const db =
  require('../db.js');

const dropship =
  require('../services/dropship.js');

const emailService =
  require('../services/emailService.js');

const {
  processPaidOrderFulfillment
} =
  require('../index.js');

const dbRun =
  (sql, params = []) =>
    new Promise(
      (resolve, reject) => {
        db.run(
          sql,
          params,
          function (err) {
            if (err) {
              reject(err);
            } else {
              resolve(this);
            }
          }
        );
      }
    );

test.before(async () => {
  await db.readyPromise;
});

test.after(async () => {
  await new Promise(
    (resolve) => {
      db.close(
        () => resolve()
      );
    }
  );

  try {
    fs.rmSync(
      tmpDir,
      {
        recursive: true,
        force: true
      }
    );
  } catch {
    // best effort
  }
});

test(
  'paid CJ order preserves supplier SKU across catalog reseed',
  async () => {
    const productId =
      980001;

    const expectedSku =
      'CJLX222053104DW';

    await dbRun(
      `INSERT INTO products
        (
          id,
          title,
          description,
          price,
          priceUSD,
          stock,
          type,
          supplier_id,
          printifyId
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        'Synthetic CJ Reseed Product',
        'synthetic regression fixture',
        100,
        30,
        999,
        'dropship',
        'dropship',
        'CJLX2220531'
      ]
    );

    const oldVariant =
      await dbRun(
        `INSERT INTO product_variants
          (
            productId,
            printifyVariantId,
            color,
            size,
            price,
            stockQty,
            isEnabled,
            isAvailable
          )
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          productId,
          expectedSku,
          'Steel',
          '5mm / 50cm',
          100,
          999
        ]
      );

    const oldVariantId =
      oldVariant.lastID;

    const order =
      await dbRun(
        `INSERT INTO orders
          (
            customerName,
            customerEmail,
            address,
            firstName,
            lastName,
            phone,
            addressLine1,
            city,
            region,
            postalCode,
            country,
            totalAmount,
            status
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'Synthetic Customer',
          'reseed@example.invalid',
          '1 Synthetic Street, Los Angeles, CA, 90001, US',
          'Synthetic',
          'Customer',
          '+15550000000',
          '1 Synthetic Street',
          'Los Angeles',
          'CA',
          '90001',
          'US',
          100,
          'paid'
        ]
      );

    const orderId =
      order.lastID;

    await dbRun(
      `INSERT INTO order_items
        (
          orderId,
          productId,
          variantId,
          quantity,
          price,
          selectedColor,
          selectedSize,
          supplier_id,
          supplier_variant_id,
          fulfillment_status
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        productId,
        oldVariantId,
        1,
        100,
        'Steel',
        '5mm / 50cm',
        'dropship',
        expectedSku,
        'pending'
      ]
    );

    /*
     * Simulate exactly what startup reseeding does:
     * delete the old variant row and insert the same
     * supplier SKU again without pinning the local PK.
     */
    await dbRun(
      `DELETE FROM product_variants
        WHERE id = ?`,
      [
        oldVariantId
      ]
    );

    const replacementVariant =
      await dbRun(
        `INSERT INTO product_variants
          (
            productId,
            printifyVariantId,
            color,
            size,
            price,
            stockQty,
            isEnabled,
            isAvailable
          )
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          productId,
          expectedSku,
          'Steel',
          '5mm / 50cm',
          100,
          999
        ]
      );

    const newVariantId =
      replacementVariant.lastID;

    assert.notEqual(
      newVariantId,
      oldVariantId,
      'reseed must produce a new local variant id'
    );

    const calls = [];

    const lookupMock =
      mock.method(
        dropship,
        'findOrderByCustomId',
        async () => ({
          ok: true,
          found: false
        })
      );

    const sendMock =
      mock.method(
        dropship,
        'sendOrder',
        async (
          sentOrderId,
          destination,
          items,
          options
        ) => {
          calls.push({
            sentOrderId,
            destination,
            items,
            options
          });

          return {
            ref:
              'CJ-RESEED-SYNTHETIC-REF'
          };
        }
      );

    const emailMock =
      mock.method(
        emailService,
        'sendOrderConfirmationEmail',
        async () => ({
          success: true
        })
      );

    try {
      await processPaidOrderFulfillment(
        orderId,
        'CJ_RESEED_TEST'
      );

      assert.equal(
        calls.length,
        1,
        'supplier boundary must be reached exactly once'
      );

      const actualSku =
        calls[0].items[0]
          .printifyVariantId;

      if (
        actualSku !== expectedSku
      ) {
        const error =
          new Error(
            'CJ_RESEED_IDENTITY_LOST ' +
            'actual=' +
            String(actualSku) +
            ' expected=' +
            expectedSku
          );

        error.code =
          'CJ_RESEED_IDENTITY_LOST';

        throw error;
      }

    } finally {
      lookupMock.mock.restore();
      sendMock.mock.restore();
      emailMock.mock.restore();
    }
  }
);


test(
  'legacy CJ order without supplier SKU snapshot fails closed',
  async () => {
    const productId =
      980002;

    const mutableCatalogSku =
      'CJLX222053104DW';

    await dbRun(
      `INSERT INTO products
        (
          id,
          title,
          description,
          price,
          priceUSD,
          stock,
          type,
          supplier_id,
          printifyId
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        'Synthetic Legacy CJ Product',
        'synthetic legacy fixture',
        100,
        30,
        999,
        'dropship',
        'dropship',
        'CJ-SYNTHETIC-LEGACY-SPU-980002'
      ]
    );

    const variant =
      await dbRun(
        `INSERT INTO product_variants
          (
            productId,
            printifyVariantId,
            color,
            size,
            price,
            stockQty,
            isEnabled,
            isAvailable
          )
         VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
        [
          productId,
          mutableCatalogSku,
          'Steel',
          '5mm / 50cm',
          100,
          999
        ]
      );

    const order =
      await dbRun(
        `INSERT INTO orders
          (
            customerName,
            customerEmail,
            address,
            firstName,
            lastName,
            phone,
            addressLine1,
            city,
            region,
            postalCode,
            country,
            totalAmount,
            status
          )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'Synthetic Legacy Customer',
          'legacy@example.invalid',
          '1 Synthetic Street, Los Angeles, CA, 90001, US',
          'Synthetic',
          'Legacy',
          '+15550000000',
          '1 Synthetic Street',
          'Los Angeles',
          'CA',
          '90001',
          'US',
          100,
          'paid'
        ]
      );

    const orderId =
      order.lastID;

    await dbRun(
      `INSERT INTO order_items
        (
          orderId,
          productId,
          variantId,
          quantity,
          price,
          selectedColor,
          selectedSize,
          supplier_id,
          supplier_variant_id,
          fulfillment_status
        )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        productId,
        variant.lastID,
        1,
        100,
        'Steel',
        '5mm / 50cm',
        'dropship',
        null,
        'pending'
      ]
    );

    const lookupMock =
      mock.method(
        dropship,
        'findOrderByCustomId',
        async () => ({
          ok: true,
          found: false
        })
      );

    const emailMock =
      mock.method(
        emailService,
        'sendOrderConfirmationEmail',
        async () => ({
          success: true
        })
      );

    try {
      await processPaidOrderFulfillment(
        orderId,
        'CJ_LEGACY_SNAPSHOT_TEST'
      );

      const item =
        await new Promise(
          (resolve, reject) => {
            db.get(
              `SELECT
                 fulfillment_status,
                 fulfillment_ref
               FROM order_items
               WHERE orderId = ?`,
              [orderId],
              (err, row) => {
                if (err) {
                  reject(err);
                } else {
                  resolve(row);
                }
              }
            );
          }
        );

      assert.equal(
        item.fulfillment_status,
        'failed',
        'legacy CJ row without immutable SKU must fail closed'
      );

      assert.match(
        String(
          item.fulfillment_ref || ''
        ),
        /CJ variant SKU missing/i
      );

    } finally {
      lookupMock.mock.restore();
      emailMock.mock.restore();
    }
  }
);
