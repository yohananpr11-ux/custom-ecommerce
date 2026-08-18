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
 *   PRINTIFY_SHOP_ID                — required, the JONO shop.
 *   PRINTIFY_TEE_BLUEPRINT_ID       — default 6 (Bella+Canvas 3001).
 *   PRINTIFY_TEE_PRINT_PROVIDER_ID  — default 99 (Printify Choice).
 */

'use strict';

const axios = require('axios');

const BASE_URL = 'https://api.printify.com/v1';
const MOCKUP_POLL_INTERVAL_MS = 4000;
const MOCKUP_TIMEOUT_MS       = 180000; // 180s — Printify usually generates in 30-60s but occasionally takes >90s under load

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

// Curated lists per JONO brand book. Variants outside these are skipped.
const ALLOWED_SIZES = new Set(['S', 'M', 'L', 'XL', '2XL', 'XXL']);
const ALLOWED_COLOR_KEYWORDS = ['black', 'white', 'heather grey', 'heather gray', 'athletic heather', 'navy', 'heather navy'];

/** Match a variant by its title (e.g. "White / S" or "S / Athletic Heather"). */
const variantMatchesCuratedSet = (v) => {
  const title = String(v?.title || '');
  if (!title) return false;
  const parts = title.split('/').map((s) => s.trim());
  const hasAllowedSize = parts.some((p) => ALLOWED_SIZES.has(p.toUpperCase()));
  const hasAllowedColor = parts.some((p) => {
    const lower = p.toLowerCase();
    return ALLOWED_COLOR_KEYWORDS.some((kw) => lower === kw || lower.includes(kw));
  });
  return hasAllowedSize && hasAllowedColor;
};

/**
 * Pick variants curated to JONO's brand: sizes S-2XL × colors
 * Black/White/Heather Grey/Navy. Falls back to first N if curation
 * produces zero matches (so we never crash a draft just because a
 * provider uses unusual labels).
 */
const pickDefaultVariants = (allVariants, max = 20) => {
  const safe = (allVariants || []).filter((v) => v && v.id != null);
  let chosen = safe.filter(variantMatchesCuratedSet);
  if (!chosen.length) {
    console.warn(`[design] no variants matched the curated set — falling back to first ${max}.`);
    chosen = safe.slice(0, max);
  } else {
    chosen = chosen.slice(0, max);
  }
  return chosen.map((v) => ({
    id: v.id,
    price: Math.round(TEE_PRICE_ILS * 100), // Printify stores prices in cents.
    is_enabled: true,
  }));
};

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

/** Upload an image from a public URL (Printify fetches it directly). */
const uploadImageFromUrl = async (filename, sourceUrl) => {
  const client = printifyClient();
  const res = await client.post('/uploads/images.json', {
    file_name: filename,
    url: sourceUrl,
  });
  if (!res.data?.id) {
    throw new Error(`Printify upload-from-url returned no id (source: ${sourceUrl}).`);
  }
  return res.data;
};

// JONO neck label asset: 750x750 300 DPI DTF transparent background monogram.
// Asset ID in Printify library: 6a72e86f376cb40ed1f472c2.
const PRINTIFY_NECK_LABEL_IMAGE_ID = env('PRINTIFY_NECK_LABEL_IMAGE_ID', '6a72e86f376cb40ed1f472c2');
const NECK_LABEL_SOURCE_URL = env(
  'NECK_LABEL_SOURCE_URL',
  'https://raw.githubusercontent.com/yohananpr11-ux/custom-ecommerce/main/frontend/public/jono-logo-transparent.png'
);
let neckLabelImageIdCache = null;

const ensureNeckLabelImageId = async () => {
  if (PRINTIFY_NECK_LABEL_IMAGE_ID) return PRINTIFY_NECK_LABEL_IMAGE_ID;
  if (neckLabelImageIdCache) return neckLabelImageIdCache;
  try {
    // Validate that NECK_LABEL_SOURCE_URL returns an image before attempting upload
    const headRes = await axios.head(NECK_LABEL_SOURCE_URL, { timeout: 10000 });
    const contentType = headRes.headers['content-type'] || '';
    if (contentType.includes('text/html')) {
      throw new Error(`NECK_LABEL_SOURCE_URL returned non-image content-type (${contentType}). Image required.`);
    }

    const uploaded = await uploadImageFromUrl('jono-neck-label.png', NECK_LABEL_SOURCE_URL);
    neckLabelImageIdCache = uploaded.id;
    return neckLabelImageIdCache;
  } catch (err) {
    console.warn(`[design] failed to upload neck label, will skip on this draft: ${err.message}`);
    return null;
  }
};

/**
 * Create a draft product. `placement` controls where the customer's image lands:
 *   'front' — chest-centered (default)
 *   'back'  — back-centered, slightly higher
 * If a neck label image ID is provided, it's added as a small print on the
 * inside neck (constant JONO branding on every shirt).
 */
const createDraftProduct = async ({
  imageId,
  blueprintId,
  providerId,
  title,
  variants,
  placement = 'front',
  neckLabelImageId = null,
}) => {
  const { shopId } = cfg();
  if (!shopId) throw new Error('PRINTIFY_SHOP_ID is not configured in Render env.');

  const variantIds = variants.map((v) => v.id);

  // Customer's image — placed on the selected side.
  const customerPlaceholder = {
    position: placement === 'back' ? 'back' : 'front',
    images: [
      {
        id: imageId,
        x: 0.5,
        y: placement === 'back' ? 0.38 : 0.45, // back prints look better slightly higher
        scale: 1.0,
        angle: 0,
      },
    ],
  };

  const placeholders = [customerPlaceholder];

  // Optional neck label — JONO logo on the inside of the collar.
  // Printify position name for Bella+Canvas 3001 (Blueprint 6) is 'inner_neck'.
  if (neckLabelImageId) {
    placeholders.push({
      position: 'inner_neck',
      images: [
        {
          id: neckLabelImageId,
          x: 0.5,
          y: 0.5,
          scale: 0.5, // small — fits inside-collar print area
          angle: 0,
        },
      ],
    });
  }

  const client = printifyClient();
  const payload = {
    title,
    description: `${title} — JONO drop. Premium minimal streetwear.`,
    blueprint_id: blueprintId,
    print_provider_id: providerId,
    variants,
    print_areas: [
      { variant_ids: variantIds, placeholders },
    ],
  };

  try {
    const res = await client.post(`/shops/${shopId}/products.json`, payload);
    return res.data;
  } catch (err) {
    // Printify rejects unsupported placeholders with a 4xx (seen as 400 and 422
    // in the wild) and the offending text can live under `message`, `error`,
    // `errors`, or the raw body. Stringify the whole payload so the fallback
    // triggers regardless of which key Printify used this time.
    const status = err?.response?.status;
    const data   = err?.response?.data;
    const haystack = [
      data?.message,
      data?.error,
      typeof data?.errors === 'string' ? data.errors : JSON.stringify(data?.errors || ''),
      err?.message,
      (() => { try { return JSON.stringify(data); } catch { return ''; } })(),
    ].filter(Boolean).join(' | ');

    const isNeckLabelIssue = /neck[_\s-]?label|inner[_\s-]?neck/i.test(haystack);
    const isPlaceholderIssue = /placeholder|position|invalid/i.test(haystack);
    const isRetryableStatus = status === 400 || status === 422;

    if (neckLabelImageId && isRetryableStatus && (isNeckLabelIssue || isPlaceholderIssue)) {
      console.warn(`[design] neck_label rejected by Printify (status=${status}), retrying without it: ${haystack}`);
      const fallbackPayload = {
        ...payload,
        print_areas: [{ variant_ids: variantIds, placeholders: [customerPlaceholder] }],
      };
      try {
        const res = await client.post(`/shops/${shopId}/products.json`, fallbackPayload);
        return res.data;
      } catch (retryErr) {
        const retryStatus = retryErr?.response?.status;
        const retryBody   = retryErr?.response?.data;
        console.error(`[design] fallback (no neck_label) also failed: status=${retryStatus}`, retryBody);
        throw retryErr;
      }
    }
    throw err;
  }
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
      handle: `https://shopjono.com/product/${printifyProductId}`,
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
const createDraftFromImage = async ({ imageBase64, filename, title, placement = 'front', blueprintId, providerId }) => {
  if (!imageBase64) throw new Error('imageBase64 is required.');
  const defaultCfg = cfg();
  const blueprint = blueprintId ? parseInt(blueprintId, 10) : defaultCfg.blueprint;
  const provider  = providerId ? parseInt(providerId, 10) : defaultCfg.provider;

  const safeName = (filename || `design-${Date.now()}.png`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const safeTitle = (title || `JONO drop — ${new Date().toISOString().slice(0, 10)}`).slice(0, 140);
  const safePlacement = (placement === 'back') ? 'back' : 'front';

  // Fetch variants, customer image, AND the cached neck label in parallel
  // — cuts ~1s off cold draft creation.
  const [variants, uploaded, neckLabelImageId] = await Promise.all([
    fetchVariants(blueprint, provider).then(pickDefaultVariants),
    uploadImage(safeName, imageBase64),
    ensureNeckLabelImageId(),
  ]);

  const draft = await createDraftProduct({
    imageId:          uploaded.id,
    blueprintId:      blueprint,
    providerId:       provider,
    title:            safeTitle,
    variants,
    placement:        safePlacement,
    neckLabelImageId, // null if upload failed — handled inside createDraftProduct
  });
  const { mockupUrl } = await waitForMockup(draft.id);

  return {
    printifyProductId: String(draft.id),
    mockupUrl,
    blueprintId:     blueprint,
    printProviderId: provider,
    priceILS:        TEE_PRICE_ILS,
    title:           safeTitle,
    placement:       safePlacement,
    variantCount:    variants.length,
    hasNeckLabel:    Boolean(neckLabelImageId),
  };
};

module.exports = {
  createDraftFromImage,
  publishDraft,
  deleteDraft,
  // exported for completeness / testing
  _internals: { fetchVariants, uploadImage, createDraftProduct, waitForMockup, getProduct },
};
