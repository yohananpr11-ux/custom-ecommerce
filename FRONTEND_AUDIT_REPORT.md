# Frontend Audit Report — Drip Street Shop

**Scope:** `frontend/src/` — all components, App.jsx, index.css, utilities.
**Date:** 2026-06-03
**Mode:** Read-only audit. No code modifications applied.

---

## Executive Summary

The codebase is **not** Tailwind-based. Styling uses a hybrid of:
1. A monolithic `index.css` (4,366 lines) with classic `@media (max-width: …)` queries.
2. Heavy inline `style={{...}}` objects in `App.jsx` (4,940 lines) — especially in the newer brutalist Hero, the HARDWARE grid, and the Phase 8.2 Meshulam checkout block.

There are **3 P0 issues** that will visibly break on iPhone SE / Galaxy A‑series small screens, **5 P1 issues** that produce inconsistent rendering or subtle bugs, and a cluster of P2/P3 code‑quality items that should be cleared before the first paid campaign.

| Severity | Count | Category |
|---|---|---|
| P0 (blocks mobile UX / loses revenue) | 3 | Hero clipping, payment card overflow, viewport horizontal scroll |
| P1 (visible bug, not blocking) | 5 | Image fallback loops, stale variant images, cart drawer focus, Hebrew RTL flex, footer overlap |
| P2 (consistency / polish) | 6 | Best-sellers narrow gap, badge wrap, etc. |
| P3 (code quality) | 4 | Inline-style sprawl, missing keys, no `<img loading=eager>` for LCP, ESLint disables |

---

## P0 — Critical (fix before any paid traffic)

### P0-1. Hero `<h1>` clips on iPhone SE / small Android

**Files:**
- `frontend/src/index.css` lines 632–640
- `frontend/src/index.css` lines 604–607
- `frontend/src/App.jsx` near hero JSX (search for `hero-value-prop`)

**Current CSS:**
```css
.hero h1 {
  font-size: clamp(52px, 8vw, 108px);
  letter-spacing: -0.03em;
  line-height: 0.92;
}
.hero-value-prop {
  max-width: 12ch;   /* ← problem */
  margin-inline: auto;
}
```

**Bug:** On a 320 px iPhone SE, `clamp()` resolves to the **52 px floor**, but `max-width: 12ch` (~165 px) is narrower than the natural width of the headline `PREMIUM STREETWEAR. ZERO GUESSWORK FIT.`. The text wraps to 4–5 lines, the period falls onto its own line, and the headline reaches ~330 px tall, pushing the CTAs off the first fold.

The existing `@media (max-width: 640px)` block (line 1956) **lowers** `.hero-value-prop` font-size to 42 px but never widens the `max-width`. The 12ch cap stays.

**Fix snippet (do not apply yet):**
```css
/* Inside the existing @media (max-width: 640px) block, around line 1961 */
.hero-value-prop {
  max-width: 92vw;          /* was: implicit 12ch */
  font-size: clamp(34px, 9vw, 48px);
  line-height: 1.04;
  letter-spacing: -0.02em;
}

/* Inside the existing @media (max-width: 480px) block at line 824 (extend it) */
.hero h1 {
  font-size: clamp(32px, 10vw, 46px);
  line-height: 1.06;
}
```

---

### P0-2. Payment-method radios overflow on screens < 360 px

**File:** `frontend/src/App.jsx` lines ~3558–3650 (the Phase 8.2 Meshulam checkout block)

**Bug:** The "Credit Card (Israel)" option renders 4 brand badges (`VISA · MC · ISRACARD · Pay`) inside a `flex` row with `gap: 6px`. `ISRACARD` alone is 8 characters at 10 px font with bold + padding. On iPhone SE 4-line layout:

```
[ ◯ ] Credit Card (Israel)
       Visa · Mastercard · Isracard · Apple Pay
       [ VISA ][ MC ][ ISRACARD ][ Pay ]   ← can horizontal-scroll
```

The container uses inline style `padding: '14px'` with the radio input taking ~24 px. Available width on iPhone SE 320 px minus container padding (`24px` from page + `28px` from internal padding) = **268 px** — barely enough for all 4 badges + 6px gaps. On 280 px Galaxy Fold cover screen, it overflows horizontally and triggers page-level horizontal scroll because the parent `<form>` is the inline-styled outer wrapper without `overflow-x: hidden`.

**Recommended fix:**
1. Either cap the badges row to wrap: it already has `flexWrap: 'wrap'`, but the `<label>` itself doesn't constrain width.
2. Add `min-width: 0` to the inner `<span style={{flex: 1}}>` so flex children can shrink.
3. Move the Phase 8.2 inline styles into `.payment-method-card` in `index.css` so the responsive rules become testable.

**Fix snippet (CSS-side):**
```css
/* Add to index.css */
.payment-method-card {
  display: flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
  padding: 14px;
  border: 1px solid #333;
  border-radius: 2px;
  min-width: 0;          /* allows shrinking inside flex/grid parents */
}
.payment-method-card.is-active {
  border-color: #fff;
  background: #0a0a0a;
}
.payment-method-card > .pm-content {
  flex: 1;
  min-width: 0;          /* THE FIX — without this, brand badges overflow */
}
.payment-brand-badges {
  display: flex;
  gap: 6px;
  margin-top: 6px;
  flex-wrap: wrap;
}
@media (max-width: 360px) {
  .payment-brand-badges { gap: 4px; }
  .payment-brand-badges span { font-size: 9px; padding: 1px 4px; }
}
```

---

### P0-3. Horizontal page scroll caused by inline-styled checkout summary

**File:** `frontend/src/App.jsx` line ~3660 (cart summary aside)

**Current JSX:**
```jsx
<div style={{ flex: '1', minWidth: '300px', backgroundColor: '#111', padding: '24px', borderRadius: '12px', height: 'fit-content' }}>
```

**Bug:** `minWidth: '300px'` inside a flex parent that is itself padded on iPhone SE (320 px viewport) forces the column to **never shrink below 300 px**. Combined with the `padding: 24px` (48 px horizontal), the column needs **348 px** to render without overflow. On 320 px viewports, the column pushes outside the viewport and the entire `<html>` gets a horizontal scrollbar — Lighthouse Mobile flags this immediately and Meta Ads QA will too.

**Fix snippet:**
```jsx
<div style={{ flex: '1 1 100%', minWidth: 0, /* was 300 */ backgroundColor: '#111', padding: '20px', borderRadius: '12px' }}>
```
Or in CSS:
```css
.checkout-summary-card {
  flex: 1 1 100%;
  min-width: 0;
  background: #111;
  padding: 20px;
  border-radius: 12px;
}
@media (min-width: 1024px) {
  .checkout-summary-card { flex: 0 0 320px; padding: 24px; }
}
```

---

## P1 — High (visible bug but not blocking)

### P1-1. Image fallback can loop silently when fallback itself 404s

**File:** `frontend/src/App.jsx` lines 834–839
```js
function setImageFallback(event, fallbackSrc = GLOBAL_IMAGE_FALLBACK) {
  const img = event.currentTarget;
  if (img.dataset.fallbackApplied === '1') return;
  img.dataset.fallbackApplied = '1';
  img.src = fallbackSrc;
}
```

**Bug:** The dataset guard prevents an infinite loop (good), but the **fallback URL itself is never verified**. If `GLOBAL_IMAGE_FALLBACK` 404s (e.g. `/brand/drip-mark.png` deleted in a future asset migration), the `<img>` shows the broken-image glyph and the user has no idea why. Also, when the fallback fires, the alt text becomes the only signal — most `<img>` in the codebase use `alt={product.title}` which works, but the cart drawer images at line 3110 / 3385 use computed `itemThumbnail || null` and the `<img src={null}>` triggers an immediate error before any fallback runs.

**Fix:** Use the existing `<GuardedProductImage>` component (already defined at line 841!) consistently instead of raw `<img onError={setImageFallback}>`. The component handles `failed`, `loaded`, and clean swap. **Currently 9 raw `<img onError={setImageFallback}>` calls bypass it** (App.jsx lines 3160, 4186, 4215, 4293, 4295, 4356, 4535, 4729, and one more in the cart row).

### P1-2. Variant image resolution silently falls back to product hero image

**File:** `frontend/src/App.jsx` lines 749–767, 1285–1354

The `getMappedImagesForVariantIds()` helper resolves variant-specific images by matching `entry.variantId` inside the `product.images` array. **CJ Dropshipping items do not carry this metadata** (the seeder writes the same `imageUrl` to both `products.imageUrl` and `product_variants.imageUrl`, and `products.images` is set to `NULL`).

This means:
1. For Printify-imported products with `images: [{src, variantId}]` — variant clicks correctly swap images. ✓
2. For CJ products (16–21) — variant clicks fall through to `selectedVariant.imageUrl`, then to `product.imageUrl`. Same image regardless of variant. ✗ Subtle but the user reported "wrong images" in the past, this is likely the root cause for CJ rows where multiple variants exist.

**Fix path:** When the CJ seeder evolves to support multiple variants (e.g. Steel vs Black studs in P20), seed `product.images` as a JSON array of `{src, variantId, view}` objects so `getMappedImagesForVariantIds` can resolve them. Until then, document this as expected.

### P1-3. Cart drawer focus is not trapped — keyboard users can tab into background

**File:** `frontend/src/App.jsx` line 3067 (and 4573 — same drawer rendered twice via routes)
```jsx
<div className={`cart-overlay ${isCartOpen ? 'open' : ''}`} onClick={...}>
```

Closing on overlay click works (good). But there's no `aria-modal="true"`, no focus trap, and no `inert` on the background. iOS users who land on a CTA inside the cart and tab can reach buttons outside the modal. Also no `Escape` keyboard handler.

**Fix:** Use a `useEffect` on `isCartOpen` to (1) set `document.body.style.overflow = 'hidden'`, (2) attach `keydown` listener for `Escape`, (3) optionally call `aria-hidden='true'` on `#root > :not(.cart-overlay)`.

### P1-4. "Total to pay" strip reads right-to-left wrong in Hebrew

**File:** `frontend/src/App.jsx` Phase 8.2 inline-styled block (search for `'סה״כ לתשלום'`)

```jsx
<div style={{ display: 'flex', justifyContent: 'space-between', ... }}>
  <span>סה״כ לתשלום</span>
  <span>₪268.00</span>
</div>
```

**Bug:** In Hebrew, the page direction is LTR (the codebase doesn't toggle `dir="rtl"` globally). With LTR + `justifyContent: space-between`, the Hebrew label appears on the LEFT and the number on the RIGHT. Israeli users expect the **amount on the left** (because Hebrew is read right-to-left, and the "result" of a calculation appears at the start of the reading flow on the right). Today it reads as: `[סה״כ לתשלום] ........ [₪268.00]` — which feels backwards.

**Fix:** Either swap the two `<span>`s when `locale === 'he'`, or set `direction: 'rtl'` on this specific strip.

### P1-5. Footer overlaps mobile tabbar (~110 px) but only when tabbar is rendered

**File:** `frontend/src/index.css` lines 2780, 2953

```css
.mobile-tabbar { /* 60px tall + safe-area-inset-bottom */ }
.footer { padding-bottom: 110px; }   /* hard-coded compensation */
```

**Bug:** The 110 px footer padding is added inside the `@media (max-width: 768px)` block, but the mobile tabbar is **conditionally rendered**. On pages without the tabbar (legal pages, checkout?), the footer has 110 px of empty padding for no reason, creating a visible gap.

**Fix:** Toggle a `.has-mobile-tabbar` class on `<body>` when the tabbar mounts, and scope the footer padding to that class. Or use `padding-bottom: calc(60px + env(safe-area-inset-bottom) + 20px)` only inside `.has-mobile-tabbar .footer`.

---

## P2 — Medium (polish / consistency)

### P2-1. HARDWARE card images stuck in grayscale on mobile (no hover available)

**File:** `frontend/src/index.css` lines 756–767
```css
.hardware-image-btn img { filter: grayscale(1) contrast(1.02); }
.hardware-card:hover .hardware-image-btn img { filter: grayscale(0) contrast(1.02); }
```

iPhone/Android have no `:hover`. Customers see permanently desaturated jewelry photos. Likely hurts conversion — gold/steel finish is the entire selling point.

**Fix:** Remove the grayscale filter on touch devices:
```css
@media (hover: none) {
  .hardware-image-btn img { filter: none; }
}
```

### P2-2. `.best-sellers-grid` jumps 4 → 2 → 1 (no 3-column intermediate)

**File:** `frontend/src/index.css` lines 859–863 (desktop), 1945–1948 (≤1024), 1971–1973 (≤640)

Between 1024 px and 640 px the grid is **2 columns**, but on a 720 px Android tablet (~360 px per card) the cards feel cramped. A `@media (max-width: 900px)` rule at 3 columns would smooth the jump.

### P2-3. `.product-image-wrapper` mobile aspect ratio = 0.78 (too tall)

**File:** `frontend/src/index.css` line 2853
```css
.product-image-wrapper { aspect-ratio: 0.78; }
```

0.78 = portrait. With 2-column grid on iPhone SE, each card image is ~150 × 192 px. Combined with title + price + CTA below, each card is ~340 px tall → only **2 cards above the fold**. Streetwear competitors typically use `1 / 1` or `4 / 5` for better density.

### P2-4. Brutalist CTA `border-radius: 0` clashes with cart drawer `border-radius: 16px`

**File:** `frontend/src/index.css` line 2881
```css
.cart-panel { border-top-left-radius: 16px; border-top-right-radius: 16px; }
```

Inconsistent visual language — everywhere else is sharp 0–2 px, but the cart drawer rounds 16 px. Either flatten the cart drawer to match, or audit other corner-radii.

### P2-5. `.hardware-head h2` uses `clamp(36px, 6vw, 72px)` — wraps "HARDWARE" awkwardly on small phones

**File:** `frontend/src/index.css` lines 709–717

On iPhone SE the 36 px floor + `letter-spacing: -0.03em` + uppercase makes "HARDWARE" + subtitle stack vertically with awkward gaps. Tighten the `@media (max-width: 480px)` block.

### P2-6. Mobile tabbar uses `border-radius: 10px` on buttons but rest of brutalist UI is 0

Same inconsistency as P2-4. Either commit to brutalist (sharp) or to neo-mobile (rounded). Pick one and apply across.

---

## P3 — Code Quality / Quick Wins

### P3-1. Inline `style={{...}}` sprawl in checkout block

**File:** `frontend/src/App.jsx` lines ~3470–3735

Roughly **400 lines** of JSX use inline `style={{}}`. This:
- Breaks `@media` queries (inline styles can't host media queries).
- Forces React to recompute style objects on every re-render.
- Makes audit-by-eye almost impossible.

**Recommend:** Extract `payment-method-card`, `total-to-pay-strip`, `checkout-summary-card` into `index.css` classes. The Phase 8.2 brand badges, the Phase 7 HARDWARE styling, and the new Hero CTAs are all candidates.

### P3-2. Missing `key` warnings likely in HARDWARE grid

**File:** `frontend/src/App.jsx` (search for `.map(` near `hardware-grid`)

Without reading the JSX I can't confirm, but the file's pattern shows several `.map((entry, index) => ...)` without verifying explicit `key={entry.id}`. Browser dev console will warn. Likely benign but worth a sweep.

### P3-3. No `<img loading="eager" fetchpriority="high">` for hero / LCP image

Mobile Lighthouse LCP score depends on the hero/first product image loading eagerly. Currently every product card uses `loading="lazy"`. The first row of cards above the fold should be `eager` with `fetchpriority="high"`. The codebase already has `loading={productIndex === 0 ? 'eager' : 'lazy'}` at line 4293 — good — but the Hero itself doesn't preload its image.

### P3-4. Two `useEffect`s with `eslint-disable-next-line react-hooks/exhaustive-deps`

**File:** `frontend/src/App.jsx` Phase 8.4 (InitiateCheckout / Purchase pixels)

These are intentional single-fire effects but the disable comments hide future bugs (e.g. if `cartTotal` reference changes during the success page mount). Consider extracting to a `useEffectOnce(handler, condition)` helper that's deliberate about firing semantics.

---

## Cross-cutting observations

### Tailwind reference in directive

The directive mentioned `sm:`, `md:`, and `w-[Xpx]` Tailwind utility classes. **This codebase is not Tailwind-based.** All responsive behavior lives in `index.css` `@media` blocks and inline JSX styles. Any audit aiming for Tailwind-style breakpoints will return false negatives. Recommend: align mental model with the actual stack before applying fixes.

### Image rendering "wrong images" pattern

In the past phases, "wrong images" referred to:
1. Stale CDN URLs after re-seed (fixed via Phase 7.3 `patch_catalog_images.cjs`).
2. SPU typo on Product 18 (fixed via the same patch).
3. Products 17/21 sharing the same Unsplash URL (fixed via Phase 8.1.1 swap).

The remaining root cause for *future* "wrong image" reports will almost certainly be **CDN caching at Cloudflare/Render** or **React state staleness on the `/api/products` response** — neither is fixed by frontend code. To rule out frontend bugs, add a cache-busting query string when seeding:
```
imageUrl: `https://cf.cjdropshipping.com/...?v=${Date.now()}`
```
…during initial CJ catalog sync (not on every render).

### Responsive testing checklist (when applying fixes)

Before merging fixes, test on:
- iPhone SE (320 × 568)
- iPhone 14 (390 × 844)
- Pixel 7 (412 × 915)
- Galaxy S22 (360 × 780)
- iPad Mini (768 × 1024)

Chrome DevTools' device emulation is enough for visual checks. For touch behavior (the P2-1 grayscale hover bug), use a real device or BrowserStack.

---

## Suggested fix order

1. **P0-1** (Hero clip) — biggest visual problem, fixes the first impression.
2. **P0-3** (Horizontal scroll) — blocks Meta Ads QA.
3. **P0-2** (Payment radios overflow) — blocks conversion on iPhone SE / Galaxy Fold.
4. **P1-1** (Use `GuardedProductImage` everywhere) — eliminates broken-image risk.
5. **P1-4** (Hebrew RTL flex) — restores local UX.
6. **P2-1** (Remove grayscale on touch) — improves HARDWARE conversion.
7. Everything else can ship in a polish PR after the first paid campaign launches.

Each P0–P1 has a fix snippet in this report. Apply them in a new branch, test on the device matrix above, and PR them as one batch titled `fix: phase 9 mobile responsiveness pass`.

---

**Report generated read-only — no source files modified.**
