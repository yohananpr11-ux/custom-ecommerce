'use strict';

const { v2: cloudinary } = require('cloudinary');

function normalizeSegment(value, fallback) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');

  return normalized || fallback;
}

function buildMockupPublicId(productSlug, view) {
  const safeSlug = normalizeSegment(productSlug, 'untitled-product');
  const safeView = normalizeSegment(view, 'front');
  return `dripstreet/mockups/${safeSlug}/${safeView}`;
}

function serializeContext(context = {}) {
  return Object.entries(context).reduce((accumulator, [key, value]) => {
    if (value === undefined || value === null || value === '') {
      return accumulator;
    }

    accumulator[key] = String(value);
    return accumulator;
  }, {});
}

function isTransientError(error) {
  const message = String(error?.message || error || '');
  return /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|50[234]|timeout|rate.?limit|temporarily|unavailable/i.test(message);
}

async function retry(operation, options = {}) {
  const maxAttempts = options.maxAttempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 300;
  const maxDelayMs = options.maxDelayMs ?? 2500;

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts || !isTransientError(error)) {
        throw error;
      }

      const jitter = Math.random() * baseDelayMs;
      const delayMs = Math.min(baseDelayMs * (2 ** (attempt - 1)) + jitter, maxDelayMs);
      console.warn('[STORAGE] Cloudinary upload retry scheduled.', {
        attempt,
        delayMs,
        error: error.message,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

class CloudinaryUploader {
  constructor(options = {}) {
    this.cloudinaryUrl = options.cloudinaryUrl || process.env.CLOUDINARY_URL || '';
    this.defaultTags = Array.isArray(options.defaultTags)
      ? options.defaultTags.filter(Boolean)
      : ['dripstreet', 'custom-mockup'];

    if (this.cloudinaryUrl) {
      process.env.CLOUDINARY_URL = this.cloudinaryUrl;
      cloudinary.config({ secure: true });
    }
  }

  isConfigured() {
    return Boolean(this.cloudinaryUrl);
  }

  ensureConfigured() {
    if (!this.isConfigured()) {
      throw new Error('CLOUDINARY_URL is not configured.');
    }
  }

  async uploadMockup({ buffer, productSlug, view, tags = [], context = {}, invalidate = true } = {}) {
    this.ensureConfigured();

    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
      throw new Error('A non-empty WebP buffer is required for Cloudinary upload.');
    }

    const publicId = buildMockupPublicId(productSlug, view);
    const safeTags = [...this.defaultTags, ...tags].filter(Boolean);
    const safeContext = serializeContext(context);

    console.info('[STORAGE] Uploading to Cloudinary...', {
      productSlug: normalizeSegment(productSlug, 'untitled-product'),
      view: normalizeSegment(view, 'front'),
      publicId,
      bytes: buffer.length,
    });

    const result = await retry(() => this._uploadBuffer(buffer, {
      publicId,
      tags: safeTags,
      context: safeContext,
      invalidate,
    }));

    console.info('[STORAGE] Upload complete.', {
      publicId,
      url: result.secure_url,
      bytes: result.bytes,
      version: result.version,
    });

    return {
      publicId,
      url: result.secure_url,
      width: result.width,
      height: result.height,
      bytes: result.bytes,
      format: result.format,
      version: result.version,
    };
  }

  _uploadBuffer(buffer, { publicId, tags, context, invalidate }) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          public_id: publicId,
          resource_type: 'image',
          overwrite: true,
          invalidate,
          unique_filename: false,
          use_filename: false,
          format: 'webp',
          tags,
          context,
        },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        }
      );

      stream.on('error', reject);
      stream.end(buffer);
    });
  }
}

module.exports = {
  CloudinaryUploader,
  buildMockupPublicId,
  normalizeSegment,
};