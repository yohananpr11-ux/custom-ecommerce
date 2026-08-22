'use strict';

const axios = require('axios');
const telegram = require('./telegram');

const SUPPLIER_NAME = 'dropship';

const COUNTRY_NAME_MAP = {
  IL: 'Israel',
  US: 'United States',
  GB: 'United Kingdom',
  CA: 'Canada',
  AU: 'Australia',
  FR: 'France',
  DE: 'Germany',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
};

function getCountryName(code) {
  const cleanCode = String(code || '').trim().toUpperCase();
  return COUNTRY_NAME_MAP[cleanCode] || cleanCode;
}

let cachedToken = null;
let cachedTokenExpiry = 0;

/**
 * Exchange the CJ_API_KEY from environment variables for a live CJ-Access-Token.
 * Implements in-memory caching to optimize API requests.
 *
 * @returns {Promise<string>} The access token
 */
async function getCJAccessToken() {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiry) {
    return cachedToken;
  }

  const apiKey = process.env.CJ_API_KEY;
  if (!apiKey) {
    throw new Error('CJ_API_KEY environment variable is missing.');
  }

  try {
    const response = await axios.post(
      'https://developers.cjdropshipping.com/api2.0/v1/authentication/getAccessToken',
      { apiKey },
      { headers: { 'Content-Type': 'application/json' } }
    );

    const json = response.data || {};
    if (json.code !== 200 && json.result !== true) {
      throw new Error(json.message || 'Authentication endpoint returned failure');
    }

    const data = json.data || {};
    const token = data.accessToken || json.accessToken || data.token;
    if (!token) {
      throw new Error(`Access token not found in CJ response: ${JSON.stringify(json)}`);
    }

    cachedToken = token;
    // Cache for 12 hours (CJ token expires in 180 days)
    cachedTokenExpiry = now + 12 * 60 * 60 * 1000;
    return token;
  } catch (error) {
    // SECURITY: never log or forward the raw response body -- see the
    // matching comment in sendOrder() below for the full reasoning.
    const status = error.response && error.response.status;
    const safeSummary = status ? `HTTP_${status}` : (error.code || error.message || 'UNKNOWN_ERROR');
    console.error('❌ CJ Dropshipping authentication failed:', safeSummary);
    throw new Error(`CJ Dropshipping authentication failed: ${safeSummary}`);
  }
}

/**
 * Query the CJ Dropshipping Freight Calculation API to dynamically resolve
 * the best shipping method (logisticName) for the destination and products.
 * Falls back to a standard default carrier on any error or empty response.
 *
 * @param {string} token        CJ Access Token
 * @param {string} fromCountry  Origin country code
 * @param {string} toCountry    Destination country code
 * @param {Array}  products     Mapped products array { sku/vid, quantity }
 * @returns {Promise<string>}   The chosen logisticName
 */
async function getLogisticName(
  token,
  fromCountry,
  toCountry,
  products
) {
  const payload = {
    startCountryCode: fromCountry,
    endCountryCode: toCountry,

    products:
      products.map((p) => ({
        sku: p.sku,
        quantity: p.quantity
      }))
  };

  console.log(
    `[${SUPPLIER_NAME}] Querying CJ Freight Calculation (origin=${fromCountry}, dest=${toCountry})...`
  );

  let response;

  try {
    response =
      await axios.post(
        'https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate',
        payload,
        {
          headers: {
            'CJ-Access-Token': token,
            'Content-Type':
              'application/json'
          }
        }
      );
  } catch (error) {
    const status =
      error.response &&
      error.response.status;

    const cjCode =
      error.response &&
      error.response.data &&
      typeof error.response.data.code ===
        'number'
        ? error.response.data.code
        : undefined;

    const safeReason =
      status
        ? `HTTP_${status}`
        : (
            cjCode !== undefined
              ? `CJ_${cjCode}`
              : (
                  error.code ||
                  'CJ_FREIGHT_REQUEST_FAILED'
                )
          );

    console.warn(
      `[${SUPPLIER_NAME}] Freight calculation failed: ${safeReason}`
    );

    const wrapped =
      new Error(
        `CJ freight calculation failed: ${safeReason}`
      );

    wrapped.code =
      'CJ_FREIGHT_UNAVAILABLE';

    throw wrapped;
  }

  const json =
    response.data || {};

  const options =
    Array.isArray(json.data)
      ? json.data
      : [];

  if (
    json.code !== 200 ||
    json.result === false ||
    options.length === 0
  ) {
    const safeReason =
      typeof json.code === 'number'
        ? `CJ_${json.code}`
        : 'CJ_FREIGHT_NO_OPTIONS';

    console.warn(
      `[${SUPPLIER_NAME}] Freight calculation returned no usable option: ${safeReason}`
    );

    const error =
      new Error(
        `CJ freight option unavailable: ${safeReason}`
      );

    error.code =
      'CJ_FREIGHT_UNAVAILABLE';

    throw error;
  }

  const logisticName =
    String(
      options[0].logisticName || ''
    ).trim();

  if (!logisticName) {
    const error =
      new Error(
        'CJ freight option did not include logisticName'
      );

    error.code =
      'CJ_FREIGHT_UNAVAILABLE';

    throw error;
  }

  console.log(
    `[${SUPPLIER_NAME}] Dynamic shipping carrier selected: "${logisticName}"`
  );

  return logisticName;
}

/**
 * Send a group of order items to the CJ Dropshipping API.
 *
 * @param {number}   orderId              Internal Drip Street order ID
 * @param {object}   shippingDestination  { firstName, lastName, customerName, customerEmail, phone, addressLine1, addressLine2, city, region, postalCode, country }
 * @param {Array}    items                order_items rows (supplier_id='dropship')
 * @returns {Promise<{ref: string}>}      Supplier order reference
 */
async function sendOrder(orderId, shippingDestination, items, options = {}) {
  // Validate everything locally BEFORE any CJ network request.
  // A malformed order must fail closed without even authenticating with CJ.
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error(`CJ order #${orderId} has no items`);
  }

  if (!shippingDestination || typeof shippingDestination !== 'object') {
    throw new Error(`CJ shipping destination missing for order #${orderId}`);
  }

  const supplierOrderNumber =
    String(options.orderNumber || orderId).trim();

  if (!supplierOrderNumber) {
    throw new Error(`CJ custom order number missing for order #${orderId}`);
  }

  if (supplierOrderNumber.length > 50) {
    throw new Error(`CJ custom order number too long for order #${orderId}`);
  }

  // Map products to CJ Dropshipping expected schema
  const products = items.map(item => {
    const sku = String(item.printifyVariantId || '').trim();
    const productSpu = String(item.printifyProductId || '').trim();
    const quantity = Number(item.quantity);

    if (!sku) {
      throw new Error(`CJ variant SKU missing for order item ${item.id}`);
    }

    if (productSpu && sku === productSpu) {
      throw new Error(`CJ variant SKU for order item ${item.id} is the product SPU, not a variant SKU`);
    }

    if (!Number.isInteger(quantity) || quantity < 1) {
      throw new Error(`Invalid CJ quantity for order item ${item.id}`);
    }

    return {
      sku,
      quantity,
      storeLineItemId: String(item.id)
    };
  });

  const clean = (value) => String(value == null ? '' : value).trim();

  const customerName =
    clean(shippingDestination.customerName) ||
    `${clean(shippingDestination.firstName)} ${clean(shippingDestination.lastName)}`.trim();

  const addressLine1 = clean(shippingDestination.addressLine1);
  const addressLine2 = clean(shippingDestination.addressLine2);
  const city = clean(shippingDestination.city);
  const region = clean(shippingDestination.region);
  const postalCode = clean(shippingDestination.postalCode);
  const phone = clean(shippingDestination.phone);
  const toCountry = clean(shippingDestination.country).toUpperCase();

  if (!customerName) {
    throw new Error(`CJ shipping customer name missing for order #${orderId}`);
  }

  if (!addressLine1) {
    throw new Error(`CJ shipping street address missing for order #${orderId}`);
  }

  if (!city) {
    throw new Error(`CJ shipping city missing for order #${orderId}`);
  }

  if (!postalCode) {
    throw new Error(`CJ shipping postal code missing for order #${orderId}`);
  }

  if (!phone) {
    throw new Error(`CJ shipping phone missing for order #${orderId}`);
  }

  if (!/^[A-Z]{2}$/.test(toCountry)) {
    throw new Error(`CJ shipping country must be a valid 2-letter country code for order #${orderId}`);
  }

  if (['US', 'CA', 'AU'].includes(toCountry) && !region) {
    throw new Error(`CJ shipping region/state missing for order #${orderId}`);
  }

  const shippingAddress = addressLine2
    ? `${addressLine1}, ${addressLine2}`
    : addressLine1;

  const fromCountry = 'CN';

  // Only now, after all local identity/address checks passed,
  // is an external CJ request allowed.
  console.log(`[${SUPPLIER_NAME}] Resolving CJ Access Token for order #${orderId}...`);
  const token = await getCJAccessToken();

  // Resolve shipping carrier method dynamically
  const logisticName = await getLogisticName(token, fromCountry, toCountry, products);

  // Map shipping address fields to CJ expected schema
  const payload = {
    orderNumber: supplierOrderNumber,
    shippingCustomerName: customerName,
    shippingAddress,
    shippingCity: city,
    shippingProvince: region || city,
    shippingCountry: getCountryName(toCountry),
    shippingCountryCode: toCountry,
    shippingZip: postalCode,
    shippingPhone: phone,
    fromCountryCode: fromCountry,
    logisticName: logisticName,
    payType: 3, // Create only (no payment/cart confirmation at creation time)
    products: products
  };

  console.log(`[${SUPPLIER_NAME}] Dispatching order #${orderId} to CJ API...`);

  try {
    const response = await axios.post(
      'https://developers.cjdropshipping.com/api2.0/v1/shopping/order/createOrderV2',
      payload,
      {
        headers: {
          'CJ-Access-Token': token,
          'Content-Type': 'application/json'
        }
      }
    );

    const json = response.data || {};

    if (json.code !== 200 || json.result !== true) {
      const apiError = new Error(
        json.message ||
        `CJ API returned status code ${json.code}`
      );

      if (typeof json.code === 'number') {
        apiError.cjCode = json.code;
      }

      throw apiError;
    }

    const data = json.data || {};
    const ref = String(
      data.orderId ||
      data.cjOrderId ||
      ''
    ).trim();

    if (!ref) {
      const apiError = new Error(
        'CJ create response did not include a supplier order id'
      );

      apiError.code =
        'CJ_ORDER_ID_MISSING_AFTER_CREATE';

      throw apiError;
    }

    // SECURITY: never log the raw API response -- the payload just sent to
    // CJ (above) includes the customer's full name, address, city, zip, and
    // phone number, and an order-creation API response commonly echoes back
    // some or all of what it received to confirm receipt. Only the derived,
    // already-safe `ref` is logged.
    console.log(`[${SUPPLIER_NAME}] ✓ Order #${orderId} submitted successfully to CJ! Ref=${ref}`);
    return { ref };
  } catch (error) {
    // SECURITY: never log or forward the raw response body, or a JSON dump
    // of it, to console or Telegram -- same reasoning as above, and this is
    // the failure path where CJ's own response is most likely to include a
    // validation message that echoes a submitted field verbatim. Only a
    // safe, fixed-shape summary (HTTP status / CJ's own numeric error code)
    // is ever logged or sent.
    const status = error.response && error.response.status;
    const cjCode =
      typeof error.cjCode === 'number'
        ? error.cjCode
        : (
            error.response &&
            error.response.data &&
            typeof error.response.data.code === 'number'
              ? error.response.data.code
              : undefined
          );
    const safeSummary = status
      ? `HTTP_${status}${cjCode !== undefined ? ` (cj_code=${cjCode})` : ''}`
      : (
          cjCode !== undefined
            ? `CJ_${cjCode}`
            : (error.code || 'CJ_CREATE_FAILED')
        );
    console.error(`[${SUPPLIER_NAME}] ✗ Failed to submit order #${orderId} to CJ Dropshipping:`, safeSummary);
    await telegram.notifyError(`CJ Dropshipping Fulfillment (Order #${orderId})`, safeSummary).catch(() => null);

    const wrapped = new Error(
      `CJ Dropshipping order submission failed: ${safeSummary}`
    );

    wrapped.code =
      cjCode !== undefined
        ? `CJ_${cjCode}`
        : (error.code || 'CJ_CREATE_FAILED');

    throw wrapped;
  }
}

/**
 * Resolve an existing CJ order using our deterministic custom order number.
 *
 * CJ's getOrderDetail endpoint accepts either the CJ order id or the
 * merchant/custom order id. No customer PII from the response is logged.
 */
async function findOrderByCustomId(customOrderNumber) {
  const orderNumber = String(customOrderNumber || '').trim();

  if (!orderNumber) {
    return {
      ok: false,
      found: false,
      errorCode: 'CJ_CUSTOM_ORDER_NUMBER_MISSING'
    };
  }

  const token = await getCJAccessToken();

  try {
    const response = await axios.get(
      'https://' + 'developers.cjdropshipping.com/api2.0/v1/shopping/order/getOrderDetail',
      {
        params: {
          orderId: orderNumber
        },
        headers: {
          'CJ-Access-Token': token
        }
      }
    );

    const json = response.data || {};

    if (
      [1600300, 1603100].includes(json.code)
    ) {
      return {
        ok: true,
        found: false
      };
    }

    if (
      json.code !== 200 ||
      json.result !== true ||
      !json.data
    ) {
      return {
        ok: false,
        found: false,
        errorCode: `CJ_${json.code || 'ORDER_LOOKUP_FAILED'}`
      };
    }

    const data = json.data;
    const supplierOrderId = String(
      data.orderId ||
      data.cjOrderId ||
      ''
    ).trim();

    if (!supplierOrderId) {
      return {
        ok: false,
        found: false,
        errorCode: 'CJ_ORDER_ID_MISSING'
      };
    }

    return {
      ok: true,
      found: true,
      order: {
        orderId: supplierOrderId,
        customOrderNumber: String(
          data.orderNumber ||
          data.orderNum ||
          orderNumber
        ),
        status: String(
          data.orderStatus || ''
        ).toUpperCase()
      }
    };

  } catch (error) {
    const cjCode =
      error.response &&
      error.response.data &&
      typeof error.response.data.code === 'number'
        ? error.response.data.code
        : undefined;

    if ([1600300, 1603100].includes(cjCode)) {
      return {
        ok: true,
        found: false
      };
    }

    return {
      ok: false,
      found: false,
      errorCode:
        cjCode !== undefined
          ? `CJ_${cjCode}`
          : (error.code || 'CJ_ORDER_LOOKUP_FAILED')
    };
  }
}

/**
 * Check shipment status for an order reference.
 *
 * @param {string} ref  The supplier order reference (from sendOrder)
 * @returns {Promise<{status: string, trackingNumber: string|null}>}
 */
async function getShipmentStatus(ref) {
  try {
    const token = await getCJAccessToken();
    const response = await axios.get(
      `https://developers.cjdropshipping.com/api2.0/v1/logistic/order/track?cjOrderNumber=${ref}`,
      {
        headers: {
          'CJ-Access-Token': token
        }
      }
    );

    const json = response.data || {};
    if (json.code === 200 && json.result === true) {
      const data = json.data || {};
      return {
        status: data.status || 'processed',
        trackingNumber: data.trackingNumber || null
      };
    }
    return { status: 'unknown', trackingNumber: null };
  } catch (error) {
    console.warn(`[${SUPPLIER_NAME}] Failed to get shipment status for ${ref}:`, error.message);
    return { status: 'unknown', trackingNumber: null };
  }
}

module.exports = {
  sendOrder,
  findOrderByCustomId,
  getShipmentStatus
};
