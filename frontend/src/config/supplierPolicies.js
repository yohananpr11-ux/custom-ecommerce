/**
 * DRIPSTREET — Supplier Policy Configuration
 * Single source of truth for all customer-facing copy related to
 * delivery timelines, return windows, and shipping promises.
 *
 * Rules (finalized 2026-06-22):
 *  - Supplier identity is NEVER exposed to customers.
 *  - All copy reflects DRIPSTREET as the single brand experience.
 *  - Two supplier backends: 'printify' (clothing) and 'dropship' (jewelry via CJ).
 *  - Flat shipping cost applies to both (no differentiation at this stage).
 *  - Mixed carts show separate delivery estimates per product type.
 */

const POLICIES = {
  printify: {
    supplierId: 'printify',
    delivery: { productionMin: 2, productionMax: 5, shippingMin: 7, shippingMax: 14 },
    returns:  { windowDays: 30, defectOnly: true, requiresPhoto: true },
    en: {
      categoryLabel:   'Clothing',
      deliveryLine:    (op) => {
        if (op) {
          const [pMin, pMax] = op.productionRangeDays || [2, 5];
          const [sMin, sMax] = op.shippingRangeDays   || [7, 14];
          return `Production: ${pMin}–${pMax} business days · Shipping: ${sMin}–${sMax} business days`;
        }
        return 'Production: 2–5 business days · Shipping: 7–14 business days';
      },
      returnBadge:     '30-day quality guarantee',
      returnIntro:     'If your item arrives with a manufacturing defect or misprint, submit a claim within 30 days of delivery with clear photos. Size-based returns are not accepted once production has started.',
      returnBullets:   [
        'Claim within 30 days of delivery',
        'Clear photo evidence required',
        'Free replacement or store credit for confirmed defects',
      ],
      trackingNote:    'Tracking number emailed once your parcel is scanned by the carrier.',
      // Cart drawer / checkout grouped label
      cartDelivery:    'Clothing: production 2–5 days + shipping 7–14 business days',
    },
    he: {
      categoryLabel:   'ביגוד',
      deliveryLine:    (op) => {
        if (op) {
          const [pMin, pMax] = op.productionRangeDays || [2, 5];
          const [sMin, sMax] = op.shippingRangeDays   || [7, 14];
          return `ייצור: ${pMin}–${pMax} ימי עסקים · משלוח: ${sMin}–${sMax} ימי עסקים`;
        }
        return 'ייצור: 2–5 ימי עסקים · משלוח: 7–14 ימי עסקים';
      },
      returnBadge:     'אחריות איכות 30 יום',
      returnIntro:     'אם פריט הגיע עם פגם ייצור או הדפס לקוי, ניתן לפנות עד 30 יום מהמסירה עם תמונות ברורות. לא ניתן להחזיר פריטים עקב בחירת מידה שגויה לאחר תחילת ייצור.',
      returnBullets:   [
        'פנייה עד 30 יום מהמסירה',
        'נדרשות תמונות ברורות כראיה',
        'החלפה חינם או זיכוי לחנות לפגמים מאושרים',
      ],
      trackingNote:    'מספר מעקב נשלח במייל ברגע שהחבילה נסרקת על ידי חברת השליחויות.',
      cartDelivery:    'ביגוד: ייצור 2–5 ימים + משלוח 7–14 ימי עסקים',
    },
  },

  dropship: {
    supplierId: 'dropship',
    delivery: { productionMin: 1, productionMax: 3, shippingMin: 7, shippingMax: 20 },
    returns:  { windowDays: 14, defectOnly: true, requiresPhoto: true },
    en: {
      categoryLabel:   'Jewelry',
      deliveryLine:    () => 'Ships within 1–3 business days · Delivery: 7–20 business days',
      returnBadge:     '14-day quality guarantee',
      returnIntro:     'If your item arrives damaged or defective, submit a claim within 14 days of delivery with clear photos of the issue. Items are non-returnable unless confirmed defective.',
      returnBullets:   [
        'Claim within 14 days of delivery',
        'Clear photo evidence required',
        'Replacement or store credit for confirmed defects',
      ],
      trackingNote:    'Tracking number sent once your parcel is dispatched.',
      cartDelivery:    'Jewelry: ships within 1–3 days · delivery 7–20 business days',
    },
    he: {
      categoryLabel:   'תכשיטים',
      deliveryLine:    () => 'יוצא תוך 1–3 ימי עסקים · זמן הגעה: 7–20 ימי עסקים',
      returnBadge:     'אחריות איכות 14 יום',
      returnIntro:     'אם פריט הגיע פגום, ניתן לפנות עד 14 יום מהמסירה עם תמונות ברורות של הבעיה. פריטים אינם ניתנים להחזרה אלא אם כן אושר פגם.',
      returnBullets:   [
        'פנייה עד 14 יום מהמסירה',
        'נדרשות תמונות ברורות כראיה',
        'החלפה או זיכוי לחנות לפגמים מאושרים',
      ],
      trackingNote:    'מספר מעקב נשלח עם יציאת החבילה.',
      cartDelivery:    'תכשיטים: יוצא תוך 1–3 ימים · הגעה 7–20 ימי עסקים',
    },
  },
};

/**
 * Resolve which policy applies to a given product object.
 * Checks supplier_id first (authoritative), falls back to type field, then
 * defaults to printify for any legacy products without supplier metadata.
 */
export function resolvePolicy(product) {
  const id = product?.supplier_id || product?.type || 'printify';
  return POLICIES[id] || POLICIES.printify;
}

/**
 * Returns the customer-facing delivery string for a product.
 * For Printify, uses live operationalNotice ranges if available.
 * For CJ, returns the single conservative global promise.
 */
export function getDeliveryLabel(product, locale = 'en') {
  const policy = resolvePolicy(product);
  const lang   = locale === 'he' ? 'he' : 'en';
  return policy[lang].deliveryLine(product?.operationalNotice || null);
}

/**
 * Returns the return window badge text ("30-day quality guarantee" etc.)
 */
export function getReturnBadge(product, locale = 'en') {
  const policy = resolvePolicy(product);
  const lang   = locale === 'he' ? 'he' : 'en';
  return policy[lang].returnBadge;
}

/**
 * Returns the full return policy explanation paragraph.
 */
export function getReturnDetail(product, locale = 'en') {
  const policy = resolvePolicy(product);
  const lang   = locale === 'he' ? 'he' : 'en';
  return { intro: policy[lang].returnIntro, bullets: policy[lang].returnBullets };
}

/**
 * Returns tracking note copy for a product's supplier.
 */
export function getTrackingNote(product, locale = 'en') {
  const policy = resolvePolicy(product);
  const lang   = locale === 'he' ? 'he' : 'en';
  return policy[lang].trackingNote;
}

/**
 * Groups cart items by supplier and returns an array of delivery estimate lines.
 * Used in the cart drawer and checkout summary to show mixed-cart estimates.
 *
 * @param {Array}  cartItems  - items from cart state (each has supplier_id or type)
 * @param {string} locale     - 'en' | 'he'
 * @returns {Array<{supplierId, categoryLabel, deliveryLine}>}
 */
export function getCartDeliveryEstimates(cartItems, locale = 'en') {
  const seen    = new Set();
  const results = [];
  const lang    = locale === 'he' ? 'he' : 'en';

  for (const item of cartItems) {
    const sid    = item.supplier_id || item.type || 'printify';
    if (seen.has(sid)) continue;
    seen.add(sid);
    const policy = POLICIES[sid] || POLICIES.printify;
    results.push({
      supplierId:    sid,
      categoryLabel: policy[lang].categoryLabel,
      deliveryLine:  policy[lang].cartDelivery,
    });
  }

  return results;
}

export default POLICIES;
