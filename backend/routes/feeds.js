const express = require('express');
const router = express.Router();
const db = require('../db');

// Promise-based helper to run SQLite queries
const dbAllAsync = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// XML Entity Escaper
const esc = (v) => String(v == null ? '' : v)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// URL absolute-izer
const getAbsoluteUrl = (url) => {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `https://dripstreetshop.com${url.startsWith('/') ? '' : '/'}${url}`;
};

/**
 * GET /api/feed/google
 * Exposes a Google Merchant Center & Facebook Commerce compatible RSS 2.0 XML feed
 */
router.get('/google', async (req, res) => {
  try {
    // 1. Fetch all visible products (preferring printify items if they exist)
    const allProducts = await dbAllAsync("SELECT id, title, description, price, imageUrl, backImageUrl, type, printifyId FROM products");
    const hasPrintifyProducts = allProducts.some(r => r.type === 'printify');
    const products = hasPrintifyProducts ? allProducts.filter(r => r.type === 'printify') : allProducts;

    let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
    xml += `<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n`;
    xml += `  <channel>\n`;
    xml += `    <title>Drip Street Shop</title>\n`;
    xml += `    <link>https://dripstreetshop.com</link>\n`;
    xml += `    <description>Premium minimalist streetwear built for confidence. oversized tees, summer tanks, and high-quality basics.</description>\n`;

    // 2. Query variants for each product and build items
    for (const product of products) {
      const variants = await dbAllAsync(
        "SELECT * FROM product_variants WHERE productId = ? AND isEnabled = 1",
        [product.id]
      );

      const link = `https://dripstreetshop.com/product/${product.id}`;

      if (variants && variants.length > 0) {
        // Expose each enabled variant as a distinct feed item grouped by item_group_id
        for (const variant of variants) {
          const variantId = `${product.id}_${variant.id}`;
          const title = `${product.title} - ${variant.color || ''} (${variant.size || ''})`;
          
          // Image: variant specific image -> parent image -> back image -> fallback
          const imageLink = getAbsoluteUrl(variant.imageUrl || product.imageUrl || product.backImageUrl || '');
          const availability = (variant.isAvailable !== 0 && (variant.stockQty === null || variant.stockQty > 0)) 
            ? 'in stock' 
            : 'out of stock';
          
          const price = Number(variant.price || product.price);

          xml += `    <item>\n`;
          xml += `      <g:id>${esc(variantId)}</g:id>\n`;
          xml += `      <g:item_group_id>product_${esc(product.id)}</g:item_group_id>\n`;
          xml += `      <title>${esc(title)}</title>\n`;
          xml += `      <description>${esc(product.description || title)}</description>\n`;
          xml += `      <link>${esc(link)}</link>\n`;
          xml += `      <g:image_link>${esc(imageLink)}</g:image_link>\n`;
          xml += `      <g:condition>new</g:condition>\n`;
          xml += `      <g:availability>${esc(availability)}</g:availability>\n`;
          xml += `      <g:price>${price.toFixed(2)} ILS</g:price>\n`;
          if (variant.color) xml += `      <g:color>${esc(variant.color)}</g:color>\n`;
          if (variant.size) xml += `      <g:size>${esc(variant.size)}</g:size>\n`;
          xml += `      <g:brand>Drip Street</g:brand>\n`;
          xml += `      <g:google_product_category>1604</g:google_product_category>\n`;
          xml += `      <g:age_group>adult</g:age_group>\n`;
          xml += `      <g:gender>unisex</g:gender>\n`;
          xml += `    </item>\n`;
        }
      } else {
        // Fallback for product without variants
        const imageLink = getAbsoluteUrl(product.imageUrl || product.backImageUrl || '');
        xml += `    <item>\n`;
        xml += `      <g:id>product_${esc(product.id)}</g:id>\n`;
        xml += `      <title>${esc(product.title)}</title>\n`;
        xml += `      <description>${esc(product.description || product.title)}</description>\n`;
        xml += `      <link>${esc(link)}</link>\n`;
        xml += `      <g:image_link>${esc(imageLink)}</g:image_link>\n`;
        xml += `      <g:condition>new</g:condition>\n`;
        xml += `      <g:availability>in stock</g:availability>\n`;
        xml += `      <g:price>${Number(product.price).toFixed(2)} ILS</g:price>\n`;
        xml += `      <g:brand>Drip Street</g:brand>\n`;
        xml += `      <g:google_product_category>1604</g:google_product_category>\n`;
        xml += `      <g:age_group>adult</g:age_group>\n`;
        xml += `      <g:gender>unisex</g:gender>\n`;
        xml += `    </item>\n`;
      }
    }

    xml += `  </channel>\n`;
    xml += `</rss>\n`;

    res.set('Content-Type', 'application/xml; charset=utf-8');
    res.send(xml);
  } catch (err) {
    res.status(500).set('Content-Type', 'application/json').json({ error: err.message });
  }
});

module.exports = router;
