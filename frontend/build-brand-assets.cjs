/**
 * build-brand-assets.cjs
 * ──────────────────────
 * Drip Street brand asset pipeline.
 * Source: public/brand/drip-mark.png
 *
 * Outputs (all written to public/brand/generated/):
 *   favicon-16.png   — browser tab favicon (16×16)
 *   favicon-32.png   — HiDPI favicon      (32×32)
 *   favicon-48.png   — Windows taskbar    (48×48)
 *   apple-touch-icon.png — iOS home screen (180×180)
 *   android-192.png  — PWA icon           (192×192)
 *   android-512.png  — PWA splash         (512×512)
 *   og-image.png     — Open Graph share   (1200×630, D centred on dark bg)
 *
 * Usage:  node build-brand-assets.cjs
 * Requires: sharp (already in devDependencies)
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const sharp = require('sharp');

const SRC   = path.join(__dirname, 'public', 'brand', 'drip-mark.png');
const OUT   = path.join(__dirname, 'public', 'brand', 'generated');

if (!fs.existsSync(SRC)) {
  console.error(`[brand-assets] Source not found: ${SRC}`);
  process.exit(1);
}

fs.mkdirSync(OUT, { recursive: true });

/** Square icon variant */
async function icon(size, name) {
  const dest = path.join(OUT, name);
  await sharp(SRC)
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(dest);
  const kb = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`  ✓  ${name.padEnd(26)} ${size}×${size}  (${kb} KB)`);
}

/** Open-Graph banner: 1200×630 with the D mark centred on a rich dark background */
async function ogImage() {
  const dest = path.join(OUT, 'og-image.png');
  const W = 1200, H = 630;
  const MARK_H = 380; // height of the D inside the banner

  // Resize mark preserving aspect ratio
  const markBuf = await sharp(SRC)
    .resize(null, MARK_H, { fit: 'inside', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const markMeta = await sharp(markBuf).metadata();
  const left = Math.round((W - markMeta.width) / 2);
  const top  = Math.round((H - markMeta.height) / 2);

  await sharp({
    create: {
      width: W, height: H, channels: 4,
      background: { r: 10, g: 10, b: 10, alpha: 1 }
    }
  })
    .composite([{ input: markBuf, left, top }])
    .png({ compressionLevel: 8 })
    .toFile(dest);

  const kb = (fs.statSync(dest).size / 1024).toFixed(1);
  console.log(`  ✓  og-image.png               1200×630  (${kb} KB)`);
}

async function main() {
  console.log('\n[Drip Street] Building brand assets from drip-mark.png …\n');

  await Promise.all([
    icon(16,  'favicon-16.png'),
    icon(32,  'favicon-32.png'),
    icon(48,  'favicon-48.png'),
    icon(180, 'apple-touch-icon.png'),
    icon(192, 'android-192.png'),
    icon(512, 'android-512.png'),
    ogImage(),
  ]);

  console.log(`\n  All assets written to:\n  ${OUT}\n`);
}

main().catch((err) => {
  console.error('[brand-assets] Build failed:', err.message);
  process.exit(1);
});
