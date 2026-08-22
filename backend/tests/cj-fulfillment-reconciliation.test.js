'use strict';

// Hermetic regression coverage for CJ/dropship durable fulfillment.
//
// No live CJ request is permitted:
// - supplier methods are mocked for reconciliation/create scenarios;
// - the provider-code test mocks axios directly;
// - CI additionally preloads network-guard.cjs.
//
// The critical invariant proved here:
// if CJ accepted a create but JONO lost the response before local
// persistence, the retry reconciles by deterministic custom order id
// and NEVER creates a second supplier order.

const test = require('node:test');
const assert = require('node:assert/strict');
const { mock } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const axios = require('axios');

const tmpDir = fs.mkdtempSync(
  path.join(os.tmpdir(), 'cj-fulfillment-reconciliation-')
);

process.env.DB_PATH =
  path.join(tmpDir, 'isolated.db');

process.env.NODE_ENV = 'test';
process.env.HERMETIC_TEST_MODE = 'true';
process.env.DISABLE_BACKGROUND_JOBS = 'true';
process.env.ENABLE_PRINTIFY_SYNC = 'false';

process.env.PRINTIFY_API_TOKEN = '';
process.env.CJ_API_KEY = 'synthetic-cj-test-key-never-sent';
process.env.TELEGRAM_BOT_TOKEN = '';
process.env.TELEGRAM_OWNER_CHAT_ID = '';
process.env.RESEND_API_KEY = '';

const db = require('../db.js');
const dropship = require('../services/dropship.js');
const fulfillment = require('../services/fulfillment.js');
const emailService = require('../services/emailService.js');

const {
  handleDropship,
  deterministicCJExternalId
} = fulfillment;

const {
  recoverStalePaidFulfillments
} = require('../services/fulfillment-recovery.js');

const {
  processPaidOrderFulfillment
} = require('../index.js');

const dbRun = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve(this);
    });
  });

const dbGet = (sql, params = []) =>
  new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });

let seq = 0;

async function seedDropshipOrder(
  fulfillmentStatus = 'pending'
) {
  seq += 1;

  const spu = `CJ-TEST-SPU-${seq}`;
  const sku = `CJ-TEST-VARIANT-${seq}`;

  const product = await dbRun(
    `INSERT INTO products
      (
        title,
        description,
        price,
        priceUSD,
        stock,
        type,
        supplier_id,
        printifyId
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `CJ Test Product ${seq}`,
      'synthetic CJ reconciliation fixture',
      149,
      40,
      999,
      'dropship',
      'dropship',
      spu
    ]
  );

  const variant = await dbRun(
    `INSERT INTO product_variants
      (
        productId,
        printifyVariantId,
        color,
        size,
        price,
        cost,
        stockQty,
        isEnabled,
        isAvailable
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1)`,
    [
      product.lastID,
      sku,
      'Steel',
      'Test',
      149,
      1,
      999
    ]
  );

  const order = await dbRun(
    `INSERT INTO orders
      (
        customerName,
        customerEmail,
        address,
        totalAmount,
        status,
        firstName,
        lastName,
        phone,
        addressLine1,
        city,
        region,
        postalCode,
        country
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'Synthetic Customer',
      `cj-test-${seq}@example.invalid`,
      '1 Synthetic Street, Los Angeles, CA, 90001, US',
      149,
      'paid',
      'Synthetic',
      'Customer',
      '+15550000000',
      '1 Synthetic Street',
      'Los Angeles',
      'CA',
      '90001',
      'US'
    ]
  );

  const item = await dbRun(
    `INSERT INTO order_items
      (
        orderId,
        productId,
        variantId,
        quantity,
        price,
        supplier_id,
        fulfillment_status,
        selectedColor,
        selectedSize
      )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      order.lastID,
      product.lastID,
      variant.lastID,
      1,
      149,
      'dropship',
      fulfillmentStatus,
      'Steel',
      'Test'
    ]
  );

  return {
    orderId: order.lastID,
    itemId: item.lastID,

    item: {
      id: item.lastID,
      orderId: order.lastID,
      productId: product.lastID,
      supplier_id: 'dropship',
      printifyProductId: spu,
      printifyVariantId: sku,
      quantity: 1,
      price: 149
    }
  };
}

async function supplierRow(orderId) {
  return dbGet(
    `SELECT *
       FROM supplier_fulfillments
      WHERE orderId = ?
        AND supplierId = 'dropship'`,
    [orderId]
  );
}

async function itemRow(itemId) {
  return dbGet(
    `SELECT fulfillment_status, fulfillment_ref
       FROM order_items
      WHERE id = ?`,
    [itemId]
  );
}

function restore(originals) {
  for (const [object, key, value] of originals) {
    object[key] = value;
  }
}

test.before(async () => {
  await db.readyPromise;
});

test.after(async () => {
  await new Promise((resolve) => {
    db.close(() => resolve());
  });

  try {
    fs.rmSync(
      tmpDir,
      {
        recursive: true,
        force: true
      }
    );
  } catch {
    // best effort on Windows
  }
});

test(
  'CJ body-level duplicate code 1603003 is preserved safely',
  async () => {
    const postMock = mock.method(
      axios,
      'post',
      async (url) => {
        if (url.includes('getAccessToken')) {
          return {
            data: {
              code: 200,
              result: true,
              data: {
                accessToken: 'synthetic-access-token'
              }
            }
          };
        }

        if (url.includes('freightCalculate')) {
          return {
            data: {
              code: 200,
              data: [
                {
                  logisticName:
                    'Synthetic Carrier'
                }
              ]
            }
          };
        }

        if (url.includes('createOrderV2')) {
          return {
            data: {
              code: 1603003,
              result: false,
              message:
                'PROVIDER-BODY-CANARY-MUST-NOT-LEAK'
            }
          };
        }

        throw new Error(
          `Unexpected axios.post URL: ${url}`
        );
      }
    );

    let caught;

    try {
      await dropship.sendOrder(
        880001,
        {
          customerName:
            'Synthetic Customer',
          firstName: 'Synthetic',
          lastName: 'Customer',
          phone: '+15550000000',
          addressLine1:
            '1 Synthetic Street',
          city: 'Los Angeles',
          region: 'CA',
          postalCode: '90001',
          country: 'US'
        },
        [
          {
            id: 1,
            printifyVariantId:
              'CJ-SYNTHETIC-SKU',
            printifyProductId:
              'CJ-SYNTHETIC-SPU',
            quantity: 1
          }
        ],
        {
          orderNumber:
            'jono-order-880001-cj-v1'
        }
      );
    } catch (err) {
      caught = err;
    } finally {
      postMock.mock.restore();
    }

    assert.ok(caught);
    assert.equal(
      caught.code,
      'CJ_1603003'
    );

    assert.doesNotMatch(
      caught.message,
      /PROVIDER-BODY-CANARY/
    );
  }
);

test(
  'lost CJ create response reconciles on retry with exactly one create',
  async () => {
    const seeded =
      await seedDropshipOrder();

    let lookupCalls = 0;
    let createCalls = 0;
    let remoteCreated = false;

    const originals = [
      [
        dropship,
        'findOrderByCustomId',
        dropship.findOrderByCustomId
      ],
      [
        dropship,
        'sendOrder',
        dropship.sendOrder
      ]
    ];

    try {
      dropship.findOrderByCustomId =
        async () => {
          lookupCalls += 1;

          if (!remoteCreated) {
            return {
              ok: true,
              found: false
            };
          }

          return {
            ok: true,
            found: true,
            order: {
              orderId:
                'CJ-RECOVERED-ONE',
              status: 'CREATED'
            }
          };
        };

      dropship.sendOrder =
        async () => {
          createCalls += 1;

          // CJ accepted the order remotely,
          // but JONO lost the response.
          remoteCreated = true;

          const err =
            new Error(
              'synthetic lost response'
            );

          err.code = 'ETIMEDOUT';

          throw err;
        };

      await assert.rejects(
        handleDropship(
          seeded.orderId,
          {},
          [seeded.item]
        )
      );

      let supplier =
        await supplierRow(
          seeded.orderId
        );

      assert.equal(
        supplier.state,
        'create_failed'
      );

      const recovered =
        await handleDropship(
          seeded.orderId,
          {},
          [seeded.item]
        );

      assert.equal(
        recovered.ref,
        'CJ-RECOVERED-ONE'
      );

      assert.equal(
        recovered.reconciled,
        true
      );

      assert.equal(
        createCalls,
        1,
        'retry must never create a second CJ order'
      );

      assert.equal(
        lookupCalls,
        2
      );

      supplier =
        await supplierRow(
          seeded.orderId
        );

      const item =
        await itemRow(
          seeded.itemId
        );

      assert.equal(
        supplier.state,
        'submitted'
      );

      assert.equal(
        supplier.supplierOrderId,
        'CJ-RECOVERED-ONE'
      );

      assert.equal(
        item.fulfillment_status,
        'submitted'
      );
    } finally {
      restore(originals);
    }
  }
);

test(
  'CJ duplicate-create response reconciles instead of creating again',
  async () => {
    const seeded =
      await seedDropshipOrder();

    let lookupCalls = 0;
    let createCalls = 0;

    const originals = [
      [
        dropship,
        'findOrderByCustomId',
        dropship.findOrderByCustomId
      ],
      [
        dropship,
        'sendOrder',
        dropship.sendOrder
      ]
    ];

    try {
      dropship.findOrderByCustomId =
        async () => {
          lookupCalls += 1;

          if (lookupCalls === 1) {
            return {
              ok: true,
              found: false
            };
          }

          return {
            ok: true,
            found: true,
            order: {
              orderId:
                'CJ-DUPLICATE-RECOVERED',
              status: 'CREATED'
            }
          };
        };

      dropship.sendOrder =
        async () => {
          createCalls += 1;

          const err =
            new Error(
              'synthetic CJ duplicate'
            );

          err.code = 'CJ_1603003';

          throw err;
        };

      const result =
        await handleDropship(
          seeded.orderId,
          {},
          [seeded.item]
        );

      assert.equal(
        result.ref,
        'CJ-DUPLICATE-RECOVERED'
      );

      assert.equal(createCalls, 1);
      assert.equal(lookupCalls, 2);

      const supplier =
        await supplierRow(
          seeded.orderId
        );

      assert.equal(
        supplier.state,
        'submitted'
      );
    } finally {
      restore(originals);
    }
  }
);

test(
  'existing cancelled CJ order fails closed and never creates',
  async () => {
    const seeded =
      await seedDropshipOrder();

    let createCalls = 0;

    const originals = [
      [
        dropship,
        'findOrderByCustomId',
        dropship.findOrderByCustomId
      ],
      [
        dropship,
        'sendOrder',
        dropship.sendOrder
      ]
    ];

    try {
      dropship.findOrderByCustomId =
        async () => ({
          ok: true,
          found: true,
          order: {
            orderId:
              'CJ-CANCELLED-REMOTE',
            status: 'CANCELLED'
          }
        });

      dropship.sendOrder =
        async () => {
          createCalls += 1;
          throw new Error(
            'must never create'
          );
        };

      await assert.rejects(
        handleDropship(
          seeded.orderId,
          {},
          [seeded.item]
        ),
        /unsafe status/
      );

      const supplier =
        await supplierRow(
          seeded.orderId
        );

      assert.equal(
        supplier.state,
        'reconcile_required'
      );

      assert.equal(createCalls, 0);

      // Match the state production routing
      // writes after handler failure.
      await dbRun(
        `UPDATE order_items
            SET fulfillment_status = 'failed'
          WHERE id = ?`,
        [seeded.itemId]
      );
    } finally {
      restore(originals);
    }
  }
);

test(
  'real paid-order outer claim reclaims failed CJ work',
  async () => {
    const seeded =
      await seedDropshipOrder('failed');

    await dbRun(
      `INSERT INTO supplier_fulfillments
        (
          orderId,
          supplierId,
          externalId,
          state,
          attemptCount
        )
       VALUES (
         ?,
         'dropship',
         ?,
         'create_failed',
         1
       )`,
      [
        seeded.orderId,
        deterministicCJExternalId(
          seeded.orderId
        )
      ]
    );

    const originals = [
      [
        fulfillment,
        'routeOrderToSupplier',
        fulfillment.routeOrderToSupplier
      ],
      [
        emailService,
        'sendOrderConfirmationEmail',
        emailService.sendOrderConfirmationEmail
      ]
    ];

    let routeCalls = 0;
    let routedIds = [];

    try {
      fulfillment.routeOrderToSupplier =
        async (
          orderId,
          destination,
          items
        ) => {
          routeCalls += 1;

          routedIds =
            items.map(
              (item) => item.id
            );

          await dbRun(
            `UPDATE order_items
                SET fulfillment_status = 'submitted',
                    fulfillment_ref = 'CJ-OUTER-CLAIM'
              WHERE id IN (${items
                .map(() => '?')
                .join(',')})`,
            routedIds
          );
        };

      emailService.sendOrderConfirmationEmail =
        async () => ({
          ok: true
        });

      await processPaidOrderFulfillment(
        seeded.orderId,
        'CJ-Reconciliation-Test'
      );

      assert.equal(routeCalls, 1);

      assert.deepEqual(
        routedIds,
        [seeded.itemId]
      );

      const item =
        await itemRow(
          seeded.itemId
        );

      assert.equal(
        item.fulfillment_status,
        'submitted'
      );
    } finally {
      restore(originals);
    }
  }
);

test(
  'automatic recovery scanner selects failed CJ fulfillment',
  async () => {
    const seeded =
      await seedDropshipOrder('failed');

    await dbRun(
      `INSERT INTO supplier_fulfillments
        (
          orderId,
          supplierId,
          externalId,
          state,
          attemptCount
        )
       VALUES (
         ?,
         'dropship',
         ?,
         'create_failed',
         1
       )`,
      [
        seeded.orderId,
        deterministicCJExternalId(
          seeded.orderId
        )
      ]
    );

    const called = [];

    const result =
      await recoverStalePaidFulfillments({
        processPaidOrderFulfillment:
          async (orderId) => {
            called.push(orderId);
          },
        batchLimit: 25,
        source: 'scheduled'
      });

    assert.equal(
      result.scanned,
      1
    );

    assert.equal(
      result.recovered,
      1
    );

    assert.deepEqual(
      called,
      [seeded.orderId]
    );
  }
);


test(
  'CJ freight failure blocks createOrderV2',
  async () => {
    let createCalls = 0;
    let freightCalls = 0;

    const postMock =
      mock.method(
        axios,
        'post',
        async (url) => {
          if (
            url.includes(
              'getAccessToken'
            )
          ) {
            return {
              data: {
                code: 200,
                result: true,
                data: {
                  accessToken:
                    'synthetic-access-token'
                }
              }
            };
          }

          if (
            url.includes(
              'freightCalculate'
            )
          ) {
            freightCalls += 1;

            const error =
              new Error(
                'synthetic freight outage'
              );

            error.response = {
              status: 503,
              data: {
                code: 503
              }
            };

            throw error;
          }

          if (
            url.includes(
              'createOrderV2'
            )
          ) {
            createCalls += 1;

            throw new Error(
              'createOrderV2 must not be called'
            );
          }

          throw new Error(
            `Unexpected axios.post URL: ${url}`
          );
        }
      );

    let caught;

    try {
      await dropship.sendOrder(
        990001,
        {
          customerName:
            'Synthetic Customer',
          firstName: 'Synthetic',
          lastName: 'Customer',
          phone: '+15550000000',
          addressLine1:
            '1 Synthetic Street',
          city: 'Los Angeles',
          region: 'CA',
          postalCode: '90001',
          country: 'US'
        },
        [
          {
            id: 1,
            printifyVariantId:
              'CJ-SYNTHETIC-VARIANT',
            printifyProductId:
              'CJ-SYNTHETIC-SPU',
            quantity: 1
          }
        ],
        {
          orderNumber:
            'jono-order-990001-cj-v1'
        }
      );
    } catch (error) {
      caught = error;
    } finally {
      postMock.mock.restore();
    }

    assert.ok(caught);

    assert.equal(
      caught.code,
      'CJ_FREIGHT_UNAVAILABLE'
    );

    assert.equal(
      freightCalls,
      1
    );

    assert.equal(
      createCalls,
      0,
      'CJ createOrderV2 must never run after freight failure'
    );
  }
);

test(
  'CJ empty freight options block createOrderV2 instead of guessing a carrier',
  async () => {
    let createCalls = 0;

    const postMock =
      mock.method(
        axios,
        'post',
        async (url) => {
          if (
            url.includes(
              'getAccessToken'
            )
          ) {
            return {
              data: {
                code: 200,
                result: true,
                data: {
                  accessToken:
                    'synthetic-access-token'
                }
              }
            };
          }

          if (
            url.includes(
              'freightCalculate'
            )
          ) {
            return {
              data: {
                code: 200,
                result: true,
                data: []
              }
            };
          }

          if (
            url.includes(
              'createOrderV2'
            )
          ) {
            createCalls += 1;

            throw new Error(
              'createOrderV2 must not be called'
            );
          }

          throw new Error(
            `Unexpected axios.post URL: ${url}`
          );
        }
      );

    let caught;

    try {
      await dropship.sendOrder(
        990002,
        {
          customerName:
            'Synthetic Customer',
          firstName: 'Synthetic',
          lastName: 'Customer',
          phone: '+15550000000',
          addressLine1:
            '1 Synthetic Street',
          city: 'Los Angeles',
          region: 'CA',
          postalCode: '90001',
          country: 'US'
        },
        [
          {
            id: 2,
            printifyVariantId:
              'CJ-SYNTHETIC-VARIANT-2',
            printifyProductId:
              'CJ-SYNTHETIC-SPU-2',
            quantity: 1
          }
        ],
        {
          orderNumber:
            'jono-order-990002-cj-v1'
        }
      );
    } catch (error) {
      caught = error;
    } finally {
      postMock.mock.restore();
    }

    assert.ok(caught);

    assert.equal(
      caught.code,
      'CJ_FREIGHT_UNAVAILABLE'
    );

    assert.equal(
      createCalls,
      0
    );
  }
);
