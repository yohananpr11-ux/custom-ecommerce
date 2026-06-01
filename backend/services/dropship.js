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
  const cleanCode = String(code || 'IL').trim().toUpperCase();
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
    const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error('❌ CJ Dropshipping authentication failed:', errMsg);
    throw new Error(`CJ Dropshipping authentication failed: ${errMsg}`);
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
async function getLogisticName(token, fromCountry, toCountry, products) {
  try {
    const payload = {
      startCountryCode: fromCountry,
      endCountryCode: toCountry,
      products: products.map(p => ({
        sku: p.sku,
        quantity: p.quantity
      }))
    };

    console.log(`[${SUPPLIER_NAME}] Querying CJ Freight Calculation (origin=${fromCountry}, dest=${toCountry})...`);
    const response = await axios.post(
      'https://developers.cjdropshipping.com/api2.0/v1/logistic/freightCalculate',
      payload,
      {
        headers: {
          'CJ-Access-Token': token,
          'Content-Type': 'application/json'
        }
      }
    );

    const json = response.data || {};
    if (json.code === 200 && Array.isArray(json.data) && json.data.length > 0) {
      // Pick the first available carrier method (often the most standard/cost-effective)
      const chosen = json.data[0].logisticName;
      console.log(`[${SUPPLIER_NAME}] Dynamic shipping carrier selected: "${chosen}"`);
      return chosen;
    }

    console.warn(`[${SUPPLIER_NAME}] Freight API returned no options: ${JSON.stringify(json)}. Using standard fallback.`);
  } catch (error) {
    console.warn(`[${SUPPLIER_NAME}] Freight calculation call failed, using default fallback:`, error.message);
  }

  // Fallback to a highly common standard shipping carrier
  return 'CJ Packet Sensitive';
}

/**
 * Send a group of order items to the CJ Dropshipping API.
 *
 * @param {number}   orderId              Internal Drip Street order ID
 * @param {object}   shippingDestination  { firstName, lastName, customerName, customerEmail, phone, addressLine1, addressLine2, city, region, postalCode, country }
 * @param {Array}    items                order_items rows (supplier_id='dropship')
 * @returns {Promise<{ref: string}>}      Supplier order reference
 */
async function sendOrder(orderId, shippingDestination, items) {
  console.log(`[${SUPPLIER_NAME}] Resolving CJ Access Token for order #${orderId}...`);
  const token = await getCJAccessToken();
  // Map products to CJ Dropshipping expected schema
  const products = items.map(item => {
    const sku = item.sku || item.printifyVariantId || item.printifyProductId || 'CJLX222053101AZ';
    return {
      sku: sku,
      quantity: Number(item.quantity) || 1,
      storeLineItemId: String(item.id)
    };
  });

  const fromCountry = 'CN';
  const toCountry = (shippingDestination.country || 'IL').toUpperCase();

  // Resolve shipping carrier method dynamically
  const logisticName = await getLogisticName(token, fromCountry, toCountry, products);

  // Map shipping address fields to CJ expected schema
  const payload = {
    orderNumber: String(orderId),
    shippingCustomerName: shippingDestination.customerName || `${shippingDestination.firstName || ''} ${shippingDestination.lastName || ''}`.trim() || 'Customer',
    shippingAddress: shippingDestination.addressLine2
      ? `${shippingDestination.addressLine1}, ${shippingDestination.addressLine2}`
      : shippingDestination.addressLine1 || 'N/A',
    shippingCity: shippingDestination.city || 'N/A',
    shippingProvince: shippingDestination.region || shippingDestination.city || 'N/A',
    shippingCountry: getCountryName(toCountry),
    shippingCountryCode: toCountry,
    shippingZip: shippingDestination.postalCode || '00000',
    shippingPhone: shippingDestination.phone || '0000000000',
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
    if (json.code !== 200 && json.result !== true) {
      throw new Error(json.message || `CJ API returned status code ${json.code}`);
    }

    const resultObj = json.result || json.data || {};
    const ref = resultObj.orderNumber || resultObj.cjOrderNumber || json.orderNumber || `CJ-${orderId}`;

    console.log(`[${SUPPLIER_NAME}] Raw API Response:`, JSON.stringify(json));
    console.log(`[${SUPPLIER_NAME}] ✓ Order #${orderId} submitted successfully to CJ! Ref=${ref}`);
    return { ref };
  } catch (error) {
    const errMsg = error.response ? JSON.stringify(error.response.data) : error.message;
    console.error(`[${SUPPLIER_NAME}] ✗ Failed to submit order #${orderId} to CJ Dropshipping:`, errMsg);
    await telegram.notifyError(`CJ Dropshipping Fulfillment (Order #${orderId})`, errMsg).catch(() => null);
    throw new Error(`CJ Dropshipping order submission failed: ${errMsg}`);
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

module.exports = { sendOrder, getShipmentStatus };
