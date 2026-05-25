/**
 * design-pipeline.js
 * ──────────────────
 * Human-in-the-Loop Printify product creation.
 *
 * Usage flow (driven by /api/admin/design/* endpoints in index.js):
 *   1. createDraftFromImage()  → uploads image, creates Printify draft product,
 *                                 polls until at least one mockup URL is ready.
 *   2. publishDraft()          → tells Printify to publish the draft to the
 *                                 storefront (visible: true). Caller then
 *                                 mirrors it to our local products table.
 *   3. deleteDraft()           → removes the Printify draft on rejection.
 *
 * Env vars consumed:
 *   PRINTIFY_API_TOKEN              — required, the only way Printify auth works.
 *   PRINTIFY_SHOP_ID                — required, the Drip Street shop.
 *   PRINTIFY_TEE_BLUEPRINT_ID       — default 6 (Bella+Canvas 3001).
 *   PRINTIFY_TEE_PRINT_PROVIDER_ID  — default 99 (Printify Choice).
 */

'use strict';

const axios = require('axios');

const BASE_URL = 'https://api.printify.com/v1';
const MOCKUP_POLL_INTERVAL_MS = 4000;
const MOCKUP_TIMEOUT_MS       = 90000; // 90s — Printify usually generates in 30-60s

// Tee pricing rule (must match pricing.js targetPricesILS.softstyle = 149.90)
const TEE_PRICE_ILS = 149.90;

// In-process cache for variants per (blueprint, provider). Catalog rarely changes.
const variantCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const env = (k, fallback) => {
  const v = process.env[k];
  return v && v.trim() ? v.trim() : fallback;
};

const cfg = () => ({
  token:     env('PRINTIFY_API_TOKEN'),
  shopId:    env('PRINTIFY_SHOP_ID'),
  blueprint: parseInt(env('PRINTIFY_TEE_BLUEPRINT_ID', '6'), 10),
  provider:  parseInt(env('PRINTIFY_TEE_PRINT_PROVIDER_ID', '99'), 10),
});

const printifyClient = () => {
  const { token } = cfg();
  if (!token || token === 'YOUR_PRINTIFY_TOKEN') {
    throw new Error('PRINTIFY_API_TOKEN is not configured in Render env.');
  }
  return axios.create({
    baseURL: BASE_URL,
    headers: { Authorization: `Bearer ${token}` },
    timeout: 30000,
  });
};

/** Fetch + cache available variants for a (blueprint, provider) combo. */
const fetchVariants = async (blueprintId, providerId) => {
  const cacheKey = `${blueprintId}:${providerId}`;
  const cached = variantCache.get(cacheKey);
  if (cached && (Date.now() - cached.at) < CACHE_TTL_MS) return cached.variants;

  const client = printifyClient();
  const url = `/catalog/blueprints/${blueprintId}/print_providers/${providerId}/variants.json`;
  const res = await client.get(url);
  const variants = Array.isArray(res.data?.variants) ? res.data.variants : [];
  if (!variants.length) {
    throw new Error(`Printify returned 0 variants for blueprint=${blueprintId} provider=${providerId}. Check IDs.`);
  }
  variantCache.set(cacheKey, { at: Date.now(), variants });
  return variants;
};

/** Pick a manageable subset of variants (default: first 12 enabled). */
const pickDefaultVariants = (allVariants, max = 12) =>
  allVariants
    .filter((v) => v && v.id != null)
    .slice(0, max)
    .map((v) => ({
      id: v.id,
      price: Math.round(TEE_PRICE_ILS * 100), // Printify stores prices in cents.
      is_enabled: true,
    }));

/** Upload a base64-encoded image to Printify's media library. Returns Printify's image id. */
const uploadImage = async (filename, base64Contents) => {
  const client = printifyClient();
  const res = await client.post('/uploads/images.json', {
    file_name: filename,
    contents: base64Contents,
  });
  if (!res.data?.id) {
    throw new Error('Printify image upload returned no id.');
  }
  return res.data; // { id, file_name, height, width, ... }
};

/**
 * Create a draft product wrapping the uploaded image as the front print area.
 * Returns the Printify product object (including the eventually-populated images[]).
 */
const createDraftProduct = async ({ imageId, blueprintId, providerId, title, variants }) => {
  const { shopId } = cfg();
  if (!shopId) throw new Error('PRINTIFY_SHOP_ID is not configured in Render env.');

  const client = printifyClient();
  const payload = {
    title,
    description: `${title} — Drip Street drop. Premium minimal streetwear.`,
    blueprint_id: blueprintId,
    print_provider_id: providerId,
    variants,
    print_areas: [
      {
        variant_ids: variants.map((v) => v.id),
        placeholders: [
          {
            position: 'front',
            images: [
              {
                id: imageId,
                x: 0.5,    // horizontal center (0..1)
                y: 0.45,   // slightly above center — typical chest print
                scale: 1.0,
                angle: 0,
              },
            ],
          },
        ],
      },
    ],
  };

  const res = await client.post(`/shops/${shopId}/products.json`, payload);
  return res.data;
};

/** Get a fresh snapshot of a draft (used while polling for mockups). */
const getProduct = async (printifyProductId) => {
  const { shopId } = cfg();
  const client = printifyClient();
  const res = await client.get(`/shops/${shopId}/products/${printifyProductId}.json`);
  return res.data;
};

/** Returns the first mockup URL once Printify has finished generating it; throws on timeout. */
const waitForMockup = async (printifyProductId) => {
  const start = Date.now();
  while (Date.now() - start < MOCKUP_TIMEOUT_MS) {
    const product = await getProduct(printifyProductId);
    const images = Array.isArray(product.images) ? product.images : [];
    const first = images.find((img) => img && img.src);
    if (first) return { mockupUrl: first.src, product };
    await new Promise((r) => setTimeout(r, MOCKUP_POLL_INTERVAL_MS));
  }
  throw new Error(`Printify mockup generation timed out after ${MOCKUP_TIMEOUT_MS / 1000}s.`);
};

/** Publish the draft to the storefront (also marks it visible in Printify). */
const publishDraft = async (printifyProductId) => {
  const { shopId } = cfg();
  const client = printifyClient();
  // Printify's publish endpoint signals "this is intended for the storefront".
  await client.post(`/shops/${shopId}/products/${printifyProductId}/publish.json`, {
    title: true,
    description: true,
    images: true,
    variants: true,
    tags: true,
    keyFeatures: true,
    shipping_template: true,
  });
  // Acknowledge so it doesn't sit in "publishing" state on Printify's side.
  await client.post(`/shops/${shopId}/products/${printifyProductId}/publishing_succeeded.json`, {
    external: {
      id: String(printifyProductId),
      handle: `https://dripstreetshop.com/product/${printifyProductId}`,
    },
  }).catch(() => null);
};

/** Delete the draft entirely (used when user rejects in Telegram). */
const deleteDraft = async (printifyProductId) => {
  const { shopId } = cfg();
  const client = printifyClient();
  await client.delete(`/shops/${shopId}/products/${printifyProductId}.json`);
};

/**
 * Public entry — full create-draft flow.
 * @param {{imageBase64: string, filename?: string, title?: string}} input
 * @returns {Promise<{
 *   printifyProductId: string,
 *   mockupUrl: string,
 *   blueprintId: number,
 *   printProviderId: number,
 *   priceILS: number,
 *   title: string
 * }>}
 */
const createDraftFromImage = async ({ imageBase64, filename, title }) => {
  if (!imageBase64) throw new Error('imageBase64 is required.');
  const { blueprint, provider } = cfg();

  const safeName = (filename || `design-${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeTitle = (title || `Drip Street drop — ${new Date().toISOString().slice(0, 10)}`).slice(0, 140);

  const variants = await fetchVariants(blueprint, provider).then(pickDefaultVariants);
  const uploaded = await uploadImage(safeName, imageBase64);
  const draft    = await createDraftProduct({
    imageId:     uploaded.id,
    blueprintId: blueprint,
    providerId:  provider,
    title:       safeTitle,
    variants,
  });
  const { mockupUrl } = await waitForMockup(draft.id);

  return {
    printifyProductId: String(draft.id),
    mockupUrl,
    blueprintId:     blueprint,
    printProviderId: provider,
    priceILS:        TEE_PRICE_ILS,
    title:           safeTitle,
  };
};

module.exports = {
  createDraftFromImage,
  publishDraft,
  deleteDraft,
  // exported for completeness / testing
  _internals: { fetchVariants, uploadImage, createDraftProduct, waitForMockup, getProduct },
};
