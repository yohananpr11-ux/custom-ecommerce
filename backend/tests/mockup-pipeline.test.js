const test = require('node:test');
const assert = require('node:assert/strict');

const sharp = require('sharp');

const { CloudinaryUploader } = require('../services/mockups/cloudinary-uploader');
const { SharpMockupEngine } = require('../services/mockups/sharp-mockup-engine');

async function createSolidImage(width, height, color) {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: color,
    },
  }).png().toBuffer();
}

function getPixel(rawBuffer, width, x, y) {
  const index = (y * width + x) * 4;
  return {
    r: rawBuffer[index],
    g: rawBuffer[index + 1],
    b: rawBuffer[index + 2],
    a: rawBuffer[index + 3],
  };
}

test('CloudinaryUploader fails fast when CLOUDINARY_URL is missing', async () => {
  const uploader = new CloudinaryUploader({ cloudinaryUrl: '' });
  await assert.rejects(
    () => uploader.uploadMockup({
      buffer: Buffer.from('fake-webp'),
      productSlug: 'tokyo-neon-tee',
      view: 'front',
    }),
    /CLOUDINARY_URL is not configured/
  );
});

test('SharpMockupEngine composites a design into a 1600x1600 webp', async () => {
  const engine = new SharpMockupEngine();

  const background = await createSolidImage(1600, 1600, { r: 245, g: 245, b: 245, alpha: 1 });
  const shadows = await createSolidImage(1600, 1600, { r: 0, g: 0, b: 0, alpha: 0.12 });
  const highlights = await sharp({
    create: {
      width: 1600,
      height: 1600,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: await createSolidImage(700, 220, { r: 255, g: 255, b: 255, alpha: 0.18 }),
        left: 450,
        top: 350,
        blend: 'screen',
      },
    ])
    .png()
    .toBuffer();
  const design = await createSolidImage(900, 900, { r: 220, g: 20, b: 60, alpha: 1 });

  const result = await engine.compositeMockup({
    designBuffer: design,
    template: {
      background,
      shadows: { input: shadows, blend: 'multiply' },
      highlights: { input: highlights, blend: 'screen' },
    },
    placement: {
      top: 350,
      left: 350,
      width: 900,
      height: 900,
      fit: 'contain',
    },
  });

  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 1600);
  assert.equal(metadata.format, 'webp');

  const { data, info } = await sharp(result.buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const designPixel = getPixel(data, info.width, 800, 800);
  const backgroundPixel = getPixel(data, info.width, 80, 80);

  assert.ok(designPixel.r > designPixel.g);
  assert.ok(designPixel.r > designPixel.b);
  assert.ok(backgroundPixel.r >= 200);
  assert.ok(result.buffer.length > 0);
});