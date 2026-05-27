'use strict';

const fs = require('fs/promises');
const sharp = require('sharp');

const DEFAULT_OUTPUT_SIZE = Object.freeze({ width: 1600, height: 1600 });
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

function clampUnit(value, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizePositiveInt(value, name) {
  const rounded = Math.round(Number(value));
  if (!Number.isFinite(rounded) || rounded <= 0) {
    throw new Error(`${name} must be a positive number.`);
  }
  return rounded;
}

function normalizeOutputSize(outputSize = DEFAULT_OUTPUT_SIZE) {
  return {
    width: normalizePositiveInt(outputSize.width, 'outputSize.width'),
    height: normalizePositiveInt(outputSize.height, 'outputSize.height'),
  };
}

function normalizePlacement(placement) {
  if (!placement || typeof placement !== 'object') {
    throw new Error('A placement geometry object is required.');
  }

  return {
    top: Math.round(Number(placement.top || 0)),
    left: Math.round(Number(placement.left || 0)),
    width: normalizePositiveInt(placement.width, 'placement.width'),
    height: normalizePositiveInt(placement.height, 'placement.height'),
    fit: placement.fit || 'contain',
    rotation: Number.isFinite(Number(placement.rotation)) ? Number(placement.rotation) : 0,
    opacity: clampUnit(Number(placement.opacity), 1),
  };
}

async function resolveInputBuffer(input, label) {
  if (!input) return null;
  if (Buffer.isBuffer(input)) return input;
  if (typeof input === 'string') return fs.readFile(input);
  throw new Error(`${label} must be a Buffer or file path.`);
}

async function normalizeLayer(layer, outputSize, label) {
  if (!layer) return null;

  const source = layer && typeof layer === 'object' && !Buffer.isBuffer(layer) && layer.input
    ? layer.input
    : layer;
  const fit = layer && typeof layer === 'object' && layer.fit ? layer.fit : 'cover';
  const buffer = await resolveInputBuffer(source, label);

  return sharp(buffer)
    .resize(outputSize.width, outputSize.height, {
      fit,
      background: TRANSPARENT,
      withoutEnlargement: false,
    })
    .png()
    .toBuffer();
}

async function buildDesignLayer(designBuffer, placement, outputSize) {
  const normalizedPlacement = normalizePlacement(placement);

  let preparedDesign = sharp(designBuffer)
    .rotate(normalizedPlacement.rotation, { background: TRANSPARENT })
    .resize(normalizedPlacement.width, normalizedPlacement.height, {
      fit: normalizedPlacement.fit,
      background: TRANSPARENT,
      withoutEnlargement: false,
    })
    .png();

  if (normalizedPlacement.opacity < 1) {
    preparedDesign = preparedDesign.ensureAlpha(normalizedPlacement.opacity);
  }

  const designOverlay = await preparedDesign.toBuffer();

  return sharp({
    create: {
      width: outputSize.width,
      height: outputSize.height,
      channels: 4,
      background: TRANSPARENT,
    },
  })
    .composite([{ input: designOverlay, top: normalizedPlacement.top, left: normalizedPlacement.left, blend: 'over' }])
    .png()
    .toBuffer();
}

function getLayerBlend(layer, fallback) {
  if (!layer || typeof layer !== 'object') return fallback;
  return layer.blend || fallback;
}

class SharpMockupEngine {
  constructor(options = {}) {
    this.defaults = {
      outputSize: normalizeOutputSize(options.outputSize || DEFAULT_OUTPUT_SIZE),
      webp: {
        quality: Number.isFinite(Number(options.webp?.quality)) ? Number(options.webp.quality) : 82,
        effort: Number.isFinite(Number(options.webp?.effort)) ? Number(options.webp.effort) : 6,
        alphaQuality: Number.isFinite(Number(options.webp?.alphaQuality)) ? Number(options.webp.alphaQuality) : 80,
      },
    };
  }

  async compositeMockup({ designBuffer, template, placement, outputSize, webp } = {}) {
    if (!Buffer.isBuffer(designBuffer) || designBuffer.length === 0) {
      throw new Error('designBuffer must be a non-empty Buffer.');
    }
    if (!template || !template.background) {
      throw new Error('template.background is required.');
    }

    const normalizedOutputSize = normalizeOutputSize(outputSize || this.defaults.outputSize);
    const effectiveWebp = {
      quality: Number.isFinite(Number(webp?.quality)) ? Number(webp.quality) : this.defaults.webp.quality,
      effort: Number.isFinite(Number(webp?.effort)) ? Number(webp.effort) : this.defaults.webp.effort,
      alphaQuality: Number.isFinite(Number(webp?.alphaQuality)) ? Number(webp.alphaQuality) : this.defaults.webp.alphaQuality,
    };

    console.info('[MOCKUP_ENGINE] Compositing...', {
      outputWidth: normalizedOutputSize.width,
      outputHeight: normalizedOutputSize.height,
      placement,
    });

    const [backgroundLayer, shadowsLayer, highlightsLayer, designLayer] = await Promise.all([
      normalizeLayer(template.background, normalizedOutputSize, 'template.background'),
      normalizeLayer(template.shadows, normalizedOutputSize, 'template.shadows'),
      normalizeLayer(template.highlights, normalizedOutputSize, 'template.highlights'),
      buildDesignLayer(designBuffer, placement, normalizedOutputSize),
    ]);

    const operations = [{ input: designLayer, blend: 'over' }];
    if (shadowsLayer) {
      operations.push({ input: shadowsLayer, blend: getLayerBlend(template.shadows, 'multiply') });
    }
    if (highlightsLayer) {
      operations.push({ input: highlightsLayer, blend: getLayerBlend(template.highlights, 'screen') });
    }

    const buffer = await sharp(backgroundLayer)
      .composite(operations)
      .webp({
        quality: effectiveWebp.quality,
        effort: effectiveWebp.effort,
        alphaQuality: effectiveWebp.alphaQuality,
        smartSubsample: true,
      })
      .toBuffer();

    console.info('[MOCKUP_ENGINE] Composite complete.', {
      bytes: buffer.length,
      outputWidth: normalizedOutputSize.width,
      outputHeight: normalizedOutputSize.height,
    });

    return {
      buffer,
      width: normalizedOutputSize.width,
      height: normalizedOutputSize.height,
      format: 'webp',
      contentType: 'image/webp',
    };
  }

  async compositeMockupSafe(options) {
    try {
      const result = await this.compositeMockup(options);
      return { ok: true, ...result };
    } catch (error) {
      console.error(`[MOCKUP_ENGINE] Composite failed: ${error.message}`);
      return { ok: false, error };
    }
  }
}

module.exports = {
  SharpMockupEngine,
  normalizeOutputSize,
  normalizePlacement,
};