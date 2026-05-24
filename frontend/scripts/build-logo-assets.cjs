#!/usr/bin/env node
/**
 * build-logo-assets.js
 *
 * Rasterizes the canonical SVG logos in /public into the PNG / WebP variants
 * required by social platforms, browsers, iOS, and Android PWA installs.
 *
 * Sources (all already in /public):
 *   - logo.svg          (800×220, horizontal: icon + wordmark + tagline)
 *   - logo-vertical.svg (512×512, stacked: icon above wordmark)
 *   - logo-icon.svg     (512×512, icon-only DS monogram)
 *
 * Outputs (overwrites the bad screenshot PNGs in /public):
 *   - logo.png                       1200×630  — og:image (Facebook, WhatsApp, LinkedIn)
 *   - logo.webp                      1200×630  — modern OG fallback
 *   - logo-square.png                1200×1200 — Instagram / Twitter summary
 *   - apple-touch-icon.png             180×180 — iOS home screen
 *   - android-chrome-192x192.png       192×192 — Android PWA
 *   - android-chrome-512x512.png       512×512 — Android PWA / splash
 *
 * Run from the `frontend` folder:
 *   npm install --save-dev sharp
 *   node scripts/build-logo-assets.js
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const PUBLIC_DIR = path.resolve(__dirname, '..', 'public');

// Brand-black background for OG/social cards. Matches the site's dark theme.
const BRAND_BLACK = { r: 0, g: 0, b: 0, alpha: 1 };

const readSvg = (filename) => {
  const p = path.join(PUBLIC_DIR, filename);
  if (!fs.existsSync(p)) throw new Error(`Source SVG not found: ${p}`);
  return fs.readFileSync(p);
};

/**
 * Render an SVG centered on a solid-black canvas of the given size.
 * `paddingRatio` = fraction of canvas reserved as breathing room around the logo.
 */
const renderOnBlack = async (svgBuffer, canvasW, canvasH, paddingRatio = 0.10) => {
  const innerW = Math.round(canvasW * (1 - paddingRatio * 2));
  const innerH = Math.round(canvasH * (1 - paddingRatio * 2));

  // Pre-render the SVG at high density so the final raster stays crisp.
  const logoBuf = await sharp(svgBuffer, { density: 384 })
    .resize(innerW, innerH, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();

  return sharp({
    create: {
      width: canvasW,
      height: canvasH,
      channels: 4,
      background: BRAND_BLACK,
    },
  }).composite([{ input: logoBuf, gravity: 'center' }]);
};

/** Direct rasterization of an SVG that already includes its own background. */
const renderDirect = async (svgBuffer, size) =>
  sharp(svgBuffer, { density: 384 }).resize(size, size, { fit: 'contain' });

const writePng = (pipeline, outPath) =>
  pipeline
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(outPath)
    .then(() => console.log(`  ✓ ${path.basename(outPath)}`));

const writeWebp = (pipeline, outPath) =>
  pipeline
    .webp({ quality: 92, effort: 6 })
    .toFile(outPath)
    .then(() => console.log(`  ✓ ${path.basename(outPath)}`));

const main = async () => {
  console.log(`\nBuilding logo assets from: ${PUBLIC_DIR}\n`);

  const logoSvg = readSvg('logo.svg');
  const verticalSvg = readSvg('logo-vertical.svg');
  const iconSvg = readSvg('logo-icon.svg');

  // ── 1. OG image (1200×630) — horizontal layout, ~10% padding ──
  console.log('OG / social share images:');
  const og = await renderOnBlack(logoSvg, 1200, 630, 0.10);
  await writePng(og.clone(), path.join(PUBLIC_DIR, 'logo.png'));
  await writeWebp(og.clone(), path.join(PUBLIC_DIR, 'logo.webp'));

  // ── 2. Social square (1200×1200) — vertical stacked layout ──
  console.log('\nSquare social card:');
  const square = await renderOnBlack(verticalSvg, 1200, 1200, 0.12);
  await writePng(square.clone(), path.join(PUBLIC_DIR, 'logo-square.png'));

  // ── 3. Apple touch icon (180×180) ──
  console.log('\nFavicons / PWA icons:');
  await writePng(
    await renderDirect(iconSvg, 180),
    path.join(PUBLIC_DIR, 'apple-touch-icon.png')
  );

  // ── 4. Android Chrome 192×192 ──
  await writePng(
    await renderDirect(iconSvg, 192),
    path.join(PUBLIC_DIR, 'android-chrome-192x192.png')
  );

  // ── 5. Android Chrome 512×512 ──
  await writePng(
    await renderDirect(iconSvg, 512),
    path.join(PUBLIC_DIR, 'android-chrome-512x512.png')
  );

  console.log('\nAll assets written to /public.');
  console.log('Next: commit, push, and Vercel will redeploy automatically.\n');
};

main().catch((err) => {
  console.error('\nbuild-logo-assets failed:', err.message);
  process.exit(1);
});
