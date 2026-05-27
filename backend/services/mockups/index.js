'use strict';

const crypto = require('crypto');
const path = require('path');

const { CloudinaryUploader, normalizeSegment } = require('./cloudinary-uploader');
const { SharpMockupEngine } = require('./sharp-mockup-engine');

function parseGeometry(view) {
  const envKey = view === 'back' ? 'MOCKUP_BACK_GEOMETRY_JSON' : 'MOCKUP_FRONT_GEOMETRY_JSON';
  const raw = process.env[envKey];
  if (!raw) {
    throw new Error(`${envKey} is not configured.`);
  }

  try {
    return JSON.parse(raw);
  } catch (error) {
    throw new Error(`${envKey} must be valid JSON.`);
  }
}

function getTemplateConfig(view) {
  const upperView = view === 'back' ? 'BACK' : 'FRONT';
  const background = process.env[`MOCKUP_TEMPLATE_${upperView}_BACKGROUND`];
  const shadows = process.env[`MOCKUP_TEMPLATE_${upperView}_SHADOWS`];
  const highlights = process.env[`MOCKUP_TEMPLATE_${upperView}_HIGHLIGHTS`];

  if (!background || !shadows || !highlights) {
    throw new Error(`Mockup template env vars are incomplete for view='${view}'.`);
  }

  return {
    background,
    shadows: { input: shadows, blend: 'multiply' },
    highlights: { input: highlights, blend: 'screen' },
  };
}

function decodeBase64Image(imageBase64) {
  const cleanBase64 = String(imageBase64 || '').includes(',')
    ? String(imageBase64).split(',', 2)[1]
    : String(imageBase64 || '');

  const buffer = Buffer.from(cleanBase64, 'base64');
  if (!buffer.length) {
    throw new Error('imageBase64 did not decode into image bytes.');
  }
  return buffer;
}

function getProductSlug({ title, filename, imageBase64, placement }) {
  const preferred = String(title || '').trim() || path.parse(String(filename || '')).name;
  if (preferred) {
    return normalizeSegment(preferred, `design-${placement}`);
  }

  const digest = crypto.createHash('sha1').update(String(imageBase64 || '')).digest('hex').slice(0, 12);
  return `design-${digest}-${placement}`;
}

async function createApprovalMockup({ imageBase64, filename, title, placement = 'front' } = {}) {
  const view = placement === 'back' ? 'back' : 'front';
  const productSlug = getProductSlug({ title, filename, imageBase64, placement: view });
  const designBuffer = decodeBase64Image(imageBase64);
  const template = getTemplateConfig(view);
  const geometry = parseGeometry(view);

  const engine = new SharpMockupEngine();
  const uploadClient = new CloudinaryUploader();

  const composite = await engine.compositeMockupSafe({
    designBuffer,
    template,
    placement: geometry,
  });

  if (!composite.ok) {
    throw composite.error;
  }

  const uploaded = await uploadClient.uploadMockup({
    buffer: composite.buffer,
    productSlug,
    view,
    tags: ['approval-preview'],
    context: {
      placement: view,
      title: String(title || '').trim() || productSlug,
    },
  });

  return {
    ...uploaded,
    productSlug,
    view,
    isCustomMockup: true,
  };
}

module.exports = {
  createApprovalMockup,
  CloudinaryUploader,
  SharpMockupEngine,
};